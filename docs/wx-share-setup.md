# 微信分享卡片(JS-SDK)接入指南

在微信里把本站分享给朋友/朋友圈时, 默认卡片是微信自动抓取的网页内容,
标题摘要不可控、缩略图经常缺失。本文档描述的自定义分享卡片流程:
**用户在微信内打开站点 → 前端向后端要当前页面 URL 的 JS-SDK 签名 →
`wx.config` 验签 → `wx.updateAppMessageShareData / updateTimelineShareData`
写入标题、摘要、缩略图**。

代码位置(已实现, 只需配置即可启用):

| 端 | 文件 | 职责 |
| --- | --- | --- |
| 后端 | `server/lib/wx.mjs` | access_token / jsapi_ticket 进程内缓存(提前 5 分钟刷新), SHA1 签名 |
| 后端 | `server/lib/app.mjs` | `GET /wx-signature?url=页面URL` 路由(限流 240 次/IP/小时, `ASSISTANT_RATE_WX` 可调) |
| 前端 | `docs/.vitepress/theme/wxShare.ts` | 检测微信 UA → 加载 jweixin → 签名/config → 设置分享内容; SPA 路由切换自动重签 |
| 资源 | `docs/public/share-card.png` | 默认缩略图(300×300 品牌蓝), 可直接替换成校徽等正式图 |

## 0. 前提条件(重要)

- **微信认证服务号**: 只有认证的服务号有 `updateAppMessageShareData` 权限;
  个人订阅号/未认证账号不行。在 公众号后台 → 设置与开发 → 接口权限 里
  确认"分享接口"可用。
- **已备案域名并解析到服务器**: JS 接口安全域名只接受域名, 纯 IP 访问无法配置
  (域名备案流程见 `docs/linux-deploy.md` 第 9 节)。

## 1. 公众号后台配置(一次性, 约 10 分钟)

1. **JS 接口安全域名**: 设置与开发 → 公众号设置 → 功能设置 →
   JS 接口安全域名 → 填 `hs2z.inknook.ink`(不带 `http://`)。微信要求先下载校验文件
   `MP_verify_xxxx.txt` 放到域名根目录:
   ```bash
   # 本机: 把下载的文件放进 docs/public/(构建后会出现在站点根)
   cp ~/Downloads/MP_verify_xxxx.txt docs/public/
   npm run deploy -- --no-sync
   # 验证: 浏览器打开 https://hs2z.inknook.ink/MP_verify_xxxx.txt 能看到内容
   ```
   然后再回公众号后台点保存。
2. **IP 白名单**: 设置与开发 → 基本配置 → IP 白名单 → 加入服务器公网 IP
   (即 `DEPLOY_HOST` 的值; 服务器出口 IP 与之不同时以微信报错提示的 IP 为准)。
   不加白名单, 后端换 access_token 会报 `errcode 40164`。
3. **获取密钥**: 同页"开发者密码(AppSecret)" → 启用并记下
   (忘了就重置); AppID 在页面顶部。

## 2. 填写密钥并部署

本机仓库根目录 `.env`:

```ini
WECHAT_APP_ID=wx你的AppID
WECHAT_SECRET=你的AppSecret
```

然后照常 `npm run deploy`。部署脚本会自动把这两个值注入服务器
`ecosystem.config.js`(与 DEEPSEEK_API_KEY 同机制)并热重载。

验收:

```bash
curl http://127.0.0.1:8787/health        # 服务器上: "wx":true
curl 'https://hs2z.inknook.ink/api/assistant/wx-signature?url=https%3A%2F%2Fhs2z.inknook.ink%2F'
# → {"ok":true,"appId":"...","timestamp":...,"nonceStr":"...","signature":"..."}
```

手机微信打开站点任意页面 → 右上角"..."→ 发送给朋友, 卡片应显示
"页面标题 · 呼市二中学习生活指导"+摘要+蓝色缩略图。

## 3. 自定义各页面的分享内容

分享内容按页取值, 无需改代码:

```yaml
--- # docs/xxx.md 页首 frontmatter
title: 入学准备全览            # 分享标题(自动拼站名后缀)
description: 报到流程、物品清单与分班考须知   # 分享摘要
shareImage: /images/xxx.png   # 可选: 本页专属缩略图(正方形 ≥300px)
---
```

缩略图要求: **PNG/JPG(不支持 SVG/WebP)、正方形、≥300×300、公网可直接访问**。
全站默认图 `docs/public/share-card.png` 直接覆盖同名文件即可换图。

## 4. 排障速查

| 现象 | 原因与处理 |
| --- | --- |
| 分享卡片仍是默认抓取内容 | 依次确认: 是不是认证服务号; JS 安全域名已配置且校验文件可访问; `/health` 的 `"wx":true`; 微信开发者工具里看控制台 `[wx-share]` 告警 |
| `config:invalid signature` | 签名 URL 与当前页不一致。前端已处理 iOS(入口 URL)/Android(当前 URL)差异; 若站点经 Nginx 改写了 URL(重定向/加路径), 保证浏览器地址栏 URL 与传给签名接口的一致 |
| 后端日志 `errcode 40164` | 服务器出口 IP 不在公众号 IP 白名单, 按报错里的 IP 补白名单 |
| `errcode 40001/40125` | AppSecret 错误或已重置, 核对 `.env` 重新 deploy |
| `errcode 48001` | 该公众号无分享接口权限(非认证服务号) |
| 本地 dev 测试 | 微信开发者工具 → 公众号网页项目 → 跑 `npm run dev` 后用局域网地址打开; 签名 URL 域名仍须在 JS 安全域名内 |

> 降级行为: 未配置密钥或签名失败时, 前端只打 console 警告, 不影响站点任何
> 其他功能; 分享退回微信默认抓取。临时调试签名问题可把 `wxShare.ts` 里
> `wx.config({ debug: false ... })` 改成 `true`, 微信内会弹出验签结果。
