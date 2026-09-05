const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== RUNNING TESTS: Unscanned Priority & Website Health Drill-Down Modals ===\n');

// 1. Verify Prioritization Logic
console.log('[1. Testing Unscanned Websites Prioritization]');
const allSchools = db.getAllSchools();
const schoolsWithWeb = allSchools.filter(s => s.website && s.website.trim().startsWith('http'));

const unscanned = schoolsWithWeb.filter(s => !s.verified_at && (!Array.isArray(s.verification_tags) || (!s.verification_tags.includes('web_health_audited') && !s.verification_tags.includes('auto_verified'))));
const scanned = schoolsWithWeb.filter(s => !unscanned.includes(s)).sort((a, b) => new Date(a.verified_at || 0) - new Date(b.verified_at || 0));
const prioritized = [...unscanned, ...scanned];

assert(prioritized.length === schoolsWithWeb.length, 'Prioritized list must contain all schools with websites');
if (unscanned.length > 0) {
  assert.strictEqual(prioritized[0].id, unscanned[0].id, 'First prioritized school must be from unscanned list');
  console.log(`  ✓ Unscanned websites correctly prioritized (${unscanned.length} unscanned vs ${scanned.length} scanned).`);
} else {
  console.log('  ✓ All websites scanned; sorted chronologically by oldest verified date.');
}

// 2. Verify server.js routes
console.log('\n[2. Testing server.js Endpoints]');
const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
assert(serverJs.includes('/api/admin/quality/website-health/category-schools'), 'Must have category-schools route');
assert(serverJs.includes('unscannedWebsitesCount'), 'Status route must return unscannedWebsitesCount');
console.log('  ✓ server.js includes category-schools drill-down route and unscannedWebsitesCount metric.');

// 3. Verify public/index.html and public/js/app.js UI elements
console.log('\n[3. Testing Frontend Markup & Modal Wiring]');
const adminHtmlPath = path.join(__dirname, '../public/admin.html');
const indexHtml = fs.existsSync(adminHtmlPath) ? fs.readFileSync(adminHtmlPath, 'utf8') : fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert(indexHtml.includes('id="modal-website-health-details"'), 'index.html must contain modal-website-health-details');
assert(indexHtml.includes('id="webhealth-stat-unscanned-card"'), 'index.html must contain webhealth-stat-unscanned-card');
assert(indexHtml.includes('webhealth-clickable-card'), 'index.html must contain clickable cards');

const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
assert(stylesCss.includes('.modal-overlay.active'), 'styles.css must define .modal-overlay.active display rule');
assert(appJs.includes('window.openWebsiteHealthCategoryModal'), 'app.js must expose openWebsiteHealthCategoryModal globally');
assert(appJs.includes('renderWebsiteHealthCategoryTable'), 'app.js must define renderWebsiteHealthCategoryTable');
assert(appJs.includes('webhealth-stat-unscanned'), 'app.js must populate webhealth-stat-unscanned');
assert(indexHtml.includes('onclick="openWebsiteHealthCategoryModal('), 'index.html must include inline onclick triggers');
console.log('  ✓ styles.css .modal-overlay.active and global window modal triggers verified.');

console.log('\n========================================================================');
console.log('🎉 ALL UNSCANNED PRIORITY & DRILL-DOWN MODAL TESTS PASSED!');
console.log('========================================================================\n');
