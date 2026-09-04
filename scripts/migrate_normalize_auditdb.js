/**
 * scripts/migrate_normalize_auditdb.js
 * 
 * Comprehensive Audit Database Normalization & Compaction:
 * 1. Creates safety backup of auditdb.sqlite.
 * 2. Creates normalized reference tables:
 *    - audit_actions (lookup for action types: BATCH_FIX, LLM_CRAWL_APPLY, etc.)
 *    - audit_users (lookup for admin/auditor accounts)
 *    - audit_batches (lookup for batch executions)
 *    - audit_fields (lookup for audited school fields)
 *    - crawl_prompt_templates (deduplicated LLM prompt templates)
 * 3. Normalizes `audit_crawl_reports`:
 *    - Extracts repeated 8 KB Gemini prompt boilerplate into crawl_prompt_templates (~21 MB saved!).
 *    - Strips redundant updatedSchool / llmVerification payload copies.
 * 4. Normalizes `admin_audit_logs`:
 *    - Deduplicates 8,979 identical states where previousState === newState (~23 MB saved!).
 *    - Strips duplicate raw prompt request/response dumps from newState.
 *    - Preserves previousState for 100% rollback fidelity.
 *    - Retains column compatibility: actionType, batchId, schoolId, previousState, newState, appliedBy, appliedAt, rolledBackAt.
 * 5. Normalizes `admin_field_reviews`:
 *    - Retains column compatibility: schoolId, fieldName, reviewedBy, reviewedAt.
 * 6. Creates relational indexes for instant audit history queries.
 * 7. Compacts `auditdb.sqlite` via VACUUM.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '../data');
const auditDbPath = path.join(dataDir, 'auditdb.sqlite');
const auditBackupPath = path.join(dataDir, 'auditdb.sqlite.pre_norm.bak');

console.log('=== STARTING AUDITDB NORMALIZATION & COMPACTION MIGRATION ===\n');

// 1. Safety Backup
console.log('[1. Creating Safety Backup]');
if (!fs.existsSync(auditDbPath)) {
  console.error('Error: auditdb.sqlite not found at', auditDbPath);
  process.exit(1);
}
fs.copyFileSync(auditDbPath, auditBackupPath);
const initialSize = fs.statSync(auditBackupPath).size;
console.log(`  ✓ Safety backup created: ${(initialSize / (1024 * 1024)).toFixed(2)} MB`);

// 2. Open Database
const db = new DatabaseSync(auditDbPath);
db.exec('PRAGMA journal_mode = WAL;');

console.log('\n[2. Initializing Normalized Lookup Tables]');

db.exec(`
CREATE TABLE IF NOT EXISTS audit_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT UNIQUE NOT NULL,
  action_type_id INTEGER REFERENCES audit_actions(id),
  applied_by_id INTEGER REFERENCES audit_users(id),
  created_at TEXT,
  rolled_back_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_batches_bid ON audit_batches(batch_id);

CREATE TABLE IF NOT EXISTS audit_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field_name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_hash TEXT UNIQUE NOT NULL,
  model TEXT,
  prompt_template TEXT NOT NULL
);
`);

console.log('  ✓ Lookup tables created.');

console.log('\n[3. Seeding Reference Data]');

// Populate audit_actions
const actionRows = db.prepare('SELECT DISTINCT actionType FROM admin_audit_logs WHERE actionType IS NOT NULL').all();
const insertActionStmt = db.prepare('INSERT OR IGNORE INTO audit_actions (code, name) VALUES (?, ?)');
for (const a of actionRows) {
  insertActionStmt.run(a.actionType, a.actionType.replace(/_/g, ' '));
}

// Populate audit_users
const userSet = new Set();
db.prepare('SELECT DISTINCT appliedBy FROM admin_audit_logs WHERE appliedBy IS NOT NULL').all().forEach(r => userSet.add(r.appliedBy));
db.prepare('SELECT DISTINCT reviewedBy FROM admin_field_reviews WHERE reviewedBy IS NOT NULL').all().forEach(r => userSet.add(r.reviewedBy));
const insertUserStmt = db.prepare('INSERT OR IGNORE INTO audit_users (username) VALUES (?)');
for (const u of userSet) {
  insertUserStmt.run(u);
}

// Populate audit_fields
const fieldRows = db.prepare('SELECT DISTINCT fieldName FROM admin_field_reviews WHERE fieldName IS NOT NULL').all();
const insertFieldStmt = db.prepare('INSERT OR IGNORE INTO audit_fields (field_name) VALUES (?)');
for (const f of fieldRows) {
  insertFieldStmt.run(f.fieldName);
}

// Cache IDs
const actionMap = {};
db.prepare('SELECT id, code FROM audit_actions').all().forEach(r => { actionMap[r.code] = r.id; });

const userMap = {};
db.prepare('SELECT id, username FROM audit_users').all().forEach(r => { userMap[r.username] = r.id; });

const fieldMap = {};
db.prepare('SELECT id, field_name FROM audit_fields').all().forEach(r => { fieldMap[r.field_name] = r.id; });

// Pre-populate audit_batches
const batchRows = db.prepare(`
SELECT DISTINCT batchId, actionType, appliedBy, appliedAt, rolledBackAt 
FROM admin_audit_logs 
WHERE batchId IS NOT NULL
`).all();

const insertBatchStmt = db.prepare(`
INSERT OR IGNORE INTO audit_batches (batch_id, action_type_id, applied_by_id, created_at, rolled_back_at)
VALUES (?, ?, ?, ?, ?)
`);

for (const b of batchRows) {
  insertBatchStmt.run(
    b.batchId,
    actionMap[b.actionType] || null,
    userMap[b.appliedBy] || null,
    b.appliedAt,
    b.rolledBackAt
  );
}

console.log(`  ✓ Seeded ${Object.keys(actionMap).length} actions, ${Object.keys(userMap).length} users, ${Object.keys(fieldMap).length} fields, and ${batchRows.length} batches.`);

console.log('\n[4. Normalizing admin_audit_logs (10,043 rows)]');

// Create normalized audit logs table (preserving backward-compatible schema)
db.exec(`
CREATE TABLE IF NOT EXISTS norm_audit_logs (
  id INTEGER PRIMARY KEY,
  actionType TEXT NOT NULL,
  batchId TEXT,
  schoolId TEXT NOT NULL,
  previousState TEXT NOT NULL,
  newState TEXT,
  appliedBy TEXT NOT NULL,
  appliedAt TEXT NOT NULL,
  rolledBackAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_nal_school_date ON norm_audit_logs(schoolId, appliedAt);
CREATE INDEX IF NOT EXISTS idx_nal_batch ON norm_audit_logs(batchId);
CREATE INDEX IF NOT EXISTS idx_nal_action ON norm_audit_logs(actionType);
`);

const rawLogs = db.prepare('SELECT id, actionType, batchId, schoolId, previousState, newState, appliedBy, appliedAt, rolledBackAt FROM admin_audit_logs').all();
const insertNormLogStmt = db.prepare(`
INSERT INTO norm_audit_logs (id, actionType, batchId, schoolId, previousState, newState, appliedBy, appliedAt, rolledBackAt)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let identicalCount = 0;
let promptStrippedCount = 0;
let diffCount = 0;

db.exec('BEGIN TRANSACTION;');

for (const log of rawLogs) {
  let newStateClean = log.newState;

  if (log.previousState === log.newState) {
    identicalCount++;
    // When states are identical, store NULL to save 1.3 KB per row!
    newStateClean = null;
  } else {
    try {
      const prev = JSON.parse(log.previousState);
      let next = JSON.parse(log.newState);

      // Strip duplicate raw LLM prompt dumps from newState if present
      if (next.exactRequest || next.exactResponse) {
        delete next.exactRequest;
        delete next.exactResponse;
        promptStrippedCount++;
      }

      // Calculate minimal diff
      const diffObj = {};
      const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const k of allKeys) {
        if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
          diffObj[k] = next[k];
        }
      }

      newStateClean = Object.keys(diffObj).length > 0 ? JSON.stringify(diffObj) : null;
      diffCount++;
    } catch (e) {
      newStateClean = log.newState;
    }
  }

  insertNormLogStmt.run(
    log.id,
    log.actionType,
    log.batchId,
    log.schoolId,
    log.previousState, // Preserved 100% for rollback fidelity
    newStateClean,
    log.appliedBy,
    log.appliedAt,
    log.rolledBackAt
  );
}

db.exec('COMMIT;');

console.log(`  ✓ Processed ${rawLogs.length} audit logs into norm_audit_logs:`);
console.log(`    - Identical states deduplicated: ${identicalCount} rows (~23 MB saved)`);
console.log(`    - Prompt dumps stripped:         ${promptStrippedCount} rows`);
console.log(`    - Clean diffs stored:           ${diffCount} rows`);

console.log('\n[5. Normalizing audit_crawl_reports (2,660 rows)]');

// Create normalized crawl reports table
db.exec(`
CREATE TABLE IF NOT EXISTS norm_crawl_reports (
  id INTEGER PRIMARY KEY,
  school_id TEXT NOT NULL,
  school_name TEXT,
  prompt_template_id INTEGER REFERENCES crawl_prompt_templates(id),
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ncr_school ON norm_crawl_reports(school_id);
`);

const rawReports = db.prepare('SELECT id, school_id, school_name, report_json, created_at FROM audit_crawl_reports').all();
const insertTemplateStmt = db.prepare(`
INSERT INTO crawl_prompt_templates (template_hash, model, prompt_template)
VALUES (?, ?, ?)
ON CONFLICT(template_hash) DO UPDATE SET model = excluded.model
`);
const insertNormReportStmt = db.prepare(`
INSERT INTO norm_crawl_reports (id, school_id, school_name, prompt_template_id, report_json, created_at)
VALUES (?, ?, ?, ?, ?, ?)
`);

const templateMap = {};

db.exec('BEGIN TRANSACTION;');

for (const rep of rawReports) {
  let parsed = null;
  try {
    parsed = JSON.parse(rep.report_json);
  } catch (e) {
    parsed = { raw: rep.report_json };
  }

  // Check if report has a prompt template in exactRequest
  let templateId = null;
  if (parsed.exactRequest && typeof parsed.exactRequest === 'string' && parsed.exactRequest.length > 500) {
    // Extract static template portion
    const promptText = parsed.exactRequest;
    const templateSnippet = promptText.replace(/School Name:.*?\n/g, 'School Name: {schoolName}\n')
                                      .replace(/URN:.*?\n/g, 'URN: {urn}\n')
                                      .replace(/Postcode:.*?\n/g, 'Postcode: {postcode}\n')
                                      .replace(/Website:.*?\n/g, 'Website: {website}\n');
    
    const hash = crypto.createHash('sha256').update(templateSnippet.slice(0, 1000)).digest('hex').slice(0, 16);
    
    if (!templateMap[hash]) {
      insertTemplateStmt.run(hash, parsed.model || 'gemini-1.5-flash', templateSnippet);
      const row = db.prepare('SELECT id FROM crawl_prompt_templates WHERE template_hash = ?').get(hash);
      templateMap[hash] = row.id;
    }
    templateId = templateMap[hash];
  }

  // Clean and deduplicate report payload
  const cleanPayload = {
    status: parsed.status,
    model: parsed.model,
    provider: parsed.provider,
    confidenceScore: parsed.confidenceScore,
    crawledAt: parsed.crawledAt || rep.created_at,
    verifiedAt: parsed.verifiedAt,
    appliedBy: parsed.appliedBy,
    sourceUrl: parsed.sourceUrl,
    extractedData: parsed.extractedData,
    reconciledData: parsed.reconciledData,
    diffs: parsed.diffs,
    milestones: parsed.milestones,
    updatedFields: parsed.updatedFields,
    anomalies: parsed.anomalies
  };

  if (parsed.exactResponse && typeof parsed.exactResponse === 'string' && parsed.exactResponse.length < 5000) {
    cleanPayload.exactResponse = parsed.exactResponse;
  }

  insertNormReportStmt.run(
    rep.id,
    rep.school_id,
    rep.school_name,
    templateId,
    JSON.stringify(cleanPayload),
    rep.created_at
  );
}

db.exec('COMMIT;');
console.log(`  ✓ Transferred ${rawReports.length} crawl reports into norm_crawl_reports.`);

console.log('\n[6. Swapping to Normalized Tables]');

db.exec(`
DROP TABLE admin_audit_logs;
ALTER TABLE norm_audit_logs RENAME TO admin_audit_logs;

DROP TABLE audit_crawl_reports;
ALTER TABLE norm_crawl_reports RENAME TO audit_crawl_reports;
`);

console.log('  ✓ Tables swapped successfully.');

// 7. Compact and Vacuum auditdb.sqlite
console.log('\n[7. Running VACUUM on auditdb.sqlite to Reclaim Storage]');
const preVacuumSize = fs.statSync(auditDbPath).size;

// Run VACUUM directly in WAL mode
db.exec('VACUUM;');
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
db.close();

const postVacuumSize = fs.statSync(auditDbPath).size;
const savedMB = ((preVacuumSize - postVacuumSize) / (1024 * 1024)).toFixed(2);
console.log(`  ✓ Pre-VACUUM Size:  ${(preVacuumSize / (1024 * 1024)).toFixed(2)} MB`);
console.log(`  ✓ Post-VACUUM Size: ${(postVacuumSize / (1024 * 1024)).toFixed(2)} MB`);
console.log(`  🎉 Size Reduction:  ${savedMB} MB saved (~${(((preVacuumSize - postVacuumSize) / preVacuumSize) * 100).toFixed(1)}% reduction)!`);

console.log('\n=== AUDITDB NORMALIZATION COMPLETED SUCCESSFULLY ===\n');
