const fs = require('fs');
const path = require('path');
const db = require('../db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCHOOLS_FILE = path.join(DATA_DIR, 'schools.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PORTFOLIOS_FILE = path.join(DATA_DIR, 'user_portfolios.json');
const REVIEWED_PAIRS_FILE = path.join(DATA_DIR, 'reviewed_pairs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'recommendation_settings.json');

console.log('--- Starting Migration from JSON Files to SQLite Database ---');

// Initialize DB schema
db.getDb();

// 1. Migrate schools.json
if (fs.existsSync(SCHOOLS_FILE)) {
  try {
    const raw = fs.readFileSync(SCHOOLS_FILE, 'utf8');
    const schools = JSON.parse(raw);
    console.log(`[Schools] Found ${schools.length} records in schools.json. Migrating...`);
    db.insertSchoolsBulk(schools);
    console.log(`[Schools] Successfully migrated ${schools.length} school records.`);
  } catch (err) {
    console.error('[Schools] Error migrating schools.json:', err);
  }
} else {
  console.log('[Schools] schools.json not found, skipping.');
}

// 2. Migrate users.json
if (fs.existsSync(USERS_FILE)) {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const users = JSON.parse(raw);
    console.log(`[Users] Found ${users.length} records in users.json. Migrating...`);
    db.insertUsersBulk(users);
    console.log(`[Users] Successfully migrated ${users.length} user accounts.`);
  } catch (err) {
    console.error('[Users] Error migrating users.json:', err);
  }
} else {
  console.log('[Users] users.json not found, skipping.');
}

// 3. Migrate user_portfolios.json
if (fs.existsSync(PORTFOLIOS_FILE)) {
  try {
    const raw = fs.readFileSync(PORTFOLIOS_FILE, 'utf8');
    const portfolios = JSON.parse(raw);
    const count = Object.keys(portfolios).length;
    console.log(`[Portfolios] Found ${count} user portfolios in user_portfolios.json. Migrating...`);
    db.insertPortfoliosBulk(portfolios);
    console.log(`[Portfolios] Successfully migrated ${count} user portfolios.`);
  } catch (err) {
    console.error('[Portfolios] Error migrating user_portfolios.json:', err);
  }
} else {
  console.log('[Portfolios] user_portfolios.json not found, skipping.');
}

// 4. Migrate reviewed_pairs.json
if (fs.existsSync(REVIEWED_PAIRS_FILE)) {
  try {
    const raw = fs.readFileSync(REVIEWED_PAIRS_FILE, 'utf8');
    const pairs = JSON.parse(raw);
    console.log(`[Reviewed Pairs] Found ${pairs.length} records in reviewed_pairs.json. Migrating...`);
    db.insertReviewedPairsBulk(pairs);
    console.log(`[Reviewed Pairs] Successfully migrated ${pairs.length} reviewed pair records.`);
  } catch (err) {
    console.error('[Reviewed Pairs] Error migrating reviewed_pairs.json:', err);
  }
} else {
  console.log('[Reviewed Pairs] reviewed_pairs.json not found, skipping.');
}

// 5. Migrate recommendation_settings.json
if (fs.existsSync(SETTINGS_FILE)) {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(raw);
    if (settings && settings.weights) {
      console.log(`[Rec Settings] Migrating recommendation weights from recommendation_settings.json...`);
      db.saveRecSettings(settings.weights);
      console.log(`[Rec Settings] Successfully saved recommendation settings.`);
    }
  } catch (err) {
    console.error('[Rec Settings] Error migrating recommendation_settings.json:', err);
  }
} else {
  console.log('[Rec Settings] recommendation_settings.json not found, skipping.');
}

console.log('--- Migration Finished! Summary Check: ---');
console.log(`Total Schools in SQLite: ${db.getAllSchools().length}`);
console.log(`Total Users in SQLite: ${db.getAllUsers().length}`);
console.log(`Total Portfolios in SQLite: ${Object.keys(db.getAllPortfolios()).length}`);
console.log(`Total Reviewed Pairs in SQLite: ${db.getAllReviewedPairs().length}`);
console.log(`Rec Settings in SQLite:`, db.getRecSettings());
