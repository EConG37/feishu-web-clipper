const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {chromium}=require(require('os').homedir()+'/AppData/Roaming/npm/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const aha='https://ahaprompt.app/zh/prompt/rice-water-serum-cinematic-commercial';
const meigen='https://www.meigen.ai/video/2096196085198839832';
const x='https://x.com/Saccc_c/status/2097225315089256814';
const ameliance='https://x.com/Ameliance_/status/2098840760258871562';
const amelianceMedia='2098840564330610688';
const ahaVideo='https://cdn.ahaprompt.app/harvest-media/test.mp4';
const meigenVideo='https://images.meigen.ai/videos/2096196085198839832/video.mp4';
const poster='https://cdn.ahaprompt.app/cover.jpg';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=','base64');
const movie=fs.readFileSync(path.join(root,'output/video-upload-trial/x-2097225315089256814-1440p.mp4'));
(async()=>{
 const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'clip150-')),{executablePath:require('os').homedir()+'/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
 try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  let html='';
  await context.route('https://**/*',r=>{
   if(r.request().resourceType()==='document')return r.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><title>视频测试</title><style>video{width:320px;height:180px}body{background:#eee}</style>${html}`});
   if(/\.mp4(?:\?|$)/.test(r.request().url()))return r.fulfill({contentType:'video/mp4',body:movie});
   return r.fulfill({contentType:'image/png',body:pixel});
  });
  await worker.evaluate(async()=>{
   await chrome.storage.local.set({feishu_clip_config:{appId:'fixture',appSecret:'fixture',appToken:'copy'}});
   const native=fetch;globalThis.writes=[];globalThis.uploads=[];globalThis.failVideo=false;globalThis.missingVideoField=false;
   globalThis.fetch=async(u,o={})=>{
    const url=String(u);
    if(url.startsWith('https://open.feishu.cn/')){
     if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'fixture',expire:3600});
     if(url.includes('/medias/')){
      const type=o.body.get('parent_type');uploads.push(type);
      if(type==='bitable_file'&&failVideo)return Response.json({code:999,msg:'模拟视频上传失败'});
      return Response.json({code:0,data:{file_token:type==='bitable_file'?'video-token':'cover-token'}});
     }
     if(url.includes('/fields'))return Response.json({code:0,data:{items:[{field_name:'分类',type:4,property:{options:[{name:'视频提示词'}]}},{field_name:'主分类',type:3,property:{options:[{name:'视频-成品提示词'},{name:'视频-人物情绪'}]}},{field_name:'子分类',type:3,property:{options:[{name:'3D动画'}]}},{field_name:'使用模型',type:3,property:{options:[{name:'seedance2.5'}]}},...(missingVideoField?[]:[{field_name:'成品视频',type:17}])]}});
     if(/\/records(?:\?|$)/.test(url)){writes.push({fields:JSON.parse(o.body).fields,clientToken:new URL(url).searchParams.get('client_token')});return Response.json({code:0,data:{record:{record_id:'fixture-record'}}});}
     return Response.json({code:0,data:{items:[{name:'视频提示词-成品提示词',table_id:'tblFinal'},{name:'视频提示词-人物情绪',table_id:'tblEmotion'}]}});
    }
    if(/\.mp4(?:\?|$)/.test(url)){const b=new Uint8Array(100);b.set([102,116,121,112],4);return new Response(b,{headers:{'content-type':'video/mp4','content-length':'100'}});}
    if(/cover\.jpg/.test(url)){return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});}
    return native(u,o);
   };
  });
  const read=()=>worker.evaluate(async()=>{const [t]=await chrome.tabs.query({active:true});return readVideoPage(t.id,t.url);});
  const open=async()=>{await worker.evaluate(async()=>{const [t]=await chrome.tabs.query({active:true});await openClipPanel(t);});await page.waitForFunction(()=>document.querySelector('feishu-clip-panel')?.shadowRoot.querySelector('#primary')?.disabled===false);};
  const panel=page.locator('feishu-clip-panel');
  html=`<main><section><div><video controls src="${ahaVideo}" poster="${poster}"></video></div><div><h1>作品</h1><p class="whitespace-pre-wrap">生成产品视频。场景一：产品特写。</p></div></section><aside><video src="https://cdn.ahaprompt.app/recommend.mp4"></video>推荐污染</aside></main>`;
  await page.goto(aha);let data=await read();assert.equal(data.videos.length,1);assert.equal(data.content.text,'生成产品视频。场景一：产品特写。');
  await open();assert.equal(await panel.locator('#include-video').isChecked(),true);assert.equal(await panel.locator('#clip-content').inputValue(),'生成产品视频。场景一：产品特写。');
  await panel.locator('#clip-content').fill('没有明确分类的描述');
  await page.waitForTimeout(500);
  assert.match(await panel.locator('#classification-path').textContent(),/尚未确定/);
  await panel.locator('#primary').click();
  assert.equal(await worker.evaluate(()=>writes.length),0);
  await panel.locator('#groups button').filter({hasText:'生图提示词'}).click();
  await panel.locator('#subcategories button').filter({hasText:'人物'}).click();
  await panel.locator('#back').click();
  await panel.locator('#clip-content').fill('生成产品视频。场景一：产品特写。');
  await page.waitForTimeout(500);
  assert.match(await panel.locator('#classification-path').textContent(),/生图提示词.*人物/);
  await panel.locator('#primary').click();
  await panel.locator('#reclassify').click();
  assert.match(await panel.locator('#classification-path').textContent(),/视频提示词.*成品提示词/);
  console.log('PASS prompt-only matching, manual fallback, preserved choices and explicit reclassification');
  await panel.locator('#back').click();
  await panel.locator('.thumbnail').first().click();
  await page.setViewportSize({width:1280,height:900});
  await panel.locator('#video-preview').evaluate(v=>{v.currentTime=1;});
  await page.screenshot({path:path.join(root,'output/playwright/video-panel-150.png')});
  await panel.locator('#primary').click();
  assert.equal(await panel.locator('#subcategories [aria-pressed="true"]').textContent(),'成品提示词');
  await panel.locator('#styles button').filter({hasText:'3D动画'}).click();
  await panel.locator('#primary').click();await panel.locator('#success-step').waitFor({state:'visible'});
  let writes=await worker.evaluate(()=>writes);assert.equal(writes.length,1);assert.equal(writes[0].fields['成品视频'][0].file_token,'video-token');assert.equal(writes[0].fields['封面'][0].file_token,'cover-token');assert.equal(writes[0].fields['子分类'],'3D动画');assert.match(writes[0].clientToken,/^[a-f0-9-]{36}$/);
  console.log('PASS actual extension: Aha extraction, video preview, default classification, cover + video upload and record fields');
  html=`<section><video controls src="${meigenVideo}"></video><div><div><span>Image · 1</span></div><p class="whitespace-pre-wrap">错误的参考图提示词</p></div><div><div><span>Video · 2</span></div><p class="whitespace-pre-wrap">生成一个视频。场景一：机器人起身。</p></div></section>`;
  await page.goto(meigen);data=await read();assert.equal(data.videos.length,1);assert.equal(data.content.text,'生成一个视频。场景一：机器人起身。');
  await open();assert.equal(await panel.locator('#clip-content').inputValue(),'生成一个视频。场景一：机器人起身。');
  await worker.evaluate(()=>failVideo=true);
  await panel.locator('#primary').click();
  await panel.locator('#primary').click();
  await page.waitForFunction(()=>document.querySelector('feishu-clip-panel').shadowRoot.querySelector('#status').textContent.includes('模拟视频上传失败'));
  assert.equal(await worker.evaluate(()=>writes.length),1);
  await worker.evaluate(()=>{failVideo=false;missingVideoField=true;});
  await panel.locator('#primary').click();await page.waitForFunction(()=>document.querySelector('feishu-clip-panel').shadowRoot.querySelector('#status').textContent.includes('附件字段'));
  assert.equal(await worker.evaluate(()=>writes.length),1);
  await panel.locator('#back').click();await panel.locator('#include-video').uncheck();await panel.locator('#primary').click();await panel.locator('#primary').click();await panel.locator('#success-step').waitFor({state:'visible'});
  writes=await worker.evaluate(()=>writes);assert.equal(writes.length,2);assert(!writes[1].fields['成品视频']);
  console.log('PASS Meigen image/video prompt isolation; failed upload/missing field creates no record; opt-out preserves text save');
  await worker.evaluate(() => {missingVideoField=false;});
  await page.reload();await open();
  await panel.locator('#clip-content').fill('视频中的人物情绪：从愤怒到悲伤');
  await panel.locator('#primary').click();
  assert.equal(await panel.locator('#subcategories [aria-pressed="true"]').textContent(),'人物情绪');
  await panel.locator('#primary').click();await panel.locator('#success-step').waitFor({state:'visible'});
  writes=await worker.evaluate(()=>writes);assert.equal(writes.length,3);assert.equal(writes[2].fields['主分类'],'视频-人物情绪');assert.equal(writes[2].fields['成品视频'][0].file_token,'video-token');
  console.log('PASS video attachment saved to emotion category, independent of finished prompt category');
  html='<main><video controls src="https://media.example.org/play?id=1"></video><video controls src="https://media.example.org/second.mp4"></video></main>';
  await page.goto('https://example.org/watch/1');data=await read();assert.equal(data.videos.length,2);assert.equal(data.videos[0].variants[0].src,'https://media.example.org/play?id=1');
  html='<div data-item-key="7675665548755176758"><video src="https://media.example.org/play?id=1"></video></div><div data-item-key="other"><video src="https://media.example.org/other.mp4"></video></div>';
  await page.goto('https://www.douyin.com/jingxuan?modal_id=7675665548755176758');data=await read();assert.equal(data.videos.length,1);assert.match(data.videos[0].id,/7675665548755176758/);
  html='<video controls src="https://media.example.org/note.mp4"></video>';
  await page.goto('https://www.xiaohongshu.com/explore/6a92ae140000000025013bac');data=await read();assert.equal(data.videos.length,1);
  console.log('PASS generic domains and extensionless URLs, Douyin exact work isolation, Xiaohongshu video');
  html=`<article><a href="/Ameliance_/status/2098840760258871562"><time>时间</time></a><div data-testid="tweetText">ضحكوني 😂</div><div data-testid="videoPlayer"><img src="https://pbs.twimg.com/amplify_video_thumb/${amelianceMedia}/img/QxQkHM7pCgq0oI3W.jpg"></div></article>`;
  await page.goto(ameliance);
  await page.evaluate(mediaId=>{document.querySelector('article').__reactPropsFixture={children:{props:{children:[{media_key:`13_${mediaId}`,video_info:{variants:[
   {content_type:'application/x-mpegURL',url:`https://video.twimg.com/amplify_video/${mediaId}/pl/playlist.m3u8`},
   {bitrate:632000,content_type:'video/mp4',url:`https://video.twimg.com/amplify_video/${mediaId}/vid/avc1/320x568/a.mp4`},
   {bitrate:950000,content_type:'video/mp4',url:`https://video.twimg.com/amplify_video/${mediaId}/vid/avc1/480x852/a.mp4`},
   {bitrate:2176000,content_type:'video/mp4',url:`https://video.twimg.com/amplify_video/${mediaId}/vid/avc1/720x1280/a.mp4`}
  ]}}]}}};},amelianceMedia);
  data=await read();assert.equal(data.videos.length,1);assert.equal(data.videos[0].variants.length,3);assert.equal(data.videos[0].variants[0].label,'720x1280');
  await open();assert.equal(await panel.locator('#include-video').isChecked(),true);assert.equal(await panel.locator('#video-choice option').count(),3);
  await page.evaluate(()=>history.pushState({},'','/Ameliance_/status/2098840760258871562/video/1'));
  await panel.locator('#primary').click();assert.equal(await panel.locator('#step-two').getAttribute('aria-current'),'step');assert.doesNotMatch(await panel.locator('#status').textContent(),/地址已变化|重新打开/);await panel.locator('#back').click();
  await page.evaluate(({statusId,mediaId})=>{
   history.pushState({},'',`/Saccc_c/status/${statusId}`);document.title='切换后的视频';
   document.querySelector('article').outerHTML=`<article><a href="/Saccc_c/status/${statusId}"><time>时间</time></a><div data-testid="tweetText">切换后的原帖正文</div><div data-testid="videoPlayer"><img src="https://pbs.twimg.com/amplify_video_thumb/${mediaId}/img/a.jpg"></div></article>`;
   document.querySelector('article').__reactPropsFixture={children:{media_key:`13_${mediaId}`,video_info:{variants:[{bitrate:2,url:`https://video.twimg.com/amplify_video/${mediaId}/vid/2560x1440/a.mp4`}]}}};
  },{statusId:'2097225315089256814',mediaId:'2097225253386866688'});
  await worker.evaluate(async()=>{const [t]=await chrome.tabs.query({active:true});await openClipPanel(t);});
  await page.waitForFunction(()=>{const root=document.querySelector('feishu-clip-panel')?.shadowRoot;return root?.querySelector('#clip-title')?.value==='切换后的视频'&&root.querySelectorAll('#video-choice option').length===1;});
  assert.equal(await panel.isHidden(),false);assert.equal(await panel.locator('#video-choice option').count(),1);assert.doesNotMatch(await panel.locator('#status').textContent(),/地址已变化|重新打开/);
  console.log('PASS target X post without a video element; nested media_key variants; one-click SPA post reload');
  html=`<article><a href="/Saccc_c/status/2097225315089256814"><time>时间</time></a><div data-testid="tweetText">原帖正文</div><video controls style="visibility:hidden" poster="https://pbs.twimg.com/amplify_video_thumb/2097225253386866688/img/a.jpg"></video><div role="link"><video poster="https://pbs.twimg.com/amplify_video_thumb/999/img/a.jpg"></video></div></article><article><a href="/other/status/999"><time>推荐</time></a><video></video></article>`;
  await page.goto(x);
  await page.evaluate(()=>{document.querySelector('article').__reactPropsFixture={media:[{id_str:'2097225253386866688',video_info:{variants:[{bitrate:1,url:'https://video.twimg.com/amplify_video/2097225253386866688/vid/640x360/a.mp4'},{bitrate:2,url:'https://video.twimg.com/amplify_video/2097225253386866688/vid/2560x1440/a.mp4'}]}},{id_str:'999',video_info:{variants:[{url:'https://video.twimg.com/amplify_video/999/vid/640x360/a.mp4'}]}}]};});
  data=await read();assert.equal(data.videos.length,1);assert.equal(data.videos[0].variants.length,2);assert.equal(data.videos[0].variants[0].label,'2560x1440');
  await open();assert.equal(await panel.locator('#video-choice option').count(),2);
  await page.setViewportSize({width:390,height:844});
  assert(await panel.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
  await page.screenshot({path:path.join(root,'output/playwright/video-panel-150-mobile.png')});
  await page.evaluate(()=>history.pushState({},'', '/other/status/999'));
  await panel.locator('#primary').click();assert.match(await panel.locator('#status').textContent(),/地址已变化/);
  assert.equal(await worker.evaluate(()=>writes.length),3);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS X original media ID, exclude quotes/recommendations, quality ordering, mobile layout and SPA navigation guard');
 } finally {await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
