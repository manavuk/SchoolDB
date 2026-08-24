const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('--- Running Parent Portal 2.0 Admin Setting Integration Test ---');

// 1. Verify SQLite Database system_settings functionality
console.log('1. Testing database system_settings...');
const initialSettings = db.getSystemSettings();
assert(typeof initialSettings === 'object', 'getSystemSettings should return an object');
assert('parentPortal2Enabled' in initialSettings, 'initialSettings must contain parentPortal2Enabled');

// Test saving system settings to true
db.saveSystemSettings({ parentPortal2Enabled: true, customTestKey: 'alpha' });
const updatedSettings = db.getSystemSettings();
assert.strictEqual(updatedSettings.parentPortal2Enabled, true, 'parentPortal2Enabled should be true');
assert.strictEqual(updatedSettings.customTestKey, 'alpha', 'customTestKey should be saved');

// Test saving system settings back to false
db.saveSystemSettings({ parentPortal2Enabled: false });
const revertedSettings = db.getSystemSettings();
assert.strictEqual(revertedSettings.parentPortal2Enabled, false, 'parentPortal2Enabled should be false');
console.log('✓ Database system_settings CRUD operations verified.');

// 2. Verify public/index.html elements
console.log('2. Testing index.html elements...');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

const requiredHtmlElements = [
  'id="setting-parent2-enabled"',
  'id="btn-save-system-settings"',
  'id="p2-toggle-status-badge"',
  'id="tab-parent2-btn"',
  'id="tab-recommend-btn"',
  'id="recommend-tab-label"',
  'id="admin-subpane-settings"'
];

requiredHtmlElements.forEach(el => {
  assert.ok(html.includes(el), `index.html must include element: ${el}`);
});
console.log('✓ All Admin Settings toggle DOM elements verified in index.html.');

// 3. Verify public/css/styles.css styling
console.log('3. Testing styles.css classes...');
const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
const requiredCss = [
  '.switch-toggle',
  '.slider'
];
requiredCss.forEach(c => {
  assert.ok(css.includes(c), `styles.css must include CSS class: ${c}`);
});
console.log('✓ Switch toggle CSS styles verified in styles.css.');

// 4. Verify public/js/app.js controller logic
console.log('4. Testing app.js controller functions...');
const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const requiredJsSymbols = [
  'systemSettings',
  'fetchSystemSettings',
  'loadAdminSettings',
  'loadSystemSettings',
  'updateSystemSettingsUI',
  'saveSystemSettingsHandler',
  'setting-parent2-enabled',
  'btn-save-system-settings'
];

requiredJsSymbols.forEach(sym => {
  assert.ok(js.includes(sym), `app.js must include symbol: ${sym}`);
});
console.log('✓ All Admin Settings toggle controller methods verified in app.js.');

console.log('====================================================');
console.log('🎉 PARENT PORTAL 2.0 ADMIN SETTING INTEGRATION PASSED!');
console.log('====================================================');
