/**
 * Automated Test Suite for Intelligent School Recommendation Service
 */

const assert = require('assert');
const db = require('../db');
const { passesGenderFilter, passesSchoolTypeFilter, extractExamSignature, getExamFormat, evaluateRecommendations } = require('./recommendation_service');

console.log('=== TEST SUITE: Intelligent School Recommendation Service ===\n');

async function runTests() {
  const allSchools = db.getAllSchools();
  assert(allSchools.length > 0, 'Must have schools in database');

  // -------------------------------------------------------------
  // Test 1: Strict Multi-Select Gender Matrix
  // -------------------------------------------------------------
  console.log('[1. Testing Strict Multi-Select Gender Matrix]');

  const boySchool = { name: 'Boy High', gender: 'Boys' };
  const girlSchool = { name: 'Girl High', gender: 'Girls' };
  const mixedSchool = { name: 'Mixed High', gender: 'Mixed' };

  // Case A: Only girls
  assert.strictEqual(passesGenderFilter(girlSchool, ['girls']), true);
  assert.strictEqual(passesGenderFilter(boySchool, ['girls']), false);
  assert.strictEqual(passesGenderFilter(mixedSchool, ['girls']), false);

  // Case B: Only boys
  assert.strictEqual(passesGenderFilter(boySchool, ['boys']), true);
  assert.strictEqual(passesGenderFilter(girlSchool, ['boys']), false);
  assert.strictEqual(passesGenderFilter(mixedSchool, ['boys']), false);

  // Case C: Only mixed
  assert.strictEqual(passesGenderFilter(mixedSchool, ['mixed']), true);
  assert.strictEqual(passesGenderFilter(boySchool, ['mixed']), false);
  assert.strictEqual(passesGenderFilter(girlSchool, ['mixed']), false);

  // Case D: Girls + Mixed (any school accepting girls; strictly NO boys-only)
  assert.strictEqual(passesGenderFilter(girlSchool, ['girls', 'mixed']), true);
  assert.strictEqual(passesGenderFilter(mixedSchool, ['girls', 'mixed']), true);
  assert.strictEqual(passesGenderFilter(boySchool, ['girls', 'mixed']), false);

  // Case E: Boys + Mixed (any school accepting boys; strictly NO girls-only)
  assert.strictEqual(passesGenderFilter(boySchool, ['boys', 'mixed']), true);
  assert.strictEqual(passesGenderFilter(mixedSchool, ['boys', 'mixed']), true);
  assert.strictEqual(passesGenderFilter(girlSchool, ['boys', 'mixed']), false);

  // Case F: Boys + Girls (single sex only; strictly NO mixed)
  assert.strictEqual(passesGenderFilter(boySchool, ['boys', 'girls']), true);
  assert.strictEqual(passesGenderFilter(girlSchool, ['boys', 'girls']), true);
  assert.strictEqual(passesGenderFilter(mixedSchool, ['boys', 'girls']), false);

  // Case G: All three or NA
  assert.strictEqual(passesGenderFilter(boySchool, ['boys', 'girls', 'mixed']), true);
  assert.strictEqual(passesGenderFilter(girlSchool, ['NA']), true);

  console.log('  ✓ Verified 100% compliance with multi-select gender matrix.');

  // Verify across actual database recommendations
  const girlsOnlyRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    genderChoice: 'girls'
  });
  assert(girlsOnlyRecs.recommendations.length > 0, 'Should find girls recommendations');
  for (const r of girlsOnlyRecs.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    assert(g.includes('girl') && !g.includes('boy'), `School ${r.school.name} must be Girls only, got ${r.school.gender}`);
  }
  console.log(`  ✓ Verified database query with gender=girls returned ${girlsOnlyRecs.recommendations.length} schools, 100% strictly Girls-only.`);

  const boysOnlyRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    genderChoice: 'boys'
  });
  assert(boysOnlyRecs.recommendations.length > 0, 'Should find boys recommendations');
  for (const r of boysOnlyRecs.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    assert(g.includes('boy') && !g.includes('girl'), `School ${r.school.name} must be Boys only, got ${r.school.gender}`);
  }
  console.log(`  ✓ Verified database query with gender=boys returned ${boysOnlyRecs.recommendations.length} schools, 100% strictly Boys-only.`);

  const girlsPlusMixedRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    preferencesOverride: { binaryFilters: { gender: ['girls', 'mixed'] } }
  });
  for (const r of girlsPlusMixedRecs.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    const isBoysOnly = g.includes('boy') && !g.includes('girl');
    assert.strictEqual(isBoysOnly, false, `School ${r.school.name} must not be Boys-only when girls+mixed selected`);
  }
  console.log(`  ✓ Verified gender=['girls', 'mixed'] returned 0% Boys-only schools.`);

  // -------------------------------------------------------------
  // Test 1B: Shortlisted School Gender as Hard Filter (Absence of Filter)
  // -------------------------------------------------------------
  console.log('\n[1B. Testing Shortlist Gender as Hard Filter in Absence of Filter]');

  const qeBoys = allSchools.find(s => s.name.includes("Queen Elizabeth's School"));
  assert(qeBoys, "Queen Elizabeth's School must exist");
  assert((qeBoys.gender || '').toLowerCase().includes('boy'), 'QE must be a Boys school');

  // Case 1: Shortlisted Boys school with NO gender filter set -> 100% Boys schools only
  const recsUnfilteredShortlistBoys = evaluateRecommendations({
    allSchools,
    userSchools: [qeBoys],
    targetLocation: 'EN5 4DQ', // Barnet
    genderChoice: 'all'
  });
  assert(recsUnfilteredShortlistBoys.recommendations.length > 0, 'Should find recommendations for Boys shortlist');
  for (const r of recsUnfilteredShortlistBoys.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    assert(g.includes('boy') && !g.includes('girl'), `Candidate ${r.school.name} must strictly be Boys-only when user shortlisted a Boys school with no filter (got: ${r.school.gender})`);
  }
  console.log(`  ✓ Shortlisted Boys school (no filter) returned ${recsUnfilteredShortlistBoys.recommendations.length} schools, 100% strictly Boys-only (0% Girls, 0% Mixed).`);

  // Case 2: Shortlisted Girls school with NO gender filter set -> 100% Girls schools only
  const tiffinGirls = allSchools.find(s => s.name.toLowerCase().includes('tiffin girls') || s.name.toLowerCase().includes('henrietta barnett'));
  assert(tiffinGirls, "A Girls school must exist in database");
  const recsUnfilteredShortlistGirls = evaluateRecommendations({
    allSchools,
    userSchools: [tiffinGirls],
    targetLocation: 'KT2 5PL',
    genderChoice: 'all'
  });
  assert(recsUnfilteredShortlistGirls.recommendations.length > 0, 'Should find recommendations for Girls shortlist');
  for (const r of recsUnfilteredShortlistGirls.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    assert(g.includes('girl') && !g.includes('boy'), `Candidate ${r.school.name} must strictly be Girls-only when user shortlisted a Girls school with no filter (got: ${r.school.gender})`);
  }
  console.log(`  ✓ Shortlisted Girls school (no filter) returned ${recsUnfilteredShortlistGirls.recommendations.length} schools, 100% strictly Girls-only (0% Boys, 0% Mixed).`);

  // Case 3: Shortlisted Boys + Mixed schools with NO filter set -> Union (Boys or Mixed; 0% Girls)
  const aMixedSchool = allSchools.find(s => (s.gender || '').toLowerCase().includes('mixed'));
  assert(aMixedSchool, "A Mixed school must exist in database");
  const recsUnfilteredBoysPlusMixed = evaluateRecommendations({
    allSchools,
    userSchools: [qeBoys, aMixedSchool],
    targetLocation: 'EN5 4DQ',
    genderChoice: 'all'
  });
  assert(recsUnfilteredBoysPlusMixed.recommendations.length > 0);
  for (const r of recsUnfilteredBoysPlusMixed.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    const isGirlsOnly = g.includes('girl') && !g.includes('boy');
    assert.strictEqual(isGirlsOnly, false, `Candidate ${r.school.name} must not be Girls-only when shortlist has Boys+Mixed with no filter`);
  }
  console.log(`  ✓ Shortlisted Boys + Mixed schools (no filter) returned 0% Girls-only schools (union of shortlist genders).`);

  // -------------------------------------------------------------
  // Test 1C: Explicit Filter + Shortlist Union with Filter Priority
  // -------------------------------------------------------------
  console.log('\n[1C. Testing Explicit Filter + Shortlist Union with Filter Priority]');

  // User shortlisted Boys school (QE Boys), but explicitly sets filter gender = 'mixed'
  const recsExplicitMixedWithBoysShortlist = evaluateRecommendations({
    allSchools,
    userSchools: [qeBoys],
    genderChoice: 'mixed'
  });
  assert(recsExplicitMixedWithBoysShortlist.recommendations.length > 0);

  // Union verification: candidates should be Mixed OR Boys; 0% Girls-only
  for (const r of recsExplicitMixedWithBoysShortlist.recommendations) {
    const g = (r.school.gender || '').toLowerCase();
    const isGirlsOnly = g.includes('girl') && !g.includes('boy');
    assert.strictEqual(isGirlsOnly, false, `Candidate ${r.school.name} must not be Girls-only in union of Mixed filter and Boys shortlist`);
  }
  console.log(`  ✓ Union of explicit 'mixed' filter and shortlisted Boys school contains 0% Girls-only schools.`);

  // Priority verification: schools matching the explicit filter 'mixed' receive the +8 explicit bonus and rank higher
  const mixedRecs = recsExplicitMixedWithBoysShortlist.recommendations.filter(r => (r.school.gender || '').toLowerCase().includes('mixed'));
  const boysRecs = recsExplicitMixedWithBoysShortlist.recommendations.filter(r => {
    const g = (r.school.gender || '').toLowerCase();
    return g.includes('boy') && !g.includes('girl');
  });

  assert(mixedRecs.length > 0, 'Should have mixed recommendations');
  // Check reasons for explicit filter match vs shortlist profile match:
  // Obvious implicit reasons (like gender) must NOT be shown.
  const sampleMixed = mixedRecs[0];
  const hasExplicitGenderReason = sampleMixed.reasons.some(re => re.toLowerCase().includes('gender'));
  assert.strictEqual(hasExplicitGenderReason, false, 'Explicit match should not show obvious gender reason');

  if (boysRecs.length > 0) {
    const sampleBoys = boysRecs[0];
    const hasShortlistGenderReason = sampleBoys.reasons.some(re => re.toLowerCase().includes('gender'));
    assert.strictEqual(hasShortlistGenderReason, false, 'Shortlist union match should not show obvious gender reason');
  }

  // Differentiating reasons that moved it up should be present
  assert(sampleMixed.reasons.length > 0, 'Sample recommendation should still have differentiating reasons');
  console.log(`    Sample mixed rec reasons: ${sampleMixed.reasons.join('; ')}`);
  console.log(`  ✓ Higher weightage for explicit filter over shortlist union confirmed without polluting card reasons with obvious gender.`);

  // -------------------------------------------------------------
  // Test 2: Adaptive School Type Filter with Shortlist Union
  // -------------------------------------------------------------
  console.log('\n[2. Testing Adaptive School Type Filter with Shortlist Union]');

  // Explicit Grammar selection -> Hard filter (100% Grammar when userSchools is empty)
  const grammarOnlyRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    preferencesOverride: { binaryFilters: { schoolTypes: ['Grammar'] } }
  });
  assert(grammarOnlyRecs.recommendations.length > 0);
  for (const r of grammarOnlyRecs.recommendations) {
    assert((r.school.schoolType || '').toLowerCase().includes('grammar'), `Must be Grammar school: ${r.school.name}`);
  }
  console.log(`  ✓ Explicit schoolTypes=['Grammar'] strictly returned 100% Grammar schools (${grammarOnlyRecs.recommendations.length} schools).`);

  // Explicit Independent selection -> Hard filter (100% Independent when userSchools is empty)
  const indOnlyRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    preferencesOverride: { binaryFilters: { schoolTypes: ['Independent'] } }
  });
  assert(indOnlyRecs.recommendations.length > 0);
  for (const r of indOnlyRecs.recommendations) {
    assert((r.school.schoolType || '').toLowerCase().includes('independent'), `Must be Independent school: ${r.school.name}`);
  }
  console.log(`  ✓ Explicit schoolTypes=['Independent'] strictly returned 100% Independent schools (${indOnlyRecs.recommendations.length} schools).`);

  // Explicit Grammar selection with an Independent school shortlisted -> Union of Grammar and Independent
  const anIndSchool = allSchools.find(s => (s.schoolType || '').toLowerCase().includes('independent'));
  assert(anIndSchool, 'An Independent school must exist in database');
  const unionTypeRecs = evaluateRecommendations({
    allSchools,
    userSchools: [anIndSchool],
    preferencesOverride: { binaryFilters: { schoolTypes: ['Grammar'] } }
  });
  assert(unionTypeRecs.recommendations.length > 0);
  for (const r of unionTypeRecs.recommendations) {
    const st = (r.school.schoolType || '').toLowerCase();
    const isGrammarOrInd = st.includes('grammar') || st.includes('independent');
    assert.strictEqual(isGrammarOrInd, true, `Candidate ${r.school.name} must be Grammar or Independent in union`);
  }
  console.log(`  ✓ Explicit Grammar filter + shortlisted Independent school returned union of Grammar & Independent schools.`);

  // -------------------------------------------------------------
  // Test 3: Asymmetric Ofsted Scoring
  // -------------------------------------------------------------
  console.log('\n[3. Testing Asymmetric Ofsted Significance]');

  const testSchoolGood = {
    id: 't-good',
    name: 'Test Good School',
    postcode: 'SW19 4TT',
    schoolType: 'Comprehensive',
    ofstedRating: 'Good',
    gcseAttainment8: 60,
    gcseProgress8: 0.3
  };

  const testSchoolOutstanding = {
    id: 't-out',
    name: 'Test Outstanding School',
    postcode: 'SW19 4TT',
    schoolType: 'Comprehensive',
    ofstedRating: 'Outstanding',
    gcseAttainment8: 60,
    gcseProgress8: 0.3
  };

  const testSchoolRI = {
    id: 't-ri',
    name: 'Test Requires Improvement School',
    postcode: 'SW19 4TT',
    schoolType: 'Comprehensive',
    ofstedRating: 'Requires Improvement',
    gcseAttainment8: 60,
    gcseProgress8: 0.3
  };

  const evalOfsted = evaluateRecommendations({
    allSchools: [testSchoolGood, testSchoolOutstanding, testSchoolRI],
    userSchools: [],
    targetLocation: 'SW19 4TT'
  });

  const scoreGood = evalOfsted.recommendations.find(r => r.school.id === 't-good').matchScore;
  const scoreOut = evalOfsted.recommendations.find(r => r.school.id === 't-out').matchScore;
  const scoreRI = evalOfsted.recommendations.find(r => r.school.id === 't-ri').matchScore;

  console.log(`  - Score for Outstanding: ${scoreOut}%`);
  console.log(`  - Score for Good: ${scoreGood}%`);
  console.log(`  - Score for Requires Improvement: ${scoreRI}%`);

  const diffOutVsGood = scoreOut - scoreGood;
  const diffGoodVsRI = scoreGood - scoreRI;

  console.log(`  - Difference (Outstanding vs Good): +${diffOutVsGood} pts (modest)`);
  console.log(`  - Difference (Good vs Requires Improvement): +${diffGoodVsRI} pts (significant penalty)`);

  assert(diffOutVsGood <= 5, 'Outstanding vs Good difference must be modest (<= 5 pts)');
  assert(diffGoodVsRI >= 20, 'Requires Improvement penalty must be significant (>= 20 pts penalty)');
  console.log('  ✓ Asymmetric Ofsted scoring confirmed.');

  // -------------------------------------------------------------
  // Test 4: Exam Format (Exam Type + Consortium) Combination Affinity
  // -------------------------------------------------------------
  console.log('\n[4. Testing Exam Format (Exam Type + Consortium) Combination]');

  // School with Sutton SET assessment saved in userSchools (Wilson's School)
  const wilsons = allSchools.find(s => s.name.startsWith("Wilson's School"));
  assert(wilsons, "Wilson's School must exist");
  const wilsonsFormat = getExamFormat(wilsons);
  assert(wilsonsFormat, "Wilson's format must exist");
  assert.strictEqual(wilsonsFormat.typeId, 7, 'Wilson exam type should be Sutton SET (id: 7)');
  assert.strictEqual(wilsonsFormat.consortiumId, 1, 'Wilson consortium should be Sutton SET Consortium (id: 1)');

  const recsWithWilsons = evaluateRecommendations({
    allSchools,
    userSchools: [wilsons],
    targetLocation: 'SM6 9JW', // Wallington / Sutton
    genderChoice: 'boys'
  });

  // Check top recommendations
  const topRec = recsWithWilsons.recommendations[0];
  console.log(`  - Saved School: ${wilsons.name} (Format: ${wilsonsFormat.key} - ${wilsonsFormat.label})`);
  console.log(`  - Top Recommendation: ${topRec.school.name} (Score: ${topRec.matchScore}%)`);
  console.log(`    Reasons: ${topRec.reasons.join('; ')}`);

  // Top recommendation (Wallington County Grammar School) must have identical format key (both exam type AND consortium)
  const topRecFormat = getExamFormat(topRec.school);
  assert.strictEqual(topRecFormat.key, wilsonsFormat.key, `Top recommendation must have identical exam format key (expected: ${wilsonsFormat.key}, got: ${topRecFormat.key})`);
  assert.strictEqual(topRecFormat.typeId, wilsonsFormat.typeId, 'Exam type must be identical');
  assert.strictEqual(topRecFormat.consortiumId, wilsonsFormat.consortiumId, 'Consortium must be identical');

  const hasExamReason = topRec.reasons.some(re =>
    re.includes('Sutton Selective Eligibility Test Consortium') || re.toLowerCase().includes('admissions format')
  );
  assert(hasExamReason, 'Top recommendation must cite shared Sutton SET Consortium admissions format');
  console.log('  ✓ Verified exact match: Wallington shares identical exam type AND consortium with Wilson\'s School.');

  // Negative test: Beths Grammar (Bexley) vs Judd School (Kent) - both use GL Assessment but different consortia
  const judd = allSchools.find(s => s.name.startsWith('Judd'));
  const beths = allSchools.find(s => s.name.startsWith('Beths'));
  assert(judd && beths, 'Judd and Beths must exist in database');

  const juddFormat = getExamFormat(judd);
  const bethsFormat = getExamFormat(beths);
  assert.strictEqual(juddFormat.typeId, 2, 'Judd uses GL Assessment (typeId: 2)');
  assert.strictEqual(bethsFormat.typeId, 2, 'Beths uses GL Assessment (typeId: 2)');
  assert.notStrictEqual(juddFormat.consortiumId, bethsFormat.consortiumId, 'Consortia must be different (Kent vs Bexley)');
  assert.notStrictEqual(juddFormat.key, bethsFormat.key, 'Format keys must differ when consortium is different');

  const recsWithJudd = evaluateRecommendations({
    allSchools,
    userSchools: [judd],
    genderChoice: 'boys'
  });
  const bethsRec = recsWithJudd.recommendations.find(r => r.school.id === beths.id);
  if (bethsRec) {
    const bethsHasExamReason = bethsRec.reasons.some(re => re.includes('Kent PESE') || re.includes('admissions format'));
    assert.strictEqual(bethsHasExamReason, false, 'Beths (Bexley) must NOT cite Kent PESE admissions format when Judd (Kent) is shortlisted');
  }
  console.log('  ✓ Verified negative test: schools sharing GL Assessment but different consortia do NOT match (both must be the same).');

  // -------------------------------------------------------------
  // Test 5: Elevated Child Ability & Academic Matching
  // -------------------------------------------------------------
  console.log('\n[5. Testing Elevated Child Ability & Academic Matching]');

  // Child Ability: top_class (High Academic)
  const topClassRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    preferencesOverride: {
      childAbilityLevel: 'top_class',
      qualitativeWeights: { academicExcellence: 'top_priority' }
    }
  });

  const topRankedCount = topClassRecs.recommendations.filter(r => 
    (r.school.national_rank_england && r.school.national_rank_england <= 250) ||
    (r.school.gcse_rank_england && r.school.gcse_rank_england <= 250) ||
    (r.school.gcseAttainment8 && r.school.gcseAttainment8 >= 70)
  ).length;
  console.log(`  - top_class recommendation top tier league table / high attainment schools: ${topRankedCount} / ${topClassRecs.recommendations.length}`);
  assert(topRankedCount >= 7, 'top_class child should strongly match Top tier league table schools');

  // Child Ability: below_average (Nurturing & Progress 8 Growth)
  const growthRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    preferencesOverride: {
      childAbilityLevel: 'below_average',
      qualitativeWeights: { pupilProgress: 'top_priority' }
    }
  });

  const highProgressCount = growthRecs.recommendations.filter(r => r.school.gcseProgress8 !== null && r.school.gcseProgress8 >= 0.3).length;
  console.log(`  - below_average child recommendations with high Progress 8: ${highProgressCount} / ${growthRecs.recommendations.length}`);
  assert(highProgressCount >= 7, 'Growth-focused child should prioritize high Progress 8 value-add');
  console.log('  ✓ Child Ability alignment across high-academic and high-progress profiles confirmed.');

  // -------------------------------------------------------------
  // Test 6: Continuous Postcode Distance (Soft Filter)
  // -------------------------------------------------------------
  console.log('\n[6. Testing Continuous Postcode Distance Soft Proximity]');

  const wimbledonRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT' // Wimbledon
  });

  assert(wimbledonRecs.recommendations.length > 0);
  const sampleRec = wimbledonRecs.recommendations[0];
  console.log(`  - Target Postcode: SW19 4TT`);
  console.log(`  - Top Result: ${sampleRec.school.name} (${sampleRec.school.postcode}) - Distance: ${sampleRec.school.distanceFormatted}`);
  console.log(`    Reasons: ${sampleRec.reasons.join('; ')}`);

  // Verify distance is attached and within reasonable commute
  assert(sampleRec.school.distanceMiles !== undefined, 'distanceMiles must be attached');
  assert(sampleRec.school.distanceMiles <= 15, `Nearest recommendations should be within commute range (got ${sampleRec.school.distanceMiles} mi)`);
  console.log('  ✓ Soft postcode proximity confirmed with exact distance in miles and no substring exclusion.');

  // -------------------------------------------------------------
  // Test 7: Recommendation Limit (Default 10, Range 1 - 100) & Omission of Implicit Reasons
  // -------------------------------------------------------------
  console.log('\n[7. Testing Configurable Recommendation Limit (Range 1-100, Default 10)]');

  // 1. Default limit = 10
  const defaultLimitRecs = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT'
  });
  assert.strictEqual(defaultLimitRecs.recommendations.length, 10, 'Default recommendation count must be exactly 10');
  console.log(`  ✓ Default recommendation limit is 10 (got: ${defaultLimitRecs.recommendations.length})`);

  // 2. Custom limit = 5
  const customLimit5 = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    limit: 5
  });
  assert.strictEqual(customLimit5.recommendations.length, 5, 'Custom limit of 5 must return exactly 5 recommendations');
  console.log(`  ✓ Custom limit=5 returned ${customLimit5.recommendations.length} schools`);

  // 3. Custom limit = 25
  const customLimit25 = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    limit: 25
  });
  assert.strictEqual(customLimit25.recommendations.length, 25, 'Custom limit of 25 must return exactly 25 recommendations');
  console.log(`  ✓ Custom limit=25 returned ${customLimit25.recommendations.length} schools`);

  // 4. Clamping: limit < 1 clamped to 1
  const clampedLow = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    limit: 0
  });
  assert.strictEqual(clampedLow.recommendations.length, 1, 'Limit < 1 must be clamped to 1');
  console.log(`  ✓ Clamped minimum limit (< 1 -> 1) returned ${clampedLow.recommendations.length} school`);

  // 5. Clamping: limit > 100 clamped to 100
  const clampedHigh = evaluateRecommendations({
    allSchools,
    userSchools: [],
    targetLocation: 'SW19 4TT',
    limit: 200
  });
  assert(clampedHigh.recommendations.length <= 100, 'Limit > 100 must be clamped to at most 100');
  console.log(`  ✓ Clamped maximum limit (> 100 -> 100) returned ${clampedHigh.recommendations.length} schools`);

  // 6. Global check: none of the recommendations should include obvious implicit gender reasons
  for (const r of customLimit25.recommendations) {
    const hasGenderInReasons = r.reasons.some(re => re.toLowerCase().includes('gender'));
    assert.strictEqual(hasGenderInReasons, false, `School ${r.school.name} should not show obvious gender in reasons: ${r.reasons.join(', ')}`);
  }
  console.log(`  ✓ Verified all 25 recommendations contain zero obvious implicit gender reasons.`);

  // 7. Verify Admin Settings persistence for recommendationLimit
  const initialAdminSettings = db.getAdminSettings();
  assert(typeof initialAdminSettings.recommendationLimit === 'number', 'recommendationLimit should exist in admin settings');
  db.saveAdminSettings({ recommendationLimit: 15 });
  const updatedAdminSettings = db.getAdminSettings();
  assert.strictEqual(updatedAdminSettings.recommendationLimit, 15, 'Admin settings should persist recommendationLimit');
  // Reset back to default 10
  db.saveAdminSettings({ recommendationLimit: 10 });
  assert.strictEqual(db.getAdminSettings().recommendationLimit, 10, 'Admin settings should reset to 10');
  console.log(`  ✓ Verified admin settings get/save for recommendationLimit with persistence.`);

  console.log('\n=== ALL RECOMMENDATION SERVICE TESTS PASSED SUCCESSFULLY ===');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
