const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== RUNNING TESTS: Database Schema Optimization, Normalization & Performance ===\n');

async function testDatabaseOptimizations() {
  const sqlite = db.getDb();

  try {
    // 1. Schema Cleanliness Verification
    console.log('[1. Verifying Schema Column Pruning & Dropped Redundancies]');
    const cols = sqlite.prepare('PRAGMA table_info(schools)').all();
    const colNames = new Set(cols.map(c => c.name));

    assert(!colNames.has('raw_csv'), 'raw_csv column must be dropped');
    assert(!colNames.has('pillaiDetails'), 'pillaiDetails column must be dropped');
    assert(!colNames.has('kpsDetails'), 'kpsDetails column must be dropped');
    assert(!colNames.has('extra_json'), 'extra_json column must be dropped');
    assert(!colNames.has('compareSchoolPerformanceUrl'), 'compareSchoolPerformanceUrl column must be dropped (computed dynamically)');
    
    assert(colNames.has('national_rank_england'), 'national_rank_england column must exist');
    assert(colNames.has('gcse_rank_england'), 'gcse_rank_england column must exist');
    assert(colNames.has('a_level_rank_england'), 'a_level_rank_england column must exist');
    assert(colNames.has('second_stage_exam_required'), 'second_stage_exam_required column must exist');
    assert(colNames.has('stage_one_format_and_subjects'), 'stage_one_format_and_subjects column must exist');
    assert(colNames.has('stage_two_format_and_subjects'), 'stage_two_format_and_subjects column must exist');
    assert(colNames.has('registrationFee'), 'registrationFee column must exist');
    console.log('  ✓ Verified: Redundant/duplicate columns cleanly pruned from schema.');

    // 2. Dynamic compareSchoolPerformanceUrl Computation
    console.log('\n[2. Testing Dynamic compareSchoolPerformanceUrl Property]');
    const sampleWithUrn = db.getSchoolById('sch-gov-135126') || sqlite.prepare('SELECT * FROM schools WHERE urn IS NOT NULL LIMIT 1').get();
    const hydrated = db.getSchoolById(sampleWithUrn.id);
    assert(hydrated.compareSchoolPerformanceUrl, 'Hydrated school must include compareSchoolPerformanceUrl');
    assert(
      hydrated.compareSchoolPerformanceUrl.includes(hydrated.urn),
      `compareSchoolPerformanceUrl must be dynamically computed with URN: ${hydrated.compareSchoolPerformanceUrl}`
    );
    console.log('  ✓ Dynamic getter dynamically computes compareSchoolPerformanceUrl for schools with URNs.');

    // 3. Date Structure Canonicalization
    console.log('\n[3. Testing Canonicalized Date Structure]');
    const dateSample = sqlite.prepare("SELECT id, entranceExamDates FROM schools WHERE entranceExamDates IS NOT NULL AND entranceExamDates != '{}' LIMIT 10").all();
    assert(dateSample.length > 0, 'Must have schools with entranceExamDates');
    for (const row of dateSample) {
      const dates = JSON.parse(row.entranceExamDates);
      // Ensure no legacy key remnants inside compact JSON
      assert(dates.raw_csv === undefined, 'dates JSON must not contain raw_csv');
      assert(dates.kpsDetails === undefined, 'dates JSON must not contain kpsDetails');
      if (dates.stage_one_examDate) {
        assert(Array.isArray(dates.stage_one_examDate), 'stage_one_examDate must be an array');
      }
    }
    console.log('  ✓ Verified: entranceExamDates correctly canonicalized across sampled rows.');

    // 4. Full-Text Search (FTS5) Fast Execution
    console.log('\n[4. Testing SQLite FTS5 Search Acceleration]');
    const ftsResults = db.searchSchoolsFts('London');
    assert(Array.isArray(ftsResults) && ftsResults.length > 0, 'FTS5 search for "London" must return results');
    console.log(`  ✓ FTS5 query returned ${ftsResults.length} instant search results (e.g. "${ftsResults[0].name}").`);

    const ftsPostcode = db.searchSchoolsFts('SW1');
    assert(Array.isArray(ftsPostcode), 'FTS5 search for postcode prefix must return array');
    console.log(`  ✓ FTS5 query for postcode prefix returned ${ftsPostcode.length} matches.`);

    // 5. Database CRUD & Integrity
    console.log('\n[5. Testing Clean INSERT, UPDATE & Retrieval]');
    const testSchoolId = 'test_opt_norm_school_999';
    const testSchool = {
      id: testSchoolId,
      name: 'Optimization Verification Grammar School',
      urn: '999888',
      la: 'Kingston upon Thames',
      region: 'Greater London',
      postcode: 'KT1 2AB',
      address: '10 Optimization Lane',
      schoolType: 'Grammar',
      gender: 'Mixed',
      ageRange: '11 to 18',
      entranceExamDates: {
        registrationOpen: '1 May 2026',
        registrationDeadline: '30 October 2026',
        stage_one_examDate: ['15 November 2026']
      },
      national_rank_england: 1,
      gcse_rank_england: 2,
      a_level_rank_england: 3
    };

    db.insertSchool(testSchool);
    const retrieved = db.getSchoolById(testSchoolId);
    assert.strictEqual(retrieved.name, testSchool.name);
    assert.strictEqual(retrieved.urn, '999888');
    assert.strictEqual(retrieved.compareSchoolPerformanceUrl, 'https://www.compare-school-performance.service.gov.uk/school/999888');
    assert.strictEqual(retrieved.national_rank_england, 1);

    // Clean up test school
    db.deleteSchool(testSchoolId);
    assert(!db.getSchoolById(testSchoolId), 'Test school must be cleanly deleted');
    console.log('  ✓ Clean CRUD cycle succeeded with dynamic computed properties.');

    // 6. High-Performance Indexes Check
    console.log('\n[6. Verifying Composite & Single Indexes]');
    const indexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
    assert(indexes.includes('idx_schools_name'), 'idx_schools_name index must exist');
    assert(indexes.includes('idx_schools_urn'), 'idx_schools_urn index must exist');
    assert(indexes.includes('idx_schools_postcode'), 'idx_schools_postcode index must exist');
    assert(indexes.includes('idx_schools_type_region'), 'idx_schools_type_region composite index must exist');
    assert(indexes.includes('idx_schools_status_region'), 'idx_schools_status_region composite index must exist');
    console.log('  ✓ Verified: All performance indexes and composite indexes active in SQLite.');

    console.log('\n======================================================');
    console.log('🎉 ALL DATABASE OPTIMIZATION & NORMALIZATION TESTS PASSED!');
    console.log('======================================================\n');
  } catch (e) {
    console.error('❌ Test failed:', e);
    process.exit(1);
  }
}

testDatabaseOptimizations();
