const assert = require('assert');
const db = require('../db');

console.log('--- Testing User Field Accuracy Reporting, Custom Overrides & Admin Audit Panel ---');

const testUserId = `usr-parent-report-${Date.now()}`;
const sampleUser = {
  id: testUserId,
  name: 'Parent Field Tester',
  email: `parent.tester.${Date.now()}@gmail.com`,
  password: 'user',
  permissions: ['parent:recommendations', 'parent:portfolio']
};

db.insertUser(sampleUser);
console.log(`✓ Created test parent user ${sampleUser.email}`);

const schools = db.getAllSchools();
assert(schools.length > 0, 'Schools must exist in SQLite database');
const masterSchoolBefore = schools[0];
const schoolId = masterSchoolBefore.id;
console.log(`✓ Original master pupilCount for ${masterSchoolBefore.name} (${schoolId}): ${masterSchoolBefore.pupilCount}`);

// 1. Submit Thumbs Up rating for entranceExamType
const upReport = db.saveFieldReport({
  userId: testUserId,
  schoolId,
  fieldName: 'entranceExamType',
  status: 'up',
  originalValue: masterSchoolBefore.entranceExamType,
  customValue: ''
});
assert.strictEqual(upReport.status, 'up', 'Field report status should be up');
console.log('✓ Submitted Thumbs Up rating for entranceExamType');

// 2. Submit Thumbs Down rating with custom value "1,250 Pupils" for pupilCount
const downReport = db.saveFieldReport({
  userId: testUserId,
  schoolId,
  fieldName: 'pupilCount',
  status: 'down',
  originalValue: masterSchoolBefore.pupilCount,
  customValue: '1,250 Pupils'
});
assert.strictEqual(downReport.status, 'down', 'Field report status should be down');
assert.strictEqual(downReport.customValue, '1,250 Pupils', 'Custom value should match');
console.log('✓ Submitted Thumbs Down rating with custom value override "1,250 Pupils"');

// 3. Verify Master record in SQLite remains UNTOUCHED
const masterSchoolAfter = db.getSchoolById(schoolId);
assert.strictEqual(masterSchoolAfter.pupilCount, masterSchoolBefore.pupilCount, 'Master database record MUST NOT be altered by user custom value');
console.log(`✓ Master record verified unchanged: ${masterSchoolAfter.pupilCount}`);

// 4. Verify User Field Reports retrieval
const userReports = db.getUserFieldReports(testUserId, schoolId);
assert.strictEqual(userReports.length, 2, 'User should have 2 field reports for this school');
const customPupilReport = userReports.find(r => r.fieldName === 'pupilCount');
assert.strictEqual(customPupilReport.customValue, '1,250 Pupils', 'User custom value must persist');
console.log('✓ Parent custom override retrieved from SQLite:', customPupilReport.customValue);

// 5. Verify Admin Aggregated Reported Errors (Ordered by highest reported school & field)
const adminErrors = db.getAdminReportedErrors();
assert(adminErrors.length > 0, 'Admin error audit panel must return reported errors');
const targetErrorSchool = adminErrors.find(s => s.schoolId === schoolId);
assert.ok(targetErrorSchool, 'Target school must appear in admin error audit panel');
assert.strictEqual(targetErrorSchool.fields[0].fieldName, 'pupilCount', 'Field pupilCount must appear in reported errors');
assert.strictEqual(targetErrorSchool.fields[0].reports[0].customValue, '1,250 Pupils', 'Admin panel must show user custom value');
console.log(`✓ Admin Error Audit Panel aggregated reported errors correctly for ${targetErrorSchool.schoolName}:`);
console.log(`   Field: ${targetErrorSchool.fields[0].fieldName} | Downvotes: ${targetErrorSchool.fields[0].fieldErrorCount} | User Proposed: "${targetErrorSchool.fields[0].reports[0].customValue}"`);

// 6. Test Promoting Custom Value to Master Record (Admin Action)
const updatedMaster = db.updateSchool(schoolId, { pupilCount: 1250 });
assert.strictEqual(updatedMaster.pupilCount, 1250, 'Master record pupilCount updated');
console.log('✓ Admin promoted custom value to master record successfully!');

// Clean up test report
db.deleteFieldReport(testUserId, schoolId, 'pupilCount');
db.deleteFieldReport(testUserId, schoolId, 'entranceExamType');

console.log('\n=========================================');
console.log('🎉 ALL USER FIELD REPORT & CUSTOM OVERRIDE TESTS PASSED!');
console.log('=========================================');
