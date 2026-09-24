"use strict";

// Serialized into MAIN by chrome.scripting. Returns media/text only, never page credentials.
function collectClipVideoPage(expectedUrl) {
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
  const quality = raw => raw.match(/\/(\d+x\d+)\//)?.[1] || '原画';
  const result = { videos: [], warning: '', pageUrl: expectedUrl };
  const add = (video, variants, id) => {
    if (result.videos.some(v=>v.id === id)) return;
    const byUrl = new Map();
    for (const variant of variants.filter(v => isMP4(v.url))) {
      const previous = byUrl.get(variant.url);
      if (!previous || (variant.bitrate || 0) > (previous.bitrate || 0)) byUrl.set(variant.url, variant);
    }
    const unique = [...byUrl.values()];
    unique.sort((a,b) => (b.bitrate || 0) - (a.bitrate || 0));
    if (!unique.length) return;
    result.videos.push({ id, poster: video.poster || '', duration: Number.isFinite(video.duration) ? video.duration : null,
      variants: unique.map(v => ({ src: v.url, label: quality(v.url), bitrate: v.bitrate || 0 })) });
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
  const aha = host === 'ahaprompt.app' && /\/prompt\//.test(path);
  const meigen = /^(www\.)?meigen\.ai$/.test(host) && /^\/video\/\d+/.test(path);
  if (!aha && !meigen) {
    let players = [...document.querySelectorAll('video')];
    const douyin = /(^|\.)douyin\.com$/.test(host);
    const note = /(^|\.)xiaohongshu\.com$/.test(host);
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
      add(v, urls.map(url=>({url})), id ? `${id}-${i}` : `page-video-${i}`);
    }
    if (players.length && !result.videos.length) result.warning = '播放器使用临时或分段视频，暂时无法直接保存。可播放原视频后刷新。';
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
