# Waline 评论后端部署指南

本站留言区使用 [Waline](https://waline.js.org)，匿名模式（免登录，昵称必填、邮箱可选）。

## 方案一（推荐）：腾讯云开发 CloudBase（国内直连）

Waline 官方提供云开发模板，**纯网页操作、约 5 分钟**，云函数 + 云数据库
都在腾讯云国内节点，默认域名（`*.tcloudbase.com`）免备案、国内访问快，
个人免费额度足够使用。

1. 在 [腾讯云](https://cloud.tencent.com) 完成实名认证（学生可实名），
   开通**云开发 CloudBase**（控制台搜索"云开发"）。

2. 打开 Waline 官方部署页，点击页面上的一键部署按钮：
   <https://waline.js.org/guide/deploy/cloudbase.html>

   - 跳转到腾讯云开发后，选择已有应用或**新建应用**；
   - 点击 **下一步: 应用配置** → **完成**，自动进入部署（约 3-5 分钟）；
   - 部署完成后点击 **访问** 按钮，浏览器里打开的地址就是 serverURL，
     形如 `https://<环境ID>.tcloudbase.com`。

3. 设置环境变量（可选但建议）：云开发控制台 → 该应用的环境 →
   **云函数 → 函数配置 → 环境变量**，添加：

   | 变量名 | 值 |
   | --- | --- |
   | `LOGIN` | `anonymous` |
   | `REQUIRED_META` | `["nick"]` |
   | `SECURE_DOMAINS` | 你的站点域名（如 `xxx.edgeonepages.com`、`xxx.github.io`） |

4. 记下 serverURL，按下方「把 serverURL 配置进站点」操作。

评论管理后台：访问 `<serverURL>/ui`，首次进入注册的账号即为管理员，
可审核/删除留言。

## 方案二（备选）：Vercel + LeanCloud 国际版

国际免费方案，海外访问快、国内较慢。架构：

```
浏览器 → 站点(静态) → Waline Server(Vercel) → 数据库(LeanCloud 国际版)
```

1. 注册 [LeanCloud 国际版](https://console.leancloud.app/)，创建应用（开发版免费），
   记下 **设置 → 应用凭证** 中的 `AppID`、`AppKey`、`Master Key`。

2. 打开 Waline 官方一键部署：
   <https://vercel.com/new/clone?repository-url=https://github.com/walinejs/waline/tree/main/example>

3. 部署配置中填环境变量：

   | 变量名 | 值 |
   | --- | --- |
   | `LEAN_ID` | LeanCloud 的 AppID |
   | `LEAN_KEY` | LeanCloud 的 AppKey |
   | `LEAN_MASTER_KEY` | LeanCloud 的 Master Key |
   | `LOGIN` | `anonymous` |
   | `REQUIRED_META` | `["nick"]` |
   | `SECURE_DOMAINS` | 你的站点域名 |

4. 得到 `https://<项目名>.vercel.app`，这就是 serverURL。

## 把 serverURL 配置进站点

站点在构建时通过环境变量 `WALINE_SERVERURL` 注入评论后端地址，各部署平台分别配置：

- **腾讯云 EdgeOne Pages**（国内前端）：项目设置 → 环境变量，添加 `WALINE_SERVERURL`。
- **GitHub Pages**：仓库 Settings → Secrets and variables → Actions，
  添加 Secret `WALINE_SERVERURL`，重新运行 `Sync & Deploy`。
- **Vercel**（镜像）：项目 Settings → Environment Variables，添加同名变量。
- **本地开发**：`WALINE_SERVERURL=... npm run dev`，或直接改
  `docs/.vitepress/config.ts` 中的默认值。

未配置前，留言页评论区会显示「评论区后端尚未配置」的提示条，站点其余功能不受影响。

## 留言与源文档同步

- **源文档 → 网站（自动）**：`scripts/sync_doc.py` 每次运行都会抓取腾讯文档
  "留言处"板块，写入留言页面和 `doc-messages.json`，GitHub Actions 每天定时执行。
- **网站 → 源文档（手动整理）**：腾讯文档没有公开写入 API，网站留言由维护者
  定期从 Waline 管理后台（`/ui`）导出，整理后粘贴回源文档留言区。建议每周一次。
