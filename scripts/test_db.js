const db = require('../db');
const assert = require('assert');

console.log('--- Testing SQLite Database Layer (db.js) ---');

// 1. Schools
const schools = db.getAllSchools();
console.log(`✓ Database contains ${schools.length} schools.`);
assert(schools.length >= 3500, 'Expected at least 3500 schools in SQLite DB');

const sampleSchool = schools[0];
const fetchedById = db.getSchoolById(sampleSchool.id);
assert.strictEqual(fetchedById.id, sampleSchool.id, 'getSchoolById should return correct school');
assert.strictEqual(fetchedById.name, sampleSchool.name, 'School name should match');
console.log(`✓ Fetched sample school by ID: "${sampleSchool.name}" (${sampleSchool.id})`);

// 2. Users
const users = db.getAllUsers();
console.log(`✓ Database contains ${users.length} users.`);
assert(users.length >= 4, 'Expected at least 4 users in SQLite DB');

const adminUser = db.getUserByEmail('admin@edulondon.sch.uk');
assert(adminUser, 'Admin user should be retrievable by email');
assert.strictEqual(adminUser.role, 'admin', 'Admin user role should be admin');
console.log(`✓ Fetched user by email: ${adminUser.email} (${adminUser.name})`);

// 3. Portfolios
const portfolios = db.getAllPortfolios();
const portfolioKeys = Object.keys(portfolios);
console.log(`✓ Database contains ${portfolioKeys.length} portfolios.`);
assert(portfolioKeys.length >= 5, 'Expected at least 5 user portfolios');

const sarahPortfolio = db.getPortfolioByUserId('parent-sarah');
assert.strictEqual(sarahPortfolio.userId, 'parent-sarah', 'Portfolio userId match');
console.log(`✓ Fetched portfolio for parent-sarah (${sarahPortfolio.selectedSchools.length} selected schools)`);

// 4. Reviewed Pairs
const pairs = db.getAllReviewedPairs();
console.log(`✓ Database contains ${pairs.length} reviewed duplicate pairs.`);
assert(pairs.length >= 3, 'Expected at least 3 reviewed pairs');

// 5. Recommendation Settings
const recSettings = db.getRecSettings();
console.log(`✓ Fetched recommendation settings:`, recSettings);
assert(recSettings.weights, 'Recommendation settings should contain weights');

console.log('\n✅ ALL DATABASE TESTS PASSED SUCCESSFULLY!');
