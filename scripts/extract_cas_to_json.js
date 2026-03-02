import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'scripts', '40CFR_26133_P_List_CAS.xlsx');

const workbook = xlsx.readFile(file);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// converting to json
const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });

const casNumbers = new Set();
data.forEach(row => {
    if (row && row.length > 1) {
        const cas = row[1];
        if (typeof cas === 'string' && /^\d+-\d{2}-\d$/.test(cas.trim())) {
            casNumbers.add(cas.trim());
        } else if (typeof cas === 'number') {
            // Not likely for CAS but just in case
        }
    }
});

const outPath = path.join(process.cwd(), 'src', 'data', 'p_list_cas.json');
fs.writeFileSync(outPath, JSON.stringify(Array.from(casNumbers).sort(), null, 2));

console.log(`Extracted ${casNumbers.size} CAS numbers to ${outPath}`);
