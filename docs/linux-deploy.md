# 轻量服务器(Linux)部署指南 · PM2 + Nginx

适合已有一台腾讯云轻量应用服务器(或任意 Linux 云服务器)、且**已装好
Node 20+ / pm2 / git**(跑过其他 PM2 项目)的情况。整站 = 一个 Node 进程
(静态站 + 文档助手 API 同源), Nginx 只做反向代理 + HTTPS, 内存占用极小(≈80MB)。

```
浏览器 ──► Nginx(:80/:443, 域名+SSL) ──反代──► 127.0.0.1:8787
                                                └─ pm2 守护 node server/index.mjs
                                                   ├─ 整站静态文件(../dist)
                                                   └─ /api/assistant/*(SSE 流式问答)
```

> Windows 服务器上那套同源部署等价迁移到 Linux; 亦可参考
 > [assistant-setup.md](assistant-setup.md) 的方案三说明。

## 0. 前置检查

```bash
node -v    # ≥ 20
pm2 -v     # 已全局安装
git --version
ss -tlnp | grep -E ':(80|443|8787)\b'   # 80/443 若被占用说明 Nginx 已在跑(正常); 8787 应空闲
```

## 1. 目录规划(运行目录与源码分离)

```
/www/hs2/
├── repo/                 # git 源码(可随时销毁重建)
├── deploy/
│   ├── server/           # 运行中的后端(从 repo 拷贝; .env 只在这里, 不进 git)
│   └── dist/             # 前端构建产物
├── logs/                 # pm2 与同步脚本日志
├── ecosystem.config.js   # pm2 配置
└── sync.sh               # 定时同步脚本(第 6 节)
```

这样分离的好处: 同步/构建失败时线上目录不受影响; `.env`(含 API Key)永不出现在 git 里。

## 2. 首次部署

```bash
mkdir -p /www/hs2 && cd /www/hs2

# 2.1 拉源码(公开仓库免认证)
git clone https://github.com/Qiyao-sudo/Hohhot-No2-High-School-Note.git repo
cd repo

# 2.2 构建(必须 BASE=/ 根路径; 国内源加速可选)
npm config set registry https://registry.npmmirror.com
BASE=/ npm install --no-audit --no-fund
BASE=/ npm run build
# ✔ 验证: 产物首页的资源引用是根路径
grep -o 'href="[^"]*style[^"]*css"' docs/.vitepress/dist/index.html
#   应显示 href="/assets/style.xxxx.css" —— 若出现别的路径前缀说明 BASE 没生效

# 2.3 摆运行目录
mkdir -p ../deploy/server ../deploy/dist ../logs
cp -r server/. ../deploy/server/
cp -r docs/.vitepress/dist/. ../deploy/dist/

# 2.4 写环境变量(改成你的 key; 权限收紧)
cat > ../deploy/server/.env << 'EOF'
DEEPSEEK_API_KEY=sk-你的key
DEEPSEEK_MODEL=deepseek-v4-flash
PORT=8787
HOST=127.0.0.1
EOF
chmod 600 ../deploy/server/.env
```

## 3. PM2 启动

```bash
cd /www/hs2
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'hs2',
    script: 'index.mjs',
    cwd: '/www/hs2/deploy/server',
    env: {
      // 与 .env 二选一即可; 两处都写则以这里为准(pm2 注入优先)
      DEEPSEEK_API_KEY: 'sk-你的key',
      PORT: 8787,
      HOST: '127.0.0.1',          // 只监听本机, 由 Nginx 对外
    },
    max_memory_restart: '400M',   // 内存保险丝
    out_file: '/www/hs2/logs/out.log',
    error_file: '/www/hs2/logs/error.log',
    merge_logs: true,
    time: true,
  }]
}
EOF
pm2 start ecosystem.config.js

# ✔ 验证
curl http://127.0.0.1:8787/health
#   期望 {"ok":true,...,"configured":true,...}
curl -I http://127.0.0.1:8787/ | head -1   # 期望 200

# 开机自启(已注册过 pm2 startup 的机器跳过第一条)
pm2 startup    # 按屏幕提示复制执行输出的 sudo 命令
pm2 save       # 保存进程列表, 重启服务器自动拉起
```

> 机器上已有其他 pm2 项目时互不影响: `pm2 ls` 里 hs2 与它们并列;
> `pm2 save` 会把所有进程一起存盘, 别用 `pm2 delete` 动别人的进程即可。

## 4. Nginx 反向代理(含 SSE 关键配置)

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

### 防火墙

- 轻量/云控制台安全组: 放行 **80、443**; **不要放行 8787**(应用只对本机);
- 宝塔"安全"页或系统防火墙(ufw/firewalld)同理。

## 5. 验收清单

```bash
pm2 ls                                    # hs2 状态 online
curl http://127.0.0.1:8787/health         # configured:true
curl -I http://127.0.0.1/ | head -1       # 经 Nginx: 200
```

浏览器打开 `http://服务器IP/`(或域名):
- 首页/文档页样式正常(无"裸 HTML"感);
- 导航「文档助手」提问一句: 回答**逐字流式**出现(一坨一次吐出 = 第 4 节缓冲没关);
- 回答里的 `[[n]]` 角标和"来源"卡片可点击, 跳到对应文档锚点。

## 6. 定时自动同步 GitHub(每 6 小时)

```bash
cat > /www/hs2/sync.sh << 'EOF'
#!/bin/bash
# GitHub main 有更新才: 拉码→构建→摆目录→pm2 reload→健康检查
# 任一步失败立即退出, 线上保持旧版本(server.old/dist.old 保底)
set -u
ROOT=/www/hs2
LOG=$ROOT/logs/sync.log
say() { echo "[$(date '+%F %T')] $*" >> $LOG; }

# 30 分钟防重入
exec 9>/tmp/hs2-sync.lock
flock -n 9 || { say 'another sync running, skip'; exit 0; }

cd $ROOT/repo || { say 'no repo'; exit 1; }
git fetch origin main --quiet
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && { say "no change"; exit 0; }
say "update -> $(git rev-parse --short origin/main)"
git reset --hard origin/main --quiet || { say 'reset failed'; exit 1; }

BASE=/ npm install --no-audit --no-fund --registry=https://registry.npmmirror.com >>$LOG 2>&1 \
  || { say 'npm install failed'; exit 1; }
BASE=/ npm run build >>$LOG 2>&1 || { say 'build failed'; exit 1; }
say 'build ok'

# 摆 server(保 .env)与 dist(旧版保底)
cp $ROOT/deploy/server/.env /tmp/hs2.env
rm -rf $ROOT/deploy/server-new && mkdir -p $ROOT/deploy/server-new
cp -r server/. $ROOT/deploy/server-new/
mv /tmp/hs2.env $ROOT/deploy/server-new/.env && chmod 600 $ROOT/deploy/server-new/.env

rm -rf $ROOT/deploy/dist.old
[ -d $ROOT/deploy/dist ] && mv $ROOT/deploy/dist $ROOT/deploy/dist.old
mkdir -p $ROOT/deploy/dist
cp -r docs/.vitepress/dist/. $ROOT/deploy/dist/

rm -rf $ROOT/deploy/server.old
[ -d $ROOT/deploy/server ] && mv $ROOT/deploy/server $ROOT/deploy/server.old
mv $ROOT/deploy/server-new $ROOT/deploy/server

pm2 reload hs2 >>$LOG 2>&1 || pm2 restart hs2 >>$LOG 2>&1
sleep 3
if curl -fsS http://127.0.0.1:8787/health | grep -q '"ok":true'; then
  rm -rf $ROOT/deploy/dist.old $ROOT/deploy/server.old
  say "deployed $(git rev-parse --short HEAD) OK"
else
  say 'HEALTH CHECK FAILED — 旧版保留在 server.old/dist.old, 可手工切回'
  exit 1
fi
EOF
chmod +x /www/hs2/sync.sh

# 注册定时: 二选一
crontab -e
#   0 */6 * * * bash /www/hs2/sync.sh
# 或宝塔: 计划任务 → Shell 脚本, 周期"每 6 小时", 内容 bash /www/hs2/sync.sh

# 手动跑一次验证整链路
bash /www/hs2/sync.sh && tail -3 /www/hs2/logs/sync.log
```

## 7. 日常运维速查

| 场景 | 命令 |
| --- | --- |
| 看状态/日志 | `pm2 ls` / `pm2 logs hs2 --lines 200 --nostream` |
| 改环境变量后生效 | `pm2 restart hs2 --update-env`(改的是 ecosystem) 或改 `.env` 后 `pm2 restart hs2` |
| 立即同步一次 | `bash /www/hs2/sync.sh && tail -3 /www/hs2/logs/sync.log` |
| 出问题回滚 | `cd /www/hs2/deploy && rm -rf server dist && mv server.old server && mv dist.old dist && pm2 reload hs2` |
| 清 pm2 旧日志 | `pm2 flush hs2` |
| 内存/CPU 面板 | `pm2 monit` |

## 8. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 502 Bad Gateway | pm2 进程没起来: `pm2 ls` 看 errored/stopped, `pm2 logs hs2` 查报错; 确认 8787 端口: `ss -tlnp | grep 8787` |
| AI 回答一坨一次吐出, 不流式 | Nginx 缓冲没关: 检查第 4 节 `proxy_buffering off` 是否真的写进生效的配置(`nginx -T | grep proxy_buffering`) |
| 首页样式全丢(裸 HTML) | 构建时没带 `BASE=/`: `grep -o 'href="[^"]*style[^"]*css"' repo/docs/.vitepress/dist/index.html` 检查引用是否 `/assets/` 开头, 重新带 `BASE=/ npm run build` |
| 助手页显示"后端尚未配置" | `curl 127.0.0.1:8787/health` 看 `configured` 是否 true; false = `.env`/ecosystem 里 key 没配上; 注意 pm2 环境变量优先于 `.env` |
| 问答报"提问次数有点多" | 每.IP 每小时限流(默认 30 次), 下一小时自动恢复; 需调整改 `ASSISTANT_RATE_ASK` 环境变量 |
| sync.sh 一直 no change | 正常: 远端 main 无新提交; 强制重建可 `cd /www/hs2/repo && git reset --hard origin/main` 后手动跑一遍 |
| 重启服务器后站没了 | 没做 `pm2 save` / `pm2 startup`: 补做后 `pm2 resurrect` 验证 |

## 9. 与其他部署端的关系

- **CloudBase 国内站**(自动 Git 部署)与本方案并行, 各自独立更新, 可互为备份;
- 迁移完成后, 原 Windows 服务器(按量计费)记得**关机或销毁**, 不跑也计费;
- 本机若为**包年轻量服务器**, 同时满足了以后 ICP 备案的资源条件
  (域名 + 备案流程见 [cloudbase-deploy.md](cloudbase-deploy.md) 第 4 节, 流程通用)。
