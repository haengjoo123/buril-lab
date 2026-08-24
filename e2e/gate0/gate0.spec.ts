import { expect, test } from '@playwright/test'
import { fulfillStagingAccessRoute } from '../../scripts/gate0-access-route.mjs'
import { verifyGate0EnrichmentIsolation } from '../../scripts/gate0-enrichment-policy.mjs'

const E2E_EMAIL = process.env.GATE0_E2E_EMAIL || 'gate0-browser@burillab.test'
const E2E_PASSWORD = process.env.GATE0_E2E_PASSWORD || 'Local-Gate0-Only!2026'
const LAB_NAME = 'Gate0 합성 연구실'
const INVENTORY_NAME = 'Gate0 Synthetic Powder'
const STAGING_ORIGIN = 'https://staging.burillab.com'

test.beforeEach(async ({ context }) => {
  const clientId = process.env.STAGING_ACCESS_CLIENT_ID?.trim()
  const clientSecret = process.env.STAGING_ACCESS_CLIENT_SECRET?.trim()
  if (!clientId && !clientSecret) return
  if (!clientId || !clientSecret) {
    throw new Error('Both Staging Access service-token values are required together.')
  }

  await context.route(`${STAGING_ORIGIN}/**`, async (route) => {
    await fulfillStagingAccessRoute(route, { clientId, clientSecret })
  })
})

test('login → lab → inventory search → reviewed waste record → direct link', async ({ page }) => {
  let blockedEnrichmentRequests = 0
  await page.route('**/api/chemicals/enrich', async (route) => {
    blockedEnrichmentRequests += 1
    // Gate0 validates the core workflow without invoking the deployed
    // enrichment endpoint or any of its paid upstream providers.
    await route.abort('blockedbyclient')
  })

  await page.addInitScript(() => {
    window.localStorage.setItem('i18nextLng', 'ko')
    // Support the versioned Gate0 contract and the pre-Gate0 local snapshot.
    window.localStorage.setItem('buril:safety-acknowledgement', JSON.stringify({
      version: '2026-08-24.1',
      acknowledgedAt: '2026-08-24T00:00:00.000Z',
    }))
    window.localStorage.setItem('buril-safety-acknowledged', 'true')
  })

  await page.goto('/login?returnTo=%2Fapp%2Finventory')
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASSWORD)
  await page.locator('form').getByRole('button', { name: /로그인|log in/i }).click()
  await expect(page).toHaveURL(/\/app\/inventory/)

  const labSwitcher = page.getByRole('banner').getByTitle('연구실 / 개인공간 전환')
  await expect(labSwitcher).toBeVisible()
  await labSwitcher.click()
  await page.getByRole('button', { name: new RegExp(LAB_NAME) }).click()
  await expect(labSwitcher).toContainText(LAB_NAME)

  // A fresh synthetic user may show onboarding. Dismiss it through the real
  // UI rather than adding non-Gate0 onboarding fixtures to the seed.
  const skipOnboarding = page.getByRole('button', { name: /온보딩 건너뛰기|건너뛰기|skip onboarding|skip/i }).first()
  await skipOnboarding.waitFor({ state: 'visible', timeout: 2_000 }).then(
    () => skipOnboarding.click(),
    () => undefined,
  )

  const inventorySearch = page.locator('input[placeholder="시약명, 브랜드, CAS, 제품번호 검색"]:visible')
  await inventorySearch.fill(INVENTORY_NAME)
  await expect(page.getByRole('heading', { name: INVENTORY_NAME }).first()).toBeVisible()

  await page.getByRole('button', { name: '내용물 실제 폐기' }).click()
  const batchDialog = page.getByRole('dialog', { name: /폐액 배치/ })
  await expect(batchDialog).toBeVisible()
  await expect(batchDialog.getByText('BL-GATE0-001', { exact: false })).toBeVisible()

  await batchDialog.getByRole('button', { name: '라벨과 일치함 — 이 성분으로 확인' }).click()
  await batchDialog.getByRole('button', { name: `${INVENTORY_NAME} 수정` }).click()
  await batchDialog.getByRole('button', { name: '라벨·SDS 확인 완료' }).click()
  await batchDialog.getByLabel('실제로 폐기하는 용기 수').fill('1')
  const nextButton = batchDialog.getByRole('button', { name: '다음' })
  await expect(nextButton).toBeEnabled()
  await nextButton.click()
  await expect(batchDialog.getByText(/1\s*\/\s*1/).first()).toBeVisible()
  await batchDialog.getByRole('button', { name: '다음' }).click()

  const amountSuggestion = batchDialog.getByRole('button', { name: /재고의 명목 용량.*눌러서 적용/ })
  if (await amountSuggestion.isVisible()) await amountSuggestion.click()
  else await batchDialog.getByLabel('폐액 전체량').fill('100')
  await batchDialog.getByRole('button', { name: '다음' }).click()

  const containerDeposit = batchDialog.getByRole('button', { name: '폐액통 입고 기록' })
  await expect(batchDialog.getByText('폐액통 안내 가능')).toBeVisible()
  // Finalization is deliberately screen-only. No voice action is issued.
  await expect(containerDeposit).toBeVisible()
  await containerDeposit.click()

  const receipt = page.getByRole('dialog', { name: '처리 기록이 저장되었습니다.' })
  await expect(receipt).toBeVisible()
  await receipt.getByRole('button', { name: '기록 보기' }).click()
  await expect(page).toHaveURL(/\/app\/logs\?record=[0-9a-f-]{36}/)
  await expect(page.getByRole('heading', { name: '폐기 기록', level: 2 })).toBeVisible()
  const recordId = new URL(page.url()).searchParams.get('record')
  expect(recordId).toMatch(/^[0-9a-f-]{36}$/)
  const recordDetail = page.getByRole('main').locator('aside:visible').filter({ hasText: INVENTORY_NAME })
  await expect(recordDetail).toContainText(INVENTORY_NAME)
  await expect(recordDetail).toContainText(`ID: ${recordId?.slice(0, 12)}`)

  const directRecordUrl = page.url()
  await page.goto(directRecordUrl)
  await expect(page).toHaveURL(/\/app\/logs\?record=[0-9a-f-]{36}/)
  await expect(page.getByRole('main').locator('aside:visible').filter({ hasText: INVENTORY_NAME }))
    .toContainText(`ID: ${recordId?.slice(0, 12)}`)
  verifyGate0EnrichmentIsolation({
    featureFlag: process.env.VITE_ENABLE_CHEMICAL_ENRICHMENT,
    blockedRequests: blockedEnrichmentRequests,
  })
})
