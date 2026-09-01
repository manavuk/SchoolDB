const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== RUNNING TESTS: School Details Parent View vs Admin Quality View ===\n');

function testSchoolDetailsViews() {
  const appJsPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // 1. Verify renderFieldConfidenceBadge logic in app.js
  console.log('[1. Testing Simplified Field Confidence Indicators (High / Low only; Medium is implicit)]');

  // Extract renderFieldConfidenceBadge function
  const funcMatch = appJs.match(/function renderFieldConfidenceBadge\([\s\S]*?\n\}/);
  assert(funcMatch, 'renderFieldConfidenceBadge must be defined in app.js');

  const fnString = funcMatch[0];
  // Evaluate in sandbox
  const renderFieldConfidenceBadge = new Function('return ' + fnString)();

  // Test 1a: Medium confidence (should return empty string)
  const medBadge = renderFieldConfidenceBadge('sch-1', 'examDate', { examDate: { score: 60, level: 'Medium', isAdminVerified: false } });
  assert.strictEqual(medBadge, '', 'Medium confidence must return empty string (implicit indicator)');

  // Test 1b: High confidence (should return green icon-high)
  const highBadge = renderFieldConfidenceBadge('sch-1', 'examDate', { examDate: { score: 90, level: 'High', isAdminVerified: false, upvotes: 2, downvotes: 0 } });
  assert(highBadge.includes('icon-high') && highBadge.includes('fa-check'), 'High confidence must return green icon-high check badge');

  // Test 1c: Admin verified (should return green icon-admin double check)
  const adminBadge = renderFieldConfidenceBadge('sch-1', 'examDate', { examDate: { score: 100, level: 'High', isAdminVerified: true } });
  assert(adminBadge.includes('icon-admin') && adminBadge.includes('fa-check-double'), 'Admin verified must return icon-admin double check badge');

  // Test 1d: Low confidence (should return red icon-low alert)
  const lowBadge = renderFieldConfidenceBadge('sch-1', 'examDate', { examDate: { score: 40, level: 'Low', isAdminVerified: false, upvotes: 0, downvotes: 2 } });
  assert(lowBadge.includes('icon-low') && lowBadge.includes('fa-circle-exclamation'), 'Low confidence must return red icon-low alert badge');

  console.log('  ✓ Confidence indicators correctly simplified: Medium is implicit (blank), High and Low have distinct clear badges.');

  // 2. Verify Parent Tag Filtering in openSchoolDetail
  console.log('\n[2. Verifying Parent Tag Filtering in School Details Modal]');
  assert(appJs.includes('Clean Parent-Relevant Tags'), 'Must contain clean parent tags section');
  assert(appJs.includes('<i class="fa-solid fa-venus-mars"></i> ${userOverrides.gender || school.gender}</span>'), 'Gender badge uses clean Gender label without intake suffix');
  assert(appJs.includes('Hot School'), 'Parent view includes friendly "Hot School" badge when hot');
  assert(appJs.includes('2-Stage Selective Exam'), 'Parent view includes "2-Stage Selective Exam" badge when applicable');
  console.log('  ✓ Parent tag row displays only intuitive educational badges.');

  // 3. Verify Admin Quality & AI Verification Section
  console.log('\n[3. Verifying Admin Intelligence & Data Quality View]');
  assert(appJs.includes('admin-quality-card'), 'Admin view includes dedicated admin-quality-card');
  assert(appJs.includes('Quality &amp; Confidence Level'), 'Admin card contains quality and confidence breakdown');
  assert(appJs.includes('Last Intelligence Scan'), 'Admin card contains last scan timestamp and model info');
  assert(appJs.includes('System Verification Tags:'), 'Admin card displays full internal verification tags');
  assert(appJs.includes('detail-edit-specs-btn'), 'Admin view includes direct Edit Specs action button');
  console.log('  ✓ Admin view provides comprehensive data quality, scan footprint, and administrative controls.');

  // 4. Verify CSS Styles in styles.css
  console.log('\n[4. Verifying CSS Styles for Admin Quality Card]');
  const cssPath = path.join(__dirname, '..', 'public', 'css', 'styles.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert(css.includes('.admin-quality-card'), 'styles.css must include .admin-quality-card rules');
  assert(css.includes('.admin-quality-badge'), 'styles.css must include .admin-quality-badge rules');
  console.log('  ✓ CSS classes for .admin-quality-card and .admin-quality-badge verified.');

  console.log('\n======================================================');
  console.log('🎉 ALL SCHOOL DETAILS PARENT & ADMIN VIEW TESTS PASSED!');
  console.log('======================================================\n');
}

testSchoolDetailsViews();
