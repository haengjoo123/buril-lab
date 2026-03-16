/**
 * Thermo Fisher Gibco 제품 스크래핑 스크립트 (상세페이지 기반)
 * - 각 제품의 상세페이지로 이동하여 정확한 Catalog Number와 고화질 이미지 수집
 * - 이미지는 다운로드 후 Supabase Storage에 업로드 (출처 은닉)
 * - 수집된 데이터를 Supabase products 테이블에 Upsert
 */

import { chromium } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// --- Configuration ---
const BASE_URL = 'https://www.thermofisher.com/search/browse/category/kr/ko/90445016?&resultPage=1&resultsPerPage=15';
const BRAND_NAME = 'Gibco';
const BRAND_SLUG = 'gibco';
const STORAGE_BUCKET = 'media-products';
const OUTPUT_FILE = path.join(process.cwd(), 'src/data/gibco_products.json');
const NAV_TIMEOUT = 120000;
const LIST_RETRIES = 3;
const DETAIL_RETRIES = 3;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
const TARGET_PRODUCTS = 592;

// Supabase configuration
const SUPABASE_URL = 'https://zafxzidbtbryiksemlwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphZnh6aWRidGJyeWlrc2VtbHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTU1NzIsImV4cCI6MjA4MjI5MTU3Mn0.DEylxIGynOxzUC-mt5HwJt1gWOqG400QejvKxLdghhw';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const normalizeName = (value) => value?.toString().toLowerCase().replace(/[^a-z0-9]+/g, '').trim() || '';
const normalizeCatNo = (value) => value?.toString().trim().toUpperCase() || '';
const normalizeCatNos = (values) => Array.from(new Set((Array.isArray(values) ? values : [values]).map(normalizeCatNo).filter(Boolean)));
const buildUrlSlug = (productName, productNumbers, fallback) => {
    const slugName = normalizeName(productName) || 'gibco-item';
    const primaryCatNo = normalizeCatNo(productNumbers?.[0]);
    return `${BRAND_SLUG}-${slugName}-${primaryCatNo || fallback}`;
};
const mergeProductData = (baseProduct, incomingProduct) => {
    const mergedCatNos = normalizeCatNos([
        ...(Array.isArray(baseProduct.product_numbers) ? baseProduct.product_numbers : []),
        ...(Array.isArray(incomingProduct.product_numbers) ? incomingProduct.product_numbers : [])
    ]);
    return {
        ...baseProduct,
        product_name: baseProduct.product_name || incomingProduct.product_name,
        product_numbers: mergedCatNos,
        thumbnail_url: baseProduct.thumbnail_url || incomingProduct.thumbnail_url || null,
        url_slug: baseProduct.url_slug || incomingProduct.url_slug
    };
};
const dedupeProducts = (products) => {
    const deduped = [];
    const productIndexByCatNo = new Map();
    const productIndexByName = new Map();

    for (const rawProduct of products) {
        const normalizedCatNos = normalizeCatNos(rawProduct.product_numbers);
        const normalizedName = normalizeName(rawProduct.product_name);

        let existingIndex;
        for (const catNo of normalizedCatNos) {
            if (productIndexByCatNo.has(catNo)) {
                existingIndex = productIndexByCatNo.get(catNo);
                break;
            }
        }
        if (existingIndex === undefined && normalizedName && productIndexByName.has(normalizedName)) {
            existingIndex = productIndexByName.get(normalizedName);
        }

        const productWithNormalizedFields = {
            ...rawProduct,
            product_numbers: normalizedCatNos,
            url_slug: rawProduct.url_slug || buildUrlSlug(rawProduct.product_name, normalizedCatNos, rawProduct.id?.slice(0, 8) || randomUUID().slice(0, 8))
        };

        if (existingIndex === undefined) {
            const index = deduped.length;
            deduped.push(productWithNormalizedFields);
            for (const catNo of normalizedCatNos) {
                productIndexByCatNo.set(catNo, index);
            }
            if (normalizedName) {
                productIndexByName.set(normalizedName, index);
            }
            continue;
        }

        const merged = mergeProductData(deduped[existingIndex], productWithNormalizedFields);
        deduped[existingIndex] = merged;
        for (const catNo of merged.product_numbers) {
            productIndexByCatNo.set(catNo, existingIndex);
        }
        const mergedName = normalizeName(merged.product_name);
        if (mergedName) {
            productIndexByName.set(mergedName, existingIndex);
        }
    }

    return { deduped, productIndexByCatNo, productIndexByName };
};

// Global Error Handlers to catch total crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

async function downloadImage(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': USER_AGENT
            }
        });
        return Buffer.from(response.data);
    } catch (error) {
        console.error(`  - Failed to download image: ${url}`);
        return null;
    }
}

async function uploadToSupabase(imageBuffer, productId) {
    try {
        const storagePath = `${BRAND_SLUG}/${productId}.jpg`;
        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, imageBuffer, {
                contentType: 'image/jpeg',
                upsert: true
            });

        if (error) throw error;

        const { data: publicUrl } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(storagePath);

        return publicUrl.publicUrl;
    } catch (error) {
        console.error(`  - Supabase upload failed:`, error.message);
        return null;
    }
}

const extractProductIdFromUrl = (productUrl) => {
    const match = productUrl.match(/(?:\/product\/|\/order\/catalog\/product\/)([A-Z0-9-]+)\b/i);
    return match ? match[1].toUpperCase() : null;
};

const isLikelyBlocked = (text) => {
    if (!text) return false;
    return /access denied|request blocked|robot|captcha|unusual traffic|service unavailable|temporarily unavailable|appreciate your business|sorry, our website/i.test(text);
};

async function gotoWithRetry(page, url, retries, label) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
            await page.waitForTimeout(1000);
            const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 2000) : '');
            if (isLikelyBlocked(bodyText)) {
                throw new Error(`Blocked content detected on ${label}`);
            }
            if (response && response.status() >= 400) {
                throw new Error(`HTTP ${response.status()} on ${label}`);
            }
            return;
        } catch (error) {
            if (attempt === retries) {
                throw error;
            }
            await delay(3000);
        }
    }
}

async function scrapeDetailPage(page, productUrl) {
    console.log(`  - Opening detail page: ${productUrl}`);
    try {
        await gotoWithRetry(page, productUrl, DETAIL_RETRIES, 'detail');
        
        // Wait for core content (Specifications or Catalog numbers)
        await page.waitForSelector('.product-specifications, .product-atc-table', { timeout: 20000 }).catch(() => null);
        await delay(1000);

        // 1. Extract Full Product Name
        const fullName = await page.locator('h1').innerText().catch(() => null);

        // 2. Extract Data from _PRELOADED_STATE_ (Highest Reliability)
        const jsonData = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            const stateScript = scripts.find(s => s.textContent.includes('_PRELOADED_STATE_'));
            if (stateScript) {
                try {
                    const match = stateScript.textContent.match(/_PRELOADED_STATE_\s*=\s*({.*?});/s);
                    if (match) return JSON.parse(match[1]);
                } catch (e) { return null; }
            }
            return null;
        });

        let catNos = [];
        let highResImgUrl = null;

        if (jsonData) {
            // Traverse common Thermo Fisher JSON paths
            try {
                const product = jsonData.product || jsonData.pdpData?.product;
                if (product) {
                    // Extract Catalog Numbers from variations/skus
                    const variants = product.variations || product.skus || [];
                    catNos = variants.map(v => v.catalogNumber || v.sku).filter(Boolean);
                    
                    // If no variations, at least get the primary one
                    if (catNos.length === 0 && (product.catalogNumber || product.sku)) {
                        catNos = [product.catalogNumber || product.sku];
                    }
                    
                    // Extract Image
                    highResImgUrl = product.imageFull || product.primaryImage || product.imageUrl;
                }
            } catch (e) { console.error("  - JSON parsing error:", e.message); }
        }

        // 3. Fallback to DOM if JSON failed
        if (catNos.length === 0) {
            catNos = await page.evaluate(() => {
                const results = new Set();
                
                // Specific Catalog Number field in header
                const headerCat = document.querySelector('.product-header-catalog-number, .catalog-number');
                if (headerCat) results.add(headerCat.innerText.trim());

                const tableRows = document.querySelectorAll('.pdp-table-product-selector table tr, .product-atc-table tr');
                tableRows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    cells.forEach(cell => {
                        const text = cell.innerText.trim();
                        if (/^[0-9]{8}$/.test(text) || /^[A-Z0-9-]{5,12}$/.test(text)) {
                            if (!['Quantity', 'Price', 'Availability', 'Unit Size', 'Catalog Number'].includes(text)) {
                                results.add(text);
                            }
                        }
                    });
                });
                return Array.from(results);
            });
        }
        
        // Final fallback: Use part of URL if still empty
        if (catNos.length === 0) {
            const extracted = extractProductIdFromUrl(productUrl);
            if (extracted) catNos = [extracted];
        }

        if (!highResImgUrl) {
            highResImgUrl = await page.evaluate(() => {
                const img = document.querySelector('img.pdp-item-image, .product-hero-image img, #product-main-image');
                return img ? img.src : null;
            });
        }

        return { fullName, highResImgUrl, catNos };
    } catch (error) {
        console.error(`  - Error on detail page: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log("=".repeat(60));
    console.log("Thermo Fisher Gibco Product Scraper (Detail Page Mode)");
    console.log("=".repeat(60));

    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext({
        userAgent: USER_AGENT,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul'
    });
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = await context.newPage();

    let allProducts = [];
    let currentPage = 1;
    let hasMore = true;
    let processedUrls = new Set();

    // Command line arguments for limiting search
    const limitArg = process.argv.indexOf('--limit');
    const productLimit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1]) : 10000;
    
    const startPageArg = process.argv.indexOf('--startPage');
    const endPageArg = process.argv.indexOf('--endPage');
    
    let startPage = startPageArg !== -1 ? parseInt(process.argv[startPageArg + 1]) : 1;
    let endPage = endPageArg !== -1 ? parseInt(process.argv[endPageArg + 1]) : 40;

    const CHUNK_ID = startPageArg !== -1 ? `_chunk_${startPage}_${endPage}` : '';
    const CHUNK_FILE = path.join(process.cwd(), `src/data/gibco_products${CHUNK_ID}.json`);
    const ACTIVE_FILE = startPageArg !== -1 ? CHUNK_FILE : OUTPUT_FILE;
    const fallbackLoadFile = startPageArg !== -1 ? OUTPUT_FILE : null;

    const loadFromFile = (targetFile) => {
        if (!targetFile || !fs.existsSync(targetFile)) return false;
        try {
            const existing = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
            allProducts = existing;
            console.log(`Loaded ${allProducts.length} existing products from backup: ${path.basename(targetFile)}`);
            return true;
        } catch (e) {
            return false;
        }
    };

    if (!loadFromFile(ACTIVE_FILE)) {
        if (!loadFromFile(fallbackLoadFile)) {
            console.log("Could not load existing backup, starting fresh.");
        }
    }

    const loadedCount = allProducts.length;
    const dedupedState = dedupeProducts(allProducts);
    allProducts = dedupedState.deduped;
    const productIndexByCatNo = dedupedState.productIndexByCatNo;
    const productIndexByName = dedupedState.productIndexByName;
    if (allProducts.length !== loadedCount) {
        fs.writeFileSync(ACTIVE_FILE, JSON.stringify(allProducts, null, 2));
    }
    let processedTotal = allProducts.length;
    currentPage = startPage;
    const totalPages = endPage; 
    let currentBrowserItemCount = 0;

    const saveBackup = () => {
        fs.writeFileSync(ACTIVE_FILE, JSON.stringify(allProducts, null, 2));
    };

    let currentBrowser = browser;
    let currentContext = context;
    let currentPageObj = page;

    while (currentPage <= totalPages && processedTotal < productLimit) {
        const listUrl = `https://www.thermofisher.com/search/browse/category/kr/ko/90445016?&resultPage=${currentPage}&resultsPerPage=15`;
        console.log(`\nNavigating to List Page ${currentPage}/${totalPages}: ${listUrl}`);

        try {
            // Recycle browser every 20 products for maximum stability
            if (currentBrowserItemCount >= 20) {
                console.log("Recycling browser context to prevent memory leaks...");
                await currentBrowser.close().catch(() => {});
                currentBrowser = await chromium.launch({
                    headless: true,
                    args: ['--disable-blink-features=AutomationControlled']
                });
                currentContext = await currentBrowser.newContext({
                    userAgent: USER_AGENT,
                    locale: 'ko-KR',
                    timezoneId: 'Asia/Seoul'
                });
                await currentContext.addInitScript(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                });
                currentPageObj = await currentContext.newPage();
                currentBrowserItemCount = 0;
            }

            await gotoWithRetry(currentPageObj, listUrl, LIST_RETRIES, 'list');
            const productUrls = new Set();
            const scopedLinks = await currentPageObj.locator('.search-card a[href]').all();
            const fallbackLinks = scopedLinks.length === 0
                ? await currentPageObj.locator('a[href*="/order/catalog/product/"], a[href*="/product/"]').all()
                : scopedLinks;
            for (const link of fallbackLinks) {
                const href = await link.getAttribute('href');
                if (!href) continue;
                const url = href.startsWith('http') ? href : `https://www.thermofisher.com${href}`;
                if (url.includes('/order/catalog/product/') || url.includes('/product/')) {
                    productUrls.add(url);
                }
            }
            if (productUrls.size === 0) {
                currentPage++;
                continue;
            }

            for (const pUrl of productUrls) {
                if (processedTotal >= productLimit) break;
                
                const pId = extractProductIdFromUrl(pUrl);
                const isAlreadyProcessed = pId ? productIndexByCatNo.has(pId) : false;
                
                if (isAlreadyProcessed || processedUrls.has(pUrl)) continue;
                processedUrls.add(pUrl);
                
                console.log(`\n[${processedTotal + 1}] Processing URL: ${pUrl}`);
                
                let detailData = null;
                for (let retry = 0; retry < DETAIL_RETRIES; retry++) {
                    try {
                        detailData = await scrapeDetailPage(currentPageObj, pUrl);
                        if (detailData && detailData.fullName) break;
                    } catch (e) {
                        console.error(`  - Detail page attempt ${retry+1} failed: ${e.message}`);
                    }
                    await delay(3000);
                }
                
                if (detailData && detailData.fullName) {
                    const normalizedCatNos = normalizeCatNos(detailData.catNos);
                    const normalizedName = normalizeName(detailData.fullName);
                    if (normalizedCatNos.length === 0 && !normalizedName) {
                        continue;
                    }
                    const existingCatNo = normalizedCatNos.find(catNo => productIndexByCatNo.has(catNo));
                    const existingIndex = existingCatNo
                        ? productIndexByCatNo.get(existingCatNo)
                        : (normalizedName && productIndexByName.has(normalizedName) ? productIndexByName.get(normalizedName) : undefined);
                    let finalImageUrl = null;
                    if (detailData.highResImgUrl) {
                        const fullImgUrl = detailData.highResImgUrl.startsWith('http') ? detailData.highResImgUrl : `https:${detailData.highResImgUrl}`;
                        const buffer = await downloadImage(fullImgUrl);
                        if (buffer) {
                            const id = randomUUID();
                            finalImageUrl = await uploadToSupabase(buffer, id);
                        }
                    }

                    if (existingIndex !== undefined) {
                        const mergedProduct = mergeProductData(allProducts[existingIndex], {
                            ...allProducts[existingIndex],
                            product_name: allProducts[existingIndex].product_name || detailData.fullName,
                            product_numbers: normalizedCatNos,
                            thumbnail_url: finalImageUrl || allProducts[existingIndex].thumbnail_url
                        });
                        allProducts[existingIndex] = mergedProduct;
                        for (const catNo of mergedProduct.product_numbers) {
                            productIndexByCatNo.set(catNo, existingIndex);
                        }
                        const mergedName = normalizeName(mergedProduct.product_name);
                        if (mergedName) {
                            productIndexByName.set(mergedName, existingIndex);
                        }
                        try {
                            await supabase.from('products').upsert(mergedProduct, { onConflict: 'url_slug' });
                        } catch (e) {
                            console.error(`  - Supabase upsert error:`, e.message);
                        }
                        saveBackup();
                        continue;
                    }

                    const productId = randomUUID();
                    const productData = {
                        id: productId,
                        brand: BRAND_NAME,
                        product_name: detailData.fullName,
                        product_numbers: normalizedCatNos,
                        thumbnail_url: finalImageUrl,
                        url_slug: buildUrlSlug(detailData.fullName, normalizedCatNos, productId.substring(0, 8))
                    };

                    const newIndex = allProducts.length;
                    allProducts.push(productData);
                    console.log(`  + Extracted: ${detailData.fullName} (${detailData.catNos.length} options)`);
                    for (const catNo of normalizedCatNos) {
                        productIndexByCatNo.set(catNo, newIndex);
                    }
                    if (normalizedName) {
                        productIndexByName.set(normalizedName, newIndex);
                    }

                    try {
                        await supabase.from('products').upsert(productData, { onConflict: 'url_slug' });
                    } catch (e) {
                        console.error(`  - Supabase upsert error:`, e.message);
                    }
                    
                    processedTotal = allProducts.length;
                    currentBrowserItemCount++;
                    saveBackup();
                    
                    const percent = Math.round((processedTotal / TARGET_PRODUCTS) * 100);
                    console.log(`  [Progress: ${processedTotal}/${TARGET_PRODUCTS} - ${percent}%]`);
                    
                    await delay(1000);
                }
            }
            currentPage++;

        } catch (error) {
            console.error(`Fatal error on page ${currentPage}:`, error.message);
            currentPage++;
            await delay(5000);
        }
    }

    await currentBrowser.close();
    console.log(`\nScraping complete! Total products: ${allProducts.length}`);
}

main().catch(console.error);
