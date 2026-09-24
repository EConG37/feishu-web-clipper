const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64');
function setup(options = {}) {
  const calls = [];
  const storage = {
    feishu_clip_config: { appId: 'cli_test', appSecret: 'test_secret', appToken: 'baseTest', tableId: 'tblTarget', ...options.config },
    clip_categories: ['生图提示词', '视频提示词'],
    clip_category_models: { '生图提示词': ['GPT2', 'MJ'], '视频提示词': ['seedance2.5'] },
    ...options.storage
  };
  let listener;
  const context = vm.createContext({ Blob, FormData, Uint8Array, TextDecoder, AbortController, structuredClone, atob, setTimeout, clearTimeout,
    chrome: { action: { onClicked: { addListener() {} } }, storage: { local: { get: async () => storage, set: async (v) => Object.assign(storage, v) } },
      tabs: { sendMessage: (_id, _msg, cb) => cb(options.pageError ? { error: 'CORS blocked' } : { base64: png.toString('base64'), mime: 'image/png' }) },
      runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } },
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes('/auth/')) return Response.json({ code: 0, tenant_access_token: 'tokenTest', expire: 7200 });
      if (url.includes('/medias/')) return Response.json(options.uploadError ? { code: 1061004, msg: 'forbidden' } : { code: 0, data: options.missingToken ? {} : { file_token: 'imageToken' } });
      if (url.endsWith('/records')) return Response.json({ code: 0, data: { record: { record_id: 'recTest' } } });
      if (url.includes('/tables/')) return Response.json({ code: 0, data: { items: [
        { field_name: '分类', type: 4, property: { options: [{ name: '生图提示词' }, { name: '视频提示词' }] } },
        { field_name: '主分类', type: 3, property: { options: [{ name: '生图-人物' }, { name: '视频-镜头画面' }] } },
        { field_name: '子分类', type: 3, property: { options: [{ name: '古风' }] } },
        { field_name: '使用模型', type: 3, property: { options: [{ name: 'MJ' }, { name: 'seedance2.5' }] } }
      ] } });
      if (url.includes('/tables?')) return Response.json({ code: 0, data: { items: [{ table_id: 'tblTarget', name: '生图提示词-人物' }] } });
      if (options.imageError) throw new Error('HTTP 403');
      return new Response(options.htmlImage ? '<html>login</html>' : png, { headers: { 'Content-Type': options.htmlImage ? 'text/html' : 'image/png' } });
    }
  });
  const run = (file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  context.importScripts = (...files) => files.forEach(run);
  run('background.js');
  const save = (payload = {}, tabId = 42, sender = {}) => new Promise((resolve) => {
    assert.equal(listener({ type: 'CLIP Save To Feishu', tabId, payload: { title: '测试', content: '正文', url: 'https://example.com/article', coverSrc: 'https://example.com/cover.png', group: '生图提示词', subcategory: '人物', style: '古风', model: '', ...payload } }, sender, resolve), true);
  });
  return { context, calls, storage, save };
}
test('selected image uploads to configured base and writes its file token to attachment field', async () => {
  const app = setup();
  assert.equal((await app.save()).ok, true);
  const form = app.calls.find((c) => c.url.includes('/medias/')).init.body;
  assert.equal(form.get('parent_type'), 'bitable_image');
  assert.equal(form.get('parent_node'), 'baseTest');
  assert.equal(Number(form.get('size')), png.length);
  assert.equal(form.get('file').size, png.length);
  const record = app.calls.find((c) => c.url.endsWith('/records'));
  assert.match(record.url, /\/tblTarget\/records$/);
  assert.deepEqual(JSON.parse(record.init.body).fields['封面'], [{ file_token: 'imageToken' }]);
});
test('failed image upload does not create a text-only record or return success', async () => {
  const app = setup({ uploadError: true });
  const result = await app.save();
  assert.equal(result.ok, false);
  assert.match(result.error, /封面上传失败/);
  assert.equal(app.calls.some((c) => c.url.endsWith('/records')), false);
});
test('missing attachment token stops record creation', async () => {
  const app = setup({ missingToken: true });
  assert.equal((await app.save()).ok, false);
  assert.equal(app.calls.some((c) => c.url.endsWith('/records')), false);
});
test('blocked direct download falls back to source page', async () => {
  const app = setup({ imageError: true });
  assert.equal((await app.save()).ok, true);
});
test('both image download paths fail with actionable error and no record', async () => {
  const app = setup({ imageError: true, pageError: true });
  const result = await app.save();
  assert.equal(result.ok, false);
  assert.match(result.error, /尚未创建记录/);
  assert.equal(app.calls.some((c) => c.url.endsWith('/records')), false);
});
test('HTML response is rejected instead of uploaded as an image', async () => {
  const app = setup({ htmlImage: true, pageError: true });
  assert.equal((await app.save()).ok, false);
  assert.equal(app.calls.some((c) => c.url.includes('/medias/')), false);
});
test('explicitly clearing image permits text-only save', async () => {
  const app = setup();
  assert.equal((await app.save({ coverSrc: null })).ok, true);
  assert.equal(app.calls.some((c) => c.url.includes('/medias/')), false);
  const fields = JSON.parse(app.calls.find((c) => c.url.endsWith('/records')).init.body).fields;
  assert.equal('封面' in fields, false);
});
test('selected taxonomy table takes precedence over legacy linked table', async () => {
  const app = setup({ config: { tableId: '', appTokenRaw: 'https://example.feishu.cn/base/baseTest?table=tblLinked' } });
  assert.equal((await app.save()).ok, true);
  assert.match(app.calls.find((c) => c.url.endsWith('/records')).url, /\/tblTarget\/records$/);
});
test('cached token is refreshed when credentials change', async () => {
  const app = setup();
  await app.save({ coverSrc: null });
  await app.save({ coverSrc: null });
  assert.equal(app.calls.filter((c) => c.url.includes('/auth/')).length, 1);
  app.storage.feishu_clip_config.appSecret = 'changed';
  await app.save({ coverSrc: null });
  assert.equal(app.calls.filter((c) => c.url.includes('/auth/')).length, 2);
});
test('reject empty and oversized image, detect generic binary PNG', async () => {
  const app = setup();
  await assert.rejects(app.context.ClipImageUtils.validate(new Blob([])), /为空/);
  await assert.rejects(app.context.ClipImageUtils.validate(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)])), /20MB/);
  assert.equal((await app.context.ClipImageUtils.validate(new Blob([png]))).type, 'image/png');
});
test('direct image upload works without a source tab', async () => {
  const app = setup();
  assert.equal((await app.save({}, null)).ok, true);
});
test('selected model writes to 使用模型 select field', async () => {
  const app = setup();
  assert.equal((await app.save({ model: 'MJ' })).ok, true);
  const fields = JSON.parse(app.calls.find((c) => c.url.endsWith('/records')).init.body).fields;
  assert.equal(fields['使用模型'], 'MJ');
  await app.save({ model: 'seedance2.5', categories: ['视频提示词'] });
  const second = JSON.parse(app.calls.filter((c) => c.url.endsWith('/records')).at(-1).init.body).fields;
  assert.deepEqual(second['分类'], ['视频提示词']);
  assert.equal(second['使用模型'], 'seedance2.5');
});
test('model outside configured list is not written', async () => {
  const app = setup();
  assert.equal((await app.save({ model: 'unknown-model' })).ok, true);
  const fields = JSON.parse(app.calls.find((c) => c.url.endsWith('/records')).init.body).fields;
  assert.equal('使用模型' in fields, false);
});
test('template target cannot receive records', async () => {
  for (const appToken of ['ZwXJb3TZVazIuvsqaVacB0Kani2', 'XKZJbYtmNaGXNWsOmRycXhUMnXf']) {
    const app = setup({ config: { appToken } });
    const result = await app.save();
    assert.equal(result.ok, false);
    assert.match(result.error, /创建副本/);
    assert.equal(app.calls.length, 0);
  }
});

test('in-page save uses sender tab for image fallback rather than payload tab', async () => {
  const app = setup({ imageError: true });
  let sourceTab;
  const original = app.context.chrome.tabs.sendMessage;
  app.context.chrome.tabs.sendMessage = (id, msg, cb) => { sourceTab = id; original(id, msg, cb); };
  assert.equal((await app.save({}, 999, { tab: { id: 73 } })).ok, true);
  assert.equal(sourceTab, 73);
});
