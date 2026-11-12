import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

function captureErrors(context: BrowserContext) {
  const errors: string[] = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  // BrowserContext also captures console messages from extension workers.
  context.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error')
      errors.push(message.type() + ': ' + message.text());
  });
  return errors;
}

test('viewport host survives site stacking, body replacement and real pointer input', async () => {
  const profile = await mkdtemp(resolve(tmpdir(), 'yijing-host-test-'));
  const extension = resolve(process.env.YIJING_HOST_EXTENSION ?? '.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  });
  const errors = captureErrors(context);
  try {
    const page = await context.newPage();
    await page.route('https://content-host.test/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><style>
        body { transform: translate(35px, 25px); filter: blur(0); height: 1800px; }
        #backdrop { position: fixed; inset: 0; z-index: 50; background: #ddd; }
        yijing-translate { position: static !important; z-index: auto !important;
          transform: translate(500px) !important; contain: paint !important;
          display: none !important; pointer-events: none !important; }
      </style></head><body><div id="backdrop">Site backdrop</div><script>
        window.siteEvents = [];
        for (const type of ['click','pointerdown','keydown','input']) {
          document.body.addEventListener(type, () => window.siteEvents.push('body:'+type), true);
          document.addEventListener(type, () => window.siteEvents.push('document:'+type));
        }
      </script></body></html>`,
      }),
    );
    await page.goto('https://content-host.test/');
    const host = page.locator('yijing-translate');
    const ball = host.locator('.yj-ball');
    await expect(ball).toBeVisible();
    await expect(host).toHaveCSS('position', 'fixed');
    await expect(host).toHaveCSS('z-index', '2147483647');
    await expect(host).toHaveCSS('transform', 'none');
    await expect(host).toHaveCSS('contain', 'none');
    const hit = await ball.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return {
        ball: document.elementFromPoint(rect.x + 21, rect.y + 21)?.tagName,
        page: document.elementFromPoint(100, 100)?.id,
      };
    });
    expect(hit).toEqual({ ball: 'YIJING-TRANSLATE', page: 'backdrop' });
    await ball.evaluate((button: HTMLButtonElement) => button.click());
    await expect(host.locator('[role=status]')).toHaveCount(0);
    await ball.click();
    await expect(host.locator('[role=status]')).toContainText('请先');
    await ball.focus();
    await page.keyboard.press('Enter');
    expect(
      await page.evaluate(() => (window as unknown as { siteEvents: string[] }).siteEvents),
    ).toEqual([]);
    const before = (await ball.boundingBox())!;
    await page.mouse.move(before.x + 21, before.y + 21);
    await page.mouse.down();
    // A page script must not steer or end the document-level UI drag.
    await page.evaluate(async () => {
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 50 }));
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: 20, clientY: 50 }));
      await new Promise(requestAnimationFrame);
    });
    expect(await ball.boundingBox()).toMatchObject({ x: before.x, y: before.y });
    await page.mouse.move(400, 240, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await ball.boundingBox())?.y).toBe(219);
    await expect.poll(async () => (await ball.boundingBox())?.x).toBe(12);
    const original = await ball.elementHandle();
    await page.evaluate(() => document.body.replaceWith(document.createElement('body')));
    await expect(ball).toBeVisible();
    expect(await ball.evaluate((button, previous) => button === previous, original)).toBe(true);
    expect((await ball.boundingBox())?.y).toBe(219);
    await host.evaluate((element: HTMLElement) => {
      element.style.visibility = 'hidden';
    });
    await expect(ball).toBeHidden();
    await host.evaluate((element: HTMLElement) => {
      element.style.visibility = '';
    });
    await expect(ball).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

for (const gesture of ['focused Escape', 'forged document Escape'] as const) {
  test(`result card handles ${gesture} across the isolated host`, async () => {
    const profile = await mkdtemp(resolve(tmpdir(), 'yijing-host-escape-'));
    const extension = resolve(process.env.YIJING_HOST_EXTENSION ?? '.output/chrome-mv3');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    const errors = captureErrors(context);
    try {
      const page = await context.newPage();
      await page.route('https://content-host.test/escape', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><body><p id="source">Hello world</p></body></html>',
        }),
      );
      await page.goto('https://content-host.test/escape');
      const host = page.locator('yijing-translate');
      await expect(host.locator('.yj-ball')).toBeVisible();
      await page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('#source')!);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.keyboard.down('Control');
      await page.waitForTimeout(450);
      await page.keyboard.up('Control');
      const card = host.getByRole('dialog', { name: '翻译结果' });
      await expect(card).toBeVisible();
      if (gesture === 'focused Escape') {
        await card.getByRole('button', { name: '固定浮窗', exact: true }).click();
        await card.getByRole('button', { name: '关闭翻译', exact: true }).focus();
        await page.keyboard.press('Escape');
        await expect(card).toBeVisible();
        await card.getByRole('button', { name: '取消固定', exact: true }).click();
        await card.getByRole('button', { name: '关闭翻译', exact: true }).focus();
        await page.keyboard.press('Escape');
        await expect(card).toBeHidden();
      } else {
        await page.evaluate(async () => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise(requestAnimationFrame);
        });
        await expect(card).toBeVisible();
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
