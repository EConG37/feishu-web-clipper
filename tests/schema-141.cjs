const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), assert = require('assert/strict');
const {chromium} = require(require('os').homedir()+'/AppData/Roaming/npm/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'output/verified-schema-141.json'), 'utf8').replace(/^\uFEFF/, ''));
const sandbox = {structuredClone}; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'shared/constants.js'), 'utf8') + ';globalThis.defaults=DEFAULT_TAXONOMY;globalThis.migrate=migrateTaxonomy;', sandbox);
const old = structuredClone(sandbox.defaults); delete old['视频提示词'].children['成品提示词'];
old['生图提示词'].children['人物'].styles = ['我的自定义风格'];
const migrated = sandbox.migrate(old);
assert.equal(migrated['生图提示词'].children['人物'].styles[0], '我的自定义风格');
assert.equal(migrated['视频提示词'].children['成品提示词'].styles.length, 5);
(async () => {
  const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'clip141-')), {
    executablePath:require('os').homedir()+'/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe', headless:true,
    args:[`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async ({schema,old}) => {
      await chrome.storage.local.set({feishu_clip_config:{appId:'fixture',appSecret:'fixture',appToken:schema.appToken},clip_taxonomy:old});
      const nativeFetch = fetch;
      globalThis.fetch = async url => {
        if (!String(url).startsWith('https://open.feishu.cn/')) return nativeFetch(url);
        if (String(url).includes('tenant_access_token')) return new Response(JSON.stringify({code:0,tenant_access_token:'fixture',expire:3600}));
        const table = schema.tables.find(t => String(url).includes(t.table_id));
        return new Response(JSON.stringify({code:0,data:{items:table ? table.fields : schema.tables.map(({fields,...t})=>t)}}));
      };
    }, {schema,old});
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options/options.html`);
    await page.locator('.taxonomy-card').first().waitFor();
    assert.equal(await page.locator('.taxonomy-card').count(),9);
    await page.locator('#sync-schema').click();
    await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('已读取'));
    await page.evaluate(() => {
      const source = cloud.tables.find(table => table.name === '视频参数-影视效应');
      const creative = structuredClone(source); creative.name = '视频提示词-创意视频';
      creative.fields.find(field => field.field_name === '主分类').property.options = [{name:'视频-创意视频'}];
      creative.fields.find(field => field.field_name === '子分类').property.options = [{name:'脑洞短片'},{name:'创意广告'}];
      creative.fields.find(field => field.field_name === '使用模型').property.options = [{name:'seedance2.0'},{name:'seedance2.5'},{name:'minimaxH3'},{name:'KelingO3'}];
      cloud.tables.push(creative); render();
    });
    let creator = page.locator('.category-create[data-group="视频提示词"]');
    await creator.locator('summary').click();
    await creator.getByLabel('新分类目标子表：视频提示词').selectOption('视频提示词-创意视频');
    assert.equal(await creator.getByLabel('新分类名称：视频提示词').inputValue(), '创意视频');
    await creator.getByRole('button', {name:'添加分类'}).click();
    const creativeCard = page.locator('.taxonomy-card').filter({has:page.locator('summary', {hasText:'创意视频'})});
    assert.equal(await page.locator('.taxonomy-card').count(), 10);
    assert(await creativeCard.evaluate(element => element.open));
    assert.equal(await creativeCard.getByLabel('目标子表', {exact:true}).inputValue(), '视频提示词-创意视频');
    assert.equal(await creativeCard.getByLabel('写入主分类', {exact:true}).inputValue(), '视频-创意视频');
    assert.match(await creativeCard.locator('summary').textContent(), /2 个风格 \/ 4 个模型/);
    creator = page.locator('.category-create[data-group="视频提示词"]');
    await creator.locator('summary').click();
    await creator.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(root,'output/playwright/options-category-create-173.png')});
    await creator.getByLabel('新分类名称：视频提示词').fill('临时分类');
    await creator.getByRole('button', {name:'添加分类'}).click();
    const temporaryCard = page.locator('.taxonomy-card').filter({has:page.locator('summary', {hasText:'临时分类'})});
    page.once('dialog', dialog => dialog.accept());
    await temporaryCard.getByRole('button', {name:'删除这个分类'}).click();
    assert.equal(await temporaryCard.count(), 0);
    for (const id of ['connection', 'organization', 'collection']) {
      await page.locator(`.sidebar nav a[href="#${id}"]`).click();
      await page.waitForFunction(id => document.querySelector('.sidebar nav a.active')?.hash === '#' + id, id);
      assert.equal(await page.locator('.sidebar nav [aria-current="location"]').count(), 1);
    }
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('.sidebar nav a.active')?.hash === '#organization');
    const dropdown = page.locator('.taxonomy-card[open] select').first();
    const style = await dropdown.evaluate(el => ({radius:getComputedStyle(el).borderRadius, appearance:getComputedStyle(el).appearance}));
    assert.equal(style.radius, '8px'); assert.equal(style.appearance, 'none');
    await dropdown.scrollIntoViewIfNeeded(); await dropdown.focus();
    await page.screenshot({path:path.join(root,'output/playwright/options-161-controls.png')});
    // Renamed target with changed main options must be selectable without collapsing.
    await page.evaluate(() => {
      const original = cloud.tables.find(t => t.name === '视频参数-人物情绪');
      const renamed = structuredClone(original); renamed.name = '人物情绪新版';
      renamed.fields.find(f => f.field_name === '主分类').property.options = [{name:'情绪新版主分类'}];
      cloud.tables.push(renamed); render();
    });
    const emotion = page.locator('.taxonomy-card').filter({has:page.locator('summary', {hasText:'人物情绪'})});
    await emotion.locator('summary').click();
    await page.evaluate(() => {
      const invalid = structuredClone(cloud.tables.find(t => t.name === '人物情绪新版'));
      invalid.name = '字段变化的情绪表';
      invalid.fields.find(f => f.field_name === '分类').type = 3;
      cloud.tables.push(invalid); render();
    });
    await emotion.getByLabel('目标子表', {exact:true}).selectOption('字段变化的情绪表');
    assert.equal(await emotion.getByLabel('目标子表', {exact:true}).inputValue(), '字段变化的情绪表');
    assert(await emotion.evaluate(el => el.open));
    assert.match(await emotion.locator('[role="status"]').textContent(), /已保留目标子表/);
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#msg').textContent.includes('已保存'));
    assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('clip_taxonomy')).clip_taxonomy['视频提示词'].children['人物情绪'].table), '字段变化的情绪表');
    await emotion.getByLabel('目标子表', {exact:true}).selectOption('人物情绪新版');
    assert(await emotion.evaluate(el => el.open));
    assert.equal(await emotion.getByLabel('目标子表', {exact:true}).inputValue(), '人物情绪新版');
    assert.equal(await emotion.getByLabel('写入主分类', {exact:true}).inputValue(), '情绪新版主分类');
    await emotion.getByLabel('目标子表', {exact:true}).selectOption('视频参数-人物情绪');
    assert.equal(await emotion.getByLabel('写入主分类', {exact:true}).inputValue(), '');
    await page.locator('#save').click();
    assert.match(await page.locator('#msg').textContent(), /选择写入主分类/);
    await emotion.getByLabel('写入主分类', {exact:true}).selectOption('视频-人物情绪');
    assert(await emotion.evaluate(el => el.open));
    await page.locator('#save').click();
    await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('已保存'));
    const saved = await worker.evaluate(async()=>(await chrome.storage.local.get('clip_taxonomy')).clip_taxonomy);
    for (const name of ['镜头画面','运镜方案','影视效应','人物情绪']) assert.equal(saved['视频提示词'].children[name].table,`视频参数-${name}`);
    assert.deepEqual(saved['视频提示词'].children['成品提示词'].styles,['女频网红','3D动画','古风正剧','现代正剧','科幻质感']);
    assert.equal(saved['视频提示词'].children['创意视频'].table, '视频提示词-创意视频');
    assert.deepEqual(saved['视频提示词'].children['创意视频'].styles, ['脑洞短片','创意广告']);
    await page.reload(); await page.locator('.taxonomy-card').first().waitFor();
    assert.equal(await page.locator('.taxonomy-card[open] .option-tag').count(),9);
    await page.setViewportSize({width:1380,height:1000});
    await page.screenshot({path:path.join(root,'output/playwright/options-141-full.png'),fullPage:true});
    const clipPage = await context.newPage();
    await clipPage.route('**/custom-category-fixture', route => route.fulfill({contentType:'text/html; charset=utf-8', body:'<!doctype html><meta charset="utf-8"><title>创意视频灵感</title><article><h1>创意视频</h1><p>创意视频，脑洞短片，快速转场与产品展示。</p></article>'}));
    await clipPage.goto('http://127.0.0.1:8902/custom-category-fixture');
    await clipPage.bringToFront();
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      await openClipPanel(tab);
    });
    const clipPanel = clipPage.locator('feishu-clip-panel');
    await clipPanel.locator('#primary:not([disabled])').waitFor();
    await clipPanel.locator('#primary').click();
    await clipPanel.locator('#groups button').filter({hasText:'视频提示词'}).click();
    const creativeChoice = clipPanel.locator('#subcategories button').filter({hasText:'创意视频'});
    assert.equal(await creativeChoice.count(), 1);
    await creativeChoice.click();
    assert.equal(await creativeChoice.getAttribute('aria-pressed'), 'true');
    await clipPage.close();
    await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    console.log('PASS custom category add/delete, schema binding, settings migration, save/reload and mobile layout; no remote writes');
  } finally { await context.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
