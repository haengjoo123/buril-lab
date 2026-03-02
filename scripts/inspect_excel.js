import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'scripts', 'U_List_Extracted.xlsx');

const workbook = xlsx.readFile(file);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// converting to json
const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
console.log(JSON.stringify(data.slice(0, 10), null, 2));
