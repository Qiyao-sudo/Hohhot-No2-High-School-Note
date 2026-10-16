<script setup lang="ts">
// 页面底部分享栏: 复制链接 / 微信扫码 / 系统分享 / 生成海报。
// - 挂载于 Layout 的 doc-after 插槽(评论区上方), frontmatter.share !== false 时渲染
// - 页面二维码与海报均在前端本地生成(qrcode + Canvas), 不依赖微信 JS-SDK
//   (账号无自定义分享接口权限, 该方案已回退, 见 git 历史)
// - 海报三种风格可切换: 简约白 / 品牌蓝 / 校园照片(照片加载失败自动回退品牌蓝)
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'
import {
  PhCopy,
  PhCheck,
  PhWechatLogo,
  PhShareNetwork,
  PhImage,
  PhX,
  PhDownloadSimple,
} from '@phosphor-icons/vue'

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

/* ---------------- 分享栏按钮 ---------------- */

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyLink() {
  try {
    await navigator.clipboard.writeText(pageUrl.value)
  } catch {
    // 剪贴板 API 不可用时退回传统方案
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

/* ---------------- 弹层(二维码 / 海报) ---------------- */

// 'qr' 页面二维码 | 'poster' 海报 | null 关闭
const overlay = ref<'qr' | 'poster' | null>(null)

const qrDataUrl = ref('')

function openOverlay(mode: 'qr' | 'poster') {
  overlay.value = mode
  if (mode === 'qr') ensureQr()
  else nextTick(() => renderPoster())
}

function closeOverlay() {
  overlay.value = null
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closeOverlay()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (copiedTimer) clearTimeout(copiedTimer)
})

// 路由切换: 关闭弹层、复位按钮状态
watch(
  () => route.path,
  () => {
    closeOverlay()
    copied.value = false
  }
)

async function ensureQr() {
  if (qrDataUrl.value) return
  const QRCode = (await import('qrcode')).default
  qrDataUrl.value = await QRCode.toDataURL(pageUrl.value, {
    margin: 2,
    width: 560,
    color: { dark: '#1b1b1b', light: '#ffffff' },
  })
}

/* ---------------- 海报 ---------------- */

type PosterStyle = 'white' | 'blue' | 'photo'

const posterStyle = ref<PosterStyle>('blue')
const posterDataUrl = ref('')
const posterRendering = ref(false)
const posterCanvas = ref<HTMLCanvasElement | null>(null)

const styleOptions: { key: PosterStyle; label: string }[] = [
  { key: 'white', label: '简约白' },
  { key: 'blue', label: '品牌蓝' },
  { key: 'photo', label: '校园照片' },
]

const posterName = computed(
  () => `${pageTitle.value.slice(0, 20)} - 呼市二中分享海报.png`
)

function switchStyle(s: PosterStyle) {
  if (posterStyle.value === s) return
  posterStyle.value = s
  renderPoster()
}

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
  if (!canvas || posterRendering.value) return
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
    // 校园照片风格: hero 图在自动同步目录, 可能缺失 → 整体回退品牌蓝
    let heroImg: HTMLImageElement | null = null
    if (posterStyle.value === 'photo') {
      heroImg = await loadImage(withBase('/images/hero.jpg')).catch(() => null)
      if (!heroImg) posterStyle.value = 'blue'
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (posterStyle.value === 'white') drawWhite(ctx, canvas, qrImg, badgeImg)
    else if (posterStyle.value === 'blue') drawBlue(ctx, canvas, qrImg, badgeImg)
    else drawPhoto(ctx, canvas, qrImg, badgeImg, heroImg!)
    posterDataUrl.value = canvas.toDataURL('image/png')
  } finally {
    posterRendering.value = false
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

// 底部公共块: 二维码卡 + 提示 + 网址 + 校训
function drawFooterBlock(
  ctx: CanvasRenderingContext2D,
  qr: HTMLImageElement,
  opts: {
    dark?: boolean      // 文字是否深色(白底风格)
    cardY: number       // 卡片顶部 y
    urlColor: string
    textColor: string
    mottoColor: string
    hintColor: string
  }
) {
  const W = 1080
  const { cardY } = opts
  // 二维码白卡(任何风格都保持白底保证可扫)
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

  // 标题(蓝色竖标风格的分隔线)
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
    textColor: '#26281f',
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

  // 弱装饰圆环
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
    textColor: '#ffffff',
    hintColor: 'rgba(255, 255, 255, 0.82)',
    mottoColor: 'rgba(255, 255, 255, 0.55)',
  })
}

/* ---------------- 风格三: 校园照片 ---------------- */

function drawPhoto(
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement,
  qr: HTMLImageElement, badge: HTMLImageElement | null,
  hero: HTMLImageElement
) {
  const W = canvas.width
  const H = canvas.height
  const photoH = 640
  // 封面裁切(cover)
  const scale = Math.max(W / hero.width, photoH / hero.height)
  const dw = hero.width * scale
  const dh = hero.height * scale
  ctx.drawImage(hero, (W - dw) / 2, (photoH - dh) / 2, dw, dh)
  // 底部渐隐, 让照片过渡到留白区
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
    textColor: '#26281f',
    hintColor: '#55564d',
    mottoColor: '#8a8b80',
  })
}
</script>

<template>
  <div class="share-bar">
    <span class="share-bar-label">分享</span>
    <div class="share-bar-actions">
      <button type="button" class="share-btn" @click="copyLink">
        <component
          :is="copied ? PhCheck : PhCopy"
          :size="16"
          weight="bold"
          aria-hidden="true"
        />
        {{ copied ? '已复制' : '复制链接' }}
      </button>
      <button type="button" class="share-btn" @click="openOverlay('qr')">
        <component :is="PhWechatLogo" :size="16" weight="fill" aria-hidden="true" />
        微信扫码
      </button>
      <button
        v-if="canNativeShare"
        type="button"
        class="share-btn"
        @click="nativeShare"
      >
        <component :is="PhShareNetwork" :size="16" weight="bold" aria-hidden="true" />
        系统分享
      </button>
      <button type="button" class="share-btn" @click="openOverlay('poster')">
        <component :is="PhImage" :size="16" weight="bold" aria-hidden="true" />
        生成海报
      </button>
    </div>
  </div>

  <Teleport to="body">
    <Transition name="share-fade">
      <div v-if="overlay" class="share-overlay" @click.self="closeOverlay">
        <div class="share-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            class="share-modal-close"
            aria-label="关闭"
            @click="closeOverlay"
          >
            <component :is="PhX" :size="18" weight="bold" aria-hidden="true" />
          </button>

          <!-- 页面二维码 -->
          <template v-if="overlay === 'qr'">
            <h3 class="share-modal-title">微信扫一扫</h3>
            <p class="share-modal-sub">在手机上打开本页，转发给同学或朋友圈</p>
            <div class="share-qr-wrap">
              <img
                v-if="qrDataUrl"
                :src="qrDataUrl"
                alt="本页二维码"
                @click.stop
              >
            </div>
            <p class="share-modal-url">{{ pageUrl }}</p>
          </template>

          <!-- 海报 -->
          <template v-else>
            <h3 class="share-modal-title">分享海报</h3>
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
          </template>
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
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  color: var(--vp-c-text-3);
  font-weight: 600;
}

.share-bar-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.share-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.42rem 0.95rem;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}

.share-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.share-btn:active {
  transform: translateY(1px);
}

/* ---------------- 弹层 ---------------- */

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
  padding: 1.6rem 1.6rem 1.3rem;
  width: min(420px, calc(100vw - 2rem));
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
  margin: 0.2rem 0 0.3rem;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  letter-spacing: 0.02em;
}

.share-modal-sub {
  margin: 0 0 1rem;
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
}

.share-qr-wrap {
  display: flex;
  justify-content: center;
}

.share-qr-wrap img {
  width: min(240px, 60vw);
  height: auto;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius-sm, 6px);
  margin: 0;
  cursor: default;
}

.share-modal-url {
  margin: 0.9rem 0 0.2rem;
  font-size: 0.78rem;
  color: var(--vp-c-text-3);
  word-break: break-all;
  font-family: var(--vp-font-family-mono, monospace);
}

/* ---------------- 海报 ---------------- */

.poster-styles {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin: 0.35rem 0 1rem;
}

.poster-style-btn {
  padding: 0.35rem 0.9rem;
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
