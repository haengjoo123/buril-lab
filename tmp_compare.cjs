const fs = require('fs');

const file1 = 'src/data/gibco_products_chunk_1_40.json';
const file2 = 'src/data/gibco_products.json';

const data1 = JSON.parse(fs.readFileSync(file1, 'utf8'));
const data2 = JSON.parse(fs.readFileSync(file2, 'utf8'));

console.log(`File 1 (${file1}): ${data1.length} entries`);
console.log(`File 2 (${file2}): ${data2.length} entries`);

const ids1 = new Set(data1.map(p => p.id));
const ids2 = new Set(data2.map(p => p.id));

const onlyIn1 = data1.filter(p => !ids2.has(p.id));
const onlyIn2 = data2.filter(p => !ids1.has(p.id));

console.log(`Entries only in File 1: ${onlyIn1.length}`);
console.log(`Entries only in File 2: ${onlyIn2.length}`);

if (onlyIn1.length > 0) {
    console.log('Sample from File 1 only:');
    console.log(JSON.stringify(onlyIn1.slice(0, 3), null, 2));
}

if (onlyIn2.length > 0) {
    console.log('Sample from File 2 only:');
    console.log(JSON.stringify(onlyIn2.slice(0, 3), null, 2));
}

// Check for duplicates by product_name
function findDuplicates(data) {
    const counts = {};
    data.forEach(p => {
        counts[p.product_name] = (counts[p.product_name] || 0) + 1;
    });
    return Object.entries(counts).filter(([name, count]) => count > 1);
}

const dupes1 = findDuplicates(data1);
const dupes2 = findDuplicates(data2);

console.log(`Duplicate product names in File 1: ${dupes1.length}`);
console.log(`Duplicate product names in File 2: ${dupes2.length}`);
