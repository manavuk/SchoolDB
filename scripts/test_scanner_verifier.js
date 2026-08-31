const assert = require('assert');
const path = require('path');
const db = require('../db');
const scannerVerifier = require('./scanner_verifier');

console.log('=== RUNNING TESTS: School Admissions Web Crawler, Verifier & Anomaly Engine ===\n');

async function runTests() {
  let passed = 0;
  let failed = 0;
  const asyncQueue = [];

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  function asyncTest(name, fn) {
    asyncQueue.push(async () => {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
      } catch (err) {
        console.error(`  ✗ ${name}:`, err.message);
        failed++;
      }
    });
  }

  console.log('[1. Priority Queue & Selection Tests]');
  test('Priority queue generates correct categories', () => {
    const londonInd = db.getSchoolsForScannerBatch('LONDON_INDEPENDENT', 5);
    assert(Array.isArray(londonInd), 'Should return an array');
    assert(londonInd.length <= 5, 'Should respect limit');
    if (londonInd.length > 0) {
      assert.strictEqual(londonInd[0].schoolType, 'Independent', 'First category must be Independent');
    }

    const grammar = db.getSchoolsForScannerBatch('GRAMMAR', 5);
    assert(Array.isArray(grammar), 'Should return grammar schools');
    if (grammar.length > 0) {
      assert.strictEqual(grammar[0].schoolType, 'Grammar', 'Must be Grammar type');
    }
  });

  console.log('\n[2. Website & Domain Verification Tests]');
  test('Identifies valid domain matching school name', () => {
    const mockSchool = { name: 'Highgate School', website: 'https://www.highgateschool.org.uk' };
    const html = `<html><head><title>Highgate School | Independent Day School North London</title></head><body><h1>Welcome to Highgate School</h1></body></html>`;
    const metadata = scannerVerifier.extractHtmlMetadata(html);
    const check = scannerVerifier.verifySchoolWebsiteIdentity(mockSchool, html, metadata, mockSchool.website);
    assert.strictEqual(check.valid, true, 'Should be valid match');
    assert.strictEqual(check.tag, null, 'Should have no tag error');
    assert(check.matchScore >= 80, 'Score should be high');
  });

  test('Detects domain mismatch / parked domain', () => {
    const mockSchool = { name: 'Emanuel School', website: 'https://emanuel-fake-parked.com' };
    const html = `<html><head><title>Domain For Sale - Buy this domain</title></head><body><h1>This domain is for sale</h1></body></html>`;
    const metadata = scannerVerifier.extractHtmlMetadata(html);
    const check = scannerVerifier.verifySchoolWebsiteIdentity(mockSchool, html, metadata, mockSchool.website);
    assert.strictEqual(check.valid, false, 'Should be invalid');
    assert.strictEqual(check.tag, 'domain_mismatch');
  });

  console.log('\n[3. Contact Information Verification Tests]');
  test('Verifies matching contact phone, email and postcode', () => {
    const mockSchool = {
      phone: '020 8340 1524',
      email: 'admissions@highgateschool.org.uk',
      postcode: 'N6 4AY'
    };
    const html = `<div>Contact admissions: admissions@highgateschool.org.uk or call 020 8340 1524. Address: North Road, London N6 4AY.</div>`;
    const extracted = scannerVerifier.extractContactInfoFromHtml(html);
    const contactCheck = scannerVerifier.verifySchoolContactInfo(mockSchool, extracted);
    assert.strictEqual(contactCheck.valid, true, 'Contact info should match');
    assert.strictEqual(contactCheck.anomalies.length, 0, 'No contact anomalies');
  });

  test('Flags contact mismatch when phone/email differ', () => {
    const mockSchool = {
      phone: '020 7000 0000',
      email: 'wrong@oldemail.com',
      postcode: 'SW1A 1AA'
    };
    const html = `<div>Admissions: enquiries@school.org.uk or call 020 8123 4567. London N6 4AY.</div>`;
    const extracted = scannerVerifier.extractContactInfoFromHtml(html);
    const contactCheck = scannerVerifier.verifySchoolContactInfo(mockSchool, extracted);
    assert.strictEqual(contactCheck.valid, false, 'Should detect contact discrepancy');
    assert(contactCheck.anomalies.some(a => a.type === 'CONTACT_PHONE_MISMATCH'), 'Should flag phone mismatch');
  });

  console.log('\n[4. Exam Type & Gender Verification Tests]');
  test('Verifies GL Assessment / ISEB exam types', () => {
    const mockSchool = { entranceExamType: '11+ GL Assessment (Kent Test)' };
    const text = 'Candidates take the Kent 11+ GL Assessment test covering English, Maths and Reasoning.';
    const check = scannerVerifier.verifyExamTypeDetails(mockSchool, text);
    assert.strictEqual(check.valid, true, 'Should match GL Assessment');
  });

  test('Flags exam type mismatch', () => {
    const mockSchool = { entranceExamType: 'Non-Selective / Comprehensive' };
    const text = 'All applicants for 11+ must sit the ISEB Common Pre-Test in November.';
    const check = scannerVerifier.verifyExamTypeDetails(mockSchool, text);
    assert.strictEqual(check.valid, false, 'Should flag exam type discrepancy');
    assert.strictEqual(check.anomalies[0].type, 'EXAM_TYPE_MISMATCH');
  });

  test('Verifies gender policy (Girls / Boys / Mixed)', () => {
    const mockSchool = { name: 'Channing School', gender: 'Girls' };
    const text = 'Channing School is an independent day school for girls aged 4 to 18.';
    const meta = { title: 'Channing School for Girls', description: 'All-girls school Highgate' };
    const check = scannerVerifier.verifyGenderDetails(mockSchool, text, meta);
    assert.strictEqual(check.valid, true, 'Should match girls school');
  });

  console.log('\n[5. 11+ Admissions Dates & Missing Data Tests]');
  test('Extracts and validates 11+ admission milestones', () => {
    const mockSchool = {
      entranceExamDates: JSON.stringify({
        registrationDeadline: '13 November 2026',
        examDate: '9 January 2027',
        resultsDate: '12 February 2027'
      })
    };
    const text = 'Registration closes on 13 November 2026. The 11+ exam takes place on 9 January 2027. Results emailed on 12 February 2027.';
    const check = scannerVerifier.extractAndVerifyAdmissionDates(mockSchool, text);
    assert.strictEqual(check.hasData, true, 'Should have admissions section');
    assert.strictEqual(check.anomalies.length, 0, 'No date anomalies');
    assert.strictEqual(check.fieldVerifications.registrationDeadline.verified, true, 'Deadline must be marked verified');
  });

  test('Flags DATE_MISMATCH when website deadline differs from database (e.g. 31st October vs 20 November)', () => {
    const mockSchool = {
      name: 'Westminster Academy Independent Wing',
      website: 'https://www.westminsteracademy.org.uk',
      entranceExamDates: JSON.stringify({
        registrationDeadline: '20 November 2026'
      })
    };
    const text = 'The deadline for Year 7 admissions for September 2027 entry is 31st October.';
    const check = scannerVerifier.extractAndVerifyAdmissionDates(mockSchool, text);
    assert.strictEqual(check.hasData, true, 'Should extract admissions date');
    assert.strictEqual(check.anomalies.length, 1, 'Should flag 1 anomaly for date mismatch');
    assert.strictEqual(check.anomalies[0].type, 'DATE_MISMATCH');
    assert.strictEqual(check.anomalies[0].field, 'registrationDeadline');
    assert.strictEqual(check.anomalies[0].dbValue, '20 November 2026');
    assert.strictEqual(check.anomalies[0].webValue, '31st October 2026');
    assert.strictEqual(check.fieldVerifications.registrationDeadline.verified, false, 'Should NOT be verified when dates differ');
    assert.strictEqual(check.proposedDates.registrationDeadline, '31st October 2026', 'Proposed date must be the scanned web date');
  });

  test('Extracts natural deadline phrasing (e.g. Complete your online application by Friday 6 November 2026) and flags mismatch against 13 November', () => {
    const mockSchool = {
      name: "Queen's College",
      website: 'https://www.qcl.org.uk/admissions/11-admissions',
      entranceExamDates: JSON.stringify({
        registrationDeadline: '13 November 2026',
        examDate: '9 January 2027',
        resultsDate: '12 February 2027'
      })
    };
    const text = 'Complete your online application by Friday 6 November 2026 to be considered for 11+ (Year 7) entry in September 2027. Entrance Examination: Saturday 9 January 2027. Results will be emailed on 12 February 2027.';
    const check = scannerVerifier.extractAndVerifyAdmissionDates(mockSchool, text);
    assert.strictEqual(check.hasData, true, 'Should extract admissions milestones');
    assert.strictEqual(check.extractedDates.registrationDeadline, '6 November 2026', 'Must extract exact 6 November 2026 deadline');
    assert.strictEqual(check.extractedDates.examDate, '9 January 2027', 'Must extract 9 January 2027 exam date');
    assert.strictEqual(check.extractedDates.resultsDate, '12 February 2027', 'Must extract 12 February 2027 results date');
    assert.strictEqual(check.fieldVerifications.registrationDeadline.verified, false, 'Must NOT verify 13 November when web is 6 November');
    assert.strictEqual(check.fieldVerifications.examDate.verified, true, 'Must verify 9 January 2027 when matching');
    assert.strictEqual(check.fieldVerifications.resultsDate.verified, true, 'Must verify 12 February 2027 when matching');
    assert.strictEqual(check.proposedDates.registrationDeadline, '6 November 2026', 'Proposed date must be exact web date 6 November 2026');
  });

  test('Flags auto_verification_data_missing when website has no 11+ dates', () => {
    const mockSchool = {
      name: 'Sample Primary School',
      entranceExamDates: '{}'
    };
    const text = 'Welcome to our school website. Please visit our gallery and term dates calendar.';
    const check = scannerVerifier.extractAndVerifyAdmissionDates(mockSchool, text);
    assert.strictEqual(check.hasData, false, 'Should detect missing admissions section');
    assert.strictEqual(check.tag, 'auto_verification_data_missing');
  });

  console.log('\n[6. Database Integration & Tag Taxonomy Tests]');
  test('getAllDateAnomalies categorizes into missing websites, data missing and auto-verified', () => {
    const anomaliesData = db.getAllDateAnomalies();
    assert(anomaliesData.stats, 'Stats must exist');
    assert(Array.isArray(anomaliesData.anomalies), 'Anomalies list exists');
    assert(Array.isArray(anomaliesData.missingWebsites), 'Dedicated missing websites list exists');
    assert(Array.isArray(anomaliesData.dataMissing), 'Data missing list exists');
    assert(Array.isArray(anomaliesData.autoVerified), 'Auto-verified list exists');
    console.log(`    Total Schools: ${anomaliesData.allSchools.length}`);
    console.log(`    Auto-Verified: ${anomaliesData.autoVerified.length}`);
    console.log(`    Missing Websites: ${anomaliesData.missingWebsites.length}`);
    console.log(`    Data Missing on Web: ${anomaliesData.dataMissing.length}`);
    console.log(`    Active Anomalies: ${anomaliesData.anomalies.length}`);
    console.log(`    Avg Quality Score: ${anomaliesData.stats.avgQualityScore}%`);
  });

  test('saveSchoolVerificationResult persists tags and adjusts confidence score', () => {
    const schools = db.getAllSchools();
    if (schools.length > 0) {
      const target = schools[0];
      const mockResult = {
        status: 'auto_verified',
        tags: ['auto_verified'],
        confidenceScore: 98,
        anomalies: [],
        verifiedAt: new Date().toISOString()
      };
      const updated = db.saveSchoolVerificationResult(target.id, mockResult);
      assert.strictEqual(updated.verification_status, 'auto_verified');
      assert(updated.verification_tags.includes('auto_verified'), 'Must include auto_verified tag');
      assert.strictEqual(updated.confidence_score, 98, 'Confidence score must be 98%');
    }
  });

  console.log('\n[7. Google Search & Missing Website Discovery Tests]');
  test('Filters out blacklisted domains and directories', () => {
    assert.strictEqual(scannerVerifier.isBlacklistedDomain('https://en.wikipedia.org/wiki/School'), true);
    assert.strictEqual(scannerVerifier.isBlacklistedDomain('https://get-information-about-schools.service.gov.uk/12345'), true);
    assert.strictEqual(scannerVerifier.isBlacklistedDomain('https://www.snobe.co.uk/school/12345'), true);
    assert.strictEqual(scannerVerifier.isBlacklistedDomain('https://www.facebook.com/schoolpage'), true);
    assert.strictEqual(scannerVerifier.isBlacklistedDomain('https://www.latymer-upper.org/'), false);
    assert.strictEqual(scannerVerifier.isBlacklistedDomain('https://stpauls.org.uk/admissions'), false);
  });

  test('Extracts clean organic candidate URLs from search result HTML', () => {
    const mockGoogleHtml = `
      <div>
        <a href="https://www.google.com/url?q=https://en.wikipedia.org/wiki/Latymer&sa=U">Wikipedia</a>
        <a href="https://www.google.com/url?q=https://www.latymer-upper.org/admissions&sa=U">Latymer Upper Official</a>
        <a href="https://www.google.com/url?q=https://www.snobe.co.uk/latymer&sa=U">Snobe Directory</a>
        <a href="https://www.google.com/url?q=https://latymerprep.org/welcome&sa=U">Latymer Prep</a>
      </div>
    `;
    const candidates = scannerVerifier.extractSearchResultsUrls(mockGoogleHtml);
    assert(candidates.includes('https://www.latymer-upper.org/admissions'), 'Should extract official school url');
    assert(candidates.includes('https://latymerprep.org/welcome'), 'Should extract second candidate');
    assert(!candidates.some(u => u.includes('wikipedia.org') || u.includes('snobe.co.uk')), 'Should omit blacklisted domains');
  });

  asyncTest('Discovers and proposes website when 1st candidate matches name, address and phone', async () => {
    const mockSchoolNoWebsite = {
      id: 'mock_disc_01',
      name: 'St Benedict\'s Senior School',
      schoolType: 'Independent',
      postcode: 'W5 2ES',
      la: 'Ealing',
      phone: '020 8862 2000',
      website: '' // No website in record
    };

    const mockCandidates = [
      'https://www.stbenedicts.org.uk'
    ];

    const mockPageHtml = `
      <html>
        <head><title>St Benedict's School, Ealing | Catholic Independent Co-ed Day School</title></head>
        <body>
          <h1>Welcome to St Benedict's School</h1>
          <p>54 Eaton Rise, Ealing, London W5 2ES</p>
          <p>Telephone: 020 8862 2000 &bull; Admissions: enquiries@stbenedicts.org.uk</p>
          <div class="admissions">
            Registration deadline is 13 November 2026. 11+ Entrance Examination date is 5 January 2027.
          </div>
        </body>
      </html>
    `;

    const auditResult = await scannerVerifier.auditAndVerifySchool(mockSchoolNoWebsite, {
      searchFn: async () => mockCandidates,
      fetchFn: async () => ({ ok: true, status: 200, body: mockPageHtml })
    });

    assert.strictEqual(auditResult.proposedWebsite, 'https://www.stbenedicts.org.uk', 'Should propose discovered candidate website');
    assert(auditResult.tags.includes('proposed_website'), 'Should have proposed_website tag');
    assert(auditResult.anomalies.some(a => a.type === 'PROPOSED_WEBSITE'), 'Should flag PROPOSED_WEBSITE anomaly');
    assert(auditResult.confidenceScore >= 90, 'Confidence score should be high when details align');
  });

  asyncTest('Inspects 2nd candidate if 1st search result does not match details', async () => {
    const mockSchool = {
      id: 'mock_disc_02',
      name: 'City of London School',
      schoolType: 'Independent',
      postcode: 'EC4V 3AL',
      la: 'City of London',
      phone: '020 7489 0291',
      website: ''
    };

    const mockCandidates = [
      'https://some-unrelated-blog.co.uk/articles', // Result #1 (Does not match)
      'https://www.cityoflondonschool.org.uk'       // Result #2 (Matches)
    ];

    const auditResult = await scannerVerifier.auditAndVerifySchool(mockSchool, {
      searchFn: async () => mockCandidates,
      fetchFn: async (url) => {
        if (url.includes('unrelated-blog')) {
          return { ok: true, status: 200, body: '<html><head><title>London Architecture Blog</title></head><body>Photos of buildings in EC1</body></html>' };
        }
        return {
          ok: true,
          status: 200,
          body: '<html><head><title>City of London School for Boys</title></head><body>Queen Victoria Street, EC4V 3AL. Phone: 020 7489 0291. Admissions 2026/27.</body></html>'
        };
      }
    });

    assert.strictEqual(auditResult.proposedWebsite, 'https://www.cityoflondonschool.org.uk', 'Should evaluate 2nd result and propose it');
  });

  asyncTest('Does not propose inaccurate website if top results do not match (accurately reports missing_website)', async () => {
    const mockSchool = {
      id: 'mock_disc_03',
      name: 'Rural Village Academy',
      schoolType: 'Comprehensive',
      postcode: 'NR1 1AA',
      la: 'Norfolk',
      phone: '01603 999999',
      website: ''
    };

    const mockCandidates = [
      'https://www.completely-different-school.sch.uk' // Discrepant location, phone, and name
    ];

    const auditResult = await scannerVerifier.auditAndVerifySchool(mockSchool, {
      searchFn: async () => mockCandidates,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        body: '<html><head><title>Kent High School</title></head><body>Maidstone, ME14 1AA. Phone: 01622 111111.</body></html>'
      })
    });

    assert.strictEqual(auditResult.status, 'missing_website', 'Should not force an inaccurate proposal');
    assert.strictEqual(auditResult.proposedWebsite, undefined, 'No website should be proposed');
    assert(auditResult.tags.includes('missing_website'), 'Should flag missing_website accurately');
  });

  // Await all queued async tests
  for (const task of asyncQueue) {
    await task();
  }

  console.log(`\n======================================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

