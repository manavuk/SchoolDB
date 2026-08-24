const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, '../data/schooldb.sqlite');
const db = new DatabaseSync(dbPath);

console.log('=== UPDATING DATABASE REGISTRATION & EXAM DATES & LOWERING CONFIDENCE SCORES ===\n');

function transformDateString(str) {
  if (typeof str !== 'string') return { transformed: str, modified: false, reasons: [] };

  let updated = str;
  let modified = false;
  const reasons = [];

  // 1. Transform Jul-Dec 2025 -> 2026
  const regexJulDec = /\b(July|August|September|October|November|December|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Autumn)(\b[^\d]*\b|\s*[\/\-&,]\s*(?:July|August|September|October|November|December|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Autumn)?\s*)2025\b/gi;
  if (regexJulDec.test(updated)) {
    updated = updated.replace(regexJulDec, (match, p1, p2) => {
      modified = true;
      reasons.push('Jul-Dec 2025 -> 2026');
      return `${p1}${p2}2026`;
    });
  }

  const regexDayMonth2025 = /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:July|August|September|October|November|December|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\w*)\s+2025\b/gi;
  if (regexDayMonth2025.test(updated)) {
    updated = updated.replace(regexDayMonth2025, (match, p1) => {
      modified = true;
      reasons.push('Day Month 2025 -> 2026');
      return `${p1} 2026`;
    });
  }

  const regexSlash2025 = /\b(November\/December|Nov\/Dec|Oct\/Nov|September\/October|Sep\/Oct)\s+2025\b/gi;
  if (regexSlash2025.test(updated)) {
    updated = updated.replace(regexSlash2025, (match, p1) => {
      modified = true;
      reasons.push('Month/Month 2025 -> 2026');
      return `${p1} 2026`;
    });
  }

  // 2. Transform Jan-Apr 2026 -> 2027
  const regexJanApr = /\b(January|February|March|April|Jan|Feb|Mar|Apr)(\b[^\d]*\b|\s*[\/\-&,]\s*(?:January|February|March|April|Jan|Feb|Mar|Apr)?\s*)2026\b/gi;
  if (regexJanApr.test(updated)) {
    updated = updated.replace(regexJanApr, (match, p1, p2) => {
      modified = true;
      reasons.push('Jan-Apr 2026 -> 2027');
      return `${p1}${p2}2027`;
    });
  }

  const regexDayMonth2026 = /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|Jan|Feb|Mar|Apr)\w*)\s+2026\b/gi;
  if (regexDayMonth2026.test(updated)) {
    updated = updated.replace(regexDayMonth2026, (match, p1) => {
      modified = true;
      reasons.push('Day Month 2026 -> 2027');
      return `${p1} 2027`;
    });
  }

  const regexSlash2026 = /\b(January\/February|Jan\/Feb|Feb\/Mar|February\/March|March\/April|Mar\/Apr)\s+2026\b/gi;
  if (regexSlash2026.test(updated)) {
    updated = updated.replace(regexSlash2026, (match, p1) => {
      modified = true;
      reasons.push('Month/Month 2026 -> 2027');
      return `${p1} 2027`;
    });
  }

  return { transformed: updated, modified, reasons };
}

const schools = db.prepare('SELECT id, name, entranceExamDates, pillaiDetails, kpsDetails FROM schools').all();

const updateSchoolStmt = db.prepare(`
  UPDATE schools 
  SET entranceExamDates = ?, pillaiDetails = ?, kpsDetails = ?
  WHERE id = ?
`);

const insertVoteStmt = db.prepare(`
  INSERT OR REPLACE INTO field_confidence_votes (userId, schoolId, fieldName, vote, votedAt)
  VALUES (?, ?, ?, ?, ?)
`);

const deleteAdminReviewStmt = db.prepare(`
  DELETE FROM admin_field_reviews
  WHERE schoolId = ? AND fieldName = ?
`);

db.exec('BEGIN TRANSACTION;');

let modifiedSchoolsCount = 0;
let totalFieldsTransformed = 0;
const affectedSchoolIds = new Set();
const affectedFieldNamesBySchool = new Map();

try {
  for (const s of schools) {
    let schoolModified = false;

    // Process entranceExamDates
    let newExamDatesStr = s.entranceExamDates;
    if (s.entranceExamDates) {
      try {
        const dObj = JSON.parse(s.entranceExamDates);
        if (dObj && typeof dObj === 'object' && !Array.isArray(dObj)) {
          let objMod = false;
          for (const [k, v] of Object.entries(dObj)) {
            if (typeof v === 'string') {
              const res = transformDateString(v);
              if (res.modified) {
                dObj[k] = res.transformed;
                objMod = true;
                totalFieldsTransformed++;
                if (!affectedFieldNamesBySchool.has(s.id)) affectedFieldNamesBySchool.set(s.id, new Set());
                affectedFieldNamesBySchool.get(s.id).add('entranceExamDates');
                affectedFieldNamesBySchool.get(s.id).add(k);
              }
            }
          }
          if (objMod) {
            newExamDatesStr = JSON.stringify(dObj);
            schoolModified = true;
          }
        }
      } catch (e) {}
    }

    // Process pillaiDetails
    let newPillaiStr = s.pillaiDetails;
    if (s.pillaiDetails) {
      try {
        const pObj = JSON.parse(s.pillaiDetails);
        if (pObj && typeof pObj === 'object') {
          let objMod = false;
          for (const [k, v] of Object.entries(pObj)) {
            if (typeof v === 'string') {
              const res = transformDateString(v);
              if (res.modified) {
                pObj[k] = res.transformed;
                objMod = true;
                totalFieldsTransformed++;
                if (!affectedFieldNamesBySchool.has(s.id)) affectedFieldNamesBySchool.set(s.id, new Set());
                affectedFieldNamesBySchool.get(s.id).add('pillaiDetails');
                affectedFieldNamesBySchool.get(s.id).add(k);
              }
            }
          }
          if (objMod) {
            newPillaiStr = JSON.stringify(pObj);
            schoolModified = true;
          }
        }
      } catch (e) {}
    }

    // Process kpsDetails
    let newKpsStr = s.kpsDetails;
    if (s.kpsDetails) {
      try {
        const kObj = JSON.parse(s.kpsDetails);
        if (kObj && typeof kObj === 'object') {
          let objMod = false;
          for (const [k, v] of Object.entries(kObj)) {
            if (typeof v === 'string') {
              const res = transformDateString(v);
              if (res.modified) {
                kObj[k] = res.transformed;
                objMod = true;
                totalFieldsTransformed++;
                if (!affectedFieldNamesBySchool.has(s.id)) affectedFieldNamesBySchool.set(s.id, new Set());
                affectedFieldNamesBySchool.get(s.id).add('kpsDetails');
                affectedFieldNamesBySchool.get(s.id).add(k);
              }
            }
          }
          if (objMod) {
            newKpsStr = JSON.stringify(kObj);
            schoolModified = true;
          }
        }
      } catch (e) {}
    }

    if (schoolModified) {
      updateSchoolStmt.run(newExamDatesStr, newPillaiStr, newKpsStr, s.id);
      modifiedSchoolsCount++;
      affectedSchoolIds.add(s.id);
    }
  }

  // Lower confidence scores for all modified school date fields
  const now = new Date().toISOString();
  let confidenceVotesCast = 0;
  for (const [schoolId, fieldsSet] of affectedFieldNamesBySchool.entries()) {
    for (const fieldName of fieldsSet) {
      // Remove any conflicting admin review so confidence level is not forced to 100% High
      deleteAdminReviewStmt.run(schoolId, fieldName);

      // Record system downvote (-1) to lower the calculated confidence score to Low (< 60%)
      insertVoteStmt.run('system_date_migration', schoolId, fieldName, -1, now);
      insertVoteStmt.run('system_auto_audit', schoolId, fieldName, -1, now);
      confidenceVotesCast += 2;
    }
  }

  db.exec('COMMIT;');
  console.log(`✓ Updated ${modifiedSchoolsCount} schools across ${totalFieldsTransformed} date fields.`);
  console.log(`✓ Lowered confidence scores across ${affectedFieldNamesBySchool.size} schools with ${confidenceVotesCast} confidence downvotes.`);
} catch (err) {
  db.exec('ROLLBACK;');
  console.error('Failed to update dates:', err);
  process.exit(1);
}

console.log('\n====================================================');
console.log('🎉 REGISTRATION & EXAM DATES UPDATE COMPLETE!');
console.log('====================================================');
