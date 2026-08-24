const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

function resolveDatabasePath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }

  const isServerless = Boolean(
    process.env.LAMBDA_TASK_ROOT ||
    process.env.VERCEL ||
    process.env.NETLIFY ||
    process.env.AWS_EXECUTION_ENV ||
    __dirname.startsWith('/var/task')
  );

  if (isServerless) {
    const tmpDbPath = path.join('/tmp', 'schooldb.sqlite');
    const seedDbPath = path.join(__dirname, 'data', 'schooldb.sqlite');

    // Copy initial seed DB from read-only /var/task to writable /tmp if /tmp DB doesn't exist
    try {
      if (fs.existsSync(seedDbPath) && !fs.existsSync(tmpDbPath)) {
        fs.copyFileSync(seedDbPath, tmpDbPath);
      }
    } catch (err) {
      console.warn('Warning: Could not copy seed database to /tmp:', err.message);
    }

    return tmpDbPath;
  }

  const localDataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(localDataDir)) {
    try {
      fs.mkdirSync(localDataDir, { recursive: true });
    } catch (e) {}
  }
  return path.join(localDataDir, 'schooldb.sqlite');
}

const DB_PATH = resolveDatabasePath();

let db = null;

function getDb() {
  if (!db) {
    const targetDir = path.dirname(DB_PATH);
    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch (e) {}
    }

    db = new DatabaseSync(DB_PATH);

    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch (e) {
      try { db.exec('PRAGMA journal_mode = DELETE;'); } catch (err) {}
    }

    initTables();
  }
  return db;
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
      extra_json TEXT
    );
  `);

  // Migration safeguard: add rawSchoolType column if missing
  try {
    sqlite.exec(`ALTER TABLE schools ADD COLUMN rawSchoolType TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // Index for fast search and filtering
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_schools_name ON schools(name);
    CREATE INDEX IF NOT EXISTS idx_schools_la ON schools(la);
    CREATE INDEX IF NOT EXISTS idx_schools_schoolType ON schools(schoolType);
    CREATE INDEX IF NOT EXISTS idx_schools_gender ON schools(gender);
    CREATE INDEX IF NOT EXISTS idx_schools_ofstedRating ON schools(ofstedRating);
    CREATE INDEX IF NOT EXISTS idx_schools_postcode ON schools(postcode);
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
    'pillaiDetails', 'kpsDetails', '_potentialDuplicateOf', '_dedupNote'
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
    entranceExamDates: s.entranceExamDates ? JSON.stringify(s.entranceExamDates) : null,
    gcseSubjects: s.gcseSubjects ? JSON.stringify(s.gcseSubjects) : null,
    admissionsPolicy: s.admissionsPolicy || '',
    website: s.website || '',
    phone: s.phone || '',
    email: s.email || '',
    description: s.description || '',
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
  stmt.run(
    p.id, p.name, p.urn, p.la, p.region, p.postcode, p.address, p.schoolType, p.rawSchoolType, p.gender, p.ageRange,
    p.pupilCount, p.ofstedRating, p.gcseProgress8, p.gcseAttainment8, p.ebaccAveragePointScore,
    p.entranceExamType, p.entranceExamDates, p.gcseSubjects, p.admissionsPolicy, p.website,
    p.phone, p.email, p.description, p.official, p.hot, p.officialDataSource,
    p.compareSchoolPerformanceUrl, p.raw_csv, p.pillaiDetails, p.kpsDetails,
    p.potentialDuplicateOf, p.dedupNote, p.extra_json
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

// System Settings (Feature Flags & Admin Configuration)
function getSystemSettings() {
  const DEFAULT_SETTINGS = {
    parentPortal2Enabled: false
  };

  const sqlite = getDb();
  const rows = sqlite.prepare('SELECT key, value FROM system_settings').all();
  const result = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch (e) {
      result[row.key] = row.value;
    }
  }
  return result;
}

function saveSystemSettings(settings) {
  const sqlite = getDb();
  const stmt = sqlite.prepare(`
    INSERT OR REPLACE INTO system_settings (key, value)
    VALUES (?, ?)
  `);

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    for (const [k, v] of Object.entries(settings)) {
      stmt.run(k, JSON.stringify(v));
    }
    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }
  return getSystemSettings();
}

function getSystemSetting(key, defaultValue = null) {
  const settings = getSystemSettings();
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

function parseTimelineDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  const lowerStr = s.toLowerCase();

  if (
    ['tbc', 'n/a', '—', '-', 'none', 'tbd'].includes(lowerStr) ||
    !s ||
    lowerStr.startsWith('n/a') ||
    lowerStr.startsWith('none') ||
    lowerStr.startsWith('tbc') ||
    lowerStr.startsWith('tbd') ||
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

function analyzeSchoolAdmissionDates(school) {
  const dates = school.entranceExamDates ? (typeof school.entranceExamDates === 'string' ? JSON.parse(school.entranceExamDates) : school.entranceExamDates) : {};
  const p = school.pillaiDetails ? (typeof school.pillaiDetails === 'string' ? JSON.parse(school.pillaiDetails) : school.pillaiDetails) : {};
  const k = school.kpsDetails ? (typeof school.kpsDetails === 'string' ? JSON.parse(school.kpsDetails) : school.kpsDetails) : {};

  // Extract raw dates across all sources
  const regOpenRaw = p.registrationOpens || dates.registrationOpen || null;
  const regCloseRaw = p.registrationDeadline || k.registrationCloseDate || k.registrationCloses || dates.registrationDeadline || null;
  const exam1Raw = p.firstExamDate || k.firstExamDate || dates.examDate || null;
  const exam2Raw = p.secondExamDate || k.secondStageExamDate || dates.secondExamDate || null;
  const results1Raw = p.firstExamResults || k.firstStageResult || dates.resultsDate || null;
  const results2Raw = p.secondExamResults || k.secondStageResult || null;
  const interviewRaw = p.interview || k.interviewGroupActivity || k.interviewsDate || dates.interviewInfo || null;
  const offerRaw = p.offersAcceptance || k.offerDate || null;
  const offerAcceptRaw = k.offerAcceptByDate || null;

  // Check if school has any admissions dates
  const hasAnyDate = [regOpenRaw, regCloseRaw, exam1Raw, exam2Raw, results1Raw, interviewRaw, offerRaw, offerAcceptRaw]
    .some(v => v && typeof v === 'string' && !['tbc', 'n/a', '—', '-', ''].includes(v.trim().toLowerCase()));

  if (!hasAnyDate) {
    return null; // School has no admissions timeline data
  }

  // Parse milestones
  const pRegOpen = parseTimelineDate(regOpenRaw);
  const pRegClose = parseTimelineDate(regCloseRaw);
  const pExam1 = parseTimelineDate(exam1Raw);
  const pExam2 = parseTimelineDate(exam2Raw);
  const pResults1 = parseTimelineDate(results1Raw);
  const pInterview = parseTimelineDate(interviewRaw);
  const pOffer = parseTimelineDate(offerRaw);
  const pOfferAccept = parseTimelineDate(offerAcceptRaw);

  const anomalies = [];
  let penalty = 0;

  // 1. Chronological Inversions Check
  if (pRegOpen && pRegClose && pRegOpen.timestamp > pRegClose.timestamp) {
    anomalies.push({
      type: 'CHRONO_INVERSION',
      severity: 'high',
      field: 'registrationOpen',
      message: `Registration Opens (${regOpenRaw}) is after Registration Deadline (${regCloseRaw})`,
      affected: ['registrationOpen', 'registrationDeadline']
    });
    penalty += 35;
  }

  if (pRegClose && pExam1 && (pRegClose.timestamp - pExam1.timestamp > 2 * 86400000)) {
    anomalies.push({
      type: 'CHRONO_INVERSION',
      severity: 'high',
      field: 'registrationDeadline',
      message: `Registration Deadline (${regCloseRaw}) is after 1st Stage Exam (${exam1Raw})`,
      affected: ['registrationDeadline', 'examDate']
    });
    penalty += 30;
  }

  if (pExam1 && pResults1 && pExam1.timestamp > pResults1.timestamp) {
    const isOfferString = /national offer/i.test(results1Raw) || /march 2027/i.test(results1Raw);
    if (!isOfferString) {
      anomalies.push({
        type: 'CHRONO_INVERSION',
        severity: 'high',
        field: 'examDate',
        message: `1st Stage Exam (${exam1Raw}) is after Exam Results (${results1Raw})`,
        affected: ['examDate', 'resultsDate']
      });
      penalty += 30;
    }
  }

  if (pExam1 && pExam2 && pExam1.timestamp > pExam2.timestamp) {
    anomalies.push({
      type: 'CHRONO_INVERSION',
      severity: 'high',
      field: 'secondExamDate',
      message: `1st Stage Exam (${exam1Raw}) is after 2nd Stage Exam (${exam2Raw})`,
      affected: ['examDate', 'secondExamDate']
    });
    penalty += 25;
  }

  // 2. Outdated Years Check (2023/2024 historical references)
  const dateEntries = [
    { field: 'registrationOpen', val: regOpenRaw },
    { field: 'registrationDeadline', val: regCloseRaw },
    { field: 'examDate', val: exam1Raw },
    { field: 'secondExamDate', val: exam2Raw },
    { field: 'resultsDate', val: results1Raw },
    { field: 'interviewInfo', val: interviewRaw },
    { field: 'offersAcceptance', val: offerRaw }
  ];

  for (const de of dateEntries) {
    if (de.val && typeof de.val === 'string') {
      if (/\b(2023|2024)\b/.test(de.val)) {
        anomalies.push({
          type: 'OUTDATED_CYCLE',
          severity: 'medium',
          field: de.field,
          message: `Historical past year (2023/2024) referenced in ${de.field}: "${de.val}"`,
          affected: [de.field]
        });
        penalty += 20;
      }
    }
  }

  // 3. Source Discrepancies (Pillai vs KPS)
  if (p.firstExamDate && k.firstExamDate && p.firstExamDate !== k.firstExamDate) {
    const pD = parseTimelineDate(p.firstExamDate);
    const kD = parseTimelineDate(k.firstExamDate);
    if (pD && kD && Math.abs(pD.timestamp - kD.timestamp) > 7 * 86400000) {
      anomalies.push({
        type: 'SOURCE_CONFLICT',
        severity: 'medium',
        field: 'examDate',
        message: `Conflicting exam dates between sources: Pillai ("${p.firstExamDate}") vs KPS ("${k.firstExamDate}")`,
        affected: ['examDate']
      });
      penalty += 15;
    }
  }

  // Calculate Base Confidence Score (100 down to 20)
  let qualityScore = Math.max(20, Math.min(95, 90 - penalty));
  if (anomalies.length === 0) qualityScore = 90;

  // Generate Proposed Clean Dates for 2026/2027 Cycle
  const isIndependent = school.schoolType === 'Independent' || (school.rawSchoolType && school.rawSchoolType.toLowerCase().includes('independent'));
  const isGrammar = school.schoolType === 'Grammar' || (school.rawSchoolType && school.rawSchoolType.toLowerCase().includes('grammar'));

  const proposedDates = {
    registrationOpen: regOpenRaw || (isGrammar ? '1 May 2026' : (isIndependent ? 'June 2026' : '1 September 2026')),
    registrationDeadline: regCloseRaw || (isGrammar ? 'July 2026' : (isIndependent ? 'November 2026' : '31 October 2026')),
    examDate: exam1Raw || (isGrammar ? 'September 2026' : (isIndependent ? 'November/December 2026' : 'N/A')),
    secondExamDate: exam2Raw || null,
    resultsDate: results1Raw || (isGrammar ? 'Mid-October 2026' : (isIndependent ? 'December 2026 / January 2027' : '1 March 2027')),
    interviewInfo: interviewRaw || (isIndependent ? 'January 2027' : null),
    offersAcceptance: offerRaw || (isIndependent ? 'Offers mid-Feb 2027; accept early March 2027' : 'National Offer Day 1 March 2027')
  };

  // Correct specific inverted cases in proposed dates
  if (pRegOpen && pRegClose && pRegOpen.timestamp > pRegClose.timestamp) {
    if (pRegOpen.year === 2027 && pRegClose.year === 2026) {
      proposedDates.registrationOpen = proposedDates.registrationOpen.replace(/2027/g, '2026');
    } else if (proposedDates.registrationOpen.includes('1 June 2026') && proposedDates.registrationDeadline.includes('15 May 2026')) {
      proposedDates.registrationOpen = '1 May 2026';
      proposedDates.registrationDeadline = '15 June 2026';
    } else {
      proposedDates.registrationOpen = '1 May 2026';
    }
  }

  // If registration open / close has 2027 for a 2026 autumn exam (e.g. Bexley consortium)
  if (pRegClose && pExam1 && pRegClose.year === 2027 && pExam1.year === 2026) {
    proposedDates.registrationOpen = '1 May 2026';
    proposedDates.registrationDeadline = '3 July 2026 (SIF / 11+ Reg)';
  }

  // Grammar / Selective School with 31 October deadline vs September Exam (31 Oct is CAF deadline, 11+ is July)
  if (pRegClose && pExam1 && pRegClose.timestamp >= pExam1.timestamp) {
    if (isGrammar || proposedDates.examDate.toLowerCase().includes('september')) {
      proposedDates.registrationOpen = '1 May 2026';
      proposedDates.registrationDeadline = '10 July 2026 (11+ Registration; CAF 31 Oct)';
    } else if (isIndependent) {
      if (proposedDates.registrationDeadline.includes('10 November') || proposedDates.registrationDeadline.includes('November')) {
        proposedDates.examDate = 'Late November / December 2026';
      } else if (proposedDates.registrationDeadline.includes('31 October') || proposedDates.registrationDeadline.includes('October')) {
        proposedDates.examDate = 'November/December 2026 (Year 6 Autumn Term)';
      }
    } else {
      // General comprehensive/state with aptitude test
      proposedDates.registrationDeadline = 'Early September 2026';
    }
  }

  // Clean outdated year references in proposed
  for (const [k, v] of Object.entries(proposedDates)) {
    if (typeof v === 'string') {
      proposedDates[k] = v
        .replace(/\b2024\b/g, '2026')
        .replace(/\b2023\b/g, '2026')
        .replace(/\(was[^\)]+\)/gi, '')
        .trim();
    }
  }

  return {
    schoolId: school.id,
    schoolName: school.name,
    schoolType: school.schoolType,
    la: school.la,
    region: school.region,
    qualityScore,
    confidenceLevel: qualityScore >= 80 ? 'High' : (qualityScore >= 60 ? 'Medium' : 'Low'),
    anomaliesCount: anomalies.length,
    anomalies,
    currentDates: {
      registrationOpen: regOpenRaw,
      registrationDeadline: regCloseRaw,
      examDate: exam1Raw,
      secondExamDate: exam2Raw,
      resultsDate: results1Raw,
      interviewInfo: interviewRaw,
      offersAcceptance: offerRaw
    },
    proposedDates
  };
}

function getAllDateAnomalies() {
  const sqlite = getDb();
  const schools = sqlite.prepare('SELECT id, name, schoolType, rawSchoolType, la, region, entranceExamDates, pillaiDetails, kpsDetails FROM schools').all();
  
  const allAnalyzed = schools.map(analyzeSchoolAdmissionDates).filter(Boolean);
  const anomaliesOnly = allAnalyzed.filter(s => s.anomaliesCount > 0);

  const stats = {
    totalSchoolsWithDates: allAnalyzed.length,
    totalAnomalies: anomaliesOnly.length,
    chronoInversions: anomaliesOnly.filter(s => s.anomalies.some(a => a.type === 'CHRONO_INVERSION')).length,
    outdatedCycles: anomaliesOnly.filter(s => s.anomalies.some(a => a.type === 'OUTDATED_CYCLE')).length,
    sourceConflicts: anomaliesOnly.filter(s => s.anomalies.some(a => a.type === 'SOURCE_CONFLICT')).length,
    avgQualityScore: allAnalyzed.length > 0 ? Math.round(allAnalyzed.reduce((acc, s) => acc + s.qualityScore, 0) / allAnalyzed.length) : 0
  };

  return { stats, anomalies: anomaliesOnly, allSchools: allAnalyzed };
}

function applyDateAnomalyFix(schoolId, proposedDates, reviewedBy = 'Admin Reviewer') {
  const sqlite = getDb();
  const school = getSchoolById(schoolId);
  if (!school) return null;

  const existingDates = school.entranceExamDates || {};
  const updatedDates = { ...existingDates, ...proposedDates };

  let pillai = school.pillaiDetails || {};
  if (proposedDates.registrationOpen) pillai.registrationOpens = proposedDates.registrationOpen;
  if (proposedDates.registrationDeadline) pillai.registrationDeadline = proposedDates.registrationDeadline;
  if (proposedDates.examDate) pillai.firstExamDate = proposedDates.examDate;
  if (proposedDates.secondExamDate) pillai.secondExamDate = proposedDates.secondExamDate;
  if (proposedDates.resultsDate) pillai.firstExamResults = proposedDates.resultsDate;
  if (proposedDates.offersAcceptance) pillai.offersAcceptance = proposedDates.offersAcceptance;

  let kps = school.kpsDetails || {};
  if (proposedDates.registrationDeadline) kps.registrationCloseDate = proposedDates.registrationDeadline;
  if (proposedDates.examDate) kps.firstExamDate = proposedDates.examDate;
  if (proposedDates.secondExamDate) kps.secondStageExamDate = proposedDates.secondExamDate;

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    const updateStmt = sqlite.prepare(`
      UPDATE schools 
      SET entranceExamDates = ?, pillaiDetails = ?, kpsDetails = ?
      WHERE id = ?
    `);
    updateStmt.run(JSON.stringify(updatedDates), JSON.stringify(pillai), JSON.stringify(kps), schoolId);

    // Remove legacy low-confidence downvotes and mark as admin reviewed high confidence
    const deleteVotesStmt = sqlite.prepare('DELETE FROM field_confidence_votes WHERE schoolId = ? AND fieldName = ?');
    const markReviewStmt = sqlite.prepare(`
      INSERT OR REPLACE INTO admin_field_reviews (schoolId, fieldName, reviewedBy, reviewedAt)
      VALUES (?, ?, ?, ?)
    `);

    const dateFieldNames = ['entranceExamDates', 'registrationOpen', 'registrationDeadline', 'examDate', 'secondExamDate', 'resultsDate', 'offersAcceptance'];
    const now = new Date().toISOString();
    for (const f of dateFieldNames) {
      deleteVotesStmt.run(schoolId, f);
      markReviewStmt.run(schoolId, f, reviewedBy, now);
    }

    sqlite.exec('COMMIT;');
  } catch (e) {
    sqlite.exec('ROLLBACK;');
    throw e;
  }

  return getSchoolById(schoolId);
}

function applyAllDateAnomalyFixes(reviewedBy = 'Admin Auto-Fix') {
  const { anomalies } = getAllDateAnomalies();
  const updatedSchools = [];
  for (const item of anomalies) {
    const res = applyDateAnomalyFix(item.schoolId, item.proposedDates, reviewedBy);
    if (res) updatedSchools.push(res);
  }
  return updatedSchools;
}

function autoSyncAllDateConfidenceScores() {
  const sqlite = getDb();
  const { allSchools } = getAllDateAnomalies();
  const now = new Date().toISOString();

  const insertVoteStmt = sqlite.prepare(`
    INSERT OR REPLACE INTO field_confidence_votes (userId, schoolId, fieldName, vote, votedAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deleteVoteStmt = sqlite.prepare(`
    DELETE FROM field_confidence_votes WHERE userId = 'system_quality_auto' AND schoolId = ?
  `);

  sqlite.exec('BEGIN TRANSACTION;');
  try {
    for (const s of allSchools) {
      deleteVoteStmt.run(s.schoolId);

      const fieldNames = ['entranceExamDates', 'registrationOpen', 'registrationDeadline', 'examDate', 'resultsDate'];
      if (s.anomaliesCount > 0) {
        // Lower confidence for schools with anomalies
        for (const fn of fieldNames) {
          insertVoteStmt.run('system_quality_auto', s.schoolId, fn, -1, now);
        }
      } else {
        // Boost confidence for schools with clean, verified timeline
        for (const fn of fieldNames) {
          insertVoteStmt.run('system_quality_auto', s.schoolId, fn, 1, now);
        }
      }
    }
    sqlite.exec('COMMIT;');
  } catch (err) {
    sqlite.exec('ROLLBACK;');
    throw err;
  }

  return allSchools.length;
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

  const anomalyData = getAllDateAnomalies();

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
    topExamTypes,
    qualityStats: anomalyData.stats
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
    registrationDeadline: '31 October 2026 (Midnight CAF)',
    examDate: 'N/A (Non-selective Admissions)',
    secondExamDate: null,
    resultsDate: '1 March 2027 (National Offer Day)',
    interviewInfo: 'None (Statutory Admissions Code)',
    offersAcceptance: 'Accept online via eAdmissions / LA portal by 15 March 2027'
  };

  const faithStateDates = {
    registrationOpen: '1 September 2026',
    registrationDeadline: '31 October 2026 (Midnight CAF & SIF Submission)',
    examDate: 'N/A (Faith Priority Criteria)',
    secondExamDate: null,
    resultsDate: '1 March 2027 (National Offer Day)',
    interviewInfo: 'None (Priest / Clergy / Faith SIF Reference)',
    offersAcceptance: 'Accept online via eAdmissions / LA portal by 15 March 2027'
  };

  const bandingStateDates = {
    registrationOpen: '1 September 2026',
    registrationDeadline: '31 October 2026 (Midnight CAF)',
    examDate: 'Late September / October 2026 (Non-selective Fair Banding Assessment)',
    secondExamDate: null,
    resultsDate: '1 March 2027 (National Offer Day)',
    interviewInfo: 'None',
    offersAcceptance: 'Accept online via eAdmissions / LA portal by 15 March 2027'
  };

  const aptitudeStateDates = {
    registrationOpen: '1 September 2026',
    registrationDeadline: '11 September 2026 (Specialist Aptitude Registration; CAF 31 Oct)',
    examDate: 'October 2026 (Specialist Aptitude Assessment)',
    secondExamDate: null,
    resultsDate: '1 March 2027 (National Offer Day)',
    interviewInfo: 'Audition / Practical Assessment (if applicable)',
    offersAcceptance: 'Accept online via eAdmissions / LA portal by 15 March 2027'
  };

  const standardIndepDates = {
    registrationOpen: '1 June 2026',
    registrationDeadline: '6 November 2026',
    examDate: 'January 2027 (Entrance Assessment & Written Papers)',
    secondExamDate: null,
    resultsDate: '12 February 2027',
    interviewInfo: 'January 2027 (Individual interview & group taster session)',
    offersAcceptance: 'Offers posted 12 Feb 2027; Acceptance deadline 5 March 2027'
  };

  const prepJuniorDates = {
    registrationOpen: '1 June 2026',
    registrationDeadline: '20 November 2026',
    examDate: 'January 2027 (7+ / 8+ Junior Assessment & Classroom Activity)',
    secondExamDate: null,
    resultsDate: '12 February 2027',
    interviewInfo: 'January 2027 (Informal student & parent meeting)',
    offersAcceptance: 'Offers posted mid-Feb 2027; Acceptance deadline early March 2027'
  };

  const sendIndepDates = {
    registrationOpen: 'Open Year-Round (Rolling Admissions)',
    registrationDeadline: 'Rolling Basis (Subject to place availability)',
    examDate: 'Bespoke Educational & Specialist Assessment',
    secondExamDate: null,
    resultsDate: 'Within 2-3 weeks of assessment',
    interviewInfo: 'Taster days & multidisciplinary observation',
    offersAcceptance: 'Formal offer made via Local Authority / EHCP agreement'
  };

  const swHertsDates = {
    registrationOpen: '11 May 2026',
    registrationDeadline: '19 June 2026',
    examDate: '5 September 2026 (Academic Test) & 7 September 2026 (Music Aptitude)',
    secondExamDate: null,
    resultsDate: '16 October 2026',
    interviewInfo: 'None',
    offersAcceptance: 'CAF 31 Oct 2026; National Offer Day 1 March 2027; Accept by 15 March 2027'
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
      // Independent School Logic
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
        proposedRawType = 'Independent Senior School';
        proposedExamType = indMatched.examType;
        proposedDatesObj = indMatched.dates;
      } else if (isSend) {
        proposedRawType = 'Independent Special Educational Needs (SEND) School';
        proposedExamType = 'Non-selective SEND Assessment & EHCP Review';
        proposedDatesObj = sendIndepDates;
      } else if (isPrep && !isAllThrough) {
        proposedRawType = 'Independent Preparatory & Junior School';
        proposedExamType = '7+ / 8+ / 11+ Junior School Assessment & Taster Session';
        proposedDatesObj = prepJuniorDates;
      } else if (isAllThrough) {
        proposedRawType = 'Independent All-Through School (3–18)';
        proposedExamType = '11+ / 13+ Senior Entrance Examination & Junior Assessment';
        proposedDatesObj = standardIndepDates;
      } else {
        proposedRawType = 'Independent Senior School (11–18)';
        proposedExamType = '11+ / 13+ School Own Entrance Examination (English, Maths & Reasoning)';
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
            offersAcceptance: 'CAF 31 Oct 2026; National Offer Day 1 March 2027; Accept by 15 March 2027'
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
        entranceExamDates = COALESCE(?, entranceExamDates)
    WHERE id = ?
  `);

  database.exec('BEGIN TRANSACTION;');
  let count = 0;
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
  getSystemSettings,
  saveSystemSettings,
  getSystemSetting,
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
  analyzeSchoolAdmissionDates,
  getAllDateAnomalies,
  applyDateAnomalyFix,
  applyAllDateAnomalyFixes,
  autoSyncAllDateConfidenceScores,
  getDataQualitySummary,
  runFullDatabaseEnrichment,
  generateEnrichmentPreview,
  commitEnrichmentChanges
};


