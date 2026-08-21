const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

console.log('--- Migrating Database School Types to Grammar / Independent / Comprehensive ---');

const dbPath = path.join(__dirname, '../data/schooldb.sqlite');
const sqlite = new DatabaseSync(dbPath);

// 1. Ensure column rawSchoolType exists
try {
  sqlite.exec('ALTER TABLE schools ADD COLUMN rawSchoolType TEXT;');
  console.log('✓ Added rawSchoolType column to schools table');
} catch (e) {
  console.log('✓ rawSchoolType column already exists');
}

// 2. Fetch all current schools
const rows = sqlite.prepare('SELECT id, name, schoolType, rawSchoolType, ofstedRating FROM schools').all();
console.log(`Processing ${rows.length} schools...`);

function normalizeSchoolType(type, name, ofstedRating) {
  const current = (type || '').trim();
  const lowerType = current.toLowerCase();
  const lowerName = (name || '').toLowerCase();

  // 1. Independent
  if (lowerType.includes('independent') || lowerType.includes('isi') || (ofstedRating && ofstedRating.includes('ISI'))) {
    return 'Independent';
  }

  // 2. Grammar
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

  // 3. Comprehensive
  return 'Comprehensive';
}

const updateStmt = sqlite.prepare('UPDATE schools SET schoolType = ?, rawSchoolType = ? WHERE id = ?');

sqlite.exec('BEGIN TRANSACTION;');
let grammarCount = 0;
let independentCount = 0;
let comprehensiveCount = 0;

for (const row of rows) {
  const origRaw = row.rawSchoolType || row.schoolType || '';
  const newType = normalizeSchoolType(row.schoolType, row.name, row.ofstedRating);
  
  if (newType === 'Grammar') grammarCount++;
  else if (newType === 'Independent') independentCount++;
  else comprehensiveCount++;

  updateStmt.run(newType, origRaw, row.id);
}
sqlite.exec('COMMIT;');

console.log(`✓ Migration committed successfully:`);
console.log(`   - Grammar: ${grammarCount}`);
console.log(`   - Independent: ${independentCount}`);
console.log(`   - Comprehensive: ${comprehensiveCount}`);
console.log(`   - Total: ${rows.length}`);
