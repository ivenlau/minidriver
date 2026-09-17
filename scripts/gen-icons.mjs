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

/** 按 favicon.svg 的 64 视箱几何渲染（圆角方块 + 实心云朵，与 Logo.tsx / lucide Cloud 同源） */
function render(size) {
  const SS = 3 // 超采样
  const S = size * SS
  const img = new Uint8Array(size * size * 4)
  // 云朵 = 大圆 + 小圆 + 底部圆角矩形（lucide Cloud 路径的圆近似，坐标已换算到 64 视箱）
  const circles = [
    { x: (25.4 * S) / 64, y: (32 * S) / 64, r: (16.8 * S) / 64 },
    { x: (45.8 * S) / 64, y: (38 * S) / 64, r: (10.8 * S) / 64 },
  ]
  const rr = (16 * S) / 64 // 圆角方块圆角
  const bx0 = (29.4 * S) / 64
  const bx1 = (41.8 * S) / 64
  const by0 = (42 * S) / 64
  const by1 = (44.8 * S) / 64
  const br = (4 * S) / 64
  const blend = (i, r, g, b, a) => {
    img[i] = Math.round(a * r + (1 - a) * img[i])
    img[i + 1] = Math.round(a * g + (1 - a) * img[i + 1])
    img[i + 2] = Math.round(a * b + (1 - a) * img[i + 2])
    img[i + 3] = Math.round(255 * (a + img[i + 3] / 255 * (1 - a)))
  }
  const inCloud = (px, py) => {
    for (const c of circles) {
      if ((px - c.x) ** 2 + (py - c.y) ** 2 <= c.r * c.r) return true
    }
    const cx = Math.min(Math.max(px, bx0), bx1)
    const cy = Math.min(Math.max(py, by0), by1)
    return (px - cx) ** 2 + (py - cy) ** 2 <= br * br
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0
      let cloud = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5
          const py = y * SS + sy + 0.5
          const cx = Math.min(Math.max(px, rr), S - rr)
          const cy = Math.min(Math.max(py, rr), S - rr)
          if ((px - cx) ** 2 + (py - cy) ** 2 <= rr * rr) bg++
          if (inCloud(px, py)) cloud++
        }
      }
      const i = (y * size + x) * 4
      const cov = SS * SS
      if (bg > 0) blend(i, 0x5b, 0x5b, 0xd6, bg / cov)
      if (cloud > 0) blend(i, 255, 255, 255, (cloud / cov) * 0.95)
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
