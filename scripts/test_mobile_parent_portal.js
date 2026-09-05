/**
 * Automated Verification Script: Mobile-Friendly Parent Portal with Bottom 4-Tab Navigation
 */

const fs = require('fs');
const path = require('path');

function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      failed++;
    }
  }

  console.log('\n--- 1. Testing Markup in public/index.html ---');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');

  // Desktop sidebar must remain intact
  assert(html.includes('id="classic-side-nav"'), 'Desktop sidebar (#classic-side-nav) exists');
  assert(html.includes('id="classic-side-tab-find"'), 'Desktop Find Schools tab exists');
  assert(html.includes('id="classic-side-tab-shortlist"'), 'Desktop My Shortlist tab exists');
  assert(html.includes('id="classic-side-tab-timeline"'), 'Desktop Admission Timeline tab exists');
  assert(html.includes('id="classic-side-tab-dualtrack"'), 'Desktop Dual Tracking tab exists');

  // Mobile bottom navigation bar
  assert(html.includes('id="mobile-parent-bottom-nav"'), 'Mobile bottom navigation bar exists (#mobile-parent-bottom-nav)');
  assert(html.includes('id="mobile-tab-find"'), 'Mobile Find Schools tab exists');
  assert(html.includes('id="mobile-tab-shortlist"'), 'Mobile My Shortlist tab exists');
  assert(html.includes('id="mobile-tab-timeline"'), 'Mobile Admission Timeline tab exists');
  assert(html.includes('id="mobile-tab-dualtrack"'), 'Mobile Dual Tracking tab exists');

  // Check matching icons
  assert(html.includes('fa-magnifying-glass-location'), 'Find Schools icon exists');
  assert(html.includes('fa-list-check'), 'Shortlist icon exists');
  assert(html.includes('fa-calendar-days'), 'Timeline icon exists');
  assert(html.includes('fa-layer-group'), 'Dual Track icon exists');

  // Mobile shortlist counter badge
  assert(html.includes('id="mobile-shortlist-badge-count"'), 'Mobile shortlist badge counter exists');

  console.log('\n--- 2. Testing CSS in public/css/styles.css ---');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf-8');

  // Desktop default: mobile bottom nav strictly hidden
  assert(css.includes('.mobile-bottom-nav {\n  display: none !important;\n}'), 'Desktop default: .mobile-bottom-nav is display: none !important');

  // Mobile media query (@media (max-width: 768px))
  assert(css.includes('@media (max-width: 768px)'), '@media (max-width: 768px) query defined');
  assert(css.includes('position: fixed !important;\n    bottom: 0 !important;'), 'Mobile bottom nav fixed to bottom');
  assert(css.includes('#classic-side-nav {\n    display: none !important;\n  }'), 'Desktop sidebar hidden on mobile');
  assert(css.includes('#classic-side-layout {\n    display: block !important;'), 'Desktop side layout becomes single column block on mobile');
  assert(css.includes('.omni-filter-grid {\n    display: flex !important;\n    flex-direction: column !important;'), 'Omni-filter grid stacked on mobile');
  assert(css.includes('.dual-track-grid {\n    grid-template-columns: 1fr !important;'), 'Dual track grid stacked on mobile');

  console.log('\n--- 3. Testing Client Logic in public/js/app.js ---');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf-8');
  assert(appJs.includes("querySelectorAll('.classic-shortlist-badge-count')"), 'Shortlist counter updates all badge elements across desktop and mobile');
  assert(appJs.includes("window.innerWidth <= 768"), 'switchClassicSubTab includes mobile smooth scroll to top');
  assert(appJs.includes("querySelectorAll('.classic-side-tab[data-target-classic-tab]')"), 'Click handlers bound to all classic-side-tab elements');

  console.log(`\n========================================`);
  console.log(`Tests finished: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
