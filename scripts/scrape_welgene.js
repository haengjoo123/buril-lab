/**
 * WELGENE 제품 스크래핑 스크립트
 * - WELGENE 사이트에서 제품 정보를 수집
 * - 상품명 + 부차설명을 합쳐서 product_name으로 저장
 * - Supabase 테이블: products
 * - 중요: id 생성을 위해 crypto.randomUUID() 사용
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

// Node 환경에서 __dirname 정의
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const BASE_URL = 'https://www.welgene.com/mall';
const LIST_URL = 'https://www.welgene.com/mall/m_mall_list.php';
const BRAND_NAME = 'WELGENE';
const BRAND_SLUG = 'welgene';
const CATEGORY_ID = '02000000'; // Target Category (02000000: Molecular Biology, 01000000: Cell Culture)
const OUTPUT_FILE = path.join(process.cwd(), `src/data/welgene_products_${CATEGORY_ID}.json`);
const STORAGE_BUCKET = 'media-products';
const MAX_PAGES = 10; // 넉넉하게

// Supabase configuration
const SUPABASE_URL = 'https://zafxzidbtbryiksemlwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphZnh6aWRidGJyeWlrc2VtbHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTU1NzIsImV4cCI6MjA4MjI5MTU3Mn0.DEylxIGynOxzUC-mt5HwJt1gWOqG400QejvKxLdghhw';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper functions
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Download image and return buffer
 */
async function downloadImage(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 30000,
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
async function uploadToSupabase(imageBuffer, filename) {
    try {
        const ext = path.extname(filename) || '.jpg';
        const storagePath = `${BRAND_SLUG}/${path.basename(filename, ext)}${ext}`;

        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, imageBuffer, {
                contentType: 'image/jpeg',
                upsert: true,
            });

        if (error) {
            console.error(`Upload error for ${storagePath}:`, error.message);
            return null;
        }

        const { data: publicUrl } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(storagePath);

        return publicUrl.publicUrl;
    } catch (error) {
        console.error(`Supabase upload failed:`, error.message);
        return null;
    }
}

/**
 * Scrape a single page
 */
async function scrapePage(pageNum) {
    console.log(`Scraping page ${pageNum} (Category: ${CATEGORY_ID})...`);
    const url = `${LIST_URL}?ps_ctid=${CATEGORY_ID}&partner_id=&ps_page=&&ps_page=${pageNum}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        });

        const $ = cheerio.load(response.data);
        const products = [];

        // Selector Modified: Removed .product-list dependency, just look for compatible links
        $('a[href^="m_mall_detail.php"]').each((i, el) => {
            const $el = $(el);

            const description = $el.find('.category').text().trim();
            const baseName = $el.find('.subject').text().trim();
            const imgSrc = $el.find('.thumb img').attr('src');

            // Validate: Must have name and image to be a product card
            if (baseName && imgSrc) {
                const fullName = `${baseName} ${description}`.trim();

                let cleanImgSrc = imgSrc.replace(/^\.\//, '');
                if (!cleanImgSrc.startsWith('/')) cleanImgSrc = '/' + cleanImgSrc;
                const absoluteImgUrl = `https://www.welgene.com/mall${cleanImgSrc}`;

                const slug = `${BRAND_SLUG}-${baseName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;

                products.push({
                    brand: BRAND_NAME,
                    base_name: baseName,
                    description: description,
                    product_name: fullName,
                    original_img_url: absoluteImgUrl,
                    url_slug: slug,
                    product_numbers: [],
                });
            }
        });

        return products;
    } catch (error) {
        console.error(`Error scraping page ${pageNum}:`, error.message);
        return [];
    }
}

/**
 * Main execution
 */
async function main() {
    console.log(`Starting WELGENE scraping for Category ${CATEGORY_ID}...`);

    // 1. Scrape all pages
    let allProducts = [];
    for (let i = 1; i <= MAX_PAGES; i++) {
        const pageProducts = await scrapePage(i);

        if (pageProducts.length === 0) {
            console.log(`No products found on page ${i}. Stopping scrape.`);
            break;
        }

        allProducts = allProducts.concat(pageProducts);
        await delay(1000);
    }

    console.log(`\nTotal products found: ${allProducts.length}`);

    if (allProducts.length === 0) {
        console.log("Nothing to process. Exiting.");
        return;
    }

    // 2. Process images and upload
    console.log('\nProcessing images and uploading to Supabase...');
    const processedProducts = [];

    for (const product of allProducts) {
        console.log(`Processing: ${product.base_name}`);

        const imageBuffer = await downloadImage(product.original_img_url);
        let finalImageUrl = product.original_img_url;

        if (imageBuffer) {
            const filename = path.basename(product.original_img_url);
            const uploadUrl = await uploadToSupabase(imageBuffer, filename);
            if (uploadUrl) {
                finalImageUrl = uploadUrl;
            }
        }

        processedProducts.push({
            id: randomUUID(),
            brand: product.brand,
            product_name: product.product_name,
            product_numbers: product.product_numbers,
            thumbnail_url: finalImageUrl,
            url_slug: product.url_slug
        });

        await delay(500);
    }

    // 3. Save to JSON
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(processedProducts, null, 2));
    console.log(`Saved to ${OUTPUT_FILE}`);

    // 4. Insert to Supabase
    console.log('\nInserting into Supabase products table...');
    const batchSize = 50;
    let insertedCount = 0;

    for (let i = 0; i < processedProducts.length; i += batchSize) {
        const batch = processedProducts.slice(i, i + batchSize);

        const { error } = await supabase
            .from('products')
            .upsert(batch, {
                onConflict: 'url_slug',
                ignoreDuplicates: false
            });

        if (error) {
            console.error('Insert error:', error.message);
        } else {
            insertedCount += batch.length;
            console.log(`Inserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} items)`);
        }
    }

    console.log(`\nDone! Inserted ${insertedCount} products.`);
}

main().catch(console.error);
