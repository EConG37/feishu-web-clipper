"use strict";

// Serialized into MAIN by chrome.scripting. Returns media/text only, never page credentials.
async function collectClipVideoPage(expectedUrl) {
  const pageKey = raw => {
    try {
      const url = new URL(raw, location.href);
      const statusId = /(^|\.)(x\.com|twitter\.com)$/i.test(url.hostname) && url.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/)?.[1];
      if (statusId) return `x-status:${statusId}`;
      url.hash = '';
      return url.href;
    } catch { return String(raw || ''); }
  };
  if (pageKey(location.href) !== pageKey(expectedUrl)) return { videos: [], warning: '网页已切换，请重新打开剪藏。' };
  const host = location.hostname, path = location.pathname;
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const isMP4 = raw => { try { const u = new URL(raw); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password && !/\.(?:m3u8|mpd)$/i.test(u.pathname); } catch { return false; } };
  const bitrateOf = raw => Number(raw.match(/[?&]br=(\d+)/)?.[1] || 0);
  const quality = raw => raw.match(/\/(\d+x\d+)\//)?.[1] || (bitrateOf(raw) ? `${bitrateOf(raw)}kbps` : '原画');
  // 抖音播放地址：douyinvod 签名直链（封面图在 douyinpic 等域名，不含 /video/ 路径）；
  // media-video-/media-audio- 是 DASH 分离轨（无声/无画面），保存下来是坏文件，排除。
  const isDouyinPlay = raw => { try { const u = new URL(raw); return /(^|\.)douyinvod\.com$/.test(u.hostname) && u.pathname.includes('/video/') && !/\/media-(?:video|audio)-/i.test(u.pathname); } catch { return false; } };
  // 弹窗播放器常用 MSE（blob:），元素上没有直链；签名播放地址留在播放器组件的 React props 里。
  const recoverPlayUrls = video => {
    const urls = [], seen = new Set(), seenObjs = new WeakSet();
    const push = raw => {
      if (urls.length >= 6 || !isDouyinPlay(raw)) return;
      let key = raw;
      // 镜像域名只差路径开头的签名段，去掉后按「内容路径+码率」去重
      try { const u = new URL(raw); key = `${u.pathname.replace(/^\/[^/]+\/[^/]+\//, '/')}|${u.searchParams.get('br') || ''}`; } catch { /* 非 URL 字符串忽略 */ }
      if (seen.has(key)) return;
      seen.add(key); urls.push(raw);
    };
    const walk = (o, d) => {
      if (typeof o === 'string') { push(o); return; }
      if (!o || typeof o !== 'object' || seenObjs.has(o) || d > 12 || urls.length >= 6) return;
      seenObjs.add(o);
      for (const k of Object.keys(o)) { try { walk(o[k], d + 1); } catch { /* page getters are not trusted */ } }
    };
    for (let e = video; e && e !== document.body && urls.length < 6; e = e.parentElement) {
      for (const k of Object.keys(e).filter(k => k.startsWith('__reactProps'))) walk(e[k], 0);
      const key = Object.keys(e).find(k => k.startsWith('__reactFiber'));
      for (let f = key && e[key], n = 0; f && n < 30 && urls.length < 6; f = f.return, n++) if (f.memoizedProps) walk(f.memoizedProps, 0);
    }
    return urls;
  };
  const result = { videos: [], warning: '', pageUrl: expectedUrl };
  const add = (video, variants, id, poster) => {
    if (result.videos.some(v=>v.id === id)) return;
    const byUrl = new Map();
    for (const variant of variants.filter(v => isMP4(v.url))) {
      const previous = byUrl.get(variant.url);
      if (!previous || (variant.bitrate || 0) > (previous.bitrate || 0)) byUrl.set(variant.url, variant);
    }
    const unique = [...byUrl.values()];
    unique.sort((a,b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (!unique.length) return;
    result.videos.push({ id, poster: poster || video.poster || '', duration: Number.isFinite(video.duration) ? video.duration : null,
      variants: unique.map(v => ({ src: v.url, label: v.label || quality(v.url), bitrate: v.bitrate || 0 })) });
  };
  // 抖音播放器不写 poster 属性，播放后封面 img 又被隐藏；签名封面地址留在滑块组件的 props 里，按作品 id 匹配，避免取到相邻滑块或推荐列表的封面。
  const recoverPoster = (video, expectedId) => {
    if (!expectedId) return '';
    const covers = new Map(), seenObjs = new WeakSet();
    const norm = u => typeof u === 'string' && u.startsWith('//') ? 'https:' + u : u;
    // url_list 首项常是横幅裁切变体（image-cut / resize-origshort），取第一个完整封面；origin_cover 优先。
    const pickUrl = node => {
      const list = node && (node.url_list || node.urlList);
      const urls = Array.isArray(list) ? list.map(norm) : [norm(node)];
      // 只认完整封面；只有裁切变体时返回空，让遍历继续找，也避免把相邻滑块的裁切图当成封面。
      return urls.find(u => /^https?:/i.test(u) && !/image-cut|resize-origshort/i.test(u)) || '';
    };
    const coverUrl = o => pickUrl(o.video && o.video.origin_cover) || pickUrl(o.video && o.video.cover) || pickUrl(o.cover);
    const walk = (o, d) => {
      if (!o || typeof o !== 'object' || seenObjs.has(o) || d > 10) return;
      seenObjs.add(o);
      const oid = [o.aweme_id, o.awemeId, o.itemId].find(v => typeof v === 'string' || typeof v === 'number');
      if (oid != null && !covers.has(String(oid))) {
        const url = coverUrl(o);
        if (url) covers.set(String(oid), url);
      }
      for (const k of Object.keys(o)) { try { walk(o[k], d + 1); } catch { /* page getters are not trusted */ } }
    };
    for (let e = video; e && e !== document.body && !covers.size; e = e.parentElement) {
      for (const k of Object.keys(e).filter(k => k.startsWith('__reactProps'))) walk(e[k], 0);
      const key = Object.keys(e).find(k => k.startsWith('__reactFiber'));
      for (let f = key && e[key], n = 0; f && n < 30 && !covers.size; f = f.return, n++) if (f.memoizedProps) walk(f.memoizedProps, 0);
    }
    return covers.get(String(expectedId)) || '';
  };
  // 滑块容器类名带作品 id（video_<id>），比 data-item-key 属性稳定；播放后封面 img 被隐藏但仍在 DOM 中。
  const slideCover = (video, wantId) => {
    if (!wantId) return '';
    const slide = video.closest('[class*="video_"]');
    if (!slide || !(slide.className || '').split(/\s+/).includes(`video_${wantId}`)) return '';
    const img = [...slide.querySelectorAll('img')].find(i => (i.naturalWidth || 0) >= 200 && /^https?:/i.test(i.currentSrc || i.src));
    return img ? (img.currentSrc || img.src) : '';
  };
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) {
    const id = path.match(/\/status\/(\d+)/)?.[1];
    if (!id) return result;
    const belongs = (el, post) => {
      if (el.closest('article') !== post) return false;
      for (let p = el.parentElement; p && p !== post; p = p.parentElement)
        if (p.matches('[role="link"]:not(a),[data-testid="quoteTweet"],[data-testid="card.wrapper"]')) return false;
      return true;
    };
    const post = [...document.querySelectorAll('article')].find(a => [...a.querySelectorAll('a[href] time')]
      .some(t => belongs(t,a) && new URL(t.closest('a').href).pathname.match(/\/status\/(\d+)/)?.[1] === id));
    if (!post) { result.warning = '尚未加载原帖，加载后可刷新视频。'; return result; }
    // X hides its <video> until playback while showing the poster. Original-post
    // ownership and media ID, not player visibility, determine the attachment.
    const videos = [...post.querySelectorAll('video')].filter(v => belongs(v,post));
    const mediaIdFromThumb = raw => String(raw || '').match(/\/(?:amplify_video_thumb|ext_tw_video_thumb)\/(\d+)\//)?.[1] || '';
    const thumbTargets = [...post.querySelectorAll('img[src]')].filter(img => belongs(img,post))
      .map(img => ({poster:img.currentSrc || img.src || '',duration:null}))
      .filter((item,index,list) => mediaIdFromThumb(item.poster) && list.findIndex(other => mediaIdFromThumb(other.poster) === mediaIdFromThumb(item.poster)) === index);
    const targets = videos.length ? videos : thumbTargets;
    result.mediaPending = !!(targets.length || post.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], a[href*="/video/"]'));
    // Match the media ID on the original player's poster, not arbitrary media found in React ancestors.
    for (const [targetIndex, video] of targets.entries()) {
      const fallbackId = thumbTargets.length === 1 ? mediaIdFromThumb(thumbTargets[0].poster) : mediaIdFromThumb(thumbTargets[targetIndex]?.poster);
      const mediaId = mediaIdFromThumb(video.poster) || fallbackId;
      const variants = [], seen = new Set(); let count = 0;
      const walk = (o,d) => {
        if (typeof o === 'string') {
          if (mediaId && o.includes('video.twimg.com/') && o.includes(mediaId) && isMP4(o)) variants.push({url:o});
          return;
        }
        if (!o || typeof o !== 'object' || seen.has(o) || d > 14 || ++count > 24000) return;
        seen.add(o);
        const ids = [o.id_str,o.id,o.media_id,o.mediaId,o.media_key,o.mediaKey].filter(value => value != null).map(String);
        const matchingMedia = mediaId && ids.some(value => value === mediaId || value.endsWith(`_${mediaId}`));
        if (matchingMedia && o.video_info?.variants) variants.push(...o.video_info.variants);
        if (matchingMedia && Array.isArray(o.variants)) variants.push(...o.variants);
        for (const k of Object.keys(o)) {
          if (['return','stateNode','alternate','_owner'].includes(k)) continue;
          try { walk(o[k],d+1); } catch { /* page getters are not trusted */ }
        }
      };
      for (let e = video; e && e !== document.body; e = e.parentElement) {
        for (const k of Object.keys(e).filter(k=>k.startsWith('__reactProps'))) walk(e[k],0);
        const key = Object.keys(e).find(k=>k.startsWith('__reactFiber'));
        for (let f = key && e[key], n=0; f && n<20; f=f.return,n++) walk(f.memoizedProps,0);
        if (variants.length) break;
      }
      if (!variants.length) {
        for (const e of [post, ...post.querySelectorAll('*')]) {
          for (const k of Object.keys(e).filter(k=>k.startsWith('__reactProps'))) walk(e[k],0);
          const key = Object.keys(e).find(k=>k.startsWith('__reactFiber'));
          if (key && e[key]) walk(e[key].memoizedProps,0);
          if (variants.length || count > 24000) break;
        }
      }
      if (mediaId) {
        for (const entry of performance.getEntriesByType('resource')) {
          const url = entry.name || '';
          if (url.includes('video.twimg.com/') && url.includes(mediaId) && isMP4(url)) variants.push({url});
        }
      }
      if (!variants.length && isMP4(video.currentSrc || video.src)) variants.push({url:video.currentSrc || video.src});
      add(video,variants,mediaId || `${id}-${result.videos.length}`);
    }
    if (result.mediaPending && !result.videos.length) result.warning = '原帖视频仍在加载，插件会短暂重试；如仍未出现，请播放原视频后刷新视频。';
    return result;
  }
  // B站播放器为 DASH（blob + 音视频分离 m4s），元素上没有单文件地址；改走 playurl 接口的 durl 单文件 mp4。
  if (/(^|\.)bilibili\.com$/.test(host)) {
    const vd = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData;
    const bvid = (vd && vd.bvid) || path.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] || '';
    const cid = vd && vd.cid;
    if (bvid && cid) {
      const variants = [], seen = new Set();
      for (const qn of [64, 32, 16]) {
        try {
          const resp = await fetch(`https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&qn=${qn}&fnval=1&platform=html5`, { credentials: 'include' });
          const j = await resp.json();
          const d = j && j.data;
          const item = d && d.durl && d.durl[0];
          const dkey = `${d && d.quality}|${(item && item.size) || 0}`;
          if (j && j.code === 0 && item && item.url && isMP4(item.url) && !seen.has(dkey)) {
            seen.add(dkey);
            const desc = (d.accept_description || [])[(d.accept_quality || []).indexOf(d.quality)] || `qn${d.quality}`;
            variants.push({ url: item.url, bitrate: d.quality || 0, size: item.size || 0,
              label: `${desc}${item.size ? ` · ${(item.size / 1048576).toFixed(1)}MB` : ''}` });
          }
        } catch { /* 单档失败不影响其他档 */ }
      }
      const usable = variants.filter(v => !v.size || v.size <= 30 * 1024 * 1024);
      if (usable.length) {
        const poster = (vd && vd.cover) || document.querySelector('meta[property="og:image"]')?.content || '';
        const dur = Number(vd && vd.duration);
        add({ poster, duration: Number.isFinite(dur) ? dur : null }, usable, bvid, poster);
        if (result.videos.length) {
          if (usable.length < variants.length) result.warning = '超过 30MB 的清晰度已隐藏，可保存较低清晰度。';
          return result;
        }
      }
      result.warning = 'B站未返回可保存的单文件视频：可能需要登录，或为付费、课堂等特殊内容。';
      return result;
    }
  }
  const aha = host === 'ahaprompt.app' && /\/prompt\//.test(path);
  const meigen = /^(www\.)?meigen\.ai$/.test(host) && /^\/video\/\d+/.test(path);
  if (!aha && !meigen) {
    let players = [...document.querySelectorAll('video')];
    const douyin = /(^|\.)douyin\.com$/.test(host);
    const note = /(^|\.)xiaohongshu\.com$/.test(host);
    const sph = /(^|\.)channels\.weixin\.qq\.com$/.test(host);
    const id = douyin ? new URL(location.href).searchParams.get('modal_id') || path.match(/\/video\/(\d+)/)?.[1] : path.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/)?.[1];
    if (douyin && id) players = players.filter(v => v.closest('[data-item-key]')?.getAttribute('data-item-key') === id);
    else if (note && id) {
      const detail = window.__INITIAL_STATE__?.note?.noteDetailMap?.[id]?.note;
      const url = detail?.video?.media?.stream?.h264?.[0]?.masterUrl;
      if (url && players.length === 1 && !(players[0].currentSrc || players[0].src)) { add(players[0], [{url}], id); return result; }
      // Do not fall back to unrelated feed players when a note is ambiguous.
      if (players.length !== 1) players = [];
    } else players = players.filter(visible);
    for (const [i,v] of players.entries()) {
      const urls = [v.currentSrc, v.src, ...[...v.querySelectorAll('source')].map(s=>s.src)].filter(Boolean);
      // 搜索页等路由的播放器走 MSE（blob:），元素上没有可下载直链，从播放器 props 恢复签名播放地址。
      if (douyin && !urls.some(isMP4)) urls.push(...recoverPlayUrls(v));
      add(v, urls.map(url=>({url, bitrate: bitrateOf(url)})), id ? `${id}-${i}` : `page-video-${i}`, douyin ? (slideCover(v, id) || recoverPoster(v, id || '')) : '');
    }
    if (players.length && !result.videos.length) result.warning = '播放器使用临时或分段视频，暂时无法直接保存。可播放原视频后刷新。';
    // 视频号网页预览只下发封面与文字（get_feed_info 无视频地址），播放或刷新都拿不到视频文件。
    if (sph && !result.videos.length) result.warning = '视频号网页预览不向浏览器提供视频文件，只能保存文字与封面；视频请在微信中打开保存。';
    if (result.videos.length > 1) result.warning = '发现多个视频，请预览并选择要保存的视频（最多 30MB）。';
    return result;
  }
  result.promptPage = true;
  result.content = { markdown:'', text:'', warning:'未识别到唯一的视频提示词，请手动填写。' };
  let videos = [...document.querySelectorAll('video[controls]')].filter(visible);
  if (meigen) {
    const id = path.match(/^\/video\/(\d+)/)[1];
    videos = videos.filter(v => { try { const u = new URL(v.currentSrc || v.src); return u.hostname === 'images.meigen.ai' && u.pathname === `/videos/${id}/video.mp4`; } catch { return false; } });
  }
  if (videos.length !== 1) { result.warning = '未找到唯一的作品主视频，请等待页面加载后刷新视频。'; return result; }
  const video = videos[0];
  add(video,[{url:video.currentSrc || video.src}],path);
  let scope = video.parentElement;
  // Nearest shared container for the player and prompt, excluding unrelated page sections.
  while (scope && scope !== document.body && !scope.querySelector('p.whitespace-pre-wrap')) scope = scope.parentElement;
  const prompts = scope ? [...scope.querySelectorAll('p.whitespace-pre-wrap')].filter(visible) : [];
  const candidates = meigen ? prompts.filter(p => /^video\b/i.test(p.previousElementSibling?.textContent.trim() || '')) : prompts;
  if (candidates.length === 1) {
    const text = candidates[0].textContent.trim();
    result.content = { markdown:text, text, warning:text ? '' : '视频提示词为空，可手动填写。' };
  }
  if (!result.videos.length) result.warning = '视频不是可直接上传的 MP4，暂时只能保存文字和封面。';
  return result;
}
