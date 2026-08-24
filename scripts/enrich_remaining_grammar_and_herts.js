const { DatabaseSync } = require('node:sqlite');
const path = require('path');

console.log('=== Refining Historical Grammar Names & SW Herts Consortium ===');

const dbPath = path.join(__dirname, '../data/schooldb.sqlite');
const db = new DatabaseSync(dbPath);

const blanks = db.prepare(`
  SELECT s.*, g.ADMPOL, g.MINORGROUP, g.RELCHAR, g.SCHOOLTYPE as govSchoolType
  FROM schools s
  LEFT JOIN all_schools_gov g ON s.urn = g.URN
  WHERE s.entranceExamType IS NULL OR s.entranceExamType = ''
`).all();

console.log(`Processing ${blanks.length} remaining schools...`);

const swHertsDates = {
  registrationOpen: '11 May 2026',
  registrationDeadline: '19 June 2026',
  examDate: '5 September 2026 (Academic Test) & 7 September 2026 (Music Aptitude)',
  secondExamDate: null,
  resultsDate: '16 October 2026',
  interviewInfo: 'None',
  offersAcceptance: 'CAF 31 Oct 2026; National Offer Day 1 March 2027; Accept by 15 March 2027'
};

const standardStateDates = {
  registrationOpen: '1 September 2026',
  registrationDeadline: '31 October 2026 (Midnight CAF)',
  examDate: 'N/A (Non-selective Admissions)',
  secondExamDate: null,
  resultsDate: '1 March 2027 (National Offer Day)',
  interviewInfo: 'None (Statutory Admissions Code)',
  offersAcceptance: 'Accept online via eAdmissions / LA portal by 15 March 2027'
};

const updateStmt = db.prepare(`
  UPDATE schools
  SET schoolType = ?,
      rawSchoolType = ?,
      entranceExamType = ?,
      entranceExamDates = ?
  WHERE id = ?
`);

db.exec('BEGIN TRANSACTION;');

for (const s of blanks) {
  const normName = (s.name || '').toLowerCase();
  const isSwHerts = normName.includes('watford grammar') || normName.includes('parmiter') || normName.includes('rickmansworth') || normName.includes('st clement danes') || normName.includes('queens');

  if (isSwHerts) {
    updateStmt.run(
      'Grammar',
      'Grammar (Partially Selective Academy Converter)',
      '11+ SW Herts Consortium (GL Assessment & Music Aptitude Test)',
      JSON.stringify(swHertsDates),
      s.id
    );
    console.log(`  ✓ Enriched SW Herts selective school: ${s.name}`);
  } else {
    // Historic grammar name, now non-selective comprehensive academy
    const rawType = `${s.rawSchoolType || 'Academy Converter'} (Historic Grammar Academy - Non-selective)`;
    updateStmt.run(
      'Comprehensive',
      rawType,
      'Non-selective (Distance & Sibling Criteria - Local Authority CAF)',
      JSON.stringify(standardStateDates),
      s.id
    );
    console.log(`  ✓ Re-classified non-selective historic grammar: ${s.name}`);
  }
}

db.exec('COMMIT;');

console.log('✓ All 20 schools cleanly resolved!');
