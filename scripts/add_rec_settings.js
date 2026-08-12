const fs = require('fs');
const path = require('path');
const SETTINGS_FILE = path.join(__dirname, '../data/recommendation_settings.json');

const defaultSettings = {
  weights: {
    location: 40,
    examType: 35,
    schoolType: 15,
    gender: 10
  }
};

if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
  console.log('Created data/recommendation_settings.json');
} else {
  console.log('data/recommendation_settings.json already exists');
}
