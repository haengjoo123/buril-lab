import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    // Set a realistic User-Agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate
    console.log("Navigating...");
    await page.goto('https://cacheby.com/search?q=&menu=products&facets=%7B%22categories%22%3A%22Media%22%7D', {
        waitUntil: 'networkidle2',
        timeout: 60000
    });

    console.log("Waiting for content...");
    // Wait for something that looks like a product list. 
    // If we don't know the class, just wait a bit.
    await new Promise(r => setTimeout(r, 8000));

    console.log("Extracting HTML...");
    const html = await page.content();

    fs.writeFileSync('debug_page.html', html);
    console.log("Saved debug_page.html");

    await browser.close();
})();
