const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const scannerVerifier = require('./scanner_verifier');

console.log('=== RUNNING TESTS: Greater London Region Crawler Dropdown & Batch Support ===\n');

function testGreaterLondonBatch() {
  console.log('[1. Testing db.getSchoolsForScannerBatch with GREATER_LONDON]');
  const batch = db.getSchoolsForScannerBatch('GREATER_LONDON', 25, 0); // skipDays = 0
  assert(batch.length > 0, 'Must return Greater London schools');
  assert(batch.length <= 25, 'Must respect limit of 25');

  const londonLAs = new Set(['Barnet','Bexley','Brent','Bromley','Camden','Croydon','Ealing','Enfield','Greenwich','Hackney','Hammersmith and Fulham','Haringey','Harrow','Havering','Hillingdon','Hounslow','Islington','Kensington and Chelsea','Kingston upon Thames','Lambeth','Lewisham','Merton','Newham','Redbridge','Richmond upon Thames','Southwark','Sutton','Tower Hamlets','Waltham Forest','Wandsworth','Westminster', 'Barking and Dagenham']);

  for (const s of batch) {
    const isLondon = s.region === 'Greater London' || londonLAs.has(s.la);
    assert(isLondon, `School ${s.name} (Region: ${s.region}, LA: ${s.la}) must be in Greater London`);
  }
  console.log(`  ✓ Returned ${batch.length} Greater London schools across diverse types: ${batch.map(s => s.schoolType).slice(0, 5).join(', ')}...`);

  console.log('\n[2. Verifying public/index.html Dropdown Option]');
  const adminHtmlPath = path.join(__dirname, '../public/admin.html');
  const html = fs.existsSync(adminHtmlPath) ? fs.readFileSync(adminHtmlPath, 'utf8') : fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert(html.includes('value="GREATER_LONDON"'), 'index.html must contain GREATER_LONDON option in scanner dropdown');
  assert(html.includes('Greater London Region'), 'index.html must have label Greater London Region');
  console.log('  ✓ Verified GREATER_LONDON option in public/index.html scanner dropdown.');
}

testGreaterLondonBatch();

console.log('\n======================================================');
console.log('🎉 ALL GREATER LONDON CRAWLER DROPDOWN TESTS PASSED!');
console.log('======================================================\n');
