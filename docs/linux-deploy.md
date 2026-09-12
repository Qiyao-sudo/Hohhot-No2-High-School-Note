# 轻量服务器(Linux)部署指南 · 宝塔 + PM2 + 本机推送

部署模型: **本机一条命令发布**(`npm run deploy`), 服务器不碰代码、不需要 git、
不需要访问 GitHub——本地构建 → SFTP 直传 → 原子切换 → pm2 热重载 → 健康检查
(失败自动回滚)。服务器端一次性准备只要 5 分钟。

```
本机(有本仓库代码 + .env)
  └─ npm run deploy
       ├─ 同步腾讯文档(可 --no-sync 跳过)
       ├─ BASE=/ 构建(server + dist)
       └─ SFTP 上传 → 服务器原子切换 → pm2 热重载 → 健康检查
服务器(宝塔 Linux)
  └─ Nginx(:80/:443) ──反代──► 127.0.0.1:8787(pm2 守护 node, 静态站+助手API同源)
```

## 0. 前置条件

**服务器**: 宝塔面板 + Node 20 与 pm2(宝塔"PM2 管理器"或 `npm i -g pm2`); 不需要 git。

**本机**: 本仓库代码、Python 3 + paramiko(`pip install paramiko`)、npm。

## 1. 服务器一次性准备(约 5 分钟)

SSH 登录服务器:

```bash
mkdir -p /www/hs2/deploy /www/hs2/logs

# pm2 开机自启(只做一次; 屏幕输出的 sudo 命令原样执行)
pm2 startup
```

> 端口: 控制台安全组放行 80/443; **不要放行 8787**(只供本机 Nginx 访问)。

## 2. 本机配置 + 首次部署

在本机仓库根目录的 `.env`(没有就 `cp .env.example .env`)里填:

```ini
DEEPSEEK_API_KEY=sk-你的key      # 助手用(会自动注入服务器)
DEPLOY_HOST=服务器IP
DEPLOY_USER=root
DEPLOY_PASS=服务器SSH密码        # 或 DEPLOY_KEY=~/.ssh/id_rsa
DEPLOY_ROOT=/www/hs2
```

然后一条命令:

```bash
npm run deploy
```

它会自动完成: 同步文档 → 构建 → 打包上传 → 在服务器生成 `ecosystem.config.js`
(密钥即本机 .env 的 key) → 首次自动 `pm2 start`(进程名 `hs2`) → 健康检查。
结束时看到绿色的 `✓ 部署成功` 即可。

> 提示: 服务器首次跑起来后, 建议在服务器执行一次 `pm2 save`,
> 让重启服务器后进程自动恢复。若提示缺 `DEEPSEEK_API_KEY`, 说明本机 .env 没填 key。

## 3. Nginx 反向代理(含 SSE 关键配置)

### 宝塔面板方式

1. 网站 → 添加站点: 域名填你的域名(仅 IP 调试就填 IP), PHP 版本选"纯静态";
2. 站点设置 → **反向代理** → 添加: 目标 URL `http://127.0.0.1:8787`, 发送域名 `$host`;
3. **必做**: 反代列表 → 配置文件, 在 `proxy_pass` 所在 `location` 里加三行
   (宝塔模板默认开缓冲, 不加 AI 回答会卡住后一次性吐出):

   ```nginx
   proxy_buffering off;
   proxy_cache off;
   proxy_read_timeout 120s;
   ```

4. 有域名: 站点设置 → SSL → Let's Encrypt 申请并开启"强制 HTTPS"
   (域名需已解析到本机; 国内服务器绑域名需先完成 ICP 备案)。

### 原生 Nginx 方式

```nginx
# /etc/nginx/conf.d/hs2.conf
server {
    listen 80;
    server_name _;                      # 或你的域名

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 流式必需
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 120s;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

## 4. 验收清单

```bash
# 服务器上
pm2 ls                                    # hs2 状态 online
curl http://127.0.0.1:8787/health         # configured:true
curl -I http://127.0.0.1/ | head -1       # 经 Nginx: 200
```

浏览器打开 `http://服务器IP/`(或域名):
- 首页/文档页样式正常(无"裸 HTML"感);
- 导航「文档助手」提问一句: 回答**逐字流式**出现(一坨一次吐出 = 第 3 节缓冲没关);
- 回答里的 `[[n]]` 角标和"来源"卡片可点击, 跳到对应文档锚点。

## 5. 日常更新(以后只做这一件事)

```bash
npm run deploy               # 完整: 同步文档 + 构建 + 推送 + 热重载
npm run deploy -- --no-sync  # 文档没更新, 跳过腾讯文档抓取
npm run deploy -- --skip-build  # 只重推现有产物(改了服务器配置之类)
```

部署全程**原子切换**: 旧版本自动保底在 `deploy/server.old` 与 `deploy/dist.old`,
健康检查不过自动回滚, 线上不会出现半新半旧状态。

## 6. 运维速查

| 场景 | 命令(服务器上) |
| --- | --- |
| 看状态/日志 | `pm2 ls` / `pm2 logs hs2 --lines 200 --nostream` |
| 重启服务 | `pm2 reload hs2` |
| 手工回滚上一版 | `cd /www/hs2/deploy && rm -rf server dist && mv server.old server && mv dist.old dist && pm2 reload hs2` |
| 清 pm2 旧日志 | `pm2 flush hs2` |
| 内存/CPU 面板 | `pm2 monit` |
| 重启服务器后自启 | 首次部署后执行过 `pm2 save` 即自动恢复 |

## 7. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 本机 deploy 报连接/认证失败 | 核对本机 `.env` 的 `DEPLOY_HOST/USER/PASS`; 服务器 22 端口与密码正确性 |
| deploy 上传很慢 | 产物约 20MB, 受本地上行带宽限制; 重复部署可 `--skip-build` 只推变更后的包 |
| deploy 健康检查失败自动回滚 | 服务器 `pm2 logs hs2` 看报错; 多为 8787 被占用(`ss -tlnp \| grep 8787`)或内存不足 |
| 502 Bad Gateway | pm2 进程没起来: `pm2 ls` / `pm2 logs hs2` |
| AI 回答一坨一次吐出, 不流式 | Nginx 缓冲没关: `nginx -T \| grep proxy_buffering` 检查第 3 节配置是否生效 |
| 首页样式全丢(裸 HTML) | 产物构建没带 `BASE=/`; 用 `npm run deploy` 全流程构建, 不要手动单独跑 build |
| 助手页显示"后端尚未配置" | 本机 `.env` 的 `DEEPSEEK_API_KEY` 没填(它会注入服务器 ecosystem) |
| 问答报"提问次数有点多" | 每 IP 每小时限流(默认 30 次), 下一小时自动恢复 |
| 重启服务器后站没了 | 服务器上补执行 `pm2 save` 后 `pm2 resurrect` 验证 |

## 8. 从旧方案迁移的清理(一次性)

若之前配过"服务器每 6 小时拉取 GitHub"的方案, 迁移到本机推送后清理:

```bash
crontab -e                       # 删除 sync.sh 那一行(宝塔则在 计划任务 里删除)
rm -rf /www/hs2/repo /www/hs2/sync.sh /www/hs2/logs/sync.log
```

Git 仓库仍由 GitHub Actions 每日自动同步源文档并做构建验证(作为云端备份与
代码主仓), 只是服务器不再从 GitHub 拉取, 一切更新经本机 `npm run deploy` 发布。

## 9. 后续(可选)

- 想上自有域名 + HTTPS: 买域名 → 腾讯云备案(轻量服务器**包年包月**即可作为
  备案资源) → 解析到本机 → 宝塔站点 SSL 一键申请; 备案期间该域名不可访问,
  不影响当前 IP 方式使用;
- 退役的旧部署(如按量计费的 Windows 云服务器)记得**关机或销毁**, 不跑也计费。
