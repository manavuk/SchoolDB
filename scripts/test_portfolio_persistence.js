const assert = require('assert');
const db = require('../db');

console.log('--- Testing Portfolio Persistence Across Login/Logout Sessions ---');

// 1. Create a test user in SQLite
const testUserId = `usr-test-pers-${Date.now()}`;
const testUser = db.insertUser({
  id: testUserId,
  name: 'Persistence Test User',
  email: `pers.${Date.now()}@example.com`,
  password: 'password123',
  permissions: ['parent:recommendations', 'parent:portfolio']
});
console.log(`✓ Created test user ${testUser.id}`);

// 2. Add shortlisted schools to portfolio
const sampleSchools = [
  { id: 'sch-100001', name: 'The Tiffin Girls School', la: 'Kingston upon Thames', schoolType: 'Grammar', gender: 'Girls', ofstedRating: 'Outstanding' },
  { id: 'sch-100002', name: 'Tiffin School', la: 'Kingston upon Thames', schoolType: 'Grammar', gender: 'Boys', ofstedRating: 'Outstanding' }
];

const savedPortfolio = db.savePortfolio(testUserId, {
  targetLocation: 'Kingston upon Thames',
  selectedSchools: sampleSchools,
  removedSchoolIds: ['sch-999999']
});

console.log(`✓ Saved portfolio to SQLite for user ${testUserId}:`, savedPortfolio);
assert.strictEqual(savedPortfolio.selectedSchools.length, 2, 'Portfolio should have 2 selected schools');
assert.strictEqual(savedPortfolio.targetLocation, 'Kingston upon Thames', 'Target location should match');

// 3. Simulate Logout (clear memory)
let inMemoryPortfolio = null;

// 4. Simulate Re-login (load portfolio from SQLite)
const reloadedPortfolio = db.getPortfolioByUserId(testUserId);
console.log(`✓ Reloaded portfolio from SQLite upon re-login for user ${testUserId}:`, reloadedPortfolio);

assert.strictEqual(reloadedPortfolio.selectedSchools.length, 2, 'Reloaded portfolio MUST retain the 2 shortlisted schools');
assert.strictEqual(reloadedPortfolio.selectedSchools[0].name, 'The Tiffin Girls School', 'School name must match');

console.log('\n=========================================');
console.log('🎉 PORTFOLIO PERSISTENCE VERIFICATION PASSED!');
console.log('=========================================');
