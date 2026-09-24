"use strict";
const $ = id => document.getElementById(id);
let taxonomy = {}, cloud = null;
const bindingWarnings = new Map();
const extractAppToken = value => value.trim().match(/\/base\/([A-Za-z0-9]+)/)?.[1] || value.trim();
const editor = $('taxonomy-editor');
const sync = $('sync-schema');
function message(text, error = false) { $('msg').textContent = text; $('msg').className = error ? 'err' : 'ok'; }
function dirty() { $('save-state').textContent = '有未保存的修改'; }
function field(label, value, onInput, choices) {
  const wrap = document.createElement('label'); wrap.className = 'field'; wrap.append(document.createTextNode(label));
  const input = document.createElement(choices ? 'select' : 'input'); input.setAttribute('aria-label', label);
  if (choices) for (const name of [...new Set([value || '', ...choices])]) { const o = document.createElement('option'); o.value = name; o.textContent = name || '未选择'; input.append(o); }
  input.value = value || ''; input.addEventListener('change', () => { onInput(input.value); dirty(); }); wrap.append(input); return wrap;
}
function tags(card, label, child, key, choices) {
  const section = document.createElement('div'); section.className = 'tag-editor'; section.append(document.createTextNode(label));
  for (const value of child[key] || []) { const b = document.createElement('button'); b.type = 'button'; b.className = 'option-tag'; b.textContent = value + ' ×'; b.addEventListener('click', () => { child[key] = child[key].filter(x => x !== value); dirty(); render(); }); section.append(b); }
  const input = document.createElement(choices ? 'select' : 'input'); input.setAttribute('aria-label', `添加${label}`);
  if (choices) for (const value of ['', ...choices.filter(x => !(child[key] || []).includes(x))]) { const o = document.createElement('option'); o.value = value; o.textContent = value || '选择选项'; input.append(o); }
  const add = document.createElement('button'); add.type = 'button'; add.textContent = '添加'; add.addEventListener('click', () => { const value = input.value.trim(); if (value && !(child[key] || []).includes(value)) { child[key] = [...(child[key] || []), value]; dirty(); render(); } }); section.append(input, add); card.append(section);
}
function selectField(table, name, type) { const f = table.fields.find(x => x.field_name === name); if (!f || f.type !== type) throw new Error(`「${table.name}」的「${name}」应为${type === 3 ? '单选(3)' : '多选(4)'}`); return (f.property?.options || []).map(o => o.name); }
function hydrateChild(group, def, name, child, table) {
  if (!selectField(table, '分类', 4).includes(group)) throw new Error(`子表「${table.name}」不支持「${group}」`);
  const styles = selectField(table, '子分类', 3), models = selectField(table, '使用模型', 3), mains = selectField(table, '主分类', 3);
  const expected = child.mainValue ?? ((child.prefix ?? def.prefix) ? `${child.prefix ?? def.prefix}-${name}` : name);
  const mainValue = mains.includes(expected) ? expected : mains.length === 1 ? mains[0] : '';
  Object.assign(child, {styles, models, mainValue});
  return mainValue;
}
function categoryNameFromTable(group, def, tableName) {
  const prefixes = [`${group}-`, def.prefix ? `${def.prefix}参数-` : '', def.prefix ? `${def.prefix}-` : ''].filter(Boolean);
  const prefix = prefixes.find(value => tableName.startsWith(value));
  return prefix ? tableName.slice(prefix.length) : '';
}
function categoryCreator(group, def) {
  const create = document.createElement('details'); create.className = 'category-create'; create.dataset.group = group;
  const summary = document.createElement('summary'); summary.textContent = '＋ 添加同级分类'; create.append(summary);
  const fields = document.createElement('div'); fields.className = 'category-create-fields';
  const nameLabel = document.createElement('label'); nameLabel.className = 'category-create-field'; nameLabel.append(document.createTextNode('分类名称'));
  const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.placeholder = '例如：创意视频'; nameInput.setAttribute('aria-label', `新分类名称：${group}`); nameLabel.append(nameInput);
  const tableLabel = document.createElement('label'); tableLabel.className = 'category-create-field'; tableLabel.append(document.createTextNode('目标子表'));
  const usedTables = new Set(Object.values(taxonomy).flatMap(item => Object.values(item.children || {}).map(child => child.table)));
  const tableChoices = (cloud?.tables || []).map(table => table.name).filter(name => !usedTables.has(name));
  const tableInput = document.createElement(tableChoices.length ? 'select' : 'input'); tableInput.setAttribute('aria-label', `新分类目标子表：${group}`);
  if (tableChoices.length) {
    for (const name of ['', ...tableChoices]) { const option = document.createElement('option'); option.value = name; option.textContent = name || '选择新增的飞书子表'; tableInput.append(option); }
  } else {
    tableInput.type = 'text'; tableInput.placeholder = `${group}-分类名称`;
  }
  tableLabel.append(tableInput);
  nameInput.addEventListener('input', () => {
    if (tableInput.tagName !== 'SELECT' || tableInput.value) return;
    const exact = `${group}-${nameInput.value.trim()}`;
    if (tableChoices.includes(exact)) tableInput.value = exact;
  });
  tableInput.addEventListener('change', () => {
    if (!nameInput.value.trim()) nameInput.value = categoryNameFromTable(group, def, tableInput.value);
  });
  const add = document.createElement('button'); add.type = 'button'; add.className = 'category-add'; add.textContent = '添加分类';
  add.addEventListener('click', () => {
    const name = nameInput.value.trim() || categoryNameFromTable(group, def, tableInput.value);
    if (!name) { message('请填写新分类名称', true); nameInput.focus(); return; }
    if (['__proto__', 'prototype', 'constructor'].includes(name)) { message('这个分类名称不能使用，请换一个名称', true); nameInput.focus(); return; }
    if (Object.prototype.hasOwnProperty.call(def.children, name)) { message(`「${group}」下已经有「${name}」`, true); nameInput.focus(); return; }
    const tableName = tableInput.value.trim() || `${group}-${name}`;
    const child = {table: tableName, styles: [], models: []};
    const table = cloud?.tables.find(item => item.name === tableName);
    def.children[name] = child;
    bindingWarnings.delete(JSON.stringify([group, name]));
    try {
      if (table) hydrateChild(group, def, name, child, table);
      dirty(); render();
      const card = [...editor.querySelectorAll('.taxonomy-card')].find(item => item.dataset.key === JSON.stringify([group, name]));
      if (card) { card.open = true; card.scrollIntoView({block:'nearest'}); }
      message(table ? `已添加「${name}」并读取子表选项，请检查后保存。` : `已添加「${name}」，请确认目标子表后保存。`);
    } catch (error) {
      const warning = `已添加「${name}」，但未能读取子表选项：${error.message}。请检查目标子表字段。`;
      bindingWarnings.set(JSON.stringify([group, name]), warning);
      dirty(); render(); message(warning, true);
    }
  });
  fields.append(nameLabel, tableLabel, add); create.append(fields);
  const note = document.createElement('p'); note.className = 'category-create-note'; note.textContent = cloud ? '已同步的未绑定子表可直接选择，分类名称会按表名自动填写。' : '可先输入分类名称；同步飞书后还能从下拉框绑定新子表。'; create.append(note);
  return create;
}
function render() {
  const expanded = new Map([...editor.querySelectorAll(".taxonomy-card")].map(card => [card.dataset.key, card.open]));
  editor.replaceChildren();
  for (const [group, def] of Object.entries(taxonomy)) {
    const heading = document.createElement('h3'); heading.textContent = group; editor.append(heading);
    editor.append(field('主分类前缀', def.prefix, value => { def.prefix = value; }));
    editor.append(categoryCreator(group, def));
    for (const [name, child] of Object.entries(def.children)) {
      const card = document.createElement('details'); card.className = 'taxonomy-card'; card.dataset.key = JSON.stringify([group, name]); card.open = expanded.get(card.dataset.key) ?? (name === '成品提示词'); const title = document.createElement('summary'); title.textContent = `${name} · ${(child.styles || []).length} 个风格 / ${(child.models || []).length} 个模型`; card.append(title);
      const table = cloud?.tables.find(t => t.name === child.table);
      card.append(field('目标子表', child.table, value => {
        const t = cloud?.tables.find(x => x.name === value);
        // Store the user choice independently of optional schema hydration.
        child.table = value;
        bindingWarnings.delete(card.dataset.key);
        try {
          if (t) {
            const mainValue = hydrateChild(group, def, name, child, t);
            message(mainValue ? '已切换目标子表，请检查风格和模型后保存。' : '已切换目标子表，请在「写入主分类」中选择对应选项后保存。');
          }
        } catch (e) {
          const warning = `已保留目标子表「${value}」。选项未自动更新：${e.message}。请检查该表字段或手动调整；保存设置不会修改飞书表格。`;
          bindingWarnings.set(card.dataset.key, warning);
          message(warning, true);
        }
        render();
      }, cloud?.tables.map(t => t.name)));
      if (bindingWarnings.has(card.dataset.key)) { const warning = document.createElement('p'); warning.className = 'help-text err'; warning.setAttribute('role', 'status'); warning.textContent = bindingWarnings.get(card.dataset.key); card.append(warning); }
      card.append(field('写入主分类', child.mainValue ?? ((child.prefix ?? def.prefix) ? `${child.prefix ?? def.prefix}-${name}` : name), value => { child.mainValue = value; }, table?.fields.find(f => f.field_name === '主分类')?.property?.options?.map(o => o.name)));
      tags(card, '风格', child, 'styles', table?.fields.find(f => f.field_name === '子分类')?.property?.options?.map(o => o.name));
      tags(card, '模型', child, 'models', table?.fields.find(f => f.field_name === '使用模型')?.property?.options?.map(o => o.name));
      const actions = document.createElement('div'); actions.className = 'category-card-actions';
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'category-remove'; remove.textContent = '删除这个分类';
      remove.addEventListener('click', () => {
        if (!confirm(`确定删除「${group} → ${name}」吗？保存设置后，剪藏面板将不再显示它。`)) return;
        delete def.children[name]; bindingWarnings.delete(card.dataset.key); dirty(); render(); message(`已删除「${name}」，点击“保存设置”后生效。`);
      });
      actions.append(remove); card.append(actions);
      editor.append(card);
    }
  }
}
async function load() { const s = await chrome.storage.local.get([CONFIG_KEY,TAXONOMY_KEY]); const c = s[CONFIG_KEY] || {}; $('appId').value = c.appId || ''; $('appSecret').value = c.appSecret || ''; $('appToken').value = c.appTokenRaw || c.appToken || ''; $('auto-classify').checked = c.autoClassify !== false; taxonomy = migrateTaxonomy(s[TAXONOMY_KEY]); render(); }
sync.addEventListener('click', async () => {
  sync.disabled = true;
  try {
    const stored = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
    if (!stored || stored.appToken !== extractAppToken($('appToken').value) || stored.appId !== $('appId').value.trim() || stored.appSecret !== $('appSecret').value.trim()) throw new Error('请先保存当前连接配置，再同步');
    const result = await chrome.runtime.sendMessage({ type:'CLIP Sync Schema' }); if (!result?.ok) throw new Error(result?.error || '同步失败');
    if (result.appToken !== extractAppToken($('appToken').value)) throw new Error('连接已改变，请重新同步');
    cloud = result;
    const next = structuredClone(taxonomy);
    for (const [group, def] of Object.entries(next)) for (const [name, child] of Object.entries(def.children)) {
      const alias = group === '视频提示词' && child.table === `视频提示词-${name}` ? `视频参数-${name}` : '';
      const t = result.tables.find(x => x.name === child.table) || result.tables.find(x => alias && x.name === alias);
      if (!t) throw new Error(`未找到子表「${child.table}」。已载入子表下拉，请修正目标后重新同步`);
      hydrateChild(group, def, name, child, t); child.table = t.name;
    }
    cloud = result; taxonomy = next; render(); dirty(); message('已读取所选子表的风格和模型，请检查后保存。远端未修改。');
  } catch (e) { render(); message(e.message, true); } finally { sync.disabled = false; }
});
$('appToken').addEventListener('input', () => { cloud = null; render(); });
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); $('save').disabled = true;
  try {
    const appId = $('appId').value.trim(), appSecret = $('appSecret').value.trim(), appTokenRaw = $('appToken').value.trim(), appToken = extractAppToken(appTokenRaw);
    if (!appId || !appSecret || !appToken) throw new Error('App ID、App Secret、多维表格链接均为必填');
    if (!/^[A-Za-z0-9]+$/.test(appToken)) throw new Error('请输入 /base/ 链接或 app_token');
    if (TEMPLATE_BASE_TOKENS.has(appToken)) throw new Error('这是模板表格，请先创建副本，再填写副本链接');
    for (const def of Object.values(taxonomy)) for (const [name, child] of Object.entries(def.children)) {
      if (!child.table?.trim()) throw new Error('目标子表不能为空');
      if (child.mainValue === '') throw new Error(`请为「${name}」选择写入主分类`);
    }
    await chrome.storage.local.set({[CONFIG_KEY]:{appId,appSecret,appToken,appTokenRaw,autoClassify:$('auto-classify').checked},[TAXONOMY_KEY]:taxonomy});
    message('已保存，回到网页即可继续剪藏'); $('save-state').textContent = '偏好设置已更新';
  } catch(e) { message(e.message, true); } finally { $('save').disabled = false; }
});
$('settings-form').addEventListener('input', dirty);
$('guide-link').addEventListener('click', () => { $('usage-guide').open = true; });
document.addEventListener('DOMContentLoaded', () => { load().catch(e => message(e.message, true)); }, {once:true});

// Reflect anchor navigation, including direct links and browser back/forward.
const navigationLinks = [...document.querySelectorAll('.sidebar nav a')];
function updateNavigation() {
  const target = location.hash === '#usage-guide' ? '#collection' : location.hash;
  const selected = navigationLinks.find(link => link.hash === target) || navigationLinks[0];
  for (const link of navigationLinks) {
    link.classList.toggle('active', link === selected);
    if (link === selected) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange', updateNavigation);
updateNavigation();
