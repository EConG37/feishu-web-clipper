"use strict";

// 共享常量（shared/constants.js 定义 CONFIG_KEY / TAXONOMY_KEY / TEMPLATE_BASE_TOKENS / DEFAULT_TAXONOMY）
importScripts("shared/constants.js", "shared/image-utils.js", "shared/video-page.js", "shared/video-upload.js");

async function readVideoPage(tabId, pageUrl) {
  const deadline = Date.now() + 2400;
  let result;
  do {
    [{result} = {}] = await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',func:collectClipVideoPage,args:[pageUrl]});
    if (!result?.mediaPending || result.videos?.length || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  } while (true);
  if (!result) return {videos:[],warning:'视频读取未响应，请刷新网页'};
  result.videos = (result.videos || []).map(v=>({...v,variants:(v.variants || []).filter(item=>ClipVideoUpload.allowed(item.src))})).filter(v=>v.variants.length);
  return result;
}

function sameSourcePage(first, second) {
  const key = raw => {
    try {
      const url = new URL(raw);
      const statusId = /(^|\.)(x\.com|twitter\.com)$/i.test(url.hostname) && url.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/)?.[1];
      if (statusId) return `x-status:${statusId}`;
      url.hash = '';
      return url.href;
    } catch { return String(raw || ''); }
  };
  return key(first) === key(second);
}

// 分类体系通过 shared/constants.js 的 TAXONOMY_KEY 读写（用户可在设置页自定义）

async function openClipPanel(tab) {
  try {
    if (!tab.id || !/^https?:/i.test(tab.url || "")) throw new Error("此页面不支持剪藏，请打开普通网页后重试");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [
      "lib/Readability.js", "lib/turndown.js", "shared/image-utils.js", "shared/classifier.js", "content/collector.js", "content/extractor.js", "content/image-preview.js", "content/panel.js"
    ] });
    const [html, css] = await Promise.all([
      fetch(chrome.runtime.getURL("content/panel.html")),
      fetch(chrome.runtime.getURL("content/panel.css"))
    ]);
    const opened = await chrome.tabs.sendMessage(tab.id, { type: "CLIP Open Panel", html: await html.text(), css: await css.text() }, { frameId: 0 });
    if (!opened?.ok) throw new Error(opened?.error || "页面浮层未响应");
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: "在网页中打开剪藏" });
  } catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#b84444" });
    await chrome.action.setTitle({ tabId: tab.id, title: `无法打开剪藏：${error.message}。可在扩展右键菜单中打开设置。` });
  }
}
chrome.action.onClicked.addListener(openClipPanel);

async function getConfig() {
  const { [CONFIG_KEY]: cfg } = await chrome.storage.local.get(CONFIG_KEY);
  return cfg || {};
}

// 校验自定义分类体系；损坏时回落到默认结构
function normalizeTaxonomy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  let childCount = 0;
  for (const group of Object.values(input)) {
    if (!group || typeof group !== "object" || !group.children) return null;
    for (const child of Object.values(group.children)) {
      if (!child || typeof child !== "object") return null;
      childCount++;
    }
  }
  return childCount ? input : null;
}

async function getTaxonomy() {
  const { [TAXONOMY_KEY]: stored } = await chrome.storage.local.get(TAXONOMY_KEY);
  return migrateTaxonomy(normalizeTaxonomy(stored));
}

// ---- 飞书 API 封装 ----

// tenant_access_token 获取与缓存（飞书官方建议缓存，过期前刷新）
async function getTenantAccessToken(appId, appSecret) {
  const now = Date.now();
  const { clip_token_cache: tokenCache = {} } = await chrome.storage.local.get("clip_token_cache");
  if (tokenCache.appId === appId && tokenCache.appSecret === appSecret && tokenCache.token && now < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await resp.json();
  if (!resp.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败(${data.code})：${data.msg}`);
  }
  const cache = {
    appId, appSecret,
    token: data.tenant_access_token,
    expiresAt: now + (data.expire || 3600) * 1000
  };
  await chrome.storage.local.set({ clip_token_cache: cache });
  return cache.token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ---- 封面获取：Service Worker 直连 → 页面内取图兜底 ----

async function swFetchImage(src) {
  return ClipImageUtils.fetchImage(src, { credentials: "omit" });
}

// 让内容脚本在页面上下文里带 Cookie/Referer 取图（绕过防盗链），返回 base64
function pageFetchImage(tabId, src) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "CLIP Fetch Image", src }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!resp || resp.error) {
        reject(new Error(resp?.error || "页面取图无响应"));
        return;
      }
      try {
        const bytes = Uint8Array.from(atob(resp.base64), (c) => c.charCodeAt(0));
        resolve(new Blob([bytes], { type: resp.mime || "image/png" }));
      } catch (e) {
        reject(new Error("base64 解码失败：" + e.message));
      }
    });
  });
}

function guessFilename(src, mime) {
  let ext = (mime && mime.split("/")[1]) || "";
  if (ext === "svg+xml") ext = "svg";
  if (!ext || ext.length > 5) {
    const m = src.split("?")[0].match(/\.(\w{2,5})$/);
    ext = m ? m[1].toLowerCase() : "png";
  }
  if (ext === "jpeg") ext = "jpg";
  return `cover.${["jpg", "png", "gif", "webp", "bmp", "avif", "svg"].includes(ext) ? ext : "png"}`;
}

// 返回 {blob, warning}
async function fetchImageSmart(tabId, src) {
  try {
    return { blob: await swFetchImage(src), warning: null };
  } catch (swErr) {
    try {
      if (!Number.isInteger(tabId)) throw new Error("原网页已不可用，请重新打开插件");
      return { blob: await ClipImageUtils.validate(await pageFetchImage(tabId, src)), warning: null };
    } catch (pageErr) {
      return {
        blob: null,
        warning: `封面获取失败（${swErr.message}；页面兜底：${pageErr.message}）`
      };
    }
  }
}

// 上传附件到飞书云空间，返回 file_token
async function uploadImage(token, appToken, blob, filename) {
  const form = new FormData();
  form.append("file_name", filename);
  form.append("parent_type", "bitable_image");
  form.append("parent_node", appToken);
  form.append("size", String(blob.size));
  form.append("file", blob, filename);

  const resp = await fetch("https://open.feishu.cn/open-apis/drive/v1/medias/upload_all", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const data = await resp.json();
  if (!resp.ok || data.code !== 0) {
    throw new Error(`封面上传失败(${data.code ?? resp.status})：${data.msg || "请检查网络"}。请确认应用有附件上传权限，并已添加为目标表格的文档应用。`);
  }
  if (!data.data?.file_token) throw new Error("封面上传未返回附件标识，请重试");
  return data.data.file_token;
}

// 读取多维表格的数据表列表
async function listTables(token, appToken) {
  return listSchemaItems(token, appToken, 'tables');
}

async function listSchemaItems(token, appToken, path) {
  const items = [], seen = new Set();
  let pageToken = '';
  do {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/${path}?page_size=100${pageToken ? '&page_token=' + encodeURIComponent(pageToken) : ''}`;
    const response = await fetch(url, { headers: authHeaders(token) });
    const result = await response.json();
    if (!response.ok || result.code !== 0 || !Array.isArray(result.data?.items)) throw new Error(`读取表格结构失败：${result.msg || response.status}`);
    items.push(...result.data.items);
    if (!result.data.has_more) break;
    pageToken = result.data.page_token;
    if (!pageToken || seen.has(pageToken)) throw new Error('表格结构分页异常，请重试');
    seen.add(pageToken);
  } while (true);
  return items;
}

function checkSelect(fields, name, value, expectedType) {
  const field = fields.find(f => f.field_name === name);
  if (!field || field.type !== expectedType) throw new Error(`字段「${name}」应为${expectedType === 3 ? '单选(3)' : '多选(4)'}，请检查所选子表`);
  if (value && !(field.property?.options || []).some(o => o.name === value)) throw new Error(`选项「${value}」不存在于所选子表的「${name}」，请同步飞书选项后重新选择`);
  return field;
}

// 定位数据表：按二级分类对应的表名精确匹配（模板按多张子表分表存储，表名如「生图提示词-人物」）
async function resolveTableId(token, cfg, tableName) {
  const tables = await listTables(token, cfg.appToken);
  if (tables.length === 0) throw new Error("该多维表格中没有任何数据表");
  const found = tables.find((t) => t.name === tableName);
  if (found) return found.table_id;
  throw new Error(`未找到名为「${tableName}」的数据表，现有：${tables.map((t) => t.name).join("、")}。请在设置中核对分类对应的数据表名称。`);
}

// 写入一条记录
async function createRecord(token, appToken, tableId, fields, clientToken) {
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records${clientToken ? '?client_token='+encodeURIComponent(clientToken) : ''}`,
    {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ fields })
    }
  );
  const data = await resp.json();
  if (!resp.ok || data.code !== 0) {
    throw new Error(`写入记录失败(${data.code ?? resp.status})：${data.msg || "网络异常"}。请确认「封面」为附件字段、「主分类」「子分类」「使用模型」「分类」为单选/多选字段，并检查表格编辑权限。`);
  }
  if (!data.data?.record?.record_id) throw new Error("飞书未返回记录编号，请先检查表格中是否已保存，再决定是否重试。");
  return data.data.record;
}

// ---- 消息处理 ----
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (["CLIP Panel Config", "CLIP Read Page", "CLIP Panel Images", "CLIP Panel Videos", "CLIP Preview Image", "CLIP Open Options"].includes(msg?.type)) {
    (async () => {
      try {
        if (msg.type === "CLIP Open Options") {
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
        } else if (msg.type === "CLIP Panel Config") {
          const cfg = await getConfig();
          sendResponse({ taxonomy: await getTaxonomy(), configured: !!(cfg.appId && cfg.appSecret && cfg.appToken), autoClassify:cfg.autoClassify !== false, destination: "飞书多维表格" });
        } else {
          if (!_sender.tab?.id) throw new Error("请从网页中打开剪藏");
          // MessageSender.url remains the document's original URL after X changes
          // routes with history.pushState; tabs.Tab.url reflects the current post.
          const currentPageUrl = _sender.tab.url || _sender.url;
          if (msg.type === 'CLIP Panel Videos') {
            sendResponse(await readVideoPage(_sender.tab.id, currentPageUrl));
          } else if (msg.type === "CLIP Preview Image") {
            const candidates = await chrome.tabs.sendMessage(_sender.tab.id, { type: "CLIP Collect Images" }, { frameId: 0 });
            if (![candidates?.meta, ...(candidates?.images || [])].some(item => item?.src === msg.src)) {
              const media = await readVideoPage(_sender.tab.id, currentPageUrl);
              if (!media.videos.some(v=>v.poster === msg.src)) throw new Error("图片已不在当前页面候选中，请刷新图片");
            }
            const { blob, warning } = await fetchImageSmart(_sender.tab.id, msg.src);
            if (!blob) throw new Error(warning || "无法读取预览图片");
            const bitmap = await createImageBitmap(blob);
            let preview;
            try {
              const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
              const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
              canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
              preview = await canvas.convertToBlob({ type: "image/webp", quality: .85 });
            } finally { bitmap.close(); }
            const bytes = new Uint8Array(await preview.arrayBuffer());
            let binary = "";
            for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
            sendResponse({ base64: btoa(binary), mime: preview.type });
          } else if (msg.type === "CLIP Panel Images") {
            sendResponse(await chrome.tabs.sendMessage(_sender.tab.id, { type: "CLIP Collect Images" }, { frameId: 0 }));
          } else {
            const [content, images] = await Promise.all([
              chrome.tabs.sendMessage(_sender.tab.id, { type: "CLIP Extract Content", pageUrl: currentPageUrl }, { frameId: 0 }),
              chrome.tabs.sendMessage(_sender.tab.id, { type: "CLIP Collect Images" }, { frameId: 0 })
            ]);
            // Text extraction already waits for SPA hydration; read the latest media afterwards.
            const media = await readVideoPage(_sender.tab.id, currentPageUrl).catch(e=>({videos:[],warning:e.message}));
            sendResponse({ content:media.content?.markdown ? media.content : content, images, media });
          }
        }
      } catch (error) { sendResponse({ error: error.message }); }
    })();
    return true;
  }
  if (msg?.type === 'CLIP Sync Schema') {
    (async () => {
      try {
        if (_sender.url !== chrome.runtime.getURL('options/options.html')) throw new Error('请从设置页同步');
        const cfg = await getConfig();
        if (!cfg.appId || !cfg.appSecret || !cfg.appToken) throw new Error('请先保存连接配置');
        const token = await getTenantAccessToken(cfg.appId, cfg.appSecret);
        const tables = await listTables(token, cfg.appToken);
        const schema = [];
        for (const table of tables) {
          const fields = await listSchemaItems(token, cfg.appToken, `tables/${encodeURIComponent(table.table_id)}/fields`);
          schema.push({ ...table, fields });
        }
        sendResponse({ ok: true, appToken: cfg.appToken, tables: schema });
      } catch (error) { sendResponse({ ok: false, error: error.message }); }
    })();
    return true;
  }
  if (msg?.type !== "CLIP Save To Feishu") return false;

  (async () => {
    const warnings = [];
    let keepAlive;
    try {
      const cfg = await getConfig();
      const missing = [];
      if (!cfg.appId) missing.push("App ID");
      if (!cfg.appSecret) missing.push("App Secret");
      if (!cfg.appToken) missing.push("多维表格链接或 app_token");
      if (missing.length) {
        sendResponse({ ok: false, error: `请先在扩展设置中配置：${missing.join("、")}` });
        return;
      }

      const { title, content, url, coverSrc, videoSrc, group, subcategory, style, model, requestId } = msg.payload || {};
      const progress = async text => {
        if (!_sender.tab?.id) return;
        try { await chrome.tabs.sendMessage(_sender.tab.id,{type:'CLIP Save Progress',text,requestId},{frameId:0}); } catch { /* panel may be closed */ }
      };
      if (videoSrc) {
        if (!_sender.tab?.id || !sameSourcePage(_sender.tab.url || _sender.url, url)) throw new Error('视频来源网页已改变，请重新打开剪藏');
        // Chrome 110+: extension API calls keep a long-running upload event alive.
        keepAlive = setInterval(()=>{ chrome.runtime.getPlatformInfo().catch(()=>{}); },20000);
      }
      if (!title) {
        sendResponse({ ok: false, error: "缺少标题" });
        return;
      }
      if (!group || !subcategory) {
        sendResponse({ ok: false, error: "请先在第二步选择提示词类型和分类" });
        return;
      }

      // 审查：模板表格是发布者的只读母版，不允许写入
      if (TEMPLATE_BASE_TOKENS.has(cfg.appToken)) {
        sendResponse({
          ok: false,
          error: "你填的是模板表格链接，模板不能直接剪藏。请先打开模板链接，点击右上角「...」→「创建副本」，然后把副本的链接填到设置里。"
        });
        return;
      }

      const token = await getTenantAccessToken(cfg.appId, cfg.appSecret);

      // 二级分类决定写入哪张数据表；三级风格与模型只保留分类体系里存在的选项
      const taxonomy = await getTaxonomy();
      const child = taxonomy[group]?.children?.[subcategory];
      if (!child) {
        sendResponse({ ok: false, error: `分类「${group} → ${subcategory}」不在当前分类体系中，请重新选择或到设置中添加` });
        return;
      }
      if (style && !(child.styles || []).includes(style)) throw new Error(`风格「${style}」不在当前分类中，请重新选择`);
      if (model && !(child.models || []).includes(model)) throw new Error(`模型「${model}」不在当前分类中，请重新选择`);
      const tableId = await resolveTableId(token, cfg, child.table);
      const schema = await listSchemaItems(token, cfg.appToken, `tables/${encodeURIComponent(tableId)}/fields`);
      const prefix = child.prefix ?? taxonomy[group].prefix;
      const mainValue = child.mainValue || (prefix ? `${prefix}-${subcategory}` : subcategory);
      checkSelect(schema, '分类', group, 4);
      checkSelect(schema, '主分类', mainValue, 3);
      checkSelect(schema, '子分类', style, 3);
      checkSelect(schema, '使用模型', model, 3);

      let videoToken = null, videoField = null;
      if (videoSrc) {
        videoField = ['视频', '成品视频', '参考视频'].find(name => schema.some(f => f.field_name === name && f.type === 17));
        if (!videoField) throw new Error(`「${child.table}」缺少视频附件字段，请添加名为「视频」的附件字段后重试（也兼容「成品视频」「参考视频」）`);
        const media = await readVideoPage(_sender.tab.id,url);
        if (!media.videos.some(v=>v.variants.some(item=>item.src === videoSrc))) throw new Error('视频已不属于当前作品，请返回刷新视频');
        const blob = await ClipVideoUpload.download(videoSrc,progress);
        videoToken = await ClipVideoUpload.upload(token,cfg.appToken,blob,progress);
      }

      // 已选择封面时，必须上传成功后再创建记录，避免静默丢图。
      let coverToken = null;
      if (coverSrc) {
        await progress('正在上传封面…');
        const { blob, warning } = await fetchImageSmart(_sender.tab?.id ?? msg.tabId, coverSrc);
        if (!blob) throw new Error(`${warning}。尚未创建记录，请重试或取消封面后保存。`);
        coverToken = await uploadImage(token, cfg.appToken, blob, guessFilename(coverSrc, blob.type));
      }

      // 2. 组装字段
      const fields = { "标题": title, "链接": { link: url, text: url } };
      if (content) fields["内容"] = content;
      if (coverToken) fields["封面"] = [{ file_token: coverToken }];
      if (videoToken) fields[videoField] = [{file_token:videoToken}];

      // 3. 一级类型写入「分类」；二级分类带前缀写入「主分类」；风格写入「子分类」（均按模板字段）
      fields["分类"] = [group];
      fields["主分类"] = mainValue;
      if (style) fields["子分类"] = style;
      if (model) fields["使用模型"] = model;

      // 4. 定位数据表并写入
      await progress('附件已就绪，正在保存记录…');
      const record = await createRecord(token, cfg.appToken, tableId, fields,
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId || '') ? requestId : undefined);

      sendResponse({ ok: true, warnings, recordId:record?.record_id });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message), warnings });
    } finally { if (keepAlive) clearInterval(keepAlive); }
  })();

  return true; // 保持消息通道开放
});
