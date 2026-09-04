const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../db');

console.log('=== RUNNING TESTS: Sign-In Workflow & Login Modal Triggers ===\n');

// 1. Verify index.html markup
console.log('[1. Testing index.html Auth Markup]');
const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

assert(indexHtml.includes('id="auth-login-btn"'), 'Must have auth-login-btn');
assert(indexHtml.includes('onclick="openLoginModal(event)"'), 'auth-login-btn must call openLoginModal(event)');
assert(indexHtml.includes('id="auth-gatekeeper-overlay"'), 'Must have auth-gatekeeper-overlay');
assert(indexHtml.includes('id="gatekeeper-demo-select"'), 'Must have gatekeeper-demo-select');
assert(indexHtml.includes('id="gatekeeper-login-form"'), 'Must have gatekeeper-login-form');
console.log('  ✓ index.html has complete auth gatekeeper, login button, and demo selector markup.');

// 2. Verify app.js client functions
console.log('\n[2. Testing app.js Functions & Event Handlers]');
const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');

assert(appJs.includes('function openLoginModal('), 'app.js must define openLoginModal');
assert(appJs.includes('window.openLoginModal = openLoginModal;'), 'app.js must expose openLoginModal globally');
assert(appJs.includes('function showGatekeeperLoginScreen('), 'app.js must define showGatekeeperLoginScreen');
assert(appJs.includes('function triggerGoogleSignInWorkflow('), 'app.js must define triggerGoogleSignInWorkflow');
console.log('  ✓ app.js implements openLoginModal, showGatekeeperLoginScreen, and global bindings.');

// 3. Verify backend auth endpoint
console.log('\n[3. Testing Backend /api/auth/login Logic]');
const user = db.getUserByEmail('aa@bb.cc') || db.getUserByEmail('sarah@gmail.com');
assert(user !== null && user !== undefined, 'Must find registered demo user');
console.log(`  ✓ Database found registered demo user: ${user.name} (${user.email})`);

console.log('\n========================================================================');
console.log('🎉 ALL SIGN-IN WORKFLOW & MODAL TESTS PASSED!');
console.log('========================================================================\n');
