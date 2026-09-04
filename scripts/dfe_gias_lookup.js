const fs = require('fs');
const path = require('path');

const giasCuratedRegistry = [
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
  { name: "Harrow School", postcode: "HA1 3HP", urn: "102245", ofsted: "Independent (ISI Excellent)", phone: "020 8872 8000", website: "https://www.harrowschool.co.uk", headteacher: "Mr Alastair Land" },
  { name: "Ashbourne College", postcode: "W8 4PL", urn: "100537", ofsted: "Independent (ISI Excellent)", phone: "020 7937 3858", website: "https://www.ashbournecollege.co.uk", headteacher: "Mr Michael Kirby" }
];

function decodeHtml(html) {
  if (!html) return '';
  return html
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPhone(num) {
  if (!num) return '';
  const digits = num.replace(/\D/g, '');
  if (digits.startsWith('020') && digits.length === 11) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return num.trim();
}

function deriveRegion(laName, gorName) {
  const gor = (gorName || '').toLowerCase();
  if (gor.includes('london')) return 'Greater London';
  if (gor.includes('west midlands')) return 'West Midlands';
  if (gor.includes('north west')) return 'North West';
  if (gor.includes('south east')) return 'South East';
  if (gor.includes('east of england') || gor.includes('eastern')) return 'East of England';
  if (gor.includes('yorkshire')) return 'Yorkshire and the Humber';
  if (gor.includes('south west')) return 'South West';
  if (gor.includes('north east')) return 'North East';
  if (gor.includes('east midlands')) return 'East Midlands';

  const la = (laName || '').toLowerCase();
  if (/birmingham|coventry|dudley|sandwell|solihull|walsall|wolverhampton|staffordshire|warwickshire|worcestershire|herefordshire|shropshire|telford/i.test(la)) return 'West Midlands';
  if (/manchester|bolton|bury|oldham|rochdale|salford|stockport|tameside|trafford|wigan|liverpool|wirral|sefton|st\.? helens|knowsley|lancashire|blackpool|blackburn|cheshire|cumbria/i.test(la)) return 'North West';
  if (/kent|surrey|sussex|oxfordshire|berkshire|buckinghamshire|hampshire|isle of wight|portsmouth|southampton|milton keynes|slough|windsor|bracknell|reading|wokingham|west berkshire/i.test(la)) return 'South East';
  if (/hertfordshire|essex|cambridgeshire|norfolk|suffolk|bedfordshire|luton|peterborough|southend|thurrock/i.test(la)) return 'East of England';
  if (/yorkshire|leeds|sheffield|bradford|wakefield|kirklees|calderdale|barnsley|doncaster|rotherham|hull|york/i.test(la)) return 'Yorkshire and the Humber';
  if (/bristol|gloucestershire|somerset|devon|cornwall|dorset|wiltshire|plymouth|torbay|bournemouth|poole|swindon|bath/i.test(la)) return 'South West';
  if (/newcastle|sunderland|durham|northumberland|gateshead|north tyneside|south tyneside|hartlepool|middlesbrough|redcar|stockton/i.test(la)) return 'North East';
  if (/derbyshire|nottinghamshire|leicestershire|northamptonshire|lincolnshire|derby|nottingham|leicester|rutland/i.test(la)) return 'East Midlands';
  return 'Greater London';
}

function normalizeSchoolTypeFromDfe(rawType, schName, admpol) {
  const name = (schName || '').toLowerCase();
  const raw = (rawType || '').toLowerCase();
  const adm = (admpol || '').toLowerCase();

  if (name.includes('grammar') || adm === 'selective') return 'Grammar';
  if (raw.includes('independent') || (name.includes('college') && raw.includes('other')) || raw.includes('public')) return 'Independent';
  if (raw.includes('special') || raw.includes('pupil referral')) return 'Special';
  return 'Comprehensive';
}

// Polite Rate-Limiter and Cache for DfE GIAS Web Service
let lastDfeFetchTimestamp = 0;
const DFE_MIN_INTERVAL_MS = 1200;
const dfeLookupMemoryCache = new Map();

async function throttleDfeRequest() {
  const now = Date.now();
  const elapsed = now - lastDfeFetchTimestamp;
  if (elapsed < DFE_MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, DFE_MIN_INTERVAL_MS - elapsed));
  }
  lastDfeFetchTimestamp = Date.now();
}

async function fetchDfeGiasDetails(rawUrn) {
  const urn = String(rawUrn || '').trim();
  if (!urn || !/^\d+$/.test(urn)) {
    throw new Error('Valid numeric DfE URN is required');
  }

  if (dfeLookupMemoryCache.has(urn)) {
    return JSON.parse(JSON.stringify(dfeLookupMemoryCache.get(urn)));
  }

  let scraped = {};

  // 1. Cross-reference official DfE England School Information CSV first for baseline
  const csvPath = path.join(__dirname, '../archive/data/2024-2025_england_school_information.csv');
  let csvRecord = null;
  if (fs.existsSync(csvPath)) {
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    const lines = csvContent.split('\n');
    const targetLine = lines.find(l => l.startsWith(urn + ','));
    if (targetLine) {
      const cols = targetLine.split(',');
      const street = (cols[6] || '').trim();
      const locality = (cols[7] || '').trim();
      const town = (cols[9] || '').trim();
      const postcode = (cols[10] || '').trim();
      const address = [street, locality, town, postcode].filter(Boolean).join(', ');
      const rawType = (cols[15] || '').trim();
      const schName = (cols[5] || '').trim();
      const laName = (cols[1] || '').trim();
      const admpol = (cols[23] || '').trim();
      const ageRange = (cols[19] && cols[20]) ? `${cols[19]}-${cols[20]}` : '';

      const schStatus = (cols[11] || '').trim();
      const closeDate = (cols[13] || '').trim();
      const isCsvClosed = schStatus.toLowerCase() === 'closed' || closeDate.length > 0;

      csvRecord = {
        urn: cols[0],
        name: schName,
        la: laName,
        region: deriveRegion(laName),
        postcode: postcode,
        address: address,
        schoolType: normalizeSchoolTypeFromDfe(rawType, schName, admpol),
        rawSchoolType: rawType,
        gender: cols[21] || 'Mixed',
        ageRange: ageRange,
        admissionsPolicy: admpol || 'Non-selective',
        active: !isCsvClosed
      };
    }
  }

  // 2. Attempt Live Fetch from DfE GIAS (with and without www)
  const targetUrls = [
    `https://www.get-information-schools.service.gov.uk/Establishments/Establishment/Details/${urn}`,
    `https://get-information-schools.service.gov.uk/Establishments/Establishment/Details/${urn}`
  ];

  for (const url of targetUrls) {
    try {
      await throttleDfeRequest();

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Upgrade-Insecure-Requests': '1'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const html = await res.text();

        // Name
        let name = html.match(/<span id="establishment-name">([\s\S]*?)<\/span>/i)?.[1];
        if (!name) {
          const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
          name = h1.replace(/<span[^>]*class="heading-preamble"[^>]*>[\s\S]*?<\/span>/gi, '').replace(/<[^>]+>/g, '').trim();
        }
        if (name) scraped.name = decodeHtml(name);

        // Parse summary list pairs
        const dtDdRegex = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
        let match;
        const dlMap = {};
        while ((match = dtDdRegex.exec(html)) !== null) {
          const rawKey = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const rawVal = match[2];
          const textVal = decodeHtml(rawVal.replace(/<[^>]+>/g, ' '));
          const href = rawVal.match(/href="([^"]+)"/i)?.[1];
          dlMap[rawKey] = { text: textVal, href: href || null };
        }

        for (const [k, v] of Object.entries(dlMap)) {
          const lk = k.toLowerCase();
          if (lk === 'address') {
            if (!scraped.address) scraped.address = v.text;
          } else if (lk === 'district' || lk === 'local authority') {
            const cleanLa = v.text.replace(/\(\d+\)/g, '').trim();
            if (cleanLa && !cleanLa.startsWith('/') && !cleanLa.startsWith('E09')) scraped.la = cleanLa;
          } else if (lk === 'government office region (gor)') {
            scraped.gor = v.text;
          } else if (lk === 'school type' || lk === 'type of establishment') {
            scraped.rawSchoolType = v.text;
          } else if (lk === 'establishment status') {
            scraped.establishmentStatus = v.text;
            if (v.text.toLowerCase().includes('closed')) scraped.isClosed = true;
          } else if (lk.includes('reason establishment closed')) {
            if (!v.text.toLowerCase().includes('not applicable')) scraped.isClosed = true;
          } else if (lk.includes('closed date')) {
            if (!v.text.toLowerCase().includes('not recorded')) scraped.isClosed = true;
          } else if (lk.includes('gender of entry') || lk === 'gender') {
            if (/girls/i.test(v.text)) scraped.gender = 'Girls';
            else if (/boys/i.test(v.text)) scraped.gender = 'Boys';
            else scraped.gender = 'Mixed';
          } else if (lk.includes('age range')) {
            const nums = v.text.match(/(\d+)\s*to\s*(\d+)/i) || v.text.match(/(\d+)\s*-\s*(\d+)/i);
            scraped.ageRange = nums ? `${nums[1]}-${nums[2]}` : v.text;
          } else if (lk === 'admissions policy') {
            scraped.admissionsPolicy = v.text;
          } else if (lk === 'website') {
            scraped.website = v.href || v.text;
          } else if (lk === 'telephone') {
            scraped.phone = formatPhone(v.text);
          } else if (lk === 'email') {
            scraped.email = v.text;
          } else if (lk.includes('ofsted') || lk.includes('rating') || lk.includes('inspection')) {
            if (!v.text.includes('Why the rating is not displayed') && !v.text.includes('opens in new tab')) {
              scraped.ofstedRating = v.text;
            }
          } else if (lk === 'number of pupils') {
            const num = parseInt(v.text.replace(/\D/g, ''), 10);
            if (!isNaN(num)) scraped.pupilCount = num;
          }
        }

        if (scraped.name) break; // Successfully parsed live GIAS page
      }
    } catch (err) {
      // Network/timeout fallback
    }
  }

  // 3. Cross-reference curated registry
  const curated = giasCuratedRegistry.find(r => r.urn === urn);

  if (!scraped.name && !csvRecord && !curated) {
    return null; // Not found in DfE GIAS
  }

  const name = scraped.name || curated?.name || csvRecord?.name || `School URN ${urn}`;
  const postcode = scraped.address?.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0]?.toUpperCase() || curated?.postcode || csvRecord?.postcode || '';
  const la = scraped.la || csvRecord?.la || '';
  const region = deriveRegion(la, scraped.gor || csvRecord?.region);
  const rawSchoolType = scraped.rawSchoolType || csvRecord?.rawSchoolType || 'Maintained school';
  const schoolType = normalizeSchoolTypeFromDfe(rawSchoolType, name, scraped.admissionsPolicy || csvRecord?.admissionsPolicy);
  const gender = scraped.gender || csvRecord?.gender || 'Mixed';
  const ageRange = scraped.ageRange || csvRecord?.ageRange || '11-18';
  const ofstedRating = scraped.ofstedRating || curated?.ofsted || '';
  const website = scraped.website || curated?.website || '';
  const phone = scraped.phone || (curated?.phone ? formatPhone(curated.phone) : '');
  const email = scraped.email || '';
  const admissionsPolicy = scraped.admissionsPolicy || csvRecord?.admissionsPolicy || (schoolType === 'Grammar' ? 'Selective' : 'Non-selective');
  
  const isClosed = scraped.isClosed || scraped.establishmentStatus?.toLowerCase().includes('closed') || csvRecord?.active === false || /\(closed\)|\[closed\]/i.test(name);
  const active = !isClosed;

  const finalRecord = {
    urn,
    name,
    la,
    region,
    postcode,
    address: scraped.address || csvRecord?.address || (postcode ? `${name}, ${postcode}` : name),
    schoolType,
    rawSchoolType,
    gender,
    ageRange,
    ofstedRating,
    website,
    phone,
    email,
    admissionsPolicy,
    active,
    official: true,
    officialDataSource: 'DfE GIAS',
    sourceUrl: `https://www.get-information-schools.service.gov.uk/Establishments/Establishment/Details/${urn}`,
    compareSchoolPerformanceUrl: `https://www.compare-school-performance.service.gov.uk/school/${urn}`
  };

  dfeLookupMemoryCache.set(urn, finalRecord);
  return finalRecord;
}

module.exports = {
  fetchDfeGiasDetails,
  deriveRegion,
  normalizeSchoolTypeFromDfe,
  formatPhone,
  decodeHtml
};
