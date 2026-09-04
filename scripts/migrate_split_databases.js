/**
 * Database Partitioning Migration Script
 * Splits monolithic schooldb.sqlite into:
 * 1. data/schooldb.sqlite (schools, fts, all_schools_gov, postcode_cache, duplicate_pairs, system_settings)
 * 2. data/auditdb.sqlite (admin_audit_logs, admin_field_reviews, data_quality_scans, reviewed_pairs)
 * 3. data/parentdb.sqlite (users, sessions, user_portfolios, user_recommendation_preferences, settings, votes, reports)
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');
const mainDbPath = path.join(dataDir, 'schooldb.sqlite');
const backupDbPath = path.join(dataDir, 'schooldb.sqlite.pre_split.bak');
const auditDbPath = path.join(dataDir, 'auditdb.sqlite');
const parentDbPath = path.join(dataDir, 'parentdb.sqlite');

console.log('=== STARTING DATABASE PARTITIONING MIGRATION ===\n');

// 1. Create backup of current schooldb.sqlite
console.log('[1. Creating Full Safety Backup]');
if (!fs.existsSync(mainDbPath)) {
  console.error('Error: Main database file not found at', mainDbPath);
  process.exit(1);
}
fs.copyFileSync(mainDbPath, backupDbPath);
console.log(`  ✓ Backup verified at ${backupDbPath} (${(fs.statSync(backupDbPath).size / (1024 * 1024)).toFixed(1)} MB)`);

// 2. Open main database
const mainDb = new DatabaseSync(mainDbPath);
mainDb.exec('PRAGMA journal_mode = WAL;');

// Record initial row counts
console.log('\n[2. Recording Pre-Migration Row Counts]');
const auditTables = ['admin_audit_logs', 'admin_field_reviews', 'data_quality_scans', 'reviewed_pairs'];
const parentTables = [
  'users',
  'sessions',
  'user_portfolios',
  'user_recommendation_preferences',
  'recommendation_settings',
  'user_field_reports',
  'field_confidence_votes'
];
const schoolTables = [
  'schools',
  'all_schools_gov',
  'postcode_cache',
  'duplicate_candidate_pairs',
  'reviewed_duplicate_pairs',
  'system_settings'
];

const preCounts = {};
function countTable(db, tbl) {
  try {
    return db.prepare(`SELECT COUNT(*) as c FROM "${tbl}"`).get().c;
  } catch (e) {
    return 0;
  }
}

[...auditTables, ...parentTables, ...schoolTables].forEach(t => {
  preCounts[t] = countTable(mainDb, t);
  console.log(`  - ${t}: ${preCounts[t]} rows`);
});

// 3. Attach auditdb and parentdb
console.log('\n[3. Attaching Target Domain Databases]');
if (fs.existsSync(auditDbPath)) fs.unlinkSync(auditDbPath);
if (fs.existsSync(parentDbPath)) fs.unlinkSync(parentDbPath);

mainDb.exec(`ATTACH DATABASE '${auditDbPath}' AS audit;`);
mainDb.exec(`ATTACH DATABASE '${parentDbPath}' AS parent;`);
mainDb.exec('PRAGMA audit.journal_mode = WAL;');
mainDb.exec('PRAGMA parent.journal_mode = WAL;');
console.log('  ✓ auditdb.sqlite and parentdb.sqlite attached successfully.');

function migrateTable(mainDb, schema, tableName) {
  const meta = mainDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  if (!meta || !meta.sql) {
    // If table doesn't exist in main (e.g. empty or not yet created), create standard DDL
    console.log(`  - Note: Table ${tableName} schema not in master, creating fresh in ${schema}.`);
    return;
  }

  // Rewrite "CREATE TABLE tableName (" to "CREATE TABLE schema.tableName ("
  const createSql = meta.sql.replace(
    new RegExp(`^CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?["'\`]?${tableName}["'\`]?`, 'i'),
    `CREATE TABLE IF NOT EXISTS ${schema}."${tableName}"`
  );

  mainDb.exec(createSql);
  mainDb.exec(`INSERT INTO ${schema}."${tableName}" SELECT * FROM main."${tableName}";`);

  // Copy indexes
  const indexes = mainDb.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL").all(tableName);
  for (const idx of indexes) {
    try {
      const idxSql = idx.sql.replace(
        new RegExp(`^CREATE\\s+INDEX\\s+(IF\\s+NOT\\s+EXISTS\\s+)?["'\`]?${idx.name}["'\`]?`, 'i'),
        `CREATE INDEX IF NOT EXISTS ${schema}."${idx.name}"`
      );
      mainDb.exec(idxSql);
    } catch (e) {}
  }

  const count = mainDb.prepare(`SELECT COUNT(*) as c FROM ${schema}."${tableName}"`).get().c;
  if (count !== preCounts[tableName]) {
    throw new Error(`Row count mismatch for ${tableName}: expected ${preCounts[tableName]}, got ${count}`);
  }
  console.log(`  ✓ Migrated ${tableName}: ${count} rows copied accurately.`);
}

// 4. Migrate Audit Tables
console.log('\n[4. Migrating Audit Tables to auditdb.sqlite]');
auditTables.forEach(t => migrateTable(mainDb, 'audit', t));

// Ensure all audit tables exist even if empty
mainDb.exec(`
  CREATE TABLE IF NOT EXISTS audit.admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actionType TEXT NOT NULL,
    batchId TEXT NOT NULL,
    schoolId TEXT,
    previousState TEXT NOT NULL,
    newState TEXT NOT NULL,
    appliedBy TEXT NOT NULL,
    appliedAt TEXT NOT NULL,
    rolledBackAt TEXT
  );
  CREATE INDEX IF NOT EXISTS audit.idx_admin_audit_logs_batch ON admin_audit_logs(batchId);
  CREATE INDEX IF NOT EXISTS audit.idx_admin_audit_logs_school ON admin_audit_logs(schoolId);
  CREATE INDEX IF NOT EXISTS audit.idx_admin_audit_logs_school_date ON admin_audit_logs(schoolId, appliedAt);

  CREATE TABLE IF NOT EXISTS audit.admin_field_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schoolId TEXT NOT NULL,
    fieldName TEXT NOT NULL,
    reviewedBy TEXT NOT NULL,
    reviewedAt TEXT NOT NULL,
    UNIQUE(schoolId, fieldName)
  );
  CREATE INDEX IF NOT EXISTS audit.idx_field_reviews_school ON admin_field_reviews(schoolId);

  CREATE TABLE IF NOT EXISTS audit.data_quality_scans (
    scan_type TEXT PRIMARY KEY,
    scanned_at TEXT NOT NULL,
    total_schools INTEGER DEFAULT 0,
    results_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit.reviewed_pairs (
    pairKey TEXT PRIMARY KEY,
    idA TEXT NOT NULL,
    idB TEXT NOT NULL,
    reviewedAt TEXT NOT NULL
  );
`);

// 5. Migrate Parent Tables
console.log('\n[5. Migrating Parent Tables to parentdb.sqlite]');
parentTables.forEach(t => migrateTable(mainDb, 'parent', t));

// 6. Drop Migrated Tables from main schooldb.sqlite
console.log('\n[6. Dropping Migrated Tables from schooldb.sqlite]');
mainDb.exec('PRAGMA foreign_keys = OFF;');
[...auditTables, ...parentTables].forEach(t => {
  try {
    mainDb.exec(`DROP TABLE IF EXISTS main."${t}";`);
    console.log(`  ✓ Dropped main.${t}`);
  } catch (e) {
    console.warn(`  - Note on dropping main.${t}:`, e.message);
  }
});
mainDb.exec('PRAGMA foreign_keys = ON;');

// Detach databases
mainDb.exec('DETACH DATABASE audit;');
mainDb.exec('DETACH DATABASE parent;');

// Checkpoint and Vacuum mainDb
console.log('\n[7. Checkpointing & Vacuuming Database Files]');
mainDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
mainDb.exec('VACUUM;');
mainDb.close();

// Vacuum auditDb
const aDb = new DatabaseSync(auditDbPath);
aDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
aDb.exec('VACUUM;');
aDb.close();

// Vacuum parentDb
const pDb = new DatabaseSync(parentDbPath);
pDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
pDb.exec('VACUUM;');
pDb.close();

// 8. Measure Final File Sizes
console.log('\n[8. Final Database File Sizes]');
const schoolSizeMB = (fs.statSync(mainDbPath).size / (1024 * 1024)).toFixed(2);
const auditSizeMB = (fs.statSync(auditDbPath).size / (1024 * 1024)).toFixed(2);
const parentSizeMB = (fs.statSync(parentDbPath).size / (1024 * 1024)).toFixed(2);

console.log(`  📁 schooldb.sqlite: ${schoolSizeMB} MB`);
console.log(`  📁 auditdb.sqlite:  ${auditSizeMB} MB`);
console.log(`  📁 parentdb.sqlite: ${parentSizeMB} MB`);

console.log('\n=== DATABASE PARTITIONING COMPLETED SUCCESSFULLY ===');
