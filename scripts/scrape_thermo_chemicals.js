import { chromium } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const CATEGORY_ID = '80013462';
const BASE_URL = `https://www.thermofisher.com/search/browse/category/kr/ko/${CATEGORY_ID}`;
const DEFAULT_BRAND_NAME = 'Thermo Fisher';
const BRAND_SLUG = 'thermo-chemicals';
const STORAGE_BUCKET = 'media-products';
const OUTPUT_FILE = path.join(process.cwd(), 'src/data/thermo_chemicals_products.json');
const NAV_TIMEOUT = 120000;
const LIST_RETRIES = 3;
const DETAIL_RETRIES = 3;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';
const TARGET_PRODUCTS = 1000;
const FALLBACK_TOTAL_PAGES = 9;

const SUPABASE_URL = 'https://zafxzidbtbryiksemlwc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphZnh6aWRidGJyeWlrc2VtbHdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3MTU1NzIsImV4cCI6MjA4MjI5MTU3Mn0.DEylxIGynOxzUC-mt5HwJt1gWOqG400QejvKxLdghhw';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const normalizeName = (value) => value?.toString().toLowerCase().replace(/[^a-z0-9]+/g, '').trim() || '';
const normalizeCatNo = (value) => value?.toString().trim().toUpperCase() || '';
const normalizeCatNos = (values) => Array.from(new Set((Array.isArray(values) ? values : [values]).map(normalizeCatNo).filter(Boolean)));
const resolveBrand = (currentBrand, incomingBrand) => {
    const current = currentBrand?.toString().trim();
    const incoming = incomingBrand?.toString().trim();
    if (!incoming) return current || DEFAULT_BRAND_NAME;
    if (!current || current === DEFAULT_BRAND_NAME) return incoming;
    return current;
};
const buildListUrl = (page) => `${BASE_URL}?&resultPage=${page}&resultsPerPage=15`;
const buildUrlSlug = (brandName, productName, productNumbers, fallback) => {
    const brandSlug = normalizeName(brandName) || BRAND_SLUG;
    const slugName = normalizeName(productName) || 'thermo-item';
    const primaryCatNo = normalizeCatNo(productNumbers?.[0]);
    return `${brandSlug}-${slugName}-${primaryCatNo || fallback}`;
};

const mergeProductData = (baseProduct, incomingProduct) => {
    const mergedCatNos = normalizeCatNos([
        ...(Array.isArray(baseProduct.product_numbers) ? baseProduct.product_numbers : []),
        ...(Array.isArray(incomingProduct.product_numbers) ? incomingProduct.product_numbers : [])
    ]);
    return {
        ...baseProduct,
        brand: resolveBrand(baseProduct.brand, incomingProduct.brand),
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
            brand: rawProduct.brand || DEFAULT_BRAND_NAME,
            product_numbers: normalizedCatNos,
            url_slug: rawProduct.url_slug || buildUrlSlug(rawProduct.brand || DEFAULT_BRAND_NAME, rawProduct.product_name, normalizedCatNos, rawProduct.id?.slice(0, 8) || randomUUID().slice(0, 8))
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
            headers: { 'User-Agent': USER_AGENT }
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
        const { error } = await supabase.storage
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
        console.error('  - Supabase upload failed:', error.message);
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

async function detectTotalPages(page) {
    try {
        return await page.evaluate(() => {
            const candidates = new Set();
            const selectors = [
                'a[href*="resultPage="]',
                '[data-page]',
                '.pagination a',
                '.pagination li',
                '.search-pagination a'
            ];

            for (const selector of selectors) {
                const elements = Array.from(document.querySelectorAll(selector));
                for (const el of elements) {
                    const href = el.getAttribute('href') || '';
                    const pageMatch = href.match(/resultPage=(\d+)/i);
                    if (pageMatch) {
                        candidates.add(Number(pageMatch[1]));
                    }

                    const dataPage = el.getAttribute('data-page');
                    if (dataPage && /^\d+$/.test(dataPage)) {
                        candidates.add(Number(dataPage));
                    }

                    const text = (el.textContent || '').trim();
                    if (/^\d+$/.test(text)) {
                        candidates.add(Number(text));
                    }
                }
            }

            const bodyText = document.body?.innerText || '';
            const pageOfMatch = bodyText.match(/(?:page|페이지)\s*\d+\s*(?:of|\/)\s*(\d+)/i);
            if (pageOfMatch) {
                candidates.add(Number(pageOfMatch[1]));
            }

            const validPages = Array.from(candidates).filter(value => Number.isInteger(value) && value > 0 && value < 500);
            return validPages.length > 0 ? Math.max(...validPages) : null;
        });
    } catch {
        return null;
    }
}

async function scrapeDetailPage(page, productUrl) {
    console.log(`  - Opening detail page: ${productUrl}`);
    try {
        await gotoWithRetry(page, productUrl, DETAIL_RETRIES, 'detail');
        await page.waitForSelector('.product-specifications, .product-atc-table', { timeout: 20000 }).catch(() => null);
        await delay(1000);

        const fullName = await page.locator('h1').innerText().catch(() => null);
        const jsonData = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            const stateScript = scripts.find(s => s.textContent.includes('_PRELOADED_STATE_'));
            if (stateScript) {
                try {
                    const match = stateScript.textContent.match(/_PRELOADED_STATE_\s*=\s*({.*?});/s);
                    if (match) return JSON.parse(match[1]);
                } catch (e) {
                    return null;
                }
            }
            return null;
        });

        let catNos = [];
        let highResImgUrl = null;
        let brandName = null;

        if (jsonData) {
            try {
                const product = jsonData.product || jsonData.pdpData?.product;
                if (product) {
                    const variants = product.variations || product.skus || [];
                    catNos = variants.map(v => v.catalogNumber || v.sku).filter(Boolean);
                    if (catNos.length === 0 && (product.catalogNumber || product.sku)) {
                        catNos = [product.catalogNumber || product.sku];
                    }
                    highResImgUrl = product.imageFull || product.primaryImage || product.imageUrl;
                    brandName =
                        product.brandName ||
                        product.brand ||
                        product.manufacturerName ||
                        product.manufacturer?.name ||
                        null;
                }
            } catch (e) {
                console.error('  - JSON parsing error:', e.message);
            }
        }

        if (!brandName) {
            brandName = await page.evaluate(() => {
                const selectors = [
                    '.pdp-product-brand a',
                    '.pdp-product-brand',
                    '.product-brand a',
                    '.product-brand',
                    '.pdp-header-brand a',
                    '.pdp-header-brand',
                    '.product-header-brand a',
                    '.product-header-brand'
                ];
                for (const selector of selectors) {
                    const el = document.querySelector(selector);
                    const text = el?.textContent?.trim();
                    if (text) return text;
                }

                const titleEl = document.querySelector('h1');
                if (!titleEl) return null;
                const parent = titleEl.parentElement;
                if (!parent) return null;

                const textCandidates = Array.from(parent.querySelectorAll('a, span, div'))
                    .map(el => el.textContent?.trim())
                    .filter(Boolean)
                    .filter(text => text.length <= 50);

                const likelyBrand = textCandidates.find(text => /™|®/.test(text))
                    || textCandidates.find(text => /^[A-Za-z0-9&\-\s.]{2,40}$/.test(text));
                return likelyBrand || null;
            });
        }

        if (catNos.length === 0) {
            catNos = await page.evaluate(() => {
                const results = new Set();
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

        return { fullName, highResImgUrl, catNos, brandName: brandName || DEFAULT_BRAND_NAME };
    } catch (error) {
        console.error(`  - Error on detail page: ${error.message}`);
        return null;
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('Thermo Fisher Chemicals Product Scraper (Detail Page Mode)');
    console.log('='.repeat(60));

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
    const processedUrls = new Set();

    const limitArg = process.argv.indexOf('--limit');
    const diagnosticsMode = process.argv.includes('--diagnostics');
    const productLimit = limitArg !== -1 ? parseInt(process.argv[limitArg + 1]) : 10000;
    const startPageArg = process.argv.indexOf('--startPage');
    const endPageArg = process.argv.indexOf('--endPage');
    const targetProductsArg = process.argv.indexOf('--targetProducts');

    const startPage = startPageArg !== -1 ? parseInt(process.argv[startPageArg + 1]) : 1;
    let endPage = endPageArg !== -1 ? parseInt(process.argv[endPageArg + 1]) : FALLBACK_TOTAL_PAGES;
    const targetProducts = targetProductsArg !== -1 ? parseInt(process.argv[targetProductsArg + 1]) : TARGET_PRODUCTS;

    const chunkId = startPageArg !== -1 ? `_chunk_${startPage}_${endPage}` : '';
    const chunkFile = path.join(process.cwd(), `src/data/thermo_chemicals_products${chunkId}.json`);
    const activeFile = startPageArg !== -1 ? chunkFile : OUTPUT_FILE;
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

    if (!loadFromFile(activeFile)) {
        if (!loadFromFile(fallbackLoadFile)) {
            console.log('Could not load existing backup, starting fresh.');
        }
    }

    const loadedCount = allProducts.length;
    const dedupedState = dedupeProducts(allProducts);
    allProducts = dedupedState.deduped;
    const productIndexByCatNo = dedupedState.productIndexByCatNo;
    const productIndexByName = dedupedState.productIndexByName;
    if (allProducts.length !== loadedCount) {
        fs.writeFileSync(activeFile, JSON.stringify(allProducts, null, 2));
    }

    let processedTotal = allProducts.length;
    currentPage = startPage;
    let currentBrowserItemCount = 0;

    const saveBackup = () => {
        fs.writeFileSync(activeFile, JSON.stringify(allProducts, null, 2));
    };

    let currentBrowser = browser;
    let currentContext = context;
    let currentPageObj = page;
    let emptyListPageStreak = 0;
    const allListProductUrls = new Set();
    const stats = {
        loadedExisting: allProducts.length,
        visitedPages: 0,
        pagesWithoutLinks: 0,
        uniqueListUrls: 0,
        skippedByCatalogIndex: 0,
        skippedByDuplicateUrl: 0,
        skippedByInvalidDetail: 0,
        skippedByEmptyIdentity: 0,
        mergedExisting: 0,
        insertedNew: 0
    };

    if (endPageArg === -1) {
        try {
            const firstListUrl = buildListUrl(startPage);
            await gotoWithRetry(currentPageObj, firstListUrl, LIST_RETRIES, 'list');
            const detectedPages = await detectTotalPages(currentPageObj);
            if (detectedPages && detectedPages >= startPage) {
                endPage = detectedPages;
            }
            console.log(`Detected total pages: ${endPage}`);
        } catch (error) {
            console.log(`Failed to auto-detect pages, fallback to ${endPage}: ${error.message}`);
        }
    }

    while (currentPage <= endPage && processedTotal < productLimit) {
        const listUrl = buildListUrl(currentPage);
        console.log(`\nNavigating to List Page ${currentPage}/${endPage}: ${listUrl}`);
        stats.visitedPages++;

        try {
            if (currentBrowserItemCount >= 20) {
                console.log('Recycling browser context to prevent memory leaks...');
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
                    allListProductUrls.add(url);
                }
            }

            if (productUrls.size === 0) {
                stats.pagesWithoutLinks++;
                emptyListPageStreak++;
                if (endPageArg === -1 && emptyListPageStreak >= 2) {
                    console.log('No product links found in consecutive pages. Stopping early.');
                    break;
                }
                currentPage++;
                continue;
            }
            emptyListPageStreak = 0;

            for (const pUrl of productUrls) {
                if (processedTotal >= productLimit) break;

                const pId = extractProductIdFromUrl(pUrl);
                const isAlreadyProcessed = pId ? productIndexByCatNo.has(pId) : false;
                if (isAlreadyProcessed) {
                    stats.skippedByCatalogIndex++;
                    continue;
                }
                if (processedUrls.has(pUrl)) {
                    stats.skippedByDuplicateUrl++;
                    continue;
                }
                processedUrls.add(pUrl);

                console.log(`\n[${processedTotal + 1}] Processing URL: ${pUrl}`);

                let detailData = null;
                for (let retry = 0; retry < DETAIL_RETRIES; retry++) {
                    try {
                        detailData = await scrapeDetailPage(currentPageObj, pUrl);
                        if (detailData && detailData.fullName) break;
                    } catch (e) {
                        console.error(`  - Detail page attempt ${retry + 1} failed: ${e.message}`);
                    }
                    await delay(3000);
                }

                if (!detailData || !detailData.fullName) {
                    stats.skippedByInvalidDetail++;
                    continue;
                }

                const normalizedCatNos = normalizeCatNos(detailData.catNos);
                const normalizedName = normalizeName(detailData.fullName);
                if (normalizedCatNos.length === 0 && !normalizedName) {
                    stats.skippedByEmptyIdentity++;
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
                        finalImageUrl = await uploadToSupabase(buffer, randomUUID());
                    }
                }

                if (existingIndex !== undefined) {
                    const mergedProduct = mergeProductData(allProducts[existingIndex], {
                        ...allProducts[existingIndex],
                        brand: resolveBrand(allProducts[existingIndex].brand, detailData.brandName),
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
                        console.error('  - Supabase upsert error:', e.message);
                    }
                    saveBackup();
                    stats.mergedExisting++;
                    continue;
                }

                const productId = randomUUID();
                const productData = {
                    id: productId,
                    brand: detailData.brandName || DEFAULT_BRAND_NAME,
                    product_name: detailData.fullName,
                    product_numbers: normalizedCatNos,
                    thumbnail_url: finalImageUrl,
                    url_slug: buildUrlSlug(detailData.brandName || DEFAULT_BRAND_NAME, detailData.fullName, normalizedCatNos, productId.substring(0, 8))
                };

                const newIndex = allProducts.length;
                allProducts.push(productData);
                console.log(`  + Extracted: [${productData.brand}] ${detailData.fullName} (${detailData.catNos.length} options)`);
                for (const catNo of normalizedCatNos) {
                    productIndexByCatNo.set(catNo, newIndex);
                }
                if (normalizedName) {
                    productIndexByName.set(normalizedName, newIndex);
                }

                try {
                    await supabase.from('products').upsert(productData, { onConflict: 'url_slug' });
                } catch (e) {
                    console.error('  - Supabase upsert error:', e.message);
                }

                processedTotal = allProducts.length;
                currentBrowserItemCount++;
                saveBackup();
                stats.insertedNew++;

                const percent = Math.round((processedTotal / targetProducts) * 100);
                console.log(`  [Progress: ${processedTotal}/${targetProducts} - ${percent}%]`);

                await delay(1000);
            }

            currentPage++;
        } catch (error) {
            console.error(`Fatal error on page ${currentPage}:`, error.message);
            currentPage++;
            await delay(5000);
        }
    }

    await currentBrowser.close();
    stats.uniqueListUrls = allListProductUrls.size;
    console.log(`\nScraping complete! Total products: ${allProducts.length}`);
    if (diagnosticsMode) {
        console.log('='.repeat(60));
        console.log('Diagnostics Summary');
        console.log(`- Loaded existing: ${stats.loadedExisting}`);
        console.log(`- Visited pages: ${stats.visitedPages}`);
        console.log(`- Pages without links: ${stats.pagesWithoutLinks}`);
        console.log(`- Unique list product URLs: ${stats.uniqueListUrls}`);
        console.log(`- Skipped by existing catalog index: ${stats.skippedByCatalogIndex}`);
        console.log(`- Skipped by duplicate URL in run: ${stats.skippedByDuplicateUrl}`);
        console.log(`- Skipped by invalid detail: ${stats.skippedByInvalidDetail}`);
        console.log(`- Skipped by empty identity: ${stats.skippedByEmptyIdentity}`);
        console.log(`- Merged existing records: ${stats.mergedExisting}`);
        console.log(`- Inserted new records: ${stats.insertedNew}`);
        console.log(`- Final records: ${allProducts.length}`);
        console.log('='.repeat(60));
    }
}

main().catch(console.error);
