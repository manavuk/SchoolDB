const assert = require('assert');
const db = require('../db');

console.log('--- Testing Super Admin (aa@bb.cc) & Standard Parent Permission Model ---');

// 1. Verify SQLite Users table & aa@bb.cc Super Admin
const users = db.getAllUsers();
console.log(`✓ Fetched ${users.length} users from SQLite.`);
assert(users.length > 0, 'Users must exist in SQLite');

const adminUser = users.find(u => u.email.toLowerCase() === 'aa@bb.cc');
assert(adminUser, 'Super Admin aa@bb.cc must exist in SQLite');
console.log(`✓ Verified Super Admin account ${adminUser.email}:`, adminUser.permissions);

const fullAdminPerms = ['directory:view', 'admin:portal', 'admin:edit', 'admin:delete', 'parent:recommendations', 'parent:portfolio'];
assert.deepStrictEqual(adminUser.permissions, fullAdminPerms, 'aa@bb.cc must have full admin capabilities');

// 2. Verify all other users have parent-only access
const parentPerms = ['parent:recommendations', 'parent:portfolio'];
const nonAdminUsers = users.filter(u => u.email.toLowerCase() !== 'aa@bb.cc');

for (const user of nonAdminUsers) {
  assert.deepStrictEqual(user.permissions, parentPerms, `User ${user.email} must have parent-only permissions`);
}
console.log(`✓ Verified ${nonAdminUsers.length} non-admin users have strictly parent-level access:`, parentPerms);

// 3. Capability permission check helper
function checkPermission(userPermissions, requiredPermission) {
  return Array.isArray(userPermissions) && userPermissions.includes(requiredPermission);
}

// Super Admin aa@bb.cc capability checks
assert.strictEqual(checkPermission(adminUser.permissions, 'directory:view'), true, 'aa@bb.cc MUST have directory:view');
assert.strictEqual(checkPermission(adminUser.permissions, 'admin:portal'), true, 'aa@bb.cc MUST have admin:portal');
assert.strictEqual(checkPermission(adminUser.permissions, 'parent:recommendations'), true, 'aa@bb.cc MUST have parent:recommendations');

// Standard parent capability checks
const sampleParent = nonAdminUsers[0];
assert.strictEqual(checkPermission(sampleParent.permissions, 'parent:recommendations'), true, 'Parent should have parent:recommendations');
assert.strictEqual(checkPermission(sampleParent.permissions, 'directory:view'), false, 'Standard session MUST NOT have directory:view permission');
assert.strictEqual(checkPermission(sampleParent.permissions, 'admin:portal'), false, 'Standard session MUST NOT have admin:portal permission');

console.log('✓ aa@bb.cc Directory View & Admin Portal access: GRANTED');
console.log('✓ Standard Parent Directory View & Admin Portal access: DENIED');

console.log('\n=========================================');
console.log('🎉 ALL SUPER ADMIN & PERMISSION MODEL TESTS PASSED SUCCESSFULLY!');
console.log('=========================================');
