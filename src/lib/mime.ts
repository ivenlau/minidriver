/**
 * MIME 归一化与推断。
 *
 * 浏览器 File.type 对部分文本扩展名（md/log/ini 等）返回空串，
 * WebDAV/第三方客户端也常只给 application/octet-stream；
 * 出库时若原样输出会导致文本直链 Content-Type 变成 octet-stream 且缺 charset，
 * 中文文本被浏览器按本地编码猜测而乱码。统一在入库归一化 + 出库补 charset。
 */

const EXT_MIME: Record<string, string> = {
  // 文本 / 代码
  txt: 'text/plain',
  log: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  xml: 'application/xml',
  yml: 'text/plain',
  yaml: 'text/plain',
  toml: 'text/plain',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  env: 'text/plain',
  sql: 'text/plain',
  sh: 'text/plain',
  bash: 'text/plain',
  zsh: 'text/plain',
  bat: 'text/plain',
  cmd: 'text/plain',
  ps1: 'text/plain',
  psm1: 'text/plain',
  psd1: 'text/plain',
  vbs: 'text/plain',
  reg: 'text/plain',
  srt: 'text/plain',
  vtt: 'text/vtt',
  m3u: 'text/plain',
  m3u8: 'text/plain',
  tex: 'text/plain',
  rst: 'text/plain',
  asm: 'text/plain',
  lua: 'text/plain',
  pl: 'text/plain',
  r: 'text/plain',
  swift: 'text/plain',
  scala: 'text/plain',
  groovy: 'text/plain',
  dart: 'text/plain',
  ex: 'text/plain',
  exs: 'text/plain',
  erl: 'text/plain',
  hs: 'text/plain',
  clj: 'text/plain',
  cljs: 'text/plain',
  less: 'text/plain',
  scss: 'text/plain',
  sass: 'text/plain',
  py: 'text/plain',
  rb: 'text/plain',
  go: 'text/plain',
  rs: 'text/plain',
  java: 'text/plain',
  kt: 'text/plain',
  c: 'text/plain',
  h: 'text/plain',
  cpp: 'text/plain',
  hpp: 'text/plain',
  cs: 'text/plain',
  php: 'text/plain',
  ts: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  vue: 'text/plain',
  svelte: 'text/plain',
  // 图片
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  // 音视频
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  // 文档 / 压缩 / 字体
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

/** 按文件名扩展名推断 MIME；未知返回 null */
export function mimeFromName(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return null
  return EXT_MIME[name.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * 归一化入库 MIME：去掉 charset 等参数，空串/octet-stream 时按扩展名推断。
 * 用于 nodes.mime 的读写，保证预览判定、图标分类拿到干净的类型。
 */
export function normalizeMime(name: string, mime?: string | null): string {
  const base = (mime ?? '').split(';')[0]!.trim().toLowerCase()
  if (base && base !== 'application/octet-stream') return base
  return mimeFromName(name) ?? 'application/octet-stream'
}

/** 是否文本类（出库时需声明 charset 的类型） */
export function isTextualMime(mime: string): boolean {
  const base = mime.split(';')[0]!.trim().toLowerCase()
  return (
    base.startsWith('text/') ||
    ['application/json', 'application/ld+json', 'application/javascript', 'application/xml', 'application/xhtml+xml', 'image/svg+xml'].includes(base)
  )
}

/**
 * 出库 Content-Type：归一化后为文本类补 `; charset=utf-8`。
 * 已自带 charset 参数（如 WebDAV 客户端显式声明）则原样保留。
 */
export function resolveContentType(name: string, mime?: string | null): string {
  const raw = (mime ?? '').trim()
  if (/charset=/i.test(raw)) return raw
  const base = normalizeMime(name, mime)
  return isTextualMime(base) ? `${base}; charset=utf-8` : base
}

/**
 * 浏览器内联展示白名单：图片/音视频/PDF。
 * 文本类不在此列——直链打开一律走下载；文本内容在应用内 fetch 预览，
 * 不依赖浏览器渲染，attachment 不影响预览与 <img>/<video> 嵌入。
 */
export function isInlineRenderable(mime: string): boolean {
  const base = mime.split(';')[0]!.trim().toLowerCase()
  return (
    base.startsWith('image/') ||
    base.startsWith('video/') ||
    base.startsWith('audio/') ||
    base === 'application/pdf'
  )
}
