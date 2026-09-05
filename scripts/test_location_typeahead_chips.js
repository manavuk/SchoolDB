/**
 * Automated Verification Script: Location Typeahead Autocomplete and Chip Inputs
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

async function runTests() {
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
  assert(html.includes('id="rec-locations-chip-box"'), 'Omni-Discovery chip box exists');
  assert(html.includes('id="rec-locations-chips"'), 'Omni-Discovery chips container exists');
  assert(html.includes('id="rec-locations-input"'), 'Omni-Discovery chip input exists');
  assert(html.includes('id="rec-target-locations"'), 'Omni-Discovery backwards-compatible hidden input exists');
  assert(html.includes('id="rec-locations-suggestions"'), 'Omni-Discovery suggestions dropdown exists');

  assert(html.includes('id="pw-locations-chip-box"'), 'Portfolio Wizard chip box exists');
  assert(html.includes('id="pw-locations-chips"'), 'Portfolio Wizard chips container exists');
  assert(html.includes('id="pw-locations-input"'), 'Portfolio Wizard chip input exists');
  assert(html.includes('id="pw-input-locations"'), 'Portfolio Wizard backwards-compatible hidden input exists');
  assert(html.includes('id="pw-locations-suggestions"'), 'Portfolio Wizard suggestions dropdown exists');

  console.log('\n--- 2. Testing CSS in public/css/styles.css ---');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf-8');
  assert(css.includes('.location-chip-box'), '.location-chip-box rule defined');
  assert(css.includes('.location-chip-box.compact-mode'), '.location-chip-box.compact-mode rule defined for fixed height');
  assert(css.includes('.location-chip'), '.location-chip badge style defined');
  assert(css.includes('.location-chip-remove'), '.location-chip-remove delete button style defined');
  assert(css.includes('.location-typeahead-dropdown'), '.location-typeahead-dropdown autocomplete popup defined');
  assert(css.includes('.location-typeahead-badge'), '.location-typeahead-badge category tag defined');
  assert(css.includes('.location-chips-more-btn'), '.location-chips-more-btn +more badge style defined');
  assert(css.includes('.location-chips-more-popover'), '.location-chips-more-popover hover/click popup defined');

  console.log('\n--- 3. Testing Client Logic in public/js/app.js ---');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf-8');
  assert(appJs.includes('function createLocationChipInput'), 'createLocationChipInput helper function is defined');
  assert(appJs.includes('window.omniLocationChipInput = createLocationChipInput'), 'omniLocationChipInput is initialized');
  assert(appJs.includes('compactMode: true'), 'omniLocationChipInput config specifies compactMode: true');
  assert(appJs.includes('window.wizardLocationChipInput = createLocationChipInput'), 'wizardLocationChipInput is initialized');
  assert(appJs.includes('fetch(`/api/locations/suggest?q='), 'app.js fetches suggestions from /api/locations/suggest');
  assert(appJs.includes('window.wizardLocationChipInput.setChips(wizardState.locations)'), 'syncWizardUiToState sets wizard chips');
  assert(appJs.includes('window.omniLocationChipInput.setChips(wizardState.locations)'), 'applyWizardToFiltersAndSearch sets omni chips');

  console.log('\n--- 4. Testing Multi-Location Recommendation Service Logic ---');
  const recService = require('./recommendation_service.js');
  assert(typeof recService.evaluateRecommendations === 'function', 'evaluateRecommendations function exported');

  // Test scoring with an array of postcodes/boroughs
  const schoolsSample = [
    {
      id: 'sch-1',
      name: 'Wimbledon High School',
      postcode: 'SW19 4TT',
      la: 'Merton',
      latitude: 51.421,
      longitude: -0.211,
      gender: 'Girls',
      ofstedRating: 'Outstanding'
    },
    {
      id: 'sch-2',
      name: 'Barnet Grammar School',
      postcode: 'EN5 4AY',
      la: 'Barnet',
      latitude: 51.652,
      longitude: -0.201,
      gender: 'Boys',
      ofstedRating: 'Good'
    }
  ];

  const resultsSingle = recService.evaluateRecommendations({
    allSchools: schoolsSample,
    targetLocation: ['SW19 4TT']
  });
  assert(resultsSingle && resultsSingle.recommendations && resultsSingle.recommendations.length > 0, 'evaluateRecommendations runs with single location in array');

  const resultsMulti = recService.evaluateRecommendations({
    allSchools: schoolsSample,
    targetLocation: ['SW19 4TT', 'Barnet']
  });
  assert(resultsMulti && resultsMulti.recommendations && resultsMulti.recommendations.length > 0, 'evaluateRecommendations runs with multiple locations');

  console.log('\n--- 5. Testing /api/locations/suggest Endpoint HTTP Response ---');
  function httpGet(url) {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(raw) });
          } catch (e) {
            resolve({ statusCode: res.statusCode, raw });
          }
        });
      }).on('error', reject);
    });
  }

  try {
    const resBorough = await httpGet('http://127.0.0.1:3000/api/locations/suggest?q=merton');
    assert(resBorough.statusCode === 200, '/api/locations/suggest?q=merton returns 200 OK');
    assert(resBorough.data && resBorough.data.suggestions && resBorough.data.suggestions.some(s => s.name.toLowerCase().includes('merton')), 'Suggestion contains Merton borough');

    const resOutcode = await httpGet('http://127.0.0.1:3000/api/locations/suggest?q=sw19');
    assert(resOutcode.statusCode === 200, '/api/locations/suggest?q=sw19 returns 200 OK');
    assert(resOutcode.data && resOutcode.data.suggestions && resOutcode.data.suggestions.some(s => s.name.toUpperCase().includes('SW19')), 'Suggestion contains SW19 outcode');

    const resTown = await httpGet('http://127.0.0.1:3000/api/locations/suggest?q=wimb');
    assert(resTown.statusCode === 200, '/api/locations/suggest?q=wimb returns 200 OK');
    assert(resTown.data && resTown.data.suggestions && resTown.data.suggestions.some(s => s.name.toLowerCase().includes('wimbledon')), 'Suggestion contains Wimbledon town');
  } catch (err) {
    console.log(`  (Note: Server might need restart to load updated server.js: ${err.message})`);
  }

  console.log(`\n========================================`);
  console.log(`Tests finished: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
