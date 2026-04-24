import { Workbook } from 'exceljs';
import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'scripts', 'U_List_Extracted.xlsx');

const workbook = new Workbook();
await workbook.xlsx.readFile(file);
const sheet = workbook.worksheets[0];

const data = [];
sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = [];
    for (let columnIndex = 1; columnIndex <= sheet.columnCount; columnIndex += 1) {
        values.push(row.getCell(columnIndex).value);
    }
    data.push(values);
});

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

const outPath = path.join(process.cwd(), 'src', 'data', 'u_list_cas.json');
fs.writeFileSync(outPath, JSON.stringify(Array.from(casNumbers).sort(), null, 2));

console.log(`Extracted ${casNumbers.size} CAS numbers to ${outPath}`);
