
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'src/data/products.json');

if (!fs.existsSync(DATA_FILE)) {
    console.error("Data file not found!");
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
console.log(`Total Products: ${data.length}`);

// Sample check
if (data.length > 0) {
    console.log("First item:", JSON.stringify(data[0], null, 2));
}

// Check for missing fields
let missingBrand = 0;
let missingName = 0;
let missingNumber = 0;
let missingImage = 0;

data.forEach(item => {
    if (!item.brand) missingBrand++;
    if (!item.productName) missingName++;
    if (!item.productNumbers || item.productNumbers.length === 0) missingNumber++;
    if (!item.thumbnail) missingImage++;
});

console.log("Missing Brands:", missingBrand);
console.log("Missing Names:", missingName);
console.log("Missing Numbers:", missingNumber);
console.log("Missing Images:", missingImage);
