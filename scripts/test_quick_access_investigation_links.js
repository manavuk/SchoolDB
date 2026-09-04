const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== RUNNING TESTS: Quick Access Investigation Links (Website, DfE, Google Search) ===\n');

const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');

// 1. Verify helper function definition
console.log('[1. Testing renderQuickAccessInvestigationLinks Helper]');
assert(appJs.includes('function renderQuickAccessInvestigationLinks'), 'app.js must define renderQuickAccessInvestigationLinks');
console.log('  ✓ Helper function renderQuickAccessInvestigationLinks is defined');

// 2. Verify Google search query link generation
console.log('\n[2. Testing Google Search Query Link Generation]');
assert(appJs.includes('https://www.google.com/search?q='), 'app.js must construct google search query url');
assert(appJs.includes('target="_blank"'), 'Quick links must open in a new tab (target="_blank")');
assert(appJs.includes('rel="noopener noreferrer"'), 'Quick links must include security attribute rel="noopener noreferrer"');
console.log('  ✓ Google search query URL with target="_blank" is verified');

// 3. Verify DfE GIAS link generation
console.log('\n[3. Testing DfE GIAS Link Generation]');
assert(appJs.includes('https://www.get-information-schools.service.gov.uk/Establishments/Establishment/Details/'), 'app.js must construct official DfE establishment URLs with URN');
console.log('  ✓ DfE GIAS profile URL generation is verified');

// 4. Verify Merge View integration
console.log('\n[4. Testing Merge / Deduplication View Integration]');
const dedupSection = appJs.slice(appJs.indexOf('function renderDeduplicationCandidatePairs'), appJs.indexOf('async function executeAtomicMerge'));
assert(dedupSection.includes('renderQuickAccessInvestigationLinks(p.schoolA)'), 'Merge view must include investigation links for schoolA');
assert(dedupSection.includes('renderQuickAccessInvestigationLinks(p.schoolB)'), 'Merge view must include investigation links for schoolB');
console.log('  ✓ Merge / Deduplication View includes quick access links for both Primary (A) and Candidate (B)');

// 5. Verify Data Corrections View integration
console.log('\n[5. Testing Data Corrections View Integration]');
const correctionsSection = appJs.slice(appJs.indexOf('async function loadSystemCorrectionsQueue'), appJs.indexOf('async function clearConflictingUrn'));
assert(correctionsSection.includes('renderQuickAccessInvestigationLinks(c.schoolA)'), 'Data corrections view must include investigation links for schoolA');
assert(correctionsSection.includes('renderQuickAccessInvestigationLinks(c.schoolB)'), 'Data corrections view must include investigation links for schoolB');
console.log('  ✓ Data Corrections View includes quick access links for both Record A and Record B');

// 6. Verify DB Merge Modal integration
console.log('\n[6. Testing DB Merge Modal Integration]');
const mergeModalSection = appJs.slice(appJs.indexOf('function openDbMergeModal'), appJs.indexOf('function setDbMergeAll'));
assert(mergeModalSection.includes('renderQuickAccessInvestigationLinks(recA)'), 'DB merge modal must include links for recA');
assert(mergeModalSection.includes('renderQuickAccessInvestigationLinks(recB)'), 'DB merge modal must include links for recB');
console.log('  ✓ DB Merge Modal includes quick access links for both Record A and Record B');

console.log('\n======================================================');
console.log('🎉 ALL QUICK ACCESS INVESTIGATION LINK TESTS PASSED!');
console.log('======================================================\n');
