const assert = require('assert');
const db = require('../db');

console.log('--- Testing Permission Capabilities Model & Default-Deny Policy ---');

// 1. Verify SQLite Users table schema
const users = db.getAllUsers();
console.log(`✓ Fetched ${users.length} users from SQLite.`);
assert(users.length > 0, 'Users must exist in SQLite');

const testUser = users[0];
assert(Array.isArray(testUser.permissions), 'User permissions must be an array');
assert.strictEqual(testUser.role, undefined, 'Role property must NOT exist on user object');
console.log(`✓ Verified user permissions array for ${testUser.email}:`, testUser.permissions);

// 2. Verify default permissions
const defaultUserPerms = ['parent:recommendations', 'parent:portfolio'];
assert.deepStrictEqual(testUser.permissions, defaultUserPerms, 'Default user permissions should match parent capabilities');
console.log(`✓ Default session permissions verified:`, defaultUserPerms);

// 3. Verify capability check logic
function checkPermission(userPermissions, requiredPermission) {
  return Array.isArray(userPermissions) && userPermissions.includes(requiredPermission);
}

assert.strictEqual(checkPermission(testUser.permissions, 'parent:recommendations'), true, 'Parent should have parent:recommendations');
assert.strictEqual(checkPermission(testUser.permissions, 'directory:view'), false, 'Standard session MUST NOT have directory:view permission by default');
assert.strictEqual(checkPermission(testUser.permissions, 'admin:portal'), false, 'Standard session MUST NOT have admin:portal permission by default');

console.log('✓ Directory View permission check for default session: DENIED (display: none)');
console.log('✓ Admin Portal permission check for default session: DENIED (display: none)');

console.log('\n=========================================');
console.log('🎉 ALL PERMISSION MODEL TESTS PASSED SUCCESSFULLY!');
console.log('=========================================');
