# AGENTS.md — 呼市二中学习生活指导 · 站点与文档助手

基于腾讯文档《呼市二中学习生活指导》的 VitePress 文档站 + AI 文档助手（DeepSeek RAG + 识图）+ 自建审核制评论区，部署在宝塔 Linux 服务器（PM2 + Nginx 同源单进程）。线上地址 `https://hs2z.inknook.ink`。

## 目录结构

- `docs/` — VitePress 站点根。`*.md` 内容页由 `scripts/sync_doc.py` 生成（勿手改，会被同步覆盖）；`index.md` 手写
- `docs/.vitepress/theme/` — 主题组件（AssistantChat 聊天、CommentSection 评论区、SiteFooter 页脚、ImageLightbox 全局灯箱等）；`config.ts` 构建时注入 `__ASSISTANT_API__`（助手与评论区共用）
- `docs/public/images/` — 源文档图片，文件名 = 源 URL 的 md5 前 16 位（内容变则名变，天然缓存键）
- `server/` — 后端，**零依赖 Node 18+**（只用全局 fetch 与 node 内置模块，禁止引入 npm 依赖）；`lib/` 为路由/检索/提示词/限流/评论存储（`comments.mjs`），`data/kb.mjs` 为生成的知识库；审核 JSON API 由独立统一后台调用
- `scripts/` — `sync_doc.py`（腾讯文档抓取）、`caption-images.mjs`（视觉模型生成图片描述）、`build-kb.mjs`（docs → kb.mjs）、`deploy.py`（一键部署）、`e2e-assistant.mjs` / `e2e-comments.mjs`（端到端测试）
- `.env` — DEEPSEEK_API_KEY + COMMENT_ADMIN_PASSWORD + 部署 SSH 配置，**永不进 git，永不写入任何提交文件**（AGENTS.md 里也不要写服务器 IP/密码/管理密码）

## 常用命令

```bash
python scripts/sync_doc.py        # 同步腾讯文档(含图片下载)
npm run caption                   # 视觉模型补图片描述(增量; 无 Key 自动跳过)
npm run build:kb                  # 重建知识库 server/data/kb.mjs
npm run build                     # caption + build:kb + vitepress build
npm run dev                       # 本地预览 :5173
npm run assistant                 # 起后端 :8787(自动读 .env)
npm run deploy                    # 一键上线(同步→构建→上传→热重载→健康检查)
python scripts/deploy.py --no-sync    # 跳过文档同步的部署
node scripts/e2e-assistant.mjs    # 助手 e2e(需先起 8787 后端 + 4179 预览)
node scripts/e2e-comments.mjs     # 评论 e2e(自包含, 独立端口+临时数据, 直接跑)
```

## 部署铁律（本项目最重要的坑）

**永远不要在 Git Bash 里手动 `npm run build` 后用 `deploy.py --skip-build` 推线上**。两个已发生过的生产事故：

1. `config.ts` 会读 `.env`，把本地开发的 `ASSISTANT_API=http://localhost:8787` 烤进前端 bundle → 线上页脚统计消失、助手不可用。
2. MSYS 路径转换：`BASE=/ npm run build` 中 `BASE=/` 会被转成 `C:/Program Files/Git` → 全站 JS/CSS 引用损坏。

正确做法：走 `deploy.py` 完整流程（它内部用受控环境 `BASE=/ ASSISTANT_API="" MSYS_NO_PATHCONV=1` 构建）。若必须手动构建本地测试版：`MSYS_NO_PATHCONV=1 ASSISTANT_API=http://localhost:8787 npm run build`。`deploy.py` 打包前有防呆扫描（dist 代码 JS 里出现 localhost/127.0.0.1 直接拒绝部署），不要绕过它。

其他环境坑：

- `vitepress preview` 启动时缓存文件树——重建 dist 后必须重启 preview，否则新资源 404
- Git Bash 里 `curl -d` 直接传中文会乱码，后端检索词全废；要用 UTF-8 文件 + `--data-binary @file`
- 本机 git 报 dubious ownership（仓库属主与当前用户不一致），需要 `git config --global --add safe.directory 'D:/Project/Hohhot No2 High School Note'` 才能提交

## 架构边界

**知识库流水线**：`sync_doc.py` → `docs/*.md` + 哈希图片 → `caption-images.mjs` → `server/data/image-captions.json`（随 git 提交，CI 无 Key 也能带描述构建；脚本手动解析 .env 以兼容 Node 18/20）→ `build-kb.mjs` → `server/data/kb.mjs`（chunks 含 `images:[{url,alt}]`，描述文本以「[图片] …」混入正文供检索）。`build-kb.mjs` 的 slugify 逐字符复刻 VitePress markdown-it-anchor 规则（含同页去重 -1/-2），改动会破坏引用跳转锚点。

**助手回答链路**：`/ask` → BM25 检索 6 块（中文 bigram 分词，与站点本地搜索保持一致）→ 命中图片时附原图给模型（识图：每次 ≤3 张、每块 ≤2 张、单图 ≤2.5MB，`ASSISTANT_VISION=0` 关闭）→ `prompt.mjs` 的规则含图片引用规范（地址必须原样复制、不同活动不得说"日期不一致"、角标位置在句内）→ SSE 流式转发。`deepseek-v4-flash` 是思考型模型，`max_tokens` 默认 3000（思考链计入，勿调小）。

**限流双层**：每分钟（ask 5 / search 20，防突发盗刷）+ 每小时（ask 30 / search 120，总量兜底），环境变量 `ASSISTANT_RATE_*[_MIN]` 可覆盖。限流检查在模型调用之前，被拦请求不产生 API 费用。

**评论区（审核制）**：前端 `CommentSection.vue` 只在 `comment: true` 页面（留言处）挂载；`POST /comment` 提交即 pending，`GET /comments` 只见 approved（响应不含 ip）；旧 `/admin` 页面已下线，统一后台通过 `POST /admin/login`（恒时比较，3次/分防爆破）+ `/admin/comments` `/admin/comment` JSON API 审核（无状态 HMAC token，7 天有效，改密码即全部失效）。存储为部署根目录 `comments.db`（SQLite，`node:sqlite` 内置模块，零 npm 依赖；WAL 模式，每次写即时落盘，原子切换部署不覆盖）；首次启动发现旧 `comments.json` 会自动导入并把原文件改名 `.migrated-<日期>` 留档。内容原样存储、前端纯文本插值渲染（无 v-html），防 XSS 不靠过滤靠转义。

**AI 初审（社区设置可开关，默认开启）**：`POST /comment` 先过昵称联系方式正则（常开，命中直接 400 拒绝提交，不进队列不耗 AI），再过敏感词（`settings` 表 `blockedWords`，命中直接人工待审），未命中且开启初审时调用 DeepSeek（`lib/ai-review.mjs`，非流式、12s 超时、永不抛异常）判定：`approve` → 直接落库 `approved` 自动公开；`reject` → 落库 `rejected`（真驳回，管理员可在「已驳回」救回）；`error`/`skip`（失败/未配 Key/未开启）→ `pending` 人工待审。响应带 `status`，前端据此分流：通过 → 立即重载列表直接显示；驳回 → 表单提示「留言审核被驳回。」（不向提交者透露原因，判定与理由仅存 `ai_json` 供管理端徽标展示）；待人工 → 提示已提交待审核。**前端没有本地「审核中」卡片**（相关 localStorage 机制已删除）。提示词要求 AI 兜底检查昵称中的联系方式变体（谐音/符号拆写/缩写，正则拦不到的）。设置与试审接口：`GET|POST /admin/settings`、`POST /admin/settings/test`（统一后台「社区设置」页使用，经 BFF `/api/comments/settings*` 透传）。

**大模型按用途选择**（统一后台「社区设置 → AI 模型」）：`lib/llm-settings.mjs` 管理模型列表与用途选择，存 comments.db 的 `settings` 表（`llm_models`/`llm_selection`）；`llmConfig('assistant'|'review')` 解析生效配置（所选模型凭据齐全→用之，否则回落环境变量 DEEPSEEK_*），`streamChat` 接受 `config` 透传，`ai-review` 走 `llmConfig('review')`，`/ask` 走 `llmConfig('assistant')`，切换即时生效无需重启。API Key 只入服务器库，`GET /admin/llm` 仅回显掩码（`sk-d0…0b65`）；管理路由 `GET /admin/llm`、`POST /admin/llm/models|models/delete|select`（经 BFF `/api/comments/llm*` 透传）。

**点赞与回复契约（已实现）**：点赞与用户间回复已在后端上线，前端无需改动即自动点亮。`GET /comments` 响应带 `capabilities: { likes: true, replies: true }`、`comments[i].likes: number`、`comments[i].replyTo: { id, nick } | null`（父评论被驳回/删除时公开列表解析为 null，管理列表解析任意状态父评论）。`POST /comment/like { id } → { ok, likes }`：`comment_likes` 表按 (评论 id, IP) 主键幂等，同一 IP 重复点赞不重复计数，叠加限流 `COMMENT_RATE_LIKE_MIN`(默认 20/分) / `COMMENT_RATE_LIKE`(默认 120/时)。`POST /comment` 请求体支持可选 `replyTo`（被回复评论 id，需已存在；回复同样进初审流）；删除评论时其子回复的引用会被清空避免悬空。**前端楼层嵌套**：`CommentSection` 的 `threads` computed 沿 replyTo 链把全部后代归并到根评论的卡片内（`CommentItem` 递归自嵌套，子卡片轻量样式：无独立边框、浅底、小头像、左竖线缩进；直评楼主不显示“回复 @”行，楼中楼互回保留；根未加载的回复平铺兜底），按时间正序排列。

**前端流式渲染**（AssistantChat.vue）：消息对象必须 `reactive()` 包裹再 push（普通对象 push 后异步修改不触发渲染）；逐字输出由 30ms 推进循环驱动（追赶式步长）；消息列表禁用 `scroll-behavior: smooth`（会与高频跟随打架）；来源卡片只在 `!streaming` 时淡入。全局灯箱是事件委托，聊天内图片自动复用。

## 约定

- 注释、文档、用户可见文案用简体中文；回答正文关键数字加粗、引用角标 `[[n]]`
- 改动 server 端代码无需重建前端，`deploy.py --skip-build --no-sync` 即可；改动前端必须完整构建
- 服务器上 `sync.sh` 每 6 小时自动同步重建；GitHub Actions 每日备份（Node 20，无 Key，caption 无害跳过）
- 敏感区改动前先读：`docs/linux-deploy.md`（Nginx SSE 反代必须 `proxy_buffering off`）、`assistant-setup.md`（全部环境变量）、`README.md`（同步机制与已知限制）
