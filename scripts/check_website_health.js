const db = require('../db');
const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Check single URL reachability, status code, and redirects
 */
function checkUrlHealth(targetUrl, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return resolve({
        status: 'invalid_url',
        statusLabel: 'Invalid URL Format',
        isAlive: false,
        statusCode: 0,
        responseTimeMs: Date.now() - startTime
      });
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const reqOptions = {
      method: 'HEAD',
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: timeoutMs
    };

    let hasResponded = false;

    const req = client.request(reqOptions, (res) => {
      if (hasResponded) return;
      hasResponded = true;
      const statusCode = res.statusCode || 0;
      const responseTimeMs = Date.now() - startTime;

      // Handle Redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(statusCode) && res.headers.location) {
        let redirectTarget = res.headers.location;
        if (redirectTarget.startsWith('/')) {
          redirectTarget = `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectTarget}`;
        }
        return resolve({
          status: 'redirect',
          statusLabel: `${statusCode} Redirect`,
          isAlive: true,
          statusCode,
          redirectUrl: redirectTarget,
          responseTimeMs
        });
      }

      if (statusCode >= 200 && statusCode < 400) {
        return resolve({
          status: 'healthy',
          statusLabel: `${statusCode} OK`,
          isAlive: true,
          statusCode,
          responseTimeMs
        });
      }

      if (statusCode === 404 || statusCode === 410) {
        return resolve({
          status: 'not_found',
          statusLabel: `${statusCode} Not Found`,
          isAlive: false,
          statusCode,
          responseTimeMs
        });
      }

      // Other status codes (403, 405, 500, etc)
      return resolve({
        status: 'active_with_warning',
        statusLabel: `${statusCode} Response`,
        isAlive: true,
        statusCode,
        responseTimeMs
      });
    });

    req.on('timeout', () => {
      if (hasResponded) return;
      hasResponded = true;
      req.destroy();
      resolve({
        status: 'timeout',
        statusLabel: 'Connection Timeout',
        isAlive: false,
        statusCode: 0,
        responseTimeMs: Date.now() - startTime
      });
    });

    req.on('error', (err) => {
      if (hasResponded) return;
      hasResponded = true;
      const isDnsError = err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN';
      const isRefused = err.code === 'ECONNREFUSED';
      resolve({
        status: 'error',
        statusLabel: isDnsError ? 'DNS Resolution Failed' : (isRefused ? 'Connection Refused' : (err.code || 'Network Error')),
        isAlive: false,
        statusCode: 0,
        error: err.code || err.message,
        responseTimeMs: Date.now() - startTime
      });
    });

    req.end();
  });
}

/**
 * Execute Website Health Audit across target schools
 */
async function auditSchoolsWebsiteHealth(schoolsToAudit = [], concurrency = 5) {
  const results = [];
  let healthyCount = 0;
  let upgradedCount = 0;
  let deadCount = 0;

  const queue = [...schoolsToAudit];
  const workers = [];

  async function worker() {
    while (queue.length > 0) {
      const school = queue.shift();
      if (!school || !school.website) continue;

      const rawUrl = school.website.trim();
      const checkResult = await checkUrlHealth(rawUrl, 3500);

      let actionTaken = 'Verified Clean';
      let finalWebsite = rawUrl;

      const currentTags = Array.isArray(school.verification_tags) ? [...school.verification_tags] : [];
      if (!currentTags.includes('web_health_audited')) {
        currentTags.push('web_health_audited');
      }

      if (checkResult.status === 'healthy' || checkResult.status === 'active_with_warning') {
        healthyCount++;
      } else if (checkResult.status === 'redirect' && checkResult.redirectUrl) {
        // If upgraded from http:// to https:// or moved
        if (rawUrl.startsWith('http://') && checkResult.redirectUrl.startsWith('https://')) {
          upgradedCount++;
          actionTaken = 'Auto-Upgraded to HTTPS';
          finalWebsite = checkResult.redirectUrl;
        } else {
          healthyCount++;
          actionTaken = 'Redirect Verified';
        }
      } else if (!checkResult.isAlive) {
        deadCount++;
        actionTaken = 'Tagged dead_website';
        if (!currentTags.includes('dead_website')) {
          currentTags.push('dead_website');
        }
      }

      try {
        db.updateSchool(school.id, {
          website: finalWebsite,
          verification_tags: currentTags,
          verified_at: new Date().toISOString()
        });
      } catch (e) {}

      results.push({
        schoolId: school.id,
        schoolName: school.name,
        postcode: school.postcode || '',
        la: school.la || '',
        originalUrl: rawUrl,
        finalUrl: finalWebsite,
        statusCode: checkResult.statusCode,
        status: checkResult.status,
        statusLabel: checkResult.statusLabel,
        isAlive: checkResult.isAlive,
        responseTimeMs: checkResult.responseTimeMs,
        actionTaken
      });

      // Pacing delay between worker requests
      await new Promise(r => setTimeout(r, 40));
    }
  }

  const activeWorkerCount = Math.min(concurrency, queue.length || 1);
  for (let i = 0; i < activeWorkerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return {
    checkedCount: results.length,
    healthyCount,
    upgradedCount,
    deadCount,
    results
  };
}

module.exports = {
  checkUrlHealth,
  auditSchoolsWebsiteHealth
};
