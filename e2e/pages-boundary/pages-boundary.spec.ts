import { expect, test as base, type Page } from '@playwright/test'
import { startPagesBoundaryLocal } from '../../scripts/pages-boundary-local.mjs'

type LocalPages = Awaited<ReturnType<typeof startPagesBoundaryLocal>>
type CspViolation = { directive: string; blockedKind: string }
declare global {
  interface Window {
    __boundaryViolations: CspViolation[]
    __boundaryInlineExecuted?: boolean
  }
}

const test = base.extend<{ unexpectedOutbound: string[] }, { localPages: LocalPages }>({
  localPages: [async ({ browserName }, provide) => {
    expect(browserName).toBe('chromium')
    const runtime = await startPagesBoundaryLocal()
    try { await provide(runtime) } finally { await runtime.close() }
  }, { scope: 'worker', timeout: 120_000 }],
  unexpectedOutbound: [async ({ context, localPages }, provide) => {
    const unexpected: string[] = []
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === localPages.origin) return route.continue()
      // Font rendering is not the subject of this offline test. Preserve the
      // actual CSP, but do not contact any public CDN or hosted Supabase server.
      if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'cdn.jsdelivr.net') {
        return route.fulfill({ contentType: 'text/css', body: '' })
      }
      unexpected.push(url.origin)
      return route.abort('blockedbyclient')
    })
    await context.routeWebSocket('**/*', (socket) => {
      unexpected.push(new URL(socket.url()).origin)
      socket.close()
    })
    await provide(unexpected)
    expect(unexpected, 'This local CSP suite must not reach a database, AI service, or remote API.').toEqual([])
  }, { auto: true }],
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'ko')
    localStorage.setItem('buril:safety-acknowledgement', JSON.stringify({
      version: '2026-08-24.1', acknowledgedAt: '2026-09-03T00:00:00.000Z',
    }))
    window.__boundaryViolations = []
    window.addEventListener('securitypolicyviolation', (event) => {
      // Only classifications are retained; never request query strings/bodies.
      const blockedKind = /^(?:inline|eval|data|blob)$/.test(event.blockedURI)
        ? event.blockedURI : event.blockedURI.split(':')[0]
      window.__boundaryViolations.push({ directive: event.effectiveDirective, blockedKind })
    })
  })
})

async function expectNoCspViolations(page: Page) {
  // Flush browser event delivery, without an arbitrary long sleep.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  expect(await page.evaluate(() => window.__boundaryViolations)).toEqual([])
}

test('unchanged Pages CSP permits login/search UI, synthetic camera preview, and voice UI', async ({ page, localPages }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.name))
  const response = await page.goto(`${localPages.origin}/login?returnTo=%2Fapp%2Finventory`)
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self' blob: 'wasm-unsafe-eval'")
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await page.getByRole('button', { name: '회원가입', exact: true }).first().click()
  await expect(page.locator('input[type="password"]')).toHaveCount(2)
  await page.getByRole('button', { name: '검색으로 돌아가기', exact: true }).click()
  await expect(page).toHaveURL(`${localPages.origin}/app`)
  await expect(page.locator('input[placeholder="시약명 (예: Acetone) 또는 CAS No."]:visible')).toBeVisible()

  await page.getByRole('button', { name: '말하기', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'AI 보이스 에이전트' })).toBeVisible()
  // Opening a voice sheet is not a recording or a request to a paid provider.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'AI 보이스 에이전트' })).toHaveCount(0)

  await page.getByRole('button', { name: '스캔하기', exact: true }).click()
  const camera = page.getByRole('dialog', { name: '라벨의 제품명 또는 CAS 번호가 잘 보이도록 맞춰주세요.' })
  await expect(camera).toBeVisible()
  await expect.poll(() => camera.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2)
  await camera.locator('input[type="file"]').setInputFiles({
    name: 'local-synthetic-pixel.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==', 'base64'),
  })
  const preview = page.getByRole('dialog', { name: '촬영된 이미지를 확인하세요.' })
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await preview.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(preview).toHaveCount(0)
  await expectNoCspViolations(page)
  expect(pageErrors).toEqual([])
})

test('Pages CSP permits local image/audio/blob Worker resources without contacting providers', async ({ page, localPages }) => {
  await page.goto(`${localPages.origin}/login`)
  await expect(page.locator('input[type="email"]')).toBeVisible()
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable.')
    context.fillStyle = '#336699'
    context.fillRect(0, 0, 16, 16)
    const photo = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Synthetic WebP could not be encoded.')),
      'image/webp', 0.8,
    ))
    const photoUrl = URL.createObjectURL(photo)
    const workerUrl = URL.createObjectURL(new Blob(['self.postMessage("local-csp-ok")'], { type: 'text/javascript' }))
    const worker = new Worker(workerUrl)
    const workerMessage = new Promise<string>((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data)
      worker.onerror = () => reject(new Error('Synthetic Worker failed.'))
    })
    try {
      const image = new Image()
      image.src = photoUrl
      await image.decode()
      const workerResult = await workerMessage
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      try {
        return { width: image.naturalWidth, mime: photo.type, workerResult, audioTracks: stream.getAudioTracks().length }
      } finally { stream.getTracks().forEach((track) => track.stop()) }
    } finally {
      worker.terminate()
      URL.revokeObjectURL(photoUrl)
      URL.revokeObjectURL(workerUrl)
    }
  })
  expect(result).toEqual({ width: 16, mime: 'image/webp', workerResult: 'local-csp-ok', audioTracks: 1 })
  await expectNoCspViolations(page)
})

test('CSP actually blocks inline scripts and unapproved script origins', async ({ page, localPages }) => {
  await page.goto(`${localPages.origin}/login`)
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expectNoCspViolations(page)
  await page.evaluate(() => {
    const inlineScript = document.createElement('script')
    inlineScript.textContent = 'window.__boundaryInlineExecuted = true'
    document.head.appendChild(inlineScript)
    const remoteScript = document.createElement('script')
    remoteScript.src = 'https://pages-boundary-blocked.invalid/not-loaded.js'
    document.head.appendChild(remoteScript)
  })
  await expect.poll(() => page.evaluate(() => window.__boundaryViolations.length)).toBeGreaterThanOrEqual(2)
  expect(await page.evaluate(() => window.__boundaryInlineExecuted)).toBeUndefined()
  const violations = await page.evaluate(() => window.__boundaryViolations)
  expect(violations).toContainEqual({ directive: 'script-src-elem', blockedKind: 'inline' })
  expect(violations).toContainEqual({ directive: 'script-src-elem', blockedKind: 'https' })
})

test('CSP permits the two exact canonical API origins from a different Pages origin', async ({ page, localPages }) => {
  const origins = ['https://burillab.com', 'https://staging.burillab.com']
  const intercepted: string[] = []
  for (const origin of origins) {
    // Fulfill locally before the network. No Access credential, user token,
    // database, paid provider or real canonical API is used by this test.
    await page.route(`${origin}/api/__local_csp_probe`, (route) => {
      intercepted.push(origin)
      return route.fulfill({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': localPages.origin },
        contentType: 'application/json',
        body: '{"localSyntheticProbe":true}',
      })
    })
  }
  await page.goto(`${localPages.origin}/login`)
  await expect(page.locator('input[type="email"]')).toBeVisible()
  for (const origin of origins) {
    const result = await page.evaluate(async (target) => {
      try {
        const response = await fetch(`${target}/api/__local_csp_probe`)
        return response.ok && (await response.json()).localSyntheticProbe === true
      } catch { return false }
    }, origin)
    expect(result, 'The static CSP must allow the exact canonical API configured in hosted builds.').toBe(true)
  }
  expect(intercepted).toEqual(origins)
  await expectNoCspViolations(page)

  const unapproved = await page.evaluate(async () => {
    try { await fetch('https://pages-boundary-blocked.invalid/api/probe'); return true }
    catch { return false }
  })
  expect(unapproved).toBe(false)
  await expect.poll(() => page.evaluate(() => window.__boundaryViolations.length)).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__boundaryViolations)).toContainEqual({ directive: 'connect-src', blockedKind: 'https' })
})
