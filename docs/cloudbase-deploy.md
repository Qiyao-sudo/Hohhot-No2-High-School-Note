# 国内全托管部署指南 · 腾讯云开发 CloudBase

把整站迁到腾讯云开发（CloudBase）：前端静态托管 + 文档助手云托管 + Waline 评论，
全部在**同一个云开发环境**里，免服务器运维，支持自有域名备案，国内直连。

```
浏览器 ──► CloudBase 静态托管(已备案域名 + HTTPS, CDN 加速)
                │  前端 ASSISTANT_API 指向云托管服务域名(后端已放行跨域)
                ▼
         云托管 CloudBase Run「assistant」服务(DeepSeek + 站内知识库, SSE 流式)
评论 ──► 云函数 Waline(同一环境, 已有部署, 见 waline-setup.md 方案一)
```

## 0. 前置与一次性准备

1. 腾讯云账号完成**实名认证**。
2. 控制台搜索「**云开发 CloudBase**」→ 开通并创建环境（**按量计费**，静态网站托管
   仅按量环境支持，自带免费额度），记下**环境 ID**（形如 `xxx-1gxxxxx`）。
   已有 Waline 的环境直接复用即可。
3. （可选，CI 自动化才需要）云开发控制台 → 环境 → **访问管理** → 创建 **API 密钥**，
   记录 `API Key ID` 与 `API Key`，作为 GitHub Actions Secrets。

## 1. 部署前端 → 静态网站托管

本地构建并上传 `docs/.vitepress/dist`（BASE 必须为根路径 `/`）：

```bash
# ASSISTANT_API 填第 2 步得到的云托管服务域名
BASE=/ ASSISTANT_API=https://assistant-xxxx.ap-shanghai.app.tcloudbase.com \
WALINE_SERVERURL=<你的Waline地址> npm run build
```

上传方式二选一：

- **控制台**：云开发 → 静态网站托管 → 上传文件夹 → 选中 `docs/.vitepress/dist` 全部内容；
- **CLI**：`npx @cloudbase/cli hosting deploy docs/.vitepress/dist / -e <环境ID>`

上传后得到默认域名 `https://<环境ID>.tcloudbase.com`，此时即可访问站点（免备案）。

## 2. 部署助手后端 → 云托管（CloudBase Run）

仓库已备好镜像定义 [server/Dockerfile](https://github.com/Qiyao-sudo/Hohhot-No2-High-School-Note/blob/main/server/Dockerfile)
（Node 20-alpine、端口 8787、内置 `/health` 健康检查），服务端知识库
`server/data/kb.mjs` 随仓库提交，无需构建步骤。

1. 云开发控制台 → **云托管** → 新建服务：
   - 服务名 `assistant`，部署方式选「**本地上传代码**」，目录选仓库的 `server/`
     （Dockerfile 在其根目录）；
   - **端口 8787**，CPU 0.25 核 / 内存 0.5GB（0.5 核 1GB 更从容）；
   - 副本策略：**最小实例数 0、最大 3**（无请求缩容到零，省钱；聊天有秒级冷启动，
     想要秒回可把最小实例数设 1，费用略增）；
   - 环境变量（在控制台配置，**不进入仓库**）：

     | 变量 | 值 |
     | --- | --- |
     | `DEEPSEEK_API_KEY` | `sk-...` |
     | `DEEPSEEK_MODEL` | `deepseek-v4-flash`（默认，可省） |
     | `ASSISTANT_RATE_ASK` | `30`（每 IP 每小时问答上限，可选） |

2. 部署完成后，服务设置 → **公网访问**：开启 HTTP 访问，得到服务默认域名，
   形如 `https://assistant-xxxxxxx.ap-shanghai.app.tcloudbase.com`。
   验证：浏览器打开 `<该域名>/health`，应返回 `"configured": true`。
3. 把该域名作为前端构建变量 `ASSISTANT_API` 重新构建上传（第 1 步已按此构建即可）。
   前端聊天请求已带 `Accept: text/event-stream` 头、后端每 15 秒发 SSE 注释行心跳，
   均已适配云托管网关的流式要求（网关要求该 Accept 头 + 空闲保活，否则 60 秒掐断），
   无需额外配置。

### 更新后端

代码或知识库更新后重新部署：控制台「部署新版本」（重传 `server/` 目录），
或 CI 自动发版（见第 5 节）。`server/data/kb.mjs` 随 `npm run build` 重建、
随 git 提交，重新部署即用新知识库。

## 3. 评论（Waline）

保持现状即可：Waline 已跑在同一环境的云函数上（[waline-setup.md](waline-setup.md)
方案一），前端构建变量 `WALINE_SERVERURL` 不变。评论管理后台 `<serverURL>/ui`
建议开启**先审后发**（审核后公开），既是备案下对「交互栏目」的合规要求，也防垃圾留言。

## 4. 自定义域名 + ICP 备案

云开发环境可直接作为**首次备案**的接入资源，无需购买云服务器，但须同时满足
[官方条件](https://docs.cloudbase.net/faq/security/icp)：

1. 环境套餐为**个人版及以上**（免费体验环境不支持备案）；
2. 环境**剩余有效期 ≥ 6 个月**（办理变更备案时会重新校验）；
3. 该环境已开启**云托管固定 IP**（付费功能，具体价格以控制台为准；每个环境可备案 2 个服务）。

流程：

1. 云开发控制台 → 环境 → **备案管理** → 按提示满足上述条件 → 「去备案」；
2. 腾讯云备案控制台拉取该环境作为接入资源，填写主体/网站信息、人脸核验、提交管局，
   一般 1–2 周；
3. **备案审核期间网站需暂停访问**（未备案域名不能解析）；备案通过后 30 日内完成
   **公安备案**（全国互联网安全管理服务平台）；
4. 回到云开发 → 静态网站托管 → **自定义域名**：绑定已备案域名并按提示配置证书
   （可申请腾讯云免费 DV 证书），开启 HTTPS；
5. 网站带留言板属交互功能，个别管局会关注——保留 Waline「先审后发」即可说明已落实内容审核。

> 备选：域名已在他处备案的，先在腾讯云做**新增接入备案（备案转入）**再绑定，否则会被拦截。

## 5. CI 自动化（可选）

仓库已带 [deploy-cloudbase.yml](https://github.com/Qiyao-sudo/Hohhot-No2-High-School-Note/blob/main/.github/workflows/deploy-cloudbase.yml)
工作流，手动触发即完成「构建 → 静态托管上传 → 云托管发版」。先在仓库
Settings → Secrets and variables → Actions 配置：

| Secret | 值 |
| --- | --- |
| `TCB_ENV_ID` | 云开发环境 ID |
| `TCB_API_KEY_ID` / `TCB_API_KEY` | 第 0 步创建的 API 密钥 |
| `CLOUDBASE_ASSISTANT_URL` | 云托管服务公网域名（如 `https://assistant-xxx.app.tcloudbase.com`） |
| `WALINE_SERVERURL` | 已有的 Waline 地址 |

之后每次 Actions → **Deploy CloudBase** → Run workflow 即可全量更新
（源文档的每日自动同步仍走 GitHub Actions，推送 main 后手动跑一次本工作流同步国内站）。

## 6. 成本概览

- 静态托管：存储 + CDN 流量按量计费，个人站量级每月几乎可忽略；
- 云托管：CPU/内存按秒计费，最小实例数 0 → 无请求不花钱；一次问答约几秒 × 0.25 核，
  学生量级每月几元内；固定 IP（备案所需）另计；
- DeepSeek：按 token 计费，flash 档每次问答约几厘钱，已内置每 IP 限流防刷。

## 7. 故障排查

| 现象 | 排查 |
| --- | --- |
| 前端显示「后端尚未配置」 | `<服务域名>/health` 是否返回 `configured:true`；控制台环境变量 `DEEPSEEK_API_KEY` 配置后是否**重新部署了版本** |
| 回答卡住 / 60 秒被掐断 | 确认前端用的是最新构建（fetch 带 `Accept: text/event-stream`）；服务重新部署一次以使用最新镜像 |
| 跨域报错 | 后端已返回 `Access-Control-Allow-Origin: *`；若仍报错，检查是否经其他网关/CDN 改写响应头 |
| 冷启动慢 | 把服务最小实例数改为 1（费用略增，首字更快） |
| 首次部署构建失败 | 确认上传目录是 `server/`（Dockerfile 需在其根），端口填 8787 |
