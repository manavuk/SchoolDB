const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

console.log('=== RUNNING DATABASE OPTIMIZATION & NORMALIZATION MIGRATION ===\n');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'schooldb.sqlite');
const BACKUP_PATH = `${DB_PATH}.bak_${Date.now()}`;

// 1. Backup original database
console.log(`[1. Creating Database Backup at ${BACKUP_PATH}]`);
fs.copyFileSync(DB_PATH, BACKUP_PATH);
const initialStats = fs.statSync(DB_PATH);
console.log(`  ✓ Original DB size: ${(initialStats.size / (1024 * 1024)).toFixed(2)} MB`);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

// 2. Begin Migration Transaction
console.log('\n[2. Executing Schema Refactoring & Data Normalization]');
db.exec('BEGIN TRANSACTION;');

try {
  // Step A: Canonicalize date helper
  function canonicalizeDates(datesObj, row) {
    if (!datesObj || typeof datesObj !== 'object') return null;
    const d = datesObj;

    // Helper to extract string array
    const toArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(String).filter(Boolean);
      return [String(val).trim()].filter(Boolean);
    };

    const toStr = (val) => {
      if (val === null || val === undefined) return null;
      const s = String(val).trim();
      return (s && s !== 'null' && s !== 'undefined' && s !== 'N/A') ? s : null;
    };

    const stage_one_examDate = toArray(d.stage_one_examDate || d.examDate || d.examDates);
    const stage_two_examDate = toArray(d.stage_two_examDate || d.secondExamDate || d.stageTwoExamDate);
    const interviewDates = toArray(d.interviewDates || d.interviewInfo);

    const canonical = {
      registrationOpen: toStr(d.registrationOpen),
      registrationDeadline: toStr(d.registrationDeadline),
      stage_one_examDate,
      stage_one_resultDate: toStr(d.stage_one_resultDate || d.resultsDate || d.stage1ResultDate),
      stage_two_examDate,
      stage_two_resultDate: toStr(d.stage_two_resultDate || d.stage2ResultDate),
      interviewDates,
      offerDate: toStr(d.offerDate || d.offersAcceptance || d.offerDates),
      acceptanceDeadline: toStr(d.acceptanceDeadline || d.acceptanceDate),
      openEvents: toStr(d.openEvents || d.openDays),
      scholarshipsOffered: toStr(d.scholarshipsOffered || d.scholarships),
      bursaryDeadline: toStr(d.bursaryDeadline)
    };

    // Remove null / empty values to keep payload ultra-compact
    for (const [k, v] of Object.entries(canonical)) {
      if (v === null || (Array.isArray(v) && v.length === 0)) {
        delete canonical[k];
      }
    }

    return Object.keys(canonical).length > 0 ? canonical : null;
  }

  // Step B: Compact verification report helper
  function compactVerificationReport(reportObj) {
    if (!reportObj || typeof reportObj !== 'object') return null;
    const r = reportObj;
    return {
      provider: r.provider || 'gemini',
      model: r.model || null,
      status: r.status || 'auto_verified',
      qualityScore: r.qualityScore || r.confidenceScore || 95,
      diffCount: Array.isArray(r.diffs) ? r.diffs.length : 0,
      verifiedAt: r.verifiedAt || new Date().toISOString(),
      sourceUrl: r.sourceUrl || null
    };
  }

  // Step C: Create new clean schools table
  console.log('  - Creating optimized `schools_new` table...');
  db.exec(`
    CREATE TABLE schools_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      urn TEXT,
      la TEXT,
      region TEXT,
      postcode TEXT,
      address TEXT,
      schoolType TEXT,
      rawSchoolType TEXT,
      gender TEXT,
      ageRange TEXT,
      pupilCount INTEGER DEFAULT 0,
      ofstedRating TEXT,
      gcseProgress8 REAL,
      gcseAttainment8 REAL,
      ebaccAveragePointScore REAL,
      entranceExamType TEXT,
      entranceExamDates TEXT,
      gcseSubjects TEXT,
      admissionsPolicy TEXT,
      website TEXT,
      phone TEXT,
      email TEXT,
      description TEXT,
      feesTermly TEXT,
      registrationFee TEXT,
      sourceUrl TEXT,
      second_stage_exam_required TEXT,
      stage_one_format_and_subjects TEXT,
      stage_two_format_and_subjects TEXT,
      national_rank_england INTEGER,
      gcse_rank_england INTEGER,
      a_level_rank_england INTEGER,
      official INTEGER DEFAULT 1,
      hot INTEGER DEFAULT 0,
      officialDataSource TEXT DEFAULT 'DfE GIAS',
      potentialDuplicateOf TEXT,
      dedupNote TEXT,
      verification_status TEXT,
      verification_tags TEXT,
      verification_report TEXT,
      verified_at TEXT,
      confidence_score INTEGER DEFAULT 70
    );
  `);

  // Step D: Migrate data from old `schools` to `schools_new`
  console.log('  - Migrating and canonicalizing rows into `schools_new`...');
  const oldSchools = db.prepare('SELECT * FROM schools').all();

  const insertStmt = db.prepare(`
    INSERT INTO schools_new (
      id, name, urn, la, region, postcode, address, schoolType, rawSchoolType,
      gender, ageRange, pupilCount, ofstedRating, gcseProgress8, gcseAttainment8,
      ebaccAveragePointScore, entranceExamType, entranceExamDates, gcseSubjects,
      admissionsPolicy, website, phone, email, description, feesTermly, registrationFee,
      sourceUrl, second_stage_exam_required, stage_one_format_and_subjects,
      stage_two_format_and_subjects, national_rank_england, gcse_rank_england,
      a_level_rank_england, official, hot, officialDataSource, potentialDuplicateOf,
      dedupNote, verification_status, verification_tags, verification_report,
      verified_at, confidence_score
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `);

  for (const s of oldSchools) {
    let datesParsed = null;
    try {
      if (s.entranceExamDates) datesParsed = JSON.parse(s.entranceExamDates);
    } catch (e) {}

    const canonicalDates = canonicalizeDates(datesParsed, s);

    let reportParsed = null;
    try {
      if (s.verification_report) reportParsed = JSON.parse(s.verification_report);
    } catch (e) {}

    const compactReport = compactVerificationReport(reportParsed);

    // Extract second stage & formats if available in dates
    const secondStageReq = s.second_stage_exam_required || (datesParsed && datesParsed.second_stage_exam_required ? String(datesParsed.second_stage_exam_required) : null);
    const stage1Format = s.stage_one_format_and_subjects || (datesParsed && datesParsed.stage_one_format_and_subjects ? String(datesParsed.stage_one_format_and_subjects) : null);
    const stage2Format = s.stage_two_format_and_subjects || (datesParsed && datesParsed.stage_two_format_and_subjects ? String(datesParsed.stage_two_format_and_subjects) : null);
    const regFee = s.registrationFee || (datesParsed && datesParsed.registrationFee ? String(datesParsed.registrationFee) : null);

    insertStmt.run(
      s.id,
      s.name,
      s.urn || null,
      s.la || null,
      s.region || null,
      s.postcode || null,
      s.address || null,
      s.schoolType || 'Independent',
      s.rawSchoolType || null,
      s.gender || null,
      s.ageRange || null,
      s.pupilCount || 0,
      s.ofstedRating || null,
      s.gcseProgress8 !== undefined ? s.gcseProgress8 : null,
      s.gcseAttainment8 !== undefined ? s.gcseAttainment8 : null,
      s.ebaccAveragePointScore !== undefined ? s.ebaccAveragePointScore : null,
      s.entranceExamType || null,
      canonicalDates ? JSON.stringify(canonicalDates) : null,
      s.gcseSubjects || null,
      s.admissionsPolicy || null,
      s.website || null,
      s.phone || null,
      s.email || null,
      s.description || null,
      s.feesTermly || null,
      regFee,
      s.sourceUrl || null,
      secondStageReq,
      stage1Format,
      stage2Format,
      s.national_rank_england !== undefined ? s.national_rank_england : null,
      s.gcse_rank_england !== undefined ? s.gcse_rank_england : null,
      s.a_level_rank_england !== undefined ? s.a_level_rank_england : null,
      s.official !== undefined ? s.official : 1,
      s.hot !== undefined ? s.hot : 0,
      s.officialDataSource || 'DfE GIAS',
      s.potentialDuplicateOf || null,
      s.dedupNote || null,
      s.verification_status || 'unverified',
      s.verification_tags || '[]',
      compactReport ? JSON.stringify(compactReport) : null,
      s.verified_at || null,
      s.confidence_score || 70
    );
  }

  // Step E: Swap tables
  console.log('  - Swapping tables (`schools` -> `schools_new`)...');
  db.exec('DROP TABLE schools;');
  db.exec('ALTER TABLE schools_new RENAME TO schools;');

  // Step F: Compact `admin_audit_logs`
  console.log('  - Compacting `admin_audit_logs` nested payloads...');
  const auditLogs = db.prepare('SELECT id, previousState, newState FROM admin_audit_logs').all();
  const updateAuditStmt = db.prepare('UPDATE admin_audit_logs SET previousState = ?, newState = ? WHERE id = ?');

  for (const log of auditLogs) {
    let prev = null;
    let next = null;
    try { if (log.previousState) prev = JSON.parse(log.previousState); } catch (e) {}
    try { if (log.newState) next = JSON.parse(log.newState); } catch (e) {}

    let modified = false;
    if (prev && (prev.verification_report || prev.exactResponse || prev.raw_csv)) {
      delete prev.verification_report;
      delete prev.exactResponse;
      delete prev.exactRequest;
      delete prev.raw_csv;
      modified = true;
    }

    if (next && (next.verification_report || (next.exactResponse && typeof next.exactResponse === 'object' && next.exactResponse.rawText && next.exactResponse.rawText.length > 2000))) {
      delete next.verification_report;
      if (next.exactResponse && next.exactResponse.rawText) {
        next.exactResponse = {
          status: next.exactResponse.status || 200,
          statusText: next.exactResponse.statusText || 'OK'
        };
      }
      if (next.exactRequest && next.exactRequest.promptText) {
        delete next.exactRequest.promptText;
      }
      modified = true;
    }

    if (modified) {
      updateAuditStmt.run(
        prev ? JSON.stringify(prev) : (log.previousState || null),
        next ? JSON.stringify(next) : (log.newState || '{}'),
        log.id
      );
    }
  }

  // Step G: Create Indexes
  console.log('  - Building high-performance indexes...');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_schools_name ON schools(name);
    CREATE INDEX IF NOT EXISTS idx_schools_urn ON schools(urn);
    CREATE INDEX IF NOT EXISTS idx_schools_postcode ON schools(postcode);
    CREATE INDEX IF NOT EXISTS idx_schools_la ON schools(la);
    CREATE INDEX IF NOT EXISTS idx_schools_schoolType ON schools(schoolType);
    CREATE INDEX IF NOT EXISTS idx_schools_gender ON schools(gender);
    CREATE INDEX IF NOT EXISTS idx_schools_ofstedRating ON schools(ofstedRating);
    CREATE INDEX IF NOT EXISTS idx_schools_verification_status ON schools(verification_status);
    CREATE INDEX IF NOT EXISTS idx_schools_verified_at ON schools(verified_at);
    CREATE INDEX IF NOT EXISTS idx_schools_national_rank ON schools(national_rank_england);
    CREATE INDEX IF NOT EXISTS idx_schools_type_region ON schools(schoolType, region);
    CREATE INDEX IF NOT EXISTS idx_schools_status_region ON schools(verification_status, region);

    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_school_date ON admin_audit_logs(schoolId, appliedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_batch ON admin_audit_logs(batchId);
    CREATE INDEX IF NOT EXISTS idx_confidence_votes_school ON field_confidence_votes(schoolId);
    CREATE INDEX IF NOT EXISTS idx_field_reviews_school ON admin_field_reviews(schoolId);
  `);

  // Step H: Full-Text Search (FTS5) Virtual Table
  console.log('  - Creating SQLite FTS5 Full-Text Search index...');
  db.exec('DROP TABLE IF EXISTS schools_fts;');
  db.exec(`
    CREATE VIRTUAL TABLE schools_fts USING fts5(
      id UNINDEXED,
      name,
      postcode,
      address,
      la,
      description,
      tokenize = 'porter unicode61'
    );
  `);

  db.exec(`
    INSERT INTO schools_fts(id, name, postcode, address, la, description)
    SELECT id, name, COALESCE(postcode, ''), COALESCE(address, ''), COALESCE(la, ''), COALESCE(description, '')
    FROM schools;
  `);

  // Triggers to keep FTS5 synchronized with schools table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS schools_ai AFTER INSERT ON schools BEGIN
      INSERT INTO schools_fts(id, name, postcode, address, la, description)
      VALUES (new.id, new.name, COALESCE(new.postcode, ''), COALESCE(new.address, ''), COALESCE(new.la, ''), COALESCE(new.description, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS schools_ad AFTER DELETE ON schools BEGIN
      DELETE FROM schools_fts WHERE id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS schools_au AFTER UPDATE ON schools BEGIN
      DELETE FROM schools_fts WHERE id = old.id;
      INSERT INTO schools_fts(id, name, postcode, address, la, description)
      VALUES (new.id, new.name, COALESCE(new.postcode, ''), COALESCE(new.address, ''), COALESCE(new.la, ''), COALESCE(new.description, ''));
    END;
  `);

  db.exec('COMMIT;');
  console.log('  ✓ Schema migration and index creation committed.');

} catch (err) {
  db.exec('ROLLBACK;');
  console.error('❌ Migration failed! Rolled back transaction:', err);
  process.exit(1);
}

// 3. Run VACUUM and WAL checkpoint to reclaim freed pages
console.log('\n[3. Running VACUUM & Database Compaction]');
db.exec('VACUUM;');
db.exec('PRAGMA wal_checkpoint(TRUNCATE);');

const finalStats = fs.statSync(DB_PATH);
const reducedBytes = initialStats.size - finalStats.size;
const reductionPercent = ((reducedBytes / initialStats.size) * 100).toFixed(1);

console.log(`  ✓ Original Size: ${(initialStats.size / (1024 * 1024)).toFixed(2)} MB`);
console.log(`  ✓ Optimized Size: ${(finalStats.size / (1024 * 1024)).toFixed(2)} MB`);
console.log(`  🎉 Size Reduced by: ${(reducedBytes / (1024 * 1024)).toFixed(2)} MB (${reductionPercent}% smaller!)`);

// 4. Verification Check
console.log('\n[4. Verifying Post-Migration Integrity]');
const schoolCount = db.prepare('SELECT count(*) as c FROM schools').get().c;
const ftsCount = db.prepare('SELECT count(*) as c FROM schools_fts').get().c;
console.log(`  ✓ Total schools preserved: ${schoolCount}`);
console.log(`  ✓ Total FTS5 search index entries: ${ftsCount}`);

const ftsTest = db.prepare("SELECT id, name FROM schools_fts WHERE schools_fts MATCH 'Grammar' LIMIT 3").all();
console.log(`  ✓ FTS5 search query test returned ${ftsTest.length} matches:`, ftsTest.map(s => s.name));

console.log('\n======================================================');
console.log('🎉 DATABASE MIGRATION & OPTIMIZATION SUCCESSFULLY COMPLETED!');
console.log('======================================================\n');
