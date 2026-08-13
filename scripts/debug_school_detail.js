const db = require('../db');

console.log('--- Debugging School Details Lookup ---');

const schools = db.getAllSchools();
console.log(`Total schools in DB: ${schools.length}`);

const queensGate = schools.filter(s => s.name && s.name.includes("Queen's Gate"));
console.log("Queen's Gate matching schools:", queensGate.map(s => ({ id: s.id, name: s.name, urn: s.urn })));

const nottingHill = schools.filter(s => s.name && s.name.includes("Notting Hill"));
console.log("Notting Hill matching schools:", nottingHill.map(s => ({ id: s.id, name: s.name, urn: s.urn })));

if (queensGate.length > 0) {
  const qgId = queensGate[0].id;
  console.log(`Testing db.getSchoolById('${qgId}'):`, db.getSchoolById(qgId));
}

if (nottingHill.length > 0) {
  const nhId = nottingHill[0].id;
  console.log(`Testing db.getSchoolById('${nhId}'):`, db.getSchoolById(nhId));
}
