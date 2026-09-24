async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:8901';
  await page.route('**/art-*.png', route => {
    const i = Number(route.request().url().match(/art-(\d+)/)[1]);
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${i % 2 ? '#cad7d4' : '#e9d6b8'}"/><stop offset="1" stop-color="#f3e9d6"/></linearGradient></defs><rect width="900" height="500" fill="url(#sky)"/><circle cx="650" cy="142" r="51" fill="#fbefcc"/><path d="M0 330 120 185 240 310 410 140 620 350 790 190 900 300V500H0" fill="#77978e"/><path d="m0 395 160-120 190 142 150-95 190 70 210-135v243H0" fill="#345e59"/><path d="M0 455q200-130 380-15t520-15v75H0" fill="#1c4341"/><path d="m475 470 18-43 18 43zm3 0v20h27v-20" fill="#d3b997"/></svg>` });
  });
  await page.route('**/panel-demo*', route => route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:"><title>山间微光，一段安静的东方叙事</title><link rel="stylesheet" href="/output/playwright/panel-demo.css"></head><body><nav><strong>山 外 · FIELD NOTES</strong><span>灵感手记</span><span>图像档案</span></nav><article><div class="eyebrow">VISUAL JOURNAL / 009</div><h1>山间微光，<br>一段安静的东方叙事</h1><p>傍晚的光落在远山上，薄雾缓缓经过山谷。</p><img src="/art-0.png" alt="落日与远山"><h2>画面与提示词</h2><p>东方山水意境，层叠青山与林间木屋，暖金色夕阳穿过薄雾。低饱和青绿色调，柔和光影，电影构图，细腻的空气感。保留山间留白与安静的叙事氛围。</p><aside>${Array.from({length:8},(_,i)=>`<img src="/art-${i+1}.png" alt="山间光影 ${i+1}">`).join('')}</aside></article></body></html>`}));
  await page.goto(origin + '/panel-demo');
  const context = page.context();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    self.__records = []; self.__failSave = false; self.__uploads = [];
    const nativeFetch = fetch;
    self.fetch = async (url, init = {}) => {
      const address = String(url);
      if (address.includes('open.feishu.cn')) {
        if (address.includes('/auth/')) return Response.json({code:0,tenant_access_token:'mock-token',expire:7200});
        if (address.includes('/medias/')) { self.__uploads.push(init.body.get('parent_node')); return Response.json({code:0,data:{file_token:'mock-cover'}}); }
        if (address.endsWith('/records')) {
          self.__records.push(JSON.parse(init.body));
          await new Promise(resolve=>setTimeout(resolve,150));
          return Response.json(self.__failSave ? {code:1254302,msg:'模拟保存失败，请重试'} : {code:0,data:{record:{record_id:'mock-record'}}});
        }
        throw new Error('Unexpected Feishu request');
      }
      if (address.includes('/art-')) {
        const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
        return new Response(png,{headers:{'Content-Type':'image/png'}});
      }
      return nativeFetch(url,init);
    };
    return chrome.storage.local.set({feishu_clip_config:{appId:'cli_fixture',appSecret:'fixture-only',appToken:'baseFixture',tableId:'tblFixture',tableName:'灵感收藏库'},clip_categories:['生图提示词','视频提示词'],clip_category_models:{'生图提示词':['GPT2','bananaPro','MJ','seedream5Pro','seedream4.7','seedream3.1'],'视频提示词':['seedance2.0','seedance2.5','minimaxH3','KelingO3']}});
  });
  const toggle = async () => worker.evaluate(async (origin) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url?.startsWith(origin));
    await openClipPanel(tab);
  }, origin);
  await toggle();
  const panel = page.locator('feishu-clip-panel');
  await panel.locator('#primary:not([disabled])').waitFor();
  assert(await panel.locator('.thumbnail').count() === 8,'8 distinct candidate images');
  assert((await panel.locator('#clip-content').inputValue()).includes('低饱和青绿色调'),'real extraction reaches editor');
  assert(!(await panel.locator('#clip-content').inputValue()).includes('留住灵感'),'panel excluded from extraction');
  assert(await panel.evaluate(el => el.matches(':popover-open')),'panel is in page top layer');
  assert(await panel.locator('.panel').evaluate(el=>getComputedStyle(el).borderRadius) === '18px','shadow styles work under restrictive page CSP');
  await panel.locator('.thumbnail').nth(2).click();
  await panel.locator('#clip-content').fill('东方山水意境，层叠青山与林间木屋，暖金色夕阳穿过薄雾。\n低饱和青绿色调，柔和光影，电影构图，细腻的空气感。\n\n--ar 16:9 --stylize 250');
  const src = await panel.locator('#preview-image').getAttribute('src');
  for (const height of [960,768,600]) {
    await page.setViewportSize({width:1440,height});
    const textarea = await panel.locator('#clip-content').boundingBox();
    const footer = await panel.locator('footer').boundingBox();
    const body = await panel.locator('main').boundingBox();
    assert(textarea.height>=64 && textarea.y+textarea.height<=footer.y,'editor visible without main scrolling at '+height);
    assert(textarea.x>=body.x && textarea.x+textarea.width<=body.x+body.width,'editor fits panel width at '+height);
    assert(footer.y+footer.height<=height,'footer on screen at '+height);
  }
  await page.setViewportSize({width:1440,height:960});
  await page.screenshot({path:'output/playwright/panel-content-130.png'});
  await panel.locator('#clip-content').press('Escape');
  assert(await panel.isHidden(),'Escape closes panel');
  await toggle();
  assert((await panel.locator('#clip-content').inputValue()).includes('--stylize 250'),'draft survives close and reopen');
  assert(await page.locator('feishu-clip-panel').count()===1,'no duplicate panel after reinjection');
  await panel.locator('#primary').click();
  await panel.locator('.category').first().click();
  await panel.getByRole('button',{name:'MJ',exact:true}).click();
  await panel.locator('.category').nth(1).click();
  await panel.locator('.category').first().click();
  assert(await panel.locator('.model[aria-pressed="true"]').count()===0,'removing category clears incompatible model');
  await panel.getByRole('button',{name:'seedance2.5',exact:true}).click();
  await panel.locator('#back').click();
  assert(await panel.locator('#preview-image').getAttribute('src')===src,'return keeps chosen image');
  assert((await panel.locator('#clip-content').inputValue()).includes('--ar 16:9'),'return keeps edited text');
  await panel.locator('#primary').click();
  assert(await panel.getByRole('button',{name:'seedance2.5',exact:true}).getAttribute('aria-pressed')==='true','model persists on back/next');
  await page.screenshot({path:'output/playwright/panel-organize-130.png'});
  await worker.evaluate(()=>{self.__failSave=true;});
  await panel.locator('#primary').click();
  await panel.locator('#status.error').waitFor();
  assert(await panel.locator('#primary').isEnabled(),'failure enables retry');
  assert(await panel.getByRole('button',{name:'seedance2.5',exact:true}).getAttribute('aria-pressed')==='true','failure preserves model');
  await worker.evaluate(()=>{self.__failSave=false;});
  await panel.locator('#primary').evaluate(button=>{button.click();button.click();});
  await panel.locator('#success-step:not([hidden])').waitFor();
  const recorded = await worker.evaluate(()=>({records:self.__records,uploads:self.__uploads}));
  assert(recorded.records.length===2,'double click sends one retry');
  const fields = recorded.records[1].fields;
  assert(fields['内容'].includes('--stylize 250'),'edited content reaches background');
  assert(fields['使用模型']==='seedance2.5' && fields['分类'][0]==='视频提示词','classification reaches record');
  assert(fields['封面'][0].file_token==='mock-cover' && recorded.uploads.every(x=>x==='baseFixture'),'cover uses configured base');
  await page.screenshot({path:'output/playwright/panel-success-130.png'});
  await panel.locator('#primary').click();
  await toggle();
  assert(await panel.locator('#success-step').isVisible(),'reopen saved panel does not offer duplicate save');
  await toggle();
  await page.goto(origin+'/panel-demo?new=1');
  await toggle();
  await panel.locator('#primary:not([disabled])').waitFor();
  // Tiny and narrow windows: panel stays in bounds, footer stays available, body can scroll.
  await page.setViewportSize({width:390,height:520});
  const box = await panel.boundingBox();
  assert(box.x>=0 && box.x+box.width<=390 && box.y+box.height<=520,'panel fits narrow viewport');
  await panel.locator('#clip-content').fill('手机窄屏草稿');
  await page.screenshot({path:'output/playwright/panel-small-130.png'});
  await page.setViewportSize({width:1440,height:768});
  await panel.locator('#primary').click();
  await panel.locator('#primary').press('Control+Enter');
  await panel.locator('#success-step:not([hidden])').waitFor();
  const plain = await worker.evaluate(()=>self.__records.at(-1).fields);
  assert(!('封面' in plain) && !('分类' in plain) && !('使用模型' in plain),'text-only save without classification');
  await panel.locator('#primary').click();
  await page.goto(origin+'/panel-demo?new=2');
  await toggle();
  await panel.locator('#primary:not([disabled])').waitFor();
  await page.evaluate(()=>history.pushState({},'', '/different-page'));
  await panel.locator('#primary').click();
  assert((await panel.locator('#status').textContent()).includes('网页地址已变化'),'SPA navigation does not save mixed source');
  assert(errors.length===0,errors.join('; '));
  console.log('PASS: real extension injection, strict CSP, extraction, bounded layout 960/768/600, draft, reinjection, steps, model reset, retry, duplicate prevention, save payload. Feishu calls mocked in isolated browser.');
}
