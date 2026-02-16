import { test as setup, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authFile = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');

setup('authenticate', async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;

    if (!email || !password) {
        throw new Error(
            'E2E_TEST_EMAIL and E2E_TEST_PASSWORD environment variables must be set.\n' +
            'Create a .env.e2e file or set them in your shell:\n' +
            '  $env:E2E_TEST_EMAIL = "test@example.com"\n' +
            '  $env:E2E_TEST_PASSWORD = "your-password"'
        );
    }

    // 1. Navigate to the app — should show AuthView
    await page.goto('/');

    // 2. Wait for the login form to appear
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible({ timeout: 15_000 });

    // 3. Fill in credentials
    await emailInput.fill(email);
    await page.locator('input[type="password"]').first().fill(password);

    // 4. Click the login/submit button
    await page.locator('button[type="submit"]').click();

    // 5. Wait for auth to complete — search input should appear after login
    const searchInput = page.locator('input[type="text"], input[type="search"]');
    await expect(searchInput.first()).toBeVisible({ timeout: 15_000 });

    // 6. Save authenticated state
    await page.context().storageState({ path: authFile });
});
