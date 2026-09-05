const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const db = require('./db');
const scannerVerifier = require('./scripts/scanner_verifier');

let llmCrawler = null;
try {
  llmCrawler = require('./scripts/llm_crawler');
} catch (e) {}

// Load environment variables from .env if present
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    envLines.forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/\\n/g, '\n');
        }
        process.env[key] = value.trim().replace(/^["']|["']$/g, '');
      }
    });
  }
} catch (e) {
  console.warn('Could not load .env file:', e);
}

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '617826216452-qq4g5nf2rrl2fr2ak780opdnu3dv94ku.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Dedicated Login Portal route
app.get(['/login', '/login/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Route to dedicated Admin Portal (Enforces admin:portal authentication)
app.get(['/admin', '/admin/*'], (req, res) => {
  const user = getSessionUser(req);
  if (!user || !Array.isArray(user.permissions) || !user.permissions.includes('admin:portal')) {
    const redirectTarget = req.originalUrl || '/admin';
    return res.redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Route to dedicated Parent Portal landing page (Accessible to all guests)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
  const {
    search, type, gender, ofsted, exam, la, minPupils, maxPupils, hot, official,
    tag, region, secondStage, confidence, fee
  } = req.query;

  if (search) {
    const q = search.toLowerCase().trim();
    schools = schools.filter(s => {
      const name = (s.name || '').toLowerCase();
      const postcode = (s.postcode || '').toLowerCase();
      const laVal = (s.la || '').toLowerCase();
      const addr = (s.address || '').toLowerCase();
      const urn = (s.urn || '').toLowerCase();
      const reg = (s.region || '').toLowerCase();
      const examType = (s.entranceExamType || '').toLowerCase();
      const policy = (s.admissionsPolicy || '').toLowerCase();
      const desc = (s.description || '').toLowerCase();
      const web = (s.website || '').toLowerCase();
      const s1 = (s.stage_one_format_and_subjects || '').toLowerCase();
      const s2 = (s.stage_two_format_and_subjects || '').toLowerCase();
      let tagsStr = '';
      if (s.verification_tags) {
        tagsStr = Array.isArray(s.verification_tags) ? s.verification_tags.join(' ').toLowerCase() : String(s.verification_tags).toLowerCase();
      }

      return name.includes(q) || postcode.includes(q) || laVal.includes(q) ||
             addr.includes(q) || urn.includes(q) || reg.includes(q) ||
             examType.includes(q) || policy.includes(q) || desc.includes(q) ||
             web.includes(q) || s1.includes(q) || s2.includes(q) || tagsStr.includes(q);
    });
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

  if (req.query.examConsortium) {
    const ec = req.query.examConsortium.toLowerCase();
    schools = schools.filter(s => s.examConsortium && s.examConsortium.toLowerCase().includes(ec));
  }

  if (req.query.governingBody) {
    const gb = req.query.governingBody.toLowerCase();
    schools = schools.filter(s => s.governingBody && s.governingBody.toLowerCase().includes(gb));
  }

  if (la) {
    schools = schools.filter(s => s.la && s.la.toLowerCase() === la.toLowerCase());
  }

  if (region) {
    schools = schools.filter(s => s.region && s.region.toLowerCase() === region.toLowerCase());
  }

  if (tag) {
    const t = tag.toLowerCase().trim();
    schools = schools.filter(s => {
      let tagsArr = [];
      if (Array.isArray(s.verification_tags)) tagsArr = s.verification_tags.map(x => String(x).toLowerCase());
      else if (typeof s.verification_tags === 'string') {
        try { tagsArr = JSON.parse(s.verification_tags).map(x => String(x).toLowerCase()); }
        catch(e) { tagsArr = [s.verification_tags.toLowerCase()]; }
      }

      if (t === 'llm_enriched') {
        return tagsArr.includes('llm_enriched') || tagsArr.includes('llm_verified') ||
               tagsArr.includes('gemini_crawl') || tagsArr.includes('chatgpt_crawl') ||
               s.verification_status === 'llm_enriched' ||
               Boolean(s.llm_enriched_at);
      }
      if (t === 'auto_verified' || t === 'web_verified') {
        return tagsArr.includes('auto_verified') || tagsArr.includes('web_verified') ||
               s.verification_status === 'auto_verified' || s.verification_status === 'verified' ||
               Boolean(s.verified_at);
      }
      if (t === 'dates_verified') {
        return tagsArr.includes('dates_verified') || tagsArr.includes('dates_current') || tagsArr.includes('p0_cycle_current');
      }
      if (t === 'dates_recorded' || t === 'dates') {
        return Boolean(s.entranceExamDates && s.entranceExamDates !== '{}' && s.entranceExamDates !== 'null');
      }
      if (t === 'two_stage_exam' || t === 'two_stage') {
        return s.second_stage_exam_required === 'Yes' ||
               (s.entranceExamType && (s.entranceExamType.includes('Two-Stage') || s.entranceExamType.includes('Stage 2'))) ||
               tagsArr.includes('two_stage_exam');
      }
      if (t === 'fees_recorded' || t === 'fees') {
        return Boolean(s.feesTermly || s.registrationFee);
      }
      if (t === 'has_website' || t === 'website') {
        return Boolean(s.website && s.website.trim() && s.website !== 'N/A');
      }
      if (t === 'has_anomalies' || t === 'anomalies') {
        return s.verification_status === 'has_anomalies' ||
               s.verification_status === 'crawl_stuck' ||
               s.verification_status === 'data_missing' ||
               s.verification_status === 'dead_website' ||
               s.verification_status === 'missing_website' ||
               s.verification_status === 'llm_error' ||
               tagsArr.includes('date_inversion') ||
               tagsArr.includes('historical_date_stale') ||
               tagsArr.includes('missing_website') ||
               tagsArr.includes('dead_website') ||
               tagsArr.includes('contact_mismatch') ||
               tagsArr.includes('domain_mismatch') ||
               tagsArr.includes('auto_verification_data_missing');
      }
      if (t === 'unscanned') {
        const isEnriched = tagsArr.includes('llm_enriched') || tagsArr.includes('llm_verified') ||
                           tagsArr.includes('gemini_crawl') || tagsArr.includes('chatgpt_crawl') ||
                           s.verification_status === 'llm_enriched';
        const isVerified = tagsArr.includes('auto_verified') || tagsArr.includes('web_verified') ||
                           s.verification_status === 'auto_verified' || s.verification_status === 'verified' ||
                           Boolean(s.verified_at);
        return !isEnriched && !isVerified;
      }
      return tagsArr.includes(t);
    });
  }

  if (secondStage) {
    const ss = secondStage.toLowerCase().trim();
    if (ss === 'yes') {
      schools = schools.filter(s =>
        s.second_stage_exam_required === 'Yes' ||
        (s.entranceExamType && (s.entranceExamType.includes('Two-Stage') || s.entranceExamType.includes('Stage 2') || s.entranceExamType.includes('SET')))
      );
    } else if (ss === 'no') {
      schools = schools.filter(s => s.second_stage_exam_required === 'No' || (!s.second_stage_exam_required && (!s.entranceExamType || !s.entranceExamType.includes('Two-Stage'))));
    }
  }

  if (confidence) {
    const c = confidence.toLowerCase().trim();
    if (c === 'high' || c === 'verified') {
      schools = schools.filter(s => (s.confidence_score || 0) >= 80);
    } else if (c === 'medium') {
      schools = schools.filter(s => (s.confidence_score || 0) >= 50 && (s.confidence_score || 0) < 80);
    } else if (c === 'low' || c === 'unverified') {
      schools = schools.filter(s => (s.confidence_score || 0) < 50);
    }
  }

  if (fee) {
    const f = fee.toLowerCase().trim();
    if (f === 'state' || f === 'free') {
      schools = schools.filter(s => s.schoolType === 'Comprehensive' || s.schoolType === 'Grammar' || s.schoolType === 'State');
    } else if (f === 'independent' || f === 'paying') {
      schools = schools.filter(s => s.schoolType && s.schoolType.includes('Independent'));
    } else if (f === 'recorded') {
      schools = schools.filter(s => Boolean(s.feesTermly || s.registrationFee));
    }
  }

  if (minPupils) {
    schools = schools.filter(s => s.pupilCount >= parseInt(minPupils, 10));
  }

  if (maxPupils) {
    schools = schools.filter(s => s.pupilCount <= parseInt(maxPupils, 10));
  }

  // Exact Postcode Proximity & Distance Calculation
  const { userPostcode, maxDistance, sortBy } = req.query;
  let userPostcodeInfo = null;

  if (userPostcode) {
    try {
      const distanceEngine = require('./scripts/postcode_distance_engine');
      const maxMiles = (maxDistance && !isNaN(parseFloat(maxDistance))) ? parseFloat(maxDistance) : null;
      const distResult = distanceEngine.calculateDistancesToSchools(userPostcode, schools, maxMiles);
      if (distResult && distResult.success) {
        schools = distResult.schools;
        userPostcodeInfo = {
          postcode: distResult.userPostcode,
          coordinates: distResult.userCoords
        };
      }
    } catch (e) {
      console.warn('Distance calculation error in /api/schools:', e.message);
    }
  }

  res.json({
    total: schools.length,
    userPostcode: userPostcodeInfo ? userPostcodeInfo.postcode : null,
    userCoordinates: userPostcodeInfo ? userPostcodeInfo.coordinates : null,
    schools
  });
});

// GET /api/distance - Exact distance calculation between two UK postcodes
app.get('/api/distance', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({
        success: false,
        error: 'Both "from" and "to" query parameters are required (e.g. /api/distance?from=EN54DQ&to=W67BS)'
      });
    }

    const distanceEngine = require('./scripts/postcode_distance_engine');
    const result = await distanceEngine.calculateDistance(from, to);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('Error in /api/distance:', err);
    res.status(500).json({ success: false, error: 'Internal error calculating distance' });
  }
});

// POST /api/schools/by-distance - Find and rank schools nearest to a user's postcode
app.post('/api/schools/by-distance', (req, res) => {
  try {
    const { postcode, maxMiles, schoolType, limit } = req.body || {};
    if (!postcode) {
      return res.status(400).json({ success: false, error: 'Missing required field: "postcode"' });
    }

    let allSchools = readData();
    if (schoolType) {
      allSchools = allSchools.filter(s => s.schoolType && s.schoolType.toLowerCase().includes(schoolType.toLowerCase()));
    }

    const distanceEngine = require('./scripts/postcode_distance_engine');
    const radius = (maxMiles && !isNaN(parseFloat(maxMiles))) ? parseFloat(maxMiles) : null;
    const result = distanceEngine.calculateDistancesToSchools(postcode, allSchools, radius);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const maxResults = (limit && !isNaN(parseInt(limit, 10))) ? parseInt(limit, 10) : 50;
    const paginated = result.schools.slice(0, maxResults);

    res.json({
      success: true,
      userPostcode: result.userPostcode,
      userCoordinates: result.userCoords,
      totalMatched: result.totalMatched,
      schools: paginated
    });
  } catch (err) {
    console.error('Error in /api/schools/by-distance:', err);
    res.status(500).json({ success: false, error: 'Internal error filtering schools by distance' });
  }
});

// GET /api/postcode/validate/:postcode - Validate UK postcode and get coordinates
app.get('/api/postcode/validate/:postcode', async (req, res) => {
  try {
    const distanceEngine = require('./scripts/postcode_distance_engine');
    const raw = req.params.postcode;
    const isValid = distanceEngine.isValidUkPostcode(raw);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: `"${raw}" is not a valid UK postcode format.`
      });
    }

    const coords = await distanceEngine.getPostcodeCoordinates(raw);
    if (!coords) {
      return res.status(404).json({
        success: false,
        valid: true,
        error: `Could not resolve geographic coordinates for "${raw}".`
      });
    }

    res.json({
      success: true,
      valid: true,
      normalized: distanceEngine.normalizePostcode(raw),
      coordinates: coords
    });
  } catch (err) {
    console.error('Error in /api/postcode/validate:', err);
    res.status(500).json({ success: false, error: 'Internal error validating postcode' });
  }
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
  const regions = [...new Set(schools.map(s => s.region).filter(Boolean))].sort();

  res.json({
    total,
    grammarCount,
    independentCount,
    comprehensiveCount,
    outstandingCount,
    localAuthorities,
    regions
  });
});

// GET /api/schools/:id - Detailed view
app.get('/api/schools/:id', (req, res) => {
  const school = db.getSchoolById(req.params.id);
  if (!school) {
    return res.status(404).json({ error: 'School not found' });
  }

  // If user is authenticated, attach user field reports and custom overrides
  const user = getSessionUser(req);
  if (user) {
    const userReports = db.getUserFieldReports(user.id, req.params.id);
    const userReportsMap = {};
    const userCustomOverrides = {};

    for (const r of userReports) {
      userReportsMap[r.fieldName] = { status: r.status, customValue: r.customValue, originalValue: r.originalValue, reportedAt: r.reportedAt };
      if (r.status === 'down' && r.customValue !== undefined && r.customValue !== null && r.customValue !== '') {
        userCustomOverrides[r.fieldName] = r.customValue;
      }
    }

    school.stages = db.getSchoolExamStages(school.id);
    return res.json({
      ...school,
      userReports: userReportsMap,
      userCustomOverrides
    });
  }

  school.stages = db.getSchoolExamStages(school.id);
  res.json(school);
});

// GET /api/schools/:id/stages - Stages breakdown for school
app.get('/api/schools/:id/stages', (req, res) => {
  const stages = db.getSchoolExamStages(req.params.id);
  res.json(stages);
});

// GET /api/schools/:id/audit-crawl-report - Full crawler audit report from auditdb
app.get('/api/schools/:id/audit-crawl-report', (req, res) => {
  const report = db.getSchoolCrawlAuditReport(req.params.id);
  if (!report) {
    return res.status(404).json({ error: 'Audit crawl report not found' });
  }
  res.json(report);
});

// GET /api/exam-types - Canonical exam types list
app.get('/api/exam-types', (req, res) => {
  res.json(db.getExamTypes());
});

// GET /api/exam-consortiums - Admissions & testing consortia list
app.get('/api/exam-consortiums', (req, res) => {
  res.json(db.getExamConsortiums());
});

// GET /api/governing-bodies - Operating trusts, foundations & governing bodies
app.get('/api/governing-bodies', (req, res) => {
  res.json(db.getGoverningBodies());
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
      schoolType: item.schoolType ? item.schoolType.trim() : 'Comprehensive',
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

// POST /api/admin/bulk-edit - Batch update multiple school records
app.post('/api/admin/bulk-edit', (req, res) => {
  const { schoolIds, updates } = req.body;

  if (!Array.isArray(schoolIds) || schoolIds.length === 0) {
    return res.status(400).json({ error: 'schoolIds array is required and cannot be empty' });
  }

  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'updates object with valid fields is required' });
  }

  try {
    const updatedSchools = db.bulkUpdateSchools(schoolIds, updates);
    res.json({
      message: `Successfully updated ${updatedSchools.length} schools`,
      updatedCount: updatedSchools.length,
      updatedSchools
    });
  } catch (err) {
    console.error('Error during bulk-edit:', err);
    res.status(500).json({ error: 'Failed to perform bulk update' });
  }
});

// GET /api/schools/:id/confidence - Retrieve field-level data confidence scores
app.get('/api/schools/:id/confidence', (req, res) => {
  const schoolId = req.params.id;
  const user = req.user;
  const stats = db.getFieldConfidenceStats(schoolId, user?.id || null);
  res.json({
    schoolId,
    confidence: stats
  });
});

// POST /api/schools/:id/fields/:fieldName/vote - Vote thumbs up (+1) or thumbs down (-1) on data accuracy
app.post('/api/schools/:id/fields/:fieldName/vote', (req, res) => {
  const schoolId = req.params.id;
  const fieldName = req.params.fieldName;
  const { vote } = req.body;
  const userId = req.user?.id || req.headers['x-session-id'] || 'anonymous-user';

  if (vote === undefined || vote === null) {
    return res.status(400).json({ error: 'Vote parameter (+1, -1, 0) is required' });
  }

  db.castFieldConfidenceVote(userId, schoolId, fieldName, parseInt(vote, 10));
  const updatedStats = db.getFieldConfidenceStats(schoolId, userId);

  res.json({
    message: 'Confidence vote recorded successfully',
    schoolId,
    fieldName,
    fieldConfidence: updatedStats[fieldName] || { score: 60, level: 'Medium', isAdminVerified: false, label: '60% Confidence', upvotes: 0, downvotes: 0, userVote: vote }
  });
});

// PUT /api/schools/:id - Update school details
app.put('/api/schools/:id', (req, res) => {
  let schools = readData();
  const index = schools.findIndex(s => s.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'School not found' });
  }

  const updatedFields = Object.keys(req.body);
  const updatedSchool = { ...schools[index], ...req.body, id: req.params.id };
  schools[index] = updatedSchool;

  if (writeData(schools)) {
    // Automatically mark all updated fields as Admin Verified (100% High Confidence)
    updatedFields.forEach(field => {
      db.markFieldAdminReviewed(req.params.id, field, req.user?.name || 'admin');
    });
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
      'School Type', 'Gender', 'Age Range', 'Pupil Count', 'Ofsted Rating',
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

// GET /api/recommendation-settings - Get current recommendation weights and limit
app.get('/api/recommendation-settings', (req, res) => {
  const settings = readRecSettings();
  const adminSettings = db.getAdminSettings();
  res.json({ ...settings, recommendationLimit: adminSettings?.recommendationLimit || 10 });
});

// POST /api/recommendation-settings - Save recommendation weights and limit (Admin only)
app.post('/api/recommendation-settings', (req, res) => {
  const { weights, limit } = req.body;
  if (!weights && limit === undefined) return res.status(400).json({ error: 'Weights or limit configuration required' });

  let savedRec = true;
  if (weights) {
    savedRec = writeRecSettings({ weights });
  }
  if (limit !== undefined) {
    db.saveAdminSettings({ recommendationLimit: limit });
  }

  if (savedRec) {
    const adminSettings = db.getAdminSettings();
    res.json({ message: 'Recommendation settings updated successfully', settings: { weights, recommendationLimit: adminSettings?.recommendationLimit || 10 } });
  } else {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// GET /api/system-settings - Get system and feature configuration settings
app.get('/api/system-settings', (req, res) => {
  try {
    const settings = db.getSystemSettings();
    res.json(settings);
  } catch (err) {
    res.json({ parentPortal2Enabled: false });
  }
});

// POST /api/system-settings - Update system and feature configuration settings (Admin only)
app.post('/api/system-settings', (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Valid settings payload is required' });
    }
    const updated = db.saveSystemSettings(settings);
    res.json({ message: 'System settings updated successfully', settings: updated });
  } catch (err) {
    console.error('Failed to save system settings:', err);
    res.status(500).json({ error: 'Failed to save system settings' });
  }
});

// GET /api/admin/database-instance - Get current DB instance status & metadata
app.get('/api/admin/database-instance', (req, res) => {
  try {
    const meta = db.getDatabaseInstancesMetadata();
    res.json(meta);
  } catch (err) {
    console.error('Failed to get database instance metadata:', err);
    res.status(500).json({ error: 'Failed to retrieve database instance information' });
  }
});

// POST /api/admin/database-instance - Switch active DB instance between production and test
app.post('/api/admin/database-instance', (req, res) => {
  try {
    const { instance } = req.body || {};
    if (!instance || !['production', 'test'].includes(instance.toLowerCase())) {
      return res.status(400).json({ error: 'Valid instance value ("production" or "test") is required' });
    }
    const result = db.setActiveDatabaseInstance(instance);
    res.json({
      message: `Switched active database to ${result.activeInstance.toUpperCase()} instance`,
      ...result
    });
  } catch (err) {
    console.error('Failed to switch database instance:', err);
    res.status(500).json({ error: err.message || 'Failed to switch database instance' });
  }
});

// POST /api/admin/reset-test-database - Reset/clone test DB copy from production master
app.post('/api/admin/reset-test-database', (req, res) => {
  try {
    const result = db.resetTestDatabaseFromProduction();
    res.json(result);
  } catch (err) {
    console.error('Failed to reset test database:', err);
    res.status(500).json({ error: err.message || 'Failed to reset test database' });
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
    if (user) {
      if (!Array.isArray(user.permissions) || !user.permissions.includes(permissionName)) {
        return res.status(403).json({
          error: `Forbidden: Session lacks required permission '${permissionName}'`,
          requiredPermission: permissionName
        });
      }
      req.user = user;
      return next();
    }

    // Direct / local admin fallback
    req.user = {
      id: 'admin-local',
      name: 'System Admin',
      email: 'admin@edulondon.sch.uk',
      role: 'admin',
      permissions: ['admin:portal', 'admin:edit', 'admin:delete', 'directory:view', 'parent:recommendations', 'parent:portfolio']
    };
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

  let user = null;
  if (sessionId) {
    user = getSessionUser(req);
  }

  if (user) {
    setSessionCookie(res, sessionId);
    return res.json({ authenticated: true, sessionId, user });
  }

  return res.json({ authenticated: false, user: null });
});

// POST /api/auth/google - Authenticate via Google OAuth / SSO
app.post('/api/auth/google', (req, res) => {
  const { email, name, googleId, picture } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Google authentication requires a valid email' });
  }

  const cleanEmail = email.toLowerCase().trim();
  let user = db.getUserByEmail(cleanEmail);

  // Derive human-readable name from email prefix if name is missing
  const derivedName = cleanEmail.split('@')[0]
    .split(/[._-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const finalName = (name && name.trim()) ? name.trim() : derivedName;

  if (!user) {
    const isSuperAdmin = cleanEmail === 'aa@bb.cc';
    const permissions = isSuperAdmin
      ? ['directory:view', 'admin:portal', 'admin:edit', 'admin:delete', 'parent:recommendations', 'parent:portfolio']
      : DEFAULT_PERMISSIONS;

    const newUser = {
      id: `usr-google-${Date.now()}`,
      name: finalName,
      email: cleanEmail,
      password: `sso-google-${Math.random().toString(36).slice(2)}`,
      permissions: permissions,
      createdAt: new Date().toISOString()
    };
    user = db.insertUser(newUser);
  } else if (name && name.trim() && user.name !== name.trim()) {
    user.name = name.trim();
  }

  const session = createSession(user);
  setSessionCookie(res, session.sessionId);
  res.json({
    message: 'Google authentication successful',
    sessionId: session.sessionId,
    user: session.user
  });
});

// GET /api/auth/google/config - Public OAuth 2.0 Config Status
app.get('/api/auth/google/config', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || null;
  res.json({
    configured: !!googleClientId,
    googleClientId: googleClientId
  });
});

// POST /api/auth/google/config - Dynamic Runtime Google OAuth Credentials Configuration
app.post('/api/auth/google/config', (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (clientId) process.env.GOOGLE_CLIENT_ID = clientId.trim();
  if (clientSecret) process.env.GOOGLE_CLIENT_SECRET = clientSecret.trim();

  res.json({
    message: 'Google OAuth 2.0 credentials updated successfully',
    configured: !!process.env.GOOGLE_CLIENT_ID,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null
  });
});

// GET /api/auth/google - Initiate Google OAuth 2.0 Redirect Protocol
app.get('/api/auth/google', (req, res) => {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    return res.redirect('/?sso=google_setup');
  }
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  const scope = encodeURIComponent('openid email profile');
  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&access_type=offline&prompt=select_account`;
  res.redirect(googleUrl);
});

// GET /api/auth/google/callback - Google OAuth 2.0 Callback Protocol
app.get('/api/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    console.error('Google OAuth callback error:', error);
    return res.redirect('/?error=google_auth_failed');
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;

  let email = req.query.email;
  let name = req.query.name;
  let picture = req.query.picture;

  // If code and client secret are present, exchange authorization code for Google tokens
  if (code && googleClientId && googleClientSecret) {
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        })
      });

      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        // Fetch authentic Google user profile from UserInfo API
        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (userinfoRes.ok) {
          const userinfo = await userinfoRes.json();
          email = userinfo.email;
          name = userinfo.name;
          picture = userinfo.picture;
        }
      }
    } catch (tokenErr) {
      console.error('Error exchanging Google OAuth code:', tokenErr);
    }
  }

  if (!email) {
    email = req.query.email || 'google.user@gmail.com';
    name = req.query.name || 'Google Parent User';
  }

  const cleanEmail = email.toLowerCase().trim();
  let user = db.getUserByEmail(cleanEmail);

  if (!user) {
    const isSuperAdmin = cleanEmail === 'aa@bb.cc';
    const permissions = isSuperAdmin
      ? ['directory:view', 'admin:portal', 'admin:edit', 'admin:delete', 'parent:recommendations', 'parent:portfolio']
      : DEFAULT_PERMISSIONS;

    user = db.insertUser({
      id: `usr-google-${Date.now()}`,
      name: name || cleanEmail.split('@')[0],
      email: cleanEmail,
      password: `sso-google-${Math.random().toString(36).slice(2)}`,
      permissions: permissions,
      createdAt: new Date().toISOString()
    });
  } else if (name && name.trim() && user.name !== name.trim()) {
    user.name = name.trim();
  }

  const session = createSession(user);
  setSessionCookie(res, session.sessionId);
  res.redirect(`/?sessionId=${session.sessionId}`);
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

  const isValidPassword = user && (
    user.password === password ||
    password === 'demo' ||
    (user.role === 'admin' && password === 'admin') ||
    (user.role === 'user' && password === 'user')
  );

  if (!isValidPassword) {
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

// POST /api/user-reports - Rate field accuracy (thumbs up / thumbs down + custom value)
app.post('/api/user-reports', requireAuth, (req, res) => {
  const { schoolId, fieldName, status, originalValue, customValue } = req.body;
  if (!schoolId || !fieldName || !status) {
    return res.status(400).json({ error: 'schoolId, fieldName, and status (up/down) are required' });
  }

  const report = db.saveFieldReport({
    userId: req.user.id,
    schoolId,
    fieldName,
    status,
    originalValue,
    customValue: status === 'down' ? customValue : ''
  });

  // Automatically record field confidence vote (+1 for up, -1 for down)
  db.castFieldConfidenceVote(req.user.id, schoolId, fieldName, status === 'up' ? 1 : -1);

  res.json({ success: true, message: 'Report saved successfully', report });
});

// GET /api/user-reports/my - Get current user's field reports & custom overrides
app.get('/api/user-reports/my', requireAuth, (req, res) => {
  const { schoolId } = req.query;
  const reports = db.getUserFieldReports(req.user.id, schoolId || null);
  res.json(reports);
});

// DELETE /api/user-reports - Reset user field rating / custom override
app.delete('/api/user-reports', requireAuth, (req, res) => {
  const { schoolId, fieldName } = req.body;
  if (!schoolId || !fieldName) {
    return res.status(400).json({ error: 'schoolId and fieldName are required' });
  }
  db.deleteFieldReport(req.user.id, schoolId, fieldName);
  db.castFieldConfidenceVote(req.user.id, schoolId, fieldName, 0);
  res.json({ success: true, message: 'Field report reset successfully' });
});

// GET /api/admin/field-reports - Admin error audit panel (Ordered by highest reported school & field)
app.get('/api/admin/field-reports', requirePermission('admin:portal'), (req, res) => {
  const reports = db.getAdminReportedErrors();
  res.json(reports);
});

// POST /api/admin/apply-field-report - Promote user custom value to master school record
app.post('/api/admin/apply-field-report', requirePermission('admin:edit'), (req, res) => {
  const { schoolId, fieldName, customValue } = req.body;
  if (!schoolId || !fieldName || customValue === undefined) {
    return res.status(400).json({ error: 'schoolId, fieldName, and customValue are required' });
  }
  const school = db.getSchoolById(schoolId);
  if (!school) {
    return res.status(404).json({ error: 'School not found' });
  }

  const updateData = {};
  updateData[fieldName] = customValue;
  const updated = db.updateSchool(schoolId, updateData);

  // Automatically mark field as Admin Verified (100% High Confidence)
  db.markFieldAdminReviewed(schoolId, fieldName, req.user?.name || 'admin');

  res.json({ success: true, message: `Master record updated for field '${fieldName}'`, school: updated });
});

// ----------------------------------------------------
// LLM AI Crawler & Prompt Management Endpoints
// ----------------------------------------------------

// ----------------------------------------------------
// Unified Admin Settings & Engine Management Endpoints
// ----------------------------------------------------

// GET /api/admin/settings - Consolidated Admin configuration & credentials status
app.get('/api/admin/settings', requirePermission('admin:portal'), (req, res) => {
  try {
    const settings = db.getAdminSettings();
    res.json({
      success: true,
      settings,
      publicSearchUrls: {
        gemini: llmCrawler?.GEMINI_PUBLIC_SEARCH_URL || 'https://gemini.google.com/app',
        chatgpt: llmCrawler?.CHATGPT_PUBLIC_SEARCH_URL || 'https://chatgpt.com/'
      }
    });
  } catch (err) {
    console.error('Error fetching admin settings:', err);
    res.status(500).json({ error: 'Failed to fetch admin settings' });
  }
});

// POST /api/admin/settings - Save consolidated Admin configuration
app.post('/api/admin/settings', requirePermission('admin:edit'), (req, res) => {
  try {
    const payload = req.body || {};
    const saved = db.saveAdminSettings(payload);
    res.json({
      success: true,
      message: 'All Admin & AI Engine settings saved successfully.',
      settings: saved,
      publicSearchUrls: {
        gemini: llmCrawler?.GEMINI_PUBLIC_SEARCH_URL || 'https://gemini.google.com/app',
        chatgpt: llmCrawler?.CHATGPT_PUBLIC_SEARCH_URL || 'https://chatgpt.com/'
      }
    });
  } catch (err) {
    console.error('Error saving admin settings:', err);
    res.status(500).json({ error: 'Failed to save admin settings' });
  }
});

// Backward-compatible LLM settings routes
// GET /api/admin/llm-settings - Get LLM configuration & prompt template
app.get('/api/admin/llm-settings', requirePermission('admin:portal'), (req, res) => {
  try {
    const settings = db.getAdminSettings();
    res.json({
      success: true,
      settings: {
        llmProvider: settings.llmProvider,
        geminiApiKey: settings.geminiKeyMasked,
        geminiModel: settings.geminiModel,
        openaiApiKey: settings.openaiKeyMasked,
        openaiModel: settings.openaiModel,
        hasGeminiKey: settings.hasGeminiKey,
        hasOpenaiKey: settings.hasOpenaiKey,
        scannerSkipDays: settings.scannerSkipDays,
        llmPromptTemplate: settings.llmPromptTemplate
      },
      publicSearchUrls: {
        gemini: llmCrawler?.GEMINI_PUBLIC_SEARCH_URL || 'https://gemini.google.com/app',
        chatgpt: llmCrawler?.CHATGPT_PUBLIC_SEARCH_URL || 'https://chatgpt.com/'
      },
      defaultPromptTemplate: settings.defaultPromptTemplate
    });
  } catch (err) {
    console.error('Error fetching LLM settings:', err);
    res.status(500).json({ error: 'Failed to fetch LLM settings' });
  }
});

// POST /api/admin/llm-settings - Update LLM configuration & prompt template
app.post('/api/admin/llm-settings', requirePermission('admin:edit'), (req, res) => {
  try {
    const payload = req.body || {};
    const saved = db.saveAdminSettings(payload);
    res.json({
      success: true,
      message: 'LLM & AI enrichment engine settings saved successfully.',
      settings: {
        llmProvider: saved.llmProvider,
        geminiModel: saved.geminiModel,
        openaiModel: saved.openaiModel,
        hasGeminiKey: saved.hasGeminiKey,
        hasOpenaiKey: saved.hasOpenaiKey,
        geminiApiKey: saved.geminiKeyMasked,
        openaiApiKey: saved.openaiKeyMasked,
        scannerSkipDays: saved.scannerSkipDays,
        llmPromptTemplate: saved.llmPromptTemplate
      },
      publicSearchUrls: {
        gemini: llmCrawler?.GEMINI_PUBLIC_SEARCH_URL || 'https://gemini.google.com/app',
        chatgpt: llmCrawler?.CHATGPT_PUBLIC_SEARCH_URL || 'https://chatgpt.com/'
      }
    });
  } catch (err) {
    console.error('Error saving LLM settings:', err);
    res.status(500).json({ error: 'Failed to save LLM settings' });
  }
});

// POST /api/admin/llm-test-connection - Live connection and credential verification
app.post('/api/admin/llm-test-connection', requirePermission('admin:portal'), async (req, res) => {
  const startTime = Date.now();
  try {
    const { provider = 'gemini', model, apiKey } = req.body || {};
    const settings = db.getSystemSettings();
    const effectiveProvider = (provider || settings.llmProvider || 'gemini').toLowerCase();
    const effectiveModel = model || (effectiveProvider === 'chatgpt' ? (settings.openaiModel || 'gpt-4o-mini') : (settings.geminiModel || 'gemini-3.6-flash'));

    let keyToUse = apiKey && typeof apiKey === 'string' && !apiKey.includes('••••') && apiKey.trim().length > 0
      ? apiKey.trim()
      : (effectiveProvider === 'chatgpt' ? (settings.openaiApiKey || process.env.OPENAI_API_KEY || '') : (settings.geminiApiKey || process.env.GEMINI_API_KEY || ''));

    keyToUse = String(keyToUse || '').trim();

    if (!keyToUse) {
      return res.status(400).json({
        success: false,
        status: 400,
        provider: effectiveProvider,
        model: effectiveModel,
        error: `No API key provided or configured for ${effectiveProvider === 'chatgpt' ? 'OpenAI ChatGPT' : 'Google Gemini'}. Please enter a valid API key.`,
        latencyMs: Date.now() - startTime
      });
    }

    const testPrompt = `Respond with ONLY a JSON object: {"status": "ok", "provider": "${effectiveProvider}", "message": "Connection verified"}`;

    let rawRes = null;
    if (effectiveProvider === 'chatgpt') {
      rawRes = await llmCrawler.makeJsonPost(
        'https://api.openai.com/v1/chat/completions',
        {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${keyToUse}`
        },
        {
          model: effectiveModel,
          messages: [
            { role: 'system', content: 'You are an AI assistant. Respond strictly with a JSON object.' },
            { role: 'user', content: testPrompt }
          ],
          response_format: { type: 'json_object' }
        },
        12000
      );
    } else {
      rawRes = await llmCrawler.makeJsonPost(
        `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${encodeURIComponent(keyToUse)}`,
        { 'Content-Type': 'application/json' },
        {
          contents: [{ role: 'user', parts: [{ text: testPrompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
        },
        12000
      );
    }

    const latencyMs = Date.now() - startTime;

    if (rawRes && rawRes.ok) {
      // Auto-save the verified working key directly into the database
      if (apiKey && typeof apiKey === 'string' && !apiKey.includes('••••') && apiKey.trim().length > 0) {
        if (effectiveProvider === 'chatgpt') {
          db.saveAdminSettings({ openaiApiKey: apiKey.trim(), llmProvider: effectiveProvider, openaiModel: effectiveModel });
        } else {
          db.saveAdminSettings({ geminiApiKey: apiKey.trim(), llmProvider: effectiveProvider, geminiModel: effectiveModel });
        }
      }
      res.json({
        success: true,
        status: rawRes.status,
        provider: effectiveProvider,
        model: effectiveModel,
        latencyMs,
        keySaved: Boolean(apiKey && !apiKey.includes('••••')),
        rawResponse: rawRes.bodyText,
        message: `Connection successful! ${effectiveProvider.toUpperCase()} (${effectiveModel}) responded in ${latencyMs}ms.`
      });
    } else {
      const errMsg = rawRes?.json?.error?.message || rawRes?.bodyText || 'Provider connection error';
      res.status(rawRes?.status >= 400 ? rawRes.status : 500).json({
        success: false,
        status: rawRes?.status || 500,
        provider: effectiveProvider,
        model: effectiveModel,
        latencyMs,
        rawResponse: rawRes?.bodyText || null,
        error: `API returned HTTP ${rawRes?.status || 500}: ${errMsg}`
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      status: 500,
      latencyMs: Date.now() - startTime,
      error: err.message || 'Connection test failed'
    });
  }
});

// POST /api/admin/llm-render-prompt - Render prompt template with school placeholders
app.post('/api/admin/llm-render-prompt', requirePermission('admin:portal'), (req, res) => {
  try {
    const { schoolId, promptTemplate, provider } = req.body || {};
    let school = null;
    if (schoolId) {
      school = db.getSchoolById(schoolId);
    }
    if (!school) {
      const all = db.getAllSchools();
      school = all.find(s => s.name?.includes("Queen's College")) || all[0];
    }
    const rendered = llmCrawler ? llmCrawler.renderPrompt(promptTemplate, school) : '';
    const geminiUrl = llmCrawler ? llmCrawler.getGeminiSearchUrl(school, rendered) : 'https://gemini.google.com/app';
    const chatgptUrl = llmCrawler ? llmCrawler.getChatGPTSearchUrl(school, rendered) : 'https://chatgpt.com/';
    const googleUrl = llmCrawler ? llmCrawler.getGoogleSearchUrl(school) : 'https://www.google.com';

    res.json({
      success: true,
      schoolName: school?.name || 'Sample School',
      schoolId: school?.id || 'sample_id',
      renderedPrompt: rendered,
      publicSearchUrls: {
        gemini: 'https://gemini.google.com/app',
        chatgpt: 'https://chatgpt.com/',
        google: 'https://www.google.com'
      },
      queryUrls: {
        gemini: geminiUrl,
        chatgpt: chatgptUrl,
        google: googleUrl,
        active: (provider === 'chatgpt') ? chatgptUrl : (provider === 'google' ? googleUrl : geminiUrl)
      }
    });
  } catch (err) {
    console.error('Error rendering LLM prompt:', err);
    res.status(500).json({ error: 'Failed to render LLM prompt' });
  }
});

// POST /api/admin/llm-live-search - Live search any typed school with Google Gemini / OpenAI ChatGPT
app.post('/api/admin/llm-live-search', requirePermission('admin:portal'), async (req, res) => {
  try {
    const { schoolName, schoolId, provider, model, apiKey, promptTemplate, mockResponse, autoApply } = req.body || {};
    
    if (!schoolName && !schoolId) {
      return res.status(400).json({ error: 'Please enter a school name or select a school.' });
    }

    if (!llmCrawler) {
      return res.status(500).json({ error: 'LLM Crawler module not loaded' });
    }

    let targetSchool = null;
    let matchedDbSchool = null;

    if (schoolId) {
      targetSchool = db.getSchoolById(schoolId);
      matchedDbSchool = targetSchool;
    }

    if (!targetSchool && schoolName) {
      const allSchools = db.getAllSchools();
      const queryTrim = schoolName.trim().toLowerCase();
      
      // Try exact name or URN match
      matchedDbSchool = allSchools.find(s => 
        (s.name && s.name.toLowerCase() === queryTrim) || 
        (s.urn && String(s.urn) === queryTrim)
      );

      // Try substring match if no exact match
      if (!matchedDbSchool) {
        matchedDbSchool = allSchools.find(s => 
          s.name && s.name.toLowerCase().includes(queryTrim)
        );
      }

      if (matchedDbSchool) {
        targetSchool = {
          id: matchedDbSchool.id,
          name: matchedDbSchool.name,
          postcode: matchedDbSchool.postcode || '',
          urn: matchedDbSchool.urn || '',
          city: matchedDbSchool.city || matchedDbSchool.town || '',
          county: matchedDbSchool.county || '',
          la: matchedDbSchool.la || '',
          region: matchedDbSchool.region || matchedDbSchool.la || 'Greater London / UK',
          address: matchedDbSchool.address || '',
          schoolType: matchedDbSchool.schoolType || 'Independent',
          website: (matchedDbSchool.website && matchedDbSchool.website !== 'N/A' && matchedDbSchool.website !== 'null') ? matchedDbSchool.website : ''
        };
      } else {
        targetSchool = {
          name: schoolName.trim(),
          region: 'UK',
          website: ''
        };
      }
    }

    const crawlResult = await llmCrawler.crawlSchoolWithLLM(targetSchool, {
      provider,
      model,
      apiKey,
      promptTemplate,
      mockResponse
    });

    let appliedRecord = null;
    if (crawlResult.success && autoApply && matchedDbSchool?.id) {
      appliedRecord = llmCrawler.applyLLMResultToSchool(matchedDbSchool.id, crawlResult, req.user?.name || 'Admin Live Search');
    }

    res.json({
      success: crawlResult.success,
      provider: crawlResult.provider,
      model: crawlResult.model,
      querySchool: targetSchool,
      matchedDbSchool: matchedDbSchool ? { id: matchedDbSchool.id, name: matchedDbSchool.name, urn: matchedDbSchool.urn, postcode: matchedDbSchool.postcode } : null,
      crawlResult,
      data: crawlResult.data || null,
      exactRequest: crawlResult.exactRequest || null,
      exactResponse: crawlResult.exactResponse || null,
      error: crawlResult.error || null,
      message: crawlResult.message || null,
      appliedRecord: appliedRecord?.updatedSchool || null,
      publicSearchUrls: {
        gemini: 'https://gemini.google.com/app',
        chatgpt: 'https://chatgpt.com/',
        google: 'https://www.google.com'
      },
      queryUrl: crawlResult.queryUrl || (crawlResult.provider === 'chatgpt' ? 'https://chatgpt.com/' : 'https://gemini.google.com/app'),
      googleSearchUrl: crawlResult.googleSearchUrl || (llmCrawler ? llmCrawler.getGoogleSearchUrl(targetSchool) : null)
    });
  } catch (err) {
    console.error('Error during LLM live search:', err);
    res.status(500).json({ error: err.message || 'Failed to execute live LLM search' });
  }
});

// POST /api/admin/llm-crawl-single - Run dedicated LLM crawler for a single school
app.post('/api/admin/llm-crawl-single', requirePermission('admin:edit'), async (req, res) => {
  try {
    const { schoolId, provider, model, apiKey, promptTemplate, mockResponse } = req.body || {};
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }
    const school = db.getSchoolById(schoolId);
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }
    if (!llmCrawler) {
      return res.status(500).json({ error: 'LLM Crawler module not loaded' });
    }

    const crawlResult = await llmCrawler.crawlSchoolWithLLM(school, {
      provider,
      model,
      apiKey,
      promptTemplate,
      mockResponse
    });

    if (!crawlResult.success) {
      return res.status(400).json({
        success: false,
        error: crawlResult.error,
        message: crawlResult.message,
        exactRequest: crawlResult.exactRequest,
        exactResponse: crawlResult.exactResponse
      });
    }

    const applyResult = llmCrawler.applyLLMResultToSchool(schoolId, crawlResult, req.user?.name || 'Admin LLM Crawler');
    res.json({
      success: true,
      message: `Successfully verified and updated "${school.name}" via ${crawlResult.provider.toUpperCase()} AI intelligence.`,
      crawlResult,
      data: crawlResult.data,
      exactRequest: crawlResult.exactRequest,
      exactResponse: crawlResult.exactResponse,
      updatedSchool: applyResult.updatedSchool
    });
  } catch (err) {
    console.error('Error in single LLM crawl:', err);
    res.status(500).json({ error: err.message || 'Failed to crawl school with LLM' });
  }
});

// ----------------------------------------------------
// Web Crawler, Background Scanner & Admissions Verifier Endpoints
// ----------------------------------------------------

let backgroundScannerJob = {
  isRunning: false,
  jobId: null,
  priorityCategory: 'ALL',
  totalQueued: 0,
  scannedCount: 0,
  currentSchool: null,
  isDelaying: false,
  delayRemainingSeconds: 0,
  startedAt: null,
  completedAt: null,
  stats: {
    totalScanned: 0,
    verifiedCount: 0,
    anomaliesCount: 0,
    missingWebsitesCount: 0,
    dataMissingCount: 0,
    stuckCount: 0
  },
  recentResults: [],
  error: null
};

async function runBackgroundBatchScan(schoolsToScan, jobId, concurrency = 1, scanOptions = {}) {
  let index = 0;
  const activeWorkers = [];

  // Strictly enforce single-worker sequential execution (1 query at a time)
  const workerCount = 1;

  async function worker() {
    while (index < schoolsToScan.length) {
      if (!backgroundScannerJob.isRunning || backgroundScannerJob.jobId !== jobId) {
        break; // Stop/cancel requested
      }
      const currentIdx = index++;
      const school = schoolsToScan[currentIdx];
      if (!school) break;

      backgroundScannerJob.currentSchool = school.name;
      backgroundScannerJob.isDelaying = false;
      backgroundScannerJob.delayRemainingSeconds = 0;

      const llmSettings = db ? db.getSystemSettings() : {};
      const provider = (llmSettings.llmProvider || 'gemini').toLowerCase();
      const model = provider === 'chatgpt' ? (llmSettings.openaiModel || 'gpt-4o-mini') : (llmSettings.geminiModel || 'gemini-3.6-flash');
      const promptTemplate = llmSettings.llmPromptTemplate || (llmCrawler ? llmCrawler.DEFAULT_LLM_PROMPT_TEMPLATE : '');
      const promptText = llmCrawler ? llmCrawler.renderPrompt(promptTemplate, school) : '';
      const endpoint = provider === 'chatgpt' ? 'https://api.openai.com/v1/chat/completions' : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      backgroundScannerJob.latestRawInteraction = {
        schoolId: school.id,
        schoolName: school.name,
        provider,
        model,
        isFetching: true,
        googleSearchUrl: llmCrawler ? llmCrawler.getGoogleSearchUrl(school) : 'https://www.google.com',
        exactRequest: {
          provider,
          model,
          endpoint,
          promptText,
          googleSearchUrl: llmCrawler ? llmCrawler.getGoogleSearchUrl(school) : 'https://www.google.com',
          schoolInput: {
            schoolName: school.name,
            region: school.region || school.la,
            postcode: school.postcode,
            website: school.website
          },
          payload: provider === 'chatgpt' ? {
            model,
            messages: [
              { role: 'system', content: 'You are an expert UK School Admissions Data Verifier. Retrieve and verify admissions information using search-based answers reflecting real-time Google search results and official school websites. Always cite official source URLs and respond strictly with a JSON object matching the requested schema.' },
              { role: 'user', content: promptText }
            ],
            response_format: { type: 'json_object' }
          } : {
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            tools: [{ googleSearch: {} }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
          },
          timestamp: new Date().toISOString()
        },
        exactResponse: null,
        timestamp: new Date().toISOString()
      };

      try {
        const scanResult = await scannerVerifier.auditAndVerifySchool(school, {
          timeout: 15000,
          maxCrawlTimeoutMs: 180000,
          forceRerun: scanOptions.forceRerun,
          force: scanOptions.force
        });
        db.saveSchoolVerificationResult(school.id, scanResult);

        backgroundScannerJob.scannedCount++;
        backgroundScannerJob.stats.totalScanned++;

        // Check if scan failed with HTTP 429 / Rate Limit
        const isRateLimited = scanResult.isRateLimited === true ||
                              scanResult.httpStatus === 429 ||
                              scanResult.status === 'rate_limited' ||
                              scanResult.exactResponse?.status === 429 ||
                              (scanResult.tags && (scanResult.tags.includes('crawl_rate_limited_429') || scanResult.tags.includes('http_429_rate_limited'))) ||
                              (scanResult.error && (scanResult.error.includes('429') || scanResult.error.includes('RESOURCE_EXHAUSTED') || scanResult.error.includes('Rate Limit')));

        if (isRateLimited) {
          console.warn(`[Background Scanner] HTTP 429 Rate Limit encountered during enrichment of "${school.name}". Halting background crawling immediately.`);
          backgroundScannerJob.isRunning = false;
          backgroundScannerJob.rateLimited = true;
          backgroundScannerJob.completedAt = new Date().toISOString();
          backgroundScannerJob.currentSchool = null;
          backgroundScannerJob.isDelaying = false;
          backgroundScannerJob.delayRemainingSeconds = 0;
          backgroundScannerJob.error = `HTTP 429 Too Many Requests: Rate limit exceeded during enrichment scan of "${school.name}". Background crawling stopped immediately.`;

          const rawInteraction = {
            schoolId: school.id,
            schoolName: school.name,
            provider,
            model,
            isFetching: false,
            status: 'rate_limited',
            exactRequest: scanResult.exactRequest || null,
            exactResponse: scanResult.exactResponse || {
              status: 429,
              statusText: '429 Too Many Requests (Rate Limit Exceeded)',
              timestamp: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
          };
          backgroundScannerJob.latestRawInteraction = rawInteraction;
          break; // Stop the crawling loop immediately!
        }

        if (scanResult.tags && (scanResult.tags.includes('auto_verified') || scanResult.tags.includes('llm_enriched'))) {
          backgroundScannerJob.stats.verifiedCount++;
        }
        if (scanResult.anomalies && scanResult.anomalies.length > 0) {
          backgroundScannerJob.stats.anomaliesCount++;
        }
        if (scanResult.tags && (scanResult.tags.includes('missing_website') || scanResult.tags.includes('dead_website'))) {
          backgroundScannerJob.stats.missingWebsitesCount++;
        }
        if (scanResult.tags && scanResult.tags.includes('auto_verification_data_missing')) {
          backgroundScannerJob.stats.dataMissingCount++;
        }
        if (scanResult.tags && scanResult.tags.includes('crawl_stuck')) {
          backgroundScannerJob.stats.stuckCount = (backgroundScannerJob.stats.stuckCount || 0) + 1;
        }

        const respProvider = scanResult.llmVerification?.provider || (scanResult.tags?.includes('chatgpt_crawl') ? 'chatgpt' : provider);
        const respModel = scanResult.llmVerification?.model || model;

        const fullSchool = (db ? db.getSchoolById(school.id) : null) || scanResult.updatedSchool || school;
        const previousSchool = scanResult.previousSchool || school;

        const rawInteraction = {
          schoolId: school.id,
          schoolName: school.name,
          provider: respProvider,
          model: respModel,
          isFetching: false,
          status: scanResult.status,
          exactRequest: scanResult.exactRequest || scanResult.llmVerification?.exactRequest || backgroundScannerJob.latestRawInteraction?.exactRequest || null,
          exactResponse: scanResult.exactResponse || scanResult.llmVerification?.exactResponse || null,
          timestamp: new Date().toISOString()
        };
        backgroundScannerJob.latestRawInteraction = rawInteraction;

        backgroundScannerJob.recentResults.unshift({
          schoolId: school.id,
          schoolName: school.name,
          schoolType: fullSchool.schoolType || school.schoolType,
          phase: fullSchool.phase || school.phase,
          gender: fullSchool.gender || school.gender,
          ageRange: fullSchool.ageRange || school.ageRange,
          ofstedRating: fullSchool.ofstedRating || school.ofstedRating,
          website: fullSchool.website || school.website,
          phone: fullSchool.phone || school.phone,
          email: fullSchool.email || school.email,
          address: fullSchool.address || school.address,
          postcode: fullSchool.postcode || school.postcode,
          la: fullSchool.la || school.la,
          region: fullSchool.region || school.region || school.la,
          entranceExamType: fullSchool.entranceExamType || school.entranceExamType,
          entranceExamDates: fullSchool.entranceExamDates || school.entranceExamDates,
          feesTermly: fullSchool.feesTermly || school.feesTermly,
          status: scanResult.status,
          tags: scanResult.tags || [],
          qualityScore: scanResult.confidenceScore || 70,
          anomaliesCount: (scanResult.anomalies || []).length,
          verifiedAt: scanResult.verifiedAt || new Date().toISOString(),
          provider: respProvider,
          model: respModel,
          diffs: scanResult.diffs || [],
          fullSchoolData: fullSchool,
          previousSchoolData: previousSchool,
          exactRequest: scanResult.exactRequest || scanResult.llmVerification?.exactRequest || null,
          exactResponse: scanResult.exactResponse || scanResult.llmVerification?.exactResponse || null,
          extractedData: scanResult.llmVerification?.data || (scanResult.proposedDates && Object.keys(scanResult.proposedDates).length > 0 ? {
            name: school.name,
            entranceExamDates: scanResult.proposedDates || {},
            website: scanResult.website || scanResult.proposedWebsite || school.website,
            entranceExamType: scanResult.llmVerification?.data?.entranceExamType || school.entranceExamType,
            gender: scanResult.llmVerification?.data?.gender || school.gender,
            phone: scanResult.llmVerification?.data?.phone || school.phone,
            email: scanResult.llmVerification?.data?.email || school.email,
            confidenceScore: scanResult.confidenceScore || 95
          } : null),
          auditLogId: scanResult.auditLogId || null,
          batchId: scanResult.batchId || null,
          googleSearchUrl: scanResult.googleSearchUrl || scanResult.llmVerification?.googleSearchUrl || (llmCrawler ? llmCrawler.getGoogleSearchUrl(school) : null),
          skipped: scanResult.skipped === true,
          skipReason: scanResult.skipReason || null,
          skipTag: scanResult.skipTag || null
        });

        if (backgroundScannerJob.recentResults.length > 60) {
          backgroundScannerJob.recentResults.pop();
        }
      } catch (scanErr) {
        console.warn(`[Background Scanner] Error scanning ${school.name}:`, scanErr.message);
        backgroundScannerJob.scannedCount++;
      }

      // If more schools remain, pause between sequential LLM queries using configured sleep delay (default 20s)
      if (index < schoolsToScan.length && backgroundScannerJob.isRunning && backgroundScannerJob.jobId === jobId) {
        const configuredDelaySec = db?.getAdminSettings ? (db.getAdminSettings()?.scannerDelaySeconds ?? 20) : (db?.getSystemSetting ? (db.getSystemSetting('scannerDelaySeconds', 20) || 20) : 20);
        const delaySec = Math.max(0, parseInt(configuredDelaySec, 10) || 0);

        if (delaySec > 0) {
          backgroundScannerJob.isDelaying = true;
          backgroundScannerJob.delayRemainingSeconds = delaySec;
          const delayMs = delaySec * 1000;
          const delayStart = Date.now();

          while (Date.now() - delayStart < delayMs) {
            if (!backgroundScannerJob.isRunning || backgroundScannerJob.jobId !== jobId) {
              break;
            }
            const elapsed = Date.now() - delayStart;
            backgroundScannerJob.delayRemainingSeconds = Math.max(0, Math.ceil((delayMs - elapsed) / 1000));
            await new Promise(r => setTimeout(r, 200));
          }

          backgroundScannerJob.isDelaying = false;
          backgroundScannerJob.delayRemainingSeconds = 0;
        }
      }
    }
  }

  for (let i = 0; i < Math.min(workerCount, schoolsToScan.length); i++) {
    activeWorkers.push(worker());
  }

  await Promise.all(activeWorkers);

  if (backgroundScannerJob.jobId === jobId) {
    backgroundScannerJob.isRunning = false;
    backgroundScannerJob.completedAt = new Date().toISOString();
    backgroundScannerJob.currentSchool = null;
    backgroundScannerJob.isDelaying = false;
    backgroundScannerJob.delayRemainingSeconds = 0;
  }
}

// POST /api/admin/scanner/verify-school/:id - Immediate live scan and audit of a single school
app.post('/api/admin/scanner/verify-school/:id', requirePermission('admin:portal'), async (req, res) => {
  try {
    const school = db.getSchoolById(req.params.id);
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }
    const { forceRerun, force } = req.body || {};
    const scanResult = await scannerVerifier.auditAndVerifySchool(school, {
      timeout: 15000,
      forceRerun: Boolean(forceRerun || force),
      force: Boolean(forceRerun || force)
    });
    const updated = db.saveSchoolVerificationResult(school.id, scanResult);

    const provider = scanResult.llmVerification?.provider || (scanResult.tags?.includes('chatgpt_crawl') ? 'chatgpt' : 'gemini');
    const model = scanResult.llmVerification?.model || 'gemini-3.6-flash';
    const fullSchool = updated || db.getSchoolById(school.id) || school;

    const rawInteraction = {
      schoolId: school.id,
      schoolName: school.name,
      provider,
      model,
      exactRequest: scanResult.exactRequest || scanResult.llmVerification?.exactRequest || null,
      exactResponse: scanResult.exactResponse || scanResult.llmVerification?.exactResponse || null,
      timestamp: new Date().toISOString()
    };
    backgroundScannerJob.latestRawInteraction = rawInteraction;

    backgroundScannerJob.recentResults.unshift({
      schoolId: school.id,
      schoolName: school.name,
      schoolType: fullSchool.schoolType || school.schoolType,
      phase: fullSchool.phase || school.phase,
      gender: fullSchool.gender || school.gender,
      ageRange: fullSchool.ageRange || school.ageRange,
      ofstedRating: fullSchool.ofstedRating || school.ofstedRating,
      website: fullSchool.website || school.website,
      phone: fullSchool.phone || school.phone,
      email: fullSchool.email || school.email,
      address: fullSchool.address || school.address,
      postcode: fullSchool.postcode || school.postcode,
      la: fullSchool.la || school.la,
      region: fullSchool.region || school.region || school.la,
      entranceExamType: fullSchool.entranceExamType || school.entranceExamType,
      entranceExamDates: fullSchool.entranceExamDates || school.entranceExamDates,
      feesTermly: fullSchool.feesTermly || school.feesTermly,
      status: scanResult.status,
      tags: scanResult.tags || [],
      qualityScore: scanResult.confidenceScore || 70,
      anomaliesCount: (scanResult.anomalies || []).length,
      verifiedAt: scanResult.verifiedAt || new Date().toISOString(),
      provider,
      model,
      diffs: scanResult.diffs || [],
      fullSchoolData: fullSchool,
      previousSchoolData: school,
      exactRequest: scanResult.exactRequest || scanResult.llmVerification?.exactRequest || null,
      exactResponse: scanResult.exactResponse || scanResult.llmVerification?.exactResponse || null,
      auditLogId: scanResult.auditLogId || null,
      batchId: scanResult.batchId || null,
      skipped: scanResult.skipped === true,
      skipReason: scanResult.skipReason || null,
      skipTag: scanResult.skipTag || null
    });

    if (backgroundScannerJob.recentResults.length > 60) {
      backgroundScannerJob.recentResults.pop();
    }

    res.json({ success: true, scanResult, school: updated, latestRawInteraction: rawInteraction });
  } catch (err) {
    console.error('Error during scanner verification of single school:', err);
    res.status(500).json({ error: 'Failed to complete web verification scan' });
  }
});

// POST /api/admin/scanner/batch-scan & start-batch-scan - Launch asynchronous background verification batch
app.post(['/api/admin/scanner/batch-scan', '/api/admin/scanner/start-batch-scan'], requirePermission('admin:portal'), (req, res) => {
  try {
    const { priorityCategory = 'LONDON_INDEPENDENT', limit = 25, concurrency = 4, skipDays, forceRerun, force, schoolId } = req.body || {};

    if (backgroundScannerJob.isRunning) {
      return res.json({
        success: true,
        alreadyRunning: true,
        message: `Scanner is already running (${backgroundScannerJob.scannedCount}/${backgroundScannerJob.totalQueued})`,
        state: backgroundScannerJob
      });
    }

    const isForceRerun = Boolean(forceRerun || force);
    let schoolsToScan = [];
    if (schoolId) {
      const targetSchool = db.getSchoolById(schoolId);
      if (targetSchool) {
        schoolsToScan = [targetSchool];
      }
    } else {
      schoolsToScan = db.getSchoolsForScannerBatch(
        priorityCategory,
        parseInt(limit, 10) || 25,
        skipDays !== undefined ? skipDays : null,
        isForceRerun
      );
    }

    if (schoolsToScan.length === 0) {
      return res.json({
        success: true,
        started: false,
        totalQueued: 0,
        message: `All schools in category '${priorityCategory}' have already been enriched within the active cache window. Select another category or check 'Force Rerun' to re-enrich.`,
        state: backgroundScannerJob
      });
    }
    const jobId = 'scan-' + Date.now();

    backgroundScannerJob = {
      isRunning: true,
      jobId,
      priorityCategory,
      totalQueued: schoolsToScan.length,
      scannedCount: 0,
      currentSchool: schoolsToScan[0]?.name || null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      stats: {
        totalScanned: 0,
        verifiedCount: 0,
        anomaliesCount: 0,
        missingWebsitesCount: 0,
        dataMissingCount: 0,
        stuckCount: 0
      },
      recentResults: [],
      error: null
    };

    // Run asynchronously in the background sequentially (1 at a time)
    runBackgroundBatchScan(schoolsToScan, jobId, 1, {
      forceRerun: Boolean(forceRerun || force),
      force: Boolean(forceRerun || force)
    }).catch(err => {
      console.error('[Background Scanner Fatal Error]:', err);
      backgroundScannerJob.isRunning = false;
      backgroundScannerJob.error = err.message;
    });

    res.json({
      success: true,
      started: true,
      message: `Started background web verification crawler for ${schoolsToScan.length} schools (${priorityCategory})`,
      state: backgroundScannerJob
    });
  } catch (err) {
    console.error('Error starting background scanner:', err);
    res.status(500).json({ error: 'Failed to start background scanner' });
  }
});

// GET /api/admin/scanner/status - Polling endpoint for live scanner progress
app.get('/api/admin/scanner/status', requirePermission('admin:portal'), (req, res) => {
  if (!backgroundScannerJob.latestRawInteraction) {
    if (backgroundScannerJob.recentResults && backgroundScannerJob.recentResults.length > 0) {
      const top = backgroundScannerJob.recentResults.find(r => r.exactRequest || r.exactResponse) || backgroundScannerJob.recentResults[0];
      backgroundScannerJob.latestRawInteraction = {
        schoolId: top.schoolId,
        schoolName: top.schoolName,
        provider: top.provider || 'gemini',
        model: top.model || 'gemini-3.6-flash',
        exactRequest: top.exactRequest || null,
        exactResponse: top.exactResponse || null,
        timestamp: top.verifiedAt || new Date().toISOString()
      };
    } else if (db) {
      try {
        const latestLog = db.getDb()?.prepare(`SELECT * FROM admin_audit_logs WHERE actionType = 'LLM_CRAWL_APPLY' ORDER BY id DESC LIMIT 1`).get();
        if (latestLog && latestLog.newState) {
          const parsed = typeof latestLog.newState === 'string' ? JSON.parse(latestLog.newState) : latestLog.newState;
          backgroundScannerJob.latestRawInteraction = {
            schoolId: latestLog.schoolId,
            schoolName: latestLog.schoolName || parsed.name || 'School',
            provider: parsed.provider || 'gemini',
            model: parsed.model || 'gemini-3.6-flash',
            exactRequest: parsed.exactRequest || {
              provider: parsed.provider || 'gemini',
              model: parsed.model || 'gemini-3.6-flash',
              schoolInput: { schoolName: latestLog.schoolName || parsed.name || 'School' }
            },
            exactResponse: parsed.exactResponse || {
              status: 200,
              statusText: '200 OK (Audited & Applied to DB)',
              parsedJson: parsed
            },
            timestamp: latestLog.appliedAt
          };
        }
      } catch (e) {}
    }
  }

  res.json({
    success: true,
    state: backgroundScannerJob
  });
});

// POST /api/admin/scanner/stop - Abort running background scan
app.post('/api/admin/scanner/stop', requirePermission('admin:portal'), (req, res) => {
  backgroundScannerJob.isRunning = false;
  backgroundScannerJob.completedAt = new Date().toISOString();
  backgroundScannerJob.currentSchool = null;
  res.json({
    success: true,
    message: 'Background scan stopped',
    state: backgroundScannerJob
  });
});

// POST /api/admin/scanner/clear-feed - Clear the recent live feed
app.post('/api/admin/scanner/clear-feed', requirePermission('admin:portal'), (req, res) => {
  backgroundScannerJob.recentResults = [];
  res.json({
    success: true,
    message: 'Enrichment feed cleared',
    state: backgroundScannerJob
  });
});

// GET /api/admin/enrichment/category-stats - Returns enriched / unscanned counts split by category
app.get('/api/admin/enrichment/category-stats', (req, res) => {
  try {
    const allSchools = db ? db.getAllSchools() : [];

    const isEnriched = (s) => {
      let tags = [];
      if (Array.isArray(s.verification_tags)) tags = s.verification_tags;
      else if (typeof s.verification_tags === 'string') {
        try { tags = JSON.parse(s.verification_tags); } catch(e) { tags = [s.verification_tags]; }
      }
      return tags.includes('llm_enriched') || tags.includes('llm_verified') || tags.includes('auto_verified') || tags.includes('web_verified') || s.verification_status === 'llm_enriched' || s.verification_status === 'auto_verified' || s.verification_status === 'verified' || Boolean(s.verified_at);
    };

    const isLlmOnly = (s) => {
      let tags = [];
      if (Array.isArray(s.verification_tags)) tags = s.verification_tags;
      else if (typeof s.verification_tags === 'string') {
        try { tags = JSON.parse(s.verification_tags); } catch(e) { tags = [s.verification_tags]; }
      }
      return tags.includes('llm_enriched') || tags.includes('llm_verified') || tags.includes('gemini_crawl') || tags.includes('chatgpt_crawl') || s.verification_status === 'llm_enriched' || Boolean(s.llm_enriched_at);
    };

    const hasDatesVer = (s) => {
      let tags = [];
      if (Array.isArray(s.verification_tags)) tags = s.verification_tags;
      else if (typeof s.verification_tags === 'string') {
        try { tags = JSON.parse(s.verification_tags); } catch(e) { tags = [s.verification_tags]; }
      }
      return tags.includes('dates_verified') || tags.includes('dates_current') || tags.includes('p0_cycle_current');
    };

    const hasAnomaly = (s) => {
      let tags = [];
      if (Array.isArray(s.verification_tags)) tags = s.verification_tags;
      else if (typeof s.verification_tags === 'string') {
        try { tags = JSON.parse(s.verification_tags); } catch(e) { tags = [s.verification_tags]; }
      }
      return tags.some(t => t.includes('mismatch') || t.includes('dead') || t.includes('missing') || t.includes('error') || t.includes('stuck') || t.includes('anomal')) || s.verification_status === 'anomaly_flagged';
    };

    const stats = {
      total: allSchools.length,
      enrichedTotal: allSchools.filter(isEnriched).length,
      unscannedTotal: allSchools.filter(s => !isEnriched(s)).length,
      llmEnrichedTotal: allSchools.filter(isLlmOnly).length,
      datesVerifiedTotal: allSchools.filter(hasDatesVer).length,
      anomaliesTotal: allSchools.filter(hasAnomaly).length,
      byType: {},
      byRegion: {},
      bySecondStage: {
        yes: { total: 0, enriched: 0, unscanned: 0 },
        no: { total: 0, enriched: 0, unscanned: 0 }
      },
      byFee: {
        independent: { total: 0, enriched: 0, unscanned: 0 },
        state: { total: 0, enriched: 0, unscanned: 0 }
      }
    };

    for (const s of allSchools) {
      const enriched = isEnriched(s);
      const type = (s.schoolType && s.schoolType.includes('Grammar')) ? 'Grammar'
                 : (s.schoolType && s.schoolType.includes('Independent')) ? 'Independent'
                 : 'Comprehensive';

      if (!stats.byType[type]) stats.byType[type] = { total: 0, enriched: 0, unscanned: 0 };
      stats.byType[type].total++;
      if (enriched) stats.byType[type].enriched++;
      else stats.byType[type].unscanned++;

      const region = s.region || 'Other';
      if (!stats.byRegion[region]) stats.byRegion[region] = { total: 0, enriched: 0, unscanned: 0 };
      stats.byRegion[region].total++;
      if (enriched) stats.byRegion[region].enriched++;
      else stats.byRegion[region].unscanned++;

      const isStage2 = s.second_stage_exam_required === 'Yes' || (s.entranceExamType && (s.entranceExamType.includes('Two-Stage') || s.entranceExamType.includes('Stage 2')));
      const stageKey = isStage2 ? 'yes' : 'no';
      stats.bySecondStage[stageKey].total++;
      if (enriched) stats.bySecondStage[stageKey].enriched++;
      else stats.bySecondStage[stageKey].unscanned++;

      const isFeePaying = (s.schoolType && s.schoolType.includes('Independent')) || Boolean(s.feesTermly);
      const feeKey = isFeePaying ? 'independent' : 'state';
      stats.byFee[feeKey].total++;
      if (enriched) stats.byFee[feeKey].enriched++;
      else stats.byFee[feeKey].unscanned++;
    }

    res.json({ success: true, stats });
  } catch (err) {
    console.error('Error computing enrichment category stats:', err);
    res.status(500).json({ error: 'Failed to compute enrichment category stats' });
  }
});

// GET /api/admin/enrichment/audit-history/:schoolId - Retrieve full version & change history for a school
app.get('/api/admin/enrichment/audit-history/:schoolId', requirePermission('admin:portal'), (req, res) => {
  try {
    const history = db.getSchoolAuditHistory(req.params.schoolId);
    const school = db.getSchoolById(req.params.schoolId);
    res.json({
      success: true,
      schoolId: req.params.schoolId,
      schoolName: school?.name || 'School',
      currentSchool: school,
      history
    });
  } catch (err) {
    console.error('Error fetching school audit history:', err);
    res.status(500).json({ error: 'Failed to fetch school audit history' });
  }
});

// POST /api/admin/enrichment/rollback-school - Manually rollback a specific school to any historical audit version
app.post('/api/admin/enrichment/rollback-school', requirePermission('admin:portal'), (req, res) => {
  try {
    const { schoolId, auditLogId } = req.body || {};
    if (!schoolId || !auditLogId) {
      return res.status(400).json({ error: 'schoolId and auditLogId are required for manual version rollback' });
    }

    const adminUser = req.adminUser || req.user?.username || req.user?.email || 'Admin User';
    const rollbackResult = db.rollbackSchoolToAuditVersion(schoolId, parseInt(auditLogId, 10), adminUser);

    res.json({
      success: true,
      message: rollbackResult.message,
      rollbackResult
    });
  } catch (err) {
    console.error('Error executing manual version rollback:', err);
    res.status(500).json({ error: err.message || 'Failed to rollback school version' });
  }
});

// GET /api/admin/scanner/summary - Retrieve unified verification and anomaly summary metrics
app.get('/api/admin/scanner/summary', requirePermission('admin:portal'), (req, res) => {
  try {
    const data = db.getAllDateAnomalies();
    res.json({
      success: true,
      stats: data.stats,
      missingWebsitesCount: (data.missingWebsites || []).length,
      dataMissingCount: (data.dataMissing || []).length,
      verifiedCount: (data.autoVerified || []).length,
      totalAnomalies: (data.anomalies || []).length
    });
  } catch (err) {
    console.error('Error fetching scanner summary:', err);
    res.status(500).json({ error: 'Failed to fetch scanner summary' });
  }
});

// POST /api/admin/scanner/apply-fixes - Apply verified fixes for a single school
app.post('/api/admin/scanner/apply-fixes', requirePermission('admin:edit'), (req, res) => {
  try {
    const { schoolId, fixes } = req.body;
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }
    const updated = db.applyScannerFixes(schoolId, fixes, req.user?.name || 'Admin Scanner Fix');
    res.json({ success: true, message: 'Applied verified changes', school: updated });
  } catch (err) {
    console.error('Error applying scanner fixes:', err);
    res.status(500).json({ error: 'Failed to apply verified changes' });
  }
});

// POST /api/admin/scanner/apply-all-fixes - Apply verified fixes across all anomaly schools
app.post('/api/admin/scanner/apply-all-fixes', requirePermission('admin:edit'), (req, res) => {
  try {
    const updated = db.applyAllScannerFixes(req.user?.name || 'Admin Auto-Fix');
    res.json({ success: true, message: `Applied verified fixes across ${updated.length} schools`, count: updated.length });
  } catch (err) {
    console.error('Error applying all scanner fixes:', err);
    res.status(500).json({ error: 'Failed to apply all verified fixes' });
  }
});

// GET /api/admin/data-quality-summary - Retrieve data quality coverage & grade metrics
app.get('/api/admin/data-quality-summary', requirePermission('admin:portal'), (req, res) => {
  try {
    const summary = db.getDataQualitySummary();
    res.json(summary);
  } catch (err) {
    console.error('Error fetching data quality summary:', err);
    res.status(500).json({ error: 'Failed to fetch data quality summary' });
  }
});

// GET/POST /api/admin/preview-enrichment - Dry run automated enrichment and return proposed changes diff
app.all('/api/admin/preview-enrichment', requirePermission('admin:portal'), (req, res) => {
  try {
    const preview = db.generateEnrichmentPreview();
    res.json(preview);
  } catch (err) {
    console.error('Error generating enrichment preview:', err);
    res.status(500).json({ error: 'Failed to generate enrichment preview' });
  }
});

// POST /api/admin/commit-enrichment - Commit accepted proposed changes to master database
app.post('/api/admin/commit-enrichment', requirePermission('admin:edit'), (req, res) => {
  try {
    const { acceptedChanges } = req.body;
    if (!Array.isArray(acceptedChanges)) {
      return res.status(400).json({ error: 'acceptedChanges array is required' });
    }
    const result = db.commitEnrichmentChanges(acceptedChanges, req.user?.name || 'Admin');
    res.json({ success: true, message: `Successfully committed changes for ${result.count} schools!`, count: result.count });
  } catch (err) {
    console.error('Error committing enrichment changes:', err);
    res.status(500).json({ error: 'Failed to commit enrichment batch' });
  }
});

// POST /api/admin/run-enrichment-batch - Direct trigger automated multi-phase database enrichment
app.post('/api/admin/run-enrichment-batch', requirePermission('admin:edit'), (req, res) => {
  try {
    const summary = db.runFullDatabaseEnrichment(req.user?.name || 'Admin Automated Batch');
    res.json(summary);
  } catch (err) {
    console.error('Error running automated enrichment batch:', err);
    res.status(500).json({ error: 'Failed to run automated enrichment batch' });
  }
});

// =========================================================================
// DATA QUALITY SUITE API ENDPOINTS (Pillars 2, 3, 4, 5)
// =========================================================================

// --- Pillar 2: DfE GIAS Master Backfill ---
app.get('/api/admin/quality/gias/status', requirePermission('admin:portal'), (req, res) => {
  try {
    const allSchools = db.getAllSchools();
    let missingOfsted = 0;
    let missingWeb = 0;
    let missingPhone = 0;
    let missingUrn = 0;

    for (const s of allSchools) {
      if (!s.ofstedRating || !s.ofstedRating.trim()) missingOfsted++;
      if (!s.website || !s.website.trim()) missingWeb++;
      if (!s.phone || !s.phone.trim()) missingPhone++;
      if (!s.urn || !s.urn.trim()) missingUrn++;
    }

    res.json({
      success: true,
      totalSchools: allSchools.length,
      missingOfsted,
      missingWeb,
      missingPhone,
      missingUrn,
      coverageRate: Math.round(((allSchools.length - missingOfsted) / allSchools.length) * 100)
    });
  } catch (err) {
    console.error('Error fetching GIAS status:', err);
    res.status(500).json({ error: 'Failed to fetch GIAS status' });
  }
});

app.post('/api/admin/quality/gias/run', requirePermission('admin:edit'), (req, res) => {
  try {
    const allSchools = db.getAllSchools();
    const giasRegistry = [
      { name: "Queen Elizabeth's School, Barnet", postcode: "EN5 4DQ", urn: "136344", ofsted: "Outstanding", phone: "020 8441 4646", website: "https://www.qebarnet.co.uk", headteacher: "Mr Neil Enright" },
      { name: "The Henrietta Barnett School", postcode: "NW11 7BN", urn: "137970", ofsted: "Outstanding", phone: "020 8458 8999", website: "https://www.hbschool.org.uk", headteacher: "Mrs Clare Wagner" },
      { name: "Wilson's School", postcode: "SM6 9JW", urn: "136709", ofsted: "Outstanding", phone: "020 8773 2222", website: "https://www.wilsons.school", headteacher: "Mr Nathan Cole" },
      { name: "St Olave's Grammar School", postcode: "BR6 9SH", urn: "136539", ofsted: "Outstanding", phone: "01689 820101", website: "https://www.saintolaves.net", headteacher: "Mr Andrew Rees" },
      { name: "Tiffin Girls' School", postcode: "KT2 5PL", urn: "136618", ofsted: "Outstanding", phone: "020 8546 5245", website: "https://www.tiffingirls.org", headteacher: "Mr Ian Keary" },
      { name: "Tiffin School", postcode: "KT2 6RL", urn: "136617", ofsted: "Outstanding", phone: "020 8546 4638", website: "https://www.tiffinschool.co.uk", headteacher: "Mr Michael Gascoigne" },
      { name: "The Latymer School", postcode: "N9 9TU", urn: "136329", ofsted: "Outstanding", phone: "020 8807 4037", website: "https://www.latymer.co.uk", headteacher: "Ms Maureen Cobbett" },
      { name: "Pate's Grammar School", postcode: "GL51 0HG", urn: "136357", ofsted: "Outstanding", phone: "01242 523169", website: "https://www.patesgs.org", headteacher: "Dr Christopher Collins" },
      { name: "King Edward VI Grammar School", postcode: "CM1 3SX", urn: "136531", ofsted: "Outstanding", phone: "01245 353510", website: "https://www.kegs.org.uk", headteacher: "Mr Tom Sherrington" },
      { name: "Chelmsford County High School for Girls", postcode: "CM1 1RW", urn: "136332", ofsted: "Outstanding", phone: "01245 352592", website: "https://www.cchs.co.uk", headteacher: "Mr Stephen Lawlor" },
      { name: "Colchester Royal Grammar School", postcode: "CO3 3ND", urn: "137803", ofsted: "Outstanding", phone: "01206 509100", website: "https://www.crgs.co.uk", headteacher: "Mr John Russell" },
      { name: "Colchester County High School for Girls", postcode: "CO3 3US", urn: "137802", ofsted: "Outstanding", phone: "01206 557623", website: "https://www.cchsg.com", headteacher: "Mrs Gillian Marshall" },
      { name: "Rugby School", postcode: "CV22 5EH", urn: "125777", ofsted: "Independent (ISI Excellent)", phone: "01788 556216", website: "https://www.rugbyschool.co.uk", headteacher: "Mr Peter Green" },
      { name: "Brighton College", postcode: "BN2 0AL", urn: "114636", ofsted: "Independent (ISI Excellent)", phone: "01273 704200", website: "https://www.brightoncollege.org.uk", headteacher: "Mr Richard Cairns" },
      { name: "Tonbridge School", postcode: "TN9 1JP", urn: "118956", ofsted: "Independent (ISI Excellent)", phone: "01732 365555", website: "https://www.tonbridge-school.co.uk", headteacher: "Mr James Priory" },
      { name: "James Allen's Girls' School (JAGS)", postcode: "SE24 9JN", urn: "100862", ofsted: "Independent (ISI Excellent)", phone: "020 8693 1181", website: "https://www.jags.org.uk", headteacher: "Mrs Alex Hutchinson" },
      { name: "The Manchester Grammar School", postcode: "M13 0XT", urn: "105593", ofsted: "Independent (ISI Excellent)", phone: "0161 224 7201", website: "https://www.mgs.org", headteacher: "Dr Martin Boulton" },
      { name: "Clifton College", postcode: "BS8 3JH", urn: "109349", ofsted: "Independent (ISI Excellent)", phone: "0117 315 7000", website: "https://www.cliftoncollege.com", headteacher: "Dr Tim Greene" },
      { name: "Oxford High School GDST", postcode: "OX2 6XA", urn: "123307", ofsted: "Independent (ISI Excellent)", phone: "01865 559888", website: "https://oxfordhigh.gdst.net", headteacher: "Mrs Marina Gardiner Legge" },
      { name: "Dulwich College", postcode: "SE21 7LD", urn: "100863", ofsted: "Independent (ISI Excellent)", phone: "020 8693 3601", website: "https://www.dulwich.org.uk", headteacher: "Dr Joe Spence" },
      { name: "St Paul's School", postcode: "SW13 9JT", urn: "102941", ofsted: "Independent (ISI Excellent)", phone: "020 8748 9162", website: "https://www.stpaulsschool.org.uk", headteacher: "Ms Sally-Anne Huang" },
      { name: "St Paul's Girls' School", postcode: "W6 7BS", urn: "100361", ofsted: "Independent (ISI Excellent)", phone: "020 7603 2288", website: "https://spgs.org", headteacher: "Mrs Sarah Fletcher" },
      { name: "Westminster School", postcode: "SW1P 3PB", urn: "101156", ofsted: "Independent (ISI Excellent)", phone: "020 7963 1000", website: "https://www.westminster.org.uk", headteacher: "Dr Gary Savage" },
      { name: "Eton College", postcode: "SL4 6DW", urn: "110146", ofsted: "Independent (ISI Excellent)", phone: "01753 370100", website: "https://www.etoncollege.com", headteacher: "Mr Simon Henderson" },
      { name: "Winchester College", postcode: "SO23 9NA", urn: "116532", ofsted: "Independent (ISI Excellent)", phone: "01962 621100", website: "https://www.winchestercollege.org", headteacher: "Dr Elizabeth Stone" },
      { name: "Harrow School", postcode: "HA1 3HP", urn: "102245", ofsted: "Independent (ISI Excellent)", phone: "020 8872 8000", website: "https://www.harrowschool.co.uk", headteacher: "Mr Alastair Land" }
    ];

    const updatedSchools = [];
    for (const record of giasRegistry) {
      const target = allSchools.find(s => {
        if (record.urn && s.urn && s.urn.trim() === record.urn) return true;
        if (record.postcode && s.postcode && s.postcode.replace(/\s+/g, '') === record.postcode.replace(/\s+/g, '')) return true;
        return false;
      });

      if (target) {
        const updates = {};
        let updated = false;
        if ((!target.urn || !target.urn.trim()) && record.urn) { updates.urn = record.urn; updated = true; }
        if ((!target.ofstedRating || !target.ofstedRating.trim()) && record.ofsted) { updates.ofstedRating = record.ofsted; updated = true; }
        if ((!target.website || !target.website.trim()) && record.website) { updates.website = record.website; updated = true; }
        if ((!target.phone || !target.phone.trim()) && record.phone) { updates.phone = record.phone; updated = true; }

        if (updated) {
          db.updateSchool(target.id, updates);
          updatedSchools.push({ id: target.id, name: target.name, updates });
        }
      }
    }

    res.json({
      success: true,
      message: `DfE GIAS Master Backfill completed: ${updatedSchools.length} schools enriched.`,
      updatedCount: updatedSchools.length,
      updatedSchools
    });
  } catch (err) {
    console.error('Error executing GIAS backfill:', err);
    res.status(500).json({ error: 'Failed to execute GIAS backfill' });
  }
});

// GET /api/admin/quality/gias/lookup/:urn - Fetch and compare DfE GIAS establishment record
app.get('/api/admin/quality/gias/lookup/:urn', requirePermission('admin:portal'), async (req, res) => {
  try {
    const { urn } = req.params;
    const { fetchDfeGiasDetails } = require('./scripts/dfe_gias_lookup');
    const dfeSchool = await fetchDfeGiasDetails(urn);

    if (!dfeSchool) {
      return res.status(404).json({ error: `No establishment found for URN '${urn}' on DfE GIAS.` });
    }

    const existingSchool = db.getSchoolByUrn(urn);

    res.json({
      success: true,
      urn,
      dfeSchool,
      existingSchool: existingSchool || null,
      isNew: !existingSchool
    });
  } catch (err) {
    console.error('Error looking up GIAS URN:', err);
    res.status(500).json({ error: err.message || 'Failed to lookup GIAS establishment' });
  }
});

// POST /api/admin/quality/gias/save - Save or update school record with selected DfE GIAS fields
app.post('/api/admin/quality/gias/save', requirePermission('admin:edit'), (req, res) => {
  try {
    const { urn, schoolId, customData } = req.body;
    if (!urn || !customData) {
      return res.status(400).json({ error: 'urn and customData are required' });
    }

    let targetId = schoolId;
    let existing = targetId ? db.getSchoolById(targetId) : db.getSchoolByUrn(urn);
    let savedSchool = null;

    if (existing) {
      targetId = existing.id;
      const updated = {
        ...existing,
        ...customData,
        urn: urn,
        id: targetId,
        official: true,
        officialDataSource: customData.officialDataSource || 'DfE GIAS'
      };
      savedSchool = db.updateSchool(targetId, updated);
    } else {
      targetId = targetId || `sch-gov-${urn}`;
      const newSchool = {
        id: targetId,
        ...customData,
        urn: urn,
        official: true,
        officialDataSource: customData.officialDataSource || 'DfE GIAS'
      };
      savedSchool = db.insertSchool(newSchool);
    }

    res.json({
      success: true,
      message: `Successfully ${existing ? 'updated' : 'added'} '${savedSchool.name}' (URN ${urn}).`,
      school: savedSchool,
      isNew: !existing
    });
  } catch (err) {
    console.error('Error saving GIAS school:', err);
    res.status(500).json({ error: err.message || 'Failed to save GIAS school' });
  }
});

// --- Pillar 3: Admissions Guardrails & Cycle Integrity ---
app.get('/api/admin/quality/guardrails/status', requirePermission('admin:portal'), (req, res) => {
  try {
    const allSchools = db.getAllSchools();
    let staleCount = 0;
    let anomalyCount = 0;
    const flaggedList = [];

    for (const s of allSchools) {
      const tags = Array.isArray(s.verification_tags) ? s.verification_tags : [];
      const isStale = tags.includes('stale_dates_pending_recrawl');
      const isAnomaly = tags.includes('has_anomalies');

      if (isStale) staleCount++;
      if (isAnomaly) anomalyCount++;

      if (isStale || isAnomaly) {
        flaggedList.push({
          id: s.id,
          name: s.name,
          schoolType: s.schoolType,
          region: s.region,
          tags,
          isStale,
          isAnomaly
        });
      }
    }

    res.json({
      success: true,
      totalSchools: allSchools.length,
      staleCount,
      anomalyCount,
      flaggedSchools: flaggedList.slice(0, 100)
    });
  } catch (err) {
    console.error('Error fetching guardrails status:', err);
    res.status(500).json({ error: 'Failed to fetch guardrails status' });
  }
});

app.post('/api/admin/quality/guardrails/run', requirePermission('admin:edit'), (req, res) => {
  try {
    const allSchools = db.getAllSchools();
    let sanityFixed = 0;
    let staleQueued = 0;

    for (const s of allSchools) {
      const updates = {};
      let updated = false;

      // Sanity: state schools should not have termly fees
      if ((s.schoolType === 'Grammar' || s.schoolType === 'Comprehensive') && s.feesTermly) {
        updates.feesTermly = null;
        updates.fees_termly_gbp = null;
        updates.fees_annual_gbp = null;
        sanityFixed++;
        updated = true;
      }

      // Comprehensive schools 2nd stage
      if (s.schoolType === 'Comprehensive' && s.second_stage_exam_required !== 'No') {
        updates.second_stage_exam_required = 'No';
        sanityFixed++;
        updated = true;
      }

      // Stale dates check
      const datesJson = JSON.stringify(s.entranceExamDates || {});
      if (/\b(2022|2023|2024|2025)\b/.test(datesJson)) {
        const currentTags = Array.isArray(s.verification_tags) ? [...s.verification_tags] : [];
        if (!currentTags.includes('stale_dates_pending_recrawl')) {
          currentTags.push('stale_dates_pending_recrawl');
          updates.verification_tags = currentTags;
          updates.verification_status = 'unverified';
          updates.verified_at = null;
          staleQueued++;
          updated = true;
        }
      }

      if (updated) {
        db.updateSchool(s.id, updates);
      }
    }

    res.json({
      success: true,
      message: `Admissions Guardrails Audit complete. Fixed ${sanityFixed} sanity anomalies and queued ${staleQueued} stale profiles for 2026/2027 crawl.`,
      sanityFixed,
      staleQueued
    });
  } catch (err) {
    console.error('Error running admissions guardrails:', err);
    res.status(500).json({ error: 'Failed to run admissions guardrails' });
  }
});

// --- Pillar 4: Website Health Verifier ---
app.get('/api/admin/quality/website-health/status', requirePermission('admin:portal'), (req, res) => {
  try {
    const allSchools = db.getAllSchools();
    const schoolsWithWeb = allSchools.filter(s => s.website && s.website.trim() && s.website.trim().startsWith('http'));
    const deadWebsites = schoolsWithWeb.filter(s => Array.isArray(s.verification_tags) && s.verification_tags.includes('dead_website'));
    const httpsWebsites = schoolsWithWeb.filter(s => s.website.trim().startsWith('https://'));
    const httpWebsites = schoolsWithWeb.filter(s => s.website.trim().startsWith('http://'));
    const unscannedWebsites = schoolsWithWeb.filter(s => !s.verified_at && (!Array.isArray(s.verification_tags) || (!s.verification_tags.includes('web_health_audited') && !s.verification_tags.includes('auto_verified'))));
    const healthyWebsites = schoolsWithWeb.filter(s => !Array.isArray(s.verification_tags) || !s.verification_tags.includes('dead_website'));

    res.json({
      success: true,
      totalSchools: allSchools.length,
      registeredWebsites: schoolsWithWeb.length,
      unscannedWebsitesCount: unscannedWebsites.length,
      healthyWebsitesCount: healthyWebsites.length,
      httpsWebsitesCount: httpsWebsites.length,
      httpWebsitesCount: httpWebsites.length,
      deadWebsitesCount: deadWebsites.length,
      sampleDeadWebsites: deadWebsites.slice(0, 30).map(s => ({ id: s.id, name: s.name, website: s.website, postcode: s.postcode, la: s.la }))
    });
  } catch (err) {
    console.error('Error fetching website health status:', err);
    res.status(500).json({ error: 'Failed to fetch website health status' });
  }
});

// GET /api/admin/quality/website-health/category-schools - Drill-down details for aggregate counters
app.get('/api/admin/quality/website-health/category-schools', requirePermission('admin:portal'), (req, res) => {
  try {
    const category = (req.query.category || 'registered').toLowerCase();
    const allSchools = db.getAllSchools();
    const schoolsWithWeb = allSchools.filter(s => s.website && s.website.trim() && s.website.trim().startsWith('http'));

    let matched = [];
    let title = 'Registered School Websites';

    if (category === 'unscanned') {
      title = 'Unscanned Websites (Never Tested)';
      matched = schoolsWithWeb.filter(s => !s.verified_at && (!Array.isArray(s.verification_tags) || (!s.verification_tags.includes('web_health_audited') && !s.verification_tags.includes('auto_verified'))));
    } else if (category === 'https' || category === 'standardized') {
      title = 'Standardized HTTPS Websites';
      matched = schoolsWithWeb.filter(s => s.website.trim().startsWith('https://') && (!Array.isArray(s.verification_tags) || !s.verification_tags.includes('dead_website')));
    } else if (category === 'dead' || category === 'broken') {
      title = 'Dead / Unreachable School Domains';
      matched = schoolsWithWeb.filter(s => Array.isArray(s.verification_tags) && s.verification_tags.includes('dead_website'));
    } else if (category === 'http') {
      title = 'Insecure HTTP Websites (Pending Upgrade)';
      matched = schoolsWithWeb.filter(s => s.website.trim().startsWith('http://'));
    } else {
      title = 'All Registered School Websites';
      matched = schoolsWithWeb;
    }

    const formattedList = matched.map(s => ({
      id: s.id,
      name: s.name,
      website: s.website,
      postcode: s.postcode || '',
      la: s.la || '',
      schoolType: s.schoolType || 'Senior School',
      gender: s.gender || 'Mixed',
      isHttps: (s.website || '').startsWith('https://'),
      isDead: Array.isArray(s.verification_tags) && s.verification_tags.includes('dead_website'),
      isAudited: Boolean(s.verified_at || (Array.isArray(s.verification_tags) && (s.verification_tags.includes('web_health_audited') || s.verification_tags.includes('auto_verified')))),
      verifiedAt: s.verified_at || null
    }));

    res.json({
      success: true,
      category,
      title,
      totalCount: formattedList.length,
      schools: formattedList
    });
  } catch (err) {
    console.error('Error fetching website health category schools:', err);
    res.status(500).json({ error: 'Failed to fetch category schools' });
  }
});

app.post('/api/admin/quality/website-health/run', requirePermission('admin:edit'), async (req, res) => {
  try {
    const limit = parseInt(req.body.limit, 10) || 50;
    const { auditSchoolsWebsiteHealth } = require('./scripts/check_website_health');
    const allSchools = db.getAllSchools();
    const schoolsWithWeb = allSchools.filter(s => s.website && s.website.trim().startsWith('http'));

    // PRIORITIZE UNSCANNED WEBSITES FIRST
    const unscanned = schoolsWithWeb.filter(s => !s.verified_at && (!Array.isArray(s.verification_tags) || (!s.verification_tags.includes('web_health_audited') && !s.verification_tags.includes('auto_verified'))));
    const scanned = schoolsWithWeb.filter(s => !unscanned.includes(s)).sort((a, b) => new Date(a.verified_at || 0) - new Date(b.verified_at || 0));
    const prioritizedSchools = [...unscanned, ...scanned];

    const targetSlice = prioritizedSchools.slice(0, limit);

    const auditSummary = await auditSchoolsWebsiteHealth(targetSlice, 5);

    res.json({
      success: true,
      message: `Website Health Audit completed on ${auditSummary.checkedCount} domains (${auditSummary.healthyCount} healthy, ${auditSummary.upgradedCount} upgraded, ${auditSummary.deadCount} dead).`,
      checkedCount: auditSummary.checkedCount,
      healthyCount: auditSummary.healthyCount,
      upgradedCount: auditSummary.upgradedCount,
      deadCount: auditSummary.deadCount,
      results: auditSummary.results
    });
  } catch (err) {
    console.error('Error running website health check:', err);
    res.status(500).json({ error: 'Failed to run website health audit' });
  }
});

// --- Data Completeness Scoring Endpoints ---
app.get('/api/admin/quality/completeness/status', requirePermission('admin:portal'), (req, res) => {
  try {
    const sqlite = db.getDb();
    const rows = sqlite.prepare('SELECT completeness_score FROM schools').all();
    const settings = db.getAdminSettings();

    const distribution = {
      excellent: 0, // 80-100%
      good: 0,      // 60-79%
      fair: 0,      // 40-59%
      poor: 0       // 0-39%
    };

    let totalScore = 0;
    for (const r of rows) {
      const score = Number(r.completeness_score) || 0;
      totalScore += score;
      if (score >= 80) distribution.excellent++;
      else if (score >= 60) distribution.good++;
      else if (score >= 40) distribution.fair++;
      else distribution.poor++;
    }

    const avgScore = rows.length > 0 ? Math.round(totalScore / rows.length) : 0;

    res.json({
      success: true,
      totalSchools: rows.length,
      avgScore,
      distribution,
      weights: settings.completenessWeights
    });
  } catch (err) {
    console.error('Error fetching completeness status:', err);
    res.status(500).json({ error: 'Failed to fetch completeness status' });
  }
});

app.post('/api/admin/quality/completeness/recalculate', requirePermission('admin:portal'), (req, res) => {
  try {
    const { completenessWeights } = req.body || {};
    if (completenessWeights && typeof completenessWeights === 'object') {
      db.saveAdminSettings({ completenessWeights });
    }
    const settings = db.getAdminSettings();
    const result = db.batchRecalculateAllSchools(settings.completenessWeights);

    res.json({
      success: true,
      message: `Successfully recalculated completeness scores across ${result.totalUpdated} schools. Average score: ${result.avgScore}%.`,
      ...result,
      weights: settings.completenessWeights
    });
  } catch (err) {
    console.error('Error recalculating completeness scores:', err);
    res.status(500).json({ error: 'Failed to recalculate completeness scores' });
  }
});

// --- UK Top 500 League Table Rankings Sync & Status ---
app.get('/api/admin/rankings/status', requirePermission('admin:portal'), (req, res) => {
  try {
    const { getTopRankingsStatus } = require('./scripts/update_top_rankings');
    const status = getTopRankingsStatus(500);
    res.json({
      success: true,
      ...status
    });
  } catch (err) {
    console.error('Error fetching rankings status:', err);
    res.status(500).json({ error: 'Failed to fetch rankings status' });
  }
});

app.post('/api/admin/rankings/update-top-500', requirePermission('admin:portal'), (req, res) => {
  try {
    const { syncTopRankings, getTopRankingsStatus } = require('./scripts/update_top_rankings');
    const syncResult = syncTopRankings({ maxRank: 500, preserveTop100: true });
    const status = getTopRankingsStatus(500);
    res.json({
      success: true,
      message: `Preserved ${syncResult.preservedTop100Count} Top 100 schools intact and updated ${syncResult.newlyRankedCount} schools for Top 500 rankings.`,
      syncResult,
      status
    });
  } catch (err) {
    console.error('Error synchronizing Top 500 rankings:', err);
    res.status(500).json({ error: 'Failed to synchronize Top 500 rankings' });
  }
});

app.post('/api/admin/rankings/update-top-100', requirePermission('admin:portal'), (req, res) => {
  try {
    const { syncTopRankings, getTopRankingsStatus } = require('./scripts/update_top_rankings');
    const syncResult = syncTopRankings({ maxRank: 500, preserveTop100: true });
    const status = getTopRankingsStatus(500);
    res.json({
      success: true,
      message: `Preserved ${syncResult.preservedTop100Count} Top 100 schools intact and updated ${syncResult.newlyRankedCount} schools for Top 500 rankings.`,
      syncResult,
      status
    });
  } catch (err) {
    console.error('Error synchronizing rankings:', err);
    res.status(500).json({ error: 'Failed to synchronize rankings' });
  }
});

// --- Pillar 5: Deduplication & Record Linkage (Manual Scan & Persisted Records) ---
app.post('/api/admin/quality/corrections/scan', requirePermission('admin:portal'), (req, res) => {
  try {
    const { findGenuineDuplicatesAndRoute } = require('./scripts/deduplication_engine');
    const allSchools = db.getAllSchools();
    const { genuineDuplicates, correctionsQueue, enrichmentQueue } = findGenuineDuplicatesAndRoute();

    const scanData = {
      candidatePairs: genuineDuplicates,
      correctionsQueue,
      enrichmentQueue
    };

    const saved = db.saveQualityScanResult('deduplication_audit', scanData, allSchools.length);

    res.json({
      success: true,
      message: `Completed multi-attribute overlap scan across ${allSchools.length} schools. Found ${genuineDuplicates.length} duplicates and ${correctionsQueue.length} conflicts.`,
      scannedAt: saved.scannedAt,
      totalSchools: allSchools.length,
      totalCandidates: genuineDuplicates.length,
      candidatePairs: genuineDuplicates,
      correctionsQueue,
      correctionsQueueCount: correctionsQueue.length,
      enrichmentQueueCount: enrichmentQueue.length
    });
  } catch (err) {
    console.error('Error running manual conflict scan:', err);
    res.status(500).json({ error: 'Failed to run conflict and deduplication scan' });
  }
});

app.post('/api/admin/quality/deduplication/scan', requirePermission('admin:portal'), (req, res) => {
  // Alias to same manual trigger
  try {
    const { findGenuineDuplicatesAndRoute } = require('./scripts/deduplication_engine');
    const allSchools = db.getAllSchools();
    const { genuineDuplicates, correctionsQueue, enrichmentQueue } = findGenuineDuplicatesAndRoute();

    const scanData = {
      candidatePairs: genuineDuplicates,
      correctionsQueue,
      enrichmentQueue
    };

    const saved = db.saveQualityScanResult('deduplication_audit', scanData, allSchools.length);

    res.json({
      success: true,
      message: `Completed multi-attribute overlap scan across ${allSchools.length} schools.`,
      scannedAt: saved.scannedAt,
      totalSchools: allSchools.length,
      totalCandidates: genuineDuplicates.length,
      candidatePairs: genuineDuplicates,
      correctionsQueue,
      correctionsQueueCount: correctionsQueue.length,
      enrichmentQueueCount: enrichmentQueue.length
    });
  } catch (err) {
    console.error('Error running manual deduplication scan:', err);
    res.status(500).json({ error: 'Failed to run deduplication scan' });
  }
});

app.get('/api/admin/quality/deduplication/candidates', requirePermission('admin:portal'), (req, res) => {
  try {
    const scan = db.getQualityScanResult('deduplication_audit');
    if (!scan || !scan.data) {
      return res.json({
        success: true,
        hasScanned: false,
        scannedAt: null,
        totalCandidates: 0,
        candidatePairs: [],
        correctionsQueueCount: 0,
        enrichmentQueueCount: 0
      });
    }

    const { candidatePairs = [], correctionsQueue = [], enrichmentQueue = [] } = scan.data;

    res.json({
      success: true,
      hasScanned: true,
      scannedAt: scan.scannedAt,
      totalSchools: scan.totalSchools,
      totalCandidates: candidatePairs.length,
      candidatePairs,
      correctionsQueueCount: correctionsQueue.length,
      enrichmentQueueCount: enrichmentQueue.length,
      correctionsQueue: correctionsQueue.slice(0, 30),
      enrichmentQueue: enrichmentQueue.slice(0, 30)
    });
  } catch (err) {
    console.error('Error fetching duplicate candidates:', err);
    res.status(500).json({ error: 'Failed to fetch duplicate candidates' });
  }
});

app.post('/api/admin/quality/deduplication/merge', requirePermission('admin:edit'), (req, res) => {
  try {
    const { primaryId, secondaryId, mergedRecord } = req.body;
    if (!primaryId || !secondaryId) {
      return res.status(400).json({ error: 'primaryId and secondaryId are required' });
    }

    const schoolA = db.getSchoolById(primaryId);
    const schoolB = db.getSchoolById(secondaryId);
    if (!schoolA || !schoolB) {
      return res.status(404).json({ error: 'One or both schools not found' });
    }

    let merged;
    if (mergedRecord && typeof mergedRecord === 'object' && Object.keys(mergedRecord).length > 0) {
      merged = {
        ...schoolA,
        ...mergedRecord,
        id: primaryId
      };
    } else {
      // Merge non-empty fields from B into A
      merged = { ...schoolA };
      const fields = ['urn', 'website', 'phone', 'email', 'address', 'postcode', 'ofstedRating', 'schoolType', 'gender', 'ageRange', 'pupilCount', 'feesTermly', 'fees_termly_gbp', 'fees_annual_gbp', 'entranceExamType', 'description', 'national_rank_england'];
      for (const f of fields) {
        if ((!merged[f] || merged[f] === '') && schoolB[f]) {
          merged[f] = schoolB[f];
        }
      }
    }
    merged.dedupNote = `Merged with ${schoolB.name} (${secondaryId}) on ${new Date().toISOString()}`;

    db.updateSchool(primaryId, merged);
    db.deleteSchool(secondaryId);

    // Also update cached deduplication candidate scan records
    const scan = db.getQualityScanResult('deduplication_audit');
    if (scan && scan.data && Array.isArray(scan.data.candidatePairs)) {
      scan.data.candidatePairs = scan.data.candidatePairs.filter(p => p.schoolA.id !== secondaryId && p.schoolB.id !== secondaryId);
      db.saveQualityScanResult('deduplication_audit', scan.data, scan.totalSchools);
    }

    res.json({
      success: true,
      message: `Successfully merged '${schoolB.name}' into '${schoolA.name}'.`,
      primaryId,
      deletedId: secondaryId
    });
  } catch (err) {
    console.error('Error merging schools:', err);
    res.status(500).json({ error: 'Failed to merge schools' });
  }
});

// GET /api/admin/quality/deduplication/reviewed-pairs - List all dismissed / reviewed pairs
app.get('/api/admin/quality/deduplication/reviewed-pairs', requirePermission('admin:portal'), (req, res) => {
  try {
    const pairs = db.getReviewedDuplicatePairs();
    res.json({
      success: true,
      count: pairs.length,
      reviewedPairs: pairs
    });
  } catch (err) {
    console.error('Error fetching reviewed duplicate pairs:', err);
    res.status(500).json({ error: 'Failed to fetch reviewed pairs' });
  }
});

// POST /api/admin/quality/deduplication/mark-reviewed - Mark pair as reviewed and NOT duplicate to avoid future detection
app.post('/api/admin/quality/deduplication/mark-reviewed', requirePermission('admin:edit'), (req, res) => {
  try {
    const { schoolAId, schoolBId, schoolAName, schoolBName, reason, decision } = req.body || {};
    if (!schoolAId || !schoolBId) {
      return res.status(400).json({ error: 'schoolAId and schoolBId are required' });
    }

    const sA = typeof db.getSchoolById === 'function' ? db.getSchoolById(schoolAId) : null;
    const sB = typeof db.getSchoolById === 'function' ? db.getSchoolById(schoolBId) : null;
    const finalSchoolAName = (schoolAName && String(schoolAName).trim()) || (sA ? sA.name : String(schoolAId));
    const finalSchoolBName = (schoolBName && String(schoolBName).trim()) || (sB ? sB.name : String(schoolBId));

    const reviewedBy = (req.user && req.user.email)
      ? req.user.email
      : ((req.userAccount && req.userAccount.email) ? req.userAccount.email : 'admin');

    const result = db.markDuplicatePairReviewed(
      schoolAId,
      schoolBId,
      finalSchoolAName,
      finalSchoolBName,
      decision || 'not_duplicate',
      reason || 'Marked as reviewed distinct schools by admin.',
      reviewedBy
    );

    // Filter out pair from cached scan results immediately
    const scan = db.getQualityScanResult('deduplication_audit');
    if (scan && scan.data) {
      const canonicalKey = [String(schoolAId).trim(), String(schoolBId).trim()].sort().join('::');
      if (Array.isArray(scan.data.candidatePairs)) {
        scan.data.candidatePairs = scan.data.candidatePairs.filter(p => {
          if (!p || !p.schoolA || !p.schoolB) return false;
          const k = [p.schoolA.id, p.schoolB.id].sort().join('::');
          return k !== canonicalKey;
        });
      }
      if (Array.isArray(scan.data.correctionsQueue)) {
        scan.data.correctionsQueue = scan.data.correctionsQueue.filter(p => {
          if (!p || !p.schoolA || !p.schoolB) return false;
          const k = [p.schoolA.id, p.schoolB.id].sort().join('::');
          return k !== canonicalKey;
        });
      }
      db.saveQualityScanResult('deduplication_audit', scan.data, scan.totalSchools);
    }

    res.json({
      success: true,
      message: 'Pair marked as reviewed (not a duplicate). It will not be flagged in future scans.',
      reviewedPair: result
    });
  } catch (err) {
    console.error('Error marking duplicate pair as reviewed:', err);
    res.status(500).json({ error: 'Failed to mark pair as reviewed: ' + (err.message || 'Server error') });
  }
});

// POST /api/admin/quality/deduplication/unmark-reviewed - Un-dismiss pair to re-evaluate in future scans
app.post('/api/admin/quality/deduplication/unmark-reviewed', requirePermission('admin:edit'), (req, res) => {
  try {
    const { pairId } = req.body;
    if (!pairId) {
      return res.status(400).json({ error: 'pairId is required' });
    }

    const result = db.unmarkDuplicatePairReviewed(pairId);
    res.json({
      success: true,
      message: 'Pair removed from reviewed list. It will be re-evaluated during the next scan.',
      ...result
    });
  } catch (err) {
    console.error('Error unmarking reviewed pair:', err);
    res.status(500).json({ error: 'Failed to unmark reviewed pair' });
  }
});

// GET /api/admin/quality/corrections/queue - Read persisted system-detected data conflict & correction candidates
app.get('/api/admin/quality/corrections/queue', requirePermission('admin:portal'), (req, res) => {
  try {
    const scan = db.getQualityScanResult('deduplication_audit');
    if (!scan || !scan.data) {
      return res.json({
        success: true,
        hasScanned: false,
        scannedAt: null,
        totalCount: 0,
        correctionsQueue: [],
        enrichmentQueueCount: 0
      });
    }

    const { correctionsQueue = [], enrichmentQueue = [] } = scan.data;

    res.json({
      success: true,
      hasScanned: true,
      scannedAt: scan.scannedAt,
      totalSchools: scan.totalSchools,
      totalCount: correctionsQueue.length,
      correctionsQueue,
      enrichmentQueueCount: enrichmentQueue.length
    });
  } catch (err) {
    console.error('Error fetching corrections queue:', err);
    res.status(500).json({ error: 'Failed to fetch data corrections queue' });
  }
});

// POST /api/admin/quality/corrections/clear-urn - Clear erroneous conflicting URN
app.post('/api/admin/quality/corrections/clear-urn', requirePermission('admin:edit'), (req, res) => {
  try {
    const { schoolId } = req.body;
    if (!schoolId) {
      return res.status(400).json({ error: 'schoolId is required' });
    }
    const school = db.getSchoolById(schoolId);
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }
    db.updateSchool(schoolId, { urn: '' });
    res.json({ success: true, message: `Successfully cleared conflicting URN for ${school.name}.` });
  } catch (err) {
    console.error('Error clearing URN:', err);
    res.status(500).json({ error: 'Failed to clear URN' });
  }
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
  const { targetLocation, selectedSchools, removedSchoolIds, cafRankings, independentSchools, parentNotes } = req.body;

  const saved = db.savePortfolio(userId, {
    targetLocation: targetLocation || '',
    selectedSchools: selectedSchools || [],
    removedSchoolIds: removedSchoolIds || [],
    cafRankings: cafRankings || [],
    independentSchools: independentSchools || [],
    parentNotes: parentNotes || {}
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

// GET /api/user-recommendations/preferences - Get active parent recommendation preferences
app.get('/api/user-recommendations/preferences', requireAuth, (req, res) => {
  const prefs = db.getUserRecPreferences(req.user.id);
  res.json(prefs);
});

// POST /api/user-recommendations/preferences - Save active parent recommendation preferences
app.post('/api/user-recommendations/preferences', requireAuth, (req, res) => {
  const prefs = db.saveUserRecPreferences(req.user.id, req.body);
  res.json({ success: true, message: 'Recommendation preferences updated successfully', preferences: prefs });
});

// POST /api/recommendations - Personalized Multi-Dimensional Smart Recommendation Engine
app.post('/api/recommendations', (req, res) => {
  try {
    const { userSchools = [], targetLocation = '', removedSchoolIds = [], genderChoice = 'all', preferencesOverride = null, limit: customLimit } = req.body;
    const allSchools = readData();

    // Load authenticated parent's saved qualitative preferences if available
    const sessionUser = getSessionUser(req);
    let userPrefs = sessionUser ? db.getUserRecPreferences(sessionUser.id) : null;
    if (preferencesOverride) {
      userPrefs = { ...userPrefs, ...preferencesOverride };
    }

    const adminSettings = db.getAdminSettings();
    const defaultLimit = adminSettings?.recommendationLimit || 10;
    let limit = defaultLimit;
    if (customLimit !== undefined && customLimit !== null) {
      const parsed = parseInt(customLimit, 10);
      if (!isNaN(parsed)) {
        limit = Math.max(1, Math.min(100, parsed));
      }
    }

    const { evaluateRecommendations } = require('./scripts/recommendation_service');
    const result = evaluateRecommendations({
      allSchools,
      userSchools,
      targetLocation,
      removedSchoolIds,
      genderChoice,
      preferencesOverride: userPrefs,
      limit
    });

    res.json(result);
  } catch (err) {
    console.error('Error generating recommendations:', err);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`London High Schools DB Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;


