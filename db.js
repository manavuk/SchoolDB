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

  return {
    id: s.id,
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
  getFieldConfidenceStats
};
