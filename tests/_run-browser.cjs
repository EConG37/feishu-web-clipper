// 本地运行 *.browser.cjs 用例的小 harness：等价于 README 中
// 「python -m http.server 8899 + playwright-cli run-code」的流程。
// 用法：node tests/_run-browser.cjs tests/extractor.browser.cjs [更多文件...]
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { chromium } = require(os.homedir() + '/AppData/Roaming/npm/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const handler = (req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
};
const server = http.createServer(handler);
const server2 = http.createServer(handler);
(async () => {
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  await new Promise(r => server2.listen(8901, '127.0.0.1', r));
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'clip-run-')), {
    executablePath: os.homedir() + '/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  await context.waitForEvent('serviceworker').catch(() => {});
  let failed = 0;
  try {
    for (const file of process.argv.slice(2)) {
      const fn = eval(`(${fs.readFileSync(file, 'utf8')})`);
      const page = await context.newPage();
      try {
        const result = await fn(page);
        console.log('PASS', path.basename(file), result ? JSON.stringify(result) : '');
      } catch (e) {
        failed++;
        console.error('FAIL', path.basename(file), e.message);
      }
      await page.close();
    }
  } finally {
    await context.close();
    server.close();
    server2.close();
  }
  process.exit(failed ? 1 : 0);
})();
