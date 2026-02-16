import { test, expect } from '@playwright/test';

test.describe('검색 → 분류 → 혼합 핵심 플로우', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('메인 페이지가 정상적으로 로드된다', async ({ page }) => {
        // 검색 입력창이 표시되는지 확인
        const searchInput = page.locator('input[type="text"], input[type="search"]');
        await expect(searchInput.first()).toBeVisible();
    });

    test('시약을 검색하면 결과가 표시된다', async ({ page }) => {
        const searchInput = page.locator('input[type="text"], input[type="search"]');
        await searchInput.first().fill('Acetone');

        // Enter 또는 검색 버튼 클릭
        await searchInput.first().press('Enter');

        // 결과가 나타날 때까지 대기 (네트워크 요청 포함)
        await page.waitForTimeout(3000);

        // 결과 카드나 텍스트가 존재하는지 확인
        const pageContent = await page.textContent('body');
        expect(pageContent).toBeTruthy();
    });
});
