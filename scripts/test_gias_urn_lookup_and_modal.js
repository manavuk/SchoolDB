const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { fetchDfeGiasDetails } = require('./dfe_gias_lookup');

console.log('=== RUNNING TESTS: DfE GIAS Single URN Lookup & Import Modal ===\n');

// 1. Verify dfe_gias_lookup module
console.log('[1. Testing dfe_gias_lookup Module]');
(async () => {
  const result1 = await fetchDfeGiasDetails('100537');
  assert(result1, 'fetchDfeGiasDetails must return record for URN 100537');
  assert.strictEqual(result1.urn, '100537');
  assert.strictEqual(result1.name, 'Ashbourne College');
  assert.strictEqual(result1.postcode, 'W8 4PL');
  assert(result1.sourceUrl.includes('/Details/100537'), 'sourceUrl must link to Details/100537');
  console.log('  ✓ Live / CSV URN lookup correctly resolved Ashbourne College (URN 100537)');

  const result2 = await fetchDfeGiasDetails('136344');
  assert(result2, 'fetchDfeGiasDetails must return record for URN 136344');
  assert.strictEqual(result2.urn, '136344');
  console.log('  ✓ URN lookup correctly resolved Canterbury / Barnet (URN 136344)');

  const invalid = await fetchDfeGiasDetails('000000');
  assert.strictEqual(invalid, null, 'Invalid URN must return null');
  console.log('  ✓ Non-existent URN correctly returns null');

  // 2. Verify public/index.html UI components
  console.log('\n[2. Testing public/index.html GIAS Elements]');
  const adminHtmlPath = path.join(__dirname, '../public/admin.html');
  const indexHtml = fs.existsSync(adminHtmlPath) ? fs.readFileSync(adminHtmlPath, 'utf8') : fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert(indexHtml.includes('id="gias-lookup-urn-input"'), 'index.html must include gias-lookup-urn-input');
  assert(indexHtml.includes('id="gias-lookup-urn-btn"'), 'index.html must include gias-lookup-urn-btn');
  assert(indexHtml.includes('id="gias-urn-import-modal"'), 'index.html must include gias-urn-import-modal');
  assert(indexHtml.includes('id="gias-urn-import-modal-content"'), 'index.html must include gias-urn-import-modal-content');
  assert(indexHtml.includes('id="modal-confirm-gias-import"'), 'index.html must include modal-confirm-gias-import button');
  assert(indexHtml.includes('id="modal-cancel-gias-import"'), 'index.html must include modal-cancel-gias-import button');
  console.log('  ✓ All GIAS lookup input fields, action buttons, and modal elements verified in index.html');

  // 3. Verify public/js/app.js client controllers
  console.log('\n[3. Testing public/js/app.js GIAS Client Controllers]');
  const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert(appJs.includes('GIAS_IMPORT_FIELDS'), 'app.js must define GIAS_IMPORT_FIELDS');
  assert(appJs.includes('function runGiasUrnLookup'), 'app.js must define runGiasUrnLookup');
  assert(appJs.includes('function openGiasUrnImportModal'), 'app.js must define openGiasUrnImportModal');
  assert(appJs.includes('function onGiasFieldCheckboxToggle'), 'app.js must define onGiasFieldCheckboxToggle');
  assert(appJs.includes('function setGiasFieldSelection'), 'app.js must define setGiasFieldSelection');
  assert(appJs.includes('function closeGiasUrnImportModal'), 'app.js must define closeGiasUrnImportModal');
  assert(appJs.includes('function confirmGiasUrnImport'), 'app.js must define confirmGiasUrnImport');
  console.log('  ✓ All GIAS client controllers, field selection handlers, and confirm logic verified in app.js');

  // 4. Verify server.js API endpoints
  console.log('\n[4. Testing server.js Endpoints]');
  const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert(serverJs.includes('/api/admin/quality/gias/lookup/:urn'), 'server.js must expose /api/admin/quality/gias/lookup/:urn');
  assert(serverJs.includes('/api/admin/quality/gias/save'), 'server.js must expose /api/admin/quality/gias/save');
  console.log('  ✓ GIAS lookup and save API endpoints verified in server.js');

  // 5. Test db.getSchoolByUrn and direct save
  console.log('\n[5. Testing DB operations for GIAS Save]');
  const testUrn = '99912345';
  const testSchool = {
    id: `sch-gov-${testUrn}`,
    name: 'Test GIAS Ingested School',
    urn: testUrn,
    la: 'Hertfordshire',
    region: 'East of England',
    postcode: 'WD17 1AA',
    address: '100 Test High Road, Watford, WD17 1AA',
    schoolType: 'Comprehensive',
    ofstedRating: 'Outstanding',
    official: true,
    officialDataSource: 'DfE GIAS'
  };

  db.insertSchool(testSchool);
  const found = db.getSchoolByUrn(testUrn);
  assert(found, 'getSchoolByUrn must find newly inserted school');
  assert.strictEqual(found.name, 'Test GIAS Ingested School');
  assert.strictEqual(found.urn, testUrn);

  // Clean up test school
  db.deleteSchool(`sch-gov-${testUrn}`);
  console.log('  ✓ db.getSchoolByUrn and insertSchool verified cleanly');

  console.log('\n======================================================');
  console.log('🎉 ALL DfE GIAS URN LOOKUP & MODAL TESTS PASSED!');
  console.log('======================================================\n');
})();
