// ============================================================
// 微信分享卡片(JS-SDK): 在微信内打开本站时, 自定义"发送给朋友"
// 与"分享到朋友圈"的标题/摘要/缩略图。
//
// 流程: 检测微信 UA → 按需加载 jweixin → 向后端要当前 URL 的签名
//   → wx.config → wx.ready 里 updateAppMessageShareData /
//   updateTimelineShareData。VitePress 是 SPA, 路由切换后需重签:
//   Android 用当前 URL; iOS 微信始终以"首次进入页"URL 校验签名,
//   因此记录入口 URL 复用(iOS 换页无需重新 wx.config, 只更新内容)。
// 非微信环境完全不加载脚本、不请求接口; 签名失败仅控制台告警,
// 不影响站点其他功能。
// ============================================================
import { onMounted, watch } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'

// 签名接口与文档助手同一个后端(config.ts 注入; 独立部署时为绝对地址)
const API_BASE =
  (typeof __ASSISTANT_API__ !== 'undefined' && __ASSISTANT_API__) || '/api/assistant'

const SDK_SRC = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js'
const JS_API_LIST = ['updateAppMessageShareData', 'updateTimelineShareData']

declare global {
  interface Window {
    wx?: any
  }
}

function isWeChat() {
  return (
    typeof window !== 'undefined' &&
    /micromessenger/i.test(window.navigator.userAgent)
  )
}

// SPA 入口 URL: iOS 微信签名只认它(见文件头注释)
const ENTRY_URL =
  typeof location !== 'undefined' ? location.href.split('#')[0] : ''

let sdkPromise: Promise<void> | null = null
function loadSdk(): Promise<void> {
  if (window.wx) return Promise.resolve()
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SDK_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('jweixin 加载失败'))
      document.head.appendChild(s)
    }).catch((e) => {
      sdkPromise = null // 允许下次重试
      throw e
    })
  }
  return sdkPromise
}

// iOS 用入口 URL 签名; 其余(Android/开发者工具)用当前 URL
function signTargetUrl() {
  const current = location.href.split('#')[0]
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ? ENTRY_URL || current : current
}

export function useWxShare() {
  // SSR(SSG 构建)与非微信环境直接跳过
  if (typeof window === 'undefined' || !isWeChat()) return

  const route = useRoute()
  const { page, frontmatter, site } = useData()

  let lastSignedUrl = '' // 已通过 wx.config 的 URL, 避免重复签名

  function sharePayload() {
    const siteTitle = site.value.title
    const pageTitle = page.value.title || siteTitle
    const isHome = route.path === '/' || pageTitle === siteTitle
    // 首页/重名页只显示站名, 其余"页面名 · 站名"
    const title = isHome ? siteTitle : `${pageTitle} · ${siteTitle}`
    const desc =
      (frontmatter.value.description as string | undefined) ||
      site.value.description ||
      ''
    // 缩略图必须是可直接访问的绝对 URL(方形 PNG/JPG, 建议 ≥300px)
    const img = withBase((frontmatter.value.shareImage as string) || '/share-card.png')
    const imgUrl = new URL(img, location.origin).href
    return {
      title,
      desc,
      link: location.href.split('#')[0],
      imgUrl,
    }
  }

  async function configureShare() {
    try {
      await loadSdk()
      const wx = window.wx
      if (!wx) return

      const target = signTargetUrl()
      if (target !== lastSignedUrl) {
        const qs = `${API_BASE}/wx-signature?url=${encodeURIComponent(target)}`
        const res = await fetch(qs)
        if (!res.ok) {
          // 未配置/后端异常: 静默降级(微信仍可分享, 只是卡片用默认抓取内容)
          console.warn('[wx-share] 签名接口不可用:', res.status)
          return
        }
        const cfg = await res.json()
        lastSignedUrl = target
        wx.config({
          // 排障开关: 页面 URL 加 ?wxdebug=1 后在微信内打开,
          // 会弹窗显示 wx.config 验签结果与具体 errMsg
          debug: new URLSearchParams(location.search).has('wxdebug'),
          appId: cfg.appId,
          timestamp: cfg.timestamp,
          nonceStr: cfg.nonceStr,
          signature: cfg.signature,
          jsApiList: JS_API_LIST,
        })
        wx.error?.((r: any) => console.warn('[wx-share] wx.config 失败:', r?.errMsg))
      }

      wx.ready(() => {
        const data = sharePayload()
        wx.updateAppMessageShareData({ ...data, success: () => {} })
        wx.updateTimelineShareData({
          title: data.title,
          link: data.link,
          imgUrl: data.imgUrl,
          success: () => {},
        })
      })
    } catch (e) {
      console.warn('[wx-share] 初始化失败(不影响其他功能):', e)
    }
  }

  onMounted(() => {
    configureShare()
    // SPA 路由切换: 200ms 防抖, 等标题/frontmatter 就绪后再更新分享内容
    let timer: ReturnType<typeof setTimeout> | undefined
    watch(
      () => route.path,
      () => {
        clearTimeout(timer)
        timer = setTimeout(configureShare, 200)
      }
    )
  })
}
