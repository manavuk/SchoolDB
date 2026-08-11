const fs = require('fs');
const path = require('path');

const SCHOOLS_PATH = path.join(__dirname, '../data/schools.json');
const KPS_PATH = path.join(__dirname, '../data/kps_ind_list.csv');
const PILLAI_PATH = path.join(__dirname, '../data/Pillai_All Schools_Cleaned.csv');

function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false, i = 0;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i+1] === '"') { cur += '"'; i += 2; continue; }
        inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur.trim()); cur = ''; }
      else if (ch === '\n') {
        row.push(cur.trim()); cur = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else cur += ch;
    }
    i++;
  }
  if (cur || row.length) { row.push(cur.trim()); if (row.some(c => c !== '')) rows.push(row); }
  return rows;
}

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return 1;
  if (na.length < 3 || nb.length < 3) return 0;
  const bigrams = s => { const st = new Set(); for (let i = 0; i < s.length - 1; i++) st.add(s.slice(i, i+2)); return st; };
  const sa = bigrams(na), sb = bigrams(nb);
  let inter = 0; sa.forEach(bg => { if (sb.has(bg)) inter++; });
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

const schools = JSON.parse(fs.readFileSync(SCHOOLS_PATH, 'utf8'));

// Explicit mappings for Pillai & KPS names to existing DB IDs
const EXPLICIT_MAP = {
  // Pillai
  "carshalton high school for girls": "sch-csv-805553",
  "caterham school": "sch-385531",
  "channing school": "sch-176528",
  "channing": "sch-176528",
  "city of london school": "sch-025",
  "city of london school for girls (clsg)": "sch-026",
  "city of london": "sch-026",
  "croydon high (gdst)": "sch-385510",
  "dulwich college": "sch-024",
  "epsom college": "sch-385532",
  "eton college": "sch-385539",
  "ewell castle school": "sch-385533",
  "francis holland school, regent's park": "sch-074750",
  "francis holland, nw1": "sch-074750",
  "francis holland school, sloane square": "sch-074751",
  "francis holland, sw1": "sch-074751",
  "greenshaw high (sutton consortium — partially selective)": "sch-csv-805555",
  "hampton school": "sch-385492",
  "harris academy crystal palace": "sch-045",
  "harris academy purley": "sch-csv-805204",
  "harris academy south norwood": "sch-csv-805105",
  "harris academy sutton": "sch-csv-806981",
  "highgate school": "sch-027",
  "highgate": "sch-027",
  "james allen's girls' school (jags)": "sch-176517",
  "jaguar senior school (jags)": "sch-176517",
  "king's college school, wimbledon (kcs)": "sch-074739",
  "kcs wimbledon": "sch-074739",
  "newstead wood school": "sch-041",
  "nonsuch high school for girls (sutton consortium)": "sch-047",
  "queen elizabeth's school, barnet (qe boys)": "sch-csv-805295",
  "reigate grammar school": "sch-385536",
  "riddlesdown collegiate": "sch-csv-806169",
  "royal russell": "sch-385511",
  "sevenoaks school": "sch-517293",
  "south hampstead high school (gdst)": "sch-176520",
  "south hampstead high": "sch-176520",
  "st olave's grammar": "sch-046",
  "st paul's girls' school (spgs)": "sch-021",
  "st paul's girls": "sch-021",
  "st paul's school (boys)": "sch-022",
  "st paul's": "sch-022",
  "sutton grammar (sutton consortium)": "sch-csv-805549",
  "sutton high (gdst)": "sch-385507",
  "the henrietta barnett school": "sch-csv-806130",
  "the tiffin girls' school": "sch-csv-805452",
  "tiffin school (boys)": "sch-csv-805613",
  "trinity school (croydon)": "sch-074767",
  "trinity": "sch-074767",
  "university college school (ucs)": "sch-032",
  "university college school": "sch-032",
  "wallington county grammar school (sutton consortium)": "sch-016",
  "wallington high school for girls (sutton consortium)": "sch-csv-805551",
  "westminster school (senior 13+ & westminster under 11+)": "sch-020",
  "westminster": "sch-020",
  "whitgift school": "sch-031",
  "whitgift": "sch-031",
  "wilson's school (sutton consortium)": "sch-csv-805457",
  "woldingham school": "sch-385538",
  "alleyn's": "sch-176518",
  "alleyn’s": "sch-176518",
  "emanuel": "sch-176525",
  "godolphin & latymer": "sch-176515",
  "latymer upper": "sch-033",
  "leh": "sch-074759",
  "mill hill": "sch-385476",
  "nlcs": "sch-385470",
  "wimbledon high": "sch-176521",
  "haberdashers' aske's boys' school": "sch-385542",
  "haberdashers’ aske’s boys’ school": "sch-385542"
};

function findExistingRecord(name) {
  const key = name.trim().toLowerCase();
  if (EXPLICIT_MAP[key]) {
    const s = schools.find(item => item.id === EXPLICIT_MAP[key]);
    if (s) return s;
  }
  // Try exact name match
  let match = schools.find(s => s.name.toLowerCase() === key);
  if (match) return match;

  // Try high similarity match (>= 0.85)
  let best = null, bestSim = 0;
  schools.forEach(s => {
    const sim = similarity(name, s.name);
    if (sim > bestSim) { bestSim = sim; best = s; }
  });
  if (bestSim >= 0.85) return best;

  return null;
}

let hotCount = 0;
let mergedCount = 0;

// 1. Process KPS CSV
const kpsRows = parseCSV(fs.readFileSync(KPS_PATH, 'utf8'));
const kpsHeaders = kpsRows[0];

kpsRows.slice(1).forEach(r => {
  const schoolName = r[0];
  if (!schoolName) return;

  const target = findExistingRecord(schoolName);
  const kpsData = {
    registrationFee: r[1] || null,
    location: r[2] || null,
    examFormat: r[3] || null,
    assessment: r[4] || null,
    scholarshipsOffered: r[5] || null,
    interviewGroupActivity: r[6] || null,
    registrationCloseDate: r[7] || null,
    firstExamDate: r[8] || null,
    firstExamFormatSubjects: r[9] || null,
    firstStageResult: r[10] || null,
    secondStageExamDate: r[11] || null,
    secondExamFormatSubjects: r[12] || null,
    secondStageResult: r[13] || null,
    interviewsDate: r[14] || null,
    offerDate: r[15] || null,
    offerAcceptByDate: r[16] || null,
    infoLink: r[17] || null,
    registrationCloses: r[18] || null,
    coEd: r[19] || null
  };

  if (target) {
    target.hot = true;
    target.kpsDetails = kpsData;
    if (!target.website && kpsData.infoLink) target.website = kpsData.infoLink;
    mergedCount++;
    hotCount++;
  } else {
    // Add as new school flagged as hot
    const newId = `sch-kps-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const newSchool = {
      id: newId,
      name: schoolName,
      hot: true,
      official: false,
      kpsDetails: kpsData,
      website: kpsData.infoLink || '',
      schoolType: 'Independent',
      gender: kpsData.coEd === 'Yes' ? 'Mixed' : 'Single Sex',
      ofstedRating: 'Good',
      entranceExamType: kpsData.examFormat || 'Standard Assessment',
      entranceExamDates: {
        registrationDeadline: kpsData.registrationCloseDate || kpsData.registrationCloses || null,
        examDate: kpsData.firstExamDate || null,
        resultsDate: kpsData.offerDate || null
      }
    };
    schools.push(newSchool);
    hotCount++;
  }
});

// 2. Process Pillai CSV
const pillaiRows = parseCSV(fs.readFileSync(PILLAI_PATH, 'utf8'));
const pillaiHeaders = pillaiRows[0];

pillaiRows.slice(1).forEach(r => {
  const schoolName = r[0];
  if (!schoolName) return;

  const target = findExistingRecord(schoolName);
  const pillaiData = {
    type: r[1] || null,
    address: r[2] || null,
    gender: r[3] || null,
    registrationStatus: r[4] || null,
    openDayEvening: r[5] || null,
    registrationOpens: r[6] || null,
    registrationDeadline: r[7] || null,
    examBoard: r[8] || null,
    firstExamDate: r[9] || null,
    firstExamSubjects: r[10] || null,
    firstExamResults: r[11] || null,
    secondExamDate: r[12] || null,
    secondExamSubjects: r[13] || null,
    secondExamResults: r[14] || null,
    interview: r[15] || null,
    offersAcceptance: r[16] || null,
    linkForRegistration: r[17] || null,
    sourceUrl: r[18] || null,
    notes: r[19] || null
  };

  if (target) {
    target.hot = true;
    target.pillaiDetails = pillaiData;
    if (pillaiData.registrationDeadline) {
      if (!target.entranceExamDates) target.entranceExamDates = {};
      target.entranceExamDates.registrationDeadline = pillaiData.registrationDeadline;
    }
    if (pillaiData.firstExamDate) {
      if (!target.entranceExamDates) target.entranceExamDates = {};
      target.entranceExamDates.examDate = pillaiData.firstExamDate;
    }
    if (pillaiData.sourceUrl && !target.website) target.website = pillaiData.sourceUrl;
    mergedCount++;
    if (!target.hot) hotCount++;
  } else {
    // Add new school entry
    const newId = `sch-pillai-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const newSchool = {
      id: newId,
      name: schoolName,
      hot: true,
      official: false,
      pillaiDetails: pillaiData,
      address: pillaiData.address || '',
      website: pillaiData.linkForRegistration || pillaiData.sourceUrl || '',
      schoolType: pillaiData.type || 'Independent',
      gender: pillaiData.gender || 'Mixed',
      ofstedRating: 'Good',
      entranceExamType: pillaiData.examBoard || '11+ Entrance Assessment',
      entranceExamDates: {
        registrationOpen: pillaiData.registrationOpens || null,
        registrationDeadline: pillaiData.registrationDeadline || null,
        examDate: pillaiData.firstExamDate || null,
        resultsDate: pillaiData.offersAcceptance || null
      }
    };
    schools.push(newSchool);
    hotCount++;
  }
});

// Save updated schools.json
fs.writeFileSync(SCHOOLS_PATH, JSON.stringify(schools, null, 2));

console.log('Import successful!');
console.log('Merged records updated:', mergedCount);
console.log('Total schools flagged as Hot:', schools.filter(s => s.hot).length);
console.log('Total schools in DB:', schools.length);
