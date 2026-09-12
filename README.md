# 呼市二中学习生活指导 · 文档网站

基于腾讯文档[《呼市二中学习生活指导》](https://docs.qq.com/doc/DYm5PeUxOVmdEZmxs)构建的文档网站，
GitHub 每日自动同步源文档，**宝塔面板（Linux + PM2 + Nginx）**单机部署。

- **框架**：[VitePress](https://vitepress.dev/) 生成静态站点
- **文档助手**：基于站内文档的 AI 问答（DeepSeek + RAG 检索，回答带引用来源可跳转），另有免 AI 的快速检索模式
- **评论**：[Waline](https://waline.js.org) 匿名模式（未配置时显示友好提示，不影响其余功能）
- **部署**：宝塔 Linux 服务器，一个 Node 进程同时服务整站与助手 API（同源、无跨域），PM2 守护 + Nginx 反代
- **同步**：源文档 → GitHub 自动同步（每日定时 + 手动触发，含正文全部图片）；服务器每 6 小时自动跟进重建

## 部署架构

```
腾讯文档(全员可编辑)
   │  本机 npm run deploy 时抓取(每日也有 GitHub Actions 云端备份)
   ▼
本机构建(BASE=/, server + dist) ──SFTP 直传──► 宝塔服务器 /www/hs2/deploy
                                                │ 原子切换 + pm2 热重载 + 健康检查(失败自动回滚)
                                                ▼
                                   Nginx(:80/:443) ──反代──► node :8787
                                   (静态站 + 文档助手 API 同源单进程)
```

- **发布**：本机一条命令 `npm run deploy`（同步文档 → 构建 → 推送 → 热重载）；
- **云端备份**：GitHub Actions 每日同步源文档并做构建验证（服务器不依赖 GitHub）。

完整部署步骤（服务器一次性准备、Nginx SSE 反代、回滚与故障排查）见
**[docs/linux-deploy.md](docs/linux-deploy.md)**。

## 目录结构

```
├── docs/                    # VitePress 站点根目录(内容页由脚本生成)
│   ├── .vitepress/
│   │   ├── config.ts        # 站点配置(BASE / Waline / 助手后端地址)
│   │   └── theme/           # 主题 + Waline 评论组件 + 文档助手聊天组件
│   ├── index.md             # 首页(手写, 不被同步覆盖)
│   ├── assistant/           # 文档助手独立页面(全站另有右下角浮动入口)
│   └── *.md                 # 各板块页面(由 sync_doc.py 生成)
├── server/                  # 文档助手后端(零依赖 Node 18+; 同源模式兼托管整站)
├── scripts/
│   ├── sync_doc.py          # 腾讯文档抓取 → Markdown 转换
│   ├── build-kb.mjs         # docs/*.md → 助手知识库(server/data/kb.mjs)
│   ├── deploy.py            # 本机一键推送部署(构建+上传+热重载+回滚)
│   └── outline.json         # 源文档真实标题大纲(层级权威来源)
├── .github/workflows/
│   ├── deploy.yml           # 定时/推送: 同步源文档并提交 + 构建验证
│   └── manual-sync.yml      # 纯手动: 只同步源文档并提交
├── docs/linux-deploy.md     # 服务器部署指南(PM2 + Nginx + 自动同步)
├── docs/assistant-setup.md  # 文档助手配置(环境变量/费用/安全)
└── docs/waline-setup.md     # Waline 评论后端部署指南
```

## 本地开发

```bash
npm install
python scripts/sync_doc.py    # 从腾讯文档同步最新内容
npm run dev                   # 本地预览 http://localhost:5173
npm run build                 # 重建助手知识库 + 构建到 docs/.vitepress/dist
```

本地体验文档助手（可选）：

```bash
cp .env.example .env          # 填入 DEEPSEEK_API_KEY
npm run assistant             # 起后端 :8787, 再 npm run dev 即可在前端对话
```

## 功能配置

| 功能 | 说明 |
| --- | --- |
| 文档助手 | 部署与配置见 [docs/linux-deploy.md](docs/linux-deploy.md) 与 [docs/assistant-setup.md](docs/assistant-setup.md)；DeepSeek API Key 只存服务器环境变量，不进 git |
| 评论 | 按 [docs/waline-setup.md](docs/waline-setup.md) 部署 Waline，构建时注入 `WALINE_SERVERURL` 即启用；建议开启「先审后发」 |

## 手动同步源文档 / 发布

- **发布新版本**：本机执行 `npm run deploy`（自动同步最新文档 → 构建 → 推送服务器 → 热重载，详见 [docs/linux-deploy.md](docs/linux-deploy.md)）；
- **只同步文档不发布**：仓库 **Actions → Manual Sync → Run workflow**（GitHub 云端备份更新，不影响线上）。

## 同步机制

| 方向 | 方式 | 说明 |
| --- | --- | --- |
| 源文档 → 本机/GitHub | `npm run deploy` 时自动 / GitHub Actions 每日备份 | `sync_doc.py` 抓取腾讯文档正文并生成各页面 |
| 本机 → 服务器 | `npm run deploy` 手动一键 | 原子切换 + 健康检查, 失败自动回滚 |
| 网站留言 → 源文档 | 手动整理 | 维护者从 Waline 后台导出留言，粘贴回源文档"留言处" |

腾讯文档没有公开写入 API，所以"网站 → 源文档"方向为半自动（导出+粘贴）。

## 已知限制

- **标题层级**以 `scripts/outline.json`（从腾讯文档 /p/ 发布页"大纲"面板提取的
  真实层级，共 89 条）为准；源文档新增标题后需重新提取大纲（打开
  `https://docs.qq.com/doc/p/f562ec68dbad4055a691e9676d26d82adf05aa4`，
  展开"大纲"面板，复制 `.headline-text` 条目的 class 与文本到 outline.json），
  未收录的新标题按"关于X / Q&A / 中文序号"模式兜底识别为三级。
- **板块划分**跟随大纲二级标题（共 12 个板块 → 11 个页面，"更多Q&A"并入留言页）。
- 源文档中的**图片**已支持自动抓取嵌入（protobuf 解析图片锚点位置 + docimg
  CDN 下载，本地用 Pillow 压缩到宽 1000px，约 19MB）；**音频附件**无法匿名
  下载，以"📎 附件占位"标注并链回原文档。
- 源文档的复杂表格在转换后会退化为纯文本段落；加粗/颜色/高亮按字符精确保留。
- 腾讯文档使用内部接口，若其结构变更需同步更新 `scripts/sync_doc.py`。
