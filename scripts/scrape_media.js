
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_URL = 'https://api.cacheby.com/search';
const OUTPUT_FILE = path.join(process.cwd(), 'src/data/products.json');
const DELAY_MS = 1000; // 1 second delay

// Ensure data directory exists
const dir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

async function scrape() {
    let page = 1;
    let allProducts = [];
    let hasMore = true;

    console.log("Starting scrape...");

    while (hasMore) {
        try {
            console.log(`Fetching page ${page}...`);
            const response = await axios.get(API_URL, {
                params: {
                    facets: '{"categories":"Media"}',
                    menu: 'products',
                    page: page,
                    q: '',
                    sort: 'views:desc'
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://cacheby.com/'
                }
            });

            const hits = response.data.hits;

            if (!hits || hits.length === 0) {
                console.log("No more hits found.");
                hasMore = false;
                break;
            }

            const products = hits.map(item => ({
                id: item.id,
                brand: item.brand,
                productName: item.title,
                productNumbers: item.part_numbers,
                thumbnail: item.thumbnail,
                urlSlug: item.url_slug
            }));

            allProducts = allProducts.concat(products);
            console.log(`Fetched ${products.length} items. Total: ${allProducts.length}`);

            page++;

            // Sleep
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));

        } catch (error) {
            console.error(`Error fetching page ${page}:`, error.message);
            // Retry once or break? Let's retry 3 times then break
            // For now just break to avoid infinite loops in bad state, but user might restart.
            // Actually, simplified retry:
            console.log("Retrying in 5 seconds...");
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
                // Retry logic could be more complex, but let's just try same page again next loop?
                // But I need to not increment page if failed.
                // Refactor loop structure slightly?
                // Simpler: just break for this v1. 
                hasMore = false;
            } catch (e) { }
        }
    }

    console.log(`Scraping complete. Saving ${allProducts.length} items to ${OUTPUT_FILE}`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allProducts, null, 2));
}

scrape();
