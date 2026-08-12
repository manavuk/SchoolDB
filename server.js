const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'schools.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Helper to read data
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading schools dataset:', err);
    return [];
  }
}

// Helper to write data
function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error writing schools dataset:', err);
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
  const schools = readData();
  const school = schools.find(s => s.id === req.params.id);
  if (!school) {
    return res.status(404).json({ error: 'School not found' });
  }
  res.json(school);
});

// POST /api/schools - Add single school
app.post('/api/schools', (req, res) => {
  const schools = readData();
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

  schools.unshift(newSchool);
  if (writeData(schools)) {
    res.status(201).json({ message: 'School created successfully', school: newSchool });
  } else {
    res.status(500).json({ error: 'Failed to write to database' });
  }
});

// PUT /api/schools/:id - Update existing school record (supports partial updates for pills/flags like hot, official, etc.)
app.put('/api/schools/:id', (req, res) => {
  const schools = readData();
  const index = schools.findIndex(s => s.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({ error: 'School record not found' });
  }

  const existing = schools[index];
  const body = req.body;

  const updatedSchool = {
    ...existing,
    ...body,
    id: existing.id // preserve ID
  };

  schools[index] = updatedSchool;

  if (writeData(schools)) {
    res.json({ message: 'School updated successfully', school: updatedSchool });
  } else {
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



// GET /api/admin/scan-duplicates - Scan entire database for fuzzy-duplicate pairs
app.get('/api/admin/scan-duplicates', (req, res) => {
  const schools = readData();

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
          recordB: b
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

// Settings file helper
const SETTINGS_FILE = path.join(__dirname, 'data', 'recommendation_settings.json');
function readRecSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { weights: { location: 40, examType: 35, schoolType: 15, gender: 10 } };
    }
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (err) {
    return { weights: { location: 40, examType: 35, schoolType: 15, gender: 10 } };
  }
}

function writeRecSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
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

  const settings = { weights };
  if (writeRecSettings(settings)) {
    res.json({ message: 'Recommendation settings updated successfully', settings });
  } else {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Authentication & User DB Helpers
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

// POST /api/auth/signup - Register new account
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, role } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const users = readUsers();
  const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());

  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    name,
    email: email.toLowerCase(),
    password, // Plain text for local experiment server
    role: role === 'admin' ? 'admin' : 'user',
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeUsers(users);

  res.json({
    message: 'Registration successful',
    user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role }
  });
});

// POST /api/auth/login - Authenticate user
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const users = readUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.json({
    message: 'Login successful',
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

// GET /api/users - Get list of accounts (For quick switcher / demo)
app.get('/api/users', (req, res) => {
  const users = readUsers().map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
  res.json(users);
});

// User Portfolios File Helper

const PORTFOLIOS_FILE = path.join(__dirname, 'data', 'user_portfolios.json');
function readPortfolios() {
  try {
    if (!fs.existsSync(PORTFOLIOS_FILE)) return {};
    return JSON.parse(fs.readFileSync(PORTFOLIOS_FILE, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writePortfolios(data) {
  try {
    fs.writeFileSync(PORTFOLIOS_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    return false;
  }
}

// GET /api/user-portfolio/:userId - Load saved portfolio for user
app.get('/api/user-portfolio/:userId', (req, res) => {
  const { userId } = req.params;
  const portfolios = readPortfolios();
  const portfolio = portfolios[userId] || {
    userId,
    targetLocation: '',
    selectedSchools: [],
    removedSchoolIds: [],
    savedAt: null
  };
  res.json(portfolio);
});

// POST /api/user-portfolio/:userId - Save portfolio for user
app.post('/api/user-portfolio/:userId', (req, res) => {
  const { userId } = req.params;
  const { targetLocation, selectedSchools, removedSchoolIds } = req.body;

  const portfolios = readPortfolios();
  portfolios[userId] = {
    userId,
    targetLocation: targetLocation || '',
    selectedSchools: selectedSchools || [],
    removedSchoolIds: removedSchoolIds || [],
    savedAt: new Date().toISOString()
  };

  if (writePortfolios(portfolios)) {
    res.json({ message: 'User portfolio saved successfully', portfolio: portfolios[userId] });
  } else {
    res.status(500).json({ error: 'Failed to save portfolio' });
  }
});

// POST /api/recommendations - Smart School Recommendation Engine

app.post('/api/recommendations', (req, res) => {
  const { userSchools = [], targetLocation = '', removedSchoolIds = [], genderChoice = 'all', includeCoed = true } = req.body;
  const allSchools = readData();
  const settings = readRecSettings();
  const weights = settings.weights || { location: 40, examType: 35, schoolType: 15, gender: 10 };

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

  // Extract preferences from user's current list of saved schools
  const userLAs = new Set(userSchools.map(s => (s.la || '').toLowerCase()).filter(Boolean));
  if (targetLocation) userLAs.add(targetLocation.toLowerCase().trim());

  const userExamTypes = new Set(userSchools.map(s => (s.entranceExamType || '').toLowerCase()).filter(Boolean));
  const userSchoolTypes = new Set(userSchools.map(s => (s.schoolType || '').toLowerCase()).filter(Boolean));
  const userGenders = new Set(userSchools.map(s => (s.gender || '').toLowerCase()).filter(Boolean));

  // Score each candidate school

  const scored = candidates.map(candidate => {
    let locScore = 0;
    let examScore = 0;
    let typeScore = 0;
    let genderScore = 0;

    const cLA = (candidate.la || '').toLowerCase();
    const cExam = (candidate.entranceExamType || '').toLowerCase();
    const cType = (candidate.schoolType || '').toLowerCase();
    const cGender = (candidate.gender || '').toLowerCase();

    // Location score
    if (userLAs.has(cLA) || (targetLocation && cLA.includes(targetLocation.toLowerCase()))) {
      locScore = 1.0;
    } else if (candidate.address && targetLocation && candidate.address.toLowerCase().includes(targetLocation.toLowerCase())) {
      locScore = 0.8;
    }

    // Exam Type score
    if (userExamTypes.has(cExam)) {
      examScore = 1.0;
    } else {
      userExamTypes.forEach(uExam => {
        if (cExam && uExam && (cExam.includes(uExam) || uExam.includes(cExam))) examScore = Math.max(examScore, 0.7);
      });
    }

    // School Type score
    if (userSchoolTypes.has(cType)) {
      typeScore = 1.0;
    } else {
      userSchoolTypes.forEach(uType => {
        if (cType && uType && (cType.includes(uType) || uType.includes(cType))) typeScore = Math.max(typeScore, 0.6);
      });
    }

    // Gender score
    if (userGenders.has(cGender)) {
      genderScore = 1.0;
    }

    // Weighted composite score (0 - 100)
    const totalWeight = (weights.location || 40) + (weights.examType || 35) + (weights.schoolType || 15) + (weights.gender || 10);
    const score = (
      (locScore * (weights.location || 40)) +
      (examScore * (weights.examType || 35)) +
      (typeScore * (weights.schoolType || 15)) +
      (genderScore * (weights.gender || 10))
    ) / (totalWeight || 1) * 100;

    // Recommendation reason
    const reasons = [];
    if (locScore > 0) reasons.push(`Nearby area / LA (${candidate.la})`);
    if (examScore > 0) reasons.push(`Matching exam format (${candidate.entranceExamType})`);
    if (typeScore > 0) reasons.push(`Matching school type (${candidate.schoolType})`);
    if (genderScore > 0) reasons.push(`Matching intake (${candidate.gender})`);

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


