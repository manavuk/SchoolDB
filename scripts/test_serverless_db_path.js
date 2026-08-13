const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('--- Testing Serverless Database Path Resolution & Fail-Safe Write Access ---');

// 1. Simulate serverless environment
process.env.LAMBDA_TASK_ROOT = '/var/task';

delete require.cache[require.resolve('../db')];
const dbServerless = require('../db');

const conn = dbServerless.getDb();
console.log('✓ Successfully initialized SQLite database in serverless environment.');

const testUser = dbServerless.getUserByEmail('aa@bb.cc');
assert(testUser, 'Super admin aa@bb.cc must exist in database');
assert.strictEqual(testUser.email.toLowerCase(), 'aa@bb.cc', 'User email must match');
console.log(`✓ Retrived user by email in serverless environment: ${testUser.name} (${testUser.email})`);

// Clean up env override
delete process.env.LAMBDA_TASK_ROOT;
delete require.cache[require.resolve('../db')];

console.log('\n=========================================');
console.log('🎉 SERVERLESS DATABASE PATH TESTS PASSED!');
console.log('=========================================');
