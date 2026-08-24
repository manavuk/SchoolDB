const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '../data/schooldb.sqlite');
const db = new DatabaseSync(dbPath);

console.log('=== RUNNING SCHOOLS GAP RECONCILIATION & INGESTION ===\n');

const londonLas = new Set([
  'Barking and Dagenham', 'Barnet', 'Bexley', 'Brent', 'Bromley', 'Camden', 'City of London',
  'Croydon', 'Ealing', 'Enfield', 'Greenwich', 'Hackney', 'Hammersmith and Fulham', 'Haringey',
  'Harrow', 'Havering', 'Hillingdon', 'Hounslow', 'Islington', 'Kensington and Chelsea',
  'Kingston upon Thames', 'Lambeth', 'Lewisham', 'Merton', 'Newham', 'Redbridge',
  'Richmond upon Thames', 'Southwark', 'Sutton', 'Tower Hamlets', 'Waltham Forest', 'Wandsworth',
  'Westminster'
]);

function deriveRegion(la) {
  return londonLas.has(la) ? 'Greater London' : 'England';
}

function formatAddress(g) {
  const parts = [g.STREET, g.LOCALITY, g.ADDRESS3, g.TOWN].filter(p => p && p.trim() !== '');
  return parts.join(', ');
}

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
    lowerName.includes("queen elizabeth's school, barnet")
  ) {
    return 'Grammar';
  }

  // 3. Comprehensive
  return 'Comprehensive';
}

// 1. Reconcile and update URNs on existing schools where Name + Postcode matches official all_schools_gov
console.log('1. Reconciling official URNs on existing schools...');
const existingSchools = db.prepare('SELECT id, name, urn, postcode, la FROM schools').all();
const allGov = db.prepare(`SELECT * FROM all_schools_gov WHERE (ISSECONDARY = '1' OR ISSECONDARY = 1) AND SCHSTATUS = 'Open'`).all();

const govByPc = new Map();
for (const g of allGov) {
  const pc = (g.POSTCODE || '').toUpperCase().replace(/\s+/g, '');
  if (pc) {
    if (!govByPc.has(pc)) govByPc.set(pc, []);
    govByPc.get(pc).push(g);
  }
}

let updatedUrnCount = 0;
const updateUrnStmt = db.prepare('UPDATE schools SET urn = ? WHERE id = ?');

db.exec('BEGIN TRANSACTION;');
for (const s of existingSchools) {
  const sPc = (s.postcode || '').toUpperCase().replace(/\s+/g, '');
  const sName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (sPc && govByPc.has(sPc)) {
    const candidates = govByPc.get(sPc);
    for (const c of candidates) {
      const cName = (c.SCHNAME || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cName.includes(sName) || sName.includes(cName) || cName === sName) {
        if (s.urn !== c.URN) {
          updateUrnStmt.run(c.URN, s.id);
          s.urn = c.URN;
          updatedUrnCount++;
        }
        break;
      }
    }
  }
}
db.exec('COMMIT;');
console.log(`✓ Reconciled and updated ${updatedUrnCount} official URNs for existing matched schools.`);

// 2. Ingest truly missing open secondary schools
console.log('\n2. Ingesting missing open secondary schools from all_schools_gov...');
const refreshedExisting = db.prepare('SELECT id, name, urn, postcode FROM schools').all();
const existingUrnSet = new Set(refreshedExisting.map(s => s.urn ? s.urn.toString().trim() : '').filter(u => u.length > 0));

const missingGov = [];
for (const g of allGov) {
  const urn = g.URN ? g.URN.toString().trim() : '';
  if (!urn || !existingUrnSet.has(urn)) {
    // Check if name + postcode matches
    const pc = (g.POSTCODE || '').toUpperCase().replace(/\s+/g, '');
    const gName = (g.SCHNAME || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let matched = false;
    if (pc && govByPc.has(pc)) {
      for (const s of refreshedExisting) {
        const sPc = (s.postcode || '').toUpperCase().replace(/\s+/g, '');
        if (sPc === pc) {
          const sName = (s.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (sName.includes(gName) || gName.includes(sName) || sName === gName) {
            matched = true;
            break;
          }
        }
      }
    }
    if (!matched) {
      missingGov.push(g);
    }
  }
}

console.log(`Found ${missingGov.length} truly missing open secondary schools to ingest.`);

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO schools (
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

db.exec('BEGIN TRANSACTION;');
let insertedCount = 0;
for (const g of missingGov) {
  const schoolId = `sch-gov-${g.URN}`;
  const normType = normalizeSchoolType(g.SCHOOLTYPE, g.SCHNAME);
  const region = deriveRegion(g.LANAME);
  const address = formatAddress(g);
  const ageRange = (g.AGELOW && g.AGEHIGH) ? `${g.AGELOW}-${g.AGEHIGH}` : '';
  const examType = (g.ADMPOL === 'Selective' || normType === 'Grammar') ? '11+ / Entrance Exam' : '';

  insertStmt.run(
    schoolId,
    g.SCHNAME || '',
    g.URN || '',
    g.LANAME || '',
    region,
    g.POSTCODE || '',
    address,
    normType,
    g.SCHOOLTYPE || '',
    g.GENDER || 'Mixed',
    ageRange,
    0, // pupilCount
    '', // ofstedRating
    null, // gcseProgress8
    null, // gcseAttainment8
    null, // ebaccAveragePointScore
    examType,
    JSON.stringify([]), // entranceExamDates
    JSON.stringify([]), // gcseSubjects
    g.ADMPOL || 'Non-selective',
    '', // website
    '', // phone
    '', // email
    `${g.SCHNAME} is an official state/independent high school located in ${g.LANAME}, England.`, // description
    1, // official
    0, // hot
    'Gov DfE 2024-2025', // officialDataSource
    g.URN ? `https://www.compare-school-performance.service.gov.uk/school/${g.URN}` : '',
    null, null, null, null, null, null
  );
  insertedCount++;
}
db.exec('COMMIT;');

console.log(`✓ Successfully inserted ${insertedCount} schools into schools table with unique primary keys (sch-gov-URN).`);

// 3. Final Verification
const finalCount = db.prepare('SELECT count(*) as count FROM schools').get().count;
const distinctIds = db.prepare('SELECT count(DISTINCT id) as count FROM schools').get().count;
const grammarCount = db.prepare("SELECT count(*) as count FROM schools WHERE schoolType = 'Grammar'").get().count;
const indepCount = db.prepare("SELECT count(*) as count FROM schools WHERE schoolType = 'Independent'").get().count;
const compCount = db.prepare("SELECT count(*) as count FROM schools WHERE schoolType = 'Comprehensive'").get().count;

console.log('\n=== FINAL VERIFICATION STATS ===');
console.log(`Total records in 'schools': ${finalCount}`);
console.log(`Distinct Primary Key IDs: ${distinctIds}`);
console.log(`- Grammar: ${grammarCount}`);
console.log(`- Independent: ${indepCount}`);
console.log(`- Comprehensive: ${compCount}`);

console.log('\n====================================================');
console.log('🎉 GAP RECONCILIATION & INGESTION COMPLETED SUCCESSFULLY!');
console.log('====================================================');
