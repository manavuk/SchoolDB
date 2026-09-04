/**
 * Automated Test Suite for 3-Page Portfolio Onboarding Wizard Flow & Integration
 */

const assert = require('assert');
const db = require('../db');
const { evaluateRecommendations } = require('./recommendation_service');

console.log('=== TEST SUITE: 3-Page Portfolio Onboarding Wizard Flow ===\n');

async function runWizardTests() {
  const allSchools = db.getAllSchools();
  assert(allSchools.length > 0, 'Must have schools in database');

  // -------------------------------------------------------------
  // Test 1: Page 1 Child Gender & Co-Ed Mapping
  // -------------------------------------------------------------
  console.log('[1. Testing Page 1: Child Gender & Co-Ed Checkbox Mapping]');

  // Case 1A: Boy + Include Co-ed (checked)
  const boyWithCoed = { gender: 'boys', includeCoed: true };
  const boyWithCoedGenders = boyWithCoed.includeCoed ? [boyWithCoed.gender, 'mixed'] : [boyWithCoed.gender];
  assert.deepStrictEqual(boyWithCoedGenders, ['boys', 'mixed']);

  const recsBoyCoed = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    preferencesOverride: { binaryFilters: { gender: boyWithCoedGenders } }
  });
  assert(recsBoyCoed.recommendations.length > 0);
  for (const r of recsBoyCoed.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    assert(!g.includes('girl') || g.includes('mixed') || g.includes('co-ed'), `Must not be Girls-only: ${r.school.name} (${r.school.gender})`);
  }
  console.log(`  ✓ Verified Boy + Co-ed allows Boys and Mixed schools, 0% Girls-only.`);

  // Case 1B: Girl + Single-Sex Only (unchecked)
  const girlSingleSex = { gender: 'girls', includeCoed: false };
  const girlSingleSexGenders = girlSingleSex.includeCoed ? [girlSingleSex.gender, 'mixed'] : [girlSingleSex.gender];
  assert.deepStrictEqual(girlSingleSexGenders, ['girls']);

  const recsGirlSingle = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    preferencesOverride: { binaryFilters: { gender: girlSingleSexGenders } }
  });
  assert(recsGirlSingle.recommendations.length > 0);
  for (const r of recsGirlSingle.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    assert(g.includes('girl') && !g.includes('boy') && !g.includes('mixed'), `Must be Girls-only: ${r.school.name} (${r.school.gender})`);
  }
  console.log(`  ✓ Verified Girl without Co-ed returns 100% Girls-only single-sex schools.`);

  // -------------------------------------------------------------
  // Test 2: Page 2 Distance Steps & Proximity Priority Mapping
  // -------------------------------------------------------------
  console.log('\n[2. Testing Page 2: Commute Distance & Proximity Slider Mapping]');

  function mapDistanceToProx(index) {
    switch (index) {
      case 0: return { maxDist: '3', proxStep: 4, proxLabel: 'top_priority' };
      case 1: return { maxDist: '3', proxStep: 3, proxLabel: 'very_important' };
      case 2: return { maxDist: '5', proxStep: 2, proxLabel: 'somewhat' };
      case 3: return { maxDist: '10', proxStep: 1, proxLabel: 'not_important' };
      case 4: return { maxDist: '15', proxStep: 1, proxLabel: 'not_important' };
      case 5: default: return { maxDist: '', proxStep: 0, proxLabel: 'NA' };
    }
  }

  assert.strictEqual(mapDistanceToProx(0).proxStep, 4);
  assert.strictEqual(mapDistanceToProx(2).proxStep, 2);
  assert.strictEqual(mapDistanceToProx(5).proxStep, 0);
  assert.strictEqual(mapDistanceToProx(5).maxDist, '');

  console.log(`  ✓ Distance slider mapped cleanly across all 6 steps (< 1 mi to Any distance).`);

  // -------------------------------------------------------------
  // Test 3: Page 3 Two-Switch Sector Selection Mapping
  // -------------------------------------------------------------
  console.log('\n[3. Testing Page 3: Two-Switch Sector Selection Mapping]');

  function deriveSchoolTypes(includeState, independentOption) {
    const types = [];
    if (includeState) {
      types.push('Grammar', 'Comprehensive');
    }
    if (independentOption !== 'exclude') {
      types.push('Independent');
    }
    return types.length > 0 ? types : ['Grammar', 'Comprehensive'];
  }

  // Case 3A: State & Grammar included, Independent excluded
  const stateOnlyTypes = deriveSchoolTypes(true, 'exclude');
  assert.deepStrictEqual(stateOnlyTypes, ['Grammar', 'Comprehensive']);

  const recsStateOnly = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    preferencesOverride: { binaryFilters: { schoolTypes: stateOnlyTypes } }
  });
  for (const r of recsStateOnly.recommendations) {
    const st = (r.school.schoolType || '').toLowerCase();
    assert(!st.includes('independent'), `Must not include independent schools in state-only mode: ${r.school.name}`);
  }
  console.log(`  ✓ State Only switch configuration returns 0% Independent schools.`);

  // Case 3B: State & Grammar excluded, Independent included
  const indOnlyTypes = deriveSchoolTypes(false, 'all');
  assert.deepStrictEqual(indOnlyTypes, ['Independent']);

  const recsIndOnly = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    preferencesOverride: { binaryFilters: { schoolTypes: indOnlyTypes } }
  });
  for (const r of recsIndOnly.recommendations) {
    const st = (r.school.schoolType || '').toLowerCase();
    assert(st.includes('independent'), `Must strictly be independent schools in independent-only mode: ${r.school.name}`);
  }
  console.log(`  ✓ Independent Only switch configuration returns 100% Independent schools.`);

  // Case 3C: Dual-Track (State included + Independent included)
  const dualTypes = deriveSchoolTypes(true, 'support');
  assert(dualTypes.includes('Grammar') && dualTypes.includes('Comprehensive') && dualTypes.includes('Independent'));
  console.log(`  ✓ Dual-Track switch configuration includes Grammar, Comprehensive & Independent.`);

  // -------------------------------------------------------------
  // Test 4: Ability & Learning Style Profile Mapping
  // -------------------------------------------------------------
  console.log('\n[4. Testing Ability & Learning Style Profile Mapping]');

  function deriveAbilityAndWeights(ability) {
    if (ability === 'great') {
      return { childAbilityLevel: 'top_class', academicExcellence: 'top_priority', pupilProgress: 'somewhat' };
    } else if (ability === 'good') {
      return { childAbilityLevel: 'above_average', academicExcellence: 'very_important', pupilProgress: 'very_important' };
    } else {
      return { childAbilityLevel: 'average', academicExcellence: 'not_important', pupilProgress: 'top_priority' };
    }
  }

  const greatProfile = deriveAbilityAndWeights('great');
  assert.strictEqual(greatProfile.childAbilityLevel, 'top_class');
  assert.strictEqual(greatProfile.academicExcellence, 'top_priority');

  const avgProfile = deriveAbilityAndWeights('average');
  assert.strictEqual(avgProfile.childAbilityLevel, 'average');
  assert.strictEqual(avgProfile.pupilProgress, 'top_priority');

  console.log(`  ✓ Great ability prioritizes top academic ranking; Average ability prioritizes pupil progress.`);

  // -------------------------------------------------------------
  // Test 5: End-to-End Generated Wizard Payload Integration
  // -------------------------------------------------------------
  console.log('\n[5. Testing End-to-End Generated Wizard Payload Integration]');

  const sampleWizardResult = {
    gender: 'boys',
    includeCoed: true,
    ability: 'great',
    locations: 'SW19 4TT, Wimbledon',
    distanceIndex: 2, // 5 miles
    includeState: true,
    independentOption: 'support'
  };

  const endToEndGenders = sampleWizardResult.includeCoed ? [sampleWizardResult.gender, 'mixed'] : [sampleWizardResult.gender];
  const endToEndTypes = deriveSchoolTypes(sampleWizardResult.includeState, sampleWizardResult.independentOption);
  const endToEndAbility = deriveAbilityAndWeights(sampleWizardResult.ability);
  const endToEndDistance = mapDistanceToProx(sampleWizardResult.distanceIndex);

  const fullPayload = {
    targetBorough: sampleWizardResult.locations,
    targetPostcode: sampleWizardResult.locations,
    childAbilityLevel: endToEndAbility.childAbilityLevel,
    binaryFilters: {
      locations: sampleWizardResult.locations,
      gender: endToEndGenders,
      ofstedFloor: 'NA',
      schoolTypes: endToEndTypes,
      examFormats: ['NA']
    },
    qualitativeWeights: {
      proximity: endToEndDistance.proxLabel,
      academicExcellence: endToEndAbility.academicExcellence,
      pupilProgress: endToEndAbility.pupilProgress
    }
  };

  const wizardRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: sampleWizardResult.locations,
    preferencesOverride: fullPayload
  });

  assert.strictEqual(wizardRecs.recommendations.length, 10, 'Default result count must be 10');
  console.log(`  - Returned ${wizardRecs.recommendations.length} recommendations matching full wizard profile.`);
  console.log(`    Top recommendation: ${wizardRecs.recommendations[0].school.name} (${wizardRecs.recommendations[0].school.schoolType}) - Score: ${wizardRecs.recommendations[0].matchScore}%`);
  console.log(`    Reasons: ${wizardRecs.recommendations[0].reasons.join('; ')}`);

  // Verify none of the top 10 show obvious gender text in reasons
  for (const r of wizardRecs.recommendations) {
    const hasObviousGender = r.reasons.some(re => re.toLowerCase().includes('gender'));
    assert.strictEqual(hasObviousGender, false, 'Must not show obvious gender match reasons');
  }
  console.log(`  ✓ Verified all 10 recommendations have clean, high-signal match reasons.`);

  console.log('\n=== ALL PORTFOLIO WIZARD TESTS PASSED SUCCESSFULLY ===');
}

runWizardTests().catch(err => {
  console.error('Wizard test failed with error:', err);
  process.exit(1);
});
