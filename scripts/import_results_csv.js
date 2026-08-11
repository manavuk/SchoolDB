#!/usr/bin/env node
/**
 * import_results_csv.js
 * Parses data/results.csv (official DfE school data) and imports/merges into data/schools.json.
 */

const fs   = require('fs');
const path = require('path');

const CSV_PATH     = path.join(__dirname, '../data/results.csv');
const SCHOOLS_PATH = path.join(__dirname, '../data/schools.json');
const REPORT_PATH  = path.join(__dirname, '../data/import_report.json');

// CSV Parser (handles quoted fields)
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
      } else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(cur.trim()); cur = ''; }
      else if (ch === '\n') {
        row.push(cur.trim()); cur = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else { cur += ch; }
    }
    i++;
  }
  if (cur || row.length) { row.push(cur.trim()); if (row.some(c => c !== '')) rows.push(row); }
  return rows;
}

function mapRow(headers, values) {
  const get = name => { const idx = headers.indexOf(name); return idx >= 0 ? (values[idx] || '').trim() : ''; };

  const urn          = get('URN');
  const name         = get('EstablishmentName');
  const laName       = get('LA (name)');
  const lowAge       = get('StatutoryLowAge');
  const highAge      = get('StatutoryHighAge');
  const postcode     = get('Postcode');
  const street       = get('Street');
  const locality     = get('Locality');
  const address3     = get('Address3');
  const town         = get('Town');
  const county       = get('County (name)');
  const website      = get('SchoolWebsite');
  const phone        = get('TelephoneNum');
  const genderRaw    = get('Gender (name)');
  const typeRaw      = get('TypeOfEstablishment (name)');
  const typeGroup    = get('EstablishmentTypeGroup (name)');
  const pupils       = parseInt(get('NumberOfPupils')) || 0;
  const capacity     = parseInt(get('SchoolCapacity')) || 0;
  const admPolicyRaw = get('AdmissionsPolicy (name)');
  const sixthForm    = get('OfficialSixthForm (name)');
  const boarders     = get('Boarders (name)');
  const relChar      = get('ReligiousCharacter (name)');
  const ukprn        = get('UKPRN');
  const estNum       = get('EstablishmentNumber');
  const laCode       = get('LA (code)');
  const boys         = parseInt(get('NumberOfBoys')) || 0;
  const girls        = parseInt(get('NumberOfGirls')) || 0;
  const fsmPct       = parseFloat(get('PercentageFSM')) || null;
  const headTitle    = get('HeadTitle (name)');
  const headFirst    = get('HeadFirstName');
  const headLast     = get('HeadLastName');
  const headJob      = get('HeadPreferredJobTitle');
  const fedFlag      = get('FederationFlag (name)');
  const feds         = get('Federations (name)');
  const trustFlag    = get('TrustSchoolFlag (name)');
  const trusts       = get('Trusts (name)');
  const sponsors     = get('SchoolSponsors (name)');
  const openDate     = get('OpenDate');
  const closeDate    = get('CloseDate');
  const estStatus    = get('EstablishmentStatus (name)');
  const phaseEd      = get('PhaseOfEducation (name)');
  const easting      = get('Easting');
  const northing     = get('Northing');
  const district     = get('DistrictAdministrative (name)');
  const ward         = get('AdministrativeWard (name)');
  const constituency = get('ParliamentaryConstituency (name)');
  const gssLACode    = get('GSSLACode (name)');
  const msoaName     = get('MSOA (name)');
  const msoaCode     = get('MSOA (code)');
  const lsoaName     = get('LSOA (name)');
  const lsoaCode     = get('LSOA (code)');
  const uprn         = get('UPRN');
  const lastChanged  = get('LastChangedDate');
  const inspReport   = get('InspectorateReport');
  const lastInspDate = get('DateOfLastInspectionVisit');
  const linkedEsts   = get('Linked establishments');
  const urbanRural   = get('UrbanRural (name)');
  const fsm          = parseInt(get('FSM')) || 0;
  const nurProv      = get('NurseryProvision (name)');
  const specialCls   = get('SpecialClasses (name)');
  const senTypes = ['SEN1','SEN2','SEN3','SEN4','SEN5','SEN6','SEN7','SEN8','SEN9','SEN10','SEN11','SEN12']
    .map(k => get(k + ' (name)')).filter(s => s && s !== 'Not applicable' && s !== '');

  const addrParts = [street, locality, address3, town, county].filter(p => p && p !== 'Not applicable' && p !== '');
  const address = addrParts.join(', ');

  let gender = 'Mixed';
  if (genderRaw === 'Girls') gender = 'Girls';
  else if (genderRaw === 'Boys') gender = 'Boys';
  else if (genderRaw === 'Not applicable') gender = 'N/A';

  let schoolType = typeGroup || typeRaw;
  if (typeGroup === 'Local authority maintained schools') {
    if (typeRaw.includes('Community')) schoolType = 'Community';
    else if (typeRaw.includes('Voluntary aided')) schoolType = 'Voluntary Aided';
    else if (typeRaw.includes('Voluntary controlled')) schoolType = 'Voluntary Controlled';
    else if (typeRaw.includes('Foundation')) schoolType = 'Foundation';
    else schoolType = 'State Maintained';
  } else if (typeGroup === 'Academies') {
    if (typeRaw.includes('converter')) schoolType = 'Academy Converter';
    else if (typeRaw.includes('sponsor')) schoolType = 'Academy Sponsor Led';
    else if (typeRaw.includes('Free school')) schoolType = 'Free School';
    else schoolType = 'Academy';
  } else if (typeGroup === 'Free Schools') {
    schoolType = 'Free School';
  } else if (typeGroup === 'Independent schools') {
    schoolType = 'Independent';
  } else if (typeGroup === 'Special schools') {
    schoolType = 'Special';
  }

  const ageRange = (lowAge && highAge) ? `${lowAge}-${highAge}` : '';
  let admissionsPolicy = admPolicyRaw;
  if (admPolicyRaw === 'Not applicable') admissionsPolicy = '';

  const compareUrl = urn ? `https://www.compare-school-performance.service.gov.uk/school/${urn}` : '';
  const headTeacher = [headTitle !== 'Not applicable' ? headTitle : '', headFirst, headLast].filter(Boolean).join(' ').trim();

  const coreFields = {
    name, urn, la: laName, region: 'Greater London', postcode, address,
    gender, schoolType, ageRange,
    pupilCount: pupils || capacity,
    admissionsPolicy, website, phone,
    official: true,
    officialDataSource: 'DfE GIAS',
    compareSchoolPerformanceUrl: compareUrl,
  };

  const _csv = {
    establishmentNumber: estNum, laCode, ukprn, uprn,
    establishmentStatus: estStatus, phaseOfEducation: phaseEd,
    typeOfEstablishment: typeRaw, establishmentTypeGroup: typeGroup,
    schoolCapacity: capacity, numberOfBoys: boys, numberOfGirls: girls,
    percentageFSM: fsmPct, fsm,
    religiousCharacter: (relChar && relChar !== 'Does not apply' && relChar !== 'Not applicable') ? relChar : null,
    officialSixthForm: sixthForm,
    boarders: (boarders && boarders !== 'No boarders') ? boarders : null,
    nurseryProvision: (nurProv && nurProv !== 'No Nursery Classes') ? nurProv : null,
    specialClasses: (specialCls && specialCls !== 'No Special Classes') ? specialCls : null,
    federationFlag: fedFlag, federations: feds || null,
    trustSchoolFlag: trustFlag, trusts: trusts || null,
    schoolSponsors: sponsors || null,
    openDate: openDate || null, closeDate: closeDate || null,
    lastChangedDate: lastChanged || null,
    inspectorateReport: inspReport || null, lastInspectionDate: lastInspDate || null,
    headTeacher: headTeacher || null, headPreferredJobTitle: headJob || null,
    urbanRural: urbanRural || null, district, ward,
    parliamentaryConstituency: constituency, gssLACode,
    msoaName, msoaCode, lsoaName, lsoaCode,
    easting: easting || null, northing: northing || null,
    senTypes: senTypes.length > 0 ? senTypes : null,
    linkedEstablishments: linkedEsts || null,
  };

  return { ...coreFields, _csv };
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

function main() {
  console.log('Reading files...');
  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const schools = JSON.parse(fs.readFileSync(SCHOOLS_PATH, 'utf8'));
  const rows    = parseCSV(csvText);
  const headers = rows[0];
  const dataRows = rows.slice(1);
  console.log(`CSV rows: ${dataRows.length}, DB schools: ${schools.length}`);

  // Index by URN
  const byUrn = new Map();
  schools.forEach((s, idx) => {
    const u = String(s.urn || '').trim();
    if (u && u !== 'N/A' && u !== '') byUrn.set(u, idx);
  });

  const report = { mergedByUrn: [], addedNew: [], addedFuzzy: [], total: dataRows.length };

  let counter = Math.max(...schools.map(s => {
    const m = String(s.id || '').match(/(\d+)/); return m ? parseInt(m[1]) : 0;
  })) + 1;
  const genId = () => `sch-csv-${String(counter++).padStart(6, '0')}`;

  dataRows.forEach((row) => {
    if (row.length < 10) return;
    const csv  = mapRow(headers, row);
    const csvUrn  = String(csv.urn || '').trim();
    const csvName = csv.name;
    if (!csvName) return;

    // Strategy 1: URN exact match
    if (csvUrn && byUrn.has(csvUrn)) {
      const idx = byUrn.get(csvUrn);
      const ex  = schools[idx];
      schools[idx] = {
        ...ex,
        name:        csv.name,
        urn:         csvUrn,
        la:          csv.la          || ex.la,
        postcode:    csv.postcode    || ex.postcode,
        address:     csv.address     || ex.address,
        gender:      csv.gender      || ex.gender,
        schoolType:  csv.schoolType  || ex.schoolType,
        ageRange:    csv.ageRange    || ex.ageRange,
        pupilCount:  csv.pupilCount  || ex.pupilCount,
        admissionsPolicy: csv.admissionsPolicy || ex.admissionsPolicy,
        website:     csv.website     || ex.website,
        phone:       csv.phone       || ex.phone,
        official:    true,
        officialDataSource: 'DfE GIAS',
        compareSchoolPerformanceUrl: csv.compareSchoolPerformanceUrl,
        _csv:        csv._csv,
      };
      report.mergedByUrn.push({ urn: csvUrn, name: csvName, existingName: ex.name });
      return;
    }

    // Strategy 2: Fuzzy name match
    let bestIdx = -1, bestSim = 0;
    const gCSV = String(csv.gender || '').trim().toLowerCase();
    const isBoysCSV = gCSV === 'boys' || gCSV.startsWith('boys ');
    const isGirlsCSV = gCSV === 'girls' || gCSV.startsWith('girls ');

    schools.forEach((s, idx) => {
      const gS = String(s.gender || '').trim().toLowerCase();
      const isBoysS = gS === 'boys' || gS.startsWith('boys ');
      const isGirlsS = gS === 'girls' || gS.startsWith('girls ');

      if ((isBoysCSV && isGirlsS) || (isGirlsCSV && isBoysS)) {
        return;
      }

      const sim = similarity(csvName, s.name);
      if (sim > bestSim) { bestSim = sim; bestIdx = idx; }
    });

    if (bestSim >= 0.88 && bestIdx >= 0) {
      // Confident merge
      const ex = schools[bestIdx];
      schools[bestIdx] = {
        ...ex,
        name:       csv.name,
        urn:        csvUrn || ex.urn,
        la:         csv.la          || ex.la,
        postcode:   csv.postcode    || ex.postcode,
        address:    csv.address     || ex.address,
        gender:     csv.gender      || ex.gender,
        schoolType: csv.schoolType  || ex.schoolType,
        ageRange:   csv.ageRange    || ex.ageRange,
        pupilCount: csv.pupilCount  || ex.pupilCount,
        admissionsPolicy: csv.admissionsPolicy || ex.admissionsPolicy,
        website:    csv.website     || ex.website,
        phone:      csv.phone       || ex.phone,
        official:   true,
        officialDataSource: 'DfE GIAS',
        compareSchoolPerformanceUrl: csv.compareSchoolPerformanceUrl,
        _csv:       csv._csv,
      };
      if (csvUrn) byUrn.set(csvUrn, bestIdx);
      report.mergedByUrn.push({ urn: csvUrn, name: csvName, existingName: ex.name, method: 'fuzzy', sim: bestSim.toFixed(3) });

    } else if (bestSim >= 0.72 && bestIdx >= 0) {
      // Uncertain — add separate entry with dedup flags
      const entry = {
        id: genId(), ...csv,
        _potentialDuplicateOf: schools[bestIdx].id,
        _dedupNote: `Fuzzy match ${(bestSim*100).toFixed(1)}% with "${schools[bestIdx].name}"`,
      };
      schools.push(entry);
      if (csvUrn) byUrn.set(csvUrn, schools.length - 1);
      report.addedFuzzy.push({ urn: csvUrn, name: csvName, matchedWith: schools[bestIdx].name, sim: bestSim.toFixed(3) });

    } else {
      // Brand new entry
      const entry = { id: genId(), ...csv };
      schools.push(entry);
      if (csvUrn) byUrn.set(csvUrn, schools.length - 1);
      report.addedNew.push({ urn: csvUrn, name: csvName });
    }
  });

  fs.writeFileSync(SCHOOLS_PATH, JSON.stringify(schools, null, 2));
  fs.writeFileSync(REPORT_PATH,  JSON.stringify(report,  null, 2));

  console.log('\n=== IMPORT COMPLETE ===');
  console.log('Merged (URN + confident fuzzy):', report.mergedByUrn.length);
  console.log('Added new (no match):',           report.addedNew.length);
  console.log('Added for dedup (fuzzy):',         report.addedFuzzy.length);
  console.log('Final DB size:',                   schools.length);
}

main();
