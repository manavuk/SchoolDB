const assert = require('assert');
const db = require('../db');
const fs = require('fs');
const path = require('path');

console.log('--- Testing Comprehensive Data Quality & Automated Enrichment Engine ---');

// 1. Test getDataQualitySummary()
const summary = db.getDataQualitySummary();
console.log('Data Quality Summary:', summary);

assert(summary.totalSchools >= 6400, 'Total schools in database must be >= 6400');
assert.strictEqual(summary.examTypeCoverage.blank, 0, 'Must have 0 blank exam types (100% coverage)');
assert.strictEqual(summary.examTypeCoverage.percentage, 100, 'Exam type coverage must be 100%');
assert.strictEqual(summary.datesCoverage.blank, 0, 'Must have 0 blank dates (100% coverage)');
assert.strictEqual(summary.datesCoverage.percentage, 100, 'Dates coverage must be 100%');
console.log('✓ 100% completeness verified across Exam Types and Admissions Dates.');

// 2. Test School Types Distribution
console.log('\nSchool Types Breakdown:', summary.schoolTypes);
assert(summary.schoolTypes.Comprehensive >= 4000, 'Must have >= 4000 Comprehensive schools');
assert(summary.schoolTypes.Grammar >= 150, 'Must have >= 150 Grammar schools');
assert(summary.schoolTypes.Independent >= 2000, 'Must have >= 2000 Independent schools');
assert.strictEqual(
  summary.schoolTypes.Comprehensive + summary.schoolTypes.Grammar + summary.schoolTypes.Independent,
  summary.totalSchools,
  'All schools must be cleanly classified into standard categories'
);
console.log('✓ 100% School Type classification verified (Zero unclassified schools).');

// 3. Test Date Anomaly & Chronological Quality Engine
const anomaliesResult = db.getAllDateAnomalies();
console.log('\nDate Quality Stats:', anomaliesResult.stats);
assert.strictEqual(anomaliesResult.stats.totalAnomalies, 0, 'Must have zero date anomalies across all 6,497 schools');
assert.strictEqual(anomaliesResult.stats.chronoInversions, 0, 'Must have zero chronological inversions');
assert(anomaliesResult.stats.avgQualityScore >= 85, 'Average quality score must be >= 85%');
console.log(`✓ Zero date anomalies across all ${anomaliesResult.stats.totalSchoolsWithDates} schools; Avg Quality Score: ${anomaliesResult.stats.avgQualityScore}%.`);

// 4. Test Specific Consortia Profiles
console.log('\nTesting Specific Consortium & Statutory Profiles:');

const allSchools = db.getAllSchools();

// Kent Test Grammar
const kentGrammar = allSchools.find(s => s.name && s.name.includes('Dartford Grammar School'));
assert(kentGrammar, 'Dartford Grammar School must exist');
assert.strictEqual(kentGrammar.schoolType, 'Grammar');
assert(kentGrammar.entranceExamType.includes('Kent Test'), 'Must be assigned Kent Test');
console.log(`✓ Kent Grammar verified: ${kentGrammar.name} -> ${kentGrammar.entranceExamType}`);

// Sutton SET Grammar
const suttonGrammar = allSchools.find(s => s.name && s.name.includes('Wilson\'s School'));
assert(suttonGrammar, 'Wilson\'s School must exist');
assert.strictEqual(suttonGrammar.schoolType, 'Grammar');
assert(suttonGrammar.entranceExamType.includes('Sutton SET'), 'Must be assigned Sutton SET');
console.log(`✓ Sutton Grammar verified: ${suttonGrammar.name} -> ${suttonGrammar.entranceExamType}`);

// CSSE Essex Grammar
const essexGrammar = allSchools.find(s => s.name && s.name.includes('Colchester Royal Grammar'));
assert(essexGrammar, 'Colchester Royal Grammar must exist');
assert.strictEqual(essexGrammar.schoolType, 'Grammar');
assert(essexGrammar.entranceExamType.includes('CSSE'), 'Must be assigned CSSE Exam');
console.log(`✓ CSSE Essex Grammar verified: ${essexGrammar.name} -> ${essexGrammar.entranceExamType}`);

// London 11+ Girls' Consortium
const londonConsortiumSchool = allSchools.find(s => s.name && s.name.includes('South Hampstead High'));
assert(londonConsortiumSchool, 'South Hampstead High School must exist');
assert.strictEqual(londonConsortiumSchool.schoolType, 'Independent');
assert(londonConsortiumSchool.entranceExamType.includes('London 11+ Consortium'), 'Must be assigned London 11+ Consortium');
console.log(`✓ London 11+ Consortium verified: ${londonConsortiumSchool.name} -> ${londonConsortiumSchool.entranceExamType}`);

// ISEB Senior Independent
const isebSchool = allSchools.find(s => s.name && s.name.includes('St Paul\'s Girls\' School'));
assert(isebSchool, 'St Paul\'s Girls\' School must exist');
assert.strictEqual(isebSchool.schoolType, 'Independent');
assert(isebSchool.entranceExamType.includes('ISEB'), 'Must be assigned ISEB Pre-Test');
console.log(`✓ ISEB Independent verified: ${isebSchool.name} -> ${isebSchool.entranceExamType}`);

// State Faith School
const faithSchool = allSchools.find(s => s.entranceExamType && s.entranceExamType.includes('Faith-based Admissions (Roman Catholic'));
assert(faithSchool, 'Roman Catholic state faith school must exist');
assert.strictEqual(faithSchool.schoolType, 'Comprehensive');
console.log(`✓ State Faith School verified: ${faithSchool.name} -> ${faithSchool.entranceExamType}`);

// 5. Test Frontend UI Elements
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert(html.includes('id="btn-run-full-enrichment"'), 'index.html must have btn-run-full-enrichment');
assert(html.includes('Automated Data Quality &amp; Enrichment Pipeline'), 'index.html must have automated enrichment header');
console.log('✓ UI components verified in index.html.');

const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(js.includes('runAdminFullEnrichment'), 'app.js must include runAdminFullEnrichment');
console.log('✓ Controller functions verified in app.js.');

console.log('\n====================================================');
console.log('🎉 ALL DATA QUALITY & ENRICHMENT VERIFICATIONS PASSED!');
console.log('====================================================');
