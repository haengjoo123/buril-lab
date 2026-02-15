import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const capturedRequests = [];

    page.on('request', request => {
        if (request.url().includes('api.') || request.url().includes('search')) {
            // Capture interesting requests
            if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
                capturedRequests.push({
                    url: request.url(),
                    method: request.method(),
                    postData: request.postData(),
                    headers: request.headers()
                });
            }
        }
    });

    page.on('response', async response => {
        try {
            const req = response.request();
            if ((req.resourceType() === 'xhr' || req.resourceType() === 'fetch') && response.url().includes('search')) {
                const json = await response.json();
                fs.writeFileSync('debug_api_response.json', JSON.stringify(json, null, 2));
                console.log("Saved debug_api_response.json from " + response.url());
            }
        } catch (e) { }
    });

    console.log("Navigating...");
    await page.goto('https://cacheby.com/search?q=&menu=products&facets=%7B%22categories%22%3A%22Media%22%7D', {
        waitUntil: 'networkidle2',
        timeout: 60000
    });

    fs.writeFileSync('debug_api_requests.json', JSON.stringify(capturedRequests, null, 2));
    console.log("Saved debug_api_requests.json");

    await browser.close();
})();
