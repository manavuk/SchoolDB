const db = require('../db');

console.log('=== Pillar 3: Admissions Chronology & Cycle Integrity Guardrails ===\n');

// Parse English date strings into comparable Date objects
function parseAdmissionsDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'tbd' || s.toLowerCase() === 'autumn term') return null;

  // Extract first date from range or multiple dates
  const singleMatch = s.match(/\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i);
  if (singleMatch) {
    const d = new Date(singleMatch[0]);
    return isNaN(d.getTime()) ? null : d;
  }

  // Check month year
  const myMatch = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i);
  if (myMatch) {
    const d = new Date(`1 ${myMatch[0]}`);
    return isNaN(d.getTime()) ? null : d;
  }

  // Check ISO format
  const isoMatch = s.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch) {
    const d = new Date(isoMatch[0]);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

// Check if a date string refers to past stale cycles (e.g. 2023, 2024)
function isStaleCycleDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  return /\b(2022|2023|2024|2025)\b/.test(dateStr);
}

const allSchools = db.getAllSchools();
console.log(`Auditing ${allSchools.length} schools for admissions chronology and cycle integrity...`);

let chronologyChecked = 0;
let chronologyAnomalies = 0;
let staleCyclesFound = 0;
let sanityRulesApplied = 0;

const sqlite = db.getDb();
sqlite.exec('BEGIN TRANSACTION;');

try {
  for (const school of allSchools) {
    const dates = school.entranceExamDates || {};
    const updates = {};
    let updated = false;

    const regDeadlineStr = dates.registrationDeadline || dates.registrationCloseDate || null;
    const stage1ExamStr = dates.stage_one_examDate || dates.examDate || dates.firstExamDate || null;
    const stage2ExamStr = dates.stage_two_examDate || dates.secondExamDate || null;
    const resultsStr = dates.firstStageResult || dates.resultsDate || null;
    const offersStr = dates.offersDate || dates.offersAcceptance || dates.offerDate || null;
    const acceptStr = dates.acceptanceDeadline || dates.offerAcceptByDate || null;

    const regDate = parseAdmissionsDate(regDeadlineStr);
    const stage1Date = parseAdmissionsDate(stage1ExamStr);
    const stage2Date = parseAdmissionsDate(stage2ExamStr);
    const resultsDate = parseAdmissionsDate(resultsStr);
    const offersDate = parseAdmissionsDate(offersStr);
    const acceptDate = parseAdmissionsDate(acceptStr);

    chronologyChecked++;

    // Chronology Validation
    let hasChronologyError = false;
    if (regDate && stage1Date && regDate > stage1Date) {
      hasChronologyError = true;
    }
    if (stage1Date && stage2Date && stage1Date > stage2Date) {
      hasChronologyError = true;
    }
    if (stage1Date && resultsDate && stage1Date > resultsDate) {
      hasChronologyError = true;
    }
    if (offersDate && acceptDate && offersDate > acceptDate) {
      hasChronologyError = true;
    }

    if (hasChronologyError) {
      chronologyAnomalies++;
      const currentTags = Array.isArray(school.verification_tags) ? [...school.verification_tags] : [];
      if (!currentTags.includes('has_anomalies')) {
        currentTags.push('has_anomalies');
        updates.verification_tags = currentTags;
        updated = true;
      }
    }

    // Staleness Detection (Prior year cycles e.g. 2023/2024)
    const allDateTexts = [regDeadlineStr, stage1ExamStr, stage2ExamStr, resultsStr, offersStr, acceptStr].join(' ');
    if (isStaleCycleDate(allDateTexts)) {
      staleCyclesFound++;
      const currentTags = Array.isArray(school.verification_tags) ? [...school.verification_tags] : [];
      if (!currentTags.includes('stale_dates_pending_recrawl')) {
        currentTags.push('stale_dates_pending_recrawl');
        updates.verification_tags = currentTags;
        // Prioritize in queue
        updates.verification_status = 'unverified';
        updates.verified_at = null;
        updated = true;
      }
    }

    // Sanity Rules
    // 1. State / Comprehensive / Grammar schools should not have termly tuition fees
    if ((school.schoolType === 'Grammar' || school.schoolType === 'Comprehensive') && school.feesTermly) {
      updates.feesTermly = null;
      updates.fees_termly_gbp = null;
      updates.fees_annual_gbp = null;
      sanityRulesApplied++;
      updated = true;
    }

    // 2. Comprehensive schools should have second_stage_exam_required = 'No'
    if (school.schoolType === 'Comprehensive' && school.second_stage_exam_required !== 'No') {
      updates.second_stage_exam_required = 'No';
      sanityRulesApplied++;
      updated = true;
    }

    if (updated) {
      db.updateSchool(school.id, updates);
    }
  }

  sqlite.exec('COMMIT;');
  console.log('✓ Admissions Integrity Transaction committed successfully.\n');
} catch (err) {
  sqlite.exec('ROLLBACK;');
  console.error('Admissions integrity check failed:', err);
  process.exit(1);
}

console.log('--- Admissions Integrity & Chronology Metrics ---');
console.log(`- Profiles Checked: ${chronologyChecked}`);
console.log(`- Chronology Anomalies Detected & Tagged: ${chronologyAnomalies}`);
console.log(`- Stale Cycle Dates Detected & Re-Queued for 2026/2027 Crawl: ${staleCyclesFound}`);
console.log(`- Profile Sanity Rules Enforced: ${sanityRulesApplied}`);
console.log('\n🎉 Pillar 3 Admissions Integrity Guardrails Completed!');
