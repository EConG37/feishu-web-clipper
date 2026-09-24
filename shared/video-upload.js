"use strict";

globalThis.ClipVideoUpload = (() => {
  const MAX_BYTES = 30 * 1024 * 1024;
  const API = 'https://open.feishu.cn/open-apis/drive/v1/medias/';
  function allowed(raw) {
    try { const u = new URL(raw); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password &&
      ! /\.(?:m3u8|mpd)$/i.test(u.pathname); } catch { return false; }
  }
  async function download(src, progress) {
    if (!allowed(src)) throw new Error('不支持的视频来源，请重新读取作品视频');
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 240000);
    try {
      const response = await fetch(src, {credentials:'omit',redirect:'follow',signal:controller.signal});
      if (response.url && !allowed(response.url)) throw new Error('视频跳转到不支持的地址');
      if (!response.ok) throw new Error(`视频读取失败 HTTP ${response.status}`);
      const total = Number(response.headers.get('content-length')) || 0;
      if (total > MAX_BYTES) throw new Error('视频超过 30MB，请选择较低清晰度');
      const reader = response.body.getReader(), chunks = []; let received = 0, last = 0;
      while (true) {
        const {value,done} = await reader.read(); if (done) break;
        received += value.length;
        if (received > MAX_BYTES) { await reader.cancel(); throw new Error('视频超过 30MB，请选择较低清晰度'); }
        chunks.push(value);
        if (Date.now()-last > 700) { await progress(`正在读取视频 ${total ? Math.min(100,Math.round(received/total*100))+'%' : (received/1048576).toFixed(1)+' MB'}`); last=Date.now(); }
      }
      if (!received || (total && received !== total)) throw new Error('视频下载不完整，请重试');
      const blob = new Blob(chunks,{type:'video/mp4'});
      const head = new Uint8Array(await blob.slice(0,16).arrayBuffer());
      if (String.fromCharCode(...head.slice(4,8)) !== 'ftyp') throw new Error('视频地址返回的不是 MP4 文件，请重新读取');
      return blob;
    } catch (e) { if (e.name === 'AbortError') throw new Error('视频读取超时，请降低清晰度后重试'); throw e; }
    finally { controller.abort(); clearTimeout(timer); }
  }
  async function call(token, method, body) {
    const headers = {Authorization:`Bearer ${token}`};
    if (!(body instanceof FormData)) { headers['Content-Type']='application/json'; body=JSON.stringify(body); }
    const response = await fetch(API+method,{method:'POST',headers,body,signal:AbortSignal.timeout(90000)});
    const data = await response.json();
    if (!response.ok || data.code !== 0) throw new Error(`视频上传失败：${data.msg || response.status}`);
    return data.data || {};
  }
  async function upload(token, appToken, blob, progress) {
    if (!blob.size || blob.size > MAX_BYTES) throw new Error('视频超过 30MB 或文件为空，不上传');
    await progress('正在上传视频到飞书…');
    let data;
    if (blob.size <= 20*1024*1024) {
      const form = new FormData();
      for (const [k,v] of Object.entries({file_name:'video.mp4',parent_type:'bitable_file',parent_node:appToken,size:String(blob.size)})) form.append(k,v);
      form.append('file',blob,'video.mp4');
      data = await call(token,'upload_all',form);
    } else {
      const p = await call(token,'upload_prepare',{file_name:'video.mp4',parent_type:'bitable_file',parent_node:appToken,size:blob.size});
      if (!p.upload_id || !Number.isInteger(p.block_size) || p.block_size < 1 || Math.ceil(blob.size/p.block_size) !== p.block_num) throw new Error('飞书返回了无效的分片上传信息');
      for (let seq=0;seq<p.block_num;seq++) {
        const part = blob.slice(seq*p.block_size,Math.min(blob.size,(seq+1)*p.block_size));
        const form = new FormData();
        for (const [k,v] of Object.entries({upload_id:p.upload_id,seq:String(seq),size:String(part.size)})) form.append(k,v);
        form.append('file',part,'part.mp4');
        await call(token,'upload_part',form);
        await progress(`正在上传视频 ${Math.round((seq+1)/p.block_num*100)}%`);
      }
      data = await call(token,'upload_finish',{upload_id:p.upload_id,block_num:p.block_num});
    }
    if (!data.file_token) throw new Error('视频上传未返回附件标识');
    return data.file_token;
  }
  return {allowed,download,upload,MAX_BYTES};
})();
