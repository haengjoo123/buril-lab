async page => {
  const baseUrl = 'https://buril-lab.pages.dev';
  const outputDir = 'output/playwright/buril-lab-active-2026-05-13';
  const scanImage = 'output/playwright/buril-lab-active-2026-05-13/scan-source.jpg';
  const searches = [
    'Potassium Phosphate dibasic',
    'Acetone',
    'DMSO',
    'Methanol',
  ];

  const wait = (ms) => page.waitForTimeout(ms);

  const waitForApp = async () => {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForSelector('header', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('main', { timeout: 15000 }).catch(() => {});
    await wait(1800);
  };

  const closeMenus = async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await wait(200);
  };

  const selectAntiAgingLabInLoadedApp = async () => {
    await closeMenus();
    const headerText = await page.locator('header').innerText().catch(() => '');
    if (headerText.includes('항노화 연구실 (Anti-aging)')) return;

    const switcher = page.locator('header').getByRole('button').filter({ hasText: /개인 공간|항노화 연구실/ }).first();
    await switcher.click();
    await wait(500);
    await page.locator('header').getByRole('button').filter({ hasText: /항노화 연구실 \(Anti-aging\)/ }).last().click();
    await wait(1600);
    await closeMenus();
  };

  const clickTab = async (name) => {
    await page.locator('nav').getByRole('button', { name }).click();
    await wait(1800);
    await closeMenus();
  };

  const screenshot = async (filename, { resetMainScroll = true } = {}) => {
    await page.evaluate((shouldReset) => {
      document.activeElement?.blur?.();
      window.scrollTo(0, 0);
      if (shouldReset) document.querySelector('main')?.scrollTo(0, 0);
    }, resetMainScroll).catch(() => {});
    await wait(400);
    await page.screenshot({
      path: `${outputDir}/${filename}.png`,
      fullPage: false,
      animations: 'disabled',
    });
  };

  const getMainScrollTopForText = async (text) => {
    return page.evaluate((needle) => {
      const main = document.querySelector('main');
      if (!main) return 0;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if ((node.textContent || '').includes(needle)) {
          const element = node.parentElement;
          if (element) {
            const mainRect = main.getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            return Math.max(0, main.scrollTop + rect.top - mainRect.top - 14);
          }
        }
        node = walker.nextNode();
      }
      return 0;
    }, text);
  };

  const search = async (term) => {
    await clickTab('검색');
    const input = page.getByRole('textbox', { name: /시약명|CAS|Acetone/i }).first();
    await input.fill(term);
    await page.locator('form').getByRole('button', { name: /^검색$/ }).click();
    await wait(4600);
  };

  const resetSearchHome = async () => {
    await page.getByRole('button', { name: /Buril-lab 로고 Buril-lab/ }).click().catch(async () => {
      await clickTab('검색');
    });
    await wait(1000);
  };

  await page.setViewportSize({ width: 430, height: 932 });
  await page.context().grantPermissions(['camera'], { origin: baseUrl }).catch(() => {});
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForApp();
  await selectAntiAgingLabInLoadedApp();

  for (const term of searches) {
    await search(term);
  }

  await resetSearchHome();
  await page.waitForSelector('text=최근 검색 기록', { timeout: 12000 }).catch(() => {});
  await screenshot('01-search-history');

  await search('Potassium Phosphate dibasic');
  const resultScrollTop = await getMainScrollTopForText('화학물질 검색 결과');
  await page.evaluate((top) => document.querySelector('main')?.scrollTo(0, top), resultScrollTop);
  await wait(800);
  await screenshot('02-result-scrolled', { resetMainScroll: false });

  await page.getByRole('button', { name: /스캔하기/ }).first().click();
  await wait(900);
  await page.locator('input[type="file"]').first().setInputFiles(scanImage);
  await wait(1300);
  await screenshot('03-scan-uploaded-reagent');
  await page.getByRole('button', { name: /닫기|Close/i }).first().click().catch(() => {});
  await wait(500);

  await clickTab('기록');
  await page.getByRole('button', { name: /최근 90일/ }).click().catch(() => {});
  await wait(1800);
  await page.evaluate(async () => {
    const main = document.querySelector('main');
    if (!main) return;
    main.scrollTo(0, 0);
    const isWeeklyGroup = (text) => /^\s*\d{1,2}\.\s*\d{1,2}\.\s*-\s*\d{1,2}\.\s*\d{1,2}\./.test(text)
      && text.includes('주간 그룹');
    const all = Array.from(document.querySelectorAll('main *'));
    const matches = all.filter((element) => isWeeklyGroup(element.innerText || ''));
    const leaves = matches.filter((element) => !Array.from(element.children).some((child) => isWeeklyGroup(child.innerText || '')));
    for (const element of leaves) {
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 240));
    }
  });
  await wait(1200);
  await screenshot('04-logs-90-days-expanded');

  await clickTab('시약장');
  await page.waitForSelector('text=A421', { timeout: 12000 }).catch(() => {});
  await screenshot('05-cabinet-list-active');

  const firstCabinetHeading = page.locator('main').getByRole('heading', { level: 3 }).first();
  if (await firstCabinetHeading.count()) {
    await firstCabinetHeading.click();
    await wait(4200);
  }
  await screenshot('06-cabinet-detail-active');

  await clickTab('재고');
  await page.waitForSelector('text=Potassium Phosphate dibasic', { timeout: 12000 }).catch(() => {});
  await screenshot('07-inventory-active');

  return {
    outputDir,
    files: [
      '01-search-history.png',
      '02-result-scrolled.png',
      '03-scan-uploaded-reagent.png',
      '04-logs-90-days-expanded.png',
      '05-cabinet-list-active.png',
      '06-cabinet-detail-active.png',
      '07-inventory-active.png',
    ],
  };
}
