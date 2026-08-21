const db = require('../db');
const assert = require('assert');

console.log('--- Testing Field Confidence Indicators & User Voting Logic ---');

const schoolId = 'sch-100001';
const testField = 'confTestField_' + Date.now();
const testUser = 'user-conf-test-' + Date.now();

// 1. Initial State Check (No votes, no admin review)
let stats = db.getFieldConfidenceStats(schoolId, testUser);
let initialConf = stats[testField] || { score: 60, level: 'Medium', isAdminVerified: false };
console.log('✓ Initial Baseline Confidence:', initialConf.score + '% (' + initialConf.level + ')');
assert.strictEqual(initialConf.score, 60, 'Initial score should default to 60% baseline');
assert.strictEqual(initialConf.isAdminVerified, false, 'Field should not be admin verified initially');

// 2. Thumbs-Up Vote Test (+1)
db.castFieldConfidenceVote(testUser, schoolId, testField, 1);
stats = db.getFieldConfidenceStats(schoolId, testUser);
let upConf = stats[testField];
console.log('✓ After Thumbs-Up Vote:', upConf.score + '% (' + upConf.level + ') - Upvotes:', upConf.upvotes);
assert.strictEqual(upConf.score, 65, 'Thumbs up should add +5% to confidence score');
assert.strictEqual(upConf.userVote, 1, 'User vote status should equal +1');

// 3. Thumbs-Down Vote Test (-1)
db.castFieldConfidenceVote(testUser, schoolId, testField, -1);
stats = db.getFieldConfidenceStats(schoolId, testUser);
let downConf = stats[testField];
console.log('✓ After Thumbs-Down Vote:', downConf.score + '% (' + downConf.level + ') - Downvotes:', downConf.downvotes);
assert.strictEqual(downConf.score, 50, 'Thumbs down should subtract -10% from baseline score');
assert.strictEqual(downConf.level, 'Low', 'Score below 60% should be classified as Low confidence');

// 4. Admin Verification Test (100% High Confidence)
db.markFieldAdminReviewed(schoolId, testField, 'Super Admin');
stats = db.getFieldConfidenceStats(schoolId, testUser);
let adminConf = stats[testField];
console.log('✓ After Admin Verification:', adminConf.score + '% (' + adminConf.label + ')');
assert.strictEqual(adminConf.score, 100, 'Admin verified field must have 100% confidence score');
assert.strictEqual(adminConf.isAdminVerified, true, 'isAdminVerified flag must be true');

// Clean up test votes
db.castFieldConfidenceVote(testUser, schoolId, testField, 0);

console.log('\n=========================================');
console.log('🎉 ALL FIELD CONFIDENCE & VOTING TESTS PASSED!');
console.log('=========================================\n');
