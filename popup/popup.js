"use strict";
const $ = (id) => document.getElementById(id);
let tabId = null;
let pageUrl = "";
let candidates = [];
let selectedSrc = null;
let selectedGroup = "";
let selectedSubcat = "";
let selectedStyle = "";
let selectedModel = "";
let taxonomy = {};
let busy = false;
let saved = false;
let statusFrame = null;
function setStatus(message, kind = "") {
  cancelAnimationFrame(statusFrame);
  $("status").textContent = message;
  $("status").className = kind;
  if (kind === "ok") {
    const icon = document.createElement("span");
    icon.className = "success-icon";
    icon.textContent = "✓";
    icon.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "success-copy";
    const title = document.createElement("strong");
    title.className = "success-title";
    title.textContent = "已成功同步到飞书";
    const detail = document.createElement("span");
    detail.className = "success-detail";
    detail.textContent = message;
    copy.append(title, detail);
    $("status").replaceChildren(icon, copy);
    // Paint the starting state before revealing; a newer status cancels this reveal.
    statusFrame = requestAnimationFrame(() => {
      statusFrame = requestAnimationFrame(() => {
        $("status").classList.add("is-visible");
        statusFrame = null;
      });
    });
  }
}
function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll("main button, main input, main textarea")) control.disabled = value;
  $("clip-btn").disabled = value || saved;
  $("clip-btn").classList.toggle("is-saved", saved);
  $("clip-btn").textContent = value ? "正在保存…" : saved ? "已保存到飞书 ✓" : "保存到飞书 ↗";
  document.body.setAttribute("aria-busy", String(value));
}
function renderModelChips() {
  const wrap = $("model-chips");
  wrap.replaceChildren();
  wrap.hidden = true;
  const child = taxonomy[selectedGroup]?.children?.[selectedSubcat];
  const models = child?.models || [];
  if (!selectedSubcat || !models.length) return;
  wrap.hidden = false;
  for (const model of models) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip sub";
    chip.textContent = model;
    chip.setAttribute("aria-pressed", String(selectedModel === model));
    chip.addEventListener("click", () => {
      selectedModel = selectedModel === model ? "" : model;
      renderModelChips();
    });
    wrap.appendChild(chip);
  }
  const on = [...wrap.querySelectorAll(".chip")].find((c) => c.getAttribute("aria-pressed") === "true");
  if (on) on.classList.add("on");
}
function renderStyleChips() {
  const wrap = $("style-chips");
  wrap.replaceChildren();
  wrap.hidden = true;
  const child = taxonomy[selectedGroup]?.children?.[selectedSubcat];
  const styles = child?.styles || [];
  if (!selectedSubcat || !styles.length) { renderModelChips(); return; }
  wrap.hidden = false;
  for (const style of styles) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip sub";
    chip.textContent = style;
    chip.setAttribute("aria-pressed", String(selectedStyle === style));
    chip.addEventListener("click", () => {
      selectedStyle = selectedStyle === style ? "" : style;
      renderStyleChips();
    });
    wrap.appendChild(chip);
  }
  const on = [...wrap.querySelectorAll(".chip")].find((c) => c.getAttribute("aria-pressed") === "true");
  if (on) on.classList.add("on");
  renderModelChips();
}
function renderSubcatChips() {
  const wrap = $("subcat-chips");
  wrap.replaceChildren();
  wrap.hidden = true;
  const children = taxonomy[selectedGroup]?.children || {};
  const names = Object.keys(children);
  if (!selectedGroup || !names.length) { renderStyleChips(); return; }
  wrap.hidden = false;
  for (const name of names) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = name;
    chip.setAttribute("aria-pressed", String(selectedSubcat === name));
    chip.addEventListener("click", () => {
      if (selectedSubcat === name) return;
      selectedSubcat = name;
      selectedStyle = ""; selectedModel = "";
      renderSubcatChips();
    });
    wrap.appendChild(chip);
  }
  const on = [...wrap.querySelectorAll(".chip")].find((c) => c.getAttribute("aria-pressed") === "true");
  if (on) on.classList.add("on");
  renderStyleChips();
}
function loadCategories() {
  return chrome.storage.local.get("clip_taxonomy").then(({ clip_taxonomy: stored }) => {
    taxonomy = migrateTaxonomy(stored);
    for (const name of Object.keys(taxonomy)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = name;
      chip.setAttribute("aria-pressed", String(selectedGroup === name));
      chip.addEventListener("click", () => {
        if (selectedGroup === name) return;
        selectedGroup = name;
        selectedSubcat = ""; selectedStyle = ""; selectedModel = "";
        renderSubcatChips();
      });
      $("chips").appendChild(chip);
    }
    renderSubcatChips();
  });
}
function updateSelection() {
  for (const cell of $("cover-row").querySelectorAll(".cover-cell")) {
    const selected = cell.dataset.src === selectedSrc;
    cell.classList.toggle("selected", selected);
    cell.setAttribute("aria-pressed", String(selected));
  }
  const index = candidates.findIndex((item) => item.src === selectedSrc);
  $("selection-summary").textContent = index >= 0 ? `✓ 已选第 ${index + 1} 张 · 将同步为封面附件` : "未选择封面 · 仅保存文字";
  $("selection-summary").parentElement.classList.toggle("has-selection", index >= 0);
  $("clear-cover").hidden = index < 0;
}
function renderCovers() {
  $("cover-row").replaceChildren();
  $("cover-count").textContent = candidates.length;
  if (!candidates.length) {
    const empty = document.createElement("div");
    empty.className = "cover-empty";
    empty.textContent = "未发现大图，滚动网页加载后可刷新图片";
    $("cover-row").appendChild(empty);
  }
  candidates.forEach((item, index) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cover-cell";
    cell.dataset.src = item.src;
    cell.setAttribute("aria-label", `封面图片 ${index + 1}${item.alt ? "：" + item.alt : ""}`);
    const img = document.createElement("img");
    img.alt = "";
    img.addEventListener("error", () => {
      const error = document.createElement("span");
      error.className = "noimg";
      error.textContent = "预览不可用 · 可尝试保存";
      cell.appendChild(error);
    });
    img.src = item.src;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = item.type === "meta" ? "网页封面" : `${item.width || "—"} × ${item.height || "—"}`;
    const check = document.createElement("span");
    check.className = "selection-check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "selected-label";
    label.textContent = "已选为封面";
    cell.append(img, badge, check, label);
    cell.addEventListener("click", () => {
      selectedSrc = selectedSrc === item.src ? null : item.src;
      updateSelection();
    });
    $("cover-row").appendChild(cell);
  });
  updateSelection();
}
async function loadCovers() {
  $("refresh-covers").disabled = true;
  $("refresh-covers").textContent = "正在读取…";
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "CLIP Collect Images" });
    if (!response || response.error) throw new Error(response?.error || "页面没有响应");
    const seen = new Set();
    const previous = selectedSrc;
    candidates = [response.meta, ...(response.images || [])].filter((item) => {
      if (!item?.src || seen.has(item.src)) return false;
      seen.add(item.src);
      return true;
    });
    if (selectedSrc && !seen.has(selectedSrc)) selectedSrc = null;
    renderCovers();
    if (previous && !selectedSrc) setStatus("原封面已不在当前候选中，请重新选择", "warn");
  } catch (error) {
    setStatus(`读取图片失败：${error.message}。请刷新原网页后重试。`, "err");
  } finally {
    $("refresh-covers").disabled = busy;
    $("refresh-covers").textContent = "刷新图片";
  }
}
function updateCount() { $("word-count").textContent = `${$("excerpt").value.length.toLocaleString()} 字`; }
async function init() {
  try {
    await loadCategories();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("此页面不支持剪藏，请在普通网页中打开插件");
    tabId = tab.id;
    pageUrl = tab.url;
    $("page-source").textContent = new URL(pageUrl).hostname;
    $("title").value = tab.title || "";
    await chrome.scripting.executeScript({ target: { tabId }, files: ["lib/Readability.js", "lib/turndown.js", "shared/image-utils.js", "content/collector.js", "content/extractor.js"] });
    setStatus("正在提取正文…");
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "CLIP Extract Content", pageUrl });
      $("excerpt").value = response?.error ? "" : response?.markdown || response?.text || "";
      setStatus(response?.error || response?.warning || ($("excerpt").value ? "" : "未提取到正文，可手动填写或仅保存图片"), "warn");
      updateCount();
    } catch { setStatus("未提取到正文，可手动填写或仅保存图片", "warn"); }
    await loadCovers();
    $("clip-btn").disabled = false;
  } catch (error) {
    setStatus(error.message, "err");
    $("page-source").textContent = "当前页面不可用";
    $("clip-btn").disabled = true;
  }
}
async function onClip() {
  if (busy || saved) return;
  const title = $("title").value.trim();
  if (!title) { setStatus("请填写标题", "err"); $("title").focus(); return; }
  if (!selectedGroup || !selectedSubcat) { setStatus("请先选择提示词类型和分类", "err"); return; }
  setBusy(true);
  setStatus(selectedSrc ? "正在上传封面并保存记录，请稍候…" : "正在保存记录，请稍候…");
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  $("status").prepend(spinner);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "CLIP Save To Feishu", tabId,
      payload: { title, content: $("excerpt").value.trim(), url: pageUrl, coverSrc: selectedSrc, group: selectedGroup, subcategory: selectedSubcat, style: selectedStyle, model: selectedModel }
    });
    if (!response?.ok) throw new Error(response?.error || "同步没有完成，请重试");
    saved = true;
    setStatus(selectedSrc ? "内容与封面图片均已保存，可以关闭窗口。" : "内容已保存，本次未添加封面。可以关闭窗口。", "ok");
  } catch (error) {
    setStatus(error.message, "err");
  } finally {
    setBusy(false);
    if (saved) for (const control of document.querySelectorAll("main button, main input, main textarea")) control.disabled = true;
  }
}
$("clip-btn").addEventListener("click", onClip);
$("close-btn").addEventListener("click", () => window.close());
$("open-options").addEventListener("click", async () => {
  try { await chrome.runtime.openOptionsPage(); } catch (error) { setStatus(error.message, "err"); }
});
$("refresh-covers").addEventListener("click", loadCovers);
$("clear-cover").addEventListener("click", () => { selectedSrc = null; updateSelection(); });
$("excerpt").addEventListener("input", updateCount);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
