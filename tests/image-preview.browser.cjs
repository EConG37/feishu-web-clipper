async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const origin = 'http://127.0.0.1:8901';
  const cdn = 'http://localhost:8901';
  const bytes = await (await page.request.get(origin+'/icons/icon256.png')).body();
  const png = bytes.toString('base64');
  await page.route('**/preview-cors.png*', route => route.fulfill({body:bytes,contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}}));
  await page.route('**/preview-fallback.png', route => route.fulfill({status:403,body:'denied'}));
  await page.route('**/preview-fixture', route => route.fulfill({contentType:'text/html',headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Opener-Policy':'same-origin','Content-Security-Policy':`default-src 'self'; img-src 'self' ${cdn}; style-src 'self'`},body:`<!doctype html><html><head><meta charset="utf-8"><title>跨域图片预览检查</title></head><body><h1>即梦同类跨域策略</h1><p>原图必须保留跨域属性，备用预览不改变上传原图。</p><img crossorigin="anonymous" referrerpolicy="no-referrer" width="360" height="280" src="${cdn}/preview-cors.png"><img width="360" height="280" src="${cdn}/preview-fallback.png"></body></html>`}));
  await page.goto(origin+'/preview-fixture');
  assert(await page.evaluate(()=>crossOriginIsolated),'fixture reproduces cross-origin isolation');
  const legacy = await page.evaluate(async src=>await new Promise(resolve=>{const image=new Image(); image.onload=()=>resolve('loaded');image.onerror=()=>resolve('blocked');image.src=src;}),cdn+'/preview-cors.png?legacy=1');
  assert(legacy==='blocked','old image loading is actually blocked by COEP');
  const worker = page.context().serviceWorkers()[0];
  await worker.evaluate(({png,cdn})=>{
    self.__previewDownloads=0;
    const previous=fetch;
    self.fetch=async(url,init)=>{
      if(String(url)===cdn+'/preview-fallback.png') {
        self.__previewDownloads++;
        return new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
      }
      return previous(url,init);
    };
  },{png,cdn});
  await worker.evaluate(async origin=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===origin+'/preview-fixture');await openClipPanel(tab);},origin);
  const panel=page.locator('feishu-clip-panel');
  await panel.locator('#primary:not([disabled])').waitFor();
  const cors=panel.locator('.thumbnail').filter({has:page.locator(`img[src="${cdn}/preview-cors.png"]`)});
  await cors.locator('img').evaluate(img=>img.decode());
  assert(await cors.locator('img').getAttribute('crossorigin')==='anonymous','collector preserves crossorigin');
  assert(await cors.locator('img').getAttribute('referrerpolicy')==='no-referrer','collector preserves referrer policy');
  const fallback=panel.locator('.thumbnail').filter({has:page.locator(`img[src="${cdn}/preview-fallback.png"]`)});
  await fallback.locator('canvas.image-fallback').waitFor();
  await fallback.click();
  await panel.locator('#image-preview canvas.image-fallback').waitFor();
  const src=await panel.locator('#preview-image').getAttribute('src');
  assert(src===cdn+'/preview-fallback.png','original image URL retained');
  await panel.locator('#primary').click();
  await panel.locator('.review-card canvas.image-fallback').waitFor();
  await panel.locator('#back').click();
  await panel.locator('#primary').click();
  assert(await panel.locator('#review-image').isHidden(),'revisiting review does not show broken original alongside canvas');
  assert(await panel.locator('.review-card canvas').count()===1,'one fallback preview after step changes');
  assert(await worker.evaluate(()=>self.__previewDownloads)===1,'preview fetch shared across thumbnail, main and review');
  await panel.locator('#back').click();
  await cors.click();
  assert(await panel.locator('#image-preview canvas').count()===0,'switching source clears old canvas');
  await panel.locator('#preview-image').evaluate(img=>img.decode());
  await panel.locator('#clear-image').click();
  assert(await panel.locator('#preview-image').isHidden(),'clear hides preview');
  await page.screenshot({path:'output/playwright/preview-cors-fixed-131.png'});
  console.log('PASS: old behavior fails under COEP, original CORS/referrer attributes preserved, canvas fallback under restrictive CSP, shared bounded download, source unchanged, review and clearing work.');
}
