const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
  let listener, click;
  const calls = [];
  const store = {feishu_clip_config:{appId:'app',appSecret:'private-secret',appToken:'base',tableName:'收藏'},clip_categories:['自定义'],clip_category_models:{'自定义':['模型A']}};
  const context = vm.createContext({Blob,AbortController,Uint8Array,TextDecoder,atob,setTimeout,clearTimeout,
    chrome:{
      storage:{local:{get:async()=>store}},
      scripting:{executeScript:async(value)=>calls.push({injection:value})},
      action:{onClicked:{addListener:fn=>{click=fn;}},setBadgeText:async(value)=>calls.push({badge:value}),setBadgeBackgroundColor:async()=>{},setTitle:async(value)=>calls.push({title:value})},
      tabs:{sendMessage:async(id,msg,options)=>{calls.push({id,msg,options});return {ok:true,markdown:'正文',images:[]};}},
      runtime:{onMessage:{addListener:fn=>{listener=fn;}},getURL:p=>'chrome-extension://fixture/'+p,openOptionsPage:async()=>calls.push('settings')}
    },
    fetch:async()=>new Response('bundled asset')
  });
  const run = file => vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  context.importScripts = (...files)=>files.forEach(run);
  run('background.js');
  const send = (type,sender={})=>new Promise(resolve=>listener({type},sender,resolve));
  return {send,calls,click};
}
test('panel config exposes category choices and connection status without credentials',async()=>{
  const app=setup();
  const result=await app.send('CLIP Panel Config');
  assert.equal(result.configured,true);
  assert.equal(result.categories[0],'自定义');
  assert.equal(result.models['自定义'][0],'模型A');
  assert.equal(result.destination,'收藏');
  assert.equal('appSecret' in result,false);
  assert.equal(JSON.stringify(result).includes('private-secret'),false);
});
test('page reads target the sending tab main frame and reject missing tab',async()=>{
  const app=setup();
  assert.match((await app.send('CLIP Read Page')).error,/网页/);
  await app.send('CLIP Read Page',{tab:{id:72},url:'https://example.com/article'});
  assert.equal(app.calls.length,2);
  for(const call of app.calls){assert.equal(call.id,72);assert.equal(call.options.frameId,0);}
  assert.equal(app.calls[0].msg.pageUrl,'https://example.com/article');
});
test('toolbar action injects once per invocation and opens the main frame panel',async()=>{
  const app=setup();
  await app.click({id:14,url:'https://example.com/article'});
  assert.ok(app.calls[0].injection.files.includes('content/panel.js'));
  assert.equal(app.calls[1].msg.type,'CLIP Open Panel');
  assert.equal(app.calls[1].options.frameId,0);
  assert.equal(app.calls.find(c=>c.badge).badge.text,'');
});
test('restricted pages show an actionable toolbar hint without injection',async()=>{
  const app=setup();
  await app.click({id:15,url:'chrome://extensions/'});
  assert.equal(app.calls.some(c=>c.injection),false);
  assert.equal(app.calls.find(c=>c.badge).badge.text,'!');
  assert.match(app.calls.find(c=>c.title).title.title,/普通网页/);
});
