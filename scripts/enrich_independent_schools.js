const { DatabaseSync } = require('node:sqlite');
const path = require('path');

console.log('=== PHASE 3: Enriching Independent School Intelligence & Examination Profiles ===');

const dbPath = path.join(__dirname, '../data/schooldb.sqlite');
const db = new DatabaseSync(dbPath);

const indepSchools = db.prepare(`
  SELECT s.*, g.ADMPOL, g.MINORGROUP, g.RELCHAR, g.SCHOOLTYPE as govSchoolType, g.AGELOW, g.AGEHIGH
  FROM schools s
  LEFT JOIN all_schools_gov g ON s.urn = g.URN
  WHERE s.schoolType = 'Independent'
`).all();

console.log(`Loaded ${indepSchools.length} Independent schools for intelligence enrichment.`);

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

let seniorCount = 0;
let prepCount = 0;
let allThroughCount = 0;
let sendCount = 0;
let alreadyConsortiumCount = 0;

const updateStmt = db.prepare(`
  UPDATE schools
  SET rawSchoolType = ?,
      entranceExamType = ?,
      entranceExamDates = ?
  WHERE id = ?
`);

db.exec('BEGIN TRANSACTION;');

for (const s of indepSchools) {
  const normName = (s.name || '').toLowerCase();
  const ageLow = s.AGELOW !== null && s.AGELOW !== undefined ? parseInt(s.AGELOW, 10) : null;
  const ageHigh = s.AGEHIGH !== null && s.AGEHIGH !== undefined ? parseInt(s.AGEHIGH, 10) : null;

  const isSend = normName.includes('special') || normName.includes('autism') || normName.includes('dyslexia') || normName.includes('centre') || (s.govSchoolType && s.govSchoolType.toLowerCase().includes('special'));
  const isPrep = (ageHigh !== null && ageHigh <= 13) || normName.includes('prep') || normName.includes('junior') || normName.includes('pre-prep') || normName.includes('primary');
  const isAllThrough = (ageLow !== null && ageLow <= 5 && ageHigh !== null && ageHigh >= 18) || normName.includes('all-through');

  // Check if school already has rich consortium exam type (from Phase 1)
  const hasConsortiumExam = s.entranceExamType && (
    s.entranceExamType.includes('London 11+') ||
    s.entranceExamType.includes('ISEB') ||
    s.entranceExamType.includes('GDST')
  );

  let rawType = 'Independent Senior School (11–18)';
  let examType = '11+ School Entrance Examination (English, Mathematics & Reasoning)';
  let datesObj = standardIndepDates;

  if (isSend) {
    rawType = 'Independent Special Educational Needs (SEND) School';
    examType = '11+ Specialist Assessment & EHCP Review';
    datesObj = sendIndepDates;
    sendCount++;
  } else if (isPrep && !isAllThrough) {
    rawType = 'Independent Preparatory & Junior School (Age 3–13)';
    examType = '11+ Senior School Transfer & Common Entrance Assessment';
    datesObj = prepJuniorDates;
    prepCount++;
  } else if (isAllThrough) {
    rawType = 'Independent All-Through School (3–18)';
    examType = hasConsortiumExam ? s.entranceExamType : '11+ Senior School Entrance Examination (English & Mathematics)';
    datesObj = standardIndepDates;
    allThroughCount++;
  } else {
    rawType = 'Independent Senior School (11–18)';
    examType = hasConsortiumExam ? s.entranceExamType : '11+ School Entrance Examination (English, Mathematics & Reasoning)';
    datesObj = standardIndepDates;
    seniorCount++;
  }

  if (hasConsortiumExam) {
    alreadyConsortiumCount++;
    examType = s.entranceExamType;
  }

  updateStmt.run(
    rawType,
    examType,
    JSON.stringify(datesObj),
    s.id
  );
}

db.exec('COMMIT;');

console.log(`✓ Enriched ${seniorCount} Independent Senior Schools.`);
console.log(`✓ Enriched ${allThroughCount} Independent All-Through Schools.`);
console.log(`✓ Enriched ${prepCount} Independent Preparatory & Junior Schools.`);
console.log(`✓ Enriched ${sendCount} Independent Special & SEND Schools.`);
console.log(`✓ Preserved ${alreadyConsortiumCount} Independent Consortia Profiles (ISEB / London 11+ / GDST).`);
console.log(`✓ Total Independent schools enriched: ${indepSchools.length}`);
