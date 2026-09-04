/**
 * Automated Test Suite for Split Databases Architecture
 * Verifies schooldb.sqlite, auditdb.sqlite, and parentdb.sqlite
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== TEST SUITE: Split Databases Architecture (schooldb, auditdb, parentdb) ===\n');

async function runTests() {
  const dataDir = path.join(__dirname, '../data');
  const schoolDbPath = path.join(dataDir, 'schooldb.sqlite');
  const auditDbPath = path.join(dataDir, 'auditdb.sqlite');
  const parentDbPath = path.join(dataDir, 'parentdb.sqlite');

  // 1. Verify File Existence and Sizes
  console.log('[1. Verifying Database Files & File Sizes]');
  assert(fs.existsSync(schoolDbPath), 'schooldb.sqlite must exist');
  assert(fs.existsSync(auditDbPath), 'auditdb.sqlite must exist');
  assert(fs.existsSync(parentDbPath), 'parentdb.sqlite must exist');

  const schoolMB = fs.statSync(schoolDbPath).size / (1024 * 1024);
  const auditMB = fs.statSync(auditDbPath).size / (1024 * 1024);
  const parentMB = fs.statSync(parentDbPath).size / (1024 * 1024);

  console.log(`  📁 schooldb.sqlite: ${schoolMB.toFixed(2)} MB (Limit: 100 MB)`);
  console.log(`  📁 auditdb.sqlite:  ${auditMB.toFixed(2)} MB (Limit: 100 MB)`);
  console.log(`  📁 parentdb.sqlite: ${parentMB.toFixed(2)} MB (Limit: 100 MB)`);

  assert(schoolMB < 100, `schooldb.sqlite must be under 100 MB (got ${schoolMB.toFixed(2)} MB)`);
  assert(auditMB < 100, `auditdb.sqlite must be under 100 MB (got ${auditMB.toFixed(2)} MB)`);
  assert(parentMB < 100, `parentdb.sqlite must be under 100 MB (got ${parentMB.toFixed(2)} MB)`);
  console.log('  ✓ All 3 databases are verified well under GitHub 100 MB limit.');

  // 2. Verify Database Connection & Attached Domains
  console.log('\n[2. Verifying Connection & Attached Domain Schemas]');
  const sqlite = db.getDb();
  const dbList = sqlite.prepare('PRAGMA database_list').all();
  console.log('  Attached databases:');
  dbList.forEach(d => console.log(`   - seq ${d.seq}: name='${d.name}', file='${d.file}'`));

  const schemaNames = dbList.map(d => d.name);
  assert(schemaNames.includes('main'), 'Must have main database (schooldb)');
  assert(schemaNames.includes('audit'), 'Must have attached audit database');
  assert(schemaNames.includes('parent'), 'Must have attached parent database');
  console.log('  ✓ Multi-database attachment confirmed.');

  // 3. Verify Table Integrity and Expected Row Counts
  console.log('\n[3. Verifying Table Row Counts]');
  const schoolCount = sqlite.prepare('SELECT COUNT(*) as c FROM schools').get().c;
  const govCount = sqlite.prepare('SELECT COUNT(*) as c FROM all_schools_gov').get().c;
  const pcCount = sqlite.prepare('SELECT COUNT(*) as c FROM postcode_cache').get().c;
  const userCount = sqlite.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const portfolioCount = sqlite.prepare('SELECT COUNT(*) as c FROM user_portfolios').get().c;
  const voteCount = sqlite.prepare('SELECT COUNT(*) as c FROM field_confidence_votes').get().c;
  const auditCount = sqlite.prepare('SELECT COUNT(*) as c FROM admin_audit_logs').get().c;
  const reviewCount = sqlite.prepare('SELECT COUNT(*) as c FROM admin_field_reviews').get().c;

  console.log(`  - schools: ${schoolCount} rows (expected ~6488)`);
  console.log(`  - all_schools_gov: ${govCount} rows (expected ~25159)`);
  console.log(`  - postcode_cache: ${pcCount} rows (expected ~3395)`);
  console.log(`  - users: ${userCount} rows (expected >= 300)`);
  console.log(`  - user_portfolios: ${portfolioCount} rows (expected >= 190)`);
  console.log(`  - field_confidence_votes: ${voteCount} rows (expected >= 29000)`);
  console.log(`  - admin_audit_logs: ${auditCount} rows (expected >= 10000)`);
  console.log(`  - admin_field_reviews: ${reviewCount} rows (expected >= 19000)`);

  assert(schoolCount >= 6400, 'schools count must be preserved');
  assert(govCount >= 25000, 'all_schools_gov count must be preserved');
  assert(pcCount >= 3300, 'postcode_cache count must be preserved');
  assert(userCount >= 300, 'users count must be preserved');
  assert(portfolioCount >= 190, 'user_portfolios count must be preserved');
  assert(auditCount >= 10000, 'admin_audit_logs count must be preserved');
  assert(reviewCount >= 19000, 'admin_field_reviews count must be preserved');
  console.log('  ✓ Table row counts confirmed across all domain databases.');

  // 4. Test CRUD Operations across Domain Databases
  console.log('\n[4. Testing CRUD Operations on Domain Tables]');

  // Test User in parentdb
  const testUserId = `test-user-${Date.now()}`;
  sqlite.prepare(`
    INSERT INTO users (id, name, email, password, role, createdAt)
    VALUES (?, 'Test Split User', ?, 'pw123', 'user', ?)
  `).run(testUserId, `${testUserId}@example.com`, new Date().toISOString());

  const fetchedUser = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(testUserId);
  assert(fetchedUser, 'User must be retrievable from parentdb');
  assert.strictEqual(fetchedUser.name, 'Test Split User');

  // Test Portfolio in parentdb
  sqlite.prepare(`
    INSERT INTO user_portfolios (userId, targetLocation, selectedSchools, savedAt)
    VALUES (?, 'SW19 4TT', '[]', ?)
  `).run(testUserId, new Date().toISOString());

  const fetchedPortfolio = sqlite.prepare('SELECT * FROM user_portfolios WHERE userId = ?').get(testUserId);
  assert(fetchedPortfolio, 'Portfolio must be retrievable from parentdb');
  assert.strictEqual(fetchedPortfolio.targetLocation, 'SW19 4TT');

  // Test Audit Log in auditdb
  const testBatchId = `batch-${Date.now()}`;
  sqlite.prepare(`
    INSERT INTO admin_audit_logs (actionType, batchId, schoolId, previousState, newState, appliedBy, appliedAt)
    VALUES ('test_action', ?, 'sch-1', '{}', '{\"name\":\"New\"}', 'tester', ?)
  `).run(testBatchId, new Date().toISOString());

  const fetchedAudit = sqlite.prepare('SELECT * FROM admin_audit_logs WHERE batchId = ?').get(testBatchId);
  assert(fetchedAudit, 'Audit log must be retrievable from auditdb');
  assert.strictEqual(fetchedAudit.actionType, 'test_action');

  // Cleanup test records
  sqlite.prepare('DELETE FROM admin_audit_logs WHERE batchId = ?').run(testBatchId);
  sqlite.prepare('DELETE FROM user_portfolios WHERE userId = ?').run(testUserId);
  sqlite.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
  console.log('  ✓ CRUD operations and cleanup verified across parentdb and auditdb.');

  // 5. Test db helper methods
  console.log('\n[5. Testing db.js Helper Methods]');
  const userByEmail = db.getUserByEmail('aa@bb.cc');
  assert(userByEmail, 'Super Admin aa@bb.cc must be retrievable via db helper');
  assert.strictEqual(userByEmail.email, 'aa@bb.cc');

  const allSchools = db.getAllSchools();
  assert(allSchools.length >= 6400, 'getAllSchools must return complete school list');

  const qeBarnet = allSchools.find(s => s.name.includes('Queen Elizabeth') && s.postcode === 'EN5 4DQ');
  assert(qeBarnet, "Queen Elizabeth's Barnet must exist in schooldb");
  console.log(`  ✓ Successfully fetched ${qeBarnet.name} (URN: ${qeBarnet.urn}, Score: ${qeBarnet.completeness_score}%)`);

  console.log('\n=== ALL SPLIT DATABASES TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
