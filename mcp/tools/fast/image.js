'use strict';

const fs = require('fs');
const path = require('path');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16;

function sniffMime(buffer) {
  if (buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 4) === 'GIF8') {
    return 'image/gif';
  }
  return null;
}

function isInside(realRoot, realTarget) {
  const relative = path.relative(realRoot, realTarget);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertInsideRoots(realTarget, roots) {
  for (const root of roots) {
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      continue;
    }
    if (isInside(realRoot, realTarget)) return true;
  }
  return false;
}

function fromBuffer(buffer, sourcePath) {
  if (buffer.length === 0) throw new Error('截图内容为空');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`截图过大：${buffer.length} 字节（上限 ${MAX_IMAGE_BYTES}）`);
  }
  const mime = sniffMime(buffer);
  if (!mime) throw new Error('不是受支持的图片（PNG / JPEG / WEBP / GIF）');
  return {
    base64: buffer.toString('base64'),
    mime,
    bytes: buffer.length,
    path: sourcePath || null,
  };
}

function readImageFromFile(config, baseDir, file) {
  const resolved = path.isAbsolute(file) ? path.normalize(file) : path.resolve(baseDir, file);
  if (!fs.existsSync(resolved)) throw new Error(`截图不存在：${resolved}`);
  const real = fs.realpathSync(resolved);
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw new Error('screenshot_path 必须是文件');
  if (config.imageRoots.length > 0 && !assertInsideRoots(real, config.imageRoots)) {
    throw new Error('截图不在 CUA_FAST_IMAGE_ROOTS（兼容旧名 BIOCUA_FAST_IMAGE_ROOTS）允许的目录内');
  }
  const image = fromBuffer(fs.readFileSync(real), real);
  if (config.imageRoots.length === 0) {
    image.warning = '未设置 CUA_FAST_IMAGE_ROOTS（兼容旧名 BIOCUA_FAST_IMAGE_ROOTS），截图路径未做目录约束';
  }
  return image;
}

function readImageFromBase64(config, base64, mime) {
  if (typeof base64 !== 'string' || !base64.trim()) {
    throw new Error('screenshot_base64 必须是非空字符串');
  }
  if (base64.length > MAX_BASE64_CHARS) {
    throw new Error(`screenshot_base64 过大（上限约 ${MAX_IMAGE_BYTES} 字节原始图片）`);
  }
  const buffer = Buffer.from(base64, 'base64');
  const image = fromBuffer(buffer, null);
  if (mime && mime !== image.mime) {
    throw new Error(`screenshot_mime=${mime} 与实际图片 ${image.mime} 不一致`);
  }
  return image;
}

module.exports = {
  MAX_IMAGE_BYTES,
  sniffMime,
  readImageFromFile,
  readImageFromBase64,
};