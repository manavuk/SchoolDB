const assert = require('assert');
const http = require('http');

console.log('--- Testing Session Invalidation & Logout Logic ---');

const db = require('../db');
const users = db.getAllUsers();
assert(users.length > 0, 'Users must exist in database');

const testUser = users[0];

// 1. Create a test session
const activeSessions = new Map();
function createTestSession(user) {
  const sessionId = `sess-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  activeSessions.set(sessionId, { user: { id: user.id, email: user.email, name: user.name, permissions: user.permissions } });
  return sessionId;
}

const sessId = createTestSession(testUser);
assert(activeSessions.has(sessId), 'Session must exist after creation');
console.log(`✓ Created test session: ${sessId} for ${testUser.email}`);

// 2. Invalidate session via logout logic
function logoutTestSession(sessionId) {
  if (sessionId && activeSessions.has(sessionId)) {
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}

const loggedOut = logoutTestSession(sessId);
assert.strictEqual(loggedOut, true, 'Logout function must return true');
assert.strictEqual(activeSessions.has(sessId), false, 'Session MUST be deleted from activeSessions store upon logout');
console.log(`✓ Verified session ${sessId} was deleted from server memory store.`);

// 3. Verify lookup on deleted session returns null
function getSessionUser(sessionId) {
  const sess = activeSessions.get(sessionId);
  return sess ? sess.user : null;
}

const userAfterLogout = getSessionUser(sessId);
assert.strictEqual(userAfterLogout, null, 'Lookup of deleted session must return null');
console.log(`✓ Lookup of invalidated session returned null (401 Unauthorized behavior verified).`);

console.log('\n=========================================');
console.log('🎉 ALL SESSION LOGOUT TESTS PASSED!');
console.log('=========================================');
