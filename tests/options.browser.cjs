async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const worker=page.context().serviceWorkers()[0];
  const extensionId=worker.url().split('/')[2];
  await page.goto('chrome-extension://'+extensionId+'/options/options.html');
  await page.setViewportSize({width:1380,height:1000});

  // 01 配置指南：侧栏 4 个分区、5 个步骤、10 张本地截图（可点击放大）
  assert(await page.locator('.sidebar nav a').count()===4,'sidebar lists four sections');
  assert(await page.locator('#setup-guide .setup-step').count()===5,'setup guide has five steps');
  assert(await page.locator('#setup-guide .setup-shots img').count()===10,'setup guide embeds ten screenshots');
  const shots=await page.locator('#setup-guide .setup-shots img').evaluateAll(els=>els.map(el=>el.getAttribute('src')));
  assert(shots.every(src=>src&&src.startsWith('guide/')&&src.endsWith('.webp')),'guide screenshots are local webp');
  const guideText=await page.locator('#setup-guide').textContent();
  for (const scope of ['bitable:app','bitable:app:readonly','drive:file:upload']) assert(guideText.includes(scope),'guide lists scope '+scope);
  assert((await page.locator('#connection').textContent()).includes('drive:file:upload'),'connection help lists upload scope');

  // 配置指南截图：页内悬浮预览，不跳转新页面，可关闭
  await page.locator('#setup-guide .setup-shots a').first().click();
  assert(await page.locator('#lightbox:not([hidden])').count()===1,'screenshot opens in in-page lightbox');
  assert((await page.locator('#lightbox-img').getAttribute('src')).includes('guide/copy-menu.webp'),'lightbox shows clicked screenshot');
  assert(page.url().endsWith('/options/options.html'),'lightbox does not navigate away');
  await page.keyboard.press('Escape');
  assert(await page.locator('#lightbox[hidden]').count()===1,'Escape closes lightbox');
  await page.locator('#setup-guide .setup-shots a').nth(1).click();
  await page.locator('#lightbox-close').click();
  assert(await page.locator('#lightbox[hidden]').count()===1,'close button closes lightbox');

  // 分类与模型：分组容器、改名行默认隐藏、添加入口位于列表末尾
  assert(await page.locator('.taxonomy-group').count()===2,'two default taxonomy groups');
  const firstGroup=page.locator('.taxonomy-group').first();
  assert(await firstGroup.locator('.rename-row').evaluate(el=>el.hidden),'rename row hidden by default');
  await firstGroup.locator('.group-rename').click();
  assert(await firstGroup.locator('.rename-row').evaluate(el=>!el.hidden),'rename toggle reveals input');
  assert(await page.locator('.taxonomy-group .taxonomy-card + .category-create').count()===2,'add-category box follows the card list');
  assert(await page.locator('#taxonomy-editor > .group-create:last-child').count()===1,'add-type box sits at the end');

  // 保存流程与未保存提示
  await page.locator('#appId').fill('cli_fixture');
  await page.locator('#appSecret').fill('fixture-only');
  await page.locator('#appToken').fill('https://example.feishu.cn/base/baseFixture?table=tblFixture');
  assert((await page.locator('#save-state').textContent()).includes('未保存'),'dirty state visible');
  await page.locator('#save').click();
  await page.locator('#msg.ok').waitFor();
  const cfg=await worker.evaluate(async()=> (await chrome.storage.local.get('feishu_clip_config')).feishu_clip_config);
  assert(cfg.appToken==='baseFixture','settings save extracted app token');

  // 模板链接仍被拦截，需先创建副本
  await page.locator('#appToken').fill('https://zk5ckzju3h.feishu.cn/base/SCEObFKEvaNjNhsJT3bcZuoKnSe');
  await page.locator('#save').click();
  assert((await page.locator('#msg.err').textContent()).includes('创建副本'),'template link rejected');

  // 同步入口：连接未保存时就地提示失败原因（当前输入与已存配置不一致）
  await page.locator('#sync-schema').click();
  await page.waitForFunction(()=>document.querySelector('#sync-status')?.textContent.includes('同步失败'));
  assert((await page.locator('#sync-status').textContent()).includes('请先保存'),'sync failure shows inline status');
  assert((await page.locator('#sync-status').getAttribute('data-state'))==='err','sync status uses error state');

  // 使用说明折叠区、侧栏链接跳转到配置指南并高亮
  await page.locator('#usage-guide summary').click();
  assert(await page.locator('#usage-guide').getAttribute('open')!==null,'usage guide expands');
  assert((await page.locator('#usage-guide a').first().getAttribute('href'))==='#setup-guide','usage guide points to setup guide section');
  await page.locator('.sidebar-note a').click();
  assert(await page.locator('.sidebar nav a').first().evaluate(el=>el.classList.contains('active')),'sidebar note link activates setup guide nav');

  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'output/playwright/options-setup-guide.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no narrow overflow');
  await page.screenshot({path:'output/playwright/options-setup-guide-small.png',fullPage:true});
  console.log('PASS: setup guide section with screenshots, scoped permissions, save flow, template guard, nav highlight, mobile layout.');
}
