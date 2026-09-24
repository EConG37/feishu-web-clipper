(() => {
  "use strict";
  if (globalThis.__clipPanelInstalled) return;
  globalThis.__clipPanelInstalled = true;
  let host, root, previousFocus, pageUrl = "", step = 1;
  let images = [], selectedSrc = null, selectedModel = "", taxonomy = {};
  let videos = [], videoSrc = '', imageData = {}, saveFingerprint = '', requestId = '';
  let selectedGroup = "", selectedSubcat = "", selectedStyle = "";
  let manualClassification = false, autoClassify = true, classifyTimer = null, classificationNote = '';
  let busy = false, saved = false, ready = false, configured = false, revision = 0, contentEdited = false;
  const $ = id => root.getElementById(id);
  const request = async (type, extra = {}) => {
    const result = await chrome.runtime.sendMessage({ type, ...extra });
    if (!result) throw new Error("插件未响应，请刷新网页后重试");
    if (result.error) throw new Error(result.error);
    return result;
  };
  function pageKey(raw) {
    try {
      const url = new URL(raw, location.href);
      const statusId = /(^|\.)(x\.com|twitter\.com)$/i.test(url.hostname) && url.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/)?.[1];
      if (statusId) return `x-status:${statusId}`;
      url.hash = '';
      return url.href;
    } catch { return String(raw || ''); }
  }
  const isCurrentPage = () => pageKey(location.href) === pageKey(pageUrl);
  function status(message = "", error = false) {
    $("status").textContent = message;
    $("status").className = error ? "error" : "";
  }
  function close() {
    if (!host || host.hidden) return;
    if (host.hidePopover && host.matches(":popover-open")) host.hidePopover();
    host.hidden = true;
    $('video-preview').pause();
    previousFocus?.focus?.({ preventScroll: true });
  }
  function show() {
    previousFocus = document.activeElement;
    host.hidden = false;
    if (host.showPopover && !host.matches(":popover-open")) host.showPopover();
    requestAnimationFrame(() => (saved ? $("primary") : step === 1 ? $("clip-title") : $("back")).focus({ preventScroll: true }));
  }
  function updateCount() { $("word-count").textContent = `${$("clip-content").value.length.toLocaleString()} 字`; }
  function updateControls() {
    for (const control of root.querySelectorAll("main button, main input, main textarea, main select")) control.disabled = busy || saved;
    $("back").disabled = busy;
    $("primary").disabled = busy || !ready;
    $("primary-label").textContent = busy ? "正在保存…" : saved ? "完成" : !ready ? "正在读取…" : step === 1 ? "下一步：确认分类" : selectedGroup && selectedSubcat ? "保存到飞书" : "请先选分类";
    $("primary-arrow").textContent = saved ? "✓" : "→";
    $("footer-hint").textContent = busy ? "保存中，可以收起浮层，稍后重新打开查看结果" : saved ? "已保存到飞书 · 点击完成收起" : step === 1 ? "草稿仅保留在当前页面 · Esc 收起" : "Ctrl / ⌘ + Enter 保存 · 类型与分类必选，风格与模型可留空";
    root.querySelector(".panel").setAttribute("aria-busy", String(busy));
    $('reclassify').disabled = busy || saved || !ready;
    $('edit-classification').disabled = busy || saved || !ready;
    updateClassificationSummary();
  }
  function updateClassificationSummary() {
    $('classification-summary').hidden = saved || step !== 2;
    $('classification-label').textContent = manualClassification ? '已选择分类' : '本地推荐';
    $('classification-path').textContent = [selectedGroup,selectedSubcat,selectedStyle,selectedModel].filter(Boolean).join(' › ') || '尚未确定保存分类';
    $('classification-note').textContent = manualClassification ? '保留你的选择；点击“重新识别”可重新匹配' : classificationNote || '仅根据提示词匹配，不确定项留空';
  }
  function markClassificationManual() {
    manualClassification = true; clearTimeout(classifyTimer); classifyTimer=null;
    updateClassificationSummary();
  }
  function recommendClassification(force = false) {
    clearTimeout(classifyTimer); classifyTimer=null;
    if (busy || saved || (manualClassification && !force)) return;
    if (force) manualClassification=false;
    if (!autoClassify && !force) { classificationNote='自动推荐已关闭，可手动选择或点“重新识别”'; updateControls(); return; }
    const result=ClipClassifier.local($('clip-content').value,taxonomy);
    selectedGroup=result.group; selectedSubcat=result.subcategory; selectedStyle=result.style; selectedModel=result.model;
    classificationNote=result.reason;
    renderGroups();
  }
  function promptChanged() {
    updateCount();
    if (manualClassification || !autoClassify || busy || saved) return;
    selectedGroup=''; selectedSubcat=''; selectedStyle=''; selectedModel='';
    classificationNote='提示词已更新，正在匹配分类…'; renderGroups();
    clearTimeout(classifyTimer); classifyTimer=setTimeout(()=>recommendClassification(),400);
  }
  function editClassification() {
    if (busy || saved || !ready) return;
    if (classifyTimer) recommendClassification();
    selectStep(2); status(); $('groups').querySelector('button')?.focus();
  }
  function selectStep(next) {
    step = next;
    $("content-step").hidden = next !== 1;
    $("organize-step").hidden = next !== 2;
    $("success-step").hidden = next !== 3;
    root.querySelector(".steps").hidden = next === 3;
    $("back").hidden = next !== 2;
    for (const [id, n] of [["step-one", 1], ["step-two", 2]]) {
      $(id).classList.toggle("active", next === n);
      if (next === n) $(id).setAttribute("aria-current", "step");
      else $(id).removeAttribute("aria-current");
    }
    if (next === 2) {
      $("review-title").textContent = $("clip-title").value;
      $("review-detail").textContent = `${$("clip-content").value.length.toLocaleString()} 字 · ${selectedSrc ? "1 张封面" : "无封面"}${videoSrc ? ' · 1 个视频' : ''}`;
      $("review-image").hidden = !selectedSrc;
      $("review-placeholder").hidden = !!selectedSrc;
      if (selectedSrc) ClipPreview.attach($("review-image"), images.find(item => item.src === selectedSrc));
      else ClipPreview.clear($("review-image"));
    }
    updateControls();
  }
  function renderVideos(media = {}, preserve = false) {
    videos = media.videos || [];
    const old = videoSrc;
    const enabled = preserve ? $('include-video').checked : videos.length > 0;
    const choices = videos.flatMap((v,i)=>v.variants.map((item,n)=>({...item,label:v.variants.length > 1 ? `${item.label} · 来源 ${n+1}` : item.label,poster:v.poster,index:i})));
    const select = $('video-choice'); select.replaceChildren();
    for (const item of choices) {
      const option = document.createElement('option'); option.value = item.src;
      option.textContent = `${videos.length > 1 ? '视频 '+(item.index+1)+' · ' : ''}${item.label}`; select.append(option);
    }
    if (choices.some(v=>v.src === old)) select.value = old;
    $('include-video').checked = enabled && !!choices.length;
    $('video-section').hidden = !choices.length && !media.warning;
    $('content-step').classList.toggle('has-video',!$('video-section').hidden);
    $('video-choice').hidden = !choices.length;
    $('video-hint').textContent = media.warning || (choices.length ? '视频保存到所选分类的数据表附件字段。单个视频最多 30MB。' : '未找到可读取的视频。可先播放原视频，再点刷新视频；也可以只保存文字与图片。');
    updateVideo();
    // The presence of a video is not evidence of the prompt's intended category.
  }
  function updateVideo() {
    const chosen = videos.flatMap(v=>v.variants.map(item=>({...item,poster:v.poster}))).find(v=>v.src === $('video-choice').value);
    videoSrc = $('include-video').checked && chosen ? chosen.src : '';
    const preview = $('video-preview'); preview.pause(); preview.hidden = !chosen;
    if (chosen) { if (preview.getAttribute('src') !== chosen.src) preview.src = chosen.src; preview.poster = chosen.poster || ''; }
    else { preview.removeAttribute('src'); preview.removeAttribute('poster'); preview.load(); }
  }
  async function refreshVideos() {
    if (busy || saved) return;
    if (!isCurrentPage()) { status('网页已切换，请重新打开剪藏',true); return; }
    const run = revision; $('refresh-video').disabled = true; status('正在读取作品视频…');
    try {
      const media = await request('CLIP Panel Videos');
      if (run !== revision || busy || saved) return;
      renderVideos(media,true); renderImages(imageData);
      if (media.content?.markdown && !contentEdited) { $('clip-content').value = media.content.markdown; promptChanged(); }
      status(media.warning || '视频已刷新');
    } catch(e) { status(e.message,true); }
    finally { updateControls(); }
  }
  function updateImage() {
    const index = images.findIndex(item => item.src === selectedSrc);
    $("image-preview").classList.toggle("is-selected", index >= 0);
    $("preview-image").hidden = index < 0;
    $("preview-empty").hidden = index >= 0;
    $("clear-image").hidden = index < 0;
    $("preview-index").hidden = index < 0;
    if (index >= 0) {
      ClipPreview.attach($("preview-image"), images[index], state => {
        if (state === "loading") $("image-hint").textContent = "正在加载封面预览…";
        if (state === "error") $("image-hint").textContent = "预览暂时不可用，仍可尝试保存原图或刷新图片";
        if (state === "ready") $("image-hint").textContent = "✓ 已选为封面 · 保存时上传原图";
      });
      $("preview-index").textContent = `${index + 1} / ${images.length}`;
    } else ClipPreview.clear($("preview-image"));
    for (const button of $("thumbnails").children) button.setAttribute("aria-pressed", String(button.dataset.src === selectedSrc));
    $("image-hint").textContent = index >= 0 ? "✓ 已选为封面 · 点击缩略图可切换或取消" : images.length ? "横向浏览图片 · 不选图片也可以保存" : "没有发现大图，可滚动网页加载后刷新图片";
  }
  function renderImages(data = {}) {
    if (data.error) throw new Error(data.error);
    imageData = data;
    const seen = new Set();
    images = [...videos.filter(v=>v.poster).map(v=>({src:v.poster,alt:'作品视频封面'})), data.meta, ...(data.images || [])].filter(item => {
      if (!item?.src || !/^(https?:|blob:|data:image\/)/i.test(item.src) || seen.has(item.src)) return false;
      seen.add(item.src);
      return true;
    });
    if (selectedSrc && !seen.has(selectedSrc)) {
      selectedSrc = null;
      status("原封面已不在候选中，请重新选择");
    }
    $("image-count").textContent = images.length;
    const fragment = document.createDocumentFragment();
    images.forEach((item, index) => {
      const button = document.createElement("button");
      button.className = "thumbnail";
      button.dataset.src = item.src;
      button.setAttribute("aria-label", `封面图片 ${index + 1}${item.alt ? "：" + item.alt : ""}`);
      button.title = item.alt || `图片 ${index + 1}`;
      const img = document.createElement("img");
      img.alt = "";
      button.append(img);
      ClipPreview.attach(img, item, state => {
        button.classList.toggle("preview-loading", state === "loading");
        if (state === "error") {
          const label = document.createElement("span");
          label.textContent = String(index + 1); button.append(label);
          button.title = "预览暂时不可用，可尝试保存或刷新图片";
        }
      });
      button.addEventListener("click", () => {
        selectedSrc = selectedSrc === item.src ? null : item.src;
        updateImage();
      });
      fragment.append(button);
    });
    $("thumbnails").replaceChildren(fragment);
    updateImage();
  }
  function currentChild() {
    return taxonomy[selectedGroup]?.children?.[selectedSubcat] || null;
  }
  function renderModels() {
    const child = currentChild();
    const models = child?.models || [];
    if (!models.includes(selectedModel)) selectedModel = "";
    $("model-empty").hidden = !!models.length;
    $("model-empty").textContent = child ? "此分类暂无模型，可直接保存或到设置中添加" : "先选分类，再选择对应模型";
    const fragment = document.createDocumentFragment();
    for (const name of models) {
      const button = document.createElement("button");
      button.className = "model";
      button.textContent = name;
      button.setAttribute("aria-pressed", String(selectedModel === name));
      button.addEventListener("click", () => {
        markClassificationManual();
        selectedModel = selectedModel === name ? "" : name;
        for (const chip of $("models").children) chip.setAttribute("aria-pressed", String(chip.textContent === selectedModel));
        updateClassificationSummary();
      });
      fragment.append(button);
    }
    $("models").replaceChildren(fragment);
  }
  function renderStyles() {
    const child = currentChild();
    const styles = child?.styles || [];
    if (!styles.includes(selectedStyle)) selectedStyle = "";
    $("style-empty").hidden = !!styles.length;
    $("style-empty").textContent = child ? "此分类暂无风格，可直接保存或到设置中添加" : "先选分类，再选风格";
    const fragment = document.createDocumentFragment();
    for (const name of styles) {
      const button = document.createElement("button");
      button.className = "model";
      button.textContent = name;
      button.setAttribute("aria-pressed", String(selectedStyle === name));
      button.addEventListener("click", () => {
        markClassificationManual();
        selectedStyle = selectedStyle === name ? "" : name;
        for (const chip of $("styles").children) chip.setAttribute("aria-pressed", String(chip.textContent === selectedStyle));
        updateClassificationSummary();
      });
      fragment.append(button);
    }
    $("styles").replaceChildren(fragment);
    renderModels();
  }
  function updateDestination() {
    const child = currentChild();
    $("destination").textContent = !configured ? "尚未连接飞书" : child?.table ? child.table : "选择分类后定位数据表";
  }
  function renderSubcategories() {
    const groupDef = taxonomy[selectedGroup];
    const names = groupDef ? Object.keys(groupDef.children || {}) : [];
    if (!names.includes(selectedSubcat)) selectedSubcat = "";
    $("subcats-hint").textContent = selectedGroup ? "选一个，决定保存到哪张数据表" : "先选类型";
    $("subcat-empty").hidden = !!names.length;
    $("subcat-empty").textContent = selectedGroup ? "此类型暂无分类，可到设置中添加" : "先选择提示词类型";
    const fragment = document.createDocumentFragment();
    for (const name of names) {
      const button = document.createElement("button");
      button.className = "group";
      button.textContent = name;
      button.setAttribute("aria-pressed", String(selectedSubcat === name));
      button.addEventListener("click", () => {
        markClassificationManual();
        if (selectedSubcat === name) return;
        selectedSubcat = name;
        selectedStyle=''; selectedModel='';
        for (const chip of $("subcategories").children) chip.setAttribute("aria-pressed", String(chip.textContent === name));
        renderStyles();
        updateDestination();
        updateControls();
      });
      fragment.append(button);
    }
    $("subcategories").replaceChildren(fragment);
    updateDestination();
    renderStyles();
    updateControls();
  }
  function renderGroups() {
    const names = Object.keys(taxonomy);
    if (!names.includes(selectedGroup)) selectedGroup = "";
    const fragment = document.createDocumentFragment();
    for (const name of names) {
      const button = document.createElement("button");
      button.className = "group";
      button.textContent = name;
      button.setAttribute("aria-pressed", String(selectedGroup === name));
      button.addEventListener("click", () => {
        markClassificationManual();
        if (selectedGroup === name) return;
        selectedGroup = name;
        selectedSubcat = ""; selectedStyle = ""; selectedModel = "";
        for (const chip of $("groups").children) chip.setAttribute("aria-pressed", String(chip.textContent === name));
        renderSubcategories();
      });
      fragment.append(button);
    }
    $("groups").replaceChildren(fragment);
    renderSubcategories();
  }
  async function loadConfig() {
    const config = await request("CLIP Panel Config");
    const nextTaxonomy = config.taxonomy || {};
    const changed = JSON.stringify(taxonomy) !== JSON.stringify(nextTaxonomy);
    taxonomy = nextTaxonomy;
    configured = config.configured;
    autoClassify = config.autoClassify !== false;
    if (changed) renderGroups();
    updateDestination();
    updateControls();
  }
  async function initialize() {
    const run = ++revision;
    pageUrl = location.href;
    clearTimeout(classifyTimer); classifyTimer=null; manualClassification=false; classificationNote='';
    videos = []; videoSrc = ''; saveFingerprint = ''; requestId = ''; renderVideos();
    selectedSrc = null; selectedGroup = ""; selectedSubcat = ""; selectedStyle = ""; selectedModel = ""; saved = false; ready = false; contentEdited = false;
    taxonomy = {}; // 强制重渲染，避免单页跳转后残留旧选中态
    $("clip-title").value = document.title;
    $("clip-content").value = "";
    $("clip-content").placeholder = "正在提取网页内容，也可以直接输入…";
    $("source").textContent = location.hostname;
    renderImages(); updateCount(); selectStep(1); status("正在读取图片与正文…");
    const results = await Promise.allSettled([loadConfig(), request("CLIP Read Page")]);
    if (run !== revision) return;
    const [configResult, pageResult] = results;
    if (pageResult.status === "fulfilled") {
      const data = pageResult.value;
      renderVideos(data.media);
      if (!contentEdited) $("clip-content").value = data.content?.markdown || data.content?.text || "";
      try { renderImages(data.images); } catch (error) { status(error.message, true); }
      status(data.content?.error || data.content?.warning || data.images?.error || "");
    } else status(`提取失败：${pageResult.reason.message}。可以手动填写后保存。`, true);
    if (configResult.status === "rejected") status(`设置读取失败：${configResult.reason.message}`, true);
    $("clip-content").placeholder = "粘贴提示词，或写下你的内容摘录…";
    updateCount(); ready = true; recommendClassification(); updateControls();
  }
  async function refreshImages() {
    if (busy) return;
    if (!isCurrentPage()) { status("网页地址已变化，请关闭后重新打开剪藏，读取当前页面。", true); return; }
    const run = revision;
    $("refresh").disabled = true;
    $("refresh").textContent = "读取中…";
    try {
      const data = await request("CLIP Panel Images");
      if (run === revision && !busy && !saved) renderImages(data);
    } catch (error) { if (run === revision) status(`读取图片失败：${error.message}`, true); }
    finally { if (run === revision) { $("refresh").disabled = busy; $("refresh").textContent = "刷新图片"; } }
  }
  async function primary() {
    if (busy || !ready) return;
    if (saved) { close(); return; }
    if (!isCurrentPage()) { status("网页地址已变化。请先复制需要保留的草稿，关闭后重新打开剪藏。", true); return; }
    const title = $("clip-title").value.trim();
    if (!title) { selectStep(1); status("请为这次收藏填写标题", true); $("clip-title").focus(); return; }
    if (classifyTimer) recommendClassification();
    if (step === 1) { editClassification(); return; }
    if (!selectedGroup || !selectedSubcat) {
      status("请先选择提示词类型和分类，再保存。", true);
      if (!selectedGroup) $("groups").querySelector("button")?.focus();
      else $("subcategories").querySelector("button")?.focus();
      return;
    }
    const payload = {title, content:$('clip-content').value.trim(), url:pageUrl, coverSrc:selectedSrc, videoSrc,
      group:selectedGroup,subcategory:selectedSubcat,style:selectedStyle,model:selectedModel};
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== saveFingerprint) { requestId = crypto.randomUUID(); saveFingerprint = fingerprint; }
    busy = true; updateControls(); status(videoSrc ? '正在读取并上传视频…' : selectedSrc ? "正在上传封面并保存到飞书…" : "正在保存到飞书…");
    try {
      const response = await request("CLIP Save To Feishu", {payload:{...payload,requestId}});
      if (!response.ok) throw new Error(response.error || "保存未完成，请重试");
      saved = true; status();
      $("success-title").textContent = title;
      $("success-detail").textContent = `内容${videoSrc ? '、视频' : ''}${selectedSrc ? '与封面图片' : ''}已保存到飞书`;
      selectStep(3);
    } catch (error) { status(error.message, true); }
    finally { busy = false; updateControls(); if (saved && !host.hidden) $("primary").focus(); }
  }
  async function openSettings() {
    try { await request("CLIP Open Options"); }
    catch (error) { status(error.message, true); }
  }
  function create(html, css) {
    host = document.createElement("feishu-clip-panel");
    host.id = "feishu-clip-panel";
    host.hidden = true;
    if (typeof host.showPopover === "function") host.setAttribute("popover", "manual");
    root = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    // Only the extension's bundled markup is used here. Page text is assigned with textContent/value.
    const template = document.createElement("template"); template.innerHTML = html;
    root.append(template.content.cloneNode(true));
    document.documentElement.append(host);
    $("close").addEventListener("click", close);
    $("settings").addEventListener("click", openSettings);
    $("connection").addEventListener("click", openSettings);
    $("primary").addEventListener("click", primary);
    $('edit-classification').addEventListener('click',editClassification);
    $('reclassify').addEventListener('click',()=>recommendClassification(true));
    for (const id of ["back", "edit"]) $(id).addEventListener("click", () => { if (!busy) { selectStep(1); status(); $("clip-content").focus(); } });
    $("refresh").addEventListener("click", refreshImages);
    $('refresh-video').addEventListener('click',refreshVideos);
    $('include-video').addEventListener('change',updateVideo);
    $('video-choice').addEventListener('change',updateVideo);
    $("clear-image").addEventListener("click", () => { selectedSrc = null; updateImage(); });
    $("clip-content").addEventListener("input", () => { contentEdited = true; promptChanged(); });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); primary(); }
      event.stopPropagation();
    });
    for (const type of ["keyup", "keypress", "click", "pointerdown", "pointerup"]) root.addEventListener(type, event => event.stopPropagation());
  }
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === 'CLIP Save Progress') {
      if (root && busy && msg.requestId === requestId) status(msg.text);
      respond({ok:true}); return false;
    }
    if (msg?.type !== "CLIP Open Panel") return false;
    try {
      if (!host) { create(msg.html, msg.css); show(); initialize().catch(error => status(error.message, true)); }
      else if (!isCurrentPage() && !busy) {
        if (!host.isConnected) document.documentElement.append(host);
        show(); initialize().catch(error => status(error.message, true));
      }
      else if (!host.hidden) close();
      else {
        if (!host.isConnected) document.documentElement.append(host);
        show();
        if (!busy && !saved) loadConfig().catch(error => status(error.message, true));
      }
      respond({ ok: true });
    } catch (error) { respond({ error: error.message }); }
    return false;
  });
})();
