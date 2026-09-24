(() => {
  "use strict";
  const MAX_BYTES = 20 * 1024 * 1024;
  async function validate(blob) {
    if (!blob.size) throw new Error("图片文件为空");
    if (blob.size > MAX_BYTES) throw new Error("图片超过 20MB，请选择较小的图片");
    const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
    const text = new TextDecoder().decode(head).trimStart();
    if (/^(?:<!doctype html|<html|<head|<body|\{)/i.test(text) || /text\/html|application\/json/i.test(blob.type)) {
      throw new Error("图片地址返回了网页或错误信息，可能需要登录或受防盗链限制");
    }
    let type = blob.type.split(";")[0].toLowerCase();
    if (!type.startsWith("image/")) {
      if (head[0] === 0xff && head[1] === 0xd8) type = "image/jpeg";
      else if (head[0] === 0x89 && text.slice(1, 4) === "PNG") type = "image/png";
      else if (text.startsWith("GIF8")) type = "image/gif";
      else if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") type = "image/webp";
      else throw new Error("下载内容不是可识别的图片");
    }
    return blob.slice(0, blob.size, type);
  }
  async function fetchImage(src, options = {}) {
    if (!/^(https?:|blob:|data:image\/)/i.test(src)) throw new Error("不支持的图片地址");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const resp = await fetch(src, { ...options, signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      if (Number(resp.headers.get("content-length")) > MAX_BYTES) throw new Error("图片超过 20MB，请选择较小的图片");
      return await validate(await resp.blob());
    } catch (error) {
      if (error.name === "AbortError") throw new Error("下载图片超时，请重试");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  globalThis.ClipImageUtils = { validate, fetchImage };
})();
