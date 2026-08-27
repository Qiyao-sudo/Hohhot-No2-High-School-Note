# Waline 评论后端部署指南

本站留言区使用 [Waline](https://waline.js.org)，匿名模式（免登录，昵称必填、邮箱可选）。

后端（免费部署在 Vercel）+ 数据库（免费使用 LeanCloud 国际版）的整体架构：

```
浏览器 → GitHub Pages(静态站点, 内嵌 Waline 前端)
             ↓ 评论 API
         Vercel(Waline Server, 免费)
             ↓ 存储
         LeanCloud 国际版(免费开发版数据库)
```

## 一、创建 LeanCloud 数据库（免费）

1. 注册 [LeanCloud 国际版](https://console.leancloud.app/)（国际版免费额度不需要绑定域名备案）。
2. 创建一个应用（例如 `waline`），选择**开发版（免费）**。
3. 进入 **设置 → 应用凭证**，记下 `AppID`、`AppKey`、`Master Key`（后面要用）。

## 二、部署 Waline Server 到 Vercel（免费）

1. 打开 Waline 官方一键部署：
   <https://vercel.com/new/clone?repository-url=https://github.com/walinejs/waline/tree/main/example>
2. 在部署配置中添加环境变量（也可以部署后在 Vercel 项目 Settings → Environment Variables 中补填）：

   | 变量名 | 值 |
   | --- | --- |
   | `LEAN_ID` | LeanCloud 的 AppID |
   | `LEAN_KEY` | LeanCloud 的 AppKey |
   | `LEAN_MASTER_KEY` | LeanCloud 的 Master Key |
   | `LOGIN` | `anonymous`（匿名模式，免登录） |
   | `REQUIRED_META` | `["nick"]`（昵称必填，邮箱可选） |
   | `SECURE_DOMAINS` | 你的站点域名（如 `xxx.github.io`） |

3. 部署完成后会得到一个 `https://<项目名>.vercel.app` 地址，这就是 `serverURL`。

> 也可以用数据库：Vercel Postgres / Supabase 免费版替代 LeanCloud，参考
> [Waline 官方文档 · 数据库](https://waline.js.org/guide/database/)。

## 三、把 serverURL 配置进站点

1. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加 Secret：

   - Name: `WALINE_SERVERURL`
   - Value: `https://<你的waline项目>.vercel.app`

2. 重新运行 `Sync & Deploy` workflow（或在本地 `WALINE_SERVERURL=... npm run build`）。
3. 站点 `docs/.vitepress/config.ts` 中的默认值也会注入，本地开发可直接改默认值。

评论管理后台：访问 `https://<你的waline项目>.vercel.app/ui`，首次进入注册的
账号即为管理员，可审核/删除留言。

## 四、留言与源文档同步

- **源文档 → 网站（自动）**：`scripts/sync_doc.py` 每次运行都会抓取腾讯文档
  “留言处”板块，写入留言页面和 `doc-messages.json`，GitHub Actions 每天定时执行。
- **网站 → 源文档（手动整理）**：腾讯文档没有公开写入 API，网站留言由维护者
  定期从 Waline 管理后台（`/ui`）导出，整理后粘贴回源文档留言区。建议每周一次。
