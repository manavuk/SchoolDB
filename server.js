const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers to interact with database
function readData() {
  try {
    return db.getAllSchools();
  } catch (err) {
    console.error('Error reading schools dataset from SQLite:', err);
    return [];
  }
}

function writeData(data) {
  try {
    db.insertSchoolsBulk(data);
    return true;
  } catch (err) {
    console.error('Error writing schools dataset to SQLite:', err);
    return false;
  }
}

// GET /api/schools - Search & Filter
app.get('/api/schools', (req, res) => {
  let schools = readData();
  const { search, type, gender, ofsted, exam, la, minPupils, maxPupils, hot, official } = req.query;

  if (search) {
    const q = search.toLowerCase().trim();
    schools = schools.filter(s =>
      (s.name && s.name.toLowerCase().includes(q)) ||
      (s.postcode && s.postcode.toLowerCase().includes(q)) ||
      (s.la && s.la.toLowerCase().includes(q)) ||
      (s.address && s.address.toLowerCase().includes(q))
    );
  }

  if (hot === 'true' || hot === 'hot') {
    schools = schools.filter(s => s.hot === true);
  }

  if (official === 'true' || official === 'official') {
    schools = schools.filter(s => s.official === true);
  }

  if (type) {
    schools = schools.filter(s => s.schoolType && s.schoolType.toLowerCase().includes(type.toLowerCase()));
  }

  if (gender) {
    schools = schools.filter(s => s.gender && s.gender.toLowerCase().includes(gender.toLowerCase()));
  }

  if (ofsted) {
    schools = schools.filter(s => s.ofstedRating && s.ofstedRating.toLowerCase() === ofsted.toLowerCase());
  }

  if (exam) {
    schools = schools.filter(s => s.entranceExamType && s.entranceExamType.toLowerCase().includes(exam.toLowerCase()));
  }

  if (la) {
    schools = schools.filter(s => s.la && s.la.toLowerCase() === la.toLowerCase());
  }

  if (minPupils) {
    schools = schools.filter(s => s.pupilCount >= parseInt(minPupils, 10));
  }

  if (maxPupils) {
    schools = schools.filter(s => s.pupilCount <= parseInt(maxPupils, 10));
  }


  res.json({
    total: schools.length,
    schools
  });
});

// GET /api/stats - Summary statistics
app.get('/api/stats', (req, res) => {
  const schools = readData();
  const total = schools.length;
  const grammarCount = schools.filter(s => s.schoolType && s.schoolType.includes('Grammar')).length;
  const independentCount = schools.filter(s => s.schoolType && s.schoolType.includes('Independent')).length;
  const comprehensiveCount = schools.filter(s => s.schoolType && s.schoolType.includes('Comprehensive')).length;
  const outstandingCount = schools.filter(s => s.ofstedRating && s.ofstedRating.toLowerCase() === 'outstanding').length;

  const localAuthorities = [...new Set(schools.map(s => s.la).filter(Boolean))].sort();

  res.json({
    total,
    grammarCount,
    independentCount,
    comprehensiveCount,
    outstandingCount,
    localAuthorities
  });
});

// GET /api/schools/:id - Detailed view
app.get('/api/schools/:id', (req, res) => {
  const school = db.getSchoolById(req.params.id);
  if (!school) {
    return res.status(404).json({ error: 'School not found' });
  }
  res.json(school);
});

// POST /api/schools - Add single school
app.post('/api/schools', (req, res) => {
  const body = req.body;

  if (!body.name || !body.la || !body.schoolType) {
    return res.status(400).json({ error: 'School name, local authority, and type are required' });
  }

  const newId = `sch-${String(Date.now()).slice(-6)}`;
  const newSchool = {
    id: newId,
    name: body.name.trim(),
    urn: body.urn ? String(body.urn).trim() : 'N/A',
    la: body.la.trim(),
    region: body.region ? body.region.trim() : 'Greater London',
    postcode: body.postcode ? body.postcode.trim() : '',
    address: body.address ? body.address.trim() : '',
    schoolType: body.schoolType.trim(),
    gender: body.gender ? body.gender.trim() : 'Mixed',
    ageRange: body.ageRange ? body.ageRange.trim() : '11-18',
    pupilCount: parseInt(body.pupilCount, 10) || 0,
    ofstedRating: body.ofstedRating ? body.ofstedRating.trim() : 'Good',
    gcseProgress8: body.gcseProgress8 !== null && body.gcseProgress8 !== undefined ? parseFloat(body.gcseProgress8) : null,
    gcseAttainment8: body.gcseAttainment8 !== null && body.gcseAttainment8 !== undefined ? parseFloat(body.gcseAttainment8) : null,
    ebaccAveragePointScore: body.ebaccAveragePointScore !== null && body.ebaccAveragePointScore !== undefined ? parseFloat(body.ebaccAveragePointScore) : null,
    entranceExamType: body.entranceExamType ? body.entranceExamType.trim() : 'None / Standard',
    entranceExamDates: body.entranceExamDates || { registrationOpen: 'TBC', registrationDeadline: 'TBC', examDate: 'TBC', resultsDate: 'TBC' },
    gcseSubjects: Array.isArray(body.gcseSubjects) ? body.gcseSubjects : (body.gcseSubjects ? body.gcseSubjects.split(',').map(s => s.trim()) : []),
    admissionsPolicy: body.admissionsPolicy ? body.admissionsPolicy.trim() : 'Standard admissions policy.',
    website: body.website ? body.website.trim() : '',
    phone: body.phone ? body.phone.trim() : '',
    email: body.email ? body.email.trim() : '',
    description: body.description ? body.description.trim() : ''
  };

  try {
    const created = db.insertSchool(newSchool);
    res.status(201).json({ message: 'School created successfully', school: created });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write to database' });
  }
});

// PUT /api/schools/:id - Update existing school record (supports partial updates for pills/flags like hot, official, etc.)
app.put('/api/schools/:id', (req, res) => {
  const existing = db.getSchoolById(req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'School record not found' });
  }

  try {
    const updated = db.updateSchool(req.params.id, req.body);
    res.json({ message: 'School updated successfully', school: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write to database' });
  }
});


// POST /api/admin/bulk-verify - Verify & De-duplicate raw bulk data before importing
app.post('/api/admin/bulk-verify', (req, res) => {
  const existingSchools = readData();
  const rawItems = req.body.schools;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return res.status(400).json({ error: 'Valid array of school objects is required' });
  }

  const existingMapByName = new Map();
  const existingMapByUrn = new Map();

  existingSchools.forEach(s => {
    if (s.name) existingMapByName.set(s.name.toLowerCase().trim(), s);
    if (s.urn && s.urn !== 'N/A') existingMapByUrn.set(String(s.urn).trim(), s);
  });

  const verified = [];
  const duplicates = [];
  const invalid = [];

  const seenInBatchNames = new Set();
  const seenInBatchUrns = new Set();

  rawItems.forEach((item, idx) => {
    const rowNum = idx + 1;

    if (!item.name || !item.la) {
      invalid.push({ rowNum, item, reason: 'Missing school name or local authority' });
      return;
    }

    const cleanName = item.name.trim();
    const cleanNameLower = cleanName.toLowerCase();
    const cleanUrn = item.urn ? String(item.urn).trim() : null;

    // Check duplicate in database or batch
    const dupByDbName = existingMapByName.get(cleanNameLower);
    const dupByDbUrn = cleanUrn && cleanUrn !== 'N/A' ? existingMapByUrn.get(cleanUrn) : null;
    const dupInBatch = seenInBatchNames.has(cleanNameLower) || (cleanUrn && cleanUrn !== 'N/A' && seenInBatchUrns.has(cleanUrn));

    if (dupByDbName || dupByDbUrn || dupInBatch) {
      const existingRecord = dupByDbName || dupByDbUrn || null;
      duplicates.push({
        rowNum,
        name: cleanName,
        urn: cleanUrn || 'N/A',
        incomingRecord: item,
        existingRecord: existingRecord,
        reason: dupInBatch ? 'Duplicate entry within bulk batch' : `Matches existing record in database (${existingRecord ? existingRecord.id : 'Batch Dup'})`
      });
      return;
    }

    seenInBatchNames.add(cleanNameLower);
    if (cleanUrn && cleanUrn !== 'N/A') seenInBatchUrns.add(cleanUrn);

    // Format clean record
    const cleanedRecord = {
      id: `sch-${String(Date.now() + idx).slice(-6)}`,
      name: cleanName,
      urn: cleanUrn || 'N/A',
      la: item.la.trim(),
      region: item.region ? item.region.trim() : 'Greater London',
      postcode: item.postcode ? item.postcode.trim() : '',
      address: item.address ? item.address.trim() : '',
      schoolType: item.schoolType ? item.schoolType.trim() : 'Comprehensive (Academy)',
      gender: item.gender ? item.gender.trim() : 'Mixed',
      ageRange: item.ageRange ? item.ageRange.trim() : '11-18',
      pupilCount: parseInt(item.pupilCount, 10) || 0,
      ofstedRating: item.ofstedRating ? item.ofstedRating.trim() : 'Good',
      gcseProgress8: item.gcseProgress8 !== undefined && item.gcseProgress8 !== null ? parseFloat(item.gcseProgress8) : null,
      gcseAttainment8: item.gcseAttainment8 !== undefined && item.gcseAttainment8 !== null ? parseFloat(item.gcseAttainment8) : null,
      ebaccAveragePointScore: item.ebaccAveragePointScore !== undefined && item.ebaccAveragePointScore !== null ? parseFloat(item.ebaccAveragePointScore) : null,
      entranceExamType: item.entranceExamType ? item.entranceExamType.trim() : 'None / Standard',
      entranceExamDates: item.entranceExamDates || { registrationOpen: 'TBC', registrationDeadline: 'TBC', examDate: 'TBC', resultsDate: 'TBC' },
      gcseSubjects: Array.isArray(item.gcseSubjects) ? item.gcseSubjects : (item.gcseSubjects ? String(item.gcseSubjects).split(',').map(s => s.trim()) : []),
      admissionsPolicy: item.admissionsPolicy ? item.admissionsPolicy.trim() : 'Standard admissions policy.',
      website: item.website ? item.website.trim() : '',
      phone: item.phone ? item.phone.trim() : '',
      email: item.email ? item.email.trim() : '',
      description: item.description ? item.description.trim() : ''
    };

    verified.push(cleanedRecord);
  });

  res.json({
    summary: {
      totalReceived: rawItems.length,
      validToImportCount: verified.length,
      duplicateCount: duplicates.length,
      invalidCount: invalid.length
    },
    verified,
    duplicates,
    invalid
  });
});

// POST /api/admin/merge-records - Merge an incoming duplicate into an existing database record
app.post('/api/admin/merge-records', (req, res) => {
  const { existingId, mergedRecord } = req.body;

  if (!existingId || !mergedRecord) {
    return res.status(400).json({ error: 'existingId and mergedRecord are required' });
  }

  let schools = readData();
  const index = schools.findIndex(s => s.id === existingId);

  if (index === -1) {
    return res.status(404).json({ error: 'Existing database school record not found' });
  }

  // Update existing record with merged data keeping original ID
  const updatedSchool = {
    ...schools[index],
    ...mergedRecord,
    id: existingId
  };

  schools[index] = updatedSchool;

  if (writeData(schools)) {
    res.json({ message: 'Record merged and updated successfully!', school: updatedSchool });
  } else {
    res.status(500).json({ error: 'Failed to write merged record to database' });
  }
});



// Helper to read reviewed pairs
function readReviewedPairs() {
  try {
    return db.getAllReviewedPairs();
  } catch (err) {
    console.error('Error reading reviewed pairs from SQLite:', err);
    return [];
  }
}

// Helper to write reviewed pairs
function writeReviewedPairs(data) {
  try {
    db.insertReviewedPairsBulk(data);
    return true;
  } catch (err) {
    console.error('Error writing reviewed pairs to SQLite:', err);
    return false;
  }
}

// Helper to construct normalized key for a pair of IDs
function getPairKey(id1, id2) {
  return [String(id1), String(id2)].sort().join('___');
}

// GET /api/admin/scan-duplicates - Scan entire database for fuzzy-duplicate pairs
app.get('/api/admin/scan-duplicates', (req, res) => {
  const schools = readData();
  const reviewedList = readReviewedPairs();
  const reviewedSet = new Set(reviewedList.map(item => item.pairKey));

  // Helper: normalise a name for comparison
  const norm = str => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

  // Simple character-level Jaccard similarity on word-level bigrams
  function similarity(a, b) {
    const na = norm(a);
    const nb = norm(b);
    if (na === nb) return 1;
    if (na.length < 3 || nb.length < 3) return 0;

    const bigrams = s => {
      const set = new Set();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };

    const setA = bigrams(na);
    const setB = bigrams(nb);
    let intersection = 0;
    setA.forEach(bg => { if (setB.has(bg)) intersection++; });
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  const pairs = [];
  const SIMILARITY_THRESHOLD = 0.72;

  for (let i = 0; i < schools.length; i++) {
    for (let j = i + 1; j < schools.length; j++) {
      const a = schools[i];
      const b = schools[j];

      // Exclude if already marked reviewed
      const key = getPairKey(a.id, b.id);
      if (reviewedSet.has(key)) {
        continue;
      }

      // Gender conflict check: if one is strictly Boys-only and the other is strictly Girls-only, they cannot be duplicates
      const gA = String(a.gender || '').trim().toLowerCase();
      const gB = String(b.gender || '').trim().toLowerCase();
      const isBoysA = gA === 'boys' || gA.startsWith('boys ');
      const isGirlsA = gA === 'girls' || gA.startsWith('girls ');
      const isBoysB = gB === 'boys' || gB.startsWith('boys ');
      const isGirlsB = gB === 'girls' || gB.startsWith('girls ');

      if ((isBoysA && isGirlsB) || (isGirlsA && isBoysB)) {
        continue;
      }

      // URN match is always a confirmed duplicate
      const urnMatch = a.urn && b.urn && a.urn !== 'N/A' && b.urn !== 'N/A' && String(a.urn).trim() === String(b.urn).trim();
      const nameSim = similarity(a.name, b.name);

      if (urnMatch || nameSim >= SIMILARITY_THRESHOLD) {
        pairs.push({
          similarity: urnMatch ? 1 : parseFloat(nameSim.toFixed(3)),
          matchType: urnMatch ? 'URN Match' : nameSim === 1 ? 'Exact Name' : 'Fuzzy Name',
          recordA: a,
          recordB: b,
          pairKey: key
        });
      }
    }
  }

  // Sort by similarity descending
  pairs.sort((a, b) => b.similarity - a.similarity);

  res.json({
    totalScanned: schools.length,
    pairsFound: pairs.length,
    pairs
  });
});

// POST /api/admin/mark-reviewed - Mark a duplicate pair as reviewed (not a duplicate)
app.post('/api/admin/mark-reviewed', (req, res) => {
  const { idA, idB } = req.body;

  if (!idA || !idB) {
    return res.status(400).json({ error: 'idA and idB are required' });
  }

  const pairKey = getPairKey(idA, idB);
  const reviewed = readReviewedPairs();

  if (!reviewed.some(r => r.pairKey === pairKey)) {
    reviewed.push({
      pairKey,
      idA,
      idB,
      reviewedAt: new Date().toISOString()
    });
    if (!writeReviewedPairs(reviewed)) {
      return res.status(500).json({ error: 'Failed to save reviewed pair status' });
    }
  }

  res.json({ message: 'Duplicate pair marked as reviewed successfully', pairKey });
});

// DELETE /api/admin/schools/:id - Delete a school record (used when merging to eliminate the duplicate)
app.delete('/api/admin/schools/:id', (req, res) => {
  let schools = readData();
  const { id } = req.params;
  const before = schools.length;
  schools = schools.filter(s => s.id !== id);

  if (schools.length === before) {
    return res.status(404).json({ error: 'Record not found' });
  }

  if (writeData(schools)) {
    res.json({ message: `School record ${id} deleted successfully.` });
  } else {
    res.status(500).json({ error: 'Failed to write changes to database' });
  }
});

// POST /api/admin/bulk-commit - Commit verified clean schools to database

app.post('/api/admin/bulk-commit', (req, res) => {
  const verifiedSchools = req.body.verifiedSchools;

  if (!Array.isArray(verifiedSchools) || verifiedSchools.length === 0) {
    return res.status(400).json({ error: 'No verified schools provided to commit' });
  }

  const schools = readData();
  schools.unshift(...verifiedSchools);

  if (writeData(schools)) {
    res.status(201).json({
      message: `Successfully imported ${verifiedSchools.length} verified school records into database!`,
      importedCount: verifiedSchools.length,
      newTotal: schools.length
    });
  } else {
    res.status(500).json({ error: 'Failed to write updated dataset to file' });
  }
});

// PUT /api/schools/:id - Update school details
app.put('/api/schools/:id', (req, res) => {
  let schools = readData();
  const index = schools.findIndex(s => s.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'School not found' });
  }

  const updatedSchool = { ...schools[index], ...req.body, id: req.params.id };
  schools[index] = updatedSchool;

  if (writeData(schools)) {
    res.json({ message: 'School updated successfully', school: updatedSchool });
  } else {
    res.status(500).json({ error: 'Failed to update database' });
  }
});

// DELETE /api/schools/:id - Delete school entry
app.delete('/api/schools/:id', (req, res) => {
  let schools = readData();
  const index = schools.findIndex(s => s.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'School not found' });
  }

  schools.splice(index, 1);
  if (writeData(schools)) {
    res.json({ message: 'School deleted successfully' });
  } else {
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

// GET /api/admin/export - Export dataset in JSON, CSV, TSV, or XML format
app.get('/api/admin/export', (req, res) => {
  const schools = readData();
  const format = (req.query.format || 'json').toLowerCase();

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="london_schools_database.json"');
    return res.send(JSON.stringify(schools, null, 2));
  }

  if (format === 'csv' || format === 'tsv') {
    const delimiter = format === 'csv' ? ',' : '\t';
    const filename = `london_schools_database.${format}`;
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'text/tab-separated-values');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const headers = [
      'ID', 'URN', 'School Name', 'Local Authority', 'Region', 'Postcode', 'Address',
      'School Type', 'Gender Intake', 'Age Range', 'Pupil Count', 'Ofsted Rating',
      'Progress 8', 'Attainment 8', 'EBacc Score', 'Entrance Exam Type',
      'Exam Registration Open', 'Exam Registration Deadline', 'Exam Date', 'Results Release Date',
      'GCSE Subjects Offered', 'Admissions Policy', 'Website', 'Phone', 'Email'
    ];

    const escapeCell = (val) => {
      if (val === null || val === undefined) return '';
      let str = Array.isArray(val) ? val.join('; ') : String(val);
      if (format === 'csv') {
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          str = '"' + str.replace(/"/g, '""') + '"';
        }
      } else {
        str = str.replace(/\t/g, ' ').replace(/\n/g, ' ');
      }
      return str;
    };

    const rows = [headers.join(delimiter)];

    schools.forEach(s => {
      const dates = s.entranceExamDates || {};
      const row = [
        escapeCell(s.id),
        escapeCell(s.urn),
        escapeCell(s.name),
        escapeCell(s.la),
        escapeCell(s.region),
        escapeCell(s.postcode),
        escapeCell(s.address),
        escapeCell(s.schoolType),
        escapeCell(s.gender),
        escapeCell(s.ageRange),
        escapeCell(s.pupilCount),
        escapeCell(s.ofstedRating),
        escapeCell(s.gcseProgress8),
        escapeCell(s.gcseAttainment8),
        escapeCell(s.ebaccAveragePointScore),
        escapeCell(s.entranceExamType),
        escapeCell(dates.registrationOpen),
        escapeCell(dates.registrationDeadline),
        escapeCell(dates.examDate),
        escapeCell(dates.resultsDate),
        escapeCell(s.gcseSubjects),
        escapeCell(s.admissionsPolicy),
        escapeCell(s.website),
        escapeCell(s.phone),
        escapeCell(s.email)
      ];
      rows.push(row.join(delimiter));
    });

    return res.send(rows.join('\n'));
  }

  if (format === 'xml') {
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="london_schools_database.xml"');

    const escapeXml = (unsafe) => {
      if (unsafe === null || unsafe === undefined) return '';
      const str = Array.isArray(unsafe) ? unsafe.join(', ') : String(unsafe);
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<schools>\n';
    schools.forEach(s => {
      const dates = s.entranceExamDates || {};
      xml += '  <school>\n';
      xml += `    <id>${escapeXml(s.id)}</id>\n`;
      xml += `    <urn>${escapeXml(s.urn)}</urn>\n`;
      xml += `    <name>${escapeXml(s.name)}</name>\n`;
      xml += `    <localAuthority>${escapeXml(s.la)}</localAuthority>\n`;
      xml += `    <region>${escapeXml(s.region)}</region>\n`;
      xml += `    <postcode>${escapeXml(s.postcode)}</postcode>\n`;
      xml += `    <schoolType>${escapeXml(s.schoolType)}</schoolType>\n`;
      xml += `    <gender>${escapeXml(s.gender)}</gender>\n`;
      xml += `    <pupilCount>${escapeXml(s.pupilCount)}</pupilCount>\n`;
      xml += `    <ofstedRating>${escapeXml(s.ofstedRating)}</ofstedRating>\n`;
      xml += `    <gcseAttainment8>${escapeXml(s.gcseAttainment8)}</gcseAttainment8>\n`;
      xml += `    <entranceExamType>${escapeXml(s.entranceExamType)}</entranceExamType>\n`;
      xml += `    <entranceExamDates>\n`;
      xml += `      <registrationOpen>${escapeXml(dates.registrationOpen)}</registrationOpen>\n`;
      xml += `      <registrationDeadline>${escapeXml(dates.registrationDeadline)}</registrationDeadline>\n`;
      xml += `      <examDate>${escapeXml(dates.examDate)}</examDate>\n`;
      xml += `      <resultsDate>${escapeXml(dates.resultsDate)}</resultsDate>\n`;
      xml += `    </entranceExamDates>\n`;
      xml += `    <website>${escapeXml(s.website)}</website>\n`;
      xml += '  </school>\n';
    });
    xml += '</schools>';
    return res.send(xml);
  }

  res.status(400).json({ error: 'Unsupported format requested. Supported formats: json, csv, tsv, xml' });
});

// Settings database helpers
function readRecSettings() {
  try {
    return db.getRecSettings();
  } catch (err) {
    return { weights: { location: 35, examType: 25, academicPerformance: 20, ofstedRating: 10, schoolType: 10 } };
  }
}

function writeRecSettings(settings) {
  try {
    db.saveRecSettings(settings.weights || settings);
    return true;
  } catch (err) {
    return false;
  }
}

// GET /api/recommendation-settings - Get current recommendation weights
app.get('/api/recommendation-settings', (req, res) => {
  res.json(readRecSettings());
});

// POST /api/recommendation-settings - Save recommendation weights (Admin only)
app.post('/api/recommendation-settings', (req, res) => {
  const { weights } = req.body;
  if (!weights) return res.status(400).json({ error: 'Weights configuration required' });

  if (writeRecSettings({ weights })) {
    res.json({ message: 'Recommendation settings updated successfully', settings: { weights } });
  } else {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Helper to parse cookies from incoming HTTP request
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length > 0) {
        const key = parts.shift().trim();
        list[key] = decodeURIComponent(parts.join('='));
      }
    });
  }
  return list;
}

function setSessionCookie(res, sessionId) {
  // Set 30-day session cookie (2,592,000 seconds = 30 days) compatible with HTTP localhost
  res.setHeader('Set-Cookie', `school_db_session_id=${sessionId}; Path=/; Max-Age=2592000; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `school_db_session_id=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`);
}

// Session Store & Permissions Configuration (30-day Persistent Sessions)
const DEFAULT_PERMISSIONS = ['parent:recommendations', 'parent:portfolio'];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const activeSessions = new Map();

function createSession(user) {
  const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const permissions = Array.isArray(user.permissions) && user.permissions.length > 0
    ? user.permissions
    : DEFAULT_PERMISSIONS;

  const sessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    permissions
  };

  // Persist session in SQLite (30 days) and in-memory Map
  db.saveSession(sessionId, sessionUser, THIRTY_DAYS_MS);
  activeSessions.set(sessionId, { user: sessionUser, createdAt: new Date() });
  return { sessionId, user: sessionUser };
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const sessionId = req.headers['x-session-id'] ||
                    req.headers['authorization']?.replace('Bearer ', '') ||
                    req.query.sessionId ||
                    cookies['school_db_session_id'];
  if (!sessionId) return null;

  // 1. Check in-memory store
  const cachedSess = activeSessions.get(sessionId);
  if (cachedSess) return cachedSess.user;

  // 2. Fallback to SQLite sessions table (restores session across page refresh & server restarts)
  const dbSess = db.getSession(sessionId);
  if (dbSess && dbSess.user) {
    activeSessions.set(sessionId, { user: dbSess.user, createdAt: new Date(dbSess.createdAt) });
    return dbSess.user;
  }

  return null;
}

// Middleware to enforce authentication
function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthenticated session. Please log in.', authenticated: false });
  }
  req.user = user;
  next();
}

// Middleware to enforce granular session capabilities/permissions
function requirePermission(permissionName) {
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthenticated session. Please log in.', authenticated: false });
    }
    if (!Array.isArray(user.permissions) || !user.permissions.includes(permissionName)) {
      return res.status(403).json({
        error: `Forbidden: Session lacks required permission '${permissionName}'`,
        requiredPermission: permissionName
      });
    }
    req.user = user;
    next();
  };
}

// GET /api/auth/me - Check current active session
app.get('/api/auth/me', (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = req.headers['x-session-id'] ||
                    req.headers['authorization']?.replace('Bearer ', '') ||
                    req.query.sessionId ||
                    cookies['school_db_session_id'];

  if (!sessionId) {
    return res.status(401).json({ authenticated: false, error: 'No active session token provided' });
  }

  const user = getSessionUser(req);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ authenticated: false, error: 'Session expired or invalidated' });
  }

  setSessionCookie(res, sessionId);
  res.json({ authenticated: true, sessionId, user });
});

// POST /api/auth/google - Authenticate via Google OAuth / SSO
app.post('/api/auth/google', (req, res) => {
  const { email, name, googleId, picture } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Google authentication requires a valid email' });
  }

  const cleanEmail = email.toLowerCase().trim();
  let user = db.getUserByEmail(cleanEmail);

  if (!user) {
    const newUser = {
      id: `usr-google-${Date.now()}`,
      name: name || email.split('@')[0],
      email: cleanEmail,
      password: `sso-google-${Math.random().toString(36).slice(2)}`,
      permissions: DEFAULT_PERMISSIONS, // Default to standard parent permissions
      createdAt: new Date().toISOString()
    };
    user = db.insertUser(newUser);
  }

  const session = createSession(user);
  setSessionCookie(res, session.sessionId);
  res.json({
    message: 'Google authentication successful',
    sessionId: session.sessionId,
    user: session.user
  });
});

// GET /api/auth/google - Initiate Google OAuth 2.0 Redirect
app.get('/api/auth/google', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    return res.redirect('/?sso=google_demo');
  }
  const redirectUri = encodeURIComponent(`${req.protocol}://${req.get('host')}/api/auth/google/callback`);
  const scope = encodeURIComponent('openid email profile');
  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${googleClientId}&redirect_uri=${redirectUri}&scope=${scope}`;
  res.redirect(googleUrl);
});

// GET /api/auth/google/callback - Google OAuth 2.0 Callback
app.get('/api/auth/google/callback', (req, res) => {
  const email = req.query.email || 'google.user@gmail.com';
  const name = req.query.name || 'Google Parent User';
  
  let user = db.getUserByEmail(email);
  if (!user) {
    user = db.insertUser({
      id: `usr-google-${Date.now()}`,
      name,
      email,
      password: `sso-google-${Math.random().toString(36).slice(2)}`,
      permissions: DEFAULT_PERMISSIONS,
      createdAt: new Date().toISOString()
    });
  }

  const session = createSession(user);
  setSessionCookie(res, session.sessionId);
  res.redirect(`/?sessionId=${session.sessionId}&auth=success`);
});

// POST /api/auth/signup - Register new account
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const existing = db.getUserByEmail(email);

  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    name,
    email: email.toLowerCase(),
    password,
    permissions: DEFAULT_PERMISSIONS,
    createdAt: new Date().toISOString()
  };

  const created = db.insertUser(newUser);
  const session = createSession(created);
  setSessionCookie(res, session.sessionId);

  res.json({
    message: 'Registration successful',
    sessionId: session.sessionId,
    user: session.user
  });
});

// POST /api/auth/login - Authenticate user
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.getUserByEmail(email);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const session = createSession(user);
  setSessionCookie(res, session.sessionId);

  res.json({
    message: 'Login successful',
    sessionId: session.sessionId,
    user: session.user
  });
});

// POST /api/auth/logout - End session
app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = req.headers['x-session-id'] ||
                    req.headers['authorization']?.replace('Bearer ', '') ||
                    req.query.sessionId ||
                    req.body?.sessionId ||
                    cookies['school_db_session_id'];

  if (sessionId) {
    activeSessions.delete(sessionId);
    db.deleteSession(sessionId);
  }
  clearSessionCookie(res);
  res.json({ success: true, message: 'Signed out successfully' });
});

// GET /api/users - Get list of accounts (For demo)
app.get('/api/users', (req, res) => {
  const users = db.getAllUsers().map(u => ({ id: u.id, name: u.name, email: u.email, permissions: u.permissions }));
  res.json(users);
});

// User Portfolios Database Helpers

function readPortfolios() {
  try {
    return db.getAllPortfolios();
  } catch (err) {
    return {};
  }
}

function writePortfolios(data) {
  try {
    db.insertPortfoliosBulk(data);
    return true;
  } catch (err) {
    return false;
  }
}

// GET /api/user-portfolio/:userId - Load saved portfolio for user
app.get('/api/user-portfolio/:userId', (req, res) => {
  const { userId } = req.params;
  const portfolio = db.getPortfolioByUserId(userId);
  res.json(portfolio);
});

// POST /api/user-portfolio/:userId - Save portfolio for user
app.post('/api/user-portfolio/:userId', (req, res) => {
  const { userId } = req.params;
  const { targetLocation, selectedSchools, removedSchoolIds } = req.body;

  const saved = db.savePortfolio(userId, {
    targetLocation: targetLocation || '',
    selectedSchools: selectedSchools || [],
    removedSchoolIds: removedSchoolIds || []
  });

  res.json({ message: 'User portfolio saved successfully', portfolio: saved });
});

// Helper to calculate postcode and spatial proximity score (0.0 to 1.0)
function calculateLocationProximityScore(candidate, targetQuery, userSchools) {
  const normQuery = (targetQuery || '').trim().toUpperCase();
  const cPostcode = (candidate.postcode || '').trim().toUpperCase();
  const cLA = (candidate.la || '').trim().toLowerCase();
  const cAddress = (candidate.address || '').trim().toLowerCase();
  const cEasting = candidate._csv && candidate._csv.easting ? parseFloat(candidate._csv.easting) : null;
  const cNorthing = candidate._csv && candidate._csv.northing ? parseFloat(candidate._csv.northing) : null;

  let bestScore = 0;
  let matchReason = '';

  // 1. Evaluate target location query if provided
  if (normQuery) {
    const targetOutcode = normQuery.split(' ')[0];
    const cOutcode = cPostcode.split(' ')[0];
    const targetAreaCode = normQuery.replace(/[0-9\s]/g, '');
    const cAreaCode = cPostcode.replace(/[0-9\s]/g, '');

    if (cPostcode && cPostcode === normQuery) {
      bestScore = 1.0;
      matchReason = `Exact postcode match (${candidate.postcode})`;
    } else if (targetOutcode && cOutcode && cOutcode === targetOutcode) {
      bestScore = 0.95;
      matchReason = `Same postcode sector (${cOutcode})`;
    } else if (targetAreaCode && cAreaCode && cAreaCode === targetAreaCode && targetAreaCode.length >= 1) {
      bestScore = 0.75;
      matchReason = `Nearby postcode area (${cAreaCode})`;
    } else if (cLA && cLA.includes(normQuery.toLowerCase())) {
      bestScore = 0.85;
      matchReason = `Borough / LA match (${candidate.la})`;
    } else if (cAddress && cAddress.includes(normQuery.toLowerCase())) {
      bestScore = 0.65;
      matchReason = `Address vicinity match (${candidate.la})`;
    }
  }

  // 2. Evaluate spatial (Easting / Northing) distance against user's saved schools
  if (userSchools && userSchools.length > 0) {
    userSchools.forEach(uSch => {
      const uLA = (uSch.la || '').trim().toLowerCase();
      if (cLA && uLA && cLA === uLA) {
        if (bestScore < 0.8) {
          bestScore = Math.max(bestScore, 0.8);
          matchReason = `Same borough (${candidate.la}) as saved school`;
        }
      }

      const uPcode = (uSch.postcode || '').trim().toUpperCase();
      const uOutcode = uPcode.split(' ')[0];
      const cOutcode = cPostcode.split(' ')[0];
      if (cOutcode && uOutcode && cOutcode === uOutcode) {
        if (bestScore < 0.9) {
          bestScore = Math.max(bestScore, 0.9);
          matchReason = `Same postcode sector (${cOutcode}) as saved school`;
        }
      }

      const uEasting = uSch._csv && uSch._csv.easting ? parseFloat(uSch._csv.easting) : null;
      const uNorthing = uSch._csv && uSch._csv.northing ? parseFloat(uSch._csv.northing) : null;

      if (cEasting && cNorthing && uEasting && uNorthing) {
        const dx = cEasting - uEasting;
        const dy = cNorthing - uNorthing;
        const distanceKm = Math.sqrt(dx * dx + dy * dy) / 1000.0; // Distance in kilometers

        let distScore = 0;
        if (distanceKm <= 3.0) distScore = 1.0;
        else if (distanceKm <= 7.0) distScore = 0.85;
        else if (distanceKm <= 15.0) distScore = 0.65;
        else if (distanceKm <= 25.0) distScore = 0.40;

        if (distScore > bestScore) {
          bestScore = distScore;
          matchReason = `~${distanceKm.toFixed(1)} km from ${uSch.name}`;
        }
      }
    });
  }

  return { score: bestScore, reason: matchReason };
}

// POST /api/recommendations - Smart School Recommendation Engine

app.post('/api/recommendations', (req, res) => {
  const { userSchools = [], targetLocation = '', removedSchoolIds = [], genderChoice = 'all', includeCoed = true } = req.body;
  const allSchools = readData();
  const settings = readRecSettings();
  const weights = settings.weights || { location: 50, examType: 35, schoolType: 15 };

  const removedSet = new Set(removedSchoolIds);
  const userSchoolSet = new Set(userSchools.map(s => s.id));

  // Candidate pool (exclude already saved or explicitly removed schools)
  let candidates = allSchools.filter(s => !userSchoolSet.has(s.id) && !removedSet.has(s.id));

  // ABSOLUTE GENDER FILTER ENFORCEMENT
  if (genderChoice === 'boys') {
    candidates = candidates.filter(s => {
      const g = (s.gender || '').toLowerCase();
      const isBoys = g.includes('boy');
      const isCoed = g.includes('mixed') || g.includes('co-ed');
      return isBoys || (includeCoed && isCoed);
    });
  } else if (genderChoice === 'girls') {
    candidates = candidates.filter(s => {
      const g = (s.gender || '').toLowerCase();
      const isGirls = g.includes('girl');
      const isCoed = g.includes('mixed') || g.includes('co-ed');
      return isGirls || (includeCoed && isCoed);
    });
  }

  // Extract preferences & benchmarks from user's current list of saved schools
  const userExamTypes = new Set(userSchools.map(s => (s.entranceExamType || '').toLowerCase()).filter(Boolean));
  const userSchoolTypes = new Set(userSchools.map(s => (s.schoolType || '').toLowerCase()).filter(Boolean));

  // Compute benchmark academic metrics from user's saved portfolio
  const userAttainment8List = userSchools.map(s => s.gcseAttainment8).filter(v => typeof v === 'number' && !isNaN(v));
  const avgUserAttainment8 = userAttainment8List.length > 0 ? (userAttainment8List.reduce((a, b) => a + b, 0) / userAttainment8List.length) : 65.0;

  const userProgress8List = userSchools.map(s => s.gcseProgress8).filter(v => typeof v === 'number' && !isNaN(v));
  const avgUserProgress8 = userProgress8List.length > 0 ? (userProgress8List.reduce((a, b) => a + b, 0) / userProgress8List.length) : 0.5;

  // Score each candidate school
  const scored = candidates.map(candidate => {
    let examScore = 0;
    let typeScore = 0;
    let academicScore = 0;
    let ofstedScore = 0;

    const cExam = (candidate.entranceExamType || '').toLowerCase();
    const cType = (candidate.schoolType || '').toLowerCase();
    const cOfsted = (candidate.ofstedRating || '').toLowerCase();

    // 1. Location / Proximity score via multi-tier postcode & spatial distance
    const locResult = calculateLocationProximityScore(candidate, targetLocation, userSchools);
    const locScore = locResult.score;

    // 2. Exam Type score
    if (userExamTypes.has(cExam)) {
      examScore = 1.0;
    } else {
      userExamTypes.forEach(uExam => {
        if (cExam && uExam && (cExam.includes(uExam) || uExam.includes(cExam))) examScore = Math.max(examScore, 0.7);
      });
    }

    // 3. School Type score
    if (userSchoolTypes.has(cType)) {
      typeScore = 1.0;
    } else {
      userSchoolTypes.forEach(uType => {
        if (cType && uType && (cType.includes(uType) || uType.includes(cType))) typeScore = Math.max(typeScore, 0.6);
      });
    }

    // 4. Academic Performance score (GCSE Attainment 8 & Progress 8 vs benchmark)
    const cAttainment = typeof candidate.gcseAttainment8 === 'number' ? candidate.gcseAttainment8 : null;
    const cProgress = typeof candidate.gcseProgress8 === 'number' ? candidate.gcseProgress8 : null;

    if (cAttainment !== null) {
      if (cAttainment >= avgUserAttainment8 + 5) academicScore = 1.0;
      else if (cAttainment >= avgUserAttainment8 - 5) academicScore = 0.85;
      else if (cAttainment >= 50) academicScore = 0.65;
      else academicScore = 0.40;
    } else if (cProgress !== null) {
      if (cProgress >= 0.7) academicScore = 0.95;
      else if (cProgress >= 0.3) academicScore = 0.75;
      else academicScore = 0.50;
    } else {
      academicScore = 0.50; // default baseline for unrated
    }

    // 5. Ofsted Rating score
    if (cOfsted.includes('outstanding') || cOfsted.includes('excellent')) {
      ofstedScore = 1.0;
    } else if (cOfsted.includes('good')) {
      ofstedScore = 0.80;
    } else if (cOfsted.includes('requires improvement')) {
      ofstedScore = 0.40;
    } else {
      ofstedScore = 0.50;
    }

    // Weighted composite score (0 - 100)
    const wLoc = weights.location ?? 35;
    const wExam = weights.examType ?? 25;
    const wAcad = weights.academicPerformance ?? 20;
    const wOfsted = weights.ofstedRating ?? 10;
    const wType = weights.schoolType ?? 10;

    const totalWeight = wLoc + wExam + wAcad + wOfsted + wType;
    const score = (
      (locScore * wLoc) +
      (examScore * wExam) +
      (academicScore * wAcad) +
      (ofstedScore * wOfsted) +
      (typeScore * wType)
    ) / (totalWeight || 1) * 100;

    // Nuanced recommendation rationale strings
    const reasons = [];
    if (locScore > 0 && locResult.reason) reasons.push(locResult.reason);
    if (examScore > 0) reasons.push(`Matching exam format (${candidate.entranceExamType})`);
    if (academicScore >= 0.85 && cAttainment !== null) reasons.push(`High Academic Attainment 8 (${cAttainment})`);
    if (ofstedScore >= 0.80 && candidate.ofstedRating) reasons.push(`Ofsted ${candidate.ofstedRating}`);
    if (typeScore > 0) reasons.push(`Matching school type (${candidate.schoolType})`);

    return {
      school: candidate,
      matchScore: Math.round(score),
      reasons: reasons.length > 0 ? reasons : ['General high school recommendation']
    };
  });

  // Sort by match score descending
  scored.sort((a, b) => b.matchScore - a.matchScore);

  res.json({
    totalCandidates: candidates.length,
    recommendations: scored.slice(0, 30) // top 30 recommendations
  });
});

app.listen(PORT, () => {
  console.log(`London High Schools DB Server running at http://localhost:${PORT}`);
});


