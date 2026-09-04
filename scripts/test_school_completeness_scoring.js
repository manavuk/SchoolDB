/**
 * Verification Test Suite: School Data Completeness Scoring Engine & Admin Weights
 */
const assert = require('assert');
const db = require('../db');
const engine = require('./completeness_engine');

async function runTests() {
  console.log('🧪 Starting School Completeness Scoring Test Suite...\n');

  // 1. Test Default Weights Structure
  console.log('1. Checking default completeness weights...');
  assert.strictEqual(typeof engine.DEFAULT_COMPLETENESS_WEIGHTS, 'object');
  assert.strictEqual(engine.DEFAULT_COMPLETENESS_WEIGHTS.website, 20);
  assert.strictEqual(engine.DEFAULT_COMPLETENESS_WEIGHTS.examDates, 25);
  assert.strictEqual(engine.DEFAULT_COMPLETENESS_WEIGHTS.examFormat, 15);
  assert.strictEqual(engine.DEFAULT_COMPLETENESS_WEIGHTS.schoolClassification, 10);
  assert.strictEqual(engine.DEFAULT_COMPLETENESS_WEIGHTS.academicOfsted, 10);
  assert.strictEqual(engine.DEFAULT_COMPLETENESS_WEIGHTS.contactChannels, 8);
  assert.strictEqual(engine.DEFAULT_COMPLETENESS_WEIGHTS.addressGeography, 6);
  assert.strictEqual(engine.DEFAULT_COMPLETENESS_WEIGHTS.leadershipCapacity, 6);

  const totalDefaultWeights = Object.values(engine.DEFAULT_COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.strictEqual(totalDefaultWeights, 100, 'Default weights must sum to exactly 100 points');
  console.log('   ✅ Default weights are properly balanced and total 100 points.');

  // 2. Test Single School Evaluation
  console.log('2. Evaluating rich school record completeness...');
  const testSchoolRich = {
    id: 'test-rich-school-001',
    name: 'Queen Elizabeth High School',
    website: 'https://www.qehs.org.uk',
    entranceExamDates: {
      registrationOpen: '2026-05-01',
      registrationDeadline: '2026-07-15',
      examDate: '2026-09-20',
      resultsDate: '2026-10-15',
      offersAcceptance: '2027-03-01'
    },
    entranceExamType: 'GL Assessment 11+ Selective',
    stage_one_format_and_subjects: 'English & Maths Multiple Choice',
    second_stage_exam_required: 'No',
    schoolType: 'Grammar',
    gender: 'Boys',
    ofstedRating: 'Outstanding',
    gcseAttainment8: 78.4,
    national_rank_england: 12,
    phone: '020 8441 4646',
    email: 'admissions@qehs.org.uk',
    address: 'Queen Elizabeths Road',
    postcode: 'EN5 4DQ',
    la: 'Barnet',
    headteacher: 'Dr. Neil Ennis',
    pupilCount: 1250,
    fees_termly_gbp: 0
  };

  const richEvaluation = engine.evaluateSchoolCompleteness(testSchoolRich);
  console.log(`   Score for rich school: ${richEvaluation.score}% (Earned: ${richEvaluation.earnedWeight} / ${richEvaluation.maxWeight})`);
  assert(richEvaluation.score >= 90, `Rich school score should be >= 90%, got ${richEvaluation.score}%`);
  assert.strictEqual(richEvaluation.breakdown.website.earned, 20);
  assert.strictEqual(richEvaluation.breakdown.examDates.earned, 25);
  console.log('   ✅ Rich school completeness evaluation verified.');

  // 3. Test Incomplete School Evaluation
  console.log('3. Evaluating incomplete school record...');
  const testSchoolMinimal = {
    id: 'test-minimal-school-002',
    name: 'Generic Academy',
    schoolType: 'Academy',
    gender: 'Mixed'
  };
  const minimalEvaluation = engine.evaluateSchoolCompleteness(testSchoolMinimal);
  console.log(`   Score for minimal school: ${minimalEvaluation.score}%`);
  assert(minimalEvaluation.score < 30, `Minimal school score should be < 30%, got ${minimalEvaluation.score}%`);
  assert.strictEqual(minimalEvaluation.breakdown.website.earned, 0);
  assert.strictEqual(minimalEvaluation.breakdown.examDates.earned, 0);
  console.log('   ✅ Incomplete school completeness evaluation verified.');

  // 4. Test Custom Weights Re-weighting
  console.log('4. Testing custom weights configuration...');
  const customWeights = {
    website: 40,
    examDates: 40,
    examFormat: 10,
    schoolClassification: 5,
    academicOfsted: 5,
    contactChannels: 0,
    addressGeography: 0,
    leadershipCapacity: 0
  };
  const customEvaluation = engine.evaluateSchoolCompleteness(testSchoolRich, customWeights);
  console.log(`   Score with custom weights: ${customEvaluation.score}%`);
  assert(customEvaluation.score >= 95, 'Should score very high when heavily-weighted fields are present');
  console.log('   ✅ Custom weights evaluation verified.');

  // 5. Test Database Admin Settings Persistence
  console.log('5. Testing admin settings persistence for completenessWeights...');
  const origSettings = db.getAdminSettings();
  assert(typeof origSettings.completenessWeights === 'object');
  
  db.saveAdminSettings({
    completenessWeights: {
      website: 22,
      examDates: 24,
      examFormat: 16,
      schoolClassification: 10,
      academicOfsted: 10,
      contactChannels: 8,
      addressGeography: 5,
      leadershipCapacity: 5
    }
  });

  const updatedSettings = db.getAdminSettings();
  assert.strictEqual(updatedSettings.completenessWeights.website, 22);
  assert.strictEqual(updatedSettings.completenessWeights.examDates, 24);
  console.log('   ✅ Admin settings completenessWeights stored and retrieved correctly.');

  // Restore original default settings
  db.saveAdminSettings({ completenessWeights: engine.DEFAULT_COMPLETENESS_WEIGHTS });

  // 6. Test Batch Recalculation across Entire Database
  console.log('6. Running batch recalculate on full database...');
  const batchResult = engine.batchRecalculateAllSchools(db, engine.DEFAULT_COMPLETENESS_WEIGHTS);
  console.log('   Batch Result:', batchResult);
  assert.strictEqual(batchResult.success, true);
  assert(batchResult.totalUpdated > 4000, `Total updated should be > 4000, got ${batchResult.totalUpdated}`);
  assert(batchResult.avgScore > 0, `Average score should be > 0, got ${batchResult.avgScore}`);
  console.log('   ✅ Full database batch recalculation executed successfully.');

  console.log('\n🎉 ALL COMPLETENESS ENGINE TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test suite error:', err);
  process.exit(1);
});
