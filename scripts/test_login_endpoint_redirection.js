const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../server');

console.log('=== RUNNING TESTS: Dedicated /login Endpoint & Access Redirection ===\n');

let server;
const PORT = 3009;

function makeRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path: urlPath,
      method: method,
      headers: headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

(async function runTestSuite() {
  server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 300));

  try {
    // 1. Verify /login endpoint serves login.html
    console.log('[1. Testing /login Endpoint]');
    const loginRes = await makeRequest('GET', '/login');
    assert.strictEqual(loginRes.status, 200, '/login must return HTTP 200');
    assert(typeof loginRes.body === 'string' && loginRes.body.includes('EduLondon DB'), '/login must serve the login portal HTML');
    console.log('  ✓ GET /login returns 200 OK and serves login.html');

    // 2. Verify / (Parent Portal) allows guest access (HTTP 200, no redirect)
    console.log('\n[2. Testing / (Parent Portal) Guest Access]');
    const parentRes = await makeRequest('GET', '/');
    assert.strictEqual(parentRes.status, 200, '/ must return HTTP 200 without redirecting');
    assert(typeof parentRes.body === 'string' && parentRes.body.includes('Parent Portal'), '/ must serve Parent Portal HTML');
    assert(parentRes.body.includes('auth-login-btn'), '/ must contain the top header Sign In button');
    console.log('  ✓ GET / returns 200 OK without redirect; guest browsing enabled with top Sign In button');

    // 3. Verify /api/auth/me returns authenticated: false for unauthenticated guests
    console.log('\n[3. Testing /api/auth/me Unauthenticated State]');
    const authMeGuest = await makeRequest('GET', '/api/auth/me');
    assert.strictEqual(authMeGuest.status, 200);
    assert.strictEqual(authMeGuest.body.authenticated, false, '/api/auth/me must return authenticated: false for guests');
    console.log('  ✓ GET /api/auth/me correctly returns authenticated: false without auto-login');

    // 4. Verify /admin redirects unauthenticated users to /login
    console.log('\n[4. Testing Unauthenticated /admin Redirection]');
    const adminUnauthRes = await makeRequest('GET', '/admin');
    assert.strictEqual(adminUnauthRes.status, 302, '/admin must return HTTP 302 redirect for unauthenticated requests');
    const location = adminUnauthRes.headers['location'];
    assert(location && location.includes('/login?redirect='), `Redirect location must point to /login?redirect=..., got: ${location}`);
    console.log(`  ✓ GET /admin redirects unauthenticated user to: ${location}`);

    // 5. Verify /admin with non-admin session redirects to /login
    console.log('\n[5. Testing Non-Admin User Access to /admin]');
    const parentLogin = await makeRequest('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, {
      email: 'sarah@gmail.com',
      password: 'demo'
    });
    assert.strictEqual(parentLogin.status, 200);
    const parentCookie = parentLogin.headers['set-cookie'] ? parentLogin.headers['set-cookie'][0].split(';')[0] : '';
    
    const adminParentRes = await makeRequest('GET', '/admin', {
      'Cookie': parentCookie,
      'x-session-id': parentLogin.body.sessionId
    });
    assert.strictEqual(adminParentRes.status, 302, 'Non-admin user accessing /admin must be redirected');
    console.log('  ✓ Non-admin user accessing /admin is redirected to /login');

    // 6. Verify /admin with authenticated Admin session returns 200 OK
    console.log('\n[6. Testing Authenticated Admin Access to /admin]');
    const adminLogin = await makeRequest('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, {
      email: 'aa@bb.cc',
      password: 'demo'
    });
    assert.strictEqual(adminLogin.status, 200);
    assert(adminLogin.body.sessionId, 'Login response must provide sessionId');
    const adminCookie = adminLogin.headers['set-cookie'] ? adminLogin.headers['set-cookie'][0].split(';')[0] : '';

    const adminAuthRes = await makeRequest('GET', '/admin', {
      'Cookie': adminCookie,
      'x-session-id': adminLogin.body.sessionId
    });
    assert.strictEqual(adminAuthRes.status, 200, 'Authenticated admin must access /admin with HTTP 200');
    assert(typeof adminAuthRes.body === 'string' && adminAuthRes.body.includes('admin-portal-wrapper'), '/admin must serve admin portal');
    console.log('  ✓ Authenticated admin accessing /admin returns 200 OK with full Admin Portal');

    // 7. Verify public/login.html DOM structure
    console.log('\n[7. Verifying public/login.html DOM Structure]');
    const loginHtml = fs.readFileSync(path.join(__dirname, '../public/login.html'), 'utf8');
    assert(loginHtml.includes('id="quick-demo-account-select"'), 'login.html must have demo account selector');
    assert(loginHtml.includes('id="auth-login-form"'), 'login.html must have login form');
    assert(loginHtml.includes('id="auth-signup-form"'), 'login.html must have signup form');
    assert(loginHtml.includes('id="btn-google-sso"'), 'login.html must have Google SSO button');
    assert(loginHtml.includes('href="/"'), 'login.html must have link back to Parent Portal');
    console.log('  ✓ login.html contains demo switcher, login form, signup form, Google SSO, and return link');

    console.log('\n========================================================================');
    console.log('🎉 ALL DEDICATED /login ENDPOINT & REDIRECTION TESTS PASSED!');
    console.log('========================================================================\n');
  } catch (err) {
    console.error('Test Suite Failed:', err);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
  }
})();
