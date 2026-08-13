const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'schooldb.sqlite');

let db = null;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL;');
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

  // 3. User Portfolios table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_portfolios (
      userId TEXT PRIMARY KEY,
      targetLocation TEXT,
      selectedSchools TEXT,
      removedSchoolIds TEXT,
      savedAt TEXT,
      FOREIGN KEY(userId) REFERENCES users(id)
    );
  `);

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
    try { gcseSubjects = JSON.parse(row.gcseSubjects); } catch (e) { gcseSubjects = row.gcseSubjects; }
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
    schoolType: row.schoolType || '',
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
    'gender', 'ageRange', 'pupilCount', 'ofstedRating', 'gcseProgress8',
    'gcseAttainment8', 'ebaccAveragePointScore', 'entranceExamType',
    'entranceExamDates', 'gcseSubjects', 'admissionsPolicy', 'website',
    'phone', 'email', 'description', 'official', 'hot', 'officialDataSource',
    'compareSchoolPerformanceUrl', '_csv', 'pillaiDetails', 'kpsDetails',
    '_potentialDuplicateOf', '_dedupNote'
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
    schoolType: s.schoolType || '',
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
      id, name, urn, la, region, postcode, address, schoolType, gender, ageRange,
      pupilCount, ofstedRating, gcseProgress8, gcseAttainment8, ebaccAveragePointScore,
      entranceExamType, entranceExamDates, gcseSubjects, admissionsPolicy, website,
      phone, email, description, official, hot, officialDataSource,
      compareSchoolPerformanceUrl, raw_csv, pillaiDetails, kpsDetails,
      potentialDuplicateOf, dedupNote, extra_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `);
  stmt.run(
    p.id, p.name, p.urn, p.la, p.region, p.postcode, p.address, p.schoolType, p.gender, p.ageRange,
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
        id, name, urn, la, region, postcode, address, schoolType, gender, ageRange,
        pupilCount, ofstedRating, gcseProgress8, gcseAttainment8, ebaccAveragePointScore,
        entranceExamType, entranceExamDates, gcseSubjects, admissionsPolicy, website,
        phone, email, description, official, hot, officialDataSource,
        compareSchoolPerformanceUrl, raw_csv, pillaiDetails, kpsDetails,
        potentialDuplicateOf, dedupNote, extra_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
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
        p.id, p.name, p.urn, p.la, p.region, p.postcode, p.address, p.schoolType, p.gender, p.ageRange,
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
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    permissions,
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
      savedAt: null
    };
  }
  return {
    userId: row.userId,
    targetLocation: row.targetLocation || '',
    selectedSchools: row.selectedSchools ? JSON.parse(row.selectedSchools) : [],
    removedSchoolIds: row.removedSchoolIds ? JSON.parse(row.removedSchoolIds) : [],
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
    INSERT OR REPLACE INTO user_portfolios (userId, targetLocation, selectedSchools, removedSchoolIds, savedAt)
    VALUES (?, ?, ?, ?, ?)
  `);
  const savedAt = new Date().toISOString();
  stmt.run(
    userId,
    data.targetLocation || '',
    data.selectedSchools ? JSON.stringify(data.selectedSchools) : JSON.stringify([]),
    data.removedSchoolIds ? JSON.stringify(data.removedSchoolIds) : JSON.stringify([]),
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

module.exports = {
  getDb,
  getAllSchools,
  getSchoolById,
  insertSchool,
  updateSchool,
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
  saveRecSettings
};
