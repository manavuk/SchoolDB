const assert = require('assert');
const db = require('../db');
const fs = require('fs');
const path = require('path');

console.log('--- Testing Date Anomaly Engine & Admin Review Module ---');

// 1. Test getAllDateAnomalies()
const result = db.getAllDateAnomalies();
console.log('Stats:', result.stats);
assert(result.stats.totalSchoolsWithDates > 0, 'Should have schools with admissions dates');
assert(Array.isArray(result.anomalies), 'Anomalies should be an array');
assert(Array.isArray(result.allSchools), 'allSchools should be an array');
console.log(`✓ Analyzed ${result.stats.totalSchoolsWithDates} schools; detected ${result.stats.totalAnomalies} anomaly schools.`);
console.log(`✓ Average Quality Score: ${result.stats.avgQualityScore}%`);

// 2. Test Anomaly Structure & Proposed Dates
if (result.anomalies.length > 0) {
  const sample = result.anomalies[0];
  console.log(`\nInspecting sample anomaly school: ${sample.schoolName} (${sample.schoolId})`);
  assert(sample.schoolId, 'Anomaly school must have schoolId');
  assert(sample.anomalies.length > 0, 'Must have at least one anomaly');
  assert(sample.proposedDates, 'Must have proposed dates');
  assert(sample.proposedDates.registrationOpen, 'Must have proposed registrationOpen');
  assert(sample.proposedDates.registrationDeadline, 'Must have proposed registrationDeadline');
  console.log('  Anomalies:', sample.anomalies.map(a => a.message));
  console.log('  Current Dates:', sample.currentDates);
  console.log('  Proposed Dates:', sample.proposedDates);
  console.log('✓ Anomaly object structure & proposed timeline verified.');

  // 3. Test applyDateAnomalyFix for single school
  const updatedSchool = db.applyDateAnomalyFix(sample.schoolId, sample.proposedDates, 'Test Admin');
  assert(updatedSchool, 'Updated school should be returned');
  
  // Verify confidence was boosted
  const confStats = db.getFieldConfidenceStats(sample.schoolId);
  const examDatesConf = confStats.entranceExamDates || confStats.registrationDeadline;
  console.log('  Updated Confidence Stats:', examDatesConf);
  assert(examDatesConf.score >= 80, 'Confidence score should be boosted to high after fix');
  console.log('✓ applyDateAnomalyFix applied cleanly and boosted confidence.');
}

// 4. Test autoSyncAllDateConfidenceScores
const syncedCount = db.autoSyncAllDateConfidenceScores();
console.log(`✓ Synchronized confidence scores for ${syncedCount} schools.`);
assert(syncedCount > 0, 'Synced count should be > 0');

// 5. Test applyAllDateAnomalyFixes
const { anomalies: remainingAnomalies } = db.getAllDateAnomalies();
console.log(`Applying bulk fixes for remaining ${remainingAnomalies.length} anomaly schools...`);
const bulkUpdated = db.applyAllDateAnomalyFixes('Automated Bulk Test');
console.log(`✓ Bulk fixed ${bulkUpdated.length} schools.`);

const postFixResult = db.getAllDateAnomalies();
console.log('Post-Fix Stats:', postFixResult.stats);
assert.strictEqual(postFixResult.stats.totalAnomalies, 0, 'All anomalies should be resolved after applyAllDateAnomalyFixes');
assert(postFixResult.stats.avgQualityScore >= 85, 'Average quality score should be >= 85% after resolution');
console.log(`✓ Post-Fix Quality Score: ${postFixResult.stats.avgQualityScore}% (Zero remaining anomalies).`);

// 6. Test Frontend DOM & CSS Elements
const htmlContent = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert(htmlContent.includes('id="side-tab-btn-date-anomalies"'), 'index.html must include side-tab-btn-date-anomalies');
assert(htmlContent.includes('id="admin-subpane-date-anomalies"'), 'index.html must include admin-subpane-date-anomalies');
assert(htmlContent.includes('id="kpi-total-date-schools"'), 'index.html must include KPI total schools');
assert(htmlContent.includes('id="admin-date-anomalies-container"'), 'index.html must include anomaly container');
console.log('✓ All DOM components verified in index.html.');

const cssContent = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
assert(cssContent.includes('.date-anomaly-kpi-grid'), 'styles.css must include date-anomaly-kpi-grid');
assert(cssContent.includes('.timeline-comparison-grid'), 'styles.css must include timeline-comparison-grid');
console.log('✓ All CSS classes verified in styles.css.');

const jsContent = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(jsContent.includes('loadAdminDateAnomalies'), 'app.js must include loadAdminDateAnomalies');
assert(jsContent.includes('applyAdminDateFix'), 'app.js must include applyAdminDateFix');
assert(jsContent.includes('applyAllAdminDateFixes'), 'app.js must include applyAllAdminDateFixes');
console.log('✓ All controller functions verified in app.js.');

console.log('====================================================');
console.log('🎉 ALL DATE ANOMALY & REVIEW MODULE TESTS PASSED!');
console.log('====================================================');
