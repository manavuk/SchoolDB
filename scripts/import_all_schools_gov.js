const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseCSVLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

async function importCSV() {
  const csvPath = path.join(__dirname, '..', 'data', '2024-2025_england_school_information.csv');
  const dbPath = path.join(__dirname, '..', 'data', 'schooldb.sqlite');
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}`);
  }

  const db = new DatabaseSync(dbPath);

  const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let rawHeaders = null;
  let cleanHeaders = [];
  let rowCount = 0;
  let insertStmt = null;

  db.exec('BEGIN TRANSACTION;');

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!rawHeaders) {
        let hLine = line;
        if (hLine.charCodeAt(0) === 0xFEFF) {
          hLine = hLine.slice(1);
        }
        rawHeaders = parseCSVLine(hLine);
        cleanHeaders = rawHeaders.map(h => h.trim());
        
        const colDefs = cleanHeaders.map(h => `"${h.replace(/"/g, '""')}" TEXT`).join(', ');
        db.exec('DROP TABLE IF EXISTS all_schools_gov;');
        db.exec(`CREATE TABLE all_schools_gov (${colDefs}, "gov_sch_year" TEXT);`);

        const placeholders = cleanHeaders.map(() => '?').concat(['?']).join(', ');
        insertStmt = db.prepare(`INSERT INTO all_schools_gov VALUES (${placeholders});`);
        continue;
      }

      const values = parseCSVLine(line);
      values.push('2024_2025');

      insertStmt.run(...values);
      rowCount++;
    }

    db.exec('COMMIT;');
    console.log(`Successfully imported ${rowCount} rows into all_schools_gov table.`);

    const countRes = db.prepare('SELECT count(*) as count FROM all_schools_gov;').get();
    console.log('Total table rows:', countRes.count);
    const sample = db.prepare('SELECT * FROM all_schools_gov LIMIT 1;').get();
    console.log('Sample row:', sample);
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

importCSV().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
