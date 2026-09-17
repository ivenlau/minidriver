/**
 * 从 favicon.svg 的几何图形生成 PWA PNG 图标（192/512/180 apple-touch-icon）。
 * 零依赖：RGBA 光栅化（3x 超采样）+ 极简 PNG 编码器（node:zlib）。
 * 运行：node scripts/gen-icons.mjs，产物写入 web/public/。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.subarray(y * size * 4, (y + 1) * size * 4).forEach((v, i) => {
      raw[y * (size * 4 + 1) + 1 + i] = v
    })
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** 按 favicon.svg 的 64 视箱几何渲染（圆角方块 + 双峰山 + 圆点） */
function render(size) {
  const SS = 3 // 超采样
  const S = size * SS
  const img = new Uint8Array(size * size * 4)
  const poly = [
    [20, 40],
    [28, 24],
    [36, 36],
    [42, 28],
    [46, 40],
  ].map(([x, y]) => [(x * S) / 64, (y * S) / 64])
  const dot = { x: (44 * S) / 64, y: (21 * S) / 64, r: (3.5 * S) / 64 }
  const rr = (16 * S) / 64
  const inPoly = (px, py) => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]
      const [xj, yj] = poly[j]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  const blend = (i, r, g, b, a) => {
    img[i] = Math.round(a * r + (1 - a) * img[i])
    img[i + 1] = Math.round(a * g + (1 - a) * img[i + 1])
    img[i + 2] = Math.round(a * b + (1 - a) * img[i + 2])
    img[i + 3] = Math.round(255 * (a + img[i + 3] / 255 * (1 - a)))
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0
      let mtn = 0
      let dot = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5
          const py = y * SS + sy + 0.5
          const cx = Math.min(Math.max(px, rr), S - rr)
          const cy = Math.min(Math.max(py, rr), S - rr)
          if ((px - cx) ** 2 + (py - cy) ** 2 <= rr * rr) bg++
          if (inPoly(px, py)) mtn++
          if ((px - dot.x) ** 2 + (py - dot.y) ** 2 <= dot.r * dot.r) dot++
        }
      }
      const i = (y * size + x) * 4
      const cov = SS * SS
      if (bg > 0) blend(i, 0x5b, 0x5b, 0xd6, bg / cov)
      if (mtn > 0) blend(i, 255, 255, 255, (mtn / cov) * 0.95)
      if (dot > 0) blend(i, 255, 255, 255, (dot / cov) * 0.7)
    }
  }
  return img
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const png = encodePNG(size, render(size))
  writeFileSync(new URL(`../web/public/${name}`, import.meta.url), png)
  console.log(`✓ web/public/${name} (${size}x${size}, ${png.length} bytes)`)
}
