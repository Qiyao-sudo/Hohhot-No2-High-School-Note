// ============================================================
// 微信 JS-SDK 签名(零依赖, Node 18+ 自带 fetch/crypto)
//
// 前端 wx.config 需要服务端用 jsapi_ticket 对当前页面 URL 做 SHA1 签名:
//   signature = sha1("jsapi_ticket=..&noncestr=..&timestamp=..&url=..")
// jsapi_ticket 需先用 AppID+AppSecret 换 access_token 再获取, 两者有效期
// 7200s 且有调用频控, 因此进程内缓存并在过期前 5 分钟主动刷新。
//
// 需要的环境变量(未配置时 /wx-signature 返回未配置, 前端静默跳过):
//   WECHAT_APP_ID   公众号 AppID
//   WECHAT_SECRET   公众号 AppSecret
// 注意: access_token 接口要求调用方 IP 在公众号后台"IP 白名单"内,
// 详见 docs/wx-share-setup.md。
// ============================================================
import crypto from 'node:crypto'

const WX_API = 'https://api.weixin.qq.com'
const EXPIRE_MARGIN_MS = 300_000 // 提前 5 分钟刷新, 避免边界失效

export function wxConfig() {
  const appId = process.env.WECHAT_APP_ID || ''
  const secret = process.env.WECHAT_SECRET || ''
  return { appId, secret, configured: Boolean(appId && secret) }
}

class WxApiError extends Error {
  constructor(msg, errcode) {
    super(`微信接口错误(${errcode}): ${msg}`)
    this.errcode = errcode
  }
}

async function wxGet(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`微信接口 HTTP ${res.status}`)
  const data = await res.json()
  // 微信约定: 出错时 HTTP 仍是 200, body 里带 errcode/errmsg
  if (data.errcode && data.errcode !== 0) throw new WxApiError(data.errmsg, data.errcode)
  return data
}

// ---- access_token / jsapi_ticket 两级缓存(并发共享同一次刷新) ----

const tokenState = { value: '', expiresAt: 0, refreshing: null }
const ticketState = { value: '', expiresAt: 0, refreshing: null }

async function fetchAccessToken(appId, secret) {
  const data = await wxGet(
    `${WX_API}/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${secret}`
  )
  return { value: data.access_token, ttl: Number(data.expires_in || 7200) * 1000 }
}

async function fetchJsapiTicket(accessToken) {
  const data = await wxGet(
    `${WX_API}/cgi-bin/ticket/getticket?access_token=${accessToken}&type=jsapi`
  )
  return { value: data.ticket, ttl: Number(data.expires_in || 7200) * 1000 }
}

async function cached(state, refetch) {
  if (state.value && Date.now() < state.expiresAt) return state.value
  if (!state.refreshing) {
    state.refreshing = (async () => {
      const { value, ttl } = await refetch()
      state.value = value
      state.expiresAt = Date.now() + ttl - EXPIRE_MARGIN_MS
    })().finally(() => {
      state.refreshing = null
    })
  }
  await state.refreshing
  return state.value
}

async function getAccessToken(appId, secret, { forceRefresh = false } = {}) {
  if (forceRefresh) tokenState.expiresAt = 0
  return cached(tokenState, () => fetchAccessToken(appId, secret))
}

async function getJsapiTicket(appId, secret) {
  return cached(ticketState, async () => {
    // ticket 失效(40001/42001)时强制重取 access_token 再试一次
    try {
      const token = await getAccessToken(appId, secret)
      return await fetchJsapiTicket(token)
    } catch (e) {
      if (e instanceof WxApiError && (e.errcode === 40001 || e.errcode === 42001)) {
        const token = await getAccessToken(appId, secret, { forceRefresh: true })
        return await fetchJsapiTicket(token)
      }
      throw e
    }
  })
}

// ---- 签名 ----

export async function signUrl(rawUrl) {
  const { appId, secret } = wxConfig()
  if (!appId || !secret) {
    const err = new Error('微信 JS-SDK 未配置 WECHAT_APP_ID / WECHAT_SECRET。')
    err.status = 503
    throw err
  }

  const nonceStr = crypto.randomBytes(8).toString('hex')
  const timestamp = Math.floor(Date.now() / 1000)
  const ticket = await getJsapiTicket(appId, secret)
  const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${rawUrl}`
  const signature = crypto.createHash('sha1').update(raw, 'utf8').digest('hex')

  return { appId, timestamp, nonceStr, signature }
}
