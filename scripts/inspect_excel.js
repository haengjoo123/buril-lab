import { Workbook } from 'exceljs';
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
console.log(JSON.stringify(data.slice(0, 10), null, 2));
