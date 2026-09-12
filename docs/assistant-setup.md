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

### 方案一（推荐）：宝塔 Linux 同源单进程

一个 Node 进程同时服务**整站静态文件 + 助手 API**（默认同源 `/api/assistant`，
零跨域、零额外组件），PM2 守护、Nginx 反代含 SSE 流式配置、每 6 小时自动同步
GitHub、失败保底回滚——完整步骤见 **[linux-deploy.md](linux-deploy.md)**。

要点速记：

```bash
BASE=/ npm run build      # 构建同源版前端(必须 BASE=/)
# PM2: cwd=deploy/server, 环境变量 DEEPSEEK_API_KEY + PORT=8787 + HOST=127.0.0.1
# Nginx 反代 127.0.0.1:8787, 必须 proxy_buffering off(SSE 流式)
```

### 方案二：任意平台独立部署后端

适合非宝塔的自有服务器 / 内网 / 其他容器平台（需 Node 18+，无任何 npm 依赖）：

```bash
DEEPSEEK_API_KEY=sk-... PORT=8787 node server/index.mjs
```

前端构建时通过 `ASSISTANT_API` 指向后端地址（跨域已放行）。若经 Nginx 反代，
**必须关闭缓冲**，否则流式回答会卡成一坨一次吐出：

```nginx
location /api/assistant/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_buffering off;
    proxy_read_timeout 120s;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

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
| `PORT` | `8787` | 后端 |
| `HOST` | `0.0.0.0`（Nginx 反代场景建议 `127.0.0.1`） | 后端 |
| `STATIC_ROOT` | `<server>/../dist`（同源托管静态站） | 后端 |
| `ASSISTANT_API` | `/api/assistant`（同源默认，无需设置） | **前端构建** |

## 四、知识库更新

知识库在构建时生成，不需要单独维护：

- `npm run build` 会先执行 `node scripts/build-kb.mjs` 重建知识库；
- 服务器的 `sync.sh` 每次同步都会重新构建，部署即用新知识库。

## 五、费用与安全提示

- flash 档模型按 token 计费，一次典型问答约 2-3k token（约几厘钱）；后端已内置
  每 IP 每小时 30 次问答 / 120 次检索的限流，可按需调整上面的环境变量。
- API Key 泄露后请立即到 DeepSeek 平台删除重建；本仓库 `.env` 已被 gitignore，
  **任何情况下都不要把 Key 写进代码或提交到仓库**。
- 公网部署后建议偶尔查看 DeepSeek 控制台的用量曲线，确认没有异常刷量。
