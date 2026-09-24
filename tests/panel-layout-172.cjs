const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(require('os').homedir()+'/AppData/Roaming/npm/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const chromePath = require('os').homedir()+'/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';

(async () => {
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'clip-layout-')), {
    executablePath: chromePath,
    headless: true,
    viewport: { width: 1440, height: 960 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });

  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.route('**/layout-art-*.png', route => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="#dbe8e3"/><path d="M0 420 260 170 430 350 650 120 900 390V500H0Z" fill="#6f9288"/></svg>'
    }));
    await page.route('**/layout-demo', route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><meta charset="utf-8"><title>提示词预览布局检查</title><article><h1>山间微光</h1><p>东方山水意境，层叠青山与林间木屋，暖金色夕阳穿过薄雾。低饱和青绿色调，柔和光影，电影构图，细腻的空气感。</p>${Array.from({ length: 8 }, (_, index) => `<img width="900" height="500" src="/layout-art-${index}.png" alt="候选图 ${index + 1}">`).join('')}</article>`
    }));

    await page.goto('http://127.0.0.1:8901/layout-demo');
    await worker.evaluate(() => chrome.storage.local.set({
      feishu_clip_config: { appId: 'fixture', appSecret: 'fixture', appToken: 'fixture' }
    }));
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true });
      await openClipPanel(tab);
    });

    const panel = page.locator('feishu-clip-panel');
    await panel.locator('#primary:not([disabled])').waitFor();
    await panel.locator('.thumbnail').nth(2).click();
    await panel.locator('#clip-content').fill('东方山水意境，层叠青山与林间木屋，暖金色夕阳穿过薄雾。\n低饱和青绿色调，柔和光影，电影构图，细腻的空气感。\n\n--ar 16:9 --stylize 250');

    for (const height of [960, 768, 600]) {
      await page.setViewportSize({ width: 1440, height });
      const panelBox = await panel.boundingBox();
      const textarea = await panel.locator('#clip-content').boundingBox();
      const footer = await panel.locator('footer').boundingBox();
      assert(textarea.height >= 64, `editor remains readable at ${height}px`);
      assert(textarea.y + textarea.height <= footer.y, `editor stays above footer at ${height}px`);
      assert(footer.y + footer.height <= height, `footer stays on screen at ${height}px`);
      if (height === 960) {
        assert.equal(panelBox.height, 900, 'tall desktop uses expanded panel height');
        assert(textarea.height >= 190, 'expanded panel gives extra height to prompt editor');
        await page.screenshot({ path: path.join(root, 'output/playwright/panel-content-172.png') });
      }
    }

    await page.setViewportSize({ width: 390, height: 520 });
    const mobileBox = await panel.boundingBox();
    assert(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 390, 'panel fits narrow viewport width');
    assert(mobileBox.y >= 0 && mobileBox.y + mobileBox.height <= 520, 'panel fits narrow viewport height');
    assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    console.log('PASS expanded desktop panel, larger prompt preview, responsive 768/600/mobile layout');
  } finally {
    await context.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
