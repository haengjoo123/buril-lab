import { expect, test, type Page } from '@playwright/test';

const fixture = '/e2e/adaptive/fixture.html';
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('i18nextLng', 'ko'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4199') return route.continue();
    if (url.origin === 'http://127.0.0.1:54321') {
      // No live credentials or remote writes; every service call is contained here.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && /\/rest\/v1\/(inventory_items|cabinet_items|waste_logs|waste_log_items)$/.test(url.pathname)) {
        errors.push(`Unexpected mutation during layout change: ${route.request().method()} ${url.pathname}`);
      }
      if (url.pathname.endsWith('/waste_logs')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/1' }, body: JSON.stringify([{
        id: '22222222-2222-4222-8222-222222222222', created_at: new Date().toISOString(), chemicals: [],
        disposal_category: 'ORGANIC_NON_HALOGEN', total_volume_ml: 100, handler_name: 'Adaptive handler', memo: 'Retained log selection', schema_version: 1,
      }]) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: '[]' });
    }
    return route.abort();
  });
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

test('cabinet editor draft and Canvas identity survive repeated resizing', async ({ page }) => {
  await page.setViewportSize({ width: 840, height: 850 });
  await page.goto(`${fixture}?screen=cabinet`);
  const detail = page.locator('.fridge-panes [data-pane="detail"]');
  const notes = detail.locator('textarea').first();
  await expect(notes).toBeVisible();
  await notes.fill('Cabinet draft retained');
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.locator('canvas').evaluate(canvas => canvas.setAttribute('data-original-canvas', 'true'));
  for (const width of [360, 768, 430, 1280]) {
    await page.setViewportSize({ width, height: 750 });
    await expect(notes).toHaveValue('Cabinet draft retained');
    await expect(page.locator('canvas[data-original-canvas="true"]')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 360, height: 750 });
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: '화면 맞춤', exact: true })).toBeVisible();
});

test('waste log auto selection stays on the list until explicitly opened', async ({ page }) => {
  await page.setViewportSize({ width: 840, height: 850 });
  await page.goto(`${fixture}?screen=logs`);
  const list = page.locator('[data-pane="primary"]');
  await list.getByRole('button', { name: /1건/ }).click();
  await expect(list.getByText('Adaptive handler').first()).toBeVisible();
  await page.setViewportSize({ width: 360, height: 750 });
  await expect(list).toBeVisible();
  await list.getByText('Adaptive handler').first().click();
  for (const width of [840, 360, 1280, 430]) {
    await page.setViewportSize({ width, height: 750 });
    await expect(page.locator('[data-pane="detail"]')).toContainText('Retained log selection');
    await expectNoHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await expect(list).toBeVisible();
});

test('visual viewport keyboard height contains the active dialog and preserves input', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 850 });
  await page.addInitScript(() => Object.defineProperty(window, 'visualViewport', { configurable: true, value: Object.assign(new EventTarget(), {
    width: 430, height: 850, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1,
  }) }));
  await page.goto(fixture);
  await page.locator('.inventory-list').getByRole('heading', { name: 'Adaptive reagent', exact: true }).click();
  await page.locator('[data-pane="detail"]').getByRole('button', { name: /수정|edit/i }).first().click();
  const input = page.getByRole('dialog').locator('input[name="name"]');
  await input.fill('Keyboard draft');
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 420 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.adaptive-shell')).toHaveCSS('height', '420px');
  await expect(page.locator('.adaptive-overlay').last()).toHaveCSS('height', '420px');
  await expect(input).toHaveValue('Keyboard draft');
  const dialog = await page.getByRole('dialog').boundingBox();
  expect(dialog!.y + dialog!.height).toBeLessThanOrEqual(421);
});

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.locator('.adaptive-shell, .adaptive-header, .adaptive-panes, [data-pane="primary"], [data-pane="detail"]').evaluateAll(elements =>
    elements.filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map(element => ({ className: element.className, width: element.clientWidth, scroll: element.scrollWidth })))).toEqual([]);
}

test('navigation boundaries, full width, one mount and one inventory load across resizes', async ({ page }) => {
  await page.goto(fixture);
  await expect(page.locator('.inventory-list').getByRole('heading', { name: 'Adaptive reagent', exact: true })).toBeVisible();
  const loads = await page.locator('html').getAttribute('data-inventory-loads');
  for (const width of [320, 360, 430, 599, 600, 759, 760, 768, 840, 1024, 1199, 1200, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator('.adaptive-shell')).toHaveAttribute('data-navigation', width < 600 ? 'bottom' : width < 1200 ? 'rail' : 'sidebar');
    const nav = width < 600 ? 0 : width < 1200 ? 72 : 224;
    await expect(page.locator('.inventory-panes')).toHaveAttribute('data-adaptive-wide', String(width - nav >= 688));
    await expectNoHorizontalOverflow(page);
    await expect.poll(() => page.locator('.adaptive-content').evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(width - nav);
    await expect(page.locator('html')).toHaveAttribute('data-inventory-loads', loads!);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-mounts', '1');
  }
  await page.screenshot({ path: 'output/playwright/adaptive/inventory-expanded.png' });
});

test('selected inventory detail and edit draft survive folding and native-style back', async ({ page }) => {
  await page.setViewportSize({ width: 840, height: 850 });
  await page.goto(fixture);
  await page.locator('.inventory-list').getByRole('heading', { name: 'Adaptive reagent', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 750 });
  await expect(page.locator('[data-pane="detail"]')).toBeVisible();
  await expect(page.locator('.inventory-list')).toBeHidden();
  await page.locator('[data-pane="detail"]').getByRole('button', { name: /수정|edit/i }).first().click();
  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog).toBeVisible();
  const nameInput = dialog.locator('input[name="name"]');
  await nameInput.fill('Draft survives resizing');
  for (const width of [840, 360, 1280, 430]) {
    await page.setViewportSize({ width, height: 750 });
    await expect(nameInput).toHaveValue('Draft survives resizing');
  }
  await dialog.getByRole('button', { name: /취소|cancel/i }).click();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('buril:adaptive-back', { cancelable: true })))).toBe(true);
  await expect(page.locator('.inventory-list')).toBeVisible();
});

test('search result keeps its selection and input when narrowed', async ({ page }) => {
  await page.setViewportSize({ width: 840, height: 850 });
  await page.goto(`${fixture}?screen=search`);
  const search = page.locator('form input').first();
  await search.fill('Acetone');
  await search.press('Enter');
  await expect(page.locator('[data-pane="detail"]')).toContainText('Acetone');
  for (const width of [360, 768, 430, 1280]) {
    await page.setViewportSize({ width, height: 750 });
    await expect(page.locator('[data-pane="detail"]')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await page.setViewportSize({ width: 360, height: 750 });
  await page.getByRole('button', { name: '목록으로', exact: true }).click();
  await expect(search).toHaveValue('Acetone');
});

test('waste wizard and review use remaining space without duplicating the dialog', async ({ page }) => {
  await page.setViewportSize({ width: 840, height: 850 });
  await page.goto(`${fixture}?screen=cart`);
  await expect(page.locator('.cart-panes')).toHaveAttribute('data-adaptive-wide', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const initialTitle = await page.locator('.cart-panes main h3').first().textContent();
  for (const [width, height] of [[360, 750], [840, 450], [430, 750]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('.cart-panes main h3').first()).toHaveText(initialTitle!);
    await expectNoHorizontalOverflow(page);
    await expect.poll(async () => {
      const footer = await page.getByRole('dialog').locator('footer').boundingBox();
      return footer!.y + footer!.height;
    }).toBeLessThanOrEqual(height + 1);
  }
  await page.getByRole('button', { name: '현재 입력 검토', exact: true }).click();
  await expect(page.locator('.cart-panes [data-pane="detail"]')).toBeVisible();
  await page.getByRole('button', { name: '입력으로', exact: true }).click();
  await expect(page.locator('.cart-panes main')).toBeVisible();
});

test('segment changes reserve the hinge and contain overlays; stacked regions use one area', async ({ page }) => {
  await page.setViewportSize({ width: 950, height: 900 });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'viewport', { configurable: true, value: Object.assign(new EventTarget(), {
      segments: [{ x: 0, y: 0, width: 420, height: 900 }, { x: 450, y: 0, width: 500, height: 900 }],
    }) });
  });
  await page.goto(fixture);
  await expect(page.locator('.inventory-panes')).toHaveAttribute('data-hinge', 'true');
  const left = await page.locator('.inventory-list').boundingBox();
  const right = await page.locator('[data-pane="detail"]').boundingBox();
  expect(left!.x + left!.width).toBeLessThanOrEqual(420);
  expect(right!.x).toBeGreaterThanOrEqual(450);
  await page.locator('[data-pane="detail"]').getByRole('button', { name: /수정|edit/i }).first().click();
  const overlay = await page.locator('.adaptive-overlay').last().boundingBox();
  expect(overlay!.x).toBe(450);
  expect(overlay!.width).toBe(500);
  await page.getByRole('button', { name: /취소|cancel/i }).last().click();
  await page.evaluate(() => {
    const target = (window as unknown as { viewport: EventTarget & { segments: object[] } }).viewport;
    target.segments = [{ x: 0, y: 0, width: 950, height: 430 }, { x: 0, y: 470, width: 950, height: 430 }];
    target.dispatchEvent(new Event('segmentschange'));
  });
  await expect(page.locator('.inventory-panes')).toHaveAttribute('data-hinge', 'false');
  const shell = await page.locator('.adaptive-shell').boundingBox();
  expect(shell!.height).toBe(430);
  await expectNoHorizontalOverflow(page);
});
