(() => {
  "use strict";
  if (globalThis.__clipCollectorInstalled) return;
  globalThis.__clipCollectorInstalled = true;

  // ---- 度量与过滤 ----

  function visibleArea(img) {
    try {
      const rect = img.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) return 0;
      return rect.width * rect.height;
    } catch {
      return 0;
    }
  }

  function decodeEntities(str) {
    const el = document.createElement("textarea");
    el.innerHTML = str;
    return el.value;
  }

  function candidateFromImg(img) {
    const src = img.currentSrc || img.src;
    if (!src || !/^(https?:|blob:|data:image\/)/i.test(src)) return null;

    const w = img.naturalWidth || 0;
    const h = img.naturalHeight || 0;
    // 过滤图标/装饰小图
    if (w > 0 && (w < 200 || h < 120)) return null;
    if (w === 0 && visibleArea(img) < 25000) return null;

    let score = 1;
    if (img.loading === "lazy") score += 1;
    if (/cover|hero|banner|feature|thumb|og|main/i.test(src)) score += 1;
    score += Math.min(3, visibleArea(img) / 200000);

    return {
      type: "img",
      src,
      alt: img.alt || "",
      width: w,
      height: h,
      natural: w > 0 && h > 0 ? { w, h } : null,
      crossOrigin: img.crossOrigin,
      referrerPolicy: img.referrerPolicy,
      score
    };
  }

  function absoluteUrl(raw) {
    if (!raw) return null;
    try {
      return new URL(decodeEntities(raw.trim()), location.href).href;
    } catch {
      return null;
    }
  }

  function candidateFromMeta(rawUrl) {
    if (!rawUrl) return null;
    const url = absoluteUrl(rawUrl);
    if (!url || !/^https?:/i.test(url)) return null;
    return { type: "meta", src: url, alt: "og:image / meta image", width: 0, height: 0, natural: null, score: 100 };
  }

  function collect() {
    const metaRaw =
      document.querySelector('meta[property="og:image"]')?.content ||
      document.querySelector('meta[name="twitter:image"]')?.content ||
      document.querySelector('link[rel="image_src"]')?.href;
    const metaCandidate = candidateFromMeta(metaRaw);

    const seen = new Set(metaCandidate ? [metaCandidate.src] : []);
    const imgCandidates = [...document.images]
      .map(candidateFromImg)
      .filter(Boolean)
      .filter((c) => {
        // 同一 <picture> 中 currentSrc/src 会重复，按 URL 去重
        if (seen.has(c.src)) return false;
        seen.add(c.src);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return {
      meta: metaCandidate,
      images: imgCandidates,
      url: location.href,
      title: document.title
    };
  }

  function pickImageSrc(index) {
    const { meta, images } = collect();
    if (index === -1) return meta ? meta.src : null;
    const c = images[index];
    return c ? c.src : null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CLIP Collect Images") {
      try {
        sendResponse(collect());
      } catch (e) {
        sendResponse({ error: String(e && e.message) });
      }
    } else if (msg?.type === "CLIP Resolve Image") {
      try {
        sendResponse({ src: pickImageSrc(msg.index) });
      } catch (e) {
        sendResponse({ error: String(e && e.message) });
      }
    }
    return false;
  });

  // 页面上下文取图兜底：后台直连失败（防盗链/跨域）时，带着页面 Cookie 与 Referer 再试一次
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "CLIP Fetch Image") return false;

    (async () => {
      try {
        const blob = await ClipImageUtils.fetchImage(msg.src, { credentials: "include" });
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        sendResponse({ base64: btoa(binary), mime: blob.type || "image/png" });
      } catch (e) {
        sendResponse({ error: String(e && e.message) });
      }
    })();

    return true;
  });
})();
