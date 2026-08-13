const assert = require('assert');
const http = require('http');

console.log('--- Diagnosing Page Refresh Session Persistence HTTP Flow ---');

function makeRequest(path, headers = {}, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTest() {
  try {
    // 1. Log in as sarah@gmail.com
    console.log('1. Logging in as sarah@gmail.com...');
    const loginRes = await makeRequest('/api/auth/login', {}, 'POST', {
      email: 'sarah@gmail.com',
      password: 'user'
    });

    console.log('   Login Response status:', loginRes.status);
    console.log('   Login Response body:', loginRes.body);
    console.log('   Set-Cookie header:', loginRes.headers['set-cookie']);

    assert.strictEqual(loginRes.status, 200, 'Login status must be 200');
    const sessionId = loginRes.body.sessionId;
    assert.ok(sessionId, 'Session ID must be returned');

    // 2. Simulate Page Refresh: Call /api/auth/me with x-session-id header
    console.log('\n2. Simulating Page Refresh (Call /api/auth/me with x-session-id)...');
    const meHeaderRes = await makeRequest('/api/auth/me', { 'x-session-id': sessionId });
    console.log('   /api/auth/me (header) status:', meHeaderRes.status);
    console.log('   /api/auth/me (header) body:', meHeaderRes.body);
    assert.strictEqual(meHeaderRes.status, 200, '/api/auth/me with header must return 200');

    // 3. Simulate Page Refresh: Call /api/auth/me with Cookie header
    const cookieVal = loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'][0].split(';')[0] : `school_db_session_id=${sessionId}`;
    console.log('\n3. Simulating Page Refresh (Call /api/auth/me with Cookie: ' + cookieVal + ')...');
    const meCookieRes = await makeRequest('/api/auth/me', { 'Cookie': cookieVal });
    console.log('   /api/auth/me (cookie) status:', meCookieRes.status);
    console.log('   /api/auth/me (cookie) body:', meCookieRes.body);
    assert.strictEqual(meCookieRes.status, 200, '/api/auth/me with Cookie must return 200');

    console.log('\n=========================================');
    console.log('🎉 REFRESH PERSISTENCE DIAGNOSTIC PASSED!');
    console.log('=========================================');
  } catch (err) {
    console.error('Diagnostic error:', err);
  }
}

runTest();
