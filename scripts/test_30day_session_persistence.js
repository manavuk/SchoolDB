const assert = require('assert');
const db = require('../db');

console.log('--- Testing 30-Day Session Persistence across Page Refresh & Server Restarts ---');

// 1. Create a persistent session in SQLite
const testUserId = `usr-pers-30d-${Date.now()}`;
const sampleUser = {
  id: testUserId,
  name: 'Session Persist User',
  email: `persist.${Date.now()}@edulondon.sch.uk`,
  permissions: ['parent:recommendations', 'parent:portfolio']
};

const sessionId = `sess-30d-test-${Date.now()}`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const savedSess = db.saveSession(sessionId, sampleUser, THIRTY_DAYS_MS);
console.log(`✓ Saved 30-day persistent session to SQLite:`, savedSess);

assert.ok(savedSess.expiresAt, 'Session must have expiresAt timestamp');
const expiresDate = new Date(savedSess.expiresAt);
const now = new Date();
const diffDays = Math.round((expiresDate - now) / (1000 * 60 * 60 * 24));
console.log(`✓ Session lifetime verified: ${diffDays} days from now (Expires: ${savedSess.expiresAt})`);
assert.strictEqual(diffDays, 30, 'Session lifetime must be 30 days');

// 2. Simulate server restart / page refresh: Lookup session from SQLite
const retrievedSess = db.getSession(sessionId);
console.log(`✓ Restored session from SQLite upon page refresh/server restart:`, retrievedSess);

assert.ok(retrievedSess, 'Retrieved session should not be null');
assert.strictEqual(retrievedSess.user.id, testUserId, 'Restored session user ID must match');
assert.strictEqual(retrievedSess.user.name, 'Session Persist User', 'Restored session user name must match');

// 3. Test Session Deletion on Logout
db.deleteSession(sessionId);
const deletedCheck = db.getSession(sessionId);
assert.strictEqual(deletedCheck, null, 'Deleted session must return null');
console.log('✓ Verified session deletion from SQLite on logout');

console.log('\n=========================================');
console.log('🎉 30-DAY SESSION PERSISTENCE TESTS PASSED!');
console.log('=========================================');
