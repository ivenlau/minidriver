/** 浏览器端缩略图生成：图片/视频 → 320px webp（服务端零成本） */
const MAX_EDGE = 320
const MAX_BYTES = 480 * 1024

export async function makeThumb(file: File): Promise<Blob | null> {
  try {
    if (file.type.startsWith('image/') && file.type !== 'image/gif') {
      return await imageThumb(file)
    }
    if (file.type.startsWith('video/')) {
      return await withTimeout(videoThumb(file), 6000)
    }
  } catch {
    return null
  }
  return null
}

async function imageThumb(file: File): Promise<Blob | null> {
  const bmp = await createImageBitmap(file)
  try {
    return await drawToWebp(bmp.width, bmp.height, (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h))
  } finally {
    bmp.close()
  }
}

function videoThumb(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    const url = URL.createObjectURL(file)
    const fail = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    video.onerror = fail
    video.onloadedmetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 2
      video.currentTime = Math.min(1, d / 2)
    }
    video.onseeked = async () => {
      try {
        const blob = await drawToWebp(video.videoWidth, video.videoHeight, (ctx, w, h) =>
          ctx.drawImage(video, 0, 0, w, h),
        )
        URL.revokeObjectURL(url)
        resolve(blob)
      } catch {
        fail()
      }
    }
    video.src = url
  })
}

async function drawToWebp(
  srcW: number,
  srcH: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Promise<Blob | null> {
  if (!srcW || !srcH) return null
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  draw(ctx, w, h)
  for (const quality of [0.8, 0.5]) {
    const blob = await toBlob(canvas, 'image/webp', quality)
    if (blob && blob.size <= MAX_BYTES) return blob
  }
  return toBlob(canvas, 'image/jpeg', 0.7)
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}
