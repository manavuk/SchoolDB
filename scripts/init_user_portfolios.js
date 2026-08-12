const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '../data');
const PORTFOLIOS_FILE = path.join(DATA_DIR, 'user_portfolios.json');
const SCHOOLS_FILE = path.join(DATA_DIR, 'schools.json');

const schools = JSON.parse(fs.readFileSync(SCHOOLS_FILE, 'utf8'));

// Find sample school objects
const tiffin = schools.find(s => s.name && s.name.includes('Tiffin')) || schools[0];
const latymer = schools.find(s => s.name && s.name.includes('Latymer')) || schools[1];
const stpauls = schools.find(s => s.name && s.name.includes('St Paul')) || schools[2];

const defaultPortfolios = {
  "parent-sarah": {
    "userId": "parent-sarah",
    "name": "Sarah Jenkins (Parent)",
    "targetLocation": "Kingston upon Thames",
    "selectedSchools": [tiffin, latymer].filter(Boolean),
    "removedSchoolIds": [],
    "savedAt": new Date().toISOString()
  },
  "parent-david": {
    "userId": "parent-david",
    "name": "David & Emma Miller (Parents)",
    "targetLocation": "Hammersmith and Fulham",
    "selectedSchools": [stpauls].filter(Boolean),
    "removedSchoolIds": [],
    "savedAt": new Date().toISOString()
  },
  "parent-priya": {
    "userId": "parent-priya",
    "name": "Priya Patel (Parent)",
    "targetLocation": "Barnet",
    "selectedSchools": [],
    "removedSchoolIds": [],
    "savedAt": new Date().toISOString()
  },
  "parent-guest": {
    "userId": "parent-guest",
    "name": "Guest User",
    "targetLocation": "",
    "selectedSchools": [],
    "removedSchoolIds": [],
    "savedAt": new Date().toISOString()
  }
};

if (!fs.existsSync(PORTFOLIOS_FILE)) {
  fs.writeFileSync(PORTFOLIOS_FILE, JSON.stringify(defaultPortfolios, null, 2));
  console.log('Created data/user_portfolios.json with sample profiles');
} else {
  console.log('data/user_portfolios.json already exists');
}
