<script setup lang="ts">
// 页面底部分享栏: 单一「分享」按钮打开统一弹窗。
// 弹窗内: 快捷分享(复制链接/系统分享) + 微信扫码(本页二维码) + 海报生成。
// - 海报四种风格: 简约白 / 品牌蓝 / 上图下文 / 全图沉浸
//   图片风格可选背景(校园航拍 + 官方照片 posters/*.jpg), Canvas 前端本地生成
// - 不依赖微信 JS-SDK(账号无自定义分享接口权限, 该方案已回退, 见 git 历史)
// - 挂载于 Layout 的 doc-after 插槽, frontmatter.share !== false 时渲染
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'
import {
  PhShareFat,
  PhCopy,
  PhCheck,
  PhShareNetwork,
  PhX,
  PhDownloadSimple,
  PhCaretLeft,
  PhCaretRight,
} from '@phosphor-icons/vue'

// variant: 'bar'(文档页底部分享栏, 默认) | 'hero'(首页主视觉区的幽灵按钮)
const props = defineProps<{ variant?: 'bar' | 'hero' }>()

const { page } = useData()
const route = useRoute()

const SITE_TITLE = '呼市二中学习生活指导'
const SITE_MOTTO = '今天拼搏在二中，明天是建设祖国的先锋'
const SITE_HOST = 'hs2z.inknook.ink'
// 与 custom.css 的字体栈一致(canvas font 需显式列出)
const FONT = `'PingFang SC','HarmonyOS Sans SC','MiSans','Microsoft YaHei UI','Microsoft YaHei','Noto Sans SC',sans-serif`

const siteUrl = (typeof __SITE_URL__ !== 'undefined' && __SITE_URL__) || ''

const pageUrl = computed(() => {
  const origin = siteUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  return origin + withBase(route.path)
})

const pageTitle = computed(
  () => (page.value.title || '').trim() || SITE_TITLE
)

/* ---------------- 快捷分享 ---------------- */

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyLink() {
  try {
    await navigator.clipboard.writeText(pageUrl.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = pageUrl.value
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* 忽略 */ }
    ta.remove()
  }
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1600)
}

const canNativeShare = ref(false)

onMounted(() => {
  canNativeShare.value = typeof navigator !== 'undefined' && !!navigator.share
})

async function nativeShare() {
  try {
    await navigator.share({ title: `${pageTitle.value} | ${SITE_TITLE}`, url: pageUrl.value })
  } catch { /* 用户取消或不支持, 忽略 */ }
}

/* ---------------- 统一弹窗 ---------------- */

const open = ref(false)

function openModal() {
  open.value = true
  nextTick(() => renderPoster())
}

function closeModal() {
  open.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeModal()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (copiedTimer) clearTimeout(copiedTimer)
})

// 路由切换: 关闭弹窗、复位按钮状态
watch(
  () => route.path,
  () => {
    closeModal()
    copied.value = false
  }
)

/* ---------------- 海报: 风格 × 背景 ---------------- */

type PosterStyle = 'white' | 'blue' | 'paper' | 'black' | 'photo' | 'immersive'

const posterStyle = ref<PosterStyle>('blue')
const posterDataUrl = ref('')
const posterRendering = ref(false)
const posterCanvas = ref<HTMLCanvasElement | null>(null)

const styleOptions: { key: PosterStyle; label: string }[] = [
  { key: 'white', label: '简约白' },
  { key: 'blue', label: '品牌蓝' },
  { key: 'paper', label: '米黄纸感' },
  { key: 'black', label: '黑金典雅' },
  { key: 'photo', label: '上图下文' },
  { key: 'immersive', label: '全图沉浸' },
]

const isPhotoStyle = computed(() => posterStyle.value === 'photo' || posterStyle.value === 'immersive')

// 图片风格可选背景: 用户指定的 20 张官方照片(docs/public/posters/)。
// thumb 为选择器缩略图(240px 压缩版), file 为海报绘制用完整图;
// 名称不展示, label 仅作无障碍提示。
const bgOptions = Array.from({ length: 20 }, (_, i) => ({
  file: `/posters/bg${String(i + 1).padStart(2, '0')}.jpg`,
  thumb: `/posters/thumbs/bg${String(i + 1).padStart(2, '0')}.jpg`,
  label: `背景 ${i + 1}`,
}))
const bgIndex = ref(0)

const posterName = computed(
  () => `${pageTitle.value.slice(0, 20)} - 呼市二中分享海报.png`
)

let rerenderQueued = false

function switchStyle(s: PosterStyle) {
  if (posterStyle.value === s) return
  posterStyle.value = s
  renderPoster()
}

function switchBg(i: number) {
  if (bgIndex.value === i) return
  bgIndex.value = i
  renderPoster()
}

/* 背景滑轨: 左右箭头翻页 + 选中项自动滚到居中 */
const bgRail = ref<HTMLElement | null>(null)

function scrollRail(dir: -1 | 1) {
  const rail = bgRail.value
  if (!rail) return
  rail.scrollBy({ left: dir * rail.clientWidth * 0.8, behavior: 'smooth' })
}

watch(bgIndex, async () => {
  await nextTick()
  bgRail.value
    ?.querySelector('.bg-thumb.active')
    ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
})

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function renderPoster() {
  const canvas = posterCanvas.value
  if (!canvas) return
  // 上一次仍在生成时只记一次重排队, 完成后自动补渲染, 快速切换不丢请求
  if (posterRendering.value) {
    rerenderQueued = true
    return
  }
  posterRendering.value = true
  try {
    const QRCode = (await import('qrcode')).default
    const [qrImg, badgeImg] = await Promise.all([
      QRCode.toDataURL(pageUrl.value, {
        margin: 2,
        width: 560,
        color: { dark: '#1b1b1b', light: '#ffffff' },
      }).then(loadImage),
      loadImage(withBase('/og-badge.png')).catch(() => null),
    ])
    // 图片风格: 加载所选背景; 失败自动回退品牌蓝
    let bgImg: HTMLImageElement | null = null
    if (isPhotoStyle.value) {
      bgImg = await loadImage(withBase(bgOptions[bgIndex.value].file)).catch(() => null)
      if (!bgImg) posterStyle.value = 'blue'
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (posterStyle.value === 'white') drawWhite(ctx, canvas, qrImg, badgeImg)
    else if (posterStyle.value === 'blue') drawBlue(ctx, canvas, qrImg, badgeImg)
    else if (posterStyle.value === 'paper') drawPaper(ctx, canvas, qrImg, badgeImg)
    else if (posterStyle.value === 'black') drawBlackGold(ctx, canvas, qrImg, badgeImg)
    else if (posterStyle.value === 'photo') drawPhoto(ctx, canvas, qrImg, badgeImg, bgImg!)
    else drawImmersive(ctx, canvas, qrImg, badgeImg, bgImg!)
    posterDataUrl.value = canvas.toDataURL('image/png')
  } finally {
    posterRendering.value = false
    if (rerenderQueued) {
      rerenderQueued = false
      renderPoster()
    }
  }
}

/* ---------------- Canvas 绘制辅助 ---------------- */

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 圆形裁切绘制头像/校徽, 外加描边环
function circleImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement, cx: number, cy: number, radius: number,
  ringColor: string, ringWidth: number
) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2)
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.strokeStyle = ringColor
  ctx.lineWidth = ringWidth
  ctx.stroke()
  ctx.restore()
}

// 居中自动换行(超出 maxLines 截断加省略号), 返回结束 y
function wrapCenter(
  ctx: CanvasRenderingContext2D,
  text: string, x: number, y: number, maxW: number,
  lineH: number, maxLines: number
): number {
  const chars = [...text]
  const lines: string[] = []
  let line = ''
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW && line) {
      lines.push(line)
      line = ch
      if (lines.length === maxLines) break
    } else {
      line += ch
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1]
    const consumed = lines.join('').length
    if (consumed < chars.length) {
      while (ctx.measureText(last + '…').width > maxW && last.length > 1) {
        last = last.slice(0, -1)
      }
      lines[maxLines - 1] = last + '…'
    }
  }
  ctx.textAlign = 'center'
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH))
  return y + (lines.length - 1) * lineH
}

// cover 模式铺满绘制(整图或指定高度区域)
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement, W: number, regionH: number, offsetY = 0
) {
  const scale = Math.max(W / img.width, regionH / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, (W - dw) / 2, offsetY + (regionH - dh) / 2, dw, dh)
}

// 底部公共块: 二维码白卡 + 提示 + 网址 + 校训
function drawFooterBlock(
  ctx: CanvasRenderingContext2D,
  qr: HTMLImageElement,
  opts: {
    cardY: number
    urlColor: string
    hintColor: string
    mottoColor: string
  }
) {
  const W = 1080
  const { cardY } = opts
  const cardW = 340
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.14)'
  ctx.shadowBlur = 28
  ctx.shadowOffsetY = 10
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, (W - cardW) / 2, cardY, cardW, cardW, 28)
  ctx.fill()
  ctx.restore()
  const qrSize = cardW - 60
  ctx.drawImage(qr, (W - qrSize) / 2, cardY + 30, qrSize, qrSize)

  ctx.textAlign = 'center'
  ctx.fillStyle = opts.hintColor
  ctx.font = `500 36px ${FONT}`
  ctx.fillText('长按识别二维码，查看本文', W / 2, cardY + cardW + 88)
  ctx.fillStyle = opts.urlColor
  ctx.font = `700 40px ${FONT}`
  ctx.fillText(SITE_HOST, W / 2, cardY + cardW + 158)
  ctx.fillStyle = opts.mottoColor
  ctx.font = `400 30px ${FONT}`
  ctx.fillText(SITE_MOTTO, W / 2, cardY + cardW + 232)
}

/* ---------------- 风格一: 简约白 ---------------- */

function drawWhite(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
  qr: HTMLImageElement, badge: HTMLImageElement | null
) {
  const W = canvas.width
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, canvas.height)

  if (badge) {
    circleImage(ctx, badge, W / 2, 210, 105, '#e8eefb', 14)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#26281f'
  ctx.font = `600 46px ${FONT}`
  ctx.fillText(SITE_TITLE, W / 2, 400)

  ctx.strokeStyle = '#e6e6e2'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(280, 470)
  ctx.lineTo(W - 280, 470)
  ctx.stroke()

  ctx.fillStyle = '#26281f'
  ctx.font = `700 64px ${FONT}`
  const titleEndY = wrapCenter(ctx, pageTitle.value, W / 2, 580, 880, 88, 2)

  ctx.fillStyle = '#2f5ad8'
  roundRect(ctx, W / 2 - 34, titleEndY + 58, 68, 8, 4)
  ctx.fill()

  ctx.fillStyle = '#8a8b80'
  ctx.font = `400 32px ${FONT}`
  ctx.fillText('历届学长整理 · 免费开放 · 持续更新', W / 2, titleEndY + 150)

  drawFooterBlock(ctx, qr, {
    cardY: 800,
    urlColor: '#2f5ad8',
    hintColor: '#55564d',
    mottoColor: '#8a8b80',
  })
}

/* ---------------- 风格二: 品牌蓝 ---------------- */

function drawBlue(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
  qr: HTMLImageElement, badge: HTMLImageElement | null
) {
  const W = canvas.width
  const H = canvas.height
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#24459f')
  grad.addColorStop(1, '#2f5ad8')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'
  ctx.lineWidth = 60
  ctx.beginPath()
  ctx.arc(W - 60, 120, 260, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(70, H - 200, 300, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  if (badge) {
    circleImage(ctx, badge, W / 2, 210, 105, 'rgba(255, 255, 255, 0.85)', 10)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 46px ${FONT}`
  ctx.fillText(SITE_TITLE, W / 2, 400)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(280, 470)
  ctx.lineTo(W - 280, 470)
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 64px ${FONT}`
  const titleEndY = wrapCenter(ctx, pageTitle.value, W / 2, 580, 880, 88, 2)

  ctx.fillStyle = '#9db4f0'
  roundRect(ctx, W / 2 - 34, titleEndY + 58, 68, 8, 4)
  ctx.fill()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
  ctx.font = `400 32px ${FONT}`
  ctx.fillText('历届学长整理 · 免费开放 · 持续更新', W / 2, titleEndY + 150)

  drawFooterBlock(ctx, qr, {
    cardY: 800,
    urlColor: '#ffffff',
    hintColor: 'rgba(255, 255, 255, 0.82)',
    mottoColor: 'rgba(255, 255, 255, 0.55)',
  })
}

/* ---------------- 风格三: 米黄纸感 ---------------- */

function drawPaper(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
  qr: HTMLImageElement, badge: HTMLImageElement | null
) {
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = '#f8f1e2'
  ctx.fillRect(0, 0, W, H)

  // 复古双线内框
  ctx.strokeStyle = '#d8c69c'
  ctx.lineWidth = 3
  ctx.strokeRect(44, 44, W - 88, H - 88)
  ctx.strokeStyle = 'rgba(216, 198, 156, 0.55)'
  ctx.lineWidth = 1
  ctx.strokeRect(58, 58, W - 116, H - 116)

  if (badge) {
    circleImage(ctx, badge, W / 2, 215, 102, '#d8c69c', 12)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#5a4a30'
  ctx.font = `600 46px ${FONT}`
  ctx.fillText(SITE_TITLE, W / 2, 405)

  ctx.strokeStyle = '#d8c69c'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(300, 472)
  ctx.lineTo(W - 300, 472)
  ctx.stroke()

  ctx.fillStyle = '#3e3526'
  ctx.font = `700 64px ${FONT}`
  const titleEndY = wrapCenter(ctx, pageTitle.value, W / 2, 580, 880, 88, 2)

  ctx.fillStyle = '#b3894a'
  roundRect(ctx, W / 2 - 34, titleEndY + 58, 68, 8, 4)
  ctx.fill()

  ctx.fillStyle = '#8b7b5c'
  ctx.font = `400 32px ${FONT}`
  ctx.fillText('历届学长整理 · 免费开放 · 持续更新', W / 2, titleEndY + 150)

  drawFooterBlock(ctx, qr, {
    cardY: 800,
    urlColor: '#8a6d3b',
    hintColor: '#6b5d44',
    mottoColor: '#9a8a68',
  })
}

/* ---------------- 风格四: 黑金典雅 ---------------- */

function drawBlackGold(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
  qr: HTMLImageElement, badge: HTMLImageElement | null
) {
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = '#15171d'
  ctx.fillRect(0, 0, W, H)

  // 顶部金色柔光
  const glow = ctx.createRadialGradient(W / 2, 180, 60, W / 2, 180, 950)
  glow.addColorStop(0, 'rgba(212, 175, 106, 0.12)')
  glow.addColorStop(1, 'rgba(212, 175, 106, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // 金色细边框
  ctx.strokeStyle = 'rgba(212, 175, 106, 0.28)'
  ctx.lineWidth = 2
  ctx.strokeRect(36, 36, W - 72, H - 72)

  if (badge) {
    circleImage(ctx, badge, W / 2, 210, 102, 'rgba(212, 175, 106, 0.85)', 8)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#f2e8d5'
  ctx.font = `600 46px ${FONT}`
  ctx.fillText(SITE_TITLE, W / 2, 400)

  ctx.strokeStyle = 'rgba(212, 175, 106, 0.45)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(280, 470)
  ctx.lineTo(W - 280, 470)
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 64px ${FONT}`
  const titleEndY = wrapCenter(ctx, pageTitle.value, W / 2, 580, 880, 88, 2)

  ctx.fillStyle = '#d4af6a'
  roundRect(ctx, W / 2 - 34, titleEndY + 58, 68, 8, 4)
  ctx.fill()

  ctx.fillStyle = 'rgba(242, 232, 213, 0.66)'
  ctx.font = `400 32px ${FONT}`
  ctx.fillText('历届学长整理 · 免费开放 · 持续更新', W / 2, titleEndY + 150)

  drawFooterBlock(ctx, qr, {
    cardY: 800,
    urlColor: '#d4af6a',
    hintColor: 'rgba(242, 232, 213, 0.82)',
    mottoColor: 'rgba(242, 232, 213, 0.45)',
  })
}

/* ---------------- 风格五: 上图下文(背景可选) ---------------- */

function drawPhoto(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
  qr: HTMLImageElement, badge: HTMLImageElement | null,
  bg: HTMLImageElement
) {
  const W = canvas.width
  const H = canvas.height
  const photoH = 640
  drawCover(ctx, bg, W, photoH)
  // 底部渐隐过渡到留白区
  const fade = ctx.createLinearGradient(0, photoH - 260, 0, photoH)
  fade.addColorStop(0, 'rgba(255, 255, 255, 0)')
  fade.addColorStop(1, 'rgba(255, 255, 255, 1)')
  ctx.fillStyle = fade
  ctx.fillRect(0, photoH - 260, W, 260)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, photoH, W, H - photoH)

  if (badge) {
    circleImage(ctx, badge, W / 2, photoH - 40, 100, '#ffffff', 12)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#26281f'
  ctx.font = `600 44px ${FONT}`
  ctx.fillText(SITE_TITLE, W / 2, photoH + 130)

  ctx.fillStyle = '#24459f'
  ctx.font = `700 62px ${FONT}`
  const titleEndY = wrapCenter(ctx, pageTitle.value, W / 2, photoH + 226, 860, 86, 2)

  ctx.fillStyle = '#8a8b80'
  ctx.font = `400 31px ${FONT}`
  ctx.fillText('历届学长整理 · 免费开放 · 持续更新', W / 2, titleEndY + 118)

  drawFooterBlock(ctx, qr, {
    cardY: 1040,
    urlColor: '#2f5ad8',
    hintColor: '#55564d',
    mottoColor: '#8a8b80',
  })
}

/* ---------------- 风格六: 全图沉浸(背景可选) ---------------- */

function drawImmersive(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
  qr: HTMLImageElement, badge: HTMLImageElement | null,
  bg: HTMLImageElement
) {
  const W = canvas.width
  const H = canvas.height
  drawCover(ctx, bg, W, H)
  // 深色渐变遮罩保证文字可读
  const veil = ctx.createLinearGradient(0, 0, 0, H)
  veil.addColorStop(0, 'rgba(10, 16, 38, 0.42)')
  veil.addColorStop(0.5, 'rgba(10, 16, 38, 0.30)')
  veil.addColorStop(1, 'rgba(10, 16, 38, 0.80)')
  ctx.fillStyle = veil
  ctx.fillRect(0, 0, W, H)

  if (badge) {
    circleImage(ctx, badge, W / 2, 200, 100, 'rgba(255, 255, 255, 0.92)', 8)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 46px ${FONT}`
  ctx.fillText(SITE_TITLE, W / 2, 392)

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(280, 456)
  ctx.lineTo(W - 280, 456)
  ctx.stroke()

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 66px ${FONT}`
  const titleEndY = wrapCenter(ctx, pageTitle.value, W / 2, 566, 880, 90, 2)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  ctx.font = `400 32px ${FONT}`
  ctx.fillText('历届学长整理 · 免费开放 · 持续更新', W / 2, titleEndY + 140)

  drawFooterBlock(ctx, qr, {
    cardY: 780,
    urlColor: '#ffffff',
    hintColor: 'rgba(255, 255, 255, 0.85)',
    mottoColor: 'rgba(255, 255, 255, 0.6)',
  })
}
</script>

<template>
  <!-- hero 变体: 首页主视觉区的幽灵按钮(样式由 custom.css 的 .home-hero .btn 提供) -->
  <button
    v-if="props.variant === 'hero'"
    type="button"
    class="btn btn-ghost share-hero-btn"
    @click="openModal"
  >
    <component :is="PhShareFat" :size="16" weight="fill" aria-hidden="true" />
    分享本站
  </button>

  <div v-else class="share-bar">
    <span class="share-bar-label">觉得有用？分享给同学</span>
    <button type="button" class="share-main-btn" @click="openModal">
      <component :is="PhShareFat" :size="16" weight="fill" aria-hidden="true" />
      分享
    </button>
  </div>

  <Teleport to="body">
    <Transition name="share-fade">
      <div v-if="open" class="share-overlay" @click.self="closeModal">
        <div class="share-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            class="share-modal-close"
            aria-label="关闭"
            @click="closeModal"
          >
            <component :is="PhX" :size="18" weight="bold" aria-hidden="true" />
          </button>

          <h3 class="share-modal-title">分享本页</h3>

          <!-- 快捷分享 -->
          <div class="quick-actions">
            <button type="button" class="quick-btn" @click="copyLink">
              <component
                :is="copied ? PhCheck : PhCopy"
                :size="18"
                weight="bold"
                aria-hidden="true"
              />
              {{ copied ? '已复制' : '复制链接' }}
            </button>
            <button
              v-if="canNativeShare"
              type="button"
              class="quick-btn"
              @click="nativeShare"
            >
              <component :is="PhShareNetwork" :size="18" weight="bold" aria-hidden="true" />
              系统分享
            </button>
          </div>

          <div class="share-divider" aria-hidden="true"></div>

          <!-- 海报 -->
          <div class="poster-section">
            <div class="poster-styles">
              <button
                v-for="s in styleOptions"
                :key="s.key"
                type="button"
                class="poster-style-btn"
                :class="{ active: posterStyle === s.key }"
                @click="switchStyle(s.key)"
              >
                {{ s.label }}
              </button>
            </div>

            <!-- 背景滑轨: 左右箭头翻页, 触屏可横滑, 选中项自动居中 -->
            <div v-if="isPhotoStyle" class="bg-rail">
              <button
                type="button"
                class="rail-arrow left"
                aria-label="向左查看更多背景"
                @click="scrollRail(-1)"
              >
                <component :is="PhCaretLeft" :size="14" weight="bold" aria-hidden="true" />
              </button>
              <div ref="bgRail" class="poster-bgs">
                <!-- 缩略图用 CSS 背景(240px 压缩图): 无 img 元素, 点击直达且不触发全局灯箱;
                     海报绘制加载完整图 bg.file -->
                <button
                  v-for="(bg, i) in bgOptions"
                  :key="bg.file"
                  type="button"
                  class="bg-thumb"
                  :class="{ active: bgIndex === i }"
                  :title="bg.label"
                  :aria-label="`背景：${bg.label}`"
                  :style="{ backgroundImage: `url(${withBase(bg.thumb)})` }"
                  @click="switchBg(i)"
                ></button>
              </div>
              <button
                type="button"
                class="rail-arrow right"
                aria-label="向右查看更多背景"
                @click="scrollRail(1)"
              >
                <component :is="PhCaretRight" :size="14" weight="bold" aria-hidden="true" />
              </button>
            </div>

            <div class="poster-canvas-wrap">
              <canvas
                v-show="posterDataUrl"
                ref="posterCanvas"
                width="1080"
                height="1440"
              />
              <div v-if="posterRendering" class="poster-loading">生成中…</div>
            </div>

            <div class="poster-actions">
              <a
                class="poster-download"
                :href="posterDataUrl"
                :download="posterName"
                :aria-disabled="!posterDataUrl"
                @click.stop
              >
                <component :is="PhDownloadSimple" :size="16" weight="bold" aria-hidden="true" />
                下载海报
              </a>
              <span class="poster-hint">手机端可长按图片保存</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.share-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.8rem;
  margin-top: 3rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--vp-c-divider);
}

.share-bar-label {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}

.share-main-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 1.2rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease, transform 0.15s ease;
}

.share-main-btn:hover {
  color: #fff;
  background: var(--vp-c-brand-1);
}

.share-main-btn:active {
  transform: translateY(1px);
}

/* ---------------- 弹窗 ---------------- */

.share-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: rgba(15, 16, 20, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  overflow-y: auto;
}

.share-modal {
  position: relative;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius, 12px);
  padding: 1.5rem 1.5rem 1.2rem;
  width: min(430px, calc(100vw - 2rem));
  max-height: calc(100dvh - 3rem);
  overflow-y: auto;
  text-align: center;
}

.share-modal-close {
  position: absolute;
  top: 0.8rem;
  right: 0.8rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.share-modal-close:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft, rgba(128, 128, 128, 0.12));
}

.share-modal-title {
  margin: 0.2rem 0 0.9rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: 0.02em;
}

/* 快捷分享按钮 */
.quick-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.quick-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.48rem 1.1rem;
  font-size: 0.86rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.quick-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.share-divider {
  height: 1px;
  background: var(--vp-c-divider);
  margin: 1.2rem 0 1rem;
}

/* 海报 */
.poster-section {
  text-align: center;
}

.poster-styles {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.poster-style-btn {
  padding: 0.35rem 0.85rem;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: transparent;
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.poster-style-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.poster-style-btn.active {
  color: #fff;
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

/* 背景滑轨: 单行横向滚动, 触屏横滑 + 桌面箭头翻页 */
.bg-rail {
  position: relative;
  margin: 0.85rem 0 0;
}

.poster-bgs {
  display: flex;
  gap: 0.45rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: 0.25rem 0.65rem;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.poster-bgs::-webkit-scrollbar {
  display: none;
}

.rail-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--vp-c-border);
  border-radius: 50%;
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-2);
  cursor: pointer;
  z-index: 2;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.rail-arrow:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.rail-arrow.left {
  left: -8px;
}

.rail-arrow.right {
  right: -8px;
}

.rail-arrow:active {
  transform: translateY(-50%) scale(0.92);
}

.bg-thumb {
  flex: 0 0 auto;
  scroll-snap-align: center;
  width: 52px;
  height: 40px;
  border: 2px solid var(--vp-c-border);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background-color: var(--vp-c-bg);
  background-size: cover;
  background-position: center;
  padding: 0;
  transition: border-color 0.15s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.bg-thumb:hover {
  transform: translateY(-2px);
}

/* 触感反馈: 按下物理下压感 */
.bg-thumb:active {
  transform: scale(0.94);
}

.bg-thumb.active {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 2px var(--vp-c-brand-soft, rgba(47, 90, 216, 0.18));
}

.poster-canvas-wrap {
  position: relative;
  display: flex;
  justify-content: center;
}

.poster-canvas-wrap canvas {
  width: min(300px, 72vw);
  height: auto;
  border-radius: var(--hs2-radius-sm, 6px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
}

.poster-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
}

.poster-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.7rem;
  margin-top: 1.1rem;
}

.poster-download {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1.25rem;
  font-size: 0.88rem;
  font-weight: 600;
  color: #fff;
  background: var(--vp-c-brand-1);
  border-radius: 999px;
  text-decoration: none;
  transition: background-color 0.15s ease;
}

.poster-download:hover {
  background: var(--vp-c-brand-2);
}

.poster-download[aria-disabled='true'] {
  opacity: 0.5;
  pointer-events: none;
}

.poster-hint {
  font-size: 0.76rem;
  color: var(--vp-c-text-3);
}

/* 入场动效(与灯箱一致, 尊重 reduced motion) */
.share-fade-enter-active,
.share-fade-leave-active {
  transition: opacity 0.18s ease;
}

.share-fade-enter-from,
.share-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .share-fade-enter-active,
  .share-fade-leave-active {
    transition: none;
  }
}
</style>
