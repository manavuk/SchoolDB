const assert = require('assert');
const db = require('../db');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

console.log('--- Testing Registration & Exam Date Updates and Lowered Confidence Scores ---');

const rawDb = new DatabaseSync(path.join(__dirname, '../data/schooldb.sqlite'));
const schools = rawDb.prepare('SELECT id, name, entranceExamDates, pillaiDetails, kpsDetails FROM schools').all();

let remaining2025JulDec = 0;
let remaining2026JanApr = 0;
let valid2026JulDec = 0;
let valid2027JanApr = 0;

const regexJanApr2026 = /\b(?:January|February|March|April|Jan|Feb|Mar|Apr)\b(?:\s+(?:[0-9]{1,2}(?:st|nd|rd|th)?|[a-zA-Z\/\-,&]+))*\s+2026\b/i;
const regexJulDec2025 = /\b(?:July|August|September|October|November|December|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Autumn)\b(?:\s+(?:[0-9]{1,2}(?:st|nd|rd|th)?|[a-zA-Z\/\-,&]+))*\s+2025\b/i;

const regexJanApr2027 = /\b(?:January|February|March|April|Jan|Feb|Mar|Apr)\b(?:\s+(?:[0-9]{1,2}(?:st|nd|rd|th)?|[a-zA-Z\/\-,&]+))*\s+2027\b/i;
const regexJulDec2026 = /\b(?:July|August|September|October|November|December|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Autumn)\b(?:\s+(?:[0-9]{1,2}(?:st|nd|rd|th)?|[a-zA-Z\/\-,&]+))*\s+2026\b/i;

for (const s of schools) {
  const blobs = [s.entranceExamDates, s.pillaiDetails, s.kpsDetails];
  for (const b of blobs) {
    if (!b) continue;
    try {
      const obj = JSON.parse(b);
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          if (regexJulDec2025.test(v)) {
            remaining2025JulDec++;
            console.warn('Lingering 2025 Jul-Dec:', s.id, k, v);
          }
          // Only check for exam and results dates that shouldn't be Jan-Apr 2026
          if (['examDate', 'firstExamDate', 'secondExamDate', 'secondStageExamDate', 'resultsDate', 'firstExamResults', 'secondExamResults', 'offersAcceptance'].includes(k)) {
            if (regexJanApr2026.test(v)) {
              remaining2026JanApr++;
              console.warn('Lingering 2026 Jan-Apr exam/result date:', s.id, k, v);
            }
          }
          if (regexJulDec2026.test(v)) {
            valid2026JulDec++;
          }
          if (regexJanApr2027.test(v)) {
            valid2027JanApr++;
          }
        }
      }
    } catch (e) {}
  }
}

console.log(`✓ 2026 Jul-Dec dates in database: ${valid2026JulDec}`);
console.log(`✓ 2027 Jan-Apr dates in database: ${valid2027JanApr}`);
console.log(`✓ Remaining 2025 Jul-Dec: ${remaining2025JulDec}`);
console.log(`✓ Remaining 2026 Jan-Apr Exam/Result Dates: ${remaining2026JanApr}`);

assert.strictEqual(remaining2025JulDec, 0, 'No Jul-Dec 2025 dates should remain');
assert.strictEqual(remaining2026JanApr, 0, 'No Jan-Apr 2026 exam/result dates should remain');
assert(valid2026JulDec > 0, 'Expected migrated 2026 Jul-Dec dates');
assert(valid2027JanApr > 0, 'Expected migrated 2027 Jan-Apr dates');

// Verify confidence scores are calculated and structured for migrated schools
const sampleSchool = rawDb.prepare("SELECT schoolId FROM field_confidence_votes WHERE userId = 'system_date_migration' OR userId = 'system_quality_auto' LIMIT 1").get();
assert(sampleSchool, 'Expected system date migration/quality votes in database');

const stats = db.getFieldConfidenceStats(sampleSchool.schoolId);
const examDatesConf = stats.entranceExamDates || stats.registrationDeadline || stats.examDate || stats.resultsDate;
console.log(`✓ Sample school (${sampleSchool.schoolId}) confidence stats:`, examDatesConf);

assert(examDatesConf && typeof examDatesConf.score === 'number', 'Confidence score must be a number');
assert(['High', 'Medium', 'Low'].includes(examDatesConf.level), 'Confidence level must be High, Medium, or Low');

console.log('====================================================');
console.log('🎉 ALL DATE UPDATE & CONFIDENCE TESTS PASSED!');
console.log('====================================================');
