const assert = require('assert');
const fs = require('fs');
const path = require('path');
const app = require('../server');

console.log('=== RUNNING TESTS: Data Enrichment Category Breakdown & Pre-Filtered Navigation ===\n');

async function testCategoryStatsApi() {
  console.log('[1. Testing /api/admin/enrichment/category-stats Endpoint]');
  
  const routes = app._router.stack.filter(r => r.route && r.route.path === '/api/admin/enrichment/category-stats' && r.route.methods.get);
  assert(routes.length > 0, 'Route /api/admin/enrichment/category-stats must exist');

  const handler = routes[0].route.stack[routes[0].route.stack.length - 1].handle;
  const req = { query: {}, params: {}, headers: {}, user: { name: 'Admin', role: 'admin', permissions: ['admin:portal'] } };
  
  const resData = await new Promise(resolve => {
    const res = {
      statusCode: 200,
      json(data) {
        resolve(data);
      },
      status(code) {
        this.statusCode = code;
        return this;
      }
    };
    handler(req, res);
  });

  assert(resData.success, 'Response must be success');
  assert(resData.stats, 'Response must contain stats');
  const stats = resData.stats;

  assert(stats.total > 0, 'Total schools must be > 0');
  assert(stats.enrichedTotal > 0, 'Enriched total must be > 0');
  assert(stats.unscannedTotal > 0, 'Unscanned total must be > 0');
  assert.strictEqual(stats.total, stats.enrichedTotal + stats.unscannedTotal, 'Total must equal enriched + unscanned');

  console.log(`  ✓ Total schools: ${stats.total.toLocaleString()}`);
  console.log(`  ✓ Enriched: ${stats.enrichedTotal.toLocaleString()} | Unscanned: ${stats.unscannedTotal.toLocaleString()}`);
  console.log(`  ✓ Grammar: ${stats.byType.Grammar.enriched} enriched / ${stats.byType.Grammar.unscanned} unscanned (${stats.byType.Grammar.total} total)`);
  console.log(`  ✓ Independent: ${stats.byType.Independent.enriched} enriched / ${stats.byType.Independent.unscanned} unscanned (${stats.byType.Independent.total} total)`);
  console.log(`  ✓ Comprehensive: ${stats.byType.Comprehensive.enriched} enriched / ${stats.byType.Comprehensive.unscanned} unscanned (${stats.byType.Comprehensive.total} total)`);
  console.log(`  ✓ Greater London: ${stats.byRegion['Greater London'].enriched} enriched / ${stats.byRegion['Greater London'].unscanned} unscanned (${stats.byRegion['Greater London'].total} total)`);
}

function testFrontendIntegration() {
  console.log('\n[2. Verifying DOM Elements & UI Navigation Functions]');
  const adminHtmlPath = path.join(__dirname, '../public/admin.html');
  const html = fs.existsSync(adminHtmlPath) ? fs.readFileSync(adminHtmlPath, 'utf8') : fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert(html.includes('id="enrichment-category-breakdown-card"'), 'Must contain breakdown card in index.html');
  assert(html.includes('id="enrichment-category-cards-grid"'), 'Must contain category cards grid in index.html');
  assert(html.includes('id="enrichment-attribute-chips"'), 'Must contain attribute chips container in index.html');
  console.log('  ✓ Verified HTML containers in public/index.html.');

  const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert(js.includes('function navigateToFilteredDirectory'), 'Must declare navigateToFilteredDirectory in app.js');
  assert(js.includes('function loadEnrichmentCategoryStats'), 'Must declare loadEnrichmentCategoryStats in app.js');
  assert(js.includes('window.navigateToFilteredDirectory = navigateToFilteredDirectory'), 'Must export navigateToFilteredDirectory');
  console.log('  ✓ Verified controller functions in public/js/app.js.');
}

async function run() {
  await testCategoryStatsApi();
  testFrontendIntegration();
  console.log('\n======================================================');
  console.log('🎉 ALL DATA ENRICHMENT CATEGORY BREAKDOWN TESTS PASSED!');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
