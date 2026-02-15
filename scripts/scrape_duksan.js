/**
 * Duksan 제품 스크래핑 스크립트
 * - Cacheby API에서 Duksan 브랜드 제품 스크래핑
 * - Supabase Storage에 이미지 업로드
 * - media_products 테이블에 데이터 삽입
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Configuration
const API_URL = 'https://api.cacheby.com/search';
const OUTPUT_FILE = path.join(process.cwd(), 'src/data/duksan_products.json');
const DELAY_MS = 1000;

// Supabase configuration
const SUPABASE_URL = 'https://zafxzidbtbryiksemlwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphZnh6aWRidGJyeWlrc2VtbHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTU1NzIsImV4cCI6MjA4MjI5MTU3Mn0.DEylxIGynOxzUC-mt5HwJt1gWOqG400QejvKxLdghhw';
const STORAGE_BUCKET = 'media-products';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Ensure data directory exists
const dir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * Download image from URL and return as buffer
 */
async function downloadImage(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 30000
        });
        return Buffer.from(response.data);
    } catch (error) {
        console.error(`Failed to download image: ${url}`, error.message);
        return null;
    }
}

/**
 * Upload image to Supabase Storage
 */
async function uploadToSupabase(imageBuffer, filePath) {
    try {
        const contentType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(filePath, imageBuffer, {
                contentType,
                upsert: true
            });

        if (error) {
            console.error(`Upload error for ${filePath}:`, error.message);
            return null;
        }

        // Generate public URL
        const { data: publicUrl } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(filePath);

        return publicUrl.publicUrl;
    } catch (error) {
        console.error(`Supabase upload failed for ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Convert cacheby image URL to Supabase Storage URL
 */
async function convertImageUrl(originalUrl, productId) {
    if (!originalUrl) return null;

    // Extract filename from URL
    const urlParts = originalUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    const extension = filename.split('.').pop() || 'png';

    // Create storage path: duksan/{productId}.{extension}
    const storagePath = `duksan/${productId}.${extension}`;

    // Download and upload
    const imageBuffer = await downloadImage(originalUrl);
    if (!imageBuffer) {
        console.log(`Using placeholder for ${productId}`);
        return originalUrl; // Fallback to original URL
    }

    const newUrl = await uploadToSupabase(imageBuffer, storagePath);
    return newUrl || originalUrl;
}

/**
 * Scrape all Duksan products from Cacheby API
 */
async function scrapeProducts() {
    let page = 1;
    let allProducts = [];
    let hasMore = true;

    console.log("Starting Duksan product scrape...");

    while (hasMore) {
        try {
            console.log(`Fetching page ${page}...`);
            const response = await axios.get(API_URL, {
                params: {
                    facets: '{"brand":"Duksan"}',
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
                console.log("No more products found.");
                hasMore = false;
                break;
            }

            const products = hits.map(item => ({
                id: item.id,
                brand: item.brand,
                product_name: item.title,
                product_numbers: item.part_numbers || [],
                thumbnail: item.thumbnail,
                url_slug: item.url_slug
            }));

            allProducts = allProducts.concat(products);
            console.log(`Fetched ${products.length} items. Total: ${allProducts.length}`);

            page++;
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));

        } catch (error) {
            console.error(`Error fetching page ${page}:`, error.message);
            hasMore = false;
        }
    }

    return allProducts;
}

/**
 * Process products: upload images and prepare for database
 */
async function processProducts(products) {
    console.log(`\nProcessing ${products.length} products for image upload...`);

    const processedProducts = [];

    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        console.log(`[${i + 1}/${products.length}] Processing ${product.product_name}`);

        // Convert image URL (upload to Supabase)
        const newThumbnailUrl = await convertImageUrl(product.thumbnail, product.id);

        processedProducts.push({
            id: product.id,
            brand: product.brand,
            product_name: product.product_name,
            product_numbers: product.product_numbers,
            thumbnail_url: newThumbnailUrl,
            url_slug: product.url_slug
        });

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    return processedProducts;
}

/**
 * Insert products into Supabase media_products table
 */
async function insertToDatabase(products) {
    console.log(`\nInserting ${products.length} products into media_products table...`);

    // Insert in batches of 50
    const batchSize = 50;
    let inserted = 0;

    for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);

        const { data, error } = await supabase
            .from('products')
            .upsert(batch, {
                onConflict: 'url_slug',
                ignoreDuplicates: false
            });

        if (error) {
            console.error(`Batch insert error:`, error.message);
        } else {
            inserted += batch.length;
            console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}. Total: ${inserted}`);
        }
    }

    return inserted;
}

/**
 * Main execution
 */
async function main() {
    console.log("=".repeat(50));
    console.log("Duksan Product Scraping & Migration Script");
    console.log("=".repeat(50));

    // Step 1: Scrape products
    const rawProducts = await scrapeProducts();
    console.log(`\nScraped ${rawProducts.length} products from Cacheby API`);

    if (rawProducts.length === 0) {
        console.log("No products found. Exiting.");
        return;
    }

    // Step 2: Process images and prepare data
    const processedProducts = await processProducts(rawProducts);

    // Step 3: Save to JSON file
    console.log(`\nSaving to ${OUTPUT_FILE}...`);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(processedProducts, null, 2));
    console.log(`Saved ${processedProducts.length} products to JSON file`);

    // Step 4: Insert into Supabase
    const insertedCount = await insertToDatabase(processedProducts);

    console.log("\n" + "=".repeat(50));
    console.log(`Migration complete!`);
    console.log(`- Products scraped: ${rawProducts.length}`);
    console.log(`- Products inserted: ${insertedCount}`);
    console.log("=".repeat(50));
}

main().catch(console.error);
