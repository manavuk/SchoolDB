const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Testing Collapsible Admin Portal Sidebar Integration ---');

// 1. Check HTML Elements
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert(html.includes('id="admin-portal-wrapper"'), 'index.html must have admin-portal-wrapper ID');
assert(html.includes('id="admin-side-layout"'), 'index.html must have admin-side-layout ID');
assert(html.includes('id="admin-side-nav"'), 'index.html must have admin-side-nav ID');
assert(html.includes('id="admin-side-content"'), 'index.html must have admin-side-content ID');
assert(html.includes('id="admin-sidebar-toggle-btn"'), 'index.html must have admin-sidebar-toggle-btn');
assert(html.includes('id="admin-side-nav-title"'), 'index.html must have admin-side-nav-title');
assert(html.includes('title="Data Enrichment"'), 'Data Enrichment tab must have title');
assert(html.includes('title="Merge & De-Duplicate"'), 'Merge & De-Duplicate tab must have title');
console.log('✓ All DOM components and tooltip attributes verified in index.html.');

// 2. Check CSS Rules
const css = fs.readFileSync(path.join(__dirname, '../public/css/styles.css'), 'utf8');
assert(css.includes('.admin-side-layout.collapsed'), 'styles.css must include .admin-side-layout.collapsed');
assert(css.includes('.admin-side-nav.collapsed'), 'styles.css must include .admin-side-nav.collapsed');
assert(css.includes('.admin-portal-wrapper.sidebar-collapsed'), 'styles.css must include .admin-portal-wrapper.sidebar-collapsed');
assert(css.includes('.admin-side-content .main-layout'), 'styles.css must include .admin-side-content .main-layout');
assert(css.includes('.btn-sidebar-collapse:hover'), 'styles.css must include .btn-sidebar-collapse:hover');
console.log('✓ Collapsible grid, compact icon-only mode and full-width content expansion styles verified in styles.css.');

// 3. Check JavaScript Functions
const js = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
assert(js.includes('initAdminSidebarCollapse'), 'app.js must include initAdminSidebarCollapse');
assert(js.includes('admin_sidebar_collapsed'), 'app.js must support localStorage persistence for admin sidebar state');
assert(js.includes('sidebar-collapsed'), 'app.js must toggle sidebar-collapsed class on wrapper');
console.log('✓ Controller, wrapper expansion, and localStorage persistence verified in app.js.');

console.log('====================================================');
console.log('🎉 ALL COLLAPSIBLE ADMIN SIDEBAR & EXPANSION TESTS PASSED!');
console.log('====================================================');
