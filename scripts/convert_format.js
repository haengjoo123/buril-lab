
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'src/data/products.json');

if (!fs.existsSync(DATA_FILE)) {
    console.error("Data file not found!");
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

const newData = data.map(item => ({
    id: item.id,
    brand: item.brand,
    product_name: item.productName,
    product_numbers: item.productNumbers,
    thumbnail_url: item.thumbnail, // Renaming thumbnail -> thumbnail_url for clarity? Or keep thumbnail? User asked for "image(thumbnail)".
    url_slug: item.urlSlug
}));

fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2));
console.log(`Converted ${newData.length} items to snake_case.`);
console.log("Sample:", JSON.stringify(newData[0], null, 2));
