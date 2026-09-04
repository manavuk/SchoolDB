const db = require('../db');

console.log('=== Cleaning Test Field Values & Re-queueing for Data Enrichment ===\n');

// Helper to determine if a string contains bogus test markers
function isTestValue(str) {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  
  // Whitelist legitimate geographic names & statutory URLs
  if (s.includes('testbourne') || 
      s.includes('testwood') || 
      s.includes('ingatestone') || 
      s.includes('countesthorpe') || 
      s.includes('whitestitch') || 
      s.includes('selection-tests') || 
      s.includes('kent-test')) {
    return false;
  }

  // Detect test words / test URLs
  return /\btest\b|\btests\b|testschool|test\.sch\.uk|proposal-rejection-test/i.test(s);
}

const allSchools = db.getAllSchools();
const modifiedSchools = [];

for (const school of allSchools) {
  const nameHasTest = isTestValue(school.name);
  const addrHasTest = isTestValue(school.address);
  const webHasTest = isTestValue(school.website);

  if (nameHasTest || addrHasTest || webHasTest) {
    const original = {
      id: school.id,
      urn: school.urn,
      name: school.name,
      address: school.address,
      website: school.website,
      status: school.verification_status,
      verified_at: school.verified_at,
      tags: school.verification_tags,
      confidence: school.confidence_score
    };

    const updates = {};
    const clearedFields = [];

    if (nameHasTest) {
      updates.name = '';
      clearedFields.push('name');
    }
    if (addrHasTest) {
      updates.address = '';
      clearedFields.push('address');
    }
    if (webHasTest) {
      updates.website = '';
      clearedFields.push('website');
    }

    // Reset verification status and queue for data enrichment
    updates.verification_status = 'unverified';
    updates.verified_at = null;
    updates.verification_report = null;
    updates.verification_tags = ['unscanned'];
    updates.confidence_score = 50;

    // Apply update to database
    db.updateSchool(school.id, updates);

    modifiedSchools.push({
      id: school.id,
      urn: school.urn,
      clearedFields,
      before: original,
      after: {
        id: school.id,
        urn: school.urn,
        name: updates.name !== undefined ? updates.name : school.name,
        address: updates.address !== undefined ? updates.address : school.address,
        website: updates.website !== undefined ? updates.website : school.website,
        status: updates.verification_status,
        verified_at: updates.verified_at,
        tags: updates.verification_tags,
        confidence: updates.confidence_score
      }
    });
  }
}

console.log(`Successfully processed and re-queued ${modifiedSchools.length} schools.`);
console.log('\n--- Cleared Field Statistics ---');
const nameCount = modifiedSchools.filter(m => m.clearedFields.includes('name')).length;
const addrCount = modifiedSchools.filter(m => m.clearedFields.includes('address')).length;
const webCount = modifiedSchools.filter(m => m.clearedFields.includes('website')).length;

console.log(`- Cleared 'name': ${nameCount} schools`);
console.log(`- Cleared 'address': ${addrCount} schools`);
console.log(`- Cleared 'website': ${webCount} schools`);
console.log(`- Re-queued for data enrichment (unverified/unscanned): ${modifiedSchools.length} schools\n`);

// Output full list of modified schools in JSON format
console.log(JSON.stringify(modifiedSchools, null, 2));
