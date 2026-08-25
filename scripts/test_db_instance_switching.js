const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('--- Testing Production Database Integrity & Dynamic Instance Switching ---');

// 1. Initial State Check
const initialMeta = db.getDatabaseInstancesMetadata();
console.log('Initial Database Metadata:', {
  activeInstance: initialMeta.activeInstance,
  isProduction: initialMeta.isProduction,
  prodSchools: initialMeta.instances.production.totalSchools,
  testSchools: initialMeta.instances.test.totalSchools
});

assert(initialMeta.instances.production.exists, 'Production database must exist');
assert(initialMeta.instances.production.totalSchools > 6400, 'Production must have full secondary schools directory');
assert(initialMeta.instances.test.exists, 'Test database copy must exist');

// 2. Verify no mock test schools exist in Production
const prodDb = db.getDb();
const mockSchoolsInProd = prodDb.prepare(`
  SELECT id, urn, name 
  FROM schools 
  WHERE name = 'Test Academy' 
     OR name = 'New Test School' 
     OR id = 'sch-804553' 
     OR id = 'sch-054484' 
     OR id LIKE 'sch-test-%'
`).all();

console.log('Mock schools found in Production DB:', mockSchoolsInProd);
assert.strictEqual(mockSchoolsInProd.length, 0, 'Production DB must have ZERO mock/test schools');
console.log('✓ Production database verified clean of mock/test schools.');

// 3. Test Switching to TEST Instance
const switchTestRes = db.setActiveDatabaseInstance('test');
console.log('Switch to Test Result:', switchTestRes);
assert.strictEqual(switchTestRes.activeInstance, 'test', 'Active instance should now be test');
assert.strictEqual(db.isTestInstanceActive(), true, 'isTestInstanceActive() must return true');

const testSchoolId = 'sch-sandbox-exp-' + Date.now();
db.insertSchool({
  id: testSchoolId,
  name: 'Sandbox Experimental Academy',
  schoolType: 'Comprehensive',
  rawSchoolType: 'Free School',
  la: 'London',
  region: 'Greater London',
  postcode: 'SW1A 1AA',
  urn: '777888',
  pupilCount: 850
});

const foundInTest = db.getSchoolById(testSchoolId);
assert(foundInTest, 'Inserted experimental school must exist in test instance');
console.log('✓ Inserted and verified experimental test school in TEST instance:', foundInTest.name);

// 4. Test Switching back to PRODUCTION Instance & Verify Isolation
const switchProdRes = db.setActiveDatabaseInstance('production');
console.log('Switch to Production Result:', switchProdRes);
assert.strictEqual(switchProdRes.activeInstance, 'production', 'Active instance should now be production');
assert.strictEqual(db.isTestInstanceActive(), false, 'isTestInstanceActive() must return false for production');

const foundInProd = db.getSchoolById(testSchoolId);
assert.strictEqual(foundInProd, null, 'Experimental test school must NOT exist in Production DB!');
console.log('✓ Isolation verified: Experimental school does NOT exist in Production database.');

// 5. Test Resetting Test Database from Production Master
const resetRes = db.resetTestDatabaseFromProduction();
console.log('Reset Test DB Result:', resetRes);
assert.strictEqual(resetRes.success, true, 'Reset should succeed');

// Switch to test to verify it was reset
db.setActiveDatabaseInstance('test');
const foundInTestAfterReset = db.getSchoolById(testSchoolId);
assert.strictEqual(foundInTestAfterReset, null, 'Experimental school should be wiped after reset from production master');
console.log('✓ resetTestDatabaseFromProduction cleanly wiped sandbox changes.');

// Always restore active instance to production
db.setActiveDatabaseInstance('production');
assert.strictEqual(db.getActiveDatabaseInstance(), 'production', 'Should be back in production');

// 6. Test Frontend UI & CSS Components
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert(html.includes('id="test-env-banner"'), 'index.html must include test-env-banner');
assert(html.includes('id="db-instance-active-pill"'), 'index.html must include db-instance-active-pill');
assert(html.includes('id="btn-select-prod-db"'), 'index.html must include btn-select-prod-db');
assert(html.includes('id="btn-select-test-db"'), 'index.html must include btn-select-test-db');
assert(html.includes('id="btn-reset-test-db"'), 'index.html must include btn-reset-test-db');
console.log('✓ All DOM UI components verified in index.html.');

const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
assert(css.includes('.env-test-banner'), 'styles.css must include .env-test-banner');
assert(css.includes('.db-env-card'), 'styles.css must include .db-env-card');
assert(css.includes('.badge-env-prod'), 'styles.css must include .badge-env-prod');
assert(css.includes('.badge-env-test'), 'styles.css must include .badge-env-test');
console.log('✓ All CSS classes verified in styles.css.');

const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(js.includes('loadDatabaseInstanceSettings'), 'app.js must include loadDatabaseInstanceSettings');
assert(js.includes('switchDatabaseInstance'), 'app.js must include switchDatabaseInstance');
assert(js.includes('resetTestDbConfirmation'), 'app.js must include resetTestDbConfirmation');
console.log('✓ All controller functions verified in app.js.');

console.log('====================================================');
console.log('🎉 ALL DATABASE INSTANCE & ISOLATION TESTS PASSED!');
console.log('====================================================');
