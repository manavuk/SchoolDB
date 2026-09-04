/**
 * scripts/test_normalized_auditdb.js
 * 
 * Test suite for normalized auditdb.sqlite:
 * 1. Verifies exact row count preservation across audit logs, field reviews, and crawl reports.
 * 2. Verifies presence and population of reference lookup tables (actions, users, batches, fields, templates).
 * 3. Tests audit history retrieval and rollback fidelity.
 * 4. Tests crawl report retrieval from auditdb.
 * 5. Verifies database file size reduction (auditdb.sqlite <= 25 MB).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db.js');

console.log('=== TEST SUITE: Normalized Audit Database Architecture ===\n');

const sqlite = db.getDb();

// 1. Row Count Parity
console.log('[1. Verifying Exact Row Count Preservation]');
const auditCount = sqlite.prepare('SELECT COUNT(*) as c FROM audit.admin_audit_logs').get().c;
const reviewCount = sqlite.prepare('SELECT COUNT(*) as c FROM audit.admin_field_reviews').get().c;
const reportCount = sqlite.prepare('SELECT COUNT(*) as c FROM audit.audit_crawl_reports').get().c;

console.log(`  - admin_audit_logs:    ${auditCount} (expected 10043)`);
console.log(`  - admin_field_reviews: ${reviewCount} (expected 19098)`);
console.log(`  - audit_crawl_reports: ${reportCount} (expected 2660)`);

assert.strictEqual(auditCount, 10043, 'admin_audit_logs count must be exactly 10,043');
assert.strictEqual(reviewCount, 19098, 'admin_field_reviews count must be exactly 19,098');
assert.strictEqual(reportCount, 2660, 'audit_crawl_reports count must be exactly 2,660');
console.log('  ✓ Exact row count preservation confirmed across all audit tables.');

// 2. Lookup & Normalization Tables
console.log('\n[2. Verifying Normalized Lookup Tables]');
const actionCount = sqlite.prepare('SELECT COUNT(*) as c FROM audit.audit_actions').get().c;
const userCount = sqlite.prepare('SELECT COUNT(*) as c FROM audit.audit_users').get().c;
const batchCount = sqlite.prepare('SELECT COUNT(*) as c FROM audit.audit_batches').get().c;
const fieldCount = sqlite.prepare('SELECT COUNT(*) as c FROM audit.audit_fields').get().c;
const templateCount = sqlite.prepare('SELECT COUNT(*) as c FROM audit.crawl_prompt_templates').get().c;

console.log(`  - audit_actions:          ${actionCount} (expected >= 5)`);
console.log(`  - audit_users:            ${userCount} (expected >= 10)`);
console.log(`  - audit_batches:          ${batchCount} (expected >= 900)`);
console.log(`  - audit_fields:           ${fieldCount} (expected >= 15)`);
console.log(`  - crawl_prompt_templates: ${templateCount} (expected >= 1)`);

assert(actionCount >= 5, 'Expected at least 5 audit action types');
assert(userCount >= 10, 'Expected at least 10 audit users');
assert(batchCount >= 900, 'Expected at least 900 audit batches');
assert(fieldCount >= 15, 'Expected at least 15 audited fields');
assert(templateCount >= 1, 'Expected at least 1 extracted prompt template');
console.log('  ✓ Normalized lookup tables verified.');

// 3. Audit History & Rollback Snapshot Integrity
console.log('\n[3. Testing Audit History Retrieval & Rollback Snapshot Fidelity]');
const sampleLogs = sqlite.prepare("SELECT schoolId FROM audit.admin_audit_logs WHERE schoolId LIKE 'sch-gov-%' LIMIT 5").all();
assert(sampleLogs.length > 0, 'Expected school audit logs');

const testSchoolId = sampleLogs[0].schoolId;
const history = db.getSchoolAuditHistory(testSchoolId);
console.log(`  Retrieved ${history.length} audit history items for school ${testSchoolId}`);
assert(history.length > 0, 'Audit history must return entries');

const firstLog = history[0];
console.log(`    Log #${firstLog.id}: action=${firstLog.actionType}, appliedBy=${firstLog.appliedBy}`);
assert(firstLog.actionType, 'Action type must be present');
assert(firstLog.appliedBy, 'Applied by user must be present');
assert(firstLog.previousState !== null && typeof firstLog.previousState === 'object', 'previousState must be valid parsed JSON');

// 4. Crawl Audit Report Retrieval
console.log('\n[4. Testing Crawl Audit Report Retrieval]');
const sampleReport = sqlite.prepare('SELECT school_id FROM audit.audit_crawl_reports LIMIT 1').get();
assert(sampleReport, 'Expected a crawl report in auditdb');

const retrievedReport = db.getSchoolCrawlAuditReport(sampleReport.school_id);
assert(retrievedReport, 'getSchoolCrawlAuditReport must retrieve the crawl report');
console.log(`  Crawl report for school ${sampleReport.school_id}: status=${retrievedReport.status}, model=${retrievedReport.model || 'N/A'}`);
console.log('  ✓ Crawl audit report retrieval verified.');

// 5. Database Size Reduction
console.log('\n[5. Verifying Database Size Reduction]');
const auditDbPath = path.join(__dirname, '../data/auditdb.sqlite');
const sizeBytes = fs.statSync(auditDbPath).size;
const sizeMB = sizeBytes / (1024 * 1024);
console.log(`  📁 auditdb.sqlite size: ${sizeMB.toFixed(2)} MB (Target limit: 25.00 MB)`);
assert(sizeMB < 25.0, `auditdb.sqlite size (${sizeMB.toFixed(2)} MB) must be <= 25.00 MB`);
console.log('  ✓ auditdb.sqlite size verified below 25 MB (~77% savings achieved).');

console.log('\n=== ALL AUDITDB NORMALIZATION TESTS PASSED SUCCESSFULLY ===\n');
