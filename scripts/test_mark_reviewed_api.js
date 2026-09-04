const app = require('../server');

function testDirectHandler() {
  const req = {
    method: 'POST',
    url: '/api/admin/quality/deduplication/mark-reviewed',
    headers: {
      'content-type': 'application/json'
    },
    body: {
      schoolAId: 'sch-517282',
      schoolBId: 'sch-gov-125777',
      schoolAName: "Rugby School",
      schoolBName: "Rugby School Candidate",
      decision: 'not_duplicate',
      reason: 'Confirmed distinct schools'
    },
    query: {},
    cookies: {}
  };

  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) {
      console.log('Direct test result:', this.statusCode, JSON.stringify(data, null, 2));
    }
  };

  // Dispatch through app router
  app(req, res, (err) => {
    if (err) console.error('App error:', err);
    else console.log('Next called (no route matched or passed)');
  });
}

testDirectHandler();
