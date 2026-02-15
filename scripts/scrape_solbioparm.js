/**
 * 솔바이오팜 제품 스크래핑 스크립트
 * cacheby.com에서 솔바이오팜 브랜드 제품 데이터를 수집하여:
 * - 이미지를 Supabase Storage에 업로드
 * - products 테이블에 데이터 삽입
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// API Configuration
const API_URL = 'https://api.cacheby.com/search';
const BRAND_NAME = '솔바이오팜';
const BRAND_SLUG = 'solbioparm';
const OUTPUT_FILE = path.join(process.cwd(), 'src/data/solbioparm_products.json');

// Supabase configuration
const SUPABASE_URL = 'https://zafxzidbtbryiksemlwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphZnh6aWRidGJyeWlrc2VtbHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTU1NzIsImV4cCI6MjA4MjI5MTU3Mn0.DEylxIGynOxzUC-mt5HwJt1gWOqG400QejvKxLdghhw';
const STORAGE_BUCKET = 'media-products';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch all products from the API
 */
async function fetchAllProducts() {
    const allProducts = [];
    let page = 1;
    const limit = 24;

    console.log(`\nFetching ${BRAND_NAME} products from Cacheby API...`);

    while (true) {
        try {
            const response = await axios.get(API_URL, {
                params: {
                    facets: JSON.stringify({ brand: BRAND_NAME }),
                    menu: 'products',
                    page,
                    q: '',
                    sort: 'views:desc'
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const { hits, estimatedTotalHits } = response.data;

            if (!hits || hits.length === 0) break;

            allProducts.push(...hits);
            console.log(`Page ${page}: ${hits.length} products (Total: ${allProducts.length}/${estimatedTotalHits})`);

            if (allProducts.length >= estimatedTotalHits) break;

            page++;
            await delay(500);
        } catch (error) {
            console.error(`Error fetching page ${page}:`, error.message);
            break;
        }
    }

    console.log(`\nTotal products fetched: ${allProducts.length}`);
    return allProducts;
}

/**
 * Get file extension from URL
 */
function getExtension(url) {
    const match = url.match(/\.(jpg|jpeg|png|gif|webp)/i);
    return match ? match[1].toLowerCase() : 'png';
}

/**
 * Download image and upload to Supabase Storage
 */
async function uploadImageToSupabase(imageUrl, productId) {
    try {
        const extension = getExtension(imageUrl);
        const storagePath = `${BRAND_SLUG}/${productId}.${extension}`;

        // Download image
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });

        // Upload to Supabase
        const { error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, response.data, {
                contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`,
                upsert: true
            });

        if (error) {
            console.error(`Upload error for ${productId}:`, error.message);
            return imageUrl; // Return original URL on error
        }

        // Return new Supabase URL
        return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
    } catch (error) {
        console.error(`Image download error for ${productId}:`, error.message);
        return imageUrl; // Return original URL on error
    }
}

/**
 * Transform product data to match database schema
 */
function transformProduct(product, newThumbnailUrl) {
    return {
        id: product.id,
        brand: product.brand || BRAND_NAME,
        product_name: product.title?.replace(`${BRAND_NAME} `, '') || product.title,
        product_numbers: product.part_numbers || [],
        thumbnail_url: newThumbnailUrl,
        url_slug: product.url_slug || product.id
    };
}

/**
 * Insert products into Supabase products table
 */
async function insertProducts(products) {
    const batchSize = 50;
    let inserted = 0;

    console.log(`\nInserting ${products.length} products into products table...`);

    for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);

        const { data, error } = await supabase
            .from('products')
            .upsert(batch, {
                onConflict: 'url_slug',
                ignoreDuplicates: false
            });

        if (error) {
            console.error(`Insert error for batch ${i / batchSize + 1}:`, error.message);
        } else {
            inserted += batch.length;
            console.log(`Inserted batch ${i / batchSize + 1}: ${batch.length} products`);
        }

        await delay(200);
    }

    console.log(`\nTotal inserted: ${inserted} products`);
    return inserted;
}

/**
 * Main execution
 */
async function main() {
    console.log("=".repeat(50));
    console.log(`${BRAND_NAME} Product Scraper`);
    console.log("=".repeat(50));

    // Step 1: Fetch all products
    const rawProducts = await fetchAllProducts();

    if (rawProducts.length === 0) {
        console.log("No products found. Exiting.");
        return;
    }

    // Step 2: Process each product (upload image and transform)
    console.log("\nProcessing products and uploading images...");
    const processedProducts = [];

    for (let i = 0; i < rawProducts.length; i++) {
        const product = rawProducts[i];
        process.stdout.write(`\r[${i + 1}/${rawProducts.length}] Processing ${product.title?.substring(0, 40)}...`);

        // Upload image to Supabase
        const newThumbnailUrl = await uploadImageToSupabase(
            product.thumbnail,
            product.id
        );

        // Transform product
        const transformed = transformProduct(product, newThumbnailUrl);
        processedProducts.push(transformed);

        await delay(100);
    }

    console.log("\n");

    // Step 3: Save to JSON file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(processedProducts, null, 2));
    console.log(`Saved ${processedProducts.length} products to ${OUTPUT_FILE}`);

    // Step 4: Insert into Supabase
    await insertProducts(processedProducts);

    console.log("\n" + "=".repeat(50));
    console.log("Migration Complete!");
    console.log("=".repeat(50));
}

main().catch(console.error);
