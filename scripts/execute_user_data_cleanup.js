const db = require('../db');

console.log('=== Executing Database Cleanup per User Request ===\n');

// ----------------------------------------------------
// 1. Real Schools with Test Artifacts in Email & Description
// ----------------------------------------------------
const realSchoolIds = [
  'sch-553721', 'sch-023472', 'sch-023474', 'sch-023476', 'sch-023478',
  'sch-023483', 'sch-023486', 'sch-023488', 'sch-023490', 'sch-023492',
  'sch-023494', 'sch-023496', 'sch-023513', 'sch-023516', 'sch-023518',
  'sch-023520', 'sch-023522', 'sch-023525', 'sch-023527', 'sch-517281',
  'sch-517283'
];

let cleanedRealCount = 0;
for (const id of realSchoolIds) {
  const school = db.getSchoolById(id);
  if (school) {
    const updates = {};
    if (school.email === 'admissions.test@schooldb.sch.uk') {
      updates.email = '';
    }
    if (school.description === 'Updated test description for edit modal verification.') {
      updates.description = '';
    }
    if (Object.keys(updates).length > 0) {
      db.updateSchool(id, updates);
      cleanedRealCount++;
      console.log(`[1. Cleaned Real School] ${school.name} (${id}) -> email/description cleared`);
    }
  }
}
console.log(`✓ Completed Part 1: Cleaned test artifacts in ${cleanedRealCount} real schools.\n`);

// ----------------------------------------------------
// 2. Synthetic Test Records Spawned by Test Suites
// ----------------------------------------------------
const allSchools = db.getAllSchools();
const syntheticCopiesToDelete = allSchools.filter(s => 
  /^(sch_reject_test_|primary_178|temp_test_school_|test_enrichment_diff_school|test_qcl_llm)/i.test(s.id)
);

let deletedSyntheticCount = 0;
for (const s of syntheticCopiesToDelete) {
  db.deleteSchool(s.id);
  deletedSyntheticCount++;
}
console.log(`✓ Completed Part 2: Removed ${deletedSyntheticCount} synthetic test copy records from database.\n`);

// ----------------------------------------------------
// 3. Suspicious / Placeholder URN Patterns
// ----------------------------------------------------
const updatedSchools = db.getAllSchools();
const syntheticUrns = ['N/A', '100100', '999888', '999999', '999111222', '123456', '000000', '111111'];

let clearedUrnCount = 0;
for (const s of updatedSchools) {
  if (s.urn && syntheticUrns.includes(s.urn.trim())) {
    db.updateSchool(s.id, { urn: '' });
    clearedUrnCount++;
    console.log(`[3. Cleared Synthetic URN] ${s.name} (${s.id}) -> cleared URN '${s.urn}'`);
  }
}
console.log(`✓ Completed Part 3: Cleared synthetic URN on ${clearedUrnCount} records (records preserved without URN).\n`);

console.log('=== FINAL SUMMARY ===');
console.log(`- Total Remaining Schools in Database: ${db.getAllSchools().length}`);
console.log(`- Real Schools with Test Fields Cleared: ${cleanedRealCount}`);
console.log(`- Synthetic Copy Records Deleted: ${deletedSyntheticCount}`);
console.log(`- Records with Synthetic URN Cleared: ${clearedUrnCount}`);
