# 文档助手部署指南

文档助手是本站的 AI 问答功能：基于站内全部文档构建知识库（RAG 检索），调用
[DeepSeek](https://platform.deepseek.com) 生成带引用来源的回答，并支持不经过 AI
的直接检索定位。由三部分组成：

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| 前端 | `docs/.vitepress/theme/Assistant*.vue` + `/assistant/` 页面 | 聊天界面、引用角标、来源跳转、全站浮动入口 |
| 后端 | `server/`（零依赖 Node 18+） | 中文检索、拼装提示词、调用 DeepSeek、SSE 流式转发、每 IP 限流 |
| 知识库 | `scripts/build-kb.mjs` → `server/data/kb.mjs` | 构建时从 `docs/*.md` 生成，随 `npm run build` 自动更新 |

API Key **只保存在后端环境变量**，永远不会进入前端构建产物（前端只存后端地址）。

---

## 一、本地开发

```bash
# 1. 配置密钥(复制模板并填入 DeepSeek API Key)
cp .env.example .env    # Windows: copy .env.example .env

# 2. 启动后端(默认 8787 端口, 自动读取 .env)
npm run assistant

# 3. 另开终端启动前端(config.ts 会自动读取 .env 里的 ASSISTANT_API)
npm run dev
```

打开 `http://localhost:5173/assistant/` 即可对话。

DeepSeek API Key 在[开放平台](https://platform.deepseek.com)注册后创建，
`deepseek-v4-flash` 为性价比档，也可用 `DEEPSEEK_MODEL` 换成其他型号。

## 二、生产部署

> **国内推荐：腾讯云开发 CloudBase 全托管**——前端静态托管 + 助手后端云托管
> （`server/Dockerfile` 已备好，SSE 已适配云托管网关）+ Waline 同环境，支持自有域名
> ICP 备案，无需服务器运维。完整步骤见
> [国内全托管部署指南](cloudbase-deploy.md)。下面两个方案适合海外/镜像/自建服务器场景。

### 方案一（推荐）：Vercel 同项目部署

本仓库已含 `api/assistant/[...route].js`（Vercel Serverless 函数）。**前端镜像所在的
Vercel 项目**重新部署后即自动获得 `/api/assistant/*` 后端，前端默认就指向同源地址，零配置。

1. Vercel 项目 → Settings → Environment Variables 添加：

   | 变量 | 值 |
   | --- | --- |
   | `DEEPSEEK_API_KEY` | `sk-...` |
   | `DEEPSEEK_MODEL` | `deepseek-v4-flash`（可选，默认即它） |

2. Redeploy 一次即可。验证：访问 `https://<项目>.vercel.app/api/assistant/health`
   应返回 `"configured": true`。

3. 若前端主站部署在 **GitHub Pages**：仓库 Settings → Secrets → Actions 添加
   `ASSISTANT_API = https://<项目>.vercel.app/api/assistant`（deploy.yml 已预留该变量）。

4. 若前端主站部署在 **EdgeOne Pages**：项目环境变量中添加同样的 `ASSISTANT_API`。

未配置 Key 时站点不受影响——助手页面会显示「尚未配置」的友好提示
（与评论区未配置时的行为一致）。

### 方案二：独立部署后端

适合放在自有服务器 / 内网 / 其他 Serverless 平台（需 Node 18+，无任何 npm 依赖）：

```bash
DEEPSEEK_API_KEY=sk-... PORT=8787 node server/index.mjs
```

Nginx 反向代理时**必须关闭缓冲**，否则 SSE 流式回答会卡成一坨一次吐出：

```nginx
location /api/assistant/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_buffering off;
    proxy_read_timeout 120s;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

然后把前端的 `ASSISTANT_API` 指向 `https://你的域名/api/assistant`。

### 方案三：云服务器单进程同源部署（无需 Nginx）

`server/` 自带静态托管：把构建产物放在 `server/../dist`（或设 `STATIC_ROOT`），
**一个 Node 进程同时服务整站和 API**，前端用同源默认值 `/api/assistant`，零跨域、零 Nginx：

```bash
# 1. 构建同源版前端(不设 ASSISTANT_API 即默认 /api/assistant)
BASE=/ npm run build
mkdir deploy && cp -r server deploy/ && mkdir deploy/dist && cp -r docs/.vitepress/dist/. deploy/dist/

# 2. 服务器上(以 C:\hs2 为例, Windows 计划任务/RSS/Linux systemd 守护)
cd C:\hs2\server
node --env-file=.env index.mjs   # .env 写 DEEPSEEK_API_KEY=... PORT=80
```

- 构建时**不要设 `ASSISTANT_API`**（默认同源 `/api/assistant` 即命中本进程）；
- `--env-file` 需要 Node 20.6+（`--env-file-if-exists` 需要 22.9+，注意版本）；
- 静态资源带哈希的 `assets/*` 自动长缓存，HTML 协商缓存；
- 更新站点 = 重新构建覆盖 `dist/` + 重启进程。

## 三、环境变量一览

| 变量 | 默认值 | 作用域 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | （无，必填） | 后端 |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | 后端 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 后端 |
| `DEEPSEEK_TEMPERATURE` | `0.3` | 后端 |
| `DEEPSEEK_MAX_TOKENS` | `2000` | 后端 |
| `ASSISTANT_RATE_ASK` | `30`（次/小时/IP） | 后端 |
| `ASSISTANT_RATE_SEARCH` | `120`（次/小时/IP） | 后端 |
| `PORT` | `8787` | 后端（独立部署） |
| `ASSISTANT_API` | `/api/assistant`（同源） | **前端构建** |

## 四、知识库更新

知识库在构建时生成，不需要单独维护：

- `npm run build` 会先执行 `node scripts/build-kb.mjs` 重建知识库；
- 每日自动同步 / Manual Sync 工作流提交 `docs/*.md` 时会一并重建并提交
  `server/data/kb.mjs`，随后部署时后端自动使用新内容。

## 五、费用与安全提示

- flash 档模型按 token 计费，一次典型问答约 2-3k token（约几厘钱）；后端已内置
  每 IP 每小时 30 次问答 / 120 次检索的限流，可按需调整上面的环境变量。
- API Key 泄露后请立即到 DeepSeek 平台删除重建；本仓库 `.env` 已被 gitignore，
  **任何情况下都不要把 Key 写进代码或提交到仓库**。
- 公网部署后建议偶尔查看 DeepSeek 控制台的用量曲线，确认没有异常刷量。
