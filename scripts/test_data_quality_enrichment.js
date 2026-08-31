const assert = require('assert');
const db = require('../db');
const fs = require('fs');
const path = require('path');

console.log('--- Testing Comprehensive Data Quality & Automated Enrichment Engine ---');

// 1. Test getDataQualitySummary()
const summary = db.getDataQualitySummary();
console.log('Data Quality Summary:', summary);

assert(summary.totalSchools >= 6400, 'Total schools in database must be >= 6400');
assert(summary.examTypeCoverage.percentage >= 98, 'Exam type coverage must be >= 98%');
assert(summary.datesCoverage.percentage >= 98, 'Dates coverage must be >= 98%');
console.log('✓ High completeness verified across Exam Types and Admissions Dates.');

// 2. Test School Types Distribution
console.log('\nSchool Types Breakdown:', summary.schoolTypes);
assert(summary.schoolTypes.Comprehensive >= 4000, 'Must have >= 4000 Comprehensive schools');
assert(summary.schoolTypes.Grammar >= 150, 'Must have >= 150 Grammar schools');
assert(summary.schoolTypes.Independent >= 2000, 'Must have >= 2000 Independent schools');
console.log('✓ Standard school classification categories verified.');

// 3. Test Database Coverage Summary
console.log('\nExam Type & Dates Coverage:', summary.examTypeCoverage, summary.datesCoverage);
assert(summary.examTypeCoverage.filled > 0, 'Must have recorded entrance exam types');
assert(summary.datesCoverage.filled > 0, 'Must have recorded admissions dates');
console.log(`✓ Coverage stats verified: ${summary.examTypeCoverage.filled} schools with exam types, ${summary.datesCoverage.filled} with dates.`);

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
assert(html.includes('id="side-tab-btn-data-enrichment"'), 'index.html must have side-tab-btn-data-enrichment');
assert(html.includes('id="admin-subpane-data-enrichment"'), 'index.html must have admin-subpane-data-enrichment');
assert(html.includes('id="enrichment-feed-list"'), 'index.html must have enrichment-feed-list');
console.log('✓ UI components verified in index.html.');

const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(js.includes('initDataEnrichmentTab'), 'app.js must include initDataEnrichmentTab');
console.log('✓ Controller functions verified in app.js.');

console.log('\n====================================================');
console.log('🎉 ALL DATA QUALITY & ENRICHMENT VERIFICATIONS PASSED!');
console.log('====================================================');
