"use strict";

// X 详情页按帖子 ID 精确提取；普通文章使用 Readability 和正文容器。

(() => {
  if (globalThis.__clipExtractorInstalled) return;
  globalThis.__clipExtractorInstalled = true;
  const EMPTY = { markdown: "", text: "", byline: "", excerpt: "" };

  function xStatusId(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      if (!/(^|\.)(x\.com|twitter\.com)$/i.test(url.hostname)) return null;
      return url.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/)?.[1] || null;
    } catch { return null; }
  }

  function belongsToPost(node, post) {
    if (node.closest('article, [data-testid="tweet"]') !== post) return false;
    // 引用帖常常不是嵌套 article，而是一个可点击的卡片。
    for (let parent = node.parentElement; parent && parent !== post; parent = parent.parentElement) {
      if (parent.matches('[data-testid="quoteTweet"], [data-testid="card.wrapper"], [role="link"]:not(a)')) return false;
    }
    return true;
  }

  function findXPost(statusId) {
    const primary = document.querySelector('[data-testid="primaryColumn"]') || document.querySelector('main') || document;
    const roots = [primary, ...document.querySelectorAll('[role="dialog"]')];
    for (const root of roots) {
      for (const post of root.querySelectorAll('article[data-testid="tweet"], article')) {
        // 使用原帖时间戳的固定链接，不能匹配正文、引用或推荐中的任意链接。
        const timestamps = [...post.querySelectorAll('a[href] time')];
        if (timestamps.some((time) => belongsToPost(time, post) && xStatusId(time.closest('a').href) === statusId)) return post;
      }
    }
    return null;
  }

  function readXPost(post) {
    const textNode = [...post.querySelectorAll('[data-testid="tweetText"]')].find((node) => belongsToPost(node, post));
    if (!textNode) return null;
    const clone = textNode.cloneNode(true);
    clone.querySelectorAll('img[alt]').forEach((img) => img.replaceWith(document.createTextNode(img.alt)));
    clone.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode('\n')));
    // 使用帖子原文，保留 --sref、参数、换行及表情，不做 Markdown 转义。
    const text = (clone.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (!text) return null;
    const truncated = [...post.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].some((node) => belongsToPost(node, post));
    return { ...EMPTY, markdown: text, text, excerpt: text.slice(0, 280), source: 'x-post',
      warning: truncated ? '帖子正文尚未展开，目前仅提取可见文字。请在原帖点击「显示更多」后重新打开插件。' : '' };
  }

  async function extractXPost(statusId) {
    const deadline = Date.now() + 4000;
    while (true) {
      if (xStatusId(location.href) !== statusId) return { ...EMPTY, error: '原网页已切换到其他帖子，请重新打开插件。' };
      const post = findXPost(statusId);
      const result = post && readXPost(post);
      if (result) return { ...result, postId: statusId };
      if (Date.now() >= deadline) {
        return { ...EMPTY, source: 'x-post', postId: statusId, warning: post
          ? '当前帖子未找到可读取的正文，可能仅包含图片或正文尚未展开。可手动填写摘录。'
          : '尚未加载到链接对应的原帖。请在 X 中打开并加载原帖后重试；不会提取推荐内容或回复。' };
      }
      // X 为动态页面；短暂等待正文出现，不访问其他帖子或接口。
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // 常见帖子/文章正文容器（Discuz、贴吧、知乎及通用博客主题）
  const FALLBACK_SELECTORS = [
    ".entry-content", ".post-content", ".post-body", ".post_content",
    ".article-content", ".article_content", ".article-body", "#article",
    ".message-content", ".topic-body", ".topic-post",
    ".t_f",                                   // Discuz! 帖子
    ".d_post_content",                        // 百度贴吧
    ".RichContent-inner", ".Post-RichTextContainer", // 知乎
    "article"
  ];

  function cleanupClone(root) {
    root.querySelectorAll(
      "script,noscript,style,link[rel=stylesheet],iframe,template,nav,header,footer,aside,form,button,[role=navigation],[role=complementary],[aria-hidden=true]"
    ).forEach((n) => n.remove());
  }

  function readabilityParse() {
    if (typeof Readability === "undefined") return null;
    try {
      const clone = document.cloneNode(true);
      cleanupClone(clone);
      return new Readability(clone, { charThreshold: 100 }).parse();
    } catch {
      return null;
    }
  }

  // 优先明确的正文容器，避免把整个 main/页面推荐流当作正文。
  function pickFallbackNode() {
    for (const sel of FALLBACK_SELECTORS) {
      let best = null;
      let bestLen = 0;
      document.querySelectorAll(sel).forEach((node) => {
        const len = (node.innerText || node.textContent || "").trim().length;
        if (len > bestLen) {
          bestLen = len;
          best = node;
        }
      });
      if (best) return best;
    }
    return null;
  }

  function toMarkdown(node) {
    if (typeof TurndownService === "undefined") {
      return (node.textContent || "").trim();
    }
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-"
    });
    td.remove(["script", "style", "noscript"]);
    td.addRule("images", {
      filter: "img",
      replacement: (_content, n) => {
        const alt = (n.getAttribute("alt") || "image").trim();
        const src = n.getAttribute("src") || "";
        return src ? `![${alt}](${src})` : "";
      }
    });
    return td.turndown(node);
  }

  function denseLen(s) {
    return (s || "").replace(/\s/g, "").length;
  }

  function denseContains(haystack, needle) {
    return (haystack || "").replace(/\s/g, "").includes(needle.replace(/\s/g, ""));
  }

  // —— AI 作品页的提示词区块：形如「图片提示词 / Prompt」标签 + 紧邻正文 ——
  const PROMPT_LABEL = /^(图片提示词|视频提示词|音频提示词|提示词|创作提示词|ai\s*提示词|(image|video|audio)\s*prompts?|prompts?)\s*[:：]?$/i;

  function isRendered(el) {
    if (typeof el.checkVisibility === "function") {
      try { return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); } catch { /* 参数不受支持时回退 */ }
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function inlineChildren(el) {
    return [...el.children].every((child) => !/^(svg|i|img|br)$/i.test(child.tagName) ? child.children.length === 0 : true);
  }

  // 区块容器 = 标签与值向上共有的最近祖先，用于把提示词从页面其他文字（作者、点赞等）中隔离出来。
  function promptScope(label, name) {
    let node = label;
    for (let up = 0; up < 6 && node; up++) {
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
      let value = "";
      for (let sib = node.nextElementSibling; sib; sib = sib.nextElementSibling) {
        value += " " + (sib.innerText || sib.textContent || "");
      }
      // 祖先除「标签 + 提示词值」之外还包含大量其他文字（作者栏、操作栏），说明已越出提示词区块。
      const extra = denseLen(text) - denseLen(value) - denseLen(name);
      if (value && extra > 20) break;
      if (denseLen(value) >= 20 && denseLen(value) <= 3000) return node;
      node = node.parentElement;
    }
    return null;
  }

  function promptBlocks() {
    const blocks = [];
    const seenValues = new Set();
    const seenScopes = new Set();
    for (const label of document.querySelectorAll("div,span,p,h3,h4,h5,h6,dt,em,b")) {
      // 标签必须是纯文字节点（允许内联 svg/图标）
      if (!inlineChildren(label)) continue;
      if (!isRendered(label)) continue;
      const name = (label.textContent || "").trim();
      if (!PROMPT_LABEL.test(name)) continue;
      const scope = promptScope(label, name) || label;
      if (seenScopes.has(scope)) continue;
      seenScopes.add(scope);
      let value = "";
      let valueEl = null;
      if (scope === label) {
        for (let sib = label.nextElementSibling; sib; sib = sib.nextElementSibling) {
          const t = (sib.innerText || sib.textContent || "").replace(/\s+/g, " ").trim();
          if (denseLen(t) >= 20) { value = t; valueEl = sib; break; }
        }
      } else {
        // 值 = 区块容器内去掉标签后的剩余文字
        const clone = scope.cloneNode(true);
        for (const el of clone.querySelectorAll("*")) {
          if ((el.textContent || "").trim() === name) { el.remove(); break; }
        }
        value = (clone.textContent || "").replace(/\s+/g, " ").trim();
      }
      const len = denseLen(value);
      if (len < 20 || len > 3000) continue;
      // 提示词值之后的短文字是生成参数（模型、比例等），保留；按钮文字去掉。
      let meta = "";
      for (let sib = valueEl ? valueEl.nextElementSibling : null; sib; sib = sib.nextElementSibling) {
        meta += " " + (sib.innerText || sib.textContent || "");
      }
      meta = meta.replace(/更多|展开|收起|复制|做同款|用作参考图|下载|举报|分享|编辑|删除/g, " ").replace(/\s+/g, " ").trim();
      if (!meta || denseLen(meta) > 40) meta = "";
      const key = value.slice(0, 60);
      if (seenValues.has(key)) continue;
      seenValues.add(key);
      blocks.push({ name: name.replace(/\s*[:：]$/, ""), value: value.slice(0, 2000), meta: meta.slice(0, 60), label });
      if (blocks.length >= 5) break;
    }
    return blocks;
  }

  // 提示词位于全屏弹窗/覆盖层中（如即梦从信息流点开的详情）时，返回该弹窗根节点；
  // 弹窗背后的信息流不参与正文判定，避免把整页推荐内容混进摘录。
  function overlayOf(label) {
    let best = null;
    for (let node = label; node && node !== document.body; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (!/^(fixed|absolute)$/.test(cs.position)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < innerWidth * 0.8 || rect.height < innerHeight * 0.8) continue;
      const z = parseFloat(cs.zIndex) || 0;
      const isDialog = node.getAttribute("role") === "dialog" || node.getAttribute("aria-modal") === "true" || cs.position === "fixed";
      if (z >= 100 || isDialog) best = node;
    }
    return best;
  }

  function blocksToMarkdown(blocks) {
    return blocks.map((b) => `${b.name}：\n${b.value}${b.meta ? `\n\n${b.meta}` : ""}`).join("\n\n");
  }

  function appendBlocks(markdown, blocks) {
    let out = markdown;
    for (const block of blocks) {
      // 正文已包含该提示词时不重复追加
      if (denseContains(out, block.value.slice(0, 80))) continue;
      out = (out ? out + "\n\n" : "") + block.name + "：\n" + block.value;
    }
    return out;
  }

  function readJimeng() {
    const roots = [...document.querySelectorAll('[class*="detail-info"], [class*="detailInfo"], [class*="detail-area"], [role="dialog"]')]
      .filter(isRendered).filter(el => !el.closest('nav,aside,[class*="recommend"],[class*="feed-card"]'));
    const candidates = [];
    for (const root of roots) {
      for (const label of root.querySelectorAll('div,span,p,h3,dt')) {
        const name = (label.textContent || '').trim();
        if (!PROMPT_LABEL.test(name) || !inlineChildren(label) || !isRendered(label)) continue;
        if (label.closest('[class*="recommend"],nav,aside')) continue;
        const valueEl = label.nextElementSibling;
        // Only the explicit adjacent value; never climb into author/recommendation containers.
        if (!valueEl || !isRendered(valueEl) || !/prompt.*(value|content|text)/i.test(valueEl.className || '')) continue;
        if (valueEl.querySelector('nav,button,[class*="recommend"]')) continue;
        const value = (valueEl.innerText || '').trim();
        if (denseLen(value) < 1) continue;
        if (!candidates.some(c => c.el === valueEl)) candidates.push({ el: valueEl, name, value });
      }
    }
    if (candidates.length !== 1) return { ...EMPTY, warning: '未找到唯一的原作品提示词区域，请打开原作品详情或手动填写。' };
    const block = candidates[0];
    return { ...EMPTY, markdown: block.value ? `${block.name}：\n${block.value}` : '', text: block.value, warning: block.value ? '' : '原作品提示词为空，请手动填写。' };
  }

  function readDocument() {
    try {
      // 即梦也会在首页原地址打开作品弹层。整个站点禁止回退到文章/推荐流。
      if (location.hostname === 'jimeng.jianying.com') return readJimeng();
      if (location.hostname === 'ahaprompt.app' && /\/prompt\//.test(location.pathname) || /^(www\.)?meigen\.ai$/.test(location.hostname) && /^\/video\//.test(location.pathname)) {
        const meigen = location.hostname.endsWith('meigen.ai');
        const blocks = [...document.querySelectorAll('p.whitespace-pre-wrap')].filter(isRendered)
          .filter(p=>!meigen || /^video\b/i.test(p.previousElementSibling?.textContent.trim() || ''));
        const text = blocks.length === 1 ? blocks[0].textContent.trim() : '';
        return {...EMPTY,markdown:text,text,warning:text ? '' : '未识别到唯一的作品提示词，请手动填写；不会读取推荐内容。'};
      }
      const article = readabilityParse();
      let markdown = "";
      let text = "";

      if (article && article.content) {
        const holder = document.createElement("div");
        holder.innerHTML = article.content;
        markdown = toMarkdown(holder);
        text = (article.textContent || "").trim();
      }

      // 短正文同样有效，只有完全未提取到文字时才使用正文容器。
      if (!denseLen(markdown)) {
        const node = pickFallbackNode();
        if (node) {
          const clone = node.cloneNode(true);
          cleanupClone(clone);
          markdown = toMarkdown(clone);
          text = (clone.textContent || "").trim();
        }
      }

      // 提示词常在正文容器之外的旁栏（即梦等 AI 作品页），单独补齐。
      const blocks = promptBlocks();
      if (blocks.length) {
        // 提示词在全屏弹窗中（从信息流点开的详情）时只看弹窗内部，弹窗背后的页面内容全部排除。
        const overlay = overlayOf(blocks[0].label);
        let promptOnly = false;
        if (overlay) {
          // 弹窗内除提示词区块外只剩零星文字（关注/做同款等按钮、作者名）时收敛为仅提示词。
          const overlayDense = denseLen(overlay.innerText);
          const blockChars = blocks.reduce((sum, b) => sum + denseLen(b.value) + denseLen(b.name) + denseLen(b.meta), 0);
          promptOnly = overlayDense - blockChars <= Math.max(120, blockChars * 0.4);
        } else {
          const mdDense = denseLen(markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, ""));
          const inBodyChars = blocks.reduce((sum, b) => sum + (denseContains(markdown, b.value.slice(0, 80)) ? denseLen(b.value) : 0), 0);
          promptOnly = mdDense - inBodyChars <= Math.max(40, mdDense * 0.25);
        }
        if (promptOnly) {
          markdown = blocksToMarkdown(blocks);
          text = blocks.map((b) => `${b.name}：${b.value}${b.meta ? `（${b.meta}）` : ""}`).join(" ");
        } else {
          markdown = appendBlocks(markdown, blocks);
          text = appendBlocks(text, blocks);
        }
      }

      markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();

      return {
        markdown: markdown.slice(0, 20000),
        text: text.slice(0, 20000),
        byline: (article && article.byline) || "",
        excerpt: (article && article.excerpt) || "",
        warning: !markdown && !text ? '未识别到可靠的正文，可手动填写摘录。' : ''
      };
    } catch (e) {
      return { ...EMPTY, error: String(e && e.message) };
    }
  }

  // SPA（即梦等）的面板内容延迟渲染；短暂轮询，连续两次结果一致即提前结束。
  async function runWithRetry() {
    const deadline = Date.now() + 4000;
    const startUrl = location.href;
    const jimeng = location.hostname === 'jimeng.jianying.com';
    let best = null;
    let bestScore = -1;
    while (true) {
      const result = readDocument();
      const score = denseLen(result.markdown) + denseLen(result.text);
      if (location.href !== startUrl) return { ...EMPTY, error: '页面已切换，请重新提取。' };
      if (jimeng || score > bestScore) { best = result; bestScore = score; }
      const stable = best && JSON.stringify(result) === JSON.stringify(best);
      if ((stable && Date.now() - deadline > -400) || Date.now() >= deadline) return best;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "CLIP Extract Content") {
      const statusId = xStatusId(msg.pageUrl || location.href);
      if (statusId) {
        (async () => {
          try { sendResponse(await extractXPost(statusId)); }
          catch (error) { sendResponse({ ...EMPTY, error: error.message }); }
        })();
        return true;
      }
      (async () => {
        try { sendResponse(await runWithRetry()); }
        catch (error) { sendResponse({ ...EMPTY, error: error.message }); }
      })();
      return true;
    }
    return false;
  });
})();
