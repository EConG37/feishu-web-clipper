async (page) => {
  page.setDefaultTimeout(10000);
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const origin = 'https://gallery.work-fisher.com';
  const url = origin + '/?model=Seedance+2.5&item=fixture';
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(origin + '/**', route => {
    if (route.request().resourceType() === 'document') return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><title>画廊首页</title><meta property="og:image" content="${origin}/feed-cover.png">
        <style>dialog { width:90vw; height:90vh } img { width:360px; height:240px } video { width:320px; height:180px }</style>
        <article><h1>背后推荐作品</h1><p>${'不应该剪存的推荐内容。'.repeat(50)}</p><img src="/feed-cover.png"><video src="/feed.mp4"></video></article>
        <dialog id="viewer"><h2 id="viewer-title">当前作品标题</h2><h3>提示词 · 可直接修改后生成</h3>
          <textarea id="generate-prompt">旧的默认文字</textarea><img src="/current-cover.png" alt="当前作品参考图">
          <video controls src="/current.mp4" poster="${origin}/current-cover.png"></video>
          <button id="site-action">网站按钮</button></dialog><dialog id="second"><button>第二个弹窗</button></dialog>`
    });
    if (route.request().url().endsWith('.png')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="teal"/></svg>' });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(url);
  const worker = page.context().serviceWorkers()[0] || await page.context().waitForEvent('serviceworker');
  await worker.evaluate(async () => {
    await chrome.storage.local.set({ feishu_clip_config: { appId: 'fixture', appSecret: 'fixture', appToken: 'fixture' } });
    self.__modalWrites = [];
    const original = fetch;
    self.fetch = async (url, init = {}) => {
      const address = String(url);
      if (!address.startsWith('https://open.feishu.cn/')) return original(url, init);
      if (address.includes('/auth/')) return Response.json({ code: 0, tenant_access_token: 'fixture', expire: 3600 });
      if (address.includes('/fields')) return Response.json({ code: 0, data: { items: [
        { field_name: '分类', type: 4, property: { options: [{ name: '视频提示词' }] } },
        { field_name: '主分类', type: 3, property: { options: [{ name: '视频-成品提示词' }] } },
        { field_name: '子分类', type: 3, property: { options: [] } },
        { field_name: '使用模型', type: 3, property: { options: [] } }
      ] } });
      if (address.includes('/records')) {
        self.__modalWrites.push(JSON.parse(init.body));
        return Response.json({ code: 0, data: { record: { record_id: 'fixture' } } });
      }
      return Response.json({ code: 0, data: { items: [{ name: '视频提示词-成品提示词', table_id: 'fixture' }] } });
    };
  });
  const toggle = () => worker.evaluate(async url => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
    await openClipPanel(tab);
  }, url);
  const panel = page.locator('feishu-clip-panel');
  const prompt = '使用@图片1作为人物参考。\n【0:00-0:03】雨夜古寺，刀客推门。\n--ar 16:9';
  await page.evaluate(prompt => {
    document.querySelector('#generate-prompt').value = prompt;
    // Opening order differs from DOM order: the focused modal must win.
    document.querySelector('#second').showModal();
    document.querySelector('#viewer').showModal();
    window.__siteClicks = 0;
    document.querySelector('#viewer').addEventListener('click', () => window.__siteClicks++);
  }, prompt);
  await toggle();
  await panel.locator('#primary:not([disabled])').waitFor();
  assert(await panel.evaluate(el => el.parentElement.id === 'viewer' && el.matches(':popover-open')), 'panel belongs to the native modal and stays in the top layer');
  assert(await panel.locator('#clip-content').inputValue() === prompt, 'reads current textarea value with exact newlines and parameters');
  assert(await panel.locator('#clip-title').inputValue() === '当前作品标题', 'uses current work title');
  assert(await panel.locator('.thumbnail').count() === 1, 'only current modal images, no feed or duplicate poster');
  assert(await panel.locator('#video-choice option').count() === 1, 'only current modal video, no feed video');
  await panel.locator('.thumbnail').click();
  assert(await panel.locator('.thumbnail').getAttribute('aria-pressed') === 'true', 'real mouse click selects cover');
  await panel.locator('#clip-content').fill('用户编辑的提示词\n保留草稿');
  assert(await panel.locator('#clip-content').evaluate(el => el.getRootNode().activeElement === el), 'editor receives keyboard focus');
  assert(await page.evaluate(() => window.__siteClicks) === 0, 'panel clicks do not reach website modal');
  await panel.locator('#clip-content').press('Escape');
  assert(await panel.isHidden(), 'Escape closes plugin');
  assert(await page.locator('#viewer').evaluate(el => el.matches(':modal')), 'Escape preserves website detail');
  await toggle();
  assert(await panel.locator('#clip-content').inputValue() === '用户编辑的提示词\n保留草稿', 'reopening preserves draft');
  await page.evaluate(() => document.querySelector('#second').close());
  await page.evaluate(() => document.querySelector('#second').showModal());
  await page.waitForFunction(() => document.querySelector('feishu-clip-panel')?.parentElement.id === 'second');
  await panel.locator('#clip-content').fill('第二弹窗打开后仍可编辑');
  await page.evaluate(() => document.querySelector('#second').close());
  await page.waitForFunction(() => document.querySelector('feishu-clip-panel')?.parentElement.id === 'viewer');
  await panel.locator('#clip-content').fill('关闭第二弹窗后仍可编辑');
  await page.evaluate(() => document.querySelector('#viewer').remove());
  await page.waitForFunction(() => document.querySelector('feishu-clip-panel')?.parentElement === document.documentElement);
  await panel.locator('#clip-content').fill('移除网站弹窗后仍可编辑');
  assert(await panel.count() === 1, 'modal removal keeps a single panel and draft');
  await panel.locator('#close').click();
  await toggle();
  await panel.locator('#include-video').uncheck();
  await panel.locator('#clear-image').click();
  await panel.locator('#primary').click();
  await panel.locator('#groups button').filter({ hasText: '视频提示词' }).click();
  await panel.locator('#subcategories button').filter({ hasText: '成品提示词' }).click();
  await panel.locator('#primary').click();
  await panel.locator('#success-step:not([hidden])').waitFor();
  const writes = await worker.evaluate(() => self.__modalWrites);
  assert(writes.length === 1 && writes[0].fields['内容'] === '移除网站弹窗后仍可编辑', 'edited draft saves once through simulated Feishu');
  assert(errors.length === 0, errors.join('\n'));
  return 'native modal pointer/keyboard, prompt/title, scoped media, nested modal, removal, draft and simulated save';
}
