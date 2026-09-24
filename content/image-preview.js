(() => {
  "use strict";
  if (globalThis.ClipPreview) return;
  const states = new WeakMap();
  const cache = new Map();
  const queue = [];
  let active = 0;
  async function pump() {
    if (active >= 3 || !queue.length) return;
    const { src, resolve, reject } = queue.shift();
    active++;
    try {
      const response = await chrome.runtime.sendMessage({ type: "CLIP Preview Image", src });
      if (!response?.base64 || response.error) throw new Error(response?.error || "预览加载失败");
      resolve(new Blob([Uint8Array.from(atob(response.base64), char => char.charCodeAt(0))], { type: response.mime }));
    } catch (error) { cache.delete(src); reject(error); }
    finally { active--; pump(); }
  }
  function getPreview(src) {
    if (!cache.has(src)) {
      cache.set(src, new Promise((resolve, reject) => { queue.push({ src, resolve, reject }); }));
      pump();
      if (cache.size > 16) cache.delete(cache.keys().next().value);
    }
    return cache.get(src);
  }
  function clear(img) {
    const previous = states.get(img);
    if (previous) {
      clearTimeout(previous.timer);
      img.removeEventListener("load", previous.loaded);
      img.removeEventListener("error", previous.failed);
      previous.canvas?.remove();
    }
    states.delete(img);
    img.removeAttribute("src");
    img.hidden = true;
  }
  function attach(img, item, onState = () => {}) {
    const existing = states.get(img);
    if (existing?.src === item.src && existing.stage !== "error") {
      img.hidden = !!existing.canvas;
      return;
    }
    clear(img);
    const state = { src: item.src, stage: "direct", canvas: null, timer: null };
    states.set(img, state);
    const current = () => states.get(img) === state;
    const notify = value => { if (current()) onState(value); };
    const fallback = async () => {
      if (!current() || state.stage === "fallback") return;
      state.stage = "fallback";
      clearTimeout(state.timer);
      notify("loading");
      try {
        const blob = await getPreview(item.src);
        if (!current() || !img.isConnected) return;
        const bitmap = await createImageBitmap(blob);
        try {
          if (!current()) return;
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          canvas.className = "image-fallback";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", img.alt || item.alt || "图片预览");
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          img.after(canvas);
          state.canvas = canvas;
          img.hidden = true;
          notify("ready");
        } finally { bitmap.close(); }
      } catch { if (current()) { state.stage = "error"; img.hidden = true; notify("error"); } }
    };
    state.loaded = () => {
      if (!current() || state.stage === "fallback") return;
      clearTimeout(state.timer);
      notify("ready");
    };
    state.failed = () => {
      if (!current() || state.stage === "fallback") return;
      if (state.stage === "direct" && img.crossOrigin === null && /^https?:/i.test(item.src)) {
        state.stage = "cors";
        img.crossOrigin = "anonymous";
        img.src = item.src;
      } else fallback();
    };
    img.addEventListener("load", state.loaded);
    img.addEventListener("error", state.failed);
    if (item.crossOrigin === "anonymous" || item.crossOrigin === "use-credentials") img.crossOrigin = item.crossOrigin;
    else img.removeAttribute("crossorigin");
    img.referrerPolicy = item.referrerPolicy || "";
    img.hidden = false;
    // Attach handlers before assigning src: cached failures may fire immediately.
    state.timer = setTimeout(fallback, 7000);
    img.src = item.src;
  }
  globalThis.ClipPreview = { attach, clear };
})();
