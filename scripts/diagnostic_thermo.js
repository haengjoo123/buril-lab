
import { chromium } from 'playwright';

const NAV_TIMEOUT = 120000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

async function main() {
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
    const url = 'https://www.thermofisher.com/order/catalog/product/A2513802?SID=srch-srp-A2513802';
    
    console.log(`Diagnostic: Opening ${url}`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
        console.log("Page loaded. Extracting H1...");
        const h1 = await page.locator('h1').first().innerText();
        console.log(`H1 found: ${h1}`);
        
        console.log("Extracting JSON state...");
        const jsonData = await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            const stateScript = scripts.find(s => s.textContent.includes('_PRELOADED_STATE_'));
            if (stateScript) {
                const match = stateScript.textContent.match(/_PRELOADED_STATE_\s*=\s*({.*?});/s);
                return match ? JSON.parse(match[1]) : 'No match';
            }
            return 'No script found';
        });
        console.log("JSON extraction complete.");
        console.log(typeof jsonData === 'object' ? "Success: JSON is object" : `Failed: ${jsonData}`);
        
    } catch (e) {
        console.error(`DIAGNOSTIC FAILED: ${e.message}`);
    } finally {
        await browser.close();
    }
}

main();
