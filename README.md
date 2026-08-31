# 呼市二中学习生活指导 · 文档网站

基于腾讯文档[《呼市二中学习生活指导》](https://docs.qq.com/doc/DYm5PeUxOVmdEZmxs)构建的静态文档网站。

- **框架**：[VitePress](https://vitepress.dev/) 生成静态站点
- **评论**：[Waline](https://waline.js.org) 匿名模式（昵称必填、邮箱可选、免登录）
- **文档助手**：基于站内文档的 AI 问答（DeepSeek + RAG 检索，回答带引用来源可跳转），另有免 AI 的快速检索模式
- **部署**：后端 + 数据库免费部署在 Vercel / LeanCloud，站点托管在 GitHub Pages
- **同步**：源文档 → 网站自动同步（GitHub Actions 定时 + 手动触发），**含正文全部图片**（138 张，自动下载压缩到 `docs/public/images/` 并按原始位置嵌入）

## 目录结构

```
├── docs/                    # VitePress 站点根目录(内容页由脚本生成)
│   ├── .vitepress/
│   │   ├── config.ts        # 站点配置(BASE / Waline serverURL / 助手后端地址在此调整)
│   │   └── theme/           # 主题 + Waline 评论组件 + 文档助手聊天组件
│   ├── index.md             # 首页(手写, 不被同步覆盖)
│   ├── assistant/           # 文档助手独立页面(全站另有右下角浮动入口)
│   └── *.md                 # 各板块页面(由 sync_doc.py 生成)
├── server/                  # 文档助手后端(零依赖 Node 18+, 检索+DeepSeek+SSE)
├── api/assistant/           # Vercel Serverless 适配(同项目部署即获得后端)
├── scripts/
│   ├── sync_doc.py          # 腾讯文档抓取 → Markdown 转换
│   ├── build-kb.mjs         # docs/*.md → 助手知识库(server/data/kb.mjs)
│   └── outline.json         # 源文档真实标题大纲(层级权威来源)
├── .github/workflows/
│   ├── deploy.yml           # 定时/推送/手动: 同步 + 构建部署 GitHub Pages
│   └── manual-sync.yml      # 纯手动: 只同步源文档并提交(推送后自动触发部署)
└── docs/waline-setup.md     # Waline 后端部署指南(Vercel + LeanCloud)
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

本地构建带 Waline 评论：

```bash
WALINE_SERVERURL=https://<你的waline>.vercel.app npm run build
```

## 部署步骤（首次）

1. **推送仓库**：把本项目推到 GitHub（假设仓库名 `Hohhot-No2-High-School-Note`）。
2. **开启 Pages**：仓库 Settings → Pages → Source 选择 **GitHub Actions**。
3. **部署 Waline 后端**：按 [docs/waline-setup.md](docs/waline-setup.md) 在
   Vercel + LeanCloud 免费部署，得到 `serverURL`。
4. **配置 Secret**：仓库 Settings → Secrets and variables → Actions 添加
   `WALINE_SERVERURL = https://<你的waline>.vercel.app`。
5. **（可选）启用文档助手**：Vercel 项目环境变量加 `DEEPSEEK_API_KEY` 后，
   再在仓库 Secrets 加 `ASSISTANT_API = https://<你的vercel镜像>.vercel.app/api/assistant`。
   详见[文档助手部署指南](docs/assistant-setup.md)。
6. **触发部署**：Actions 页面手动运行 `Sync & Deploy`，或直接 push 代码。

## 手动同步源文档

源文档更新后想立即同步（不等每日定时）：仓库 **Actions → Manual Sync → Run workflow**。
该工作流只抓取源文档并提交推送；推送 `main` 会自动触发 `Sync & Deploy` 重建部署站点。
无内容变化时不产生提交，也不会触发部署。

## 国内部署（腾讯云，推荐）

`*.github.io` 域名在国内访问较慢。推荐把前端和后端都迁到腾讯云（一个账号、
免费额度起步、默认域名免备案、国内直连）：

### 前端：EdgeOne Pages

1. 腾讯云控制台 → **EdgeOne → Pages** → 创建项目，关联本 GitHub 仓库；
2. 构建设置：

   | 项 | 值 |
   | --- | --- |
   | 构建命令 | `npm run build` |
   | 输出目录 | `docs/.vitepress/dist` |
   | 环境变量 | `BASE=/`（站点部署在根路径） |

3. 部署完成后得到 `https://<项目名>.edgeonepages.com` 国内加速域名；
4. 若有 Waline 后端：在项目环境变量中再加 `WALINE_SERVERURL`（值同下方后端部署输出）；
5. 若要启用文档助手：再加 `ASSISTANT_API = https://<你的vercel镜像>.vercel.app/api/assistant`（助手后端随 Vercel 镜像自动部署，见[文档助手部署指南](docs/assistant-setup.md)）。

### 后端：云开发 CloudBase（Waline）

按 [docs/waline-setup.md](docs/waline-setup.md) 的方案一执行
`npx @waline/cloudbase` 一键部署，得到 `https://<环境ID>.tcloudbase.com`，
把该地址填入所有部署平台的环境变量 `WALINE_SERVERURL`。

> 三个部署源独立自动更新：GitHub Actions 推 Pages，EdgeOne Pages 与 Vercel
> 各自监听 main 分支构建，内容永远与源文档同步。GitHub 仓库仍是同步中枢
> （抓取源文档 + 自动提交），不会因国内部署而改变。

### 备选：Vercel 镜像

用 GitHub 账号登录 [Vercel](https://vercel.com) → 导入本仓库 → Deploy
（根目录 `vercel.json` 已配置好，`config.ts` 会自动切换 base）。
`vercel.app` 国内速度好于 github.io，但不如 EdgeOne Pages 稳定。

> 若仓库不是 `<user>.github.io`，`docs/.vitepress/config.ts` 中的 `BASE`
> 需与仓库名一致（默认 `/Hohhot-No2-High-School-Note/`）。

## 同步机制

| 方向 | 方式 | 说明 |
| --- | --- | --- |
| 源文档 → 网站 | 自动（每日）/ 手动（workflow_dispatch） | `sync_doc.py` 抓取腾讯文档正文并生成各页面 |
| 网站留言 → 源文档 | 手动整理 | 维护者从 Waline 后台（`<serverURL>/ui`）导出留言，粘贴回源文档“留言处” |

腾讯文档没有公开写入 API，所以“网站 → 源文档”方向为半自动（导出+粘贴）；
源文档“留言处”板块内容会完整同步到网站的[留言页](docs/messages.md)并与 Waline
评论并排展示。

## 已知限制

- **标题层级**以 `scripts/outline.json`（从腾讯文档 /p/ 发布页"大纲"面板提取的
  真实层级，共 89 条）为准；源文档新增标题后需重新提取大纲（打开
  `https://docs.qq.com/doc/p/f562ec68dbad4055a691e9676d26d82adf05aa4f`，
  展开"大纲"面板，复制 `.headline-text` 条目的 class 与文本到 outline.json），
  未收录的新标题按"关于X / Q&A / 中文序号"模式兜底识别为三级。
- **板块划分**跟随大纲二级标题（共 12 个板块 → 11 个页面，"更多Q&A"并入留言页）。
- 源文档中的**图片**已支持自动抓取嵌入（protobuf 解析图片锚点位置 + docimg
  CDN 下载，本地用 Pillow 压缩到宽 1000px，约 19MB）；**音频附件**无法匿名
  下载，以"📎 附件占位"标注并链回原文档。
- 源文档的复杂表格在转换后会退化为纯文本段落；加粗/颜色/高亮按字符精确保留。
- 腾讯文档使用内部接口，若其结构变更需同步更新 `scripts/sync_doc.py`。
