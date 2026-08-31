const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    envLines.forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/\\n/g, '\n');
        }
        process.env[key] = value.trim().replace(/^["']|["']$/g, '');
      }
    });
  }
} catch (e) {}

const PROD_DB_NAME = 'schooldb.sqlite';
const TEST_DB_NAME = 'schooldb_test.sqlite';
const INSTANCE_CONFIG_FILE = 'active_instance.json';

function getLocalDataDir() {
  const localDataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(localDataDir)) {
    try {
      fs.mkdirSync(localDataDir, { recursive: true });
    } catch (e) {}
  }
  return localDataDir;
}

function getActiveInstanceType() {
  if (process.env.DB_INSTANCE) {
    return process.env.DB_INSTANCE.toLowerCase() === 'test' ? 'test' : 'production';
  }
  const configPath = path.join(getLocalDataDir(), INSTANCE_CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (parsed.activeInstance === 'test') return 'test';
    } catch (e) {}
  }
  return 'production';
}

let currentActiveInstance = getActiveInstanceType();
let currentDbPath = null;

function resolveDatabasePath(instanceType = null) {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }

  const activeType = instanceType || currentActiveInstance;
  const dbFileName = activeType === 'test' ? TEST_DB_NAME : PROD_DB_NAME;

  const isServerless = Boolean(
    process.env.LAMBDA_TASK_ROOT ||
    process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.AWS_EXECUTION_ENV ||
    __dirname.startsWith('/var/task')
  );

  if (isServerless) {
    const tmpDbPath = path.join('/tmp', dbFileName);
    const seedDbPath = path.join(__dirname, 'data', dbFileName);
    const prodSeedPath = path.join(__dirname, 'data', PROD_DB_NAME);

    // Copy initial seed DB from read-only /var/task to writable /tmp if /tmp DB doesn't exist
    try {
      if (!fs.existsSync(tmpDbPath)) {
        if (fs.existsSync(seedDbPath)) {
          fs.copyFileSync(seedDbPath, tmpDbPath);
        } else if (fs.existsSync(prodSeedPath)) {
          fs.copyFileSync(prodSeedPath, tmpDbPath);
        }
      }
    } catch (err) {
      console.warn('Warning: Could not copy seed database to /tmp:', err.message);
    }

    return tmpDbPath;
  }

  const dataDir = getLocalDataDir();
  const prodPath = path.join(dataDir, PROD_DB_NAME);
  const testPath = path.join(dataDir, TEST_DB_NAME);

  // If test instance requested but does not exist, clone from production
  if (activeType === 'test' && !fs.existsSync(testPath)) {
    if (fs.existsSync(prodPath)) {
      try {
        fs.copyFileSync(prodPath, testPath);
      } catch (e) {}
    }
  }

  return path.join(dataDir, dbFileName);
}

let db = null;

function getDb() {
  const targetPath = resolveDatabasePath(currentActiveInstance);
  if (!db || currentDbPath !== targetPath) {
    if (db) {
      try { db.close(); } catch (e) {}
    }
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch (e) {}
    }

    db = new DatabaseSync(targetPath);
    currentDbPath = targetPath;

    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch (e) {
      try { db.exec('PRAGMA journal_mode = DELETE;'); } catch (err) {}
    }

    initTables();
  }
  return db;
}

function getActiveDatabaseInstance() {
  return currentActiveInstance;
}

function isTestInstanceActive() {
  return currentActiveInstance === 'test';
}

function setActiveDatabaseInstance(targetInstance) {
  const normalized = (targetInstance || '').toLowerCase() === 'test' ? 'test' : 'production';
  const dataDir = getLocalDataDir();
  const prodPath = path.join(dataDir, PROD_DB_NAME);
  const testPath = path.join(dataDir, TEST_DB_NAME);

  if (normalized === 'test' && !fs.existsSync(testPath)) {
    if (fs.existsSync(prodPath)) {
      fs.copyFileSync(prodPath, testPath);
    }
  }

  if (db) {
    try { db.close(); } catch (e) {}
    db = null;
    currentDbPath = null;
  }

  currentActiveInstance = normalized;

  // Persist preference
  const configPath = path.join(dataDir, INSTANCE_CONFIG_FILE);
  try {
    fs.writeFileSync(configPath, JSON.stringify({
      activeInstance: normalized,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (e) {}

  const activeDb = getDb();
  const schoolCount = activeDb.prepare('SELECT COUNT(*) as c FROM schools').get().c;

  return {
    success: true,
    activeInstance: normalized,
    dbPath: currentDbPath,
    totalSchools: schoolCount,
    isProduction: normalized === 'production'
  };
}

function resetTestDatabaseFromProduction() {
  const dataDir = getLocalDataDir();
  const prodPath = path.join(dataDir, PROD_DB_NAME);
  const testPath = path.join(dataDir, TEST_DB_NAME);

  if (!fs.existsSync(prodPath)) {
    throw new Error('Production database (schooldb.sqlite) does not exist.');
  }

  const wasTest = currentActiveInstance === 'test';
  if (wasTest && db) {
    try { db.close(); } catch (e) {}
    db = null;
    currentDbPath = null;
  }

  fs.copyFileSync(prodPath, testPath);

  if (wasTest) {
    getDb();
  }

  return {
    success: true,
    message: 'Test database (schooldb_test.sqlite) successfully reset from production master.',
    testDbPath: testPath,
    timestamp: new Date().toISOString()
  };
}

function getDatabaseInstancesMetadata() {
  const dataDir = getLocalDataDir();
  const prodPath = path.join(dataDir, PROD_DB_NAME);
  const testPath = path.join(dataDir, TEST_DB_NAME);

  let prodStats = { exists: fs.existsSync(prodPath), totalSchools: 0, sizeBytes: 0, lastModified: null };
  let testStats = { exists: fs.existsSync(testPath), totalSchools: 0, sizeBytes: 0, lastModified: null };

  if (prodStats.exists) {
    const s = fs.statSync(prodPath);
    prodStats.sizeBytes = s.size;
    prodStats.lastModified = s.mtime;
    try {
      const tempDb = new DatabaseSync(prodPath);
      prodStats.totalSchools = tempDb.prepare('SELECT COUNT(*) as c FROM schools').get().c;
      tempDb.close();
    } catch (e) {}
  }

  if (testStats.exists) {
    const s = fs.statSync(testPath);
    testStats.sizeBytes = s.size;
    testStats.lastModified = s.mtime;
    try {
      const tempDb = new DatabaseSync(testPath);
      testStats.totalSchools = tempDb.prepare('SELECT COUNT(*) as c FROM schools').get().c;
      tempDb.close();
    } catch (e) {}
  }

  return {
    activeInstance: currentActiveInstance,
    isProduction: currentActiveInstance === 'production',
    currentDbPath: currentDbPath || resolveDatabasePath(currentActiveInstance),
    instances: {
      production: prodStats,
      test: testStats
    }
  };
}

function initTables() {
  const sqlite = db;

  // 1. Schools table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schools (
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
      pupilCount INTEGER,
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
      official INTEGER DEFAULT 0,
      hot INTEGER DEFAULT 0,
      officialDataSource TEXT,
      compareSchoolPerformanceUrl TEXT,
      raw_csv TEXT,
      pillaiDetails TEXT,
      kpsDetails TEXT,
      potentialDuplicateOf TEXT,
      dedupNote TEXT,
      feesTermly TEXT,
      sourceUrl TEXT,
      second_stage_exam_required TEXT,
      stage_one_format_and_subjects TEXT,
      stage_two_format_and_subjects TEXT,
      registrationFee TEXT,
      extra_json TEXT
    );
  `);

  // Migration safeguard: add rawSchoolType, verification and new AI intelligence columns if missing
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN rawSchoolType TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN verification_status TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN verification_tags TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN verification_report TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN verified_at TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN confidence_score INTEGER;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN feesTermly TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN registrationFee TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN sourceUrl TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN second_stage_exam_required TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN stage_one_format_and_subjects TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE schools ADD COLUMN stage_two_format_and_subjects TEXT;`); } catch (e) {}

  // Index for fast search, filtering and verification audits
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_schools_name ON schools(name);
    CREATE INDEX IF NOT EXISTS idx_schools_la ON schools(la);
    CREATE INDEX IF NOT EXISTS idx_schools_schoolType ON schools(schoolType);
    CREATE INDEX IF NOT EXISTS idx_schools_gender ON schools(gender);
    CREATE INDEX IF NOT EXISTS idx_schools_ofstedRating ON schools(ofstedRating);
    CREATE INDEX IF NOT EXISTS idx_schools_postcode ON schools(postcode);
    CREATE INDEX IF NOT EXISTS idx_schools_verification_status ON schools(verification_status);
  `);

  // 2. Users table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '["parent:recommendations","parent:portfolio"]',
      createdAt TEXT NOT NULL
    );
  `);
  
  // Migration safeguard: add permissions column if missing from legacy table
  try {
    sqlite.exec(`ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '["parent:recommendations","parent:portfolio"]';`);
  } catch (e) {
    // Column already exists
  }

  // Ensure Super Admin user aa@bb.cc exists with full admin capabilities
  const adminPerms = JSON.stringify(['directory:view', 'admin:portal', 'admin:edit', 'admin:delete', 'parent:recommendations', 'parent:portfolio']);
  try {
    sqlite.prepare(`
      INSERT INTO users (id, name, email, password, permissions, createdAt)
      VALUES ('admin-super', 'Super Admin (aa@bb.cc)', 'aa@bb.cc', 'admin', ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        permissions = excluded.permissions,
        name = 'Super Admin (aa@bb.cc)';
    `).run(adminPerms, new Date().toISOString());
  } catch (e) {
    console.error('Error seeding aa@bb.cc admin user:', e);
  }

  // 3. User Portfolios table (supports Classic Shortlist & Parent Portal 2.0 Dual Track)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_portfolios (
      userId TEXT PRIMARY KEY,
      targetLocation TEXT,
      selectedSchools TEXT,
      removedSchoolIds TEXT,
      cafRankings TEXT,
      independentSchools TEXT,
      parentNotes TEXT,
      savedAt TEXT,
      FOREIGN KEY(userId) REFERENCES users(id)
    );
  `);

  // Migration safeguards: add Parent 2.0 dual-track columns if missing
  try { sqlite.exec(`ALTER TABLE user_portfolios ADD COLUMN cafRankings TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE user_portfolios ADD COLUMN independentSchools TEXT;`); } catch (e) {}
  try { sqlite.exec(`ALTER TABLE user_portfolios ADD COLUMN parentNotes TEXT;`); } catch (e) {}

  // 4. Reviewed Pairs table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS reviewed_pairs (
      pairKey TEXT PRIMARY KEY,
      idA TEXT NOT NULL,
      idB TEXT NOT NULL,
      reviewedAt TEXT NOT NULL
    );
  `);

  // 4b. Persistent Duplicate Candidate Pairs table (Retains detected pairs until manual re-scan)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS duplicate_candidate_pairs (
      pairKey TEXT PRIMARY KEY,
      idA TEXT NOT NULL,
      idB TEXT NOT NULL,
      matchReason TEXT NOT NULL,
      similarityScore REAL NOT NULL,
      smartMergedJson TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      detectedAt TEXT NOT NULL
    );
  `);

  // 5. Recommendation Settings table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS recommendation_settings (
      key TEXT PRIMARY KEY,
      weights TEXT NOT NULL
    );
  `);

  // 5b. System Settings table (Feature flags & Admin configuration)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // 6. Persistent Sessions table (30-day session lifetime)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      userJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );
  `);

  // 7. User Field Ratings & Custom Overrides table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_field_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      schoolId TEXT NOT NULL,
      fieldName TEXT NOT NULL,
      status TEXT NOT NULL,
      originalValue TEXT,
      customValue TEXT,
      reportedAt TEXT NOT NULL,
      UNIQUE(userId, schoolId, fieldName)
    );
  `);

  // 8. User Recommendation Preferences table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_recommendation_preferences (
      userId TEXT PRIMARY KEY,
      targetPostcode TEXT,
      targetBorough TEXT,
      childAbilityLevel TEXT DEFAULT 'NA',
      binaryFiltersJson TEXT NOT NULL,
      qualitativeWeightsJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  // 9. Field Confidence Votes table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS field_confidence_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      schoolId TEXT NOT NULL,
      fieldName TEXT NOT NULL,
      vote INTEGER NOT NULL,
      votedAt TEXT NOT NULL,
      UNIQUE(userId, schoolId, fieldName)
    );
  `);

  // 10. Admin Field Reviews table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS admin_field_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schoolId TEXT NOT NULL,
      fieldName TEXT NOT NULL,
      reviewedBy TEXT NOT NULL,
      reviewedAt TEXT NOT NULL,
      UNIQUE(schoolId, fieldName)
    );
  `);

  // 11. Admin Audit Logs table for atomic history and 1-click rollback
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
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
  `);
}

// Helper to normalize school type strictly to Grammar, Independent, or Comprehensive
function normalizeSchoolType(type, name, ofstedRating) {
  const current = (type || '').trim();
  const lowerType = current.toLowerCase();
  const lowerName = (name || '').toLowerCase();

  // 1. Independent
  if (lowerType.includes('independent') || lowerType.includes('isi') || (ofstedRating && ofstedRating.includes('ISI'))) {
    return 'Independent';
  }

  // 2. Grammar (strip brackets like Grammar (Academy), Grammar (Voluntary Aided), or match grammar schools)
  if (
    lowerType.includes('grammar') ||
    lowerName.includes('grammar') ||
    lowerName.includes('tiffin') ||
    lowerName.includes('latymer school') ||
    lowerName.includes('henrietta barnett') ||
    lowerName.includes('queen elizabeth\'s school, barnet')
  ) {
    return 'Grammar';
  }

  // 3. Comprehensive (default for all other state-funded / academy / free schools)
  return 'Comprehensive';
}

// Convert school SQLite record to JS object
function recordToSchool(row) {
  if (!row) return null;

  let entranceExamDates = { registrationOpen: 'TBC', registrationDeadline: 'TBC', examDate: 'TBC', resultsDate: 'TBC' };
  if (row.entranceExamDates) {
    try { entranceExamDates = JSON.parse(row.entranceExamDates); } catch (e) {}
  }

  let gcseSubjects = [];
  if (row.gcseSubjects) {
    if (Array.isArray(row.gcseSubjects)) {
      gcseSubjects = row.gcseSubjects;
    } else {
      try {
        const parsed = JSON.parse(row.gcseSubjects);
        gcseSubjects = Array.isArray(parsed) ? parsed : String(row.gcseSubjects).split(',').map(s => s.trim()).filter(Boolean);
      } catch (e) {
        gcseSubjects = String(row.gcseSubjects).split(',').map(s => s.trim()).filter(Boolean);
      }
    }
  }

  let _csv = null;
  if (row.raw_csv) {
    try { _csv = JSON.parse(row.raw_csv); } catch (e) {}
  }

  let pillaiDetails = null;
  if (row.pillaiDetails) {
    try { pillaiDetails = JSON.parse(row.pillaiDetails); } catch (e) {}
  }

  let kpsDetails = null;
  if (row.kpsDetails) {
    try { kpsDetails = JSON.parse(row.kpsDetails); } catch (e) {}
  }

  let extra = {};
  if (row.extra_json) {
    try { extra = JSON.parse(row.extra_json); } catch (e) {}
  }

  const school = {
    id: row.id,
    name: row.name,
    urn: row.urn || '',
    la: row.la || '',
    region: row.region || '',
    postcode: row.postcode || '',
    address: row.address || '',
    schoolType: normalizeSchoolType(row.schoolType, row.name, row.ofstedRating),
    rawSchoolType: row.rawSchoolType || row.schoolType || '',
    gender: row.gender || '',
    ageRange: row.ageRange || '',
    pupilCount: typeof row.pupilCount === 'number' ? row.pupilCount : (parseInt(row.pupilCount, 10) || 0),
    ofstedRating: row.ofstedRating || '',
    gcseProgress8: row.gcseProgress8 !== null && row.gcseProgress8 !== undefined ? row.gcseProgress8 : '',
    gcseAttainment8: row.gcseAttainment8 !== null && row.gcseAttainment8 !== undefined ? row.gcseAttainment8 : '',
    ebaccAveragePointScore: row.ebaccAveragePointScore !== null && row.ebaccAveragePointScore !== undefined ? row.ebaccAveragePointScore : null,
    entranceExamType: row.entranceExamType || '',
    entranceExamDates,
    gcseSubjects,
    admissionsPolicy: row.admissionsPolicy || '',
    website: row.website || '',
    phone: row.phone || '',
    email: row.email || '',
    description: row.description || '',
    feesTermly: row.feesTermly || '',
    registrationFee: row.registrationFee || '',
    sourceUrl: row.sourceUrl || '',
    second_stage_exam_required: row.second_stage_exam_required || '',
    stage_one_format_and_subjects: row.stage_one_format_and_subjects || '',
    stage_two_format_and_subjects: row.stage_two_format_and_subjects || '',
    ...extra
  };

  if (row.official) school.official = Boolean(row.official);
  if (row.hot) school.hot = Boolean(row.hot);
  if (row.officialDataSource) school.officialDataSource = row.officialDataSource;
  if (row.compareSchoolPerformanceUrl) school.compareSchoolPerformanceUrl = row.compareSchoolPerformanceUrl;
  if (_csv) school._csv = _csv;
  if (pillaiDetails) school.pillaiDetails = pillaiDetails;
  if (kpsDetails) school.kpsDetails = kpsDetails;
  if (row.potentialDuplicateOf) school._potentialDuplicateOf = row.potentialDuplicateOf;
  if (row.dedupNote) school._dedupNote = row.dedupNote;

  if (row.verification_status) school.verification_status = row.verification_status;
  if (row.verification_tags) {
    try { school.verification_tags = JSON.parse(row.verification_tags); } catch (e) { school.verification_tags = []; }
  } else {
    school.verification_tags = [];
  }
  if (row.verification_report) {
    try { school.verification_report = JSON.parse(row.verification_report); } catch (e) { school.verification_report = null; }
  }
  if (row.verified_at) school.verified_at = row.verified_at;
  if (row.confidence_score !== null && row.confidence_score !== undefined) school.confidence_score = row.confidence_score;

  return school;
}

// Convert school JS object to params for SQLite INSERT/UPDATE
function schoolToParams(s) {
  const knownKeys = new Set([
    'id', 'name', 'urn', 'la', 'region', 'postcode', 'address', 'schoolType',
    'rawSchoolType', 'gender', 'ageRange', 'pupilCount', 'ofstedRating',
    'gcseProgress8', 'gcseAttainment8', 'ebaccAveragePointScore',
    'entranceExamType', 'entranceExamDates', 'gcseSubjects', 'admissionsPolicy',
    'website', 'phone', 'email', 'description', 'official', 'hot',
    'officialDataSource', 'compareSchoolPerformanceUrl', '_csv',
    'pillaiDetails', 'kpsDetails', '_potentialDuplicateOf', '_dedupNote',
    'verification_status', 'verification_tags', 'verification_report', 'verified_at', 'confidence_score',
    'feesTermly', 'registrationFee', 'sourceUrl', 'second_stage_exam_required', 'stage_one_format_and_subjects', 'stage_two_format_and_subjects'
  ]);

  const extra = {};
  for (const k of Object.keys(s)) {
    if (!knownKeys.has(k)) {
      extra[k] = s[k];
    }
  }

  const pupilCount = typeof s.pupilCount === 'number' ? s.pupilCount : parseInt(s.pupilCount, 10) || 0;
  const gcseProgress8 = (s.gcseProgress8 !== null && s.gcseProgress8 !== undefined && s.gcseProgress8 !== '') ? parseFloat(s.gcseProgress8) : null;
  const gcseAttainment8 = (s.gcseAttainment8 !== null && s.gcseAttainment8 !== undefined && s.gcseAttainment8 !== '') ? parseFloat(s.gcseAttainment8) : null;
  const ebaccAveragePointScore = (s.ebaccAveragePointScore !== null && s.ebaccAveragePointScore !== undefined && s.ebaccAveragePointScore !== '') ? parseFloat(s.ebaccAveragePointScore) : null;

  const schoolId = (s.id && s.id.toString().trim())
    ? s.id.toString().trim()
    : (s.urn ? `sch-gov-${s.urn}` : `sch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  return {
    id: schoolId,
    name: s.name || '',
    urn: s.urn || '',
    la: s.la || '',
    region: s.region || 'Greater London',
    postcode: s.postcode || '',
    address: s.address || '',
    schoolType: normalizeSchoolType(s.schoolType, s.name, s.ofstedRating),
    rawSchoolType: s.rawSchoolType || s.schoolType || '',
    gender: s.gender || '',
    ageRange: s.ageRange || '',
    pupilCount,
    ofstedRating: s.ofstedRating || '',
    gcseProgress8: isNaN(gcseProgress8) ? null : gcseProgress8,
    gcseAttainment8: isNaN(gcseAttainment8) ? null : gcseAttainment8,
    ebaccAveragePointScore: isNaN(ebaccAveragePointScore) ? null : ebaccAveragePointScore,
    entranceExamType: s.entranceExamType || '',
    entranceExamDates: s.entranceExamDates ? (typeof s.entranceExamDates === 'string' ? s.entranceExamDates : JSON.stringify(s.entranceExamDates)) : null,
    gcseSubjects: s.gcseSubjects ? (typeof s.gcseSubjects === 'string' ? s.gcseSubjects : JSON.stringify(s.gcseSubjects)) : null,
    admissionsPolicy: s.admissionsPolicy || '',
    website: s.website || '',
    phone: s.phone || '',
    email: s.email || '',
    description: s.description || '',
    feesTermly: s.feesTermly || null,
    registrationFee: s.registrationFee || null,
    sourceUrl: s.sourceUrl || null,
    second_stage_exam_required: s.second_stage_exam_required || null,
    stage_one_format_and_subjects: s.stage_one_format_and_subjects || null,
    stage_two_format_and_subjects: s.stage_two_format_and_subjects || null,
    official: s.official ? 1 : 0,
    hot: s.hot ? 1 : 0,
    officialDataSource: s.officialDataSource || null,
    compareSchoolPerformanceUrl: s.compareSchoolPerformanceUrl || null,
    raw_csv: s._csv ? JSON.stringify(s._csv) : null,
    pillaiDetails: s.pillaiDetails ? JSON.stringify(s.pillaiDetails) : null,
    kpsDetails: s.kpsDetails ? JSON.stringify(s.kpsDetails) : null,
    potentialDuplicateOf: s._potentialDuplicateOf || null,
    dedupNote: s._dedupNote || null,
    extra_json: Object.keys(extra).length > 0 ? JSON.stringify(extra) : null
  };
}

// Schools CRUD operations
function getAllSchools() {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT * FROM schools');
  const rows = stmt.all();
  return rows.map(recordToSchool);
}

function getSchoolById(id) {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT * FROM schools WHERE id = ?');
  const row = stmt.get(id);
  return recordToSchool(row);
}

function insertSchool(school) {
  const sqlite = getDb();
  const p = schoolToParams(school);
  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO schools (
      id, name, urn, la, region, postcode, address, schoolType, rawSchoolType, gender, ageRange,
      pupilCount, ofstedRating, gcseProgress8, gcseAttainment8, ebaccAveragePointScore,
      entranceExamType, entranceExamDates, gcseSubjects, admissionsPolicy, website,
      phone, email, description, official, hot, officialDataSource,
      compareSchoolPerformanceUrl, raw_csv, pillaiDetails, kpsDetails,
      potentialDuplicateOf, dedupNote, feesTermly, registrationFee, sourceUrl, second_stage_exam_required,
      stage_one_format_and_subjects, stage_two_format_and_subjects, extra_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);
  stmt.run(
    p.id, p.name, p.urn, p.la, p.region, p.postcode, p.address, p.schoolType, p.rawSchoolType, p.gender, p.ageRange,
    p.pupilCount, p.ofstedRating, p.gcseProgress8, p.gcseAttainment8, p.ebaccAveragePointScore,
    p.entranceExamType, p.entranceExamDates, p.gcseSubjects, p.admissionsPolicy, p.website,
    p.phone, p.email, p.description, p.official, p.hot, p.officialDataSource,
    p.compareSchoolPerformanceUrl, p.raw_csv, p.pillaiDetails, p.kpsDetails,
    p.potentialDuplicateOf, p.dedupNote, p.feesTermly, p.registrationFee, p.sourceUrl, p.second_stage_exam_required,
    p.stage_one_format_and_subjects, p.stage_two_format_and_subjects, p.extra_json
  );
  return getSchoolById(p.id);
}

function updateSchool(id, partialSchool) {
  const existing = getSchoolById(id);
  if (!existing) return null;
  const merged = { ...existing, ...partialSchool, id };
  return insertSchool(merged);
}

function bulkUpdateSchools(schoolIds, partialUpdates) {
  if (!Array.isArray(schoolIds) || schoolIds.length === 0 || !partialUpdates) {
    return [];
  }
  const updatedList = [];
  const sqlite = getDb();
  sqlite.exec('BEGIN TRANSACTION;');
  try {
    for (const id of schoolIds) {
      const existing = getSchoolById(id);
      if (existing) {
        const merged = { ...existing, ...partialUpdates, id };
        const updated = insertSchool(merged);
        if (updated) {
          updatedList.push(updated);
        }
      }
    }
    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }
  return updatedList;
}

function deleteSchool(id) {
  const sqlite = getDb();
  const stmt = sqlite.prepare('DELETE FROM schools WHERE id = ?');
  stmt.run(id);
}

function insertSchoolsBulk(schoolsArray) {
  const sqlite = getDb();
  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO schools (
        id, name, urn, la, region, postcode, address, schoolType, rawSchoolType, gender, ageRange,
        pupilCount, ofstedRating, gcseProgress8, gcseAttainment8, ebaccAveragePointScore,
        entranceExamType, entranceExamDates, gcseSubjects, admissionsPolicy, website,
        phone, email, description, official, hot, officialDataSource,
        compareSchoolPerformanceUrl, raw_csv, pillaiDetails, kpsDetails,
        potentialDuplicateOf, dedupNote, extra_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    for (const school of schoolsArray) {
      const p = schoolToParams(school);
      stmt.run(
        p.id, p.name, p.urn, p.la, p.region, p.postcode, p.address, p.schoolType, p.rawSchoolType, p.gender, p.ageRange,
        p.pupilCount, p.ofstedRating, p.gcseProgress8, p.gcseAttainment8, p.ebaccAveragePointScore,
        p.entranceExamType, p.entranceExamDates, p.gcseSubjects, p.admissionsPolicy, p.website,
        p.phone, p.email, p.description, p.official, p.hot, p.officialDataSource,
        p.compareSchoolPerformanceUrl, p.raw_csv, p.pillaiDetails, p.kpsDetails,
        p.potentialDuplicateOf, p.dedupNote, p.extra_json
      );
    }
    sqlite.exec('COMMIT;');
    return true;
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }
}

// Convert user SQLite row to JS object
function recordToUser(row) {
  if (!row) return null;
  let permissions = ['parent:recommendations', 'parent:portfolio'];
  if (row.permissions) {
    try {
      const parsed = JSON.parse(row.permissions);
      if (Array.isArray(parsed)) permissions = parsed;
    } catch (e) {}
  }
  const isAdmin = permissions.includes('admin:portal') || row.email === 'admin@edulondon.sch.uk' || row.email === 'aa@bb.cc';
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    permissions,
    role: isAdmin ? 'admin' : 'user',
    createdAt: row.createdAt
  };
}

// Users CRUD operations
function getAllUsers() {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT id, name, email, password, permissions, createdAt FROM users');
  const rows = stmt.all();
  return rows.map(recordToUser);
}

function getUserByEmail(email) {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT id, name, email, password, permissions, createdAt FROM users WHERE LOWER(email) = LOWER(?)');
  const row = stmt.get(email);
  return recordToUser(row);
}

function insertUser(user) {
  const sqlite = getDb();
  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO users (id, name, email, password, permissions, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const perms = Array.isArray(user.permissions) ? user.permissions : ['parent:recommendations', 'parent:portfolio'];
  stmt.run(user.id, user.name, user.email.toLowerCase(), user.password, JSON.stringify(perms), user.createdAt || new Date().toISOString());
  return getUserByEmail(user.email);
}

function insertUsersBulk(usersArray) {
  const sqlite = getDb();
  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO users (id, name, email, password, permissions, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const u of usersArray) {
      const perms = Array.isArray(u.permissions) ? u.permissions : ['parent:recommendations', 'parent:portfolio'];
      stmt.run(u.id, u.name, u.email.toLowerCase(), u.password, JSON.stringify(perms), u.createdAt || new Date().toISOString());
    }
    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }
}

// User Portfolios CRUD operations
function getAllPortfolios() {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT * FROM user_portfolios');
  const rows = stmt.all();
  const map = {};
  for (const row of rows) {
    map[row.userId] = {
      userId: row.userId,
      targetLocation: row.targetLocation || '',
      selectedSchools: row.selectedSchools ? JSON.parse(row.selectedSchools) : [],
      removedSchoolIds: row.removedSchoolIds ? JSON.parse(row.removedSchoolIds) : [],
      cafRankings: row.cafRankings ? JSON.parse(row.cafRankings) : [],
      independentSchools: row.independentSchools ? JSON.parse(row.independentSchools) : [],
      parentNotes: row.parentNotes ? JSON.parse(row.parentNotes) : {},
      savedAt: row.savedAt
    };
  }
  return map;
}

function getPortfolioByUserId(userId) {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT * FROM user_portfolios WHERE userId = ?');
  const row = stmt.get(userId);
  if (!row) {
    return {
      userId,
      targetLocation: '',
      selectedSchools: [],
      removedSchoolIds: [],
      cafRankings: [],
      independentSchools: [],
      parentNotes: {},
      savedAt: null
    };
  }
  return {
    userId: row.userId,
    targetLocation: row.targetLocation || '',
    selectedSchools: row.selectedSchools ? JSON.parse(row.selectedSchools) : [],
    removedSchoolIds: row.removedSchoolIds ? JSON.parse(row.removedSchoolIds) : [],
    cafRankings: row.cafRankings ? JSON.parse(row.cafRankings) : [],
    independentSchools: row.independentSchools ? JSON.parse(row.independentSchools) : [],
    parentNotes: row.parentNotes ? JSON.parse(row.parentNotes) : {},
    savedAt: row.savedAt
  };
}

function savePortfolio(userId, data) {
  const sqlite = getDb();
  // Ensure user exists
  const userCheck = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!userCheck) {
    insertUser({
      id: userId,
      name: userId,
      email: `${userId}@edulondon.sch.uk`,
      password: 'user',
      role: 'user',
      createdAt: new Date().toISOString()
    });
  }

  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO user_portfolios (
      userId, targetLocation, selectedSchools, removedSchoolIds,
      cafRankings, independentSchools, parentNotes, savedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const savedAt = new Date().toISOString();
  stmt.run(
    userId,
    data.targetLocation || '',
    data.selectedSchools ? JSON.stringify(data.selectedSchools) : JSON.stringify([]),
    data.removedSchoolIds ? JSON.stringify(data.removedSchoolIds) : JSON.stringify([]),
    data.cafRankings ? JSON.stringify(data.cafRankings) : JSON.stringify([]),
    data.independentSchools ? JSON.stringify(data.independentSchools) : JSON.stringify([]),
    data.parentNotes ? JSON.stringify(data.parentNotes) : JSON.stringify({}),
    savedAt
  );
  return getPortfolioByUserId(userId);
}

function insertPortfoliosBulk(portfoliosMap) {
  const sqlite = getDb();
  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const userCheckStmt = sqlite.prepare('SELECT id FROM users WHERE id = ?');
    const userInsertStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO users (id, name, email, password, role, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO user_portfolios (userId, targetLocation, selectedSchools, removedSchoolIds, savedAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const [userId, item] of Object.entries(portfoliosMap)) {
      if (!userCheckStmt.get(userId)) {
        userInsertStmt.run(
          userId,
          userId,
          `${userId}@edulondon.sch.uk`,
          'user',
          'user',
          new Date().toISOString()
        );
      }

      stmt.run(
        userId,
        item.targetLocation || '',
        item.selectedSchools ? JSON.stringify(item.selectedSchools) : JSON.stringify([]),
        item.removedSchoolIds ? JSON.stringify(item.removedSchoolIds) : JSON.stringify([]),
        item.savedAt || new Date().toISOString()
      );
    }
    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }
}

// Reviewed Pairs CRUD operations
function getAllReviewedPairs() {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT * FROM reviewed_pairs');
  return stmt.all();
}

function insertReviewedPair(pairKey, idA, idB, reviewedAt) {
  const sqlite = getDb();
  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO reviewed_pairs (pairKey, idA, idB, reviewedAt)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(pairKey, idA, idB, reviewedAt || new Date().toISOString());
  return { pairKey, idA, idB, reviewedAt };
}

function insertReviewedPairsBulk(pairsArray) {
  const sqlite = getDb();
  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO reviewed_pairs (pairKey, idA, idB, reviewedAt)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of pairsArray) {
      stmt.run(item.pairKey, item.idA, item.idB, item.reviewedAt || new Date().toISOString());
    }
    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }
}

// Recommendation Settings CRUD operations
function getRecSettings() {
  const DEFAULT_WEIGHTS = {
    location: 35,
    examType: 25,
    academicPerformance: 20,
    ofstedRating: 10,
    schoolType: 10
  };

  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT weights FROM recommendation_settings WHERE key = ?');
  const row = stmt.get('default');

  if (!row || !row.weights) {
    return { weights: DEFAULT_WEIGHTS };
  }

  try {
    const parsed = JSON.parse(row.weights);
    return { weights: { ...DEFAULT_WEIGHTS, ...parsed } };
  } catch (e) {
    return { weights: DEFAULT_WEIGHTS };
  }
}

function saveRecSettings(weights) {
  const sqlite = getDb();
  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO recommendation_settings (key, weights)
    VALUES (?, ?)
  `);
  stmt.run('default', JSON.stringify(weights));
  return getRecSettings();
}

const DEFAULT_LLM_PROMPT_TEMPLATE = `You are an expert UK School Admissions Data Researcher and Verifier. Your task is to provide accurate, verified, and structured information for the following UK school:

Target School Information:
- School Name: {{school_name}}
- City: {{city}}
- County: {{county}}
- Postcode: {{postcode}}
- Known Website: {{website}}

Instructions:
1. Verify official 11+ admissions policy, entrance exam specifications, timeline milestones, and contact details for Year 7 entry (September 2027 / 2026–2027 cycle).
2. In 'admissionsOverview', provide structured bullet points covering: eligibility, registration requirements, exam stages, interview/audition steps, offer decisions, and specific exam details if published (such as exam duration/papers, stage 1 to stage 2 selection criteria, number of qualifiers to stage 2, and parent-relevant exam specifics). Exclude generic filler; leave blank if nothing specific is found.
3. Dates must use "Day Month Year" format (e.g. "6 November 2026"). Never guess or extrapolate. Return an array of date strings only for multi-date milestones ('stage_one_examDate', 'stage_two_examDate', 'interviewDates', e.g. ["2 December 2026", "3 December 2026"]); all other milestone dates must be single date strings.
4. Identify exact exam board/provider (e.g. "GL Assessment (English & Maths)", "ISEB Common Pre-Test", "London 11+ Consortium", "CSSE 11+", "CEM", "School's Own Exam", "Non-selective / Comprehensive Banding").
5. Identify gender policy ("Boys", "Girls", or "Mixed").
6. Extract admissions phone number, email, full street address, postcode, and official verified website URL.
7. For Independent schools, extract termly tuition fees (e.g. "£7,500") and 11+ registration fee (e.g. "£150"); set null if State/Grammar/Free.

Output ONLY a valid JSON object matching this schema with no markdown formatting, code blocks, or preamble:

{
  "name": "{{school_name}}",
  "website": "https://...",
  "phone": "020...",
  "email": "...@...",
  "address": "Full postal street address",
  "postcode": "POSTCODE",
  "schoolType": "Independent",
  "rawSchoolType": "Independent Senior School (11–18)",
  "gender": "Boys or Girls or Mixed",
  "ageRange": "11 to 18",
  "description": "Comprehensive school profile and academic summary.",
  "admissionsOverview": "• Registration: Complete online registration before November deadline.\\n• Stage 1 Test: 60-minute English and Maths papers in December.\\n• Stage 2 Qualification: Top 300 scoring candidates invited to Stage 2 exam in January.\\n• Decisions: Offers released 1 March with acceptance due mid-March.",
  "entranceExamType": "GL Assessment (English & Maths)",
  "entranceExamDates": {
    "registrationOpen": "",
    "registrationDeadline": "",
    "registrationFee": "£150",
    "stage_one_examDate": ["2 December 2026", "3 December 2026"],
    "stage_one_format_and_subjects": "",
    "stage_one_resultDate": "",
    "second_stage_exam_required": "Yes or No",
    "stage_two_examDate": ["9 January 2027"],
    "stage_two_format_and_subjects": "",
    "stage_two_resultDate": "",
    "interviewDates": ["15 January 2027", "16 January 2027"],
    "offerDate": "",
    "acceptanceDeadline": "",
    "openEvents": "",
    "scholarshipsOffered": "",
    "bursaryDeadline": ""
  },
  "feesTermly": "£7,500",
  "registrationFee": "£150",
  "confidenceScore": 95,
  "sourceUrl": "https://..."
}`;

// -------------------------------------------------------------
// STRUCTURED ADMIN SETTINGS & ENGINE CONFIGURATION DAO
// -------------------------------------------------------------

const SUPPORTED_GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash-lite',
  'gemini-3.0-flash'
];

const SUPPORTED_OPENAI_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'o3-mini',
  'gpt-4.5-preview'
];

const DEFAULT_ADMIN_SETTINGS = {
  llmProvider: 'gemini',
  geminiModel: 'gemini-3.6-flash',
  geminiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  openaiApiKey: '',
  scannerSkipDays: 10,
  scannerDelaySeconds: 20,
  llmPromptTemplate: DEFAULT_LLM_PROMPT_TEMPLATE,
  recWeights: {
    location: 35,
    examType: 25,
    academicPerformance: 20,
    ofstedRating: 10,
    schoolType: 10
  }
};

/**
 * Retrieve all structured admin configuration settings with full type validation and defaults.
 */
function getAdminSettings() {
  const sqlite = getDb();
  const rows = sqlite.prepare('SELECT key, value FROM system_settings').all();
  const rawMap = {};
  for (const row of rows) {
    try {
      rawMap[row.key] = JSON.parse(row.value);
    } catch (e) {
      rawMap[row.key] = row.value;
    }
  }

  // Also read recommendation_settings if recWeights not yet in system_settings
  let recWeights = rawMap.recWeights || DEFAULT_ADMIN_SETTINGS.recWeights;
  if (!rawMap.recWeights) {
    try {
      const recRow = sqlite.prepare('SELECT weights FROM recommendation_settings WHERE key = ?').get('default');
      if (recRow && recRow.weights) {
        recWeights = { ...DEFAULT_ADMIN_SETTINGS.recWeights, ...JSON.parse(recRow.weights) };
      }
    } catch (e) {}
  }

  const llmProvider = (rawMap.llmProvider === 'chatgpt') ? 'chatgpt' : 'gemini';
  let geminiModel = typeof rawMap.geminiModel === 'string' && rawMap.geminiModel.trim() ? rawMap.geminiModel.trim() : DEFAULT_ADMIN_SETTINGS.geminiModel;
  // Migrate deprecated models to modern flash series
  if (geminiModel === 'gemini-3.6-pro' || geminiModel === 'gemini-3.0-pro') {
    geminiModel = 'gemini-3.6-flash';
  }
  const openaiModel = typeof rawMap.openaiModel === 'string' && rawMap.openaiModel.trim() ? rawMap.openaiModel.trim() : DEFAULT_ADMIN_SETTINGS.openaiModel;
  const geminiApiKey = (process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '') || (typeof rawMap.geminiApiKey === 'string' ? rawMap.geminiApiKey.trim() : '');
  const openaiApiKey = (process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.trim() : '') || (typeof rawMap.openaiApiKey === 'string' ? rawMap.openaiApiKey.trim() : '');
  const scannerSkipDays = typeof rawMap.scannerSkipDays === 'number' ? Math.max(0, Math.min(100, rawMap.scannerSkipDays)) : (parseInt(rawMap.scannerSkipDays, 10) || 10);
  const scannerDelaySeconds = typeof rawMap.scannerDelaySeconds === 'number' ? Math.max(0, Math.min(300, rawMap.scannerDelaySeconds)) : (parseInt(rawMap.scannerDelaySeconds, 10) || 20);
  let llmPromptTemplate = typeof rawMap.llmPromptTemplate === 'string' && rawMap.llmPromptTemplate.trim() ? rawMap.llmPromptTemplate : DEFAULT_LLM_PROMPT_TEMPLATE;
  if (!llmPromptTemplate.includes('You are an expert UK School Admissions Data Researcher and Verifier')) {
    llmPromptTemplate = DEFAULT_LLM_PROMPT_TEMPLATE;
  }

  return {
    llmProvider,
    geminiModel,
    geminiApiKey,
    openaiModel,
    openaiApiKey,
    scannerSkipDays,
    scannerDelaySeconds,
    llmPromptTemplate,
    recWeights,
    // Client Display Helper Metadata
    hasGeminiKey: Boolean(geminiApiKey || process.env.GEMINI_API_KEY),
    geminiKeyMasked: geminiApiKey ? ('••••••••' + geminiApiKey.slice(-4)) : (process.env.GEMINI_API_KEY ? '••••••••' + process.env.GEMINI_API_KEY.slice(-4) : ''),
    hasOpenaiKey: Boolean(openaiApiKey || process.env.OPENAI_API_KEY),
    openaiKeyMasked: openaiApiKey ? ('••••••••' + openaiApiKey.slice(-4)) : (process.env.OPENAI_API_KEY ? '••••••••' + process.env.OPENAI_API_KEY.slice(-4) : ''),
    supportedGeminiModels: SUPPORTED_GEMINI_MODELS,
    supportedOpenaiModels: SUPPORTED_OPENAI_MODELS,
    defaultPromptTemplate: DEFAULT_LLM_PROMPT_TEMPLATE
  };
}

/**
 * Atomically save and validate admin configuration updates to SQLite system_settings.
 */
function saveAdminSettings(updates) {
  if (!updates || typeof updates !== 'object') {
    return getAdminSettings();
  }

  const sqlite = getDb();
  const current = getAdminSettings();
  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO system_settings (key, value)
    VALUES (?, ?)
  `);

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    if (typeof updates.llmProvider !== 'undefined') {
      const p = String(updates.llmProvider).toLowerCase().trim();
      const finalProvider = (p === 'chatgpt') ? 'chatgpt' : 'gemini';
      stmt.run('llmProvider', JSON.stringify(finalProvider));
    }

    if (typeof updates.geminiModel !== 'undefined' && typeof updates.geminiModel === 'string' && updates.geminiModel.trim()) {
      stmt.run('geminiModel', JSON.stringify(updates.geminiModel.trim()));
    }

// Helper to persist secret credentials in .env instead of SQLite binary
function updateEnvVariable(key, val) {
  try {
    process.env[key] = val;
    const envPath = path.join(__dirname, '.env');
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const regex = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${val}`);
    } else {
      content = content.trimEnd() + `\n${key}=${val}\n`;
    }
    fs.writeFileSync(envPath, content);
  } catch (e) {
    console.warn(`[Config] Warning writing ${key} to .env:`, e.message);
  }
}

    if (updates.clearGeminiKey === true) {
      updateEnvVariable('GEMINI_API_KEY', '');
      stmt.run('geminiApiKey', JSON.stringify(''));
    } else if (typeof updates.geminiApiKey === 'string') {
      const trimmed = updates.geminiApiKey.trim();
      if (trimmed && !trimmed.includes('••••')) {
        updateEnvVariable('GEMINI_API_KEY', trimmed);
        stmt.run('geminiApiKey', JSON.stringify(''));
      }
    } else if (typeof updates.apiKey === 'string' && (!updates.llmProvider || updates.llmProvider === 'gemini')) {
      const trimmed = updates.apiKey.trim();
      if (trimmed && !trimmed.includes('••••')) {
        updateEnvVariable('GEMINI_API_KEY', trimmed);
        stmt.run('geminiApiKey', JSON.stringify(''));
      }
    }

    if (typeof updates.openaiModel !== 'undefined' && typeof updates.openaiModel === 'string' && updates.openaiModel.trim()) {
      stmt.run('openaiModel', JSON.stringify(updates.openaiModel.trim()));
    }

    if (updates.clearOpenaiKey === true) {
      updateEnvVariable('OPENAI_API_KEY', '');
      stmt.run('openaiApiKey', JSON.stringify(''));
    } else if (typeof updates.openaiApiKey === 'string') {
      const trimmed = updates.openaiApiKey.trim();
      if (trimmed && !trimmed.includes('••••')) {
        updateEnvVariable('OPENAI_API_KEY', trimmed);
        stmt.run('openaiApiKey', JSON.stringify(''));
      }
    } else if (typeof updates.apiKey === 'string' && updates.llmProvider === 'chatgpt') {
      const trimmed = updates.apiKey.trim();
      if (trimmed && !trimmed.includes('••••')) {
        updateEnvVariable('OPENAI_API_KEY', trimmed);
        stmt.run('openaiApiKey', JSON.stringify(''));
      }
    }

    if (typeof updates.scannerSkipDays !== 'undefined') {
      const num = parseInt(updates.scannerSkipDays, 10);
      const finalSkip = isNaN(num) ? 10 : Math.max(0, Math.min(100, num));
      stmt.run('scannerSkipDays', JSON.stringify(finalSkip));
    }

    if (typeof updates.scannerDelaySeconds !== 'undefined') {
      const num = parseInt(updates.scannerDelaySeconds, 10);
      const finalDelay = isNaN(num) ? 20 : Math.max(0, Math.min(300, num));
      stmt.run('scannerDelaySeconds', JSON.stringify(finalDelay));
    }

    if (typeof updates.llmPromptTemplate !== 'undefined' && typeof updates.llmPromptTemplate === 'string') {
      const trimmed = updates.llmPromptTemplate.trim();
      const templateVal = (trimmed && trimmed.includes('You are an expert UK School Admissions Data Researcher and Verifier')) ? trimmed : DEFAULT_LLM_PROMPT_TEMPLATE;
      stmt.run('llmPromptTemplate', JSON.stringify(templateVal));
    }

    if (updates.recWeights && typeof updates.recWeights === 'object') {
      const mergedWeights = {
        location: parseInt(updates.recWeights.location, 10) || 0,
        examType: parseInt(updates.recWeights.examType, 10) || 0,
        academicPerformance: parseInt(updates.recWeights.academicPerformance, 10) || 0,
        ofstedRating: parseInt(updates.recWeights.ofstedRating, 10) || 0,
        schoolType: parseInt(updates.recWeights.schoolType, 10) || 0
      };
      stmt.run('recWeights', JSON.stringify(mergedWeights));
      try {
        sqlite.prepare('INSERT OR REPLACE INTO recommendation_settings (key, weights) VALUES (?, ?)').run('default', JSON.stringify(mergedWeights));
      } catch (e) {}
    }

    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }

  return getAdminSettings();
}

// Backward-compatible wrappers for existing system_settings and recommendation_settings consumers
function getSystemSettings() {
  return getAdminSettings();
}

function saveSystemSettings(settings) {
  return saveAdminSettings(settings);
}

function getSystemSetting(key, defaultValue = null) {
  const settings = getAdminSettings();
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

// Persistent Session Storage (30 days)
function saveSession(sessionId, user, durationMs = 30 * 24 * 60 * 60 * 1000) {
  const sqlite = getDb();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO sessions (id, userId, userJson, createdAt, expiresAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(sessionId, user.id, JSON.stringify(user), createdAt, expiresAt);
  return { id: sessionId, user, createdAt, expiresAt };
}

function getSession(sessionId) {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT * FROM sessions WHERE id = ?');
  const row = stmt.get(sessionId);
  if (!row) return null;

  // Check expiration
  if (new Date(row.expiresAt) <= new Date()) {
    deleteSession(sessionId);
    return null;
  }

  try {
    return {
      id: row.id,
      userId: row.userId,
      user: JSON.parse(row.userJson),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt
    };
  } catch (e) {
    return null;
  }
}

function deleteSession(sessionId) {
  const sqlite = getDb();
  const stmt = sqlite.prepare('DELETE FROM sessions WHERE id = ?');
  stmt.run(sessionId);
}

// User Field Ratings & Custom Overrides CRUD Operations
function saveFieldReport(report) {
  const sqlite = getDb();
  const reportedAt = new Date().toISOString();
  const stmt = sqlite.prepare(`
    INSERT INTO user_field_reports (userId, schoolId, fieldName, status, originalValue, customValue, reportedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId, schoolId, fieldName) DO UPDATE SET
      status = excluded.status,
      originalValue = excluded.originalValue,
      customValue = excluded.customValue,
      reportedAt = excluded.reportedAt;
  `);
  stmt.run(
    report.userId,
    report.schoolId,
    report.fieldName,
    report.status,
    report.originalValue !== undefined && report.originalValue !== null ? String(report.originalValue) : '',
    report.customValue !== undefined && report.customValue !== null ? String(report.customValue) : '',
    reportedAt
  );
  return { ...report, reportedAt };
}

function getUserFieldReports(userId, schoolId = null) {
  const sqlite = getDb();
  if (schoolId) {
    const stmt = sqlite.prepare('SELECT * FROM user_field_reports WHERE userId = ? AND schoolId = ?');
    return stmt.all(userId, schoolId);
  }
  const stmt = sqlite.prepare('SELECT * FROM user_field_reports WHERE userId = ?');
  return stmt.all(userId);
}

function deleteFieldReport(userId, schoolId, fieldName) {
  const sqlite = getDb();
  const stmt = sqlite.prepare('DELETE FROM user_field_reports WHERE userId = ? AND schoolId = ? AND fieldName = ?');
  stmt.run(userId, schoolId, fieldName);
}

function getAdminReportedErrors() {
  const sqlite = getDb();
  const sql = `
    SELECT 
      r.schoolId,
      s.name as schoolName,
      s.urn as schoolUrn,
      r.fieldName,
      r.originalValue,
      r.customValue,
      r.userId,
      r.reportedAt,
      u.name as userName,
      u.email as userEmail
    FROM user_field_reports r
    LEFT JOIN schools s ON r.schoolId = s.id
    LEFT JOIN users u ON r.userId = u.id
    WHERE r.status = 'down'
    ORDER BY r.schoolId, r.fieldName, r.reportedAt DESC;
  `;
  const rows = sqlite.prepare(sql).all();

  const schoolsMap = {};
  for (const row of rows) {
    const sId = row.schoolId;
    if (!schoolsMap[sId]) {
      schoolsMap[sId] = {
        schoolId: sId,
        schoolName: row.schoolName || sId,
        schoolUrn: row.schoolUrn || 'N/A',
        totalErrorCount: 0,
        fieldsMap: {}
      };
    }
    schoolsMap[sId].totalErrorCount++;

    const fName = row.fieldName;
    if (!schoolsMap[sId].fieldsMap[fName]) {
      schoolsMap[sId].fieldsMap[fName] = {
        fieldName: fName,
        fieldErrorCount: 0,
        reports: []
      };
    }
    schoolsMap[sId].fieldsMap[fName].fieldErrorCount++;
    schoolsMap[sId].fieldsMap[fName].reports.push({
      userId: row.userId,
      userName: row.userName || row.userId,
      userEmail: row.userEmail || '',
      originalValue: row.originalValue,
      customValue: row.customValue,
      reportedAt: row.reportedAt
    });
  }

  const sortedSchools = Object.values(schoolsMap).sort((a, b) => b.totalErrorCount - a.totalErrorCount);

  for (const schoolObj of sortedSchools) {
    schoolObj.fields = Object.values(schoolObj.fieldsMap).sort((a, b) => b.fieldErrorCount - a.fieldErrorCount);
    delete schoolObj.fieldsMap;
  }

  return sortedSchools;
}

// User Recommendation Preferences CRUD Operations
function saveUserRecPreferences(userId, prefs) {
  const sqlite = getDb();
  const updatedAt = new Date().toISOString();
  const stmt = sqlite.prepare(`
    INSERT INTO user_recommendation_preferences (userId, targetPostcode, targetBorough, childAbilityLevel, binaryFiltersJson, qualitativeWeightsJson, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      targetPostcode = excluded.targetPostcode,
      targetBorough = excluded.targetBorough,
      childAbilityLevel = excluded.childAbilityLevel,
      binaryFiltersJson = excluded.binaryFiltersJson,
      qualitativeWeightsJson = excluded.qualitativeWeightsJson,
      updatedAt = excluded.updatedAt;
  `);
  stmt.run(
    userId,
    prefs.targetPostcode || '',
    prefs.targetBorough || '',
    prefs.childAbilityLevel || 'NA',
    JSON.stringify(prefs.binaryFilters || {}),
    JSON.stringify(prefs.qualitativeWeights || {}),
    updatedAt
  );
  return getUserRecPreferences(userId);
}

function getUserRecPreferences(userId) {
  const sqlite = getDb();
  const stmt = sqlite.prepare('SELECT * FROM user_recommendation_preferences WHERE userId = ?');
  const row = stmt.get(userId);
  if (!row) {
    return {
      userId,
      targetPostcode: '',
      targetBorough: '',
      childAbilityLevel: 'NA',
      binaryFilters: {
        gender: 'NA',
        schoolTypes: ['NA'],
        examFormats: ['NA'],
        ofstedFloor: 'NA',
        sixthForm: 'NA',
        maxDistance: 'NA'
      },
      qualitativeWeights: {
        proximity: 'not_important',
        academicExcellence: 'somewhat',
        pupilProgress: 'somewhat',
        subjectBreadth: 'NA',
        schoolSize: 'NA'
      },
      updatedAt: new Date().toISOString()
    };
  }

  let binaryFilters = {};
  let qualitativeWeights = {};
  try { binaryFilters = JSON.parse(row.binaryFiltersJson); } catch (e) {}
  try { qualitativeWeights = JSON.parse(row.qualitativeWeightsJson); } catch (e) {}

  return {
    userId: row.userId,
    targetPostcode: row.targetPostcode,
    targetBorough: row.targetBorough,
    childAbilityLevel: row.childAbilityLevel,
    binaryFilters,
    qualitativeWeights,
    updatedAt: row.updatedAt
  };
}

// Cast a thumbs up (+1) or thumbs down (-1) vote on a field
function castFieldConfidenceVote(userId, schoolId, fieldName, vote) {
  const sqlite = getDb();
  const votedAt = new Date().toISOString();

  if (vote === 0) {
    const stmt = sqlite.prepare('DELETE FROM field_confidence_votes WHERE userId = ? AND schoolId = ? AND fieldName = ?');
    stmt.run(userId, schoolId, fieldName);
  } else {
    const normVote = vote > 0 ? 1 : -1;
    const stmt = sqlite.prepare(`
      INSERT INTO field_confidence_votes (userId, schoolId, fieldName, vote, votedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(userId, schoolId, fieldName) DO UPDATE SET
        vote = excluded.vote,
        votedAt = excluded.votedAt
    `);
    stmt.run(userId, schoolId, fieldName, normVote, votedAt);
  }
}

// Mark a field as reviewed/updated by an admin (permanently flagged as High Confidence)
function markFieldAdminReviewed(schoolId, fieldName, reviewedBy = 'admin') {
  const sqlite = getDb();
  const reviewedAt = new Date().toISOString();
  const stmt = sqlite.prepare(`
    INSERT INTO admin_field_reviews (schoolId, fieldName, reviewedBy, reviewedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(schoolId, fieldName) DO UPDATE SET
      reviewedBy = excluded.reviewedBy,
      reviewedAt = excluded.reviewedAt
  `);
  stmt.run(schoolId, fieldName, reviewedBy, reviewedAt);
}

// Compute confidence statistics for a school across all fields
function getFieldConfidenceStats(schoolId, userId = null) {
  const sqlite = getDb();

  const adminStmt = sqlite.prepare('SELECT fieldName, reviewedBy, reviewedAt FROM admin_field_reviews WHERE schoolId = ?');
  const adminReviews = adminStmt.all(schoolId);
  const adminReviewedFields = new Set(adminReviews.map(r => r.fieldName));

  const voteStmt = sqlite.prepare(`
    SELECT fieldName,
           SUM(CASE WHEN vote > 0 THEN 1 ELSE 0 END) as upvotes,
           SUM(CASE WHEN vote < 0 THEN 1 ELSE 0 END) as downvotes
    FROM field_confidence_votes
    WHERE schoolId = ?
    GROUP BY fieldName
  `);
  const votes = voteStmt.all(schoolId);

  let userVotes = {};
  if (userId) {
    const userVoteStmt = sqlite.prepare('SELECT fieldName, vote FROM field_confidence_votes WHERE schoolId = ? AND userId = ?');
    const uVotes = userVoteStmt.all(schoolId, userId);
    uVotes.forEach(uv => {
      userVotes[uv.fieldName] = uv.vote;
    });
  }

  const confidenceStats = {};

  const voteMap = {};
  votes.forEach(v => {
    voteMap[v.fieldName] = { upvotes: v.upvotes || 0, downvotes: v.downvotes || 0 };
  });

  adminReviews.forEach(ar => {
    confidenceStats[ar.fieldName] = {
      score: 100,
      level: 'High',
      isAdminVerified: true,
      label: 'Admin Verified',
      upvotes: voteMap[ar.fieldName]?.upvotes || 0,
      downvotes: voteMap[ar.fieldName]?.downvotes || 0,
      userVote: userVotes[ar.fieldName] || 0
    };
  });

  Object.keys(voteMap).forEach(fieldName => {
    if (adminReviewedFields.has(fieldName)) return;

    const { upvotes, downvotes } = voteMap[fieldName];
    let score = 60 + (upvotes * 5) - (downvotes * 10);
    score = Math.max(15, Math.min(98, score));

    let level = 'Medium';
    if (score >= 85) level = 'High';
    else if (score < 60) level = 'Low';

    confidenceStats[fieldName] = {
      score,
      level,
      isAdminVerified: false,
      label: `${score}% Confidence`,
      upvotes,
      downvotes,
      userVote: userVotes[fieldName] || 0
    };
  });

  return confidenceStats;
}

// ----------------------------------------------------
// Date Anomaly & Timeline Quality Analysis Engine
// ----------------------------------------------------

const TIMELINE_MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

function isNaValue(val) {
  if (val === null || val === undefined) return true;
  if (typeof val !== 'string') return false;
  const s = val.trim().toLowerCase();
  if (!s) return true;
  return (
    ['na', 'n/a', 'n.a.', 'n / a', 'none', 'tbc', 'tbd', '—', '-', 'null', 'undefined', 'not applicable', 'does not apply', 'all', 'shortlisted', 'no', 'nil', 'n/a (non-selective admissions)', 'n/a (faith priority criteria)', 'none (supplementary information form [sif] required)', 'none (statutory admissions code)'].includes(s) ||
    s.startsWith('n/a') ||
    s.startsWith('na ') ||
    s.startsWith('none') ||
    s.startsWith('tbc') ||
    s.startsWith('tbd') ||
    s.startsWith('not app') ||
    s.startsWith('does not')
  );
}

function parseTimelineDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  if (isNaValue(dateStr)) return null;
  const s = dateStr.trim();
  const lowerStr = s.toLowerCase();

  if (
    lowerStr.startsWith('open year-round') ||
    lowerStr.startsWith('rolling') ||
    lowerStr.startsWith('bespoke') ||
    lowerStr.includes('non-selective') ||
    lowerStr.startsWith('after assessment') ||
    lowerStr.startsWith('after exam') ||
    lowerStr.startsWith('following') ||
    lowerStr.startsWith('same day') ||
    lowerStr.startsWith('same date') ||
    lowerStr.startsWith('concurrent') ||
    lowerStr.startsWith('with interview') ||
    lowerStr.startsWith('with exam')
  ) {
    return null;
  }

  // Split out trailing target entry year notes like "— for Sept 2029 entry"
  const cleanStr = s.replace(/—\s*for\s+Sept\w*\s+202\d\s+entry/i, '').trim();

  // Check for standard numeric date format DD/MM/YYYY or DD-MM-YYYY
  const numMatch = cleanStr.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](202\d)\b/);
  if (numMatch) {
    const d = parseInt(numMatch[1], 10);
    const m = parseInt(numMatch[2], 10);
    const y = parseInt(numMatch[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return {
        year: y,
        month: m,
        day: d,
        timestamp: new Date(y, m - 1, d).getTime(),
        raw: s
      };
    }
  }

  // Find year associated with the main event
  const yearMatches = cleanStr.match(/\b(202\d)\b/g);
  let year = yearMatches ? parseInt(yearMatches[0], 10) : null;

  // Find month
  let month = null;
  const lower = cleanStr.toLowerCase();
  for (const [mName, mNum] of Object.entries(TIMELINE_MONTHS)) {
    const reg = new RegExp(`\\b${mName}\\b`, 'i');
    if (reg.test(lower)) {
      month = mNum;
      break;
    }
  }

  // Seasons / terms fallback
  if (!month) {
    if (lower.includes('autumn')) month = 10;
    else if (lower.includes('spring')) month = 2;
    else if (lower.includes('summer')) month = 6;
  }

  if (!year) {
    if (month && month >= 8) year = 2026;
    else if (month && month <= 4) year = 2027;
    else year = 2026;
  }

  // Find day
  let day = 15;
  const dayMatch = cleanStr.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (dayMatch) {
    const d = parseInt(dayMatch[1], 10);
    if (d >= 1 && d <= 31 && d !== year) {
      day = d;
    }
  }

  return {
    year,
    month: month || 6,
    day,
    timestamp: new Date(year, (month || 6) - 1, day).getTime(),
    raw: s
  };
}

// --- Semantic Normalization & Noise Elimination Layer ---

function normalizePhoneNumber(val) {
  if (!val || typeof val !== 'string') return '';
  let str = val.replace(/\(0\)/g, '').replace(/[^\d+]/g, '');
  if (str.startsWith('+44')) {
    str = '0' + str.slice(3);
  } else if (str.startsWith('44') && str.length > 10) {
    str = '0' + str.slice(2);
  } else if (str.startsWith('0044')) {
    str = '0' + str.slice(4);
  }
  return str.replace(/\D/g, '');
}

function normalizePostcode(val) {
  if (!val || typeof val !== 'string') return '';
  const clean = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length > 3) {
    return clean.slice(0, -3) + ' ' + clean.slice(-3);
  }
  return clean;
}

function normalizeGenderSemantic(val) {
  if (!val || typeof val !== 'string') return 'Mixed';
  const v = val.toLowerCase().trim();
  if (v.includes('girl') || v === 'f') return 'Girls';
  if (v.includes('boy') || v === 'm') return 'Boys';
  return 'Mixed';
}

function normalizeExamTypeSemantic(val) {
  if (!val || typeof val !== 'string') return 'Comprehensive';
  const v = val.toLowerCase().trim();
  if (v.includes('iseb') || v.includes('common pre-test')) return 'ISEB Common Pre-Test';
  if (v.includes('gl assessment') || v.includes('gl ') || v.includes('gl 11') || v.includes('kent test') || v.includes('bexley') || v.includes('sutton set')) return 'GL Assessment';
  if (v.includes('london 11+') || v.includes('london consortium') || v.includes('consortium')) return 'London 11+ Consortium';
  if (v.includes('csse') || v.includes('essex')) return 'CSSE 11+ Exam';
  if (v.includes('cem')) return 'CEM Assessment';
  if (v.includes('school-own') || (v.includes('school') && v.includes('own'))) return 'School-Own Exam';
  if (v.includes('non-selective') || v.includes('comprehensive') || v.includes('distance') || v.includes('sibling') || v.includes('pan')) return 'Comprehensive';
  return val.trim();
}

function normalizeSchoolNameCanonical(val) {
  if (!val || typeof val !== 'string') return '';
  return val
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/\b(limited|ltd|trust|academy trust|mat|federation|high school|grammar school|school|academy|college)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function isSemanticMatch(field, valA, valB) {
  if (valA === valB) return true;
  if (!valA && !valB) return true;
  if (!valA || !valB) return false;

  const sA = String(valA).trim();
  const sB = String(valB).trim();

  if (sA.toLowerCase() === sB.toLowerCase()) return true;

  if (field === 'phone') {
    const pA = normalizePhoneNumber(sA);
    const pB = normalizePhoneNumber(sB);
    if (!pA || !pB) return false;
    return pA === pB || pA.slice(-8) === pB.slice(-8);
  }

  if (field === 'postcode') {
    return normalizePostcode(sA) === normalizePostcode(sB);
  }

  if (field === 'gender') {
    return normalizeGenderSemantic(sA) === normalizeGenderSemantic(sB);
  }

  if (field === 'entranceExamType') {
    return normalizeExamTypeSemantic(sA) === normalizeExamTypeSemantic(sB);
  }

  if (field.toLowerCase().includes('date') || ['registrationOpen', 'registrationDeadline', 'examDate', 'secondExamDate', 'resultsDate', 'interviewInfo', 'offersAcceptance'].includes(field)) {
    const cleanA = sA.toLowerCase().replace(/[^\w]/g, '');
    const cleanB = sB.toLowerCase().replace(/[^\w]/g, '');
    if (cleanA === cleanB) return true;

    const dA = parseTimelineDate(sA);
    const dB = parseTimelineDate(sB);
    if (dA && dB) {
      // Must be the EXACT same calendar day, month, and year
      return dA.year === dB.year && dA.month === dB.month && dA.day === dB.day;
    }
  }

  return false;
}

// Candidate Duplicate Detection Engine (Persists pairs to retain unless manually re-scanned)
function detectDuplicateCandidatePairs(options = {}) {
  const sqlite = getDb();
  const forceRescan = Boolean(options.forceRescan);

  const reviewed = sqlite.prepare('SELECT pairKey FROM reviewed_pairs').all();
  const reviewedSet = new Set(reviewed.map(r => r.pairKey));

  if (!forceRescan) {
    try {
      const stored = sqlite.prepare(`
        SELECT pairKey, idA, idB, matchReason, similarityScore, smartMergedJson, status, detectedAt
        FROM duplicate_candidate_pairs
        WHERE status = 'pending'
        ORDER BY similarityScore DESC
      `).all();

      if (stored && stored.length > 0) {
        const validPairs = [];
        const schoolStmt = sqlite.prepare(`
          SELECT id, name, urn, la, region, postcode, address, schoolType, gender,
                 website, phone, email, entranceExamType, entranceExamDates,
                 ofstedRating, gcseProgress8, gcseAttainment8, pupilCount
          FROM schools WHERE id = ?
        `);

        for (const row of stored) {
          if (reviewedSet.has(row.pairKey)) continue;
          const a = schoolStmt.get(row.idA);
          const b = schoolStmt.get(row.idB);
          if (!a || !b) {
            // One of the schools was deleted or merged -> mark as resolved
            sqlite.prepare(`UPDATE duplicate_candidate_pairs SET status = 'resolved' WHERE pairKey = ?`).run(row.pairKey);
            continue;
          }
          let smartMerged = {};
          try {
            smartMerged = JSON.parse(row.smartMergedJson);
          } catch (e) {
            smartMerged = createDuplicatePairSummary(a, b, row.matchReason, row.similarityScore, row.pairKey).smartMerged;
          }

          validPairs.push({
            pairKey: row.pairKey,
            matchReason: row.matchReason,
            similarityScore: row.similarityScore,
            probability: row.similarityScore,
            recordA: a,
            recordB: b,
            smartMerged,
            detectedAt: row.detectedAt
          });
        }

        // Sort descending by probability
        validPairs.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));
        return validPairs;
      }
    } catch (e) {
      // Table may not exist yet, proceed with full scan
    }
  }

  // Perform full multi-factor detection scan
  const schools = sqlite.prepare(`
    SELECT id, name, urn, la, region, postcode, address, schoolType, gender,
           website, phone, email, entranceExamType, entranceExamDates,
           ofstedRating, gcseProgress8, gcseAttainment8, pupilCount
    FROM schools
  `).all();

  const urnMap = new Map();
  const postcodeMap = new Map();
  const phoneMap = new Map();

  for (const s of schools) {
    if (s.urn && String(s.urn).trim() && s.urn !== 'N/A' && String(s.urn).trim().length >= 5) {
      const u = String(s.urn).trim();
      if (!urnMap.has(u)) urnMap.set(u, []);
      urnMap.get(u).push(s);
    }
    const pc = normalizePostcode(s.postcode);
    if (pc && pc.length >= 5) {
      if (!postcodeMap.has(pc)) postcodeMap.set(pc, []);
      postcodeMap.get(pc).push(s);
    }
    const ph = normalizePhoneNumber(s.phone);
    if (ph && ph.length >= 9) {
      if (!phoneMap.has(ph)) phoneMap.set(ph, []);
      phoneMap.get(ph).push(s);
    }
  }

  const pairs = [];
  const processedPairKeys = new Set();

  function getPairKey(idA, idB) {
    return [idA, idB].sort().join('___');
  }

  // 1. Exact URN Matches (High Probability: 95% - 100%)
  for (const [urn, group] of urnMap.entries()) {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const key = getPairKey(a.id, b.id);
          if (reviewedSet.has(key) || processedPairKeys.has(key)) continue;
          processedPairKeys.add(key);

          // Calculate precise probability
          let prob = 0.96;
          const nameA = normalizeSchoolNameCanonical(a.name);
          const nameB = normalizeSchoolNameCanonical(b.name);
          const pcA = normalizePostcode(a.postcode);
          const pcB = normalizePostcode(b.postcode);
          if (nameA === nameB || (nameA && nameB && (nameA.includes(nameB) || nameB.includes(nameA)))) prob += 0.03;
          if (pcA && pcB && pcA === pcB) prob += 0.01;
          prob = Math.min(1.0, prob);

          pairs.push(createDuplicatePairSummary(a, b, `Exact DfE URN Match (${urn})`, prob, key));
        }
      }
    }
  }

  // 2. Same Postcode + Fuzzy Name Match (Probability: 85% - 98%)
  for (const [pc, group] of postcodeMap.entries()) {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const key = getPairKey(a.id, b.id);
          if (reviewedSet.has(key) || processedPairKeys.has(key)) continue;

          // Gender policy check: Boys-only vs Girls-only can't be duplicates
          const gA = normalizeGenderSemantic(a.gender);
          const gB = normalizeGenderSemantic(b.gender);
          if ((gA === 'Boys' && gB === 'Girls') || (gA === 'Girls' && gB === 'Boys')) continue;

          const nameA = normalizeSchoolNameCanonical(a.name);
          const nameB = normalizeSchoolNameCanonical(b.name);
          if (!nameA || !nameB) continue;

          if (nameA === nameB) {
            processedPairKeys.add(key);
            let prob = 0.95;
            const phA = normalizePhoneNumber(a.phone);
            const phB = normalizePhoneNumber(b.phone);
            if (phA && phB && phA === phB) prob = 0.99;
            pairs.push(createDuplicatePairSummary(a, b, 'Identical Postcode & Canonical Name', prob, key));
          } else if (nameA.includes(nameB) || nameB.includes(nameA)) {
            processedPairKeys.add(key);
            let prob = 0.88;
            const phA = normalizePhoneNumber(a.phone);
            const phB = normalizePhoneNumber(b.phone);
            if (phA && phB && phA === phB) prob = 0.96;
            pairs.push(createDuplicatePairSummary(a, b, 'Identical Postcode & Name Substring Match', prob, key));
          }
        }
      }
    }
  }

  // 3. Same Phone + High Name Similarity (Probability: 80% - 94%)
  for (const [ph, group] of phoneMap.entries()) {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const key = getPairKey(a.id, b.id);
          if (reviewedSet.has(key) || processedPairKeys.has(key)) continue;

          const nameA = normalizeSchoolNameCanonical(a.name);
          const nameB = normalizeSchoolNameCanonical(b.name);
          if (!nameA || !nameB) continue;

          if (nameA === nameB || nameA.includes(nameB) || nameB.includes(nameA)) {
            processedPairKeys.add(key);
            pairs.push(createDuplicatePairSummary(a, b, 'Identical Contact Telephone & School Name', 0.92, key));
          }
        }
      }
    }
  }

  // Sort pairs strictly by decreasing probability (highest probability first)
  pairs.sort((a, b) => (b.similarityScore || 0) - (a.similarityScore || 0));

  // Persist to duplicate_candidate_pairs table
  try {
    const insertStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO duplicate_candidate_pairs
      (pairKey, idA, idB, matchReason, similarityScore, smartMergedJson, status, detectedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    const now = new Date().toISOString();
    sqlite.exec('BEGIN TRANSACTION;');
    sqlite.prepare(`DELETE FROM duplicate_candidate_pairs WHERE status = 'pending'`).run();
    for (const p of pairs) {
      insertStmt.run(
        p.pairKey,
        p.recordA.id,
        p.recordB.id,
        p.matchReason,
        p.similarityScore,
        JSON.stringify(p.smartMerged),
        now
      );
    }
    sqlite.exec('COMMIT;');
  } catch (dbErr) {
    try { sqlite.exec('ROLLBACK;'); } catch (rb) {}
    console.warn('[Duplicate Detection] Warning saving candidate pairs cache:', dbErr.message);
  }

  return pairs;
}

function createDuplicatePairSummary(recA, recB, matchReason, similarityScore, pairKey) {
  // Pre-calculate smart merged values
  const smartMerged = {
    id: recA.id,
    name: recA.name || recB.name,
    urn: recA.urn && recA.urn !== 'N/A' ? recA.urn : (recB.urn || ''),
    la: recA.la || recB.la,
    region: recA.region || recB.region,
    postcode: recA.postcode || recB.postcode,
    address: (recA.address && recA.address.length > (recB.address || '').length) ? recA.address : (recB.address || recA.address),
    schoolType: recA.schoolType || recB.schoolType,
    gender: recA.gender || recB.gender,
    website: (recA.website && recA.website.includes('.sch.uk')) ? recA.website : (recB.website || recA.website),
    phone: recA.phone || recB.phone,
    email: recA.email || recB.email,
    entranceExamType: recA.entranceExamType || recB.entranceExamType,
    entranceExamDates: recA.entranceExamDates && recA.entranceExamDates !== '{}' ? recA.entranceExamDates : (recB.entranceExamDates || '{}'),
    ofstedRating: (recA.ofstedRating && recA.ofstedRating !== 'N/A') ? recA.ofstedRating : (recB.ofstedRating || recA.ofstedRating),
    gcseProgress8: (recA.gcseProgress8 !== null && recA.gcseProgress8 !== undefined && recA.gcseProgress8 !== '') ? recA.gcseProgress8 : recB.gcseProgress8,
    gcseAttainment8: (recA.gcseAttainment8 !== null && recA.gcseAttainment8 !== undefined && recA.gcseAttainment8 !== '') ? recA.gcseAttainment8 : recB.gcseAttainment8,
    pupilCount: (recA.pupilCount !== null && recA.pupilCount !== undefined && recA.pupilCount !== '') ? recA.pupilCount : recB.pupilCount
  };

  return {
    pairKey,
    matchReason,
    similarityScore,
    probability: similarityScore,
    recordA: recA,
    recordB: recB,
    smartMerged
  };
}

// 1-Click Rollback of a Batch or Merge Action
function rollbackBatchAction(batchId, adminUser = 'Admin') {
  const sqlite = getDb();
  if (!batchId) throw new Error('batchId is required for rollback');

  const logs = sqlite.prepare(`
    SELECT * FROM admin_audit_logs 
    WHERE batchId = ? AND rolledBackAt IS NULL
  `).all(batchId);

  if (logs.length === 0) {
    return { success: false, message: 'No active changes found for this batch, or already rolled back.' };
  }

  const now = new Date().toISOString();
  let restoredCount = 0;

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const markRollbackStmt = sqlite.prepare(`
      UPDATE admin_audit_logs SET rolledBackAt = ? WHERE batchId = ?
    `);

    for (const log of logs) {
      const prev = JSON.parse(log.previousState);
      if (prev && prev.id) {
        insertSchool(prev);
        restoredCount++;
      }
    }

    markRollbackStmt.run(now, batchId);
    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }

  autoSyncAllDateConfidenceScores();

  return {
    success: true,
    batchId,
    restoredCount,
    message: `Successfully rolled back ${restoredCount} school record(s).`
  };
}

// Retrieve complete version and audit history for a specific school
function getSchoolAuditHistory(schoolId) {
  const sqlite = getDb();
  if (!schoolId) return [];

  const logs = sqlite.prepare(`
    SELECT id, actionType, batchId, schoolId, previousState, newState, appliedBy, appliedAt, rolledBackAt
    FROM admin_audit_logs 
    WHERE schoolId = ?
    ORDER BY id DESC
  `).all(schoolId);

  return logs.map(log => {
    let prev = null;
    let next = null;
    try { prev = log.previousState ? JSON.parse(log.previousState) : null; } catch (e) {}
    try { next = log.newState ? JSON.parse(log.newState) : null; } catch (e) {}
    return {
      id: log.id,
      actionType: log.actionType,
      batchId: log.batchId,
      schoolId: log.schoolId,
      previousState: prev,
      newState: next,
      appliedBy: log.appliedBy,
      appliedAt: log.appliedAt,
      rolledBackAt: log.rolledBackAt
    };
  });
}

// Rollback a specific school to a previous version from audit logs
function rollbackSchoolToAuditVersion(schoolId, auditLogId, adminUser = 'Admin Manual Rollback') {
  const sqlite = getDb();
  if (!schoolId) throw new Error('schoolId is required for version rollback');
  if (!auditLogId) throw new Error('auditLogId is required for version rollback');

  const log = sqlite.prepare(`
    SELECT * FROM admin_audit_logs
    WHERE id = ? AND schoolId = ?
  `).get(auditLogId, schoolId);

  if (!log) {
    throw new Error(`Audit log entry #${auditLogId} for school ID "${schoolId}" was not found.`);
  }

  const currentSchool = getSchoolById(schoolId);
  if (!currentSchool) {
    throw new Error(`School with ID "${schoolId}" not found.`);
  }

  let targetState = null;
  try {
    targetState = typeof log.previousState === 'string' ? JSON.parse(log.previousState) : log.previousState;
  } catch (e) {
    throw new Error('Failed to parse previous state snapshot from audit log.');
  }

  if (!targetState || typeof targetState !== 'object') {
    throw new Error('Invalid previous state snapshot found in audit log.');
  }

  const now = new Date().toISOString();
  const rollbackBatchId = `rollback_v_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    // 1. Record rollback action in audit log
    sqlite.prepare(`
      INSERT INTO admin_audit_logs (actionType, batchId, schoolId, previousState, newState, appliedBy, appliedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'MANUAL_VERSION_ROLLBACK',
      rollbackBatchId,
      schoolId,
      JSON.stringify(currentSchool),
      JSON.stringify(targetState),
      adminUser,
      now
    );

    // 2. Mark this audit log record as rolled back
    sqlite.prepare(`
      UPDATE admin_audit_logs
      SET rolledBackAt = ?
      WHERE id = ?
    `).run(now, auditLogId);

    // 3. Prepare fields to restore
    let cleanDatesJson = '{}';
    if (targetState.entranceExamDates && typeof targetState.entranceExamDates === 'object') {
      cleanDatesJson = JSON.stringify(targetState.entranceExamDates);
    } else if (typeof targetState.entranceExamDates === 'string') {
      cleanDatesJson = targetState.entranceExamDates;
    }

    let tagsJson = '[]';
    if (Array.isArray(targetState.verification_tags)) {
      tagsJson = JSON.stringify(targetState.verification_tags);
    } else if (typeof targetState.verification_tags === 'string') {
      tagsJson = targetState.verification_tags;
    }

    sqlite.prepare(`
      UPDATE schools
      SET name = COALESCE(?, name),
          schoolType = COALESCE(?, schoolType),
          rawSchoolType = COALESCE(?, rawSchoolType),
          la = COALESCE(?, la),
          region = COALESCE(?, region),
          postcode = COALESCE(?, postcode),
          address = COALESCE(?, address),
          website = ?,
          phone = ?,
          email = ?,
          gender = ?,
          entranceExamType = ?,
          entranceExamDates = ?,
          verification_status = ?,
          verification_tags = ?,
          verified_at = ?,
          confidence_score = ?
      WHERE id = ?
    `).run(
      targetState.name,
      targetState.schoolType,
      targetState.rawSchoolType,
      targetState.la,
      targetState.region,
      targetState.postcode,
      targetState.address,
      targetState.website || null,
      targetState.phone || null,
      targetState.email || null,
      targetState.gender || 'Mixed',
      targetState.entranceExamType || 'Unknown',
      cleanDatesJson,
      targetState.verification_status || 'unverified',
      tagsJson,
      now,
      targetState.confidence_score || 70,
      schoolId
    );

    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }

  const restoredSchool = getSchoolById(schoolId);
  return {
    success: true,
    schoolId,
    auditLogId,
    rollbackBatchId,
    restoredSchool,
    message: `Successfully rolled back ${restoredSchool.name} to version from ${new Date(log.appliedAt).toLocaleString('en-GB')}.`
  };
}

// Atomic Merge School Records (Preserving User Portfolios & Relational Integrity)
function mergeSchoolsAtomic(primaryId, candidateId, fieldOverrides = {}, adminUser = 'Admin Merge') {
  const sqlite = getDb();
  const primary = getSchoolById(primaryId);
  const candidate = getSchoolById(candidateId);

  if (!primary || !candidate) {
    throw new Error('Both primary and candidate schools must exist to execute a merge.');
  }

  const batchId = `merge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const logStmt = sqlite.prepare(`
      INSERT INTO admin_audit_logs (actionType, batchId, schoolId, previousState, newState, appliedBy, appliedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. Log previous states
    logStmt.run('MERGE_PRIMARY_PREV', batchId, primaryId, JSON.stringify(primary), '', adminUser, now);
    logStmt.run('MERGE_CANDIDATE_PREV', batchId, candidateId, JSON.stringify(candidate), '', adminUser, now);

    // 2. Re-point user portfolios referencing candidateId to primaryId
    const portfolios = sqlite.prepare('SELECT userId, cafRankings, independentSchools FROM user_portfolios').all();
    const updatePortfolioStmt = sqlite.prepare(`
      UPDATE user_portfolios SET cafRankings = ?, independentSchools = ? WHERE userId = ?
    `);

    for (const p of portfolios) {
      let changed = false;
      let caf = [];
      let ind = [];
      try { caf = JSON.parse(p.cafRankings || '[]'); } catch (e) {}
      try { ind = JSON.parse(p.independentSchools || '[]'); } catch (e) {}

      caf = caf.map(item => {
        if (item === candidateId || item.schoolId === candidateId || item.id === candidateId) {
          changed = true;
          return typeof item === 'string' ? primaryId : { ...item, schoolId: primaryId, id: primaryId };
        }
        return item;
      });

      ind = ind.map(item => {
        if (item === candidateId || item.schoolId === candidateId || item.id === candidateId) {
          changed = true;
          return typeof item === 'string' ? primaryId : { ...item, schoolId: primaryId, id: primaryId };
        }
        return item;
      });

      if (changed) {
        updatePortfolioStmt.run(JSON.stringify(caf), JSON.stringify(ind), p.userId);
      }
    }

    // 3. Re-point feedback votes, reviews and field reports safely without violating UNIQUE constraints
    sqlite.prepare('UPDATE OR IGNORE user_field_reports SET schoolId = ? WHERE schoolId = ?').run(primaryId, candidateId);
    sqlite.prepare('DELETE FROM user_field_reports WHERE schoolId = ?').run(candidateId);

    sqlite.prepare('UPDATE OR IGNORE field_confidence_votes SET schoolId = ? WHERE schoolId = ?').run(primaryId, candidateId);
    sqlite.prepare('DELETE FROM field_confidence_votes WHERE schoolId = ?').run(candidateId);

    sqlite.prepare('UPDATE OR IGNORE admin_field_reviews SET schoolId = ? WHERE schoolId = ?').run(primaryId, candidateId);
    sqlite.prepare('DELETE FROM admin_field_reviews WHERE schoolId = ?').run(candidateId);

    // 4. Mark candidate pair as reviewed
    const pairKey = [primaryId, candidateId].sort().join('___');
    sqlite.prepare(`
      INSERT OR REPLACE INTO reviewed_pairs (pairKey, idA, idB, reviewedAt)
      VALUES (?, ?, ?, ?)
    `).run(pairKey, primaryId, candidateId, now);

    // 5. Build merged record
    const pairSummary = createDuplicatePairSummary(primary, candidate, 'Admin Side-by-Side Merge', 1.0, pairKey);
    const mergedRecord = {
      ...pairSummary.smartMerged,
      ...fieldOverrides,
      id: primaryId,
      verification_status: 'auto_verified',
      confidence_score: 98,
      verified_at: now
    };

    insertSchool(mergedRecord);

    // 6. Delete or archive candidate
    deleteSchool(candidateId);

    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }

  autoSyncAllDateConfidenceScores();

  return {
    success: true,
    batchId,
    primarySchool: getSchoolById(primaryId),
    message: `Merged "${candidate.name}" into "${primary.name}" successfully.`
  };
}

function saveSchoolVerificationResult(schoolId, scanResult) {
  const sqlite = getDb();
  const school = getSchoolById(schoolId);
  if (!school) return null;

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const updateStmt = sqlite.prepare(`
      UPDATE schools
      SET verification_status = ?,
          verification_tags = ?,
          verification_report = ?,
          verified_at = ?,
          confidence_score = ?
      WHERE id = ?
    `);

    updateStmt.run(
      scanResult.status || 'unverified',
      JSON.stringify(scanResult.tags || []),
      JSON.stringify(scanResult),
      scanResult.verifiedAt || new Date().toISOString(),
      scanResult.confidenceScore || 70,
      schoolId
    );

    // If auto_verified, boost confidence votes
    if (scanResult.tags && scanResult.tags.includes('auto_verified')) {
      const voteStmt = sqlite.prepare(`
        INSERT OR REPLACE INTO field_confidence_votes (userId, schoolId, fieldName, vote, votedAt)
        VALUES (?, ?, ?, 1, ?)
      `);
      const now = new Date().toISOString();
      const fields = ['entranceExamDates', 'website', 'phone', 'email', 'entranceExamType', 'gender'];
      for (const f of fields) {
        voteStmt.run('system_crawler_verifier', schoolId, f, now);
      }
    }

    sqlite.exec('COMMIT;');
  } catch (e) {
    sqlite.exec('ROLLBACK;');
    throw e;
  }

  return getSchoolById(schoolId);
}

function getSchoolsForScannerBatch(priorityCategory = 'ALL', limit = 50, skipDaysOverride = null) {
  const sqlite = getDb();
  const conditions = [];
  const params = [];

  switch (priorityCategory.toUpperCase()) {
    case 'LONDON_INDEPENDENT':
      conditions.push("schoolType = 'Independent' AND (region = 'Greater London' OR la IN ('Barnet','Bexley','Brent','Bromley','Camden','Croydon','Ealing','Enfield','Greenwich','Hackney','Hammersmith and Fulham','Haringey','Harrow','Havering','Hillingdon','Hounslow','Islington','Kensington and Chelsea','Kingston upon Thames','Lambeth','Lewisham','Merton','Newham','Redbridge','Richmond upon Thames','Southwark','Sutton','Tower Hamlets','Waltham Forest','Wandsworth','Westminster'))");
      break;
    case 'ALL_INDEPENDENT':
      conditions.push("schoolType = 'Independent'");
      break;
    case 'GRAMMAR':
      conditions.push("schoolType = 'Grammar'");
      break;
    case 'STATE_COMPREHENSIVE':
      conditions.push("schoolType = 'Comprehensive'");
      break;
    case 'UNVERIFIED':
    case 'UNVERIFIED_QUEUE':
      conditions.push("(verified_at IS NULL OR TRIM(verified_at) = '' OR verification_status IS NULL OR verification_status = 'unverified')");
      break;
    case 'CRITICAL':
    case 'CRITICAL_INVERSIONS':
      conditions.push("(verification_status = 'has_anomalies' OR verification_tags LIKE '%date_inversion%' OR verification_tags LIKE '%historical_date_stale%')");
      break;
    case 'SMART':
    case 'SMART_UPDATES':
      conditions.push("(verification_tags LIKE '%historical_date_stale%' OR verification_tags LIKE '%date_mismatch%')");
      break;
    case 'MISSING_INFO':
    case 'MISSING_WEBSITES':
      conditions.push("(website IS NULL OR TRIM(website) = '' OR website = 'N/A' OR verification_tags LIKE '%missing_website%' OR verification_tags LIKE '%dead_website%' OR verification_tags LIKE '%auto_verification_data_missing%')");
      break;
    default:
      break;
  }

  // Check skipDays configuration (0 = scan every time, max 100 days, default 10)
  const skipDays = skipDaysOverride !== null 
    ? Math.max(0, Math.min(100, parseInt(skipDaysOverride, 10) || 0)) 
    : getSystemSetting('scannerSkipDays', 10);

  if (skipDays > 0) {
    const cutoffDate = new Date(Date.now() - skipDays * 24 * 60 * 60 * 1000).toISOString();
    conditions.push('(verified_at IS NULL OR verified_at < ?)');
    params.push(cutoffDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const query = `
    SELECT id, name, schoolType, rawSchoolType, la, region, postcode, address,
           website, phone, email, gender, entranceExamType, entranceExamDates,
           verification_status, verification_tags, verified_at, confidence_score
    FROM schools
    ${whereClause}
    ORDER BY 
      CASE 
        WHEN (verified_at IS NULL OR TRIM(verified_at) = '') AND (verification_status IS NULL OR verification_status = 'unverified' OR verification_status = 'unscanned') THEN 0 
        WHEN (verification_tags IS NULL OR (verification_tags NOT LIKE '%llm_enriched%' AND verification_tags NOT LIKE '%llm_verified%' AND verification_tags NOT LIKE '%gemini_crawl%' AND verification_tags NOT LIKE '%chatgpt_crawl%')) THEN 1
        WHEN verified_at IS NULL OR TRIM(verified_at) = '' THEN 2
        WHEN verification_status = 'has_anomalies' THEN 3
        ELSE 4 
      END ASC,
      CASE WHEN verified_at IS NULL THEN 0 ELSE 1 END ASC,
      verified_at ASC,
      id ASC
    LIMIT ?
  `;

  return sqlite.prepare(query).all(...params);
}

function applyScannerFixes(schoolId, fixes = {}, reviewedBy = 'Admin Scanner Fix') {
  const sqlite = getDb();
  const school = getSchoolById(schoolId);
  if (!school) return null;

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const fieldsToUpdate = [];
    const values = [];

    if (fixes.entranceExamDates) {
      fieldsToUpdate.push('entranceExamDates = ?');
      values.push(typeof fixes.entranceExamDates === 'string' ? fixes.entranceExamDates : JSON.stringify(fixes.entranceExamDates));
    }
    if (fixes.entranceExamType) {
      fieldsToUpdate.push('entranceExamType = ?');
      values.push(fixes.entranceExamType);
    }
    if (fixes.gender) {
      fieldsToUpdate.push('gender = ?');
      values.push(fixes.gender);
    }
    if (fixes.phone) {
      fieldsToUpdate.push('phone = ?');
      values.push(fixes.phone);
    }
    if (fixes.email) {
      fieldsToUpdate.push('email = ?');
      values.push(fixes.email);
    }
    if (fixes.website) {
      fieldsToUpdate.push('website = ?');
      values.push(fixes.website);
    }
    if (fixes.postcode) {
      fieldsToUpdate.push('postcode = ?');
      values.push(fixes.postcode);
    }
    if (fixes.address) {
      fieldsToUpdate.push('address = ?');
      values.push(fixes.address);
    }

    // Always mark as auto_verified with high confidence on applied fix and clear pre-fix scanner anomalies
    fieldsToUpdate.push('verification_status = ?');
    values.push('auto_verified');

    fieldsToUpdate.push('verification_tags = ?');
    values.push(JSON.stringify(['auto_verified']));

    fieldsToUpdate.push('verification_report = ?');
    values.push(JSON.stringify({ status: 'auto_verified', anomalies: [], resolvedAt: new Date().toISOString() }));

    fieldsToUpdate.push('confidence_score = ?');
    values.push(98);

    fieldsToUpdate.push('verified_at = ?');
    values.push(new Date().toISOString());

    values.push(schoolId);

    const stmt = sqlite.prepare(`UPDATE schools SET ${fieldsToUpdate.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    // Record admin review and vote confidence boost
    const now = new Date().toISOString();
    const markReviewStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO admin_field_reviews (schoolId, fieldName, reviewedBy, reviewedAt)
      VALUES (?, ?, ?, ?)
    `);
    const voteStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO field_confidence_votes (userId, schoolId, fieldName, vote, votedAt)
      VALUES (?, ?, ?, 1, ?)
    `);

    const fields = ['entranceExamDates', 'entranceExamType', 'gender', 'phone', 'email', 'website'];
    for (const f of fields) {
      markReviewStmt.run(schoolId, f, reviewedBy, now);
      voteStmt.run('system_quality_auto', schoolId, f, now);
    }

    sqlite.exec('COMMIT;');
  } catch (e) {
    sqlite.exec('ROLLBACK;');
    throw e;
  }

  return getSchoolById(schoolId);
}

function getDataQualitySummary() {
  const database = getDb();
  const total = database.prepare('SELECT COUNT(*) as c FROM schools').get().c;

  const schoolTypes = database.prepare('SELECT schoolType, COUNT(*) as c FROM schools GROUP BY schoolType').all();
  const schoolTypeMap = {};
  for (const st of schoolTypes) schoolTypeMap[st.schoolType || 'Unknown'] = st.c;

  const blankExamTypes = database.prepare("SELECT COUNT(*) as c FROM schools WHERE entranceExamType IS NULL OR entranceExamType = ''").get().c;
  const blankDates = database.prepare("SELECT COUNT(*) as c FROM schools WHERE entranceExamDates IS NULL OR entranceExamDates = '' OR entranceExamDates = '{}'").get().c;

  const topExamTypes = database.prepare(`
    SELECT entranceExamType, COUNT(*) as c
    FROM schools
    WHERE entranceExamType IS NOT NULL AND entranceExamType != ''
    GROUP BY entranceExamType
    ORDER BY c DESC
    LIMIT 10
  `).all();

  return {
    totalSchools: total,
    schoolTypes: schoolTypeMap,
    examTypeCoverage: {
      filled: total - blankExamTypes,
      blank: blankExamTypes,
      percentage: total > 0 ? Math.round(((total - blankExamTypes) / total) * 100) : 0
    },
    datesCoverage: {
      filled: total - blankDates,
      blank: blankDates,
      percentage: total > 0 ? Math.round(((total - blankDates) / total) * 100) : 0
    },
    topExamTypes
  };
}

function generateEnrichmentPreview() {
  const database = getDb();
  const matrixPath = path.join(__dirname, 'data', 'admissions_knowledge_matrix.json');
  let matrix = { state_consortia: [], independent_consortia: [] };
  try {
    if (fs.existsSync(matrixPath)) {
      matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
    }
  } catch (e) {}

  const standardStateDates = {
    registrationOpen: '1 September 2026',
    registrationDeadline: '31 October 2026',
    examDate: 'N/A (Non-selective Admissions)',
    secondExamDate: null,
    resultsDate: '1 March 2027',
    interviewInfo: 'None',
    offersAcceptance: '15 March 2027'
  };

  const faithStateDates = {
    registrationOpen: '1 September 2026',
    registrationDeadline: '31 October 2026',
    examDate: 'N/A (Faith Priority Criteria)',
    secondExamDate: null,
    resultsDate: '1 March 2027',
    interviewInfo: 'None (Supplementary Information Form [SIF] Required)',
    offersAcceptance: '15 March 2027'
  };

  const bandingStateDates = {
    registrationOpen: '1 September 2026',
    registrationDeadline: '31 October 2026',
    examDate: '14 November 2026',
    secondExamDate: null,
    resultsDate: '1 March 2027',
    interviewInfo: 'None',
    offersAcceptance: '15 March 2027'
  };

  const aptitudeStateDates = {
    registrationOpen: '1 September 2026',
    registrationDeadline: '11 September 2026',
    examDate: '3 October 2026',
    secondExamDate: null,
    resultsDate: '1 March 2027',
    interviewInfo: 'Audition / Practical Assessment (if applicable)',
    offersAcceptance: '15 March 2027'
  };

  const standardIndepDates = {
    registrationOpen: '1 June 2026',
    registrationDeadline: '13 November 2026',
    examDate: '9 January 2027',
    secondExamDate: null,
    resultsDate: '12 February 2027',
    interviewInfo: '16 January 2027',
    offersAcceptance: '5 March 2027'
  };

  const prepJuniorDates = {
    registrationOpen: '1 June 2026',
    registrationDeadline: '20 November 2026',
    examDate: '9 January 2027',
    secondExamDate: null,
    resultsDate: '12 February 2027',
    interviewInfo: '16 January 2027',
    offersAcceptance: '5 March 2027'
  };

  const sendIndepDates = {
    registrationOpen: '1 September 2026',
    registrationDeadline: '31 October 2026',
    examDate: '11 January 2027',
    secondExamDate: null,
    resultsDate: '12 February 2027',
    interviewInfo: '18 January 2027',
    offersAcceptance: '5 March 2027'
  };

  const swHertsDates = {
    registrationOpen: '11 May 2026',
    registrationDeadline: '19 June 2026',
    examDate: '5 September 2026',
    secondExamDate: '7 September 2026',
    resultsDate: '16 October 2026',
    interviewInfo: 'None',
    offersAcceptance: 'CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027'
  };

  const schools = database.prepare(`
    SELECT s.*, g.ADMPOL, g.MINORGROUP, g.RELCHAR, g.SCHOOLTYPE as govSchoolType, g.AGELOW, g.AGEHIGH
    FROM schools s
    LEFT JOIN all_schools_gov g ON s.urn = g.URN
  `).all();

  const proposedChanges = [];
  let typeChangesCount = 0;
  let examTypeChangesCount = 0;
  let dateChangesCount = 0;

  for (const s of schools) {
    const normName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const sLa = (s.la || '').toLowerCase().trim();
    const isGovSelective = s.ADMPOL === 'Selective';
    const isIndependent = s.schoolType === 'Independent' || (s.MINORGROUP && s.MINORGROUP.includes('Independent'));

    let proposedType = s.schoolType || 'Comprehensive';
    let proposedRawType = s.rawSchoolType || '';
    let proposedExamType = s.entranceExamType || '';
    let proposedDatesObj = null;

    // 1. SW Herts Consortium
    const isSwHerts = normName.includes('watford grammar') || normName.includes('parmiter') || normName.includes('rickmansworth') || normName.includes('st clement danes') || normName.includes('queens');
    if (isSwHerts) {
      proposedType = 'Grammar';
      proposedRawType = 'Grammar (Partially Selective Academy Converter)';
      proposedExamType = '11+ SW Herts Consortium (GL Assessment & Music Aptitude Test)';
      proposedDatesObj = swHertsDates;
    } else if (isIndependent) {
      // Independent School Logic (11+ Entry Focus)
      const ageLow = s.AGELOW !== null && s.AGELOW !== undefined ? parseInt(s.AGELOW, 10) : null;
      const ageHigh = s.AGEHIGH !== null && s.AGEHIGH !== undefined ? parseInt(s.AGEHIGH, 10) : null;
      const isSend = normName.includes('special') || normName.includes('autism') || normName.includes('dyslexia') || normName.includes('centre') || (s.govSchoolType && s.govSchoolType.toLowerCase().includes('special'));
      const isPrep = (ageHigh !== null && ageHigh <= 13) || normName.includes('prep') || normName.includes('junior') || normName.includes('pre-prep') || normName.includes('primary');
      const isAllThrough = (ageLow !== null && ageLow <= 5 && ageHigh !== null && ageHigh >= 18) || normName.includes('all-through');

      let indMatched = null;
      for (const ic of matrix.independent_consortia) {
        if (ic.schoolKeywords.some(kw => normName.includes(kw.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()))) {
          indMatched = ic;
          break;
        }
      }

      proposedType = 'Independent';
      if (indMatched) {
        proposedRawType = 'Independent Senior School (11–18)';
        proposedExamType = indMatched.examType;
        proposedDatesObj = indMatched.dates;
      } else if (isSend) {
        proposedRawType = 'Independent Special Educational Needs (SEND) School';
        proposedExamType = '11+ Specialist Assessment & EHCP Review';
        proposedDatesObj = sendIndepDates;
      } else if (isPrep && !isAllThrough) {
        proposedRawType = 'Independent Preparatory & Junior School (Age 3–13)';
        proposedExamType = '11+ Senior School Transfer & Common Entrance Assessment';
        proposedDatesObj = prepJuniorDates;
      } else if (isAllThrough) {
        proposedRawType = 'Independent All-Through School (3–18)';
        proposedExamType = '11+ Senior School Entrance Examination (English & Mathematics)';
        proposedDatesObj = standardIndepDates;
      } else {
        proposedRawType = 'Independent Senior School (11–18)';
        proposedExamType = '11+ School Entrance Examination (English, Mathematics & Reasoning)';
        proposedDatesObj = standardIndepDates;
      }
    } else {
      // State School (Grammar or Comprehensive)
      let stateConsortiumMatch = null;
      for (const c of matrix.state_consortia) {
        const nameMatch = c.schoolKeywords.some(kw => normName.includes(kw.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()));
        const laMatch = c.laList.some(laName => sLa.includes(laName.toLowerCase()));
        if (nameMatch || (isGovSelective && laMatch)) {
          stateConsortiumMatch = c;
          break;
        }
      }

      if (!stateConsortiumMatch && isGovSelective) {
        stateConsortiumMatch = {
          name: `${s.la || 'Regional'} 11+ Selective Grammar`,
          examType: `11+ GL Assessment (${s.la || 'Regional'} Selective)`,
          dates: {
            registrationOpen: '1 May 2026',
            registrationDeadline: '3 July 2026',
            examDate: '12 September 2026',
            secondExamDate: null,
            resultsDate: '16 October 2026',
            interviewInfo: 'None',
            offersAcceptance: 'CAF 31 October 2026; National Offer Day 1 March 2027; Accept by 15 March 2027'
          }
        };
      }

      if (stateConsortiumMatch) {
        proposedType = 'Grammar';
        proposedRawType = s.rawSchoolType && s.rawSchoolType.includes('Academy') ? 'Grammar (Academy Converter)' : 'Grammar (State Selective)';
        proposedExamType = stateConsortiumMatch.examType;
        proposedDatesObj = stateConsortiumMatch.dates;
      } else {
        // State Comprehensive
        proposedType = 'Comprehensive';
        const relChar = (s.RELCHAR || '').trim();
        const minorGroup = s.MINORGROUP || (s.rawSchoolType && !s.rawSchoolType.includes('Comprehensive') ? s.rawSchoolType : 'Academy Converter');
        const hasFaith = relChar && !['None', 'Does not apply', 'Not applicable'].includes(relChar);
        const isBanding = normName.includes('academy') && (normName.includes('city') || normName.includes('harris') || normName.includes('ark') || normName.includes('oasis') || normName.includes('mossbourne'));
        const isAptitude = normName.includes('performing arts') || normName.includes('music') || normName.includes('technology') || normName.includes('sports') || normName.includes('maths and science') || normName.includes('bilingual');

        if (isAptitude) {
          proposedExamType = 'Specialist Aptitude Assessment (Aptitude test up to 10% under School Admissions Code)';
          proposedDatesObj = aptitudeStateDates;
          proposedRawType = `${minorGroup} (Specialist Aptitude Stream)`;
        } else if (hasFaith) {
          proposedExamType = `Faith-based Admissions (${relChar} - Supplementary Information Form [SIF] Required)`;
          proposedDatesObj = faithStateDates;
          proposedRawType = `${minorGroup} (${relChar})`;
        } else if (isBanding) {
          proposedExamType = 'Fair Banding Assessment (Non-selective NFER/GL Banding Test)';
          proposedDatesObj = bandingStateDates;
          proposedRawType = `${minorGroup} (Fair Banding)`;
        } else {
          proposedExamType = 'Non-selective (Distance & Sibling Criteria - Local Authority CAF)';
          proposedDatesObj = standardStateDates;
          proposedRawType = minorGroup;
        }
      }
    }

    const proposedDatesStr = proposedDatesObj ? JSON.stringify(proposedDatesObj) : s.entranceExamDates;

    // Check for differences
    const diffFields = [];
    if (proposedType !== s.schoolType) {
      diffFields.push('schoolType');
      typeChangesCount++;
    }
    if (proposedRawType && proposedRawType !== s.rawSchoolType) {
      diffFields.push('rawSchoolType');
    }
    if (proposedExamType && proposedExamType !== s.entranceExamType) {
      diffFields.push('entranceExamType');
      examTypeChangesCount++;
    }
    if (proposedDatesStr && proposedDatesStr !== s.entranceExamDates) {
      // Check if structurally different
      let isDifferent = true;
      try {
        if (s.entranceExamDates) {
          const curObj = JSON.parse(s.entranceExamDates);
          if (JSON.stringify(curObj) === JSON.stringify(proposedDatesObj)) isDifferent = false;
        }
      } catch (e) {}
      if (isDifferent) {
        diffFields.push('entranceExamDates');
        dateChangesCount++;
      }
    }

    if (diffFields.length > 0) {
      const sources = [];

      // 1. DfE Government Record Link (if URN exists)
      if (s.urn) {
        sources.push({
          title: `DfE Get Information About Schools (URN ${s.urn})`,
          url: `https://get-information-schools.service.gov.uk/Establishments/Establishment/Detail/${s.urn}`,
          type: 'dfe'
        });
        sources.push({
          title: 'DfE School Performance & Admissions Table',
          url: `https://www.compare-school-performance.service.gov.uk/school/${s.urn}`,
          type: 'dfe'
        });
      }

      // 2. Consortium / Statutory Policy Authority Source Link
      if (isSwHerts) {
        sources.push({
          title: 'SW Herts Schools Consortium Official Admissions',
          url: 'https://www.swhertsschools.org.uk',
          type: 'consortium'
        });
      } else if (isIndependent) {
        if (proposedExamType.includes('London 11+ Consortium')) {
          sources.push({
            title: 'The London 11+ Girls\' Consortium Official Schedule',
            url: 'https://www.london11plusconsortium.co.uk',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('ISEB')) {
          sources.push({
            title: 'Independent Schools Examinations Board (ISEB CPT)',
            url: 'https://www.iseb.co.uk/assessments/common-pre-test/',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('GDST')) {
          sources.push({
            title: 'Girls\' Day School Trust (GDST) Admissions',
            url: 'https://www.gdst.net',
            type: 'consortium'
          });
        } else {
          sources.push({
            title: 'Independent Schools Council (ISC) Admissions Standards',
            url: 'https://www.isc.co.uk',
            type: 'statutory'
          });
        }
      } else if (proposedType === 'Grammar') {
        if (proposedExamType.includes('Kent Test')) {
          sources.push({
            title: 'Kent County Council 11+ Secondary Transfer (PESE)',
            url: 'https://www.kent.gov.uk/education-and-children/schools/school-places/kent-test',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('Sutton SET')) {
          sources.push({
            title: 'Sutton Selective Eligibility Test (SET) Authority',
            url: 'https://www.sutton.gov.uk/w/transfer-to-secondary-school',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('CSSE')) {
          sources.push({
            title: 'Consortium of Selective Schools in Essex (CSSE)',
            url: 'https://csse.org.uk',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('Bexley')) {
          sources.push({
            title: 'Bexley 11+ Selection Test Portal',
            url: 'https://www.bexley.gov.uk/services/schools-and-education/secondary-schools/bexley-selection-test',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('Tiffin')) {
          sources.push({
            title: 'Kingston Selective Admissions (Tiffin Stage 1 & 2)',
            url: 'https://www.tiffingirls.org/admissions/',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('Buckinghamshire')) {
          sources.push({
            title: 'The Buckinghamshire Grammar Schools (TBGS)',
            url: 'https://www.thebucksgrammarschools.org',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('Birmingham')) {
          sources.push({
            title: 'King Edward VI Foundation Grammar Admissions',
            url: 'https://www.schoolsofkingedwardvi.co.uk/admissions/',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('Trafford')) {
          sources.push({
            title: 'Trafford Grammar Schools Consortium Testing',
            url: 'https://www.trafford.gov.uk/residents/schools/school-admissions/secondary-school-admissions.aspx',
            type: 'consortium'
          });
        } else if (proposedExamType.includes('Redbridge')) {
          sources.push({
            title: 'London Borough of Redbridge 11+ Admissions',
            url: 'https://www.redbridge.gov.uk/schools/redbridge-11-plus/',
            type: 'consortium'
          });
        } else {
          sources.push({
            title: 'National Grammar Schools Association & Statutory Code',
            url: 'https://www.gov.uk/government/publications/school-admissions-code--2',
            type: 'statutory'
          });
        }
      } else {
        // State Comprehensive
        sources.push({
          title: 'Pan-London eAdmissions & Statutory LA CAF Timetable',
          url: 'https://www.eadmissions.org.uk',
          type: 'statutory'
        });
        sources.push({
          title: 'Department for Education - School Admissions Code',
          url: 'https://www.gov.uk/government/publications/school-admissions-code--2',
          type: 'statutory'
        });
      }

      // 3. School's Own Website Link (if present)
      if (s.website && s.website.trim() && s.website !== 'N/A') {
        let webUrl = s.website.trim();
        if (!webUrl.startsWith('http://') && !webUrl.startsWith('https://')) {
          webUrl = 'https://' + webUrl;
        }
        sources.push({
          title: `${s.name} Official Website`,
          url: webUrl,
          type: 'school'
        });
      }

      proposedChanges.push({
        schoolId: s.id,
        schoolUrn: s.urn,
        schoolName: s.name,
        la: s.la,
        region: s.region,
        current: {
          schoolType: s.schoolType,
          rawSchoolType: s.rawSchoolType,
          entranceExamType: s.entranceExamType,
          entranceExamDates: s.entranceExamDates
        },
        proposed: {
          schoolType: proposedType,
          rawSchoolType: proposedRawType,
          entranceExamType: proposedExamType,
          entranceExamDates: proposedDatesStr
        },
        changedFields: diffFields,
        summary: `Update: ${diffFields.join(', ')}`,
        sources
      });
    }
  }

  return {
    totalSchoolsScanned: schools.length,
    totalSchoolsWithChanges: proposedChanges.length,
    stats: {
      typeChangesCount,
      examTypeChangesCount,
      dateChangesCount
    },
    proposedChanges
  };
}

function commitEnrichmentChanges(acceptedChanges, adminUser = 'Admin') {
  const database = getDb();
  if (!Array.isArray(acceptedChanges) || acceptedChanges.length === 0) {
    return { success: true, count: 0 };
  }

  const updateStmt = database.prepare(`
    UPDATE schools
    SET schoolType = COALESCE(?, schoolType),
        rawSchoolType = COALESCE(?, rawSchoolType),
        entranceExamType = COALESCE(?, entranceExamType),
        entranceExamDates = COALESCE(?, entranceExamDates),
        verification_status = 'auto_verified',
        verification_tags = '["auto_verified"]',
        verification_report = '{"status":"auto_verified","anomalies":[]}',
        confidence_score = 98,
        verified_at = ?
    WHERE id = ?
  `);

  database.exec('BEGIN TRANSACTION;');
  let count = 0;
  const now = new Date().toISOString();
  try {
    for (const item of acceptedChanges) {
      const p = item.proposed || item;
      const sId = item.schoolId || item.id;
      if (!sId || !p) continue;

      updateStmt.run(
        p.schoolType || null,
        p.rawSchoolType || null,
        p.entranceExamType || null,
        p.entranceExamDates || null,
        now,
        sId
      );

      // Record high-confidence verification
      markFieldAdminReviewed(sId, 'entranceExamDates', adminUser);
      markFieldAdminReviewed(sId, 'entranceExamType', adminUser);
      count++;
    }
    database.exec('COMMIT;');
  } catch (err) {
    database.exec('ROLLBACK;');
    throw err;
  }

  autoSyncAllDateConfidenceScores();
  return { success: true, count };
}

function runFullDatabaseEnrichment(adminUser = 'Admin') {
  const preview = generateEnrichmentPreview();
  if (preview.proposedChanges.length > 0) {
    commitEnrichmentChanges(preview.proposedChanges, adminUser);
  }
  autoSyncAllDateConfidenceScores();
  return getDataQualitySummary();
}

module.exports = {
  getDb,
  getAllSchools,
  getSchoolById,
  insertSchool,
  updateSchool,
  bulkUpdateSchools,
  deleteSchool,
  insertSchoolsBulk,
  getAllUsers,
  getUserByEmail,
  insertUser,
  insertUsersBulk,
  getAllPortfolios,
  getPortfolioByUserId,
  savePortfolio,
  insertPortfoliosBulk,
  getAllReviewedPairs,
  insertReviewedPair,
  insertReviewedPairsBulk,
  getRecSettings,
  saveRecSettings,
  getAdminSettings,
  saveAdminSettings,
  getSystemSettings,
  saveSystemSettings,
  getSystemSetting,
  SUPPORTED_GEMINI_MODELS,
  SUPPORTED_OPENAI_MODELS,
  saveSession,
  getSession,
  deleteSession,
  saveFieldReport,
  getUserFieldReports,
  deleteFieldReport,
  getAdminReportedErrors,
  saveUserRecPreferences,
  getUserRecPreferences,
  castFieldConfidenceVote,
  markFieldAdminReviewed,
  getFieldConfidenceStats,
  saveSchoolVerificationResult,
  getSchoolsForScannerBatch,
  applyScannerFixes,
  getDataQualitySummary,
  runFullDatabaseEnrichment,
  generateEnrichmentPreview,
  commitEnrichmentChanges,
  normalizePhoneNumber,
  normalizePostcode,
  normalizeGenderSemantic,
  normalizeExamTypeSemantic,
  normalizeSchoolNameCanonical,
  isSemanticMatch,
  detectDuplicateCandidatePairs,
  rollbackBatchAction,
  getSchoolAuditHistory,
  rollbackSchoolToAuditVersion,
  mergeSchoolsAtomic,
  getActiveDatabaseInstance,
  isTestInstanceActive,
  setActiveDatabaseInstance,
  resetTestDatabaseFromProduction,
  getDatabaseInstancesMetadata,
  DEFAULT_LLM_PROMPT_TEMPLATE
};


