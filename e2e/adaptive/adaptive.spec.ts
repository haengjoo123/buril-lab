import { expect, test, type Locator, type Page } from '@playwright/test';
import { translations } from '../../src/locales/translations';

const fixture = '/e2e/adaptive/fixture.html';
/** Every navigation boundary from the smallest phone to the sidebar layout. */
const LAYOUT_WIDTHS = [320, 360, 430, 599, 600, 759, 760, 768, 840, 1024, 1199, 1200, 1280];
const APP_REGIONS = '.adaptive-shell, .adaptive-header, .adaptive-panes, [data-pane="primary"], [data-pane="detail"]';
const ADMIN_REGIONS = `${APP_REGIONS}, main, [role="tablist"], [role="tabpanel"]`;
// The operator console is its own fixed shell; its mobile section strip scrolls sideways by design.
const OPS_REGIONS = '#root > div, #root header, #root main, #root main section';

/** The Korean copy the fixture renders. i18next shows a key that is not in translations.ts as the key itself. */
function ko(key: string, values: Record<string, string | number> = {}): string {
  const copy = (translations.ko as Record<string, string | undefined>)[key] ?? (translations.en as Record<string, string | undefined>)[key];
  if (copy === undefined) return key;
  return copy.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Accessible name of the admin tab badge ("확인할 일 N건"), for any count when none is given. */
function adminAttentionName(count?: number): RegExp {
  const name = escapeRegExp(ko('nav_admin_attention', { count: count ?? '__COUNT__' }));
  return new RegExp(count === undefined ? name.replace('__COUNT__', '\\d+') : name);
}

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
  await expect(page.getByRole('radiogroup', { name: '시약장 모드' })).toBeVisible();
  // "Fit view" only appears once the camera has been moved by hand, and hides again after fitting.
  const fitView = page.getByRole('button', { name: '화면 맞춤', exact: true });
  await expect(fitView).toHaveCount(0);
  const canvasBox = (await page.locator('canvas').boundingBox())!;
  const startX = canvasBox.x + 24;
  const startY = canvasBox.y + canvasBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 10, { steps: 6 });
  await page.mouse.up();
  await expect(fitView).toBeVisible();
  await fitView.click();
  await expect(fitView).toHaveCount(0);
});

test('waste log auto selection stays on the list until explicitly opened', async ({ page }) => {
  await page.setViewportSize({ width: 840, height: 850 });
  await page.goto(`${fixture}?screen=logs`);
  const list = page.locator('[data-pane="primary"]');
  // The latest day opens on its own (clicking its header would fold it again); rows are titled by category.
  await expect(list.getByRole('button', { name: /1건/ })).toBeVisible();
  const logRow = list.getByText(ko('label_organic_non_halogen'), { exact: true }).first();
  await expect(logRow).toBeVisible();
  await page.setViewportSize({ width: 360, height: 750 });
  await expect(list).toBeVisible();
  await logRow.click();
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

async function expectNoHorizontalOverflow(page: Page, regions = APP_REGIONS) {
  await expect.poll(() => page.locator(regions).evaluateAll(elements =>
    elements.filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map(element => ({ className: element.className, width: element.clientWidth, scroll: element.scrollWidth })))).toEqual([]);
}

test('navigation boundaries, full width, one mount and one inventory load across resizes', async ({ page }) => {
  await page.goto(fixture);
  await expect(page.locator('.inventory-list').getByRole('heading', { name: 'Adaptive reagent', exact: true })).toBeVisible();
  const loads = await page.locator('html').getAttribute('data-inventory-loads');
  for (const width of LAYOUT_WIDTHS) {
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

/** Every row is on screen in full: nothing cut off at the right edge or pushed out of view. */
async function expectRowsInside(page: Page, rows: Locator) {
  const width = page.viewportSize()!.width;
  for (const row of await rows.all()) {
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
}

test('lab admin overview lists every task in order and fits every width', async ({ page }) => {
  await page.goto(`${fixture}?screen=admin`);
  const tasks = page.locator('section[aria-labelledby="lab-admin-tasks-heading"]');
  const rows = tasks.getByRole('listitem');
  // Overdue request, expired reagents, ignored DANGER warning (red); link request (amber); new member (slate).
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('MSDS 비치 확인');
  await expect(rows.nth(1)).toContainText('아세톤, 에탄올');
  await expect(rows.nth(2)).toContainText('질산 + 에탄올 · 시약장 B-2');
  await expect(rows.nth(3)).toContainText('버릴대학교 연구안전센터');
  await expect(rows.nth(4)).toContainText(ko('admin_overview_task_new_members', { count: 1 }));
  // The admin tab badge counts only the overdue request (expiry and DANGER cards stay on the overview)
  // and says so in the tab's name, in the bottom nav, the rail, and the sidebar alike.
  const badgedAdminTab = page.getByRole('button', { name: adminAttentionName(1) });
  for (const width of LAYOUT_WIDTHS) {
    await page.setViewportSize({ width, height: 850 });
    await expectNoHorizontalOverflow(page, ADMIN_REGIONS);
    await expectRowsInside(page, rows);
    await expect(badgedAdminTab).toHaveCount(1);
  }
});

test('lab admin tab survives a reload through ?tab=', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${fixture}?screen=admin`);
  const membersTab = page.getByRole('tab', { name: ko('admin_tab_members_short'), exact: true });
  await membersTab.click();
  await expect(page).toHaveURL(/[?&]tab=members(?:&|$)/);
  await expect(membersTab).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('new.member@example.invalid')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/[?&]screen=admin(?:&|$)/);
  await expect(page).toHaveURL(/[?&]tab=members(?:&|$)/);
  await expect(membersTab).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('heading', { name: ko('admin_members_title'), exact: true })).toBeVisible();
  await expect(panel.getByText('new.member@example.invalid')).toBeVisible();
  await expectNoHorizontalOverflow(page, ADMIN_REGIONS);
  // The overview is the default tab, so it leaves no ?tab= behind.
  await page.getByRole('tab', { name: ko('admin_tab_overview'), exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]tab=/);
  await expect(page.locator('section[aria-labelledby="lab-admin-tasks-heading"]')).toBeVisible();
});

test('lab admin overview with nothing to handle shows only the quiet line', async ({ page }) => {
  await page.goto(`${fixture}?screen=admin&quiet=1`);
  const tasks = page.locator('section[aria-labelledby="lab-admin-tasks-heading"]');
  await expect(tasks.getByRole('status').filter({ hasText: ko('admin_overview_quiet') })).toBeVisible();
  await expect(tasks.getByRole('status')).toHaveCount(1);
  await expect(tasks.getByRole('listitem')).toHaveCount(0);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await expectNoHorizontalOverflow(page, ADMIN_REGIONS);
    // Nothing red: no badge on the admin tab.
    await expect(page.getByRole('button', { name: adminAttentionName() })).toHaveCount(0);
  }
});

// The console header names the section; a section may add its own heading below it.
const opsSectionTitle = (page: Page) => page.locator('#root header h1');

test('operator home inbox lists what is waiting and fits every width', async ({ page }) => {
  await page.goto(`${fixture}?screen=ops`);
  await expect(opsSectionTitle(page)).toHaveText(ko('ops_console_nav_overview'));
  const inbox = page.locator('section[aria-labelledby="ops-home-inbox-title"]');
  const rows = inbox.getByRole('listitem');
  // 2 pending centers (oldest 4 days, red), 3 new suggestions (amber), 7 review candidates (slate).
  await expect(rows).toHaveCount(3);
  const centersRow = rows.nth(0);
  await expect(centersRow).toContainText(ko('ops_home_task_centers', { value: '2' }));
  await expect(centersRow).toContainText(ko('ops_home_domain_match', { matched: 1, checked: 2 }));
  await expect(rows.nth(1)).toContainText(ko('ops_home_task_feedback', { value: '3' }));
  await expect(rows.nth(2)).toContainText(ko('ops_home_task_reviews', { value: '7' }));
  for (const width of LAYOUT_WIDTHS) {
    await page.setViewportSize({ width, height: 850 });
    await expectNoHorizontalOverflow(page, OPS_REGIONS);
    await expectRowsInside(page, rows);
  }
});

test('operator home opens the pending centers, which fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${fixture}?screen=ops`);
  const centersRow = page.locator('section[aria-labelledby="ops-home-inbox-title"]').getByRole('listitem')
    .filter({ hasText: ko('ops_home_task_centers', { value: '2' }) });
  await centersRow.getByRole('button', { name: ko('ops_home_open_centers') }).click();
  await expect(opsSectionTitle(page)).toHaveText(ko('ops_console_nav_centers'));
  await expect(page.locator('#root main article')).toHaveCount(2);
  await expect(page.locator('#root main article').filter({ hasText: '버릴대학교 연구안전센터' })).toBeVisible();
  for (const width of [360, 320, 1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, OPS_REGIONS);
  }
});

test('operator home with nothing waiting shows only the quiet line', async ({ page }) => {
  await page.goto(`${fixture}?screen=ops&quiet=1`);
  const inbox = page.locator('section[aria-labelledby="ops-home-inbox-title"]');
  await expect(inbox.getByRole('status').filter({ hasText: ko('admin_inbox_quiet') })).toBeVisible();
  await expect(inbox.getByRole('listitem')).toHaveCount(0);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await expectNoHorizontalOverflow(page, OPS_REGIONS);
  }
});

test('operator home shows the north star and goal groups and fits every width', async ({ page }) => {
  // A phone opens with the goal groups folded under the inbox and the north star.
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${fixture}?screen=ops`);
  const northStar = page.locator('section[aria-labelledby="ops-home-north-star-title"]');
  const northStarTitle = northStar.locator('#ops-home-north-star-title');
  // The fixture KPIs: 23 labs recorded this week, with the 8-week line.
  await expect(northStar).toContainText(ko('ops_home_unit_places', { value: '23' }));
  await expect(northStar.getByRole('img')).toHaveCount(1);
  const groups = ['product', 'safety', 'b2b'].map(id => page.locator(`section[aria-labelledby="ops-home-group-${id}"]`));
  for (const group of groups) await expect(group.locator('h2 button')).toHaveAttribute('aria-expanded', 'false');

  const product = groups[0];
  const fold = product.locator('h2 button');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(product.locator(`#${await fold.getAttribute('aria-controls')}`)).toBeVisible();
  const definitions = product.locator('button[aria-controls$="-defs"]');
  await definitions.click();
  await expect(definitions).toHaveAttribute('aria-expanded', 'true');
  // The panel explains every product metric, the ingestion rate included.
  await expect(product.locator(`#${await definitions.getAttribute('aria-controls')}`)).toContainText(ko('ops_an_ingestion_title'));
  for (const width of LAYOUT_WIDTHS) {
    await page.setViewportSize({ width, height: 850 });
    await expectNoHorizontalOverflow(page, OPS_REGIONS);
    await expect(northStarTitle).toBeVisible();
  }

  // Tablets and desktops open with every group unfolded.
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.reload();
    await expect(northStar).toContainText(ko('ops_home_unit_places', { value: '23' }));
    for (const group of groups) await expect(group.locator('h2 button')).toHaveAttribute('aria-expanded', 'true');
    await expectNoHorizontalOverflow(page, OPS_REGIONS);
    await expect(northStarTitle).toBeVisible();
  }
});
