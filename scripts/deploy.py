# -*- coding: utf-8 -*-
"""
本机一键推送部署: 本地构建 → SFTP 上传 → 服务器原子切换 → pm2 热重载 → 健康检查(失败自动回滚)

用法:
    python scripts/deploy.py            # 完整流程: 同步源文档 → 构建 → 推送
    python scripts/deploy.py --no-sync  # 跳过源文档同步(网络不佳时)
    python scripts/deploy.py --skip-build  # 不重新构建, 推送现有产物

配置(仓库根 .env, 不进 git):
    DEPLOY_HOST / DEPLOY_PORT / DEPLOY_USER / DEPLOY_PASS(或 DEPLOY_KEY) / DEPLOY_ROOT
"""
import os
import subprocess
import sys
import tarfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# Windows 控制台 GBK 环境兜底: 输出用 UTF-8, 不可编码字符降级显示
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")


def load_env():
    try:
        with open(".env", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass


def step(msg):
    print(f"\n\033[36m== {msg}\033[0m")


def die(msg):
    print(f"\033[31m✗ {msg}\033[0m")
    sys.exit(1)


def sh(cmd, env_extra=None, check=True):
    # PYTHONIOENCODING/PYTHONUTF8: Windows 管道下子进程默认 GBK,
    # 脚本里的 ✓ 等字符会 UnicodeEncodeError, 强制 UTF-8
    env = {**os.environ,
           "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1",
           **(env_extra or {})}
    # Windows 下 npm/python 是 .cmd, 统一走 shell
    r = subprocess.run(cmd, shell=True, env=env, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.stdout.strip():
        print(r.stdout.strip()[-1500:])
    if r.stderr.strip():
        print(r.stderr.strip()[-500:], file=sys.stderr)
    if check and r.returncode != 0:
        die(f"命令失败({r.returncode}): {cmd}")
    return r


def main():
    args = sys.argv[1:]
    load_env()

    host = os.environ.get("DEPLOY_HOST")
    user = os.environ.get("DEPLOY_USER", "root")
    port = int(os.environ.get("DEPLOY_PORT", "22"))
    password = os.environ.get("DEPLOY_PASS", "")
    keyfile = os.environ.get("DEPLOY_KEY", "")
    remote_root = os.environ.get("DEPLOY_ROOT", "/www/hs2")
    # pm2 进程名: 与服务器现有进程保持一致(默认 hs2; 手动部署过请填实际名)
    pm2_name = os.environ.get("DEPLOY_PM2_NAME", "hs2")
    if not host:
        die("缺少 DEPLOY_HOST: 请复制 .env.example 为 .env 并填写服务器信息")

    import paramiko

    t0 = time.time()
    ver = sh("git rev-parse --short HEAD", check=False).stdout.strip() or "nogit"

    # ------------------------------------------------ 1. 同步源文档
    if "--no-sync" not in args:
        step("同步源文档(腾讯文档)")
        sh(f"{sys.executable} scripts/sync_doc.py")

    # ------------------------------------------------ 2. 构建(BASE=/ 同源版)
    if "--skip-build" not in args:
        step("构建同源版前端")
        # 直接注入环境变量, 避免 Git Bash 的 MSYS 路径转换问题
        sh("npm run build", env_extra={"BASE": "/", "ASSISTANT_API": "", "MSYS_NO_PATHCONV": "1"})

    # ------------------------------------------------ 3. 打包(server + dist, 不含 .env)
    step("打包")
    pkg = os.path.join(".tmp", "prod.tar.gz")
    os.makedirs(".tmp", exist_ok=True)

    def skip_env(tarinfo):
        # 排除密钥与本地产物
        if tarinfo.name in ("server/.env", "server/run.log") or tarinfo.name.endswith("/.env"):
            return None
        return tarinfo

    with tarfile.open(pkg, "w:gz") as t:
        t.add("server", arcname="server", filter=skip_env)
        t.add(os.path.join("docs", ".vitepress", "dist"), arcname="dist")
    size_mb = os.path.getsize(pkg) / 1048576
    print(f"prod.tar.gz {size_mb:.1f}MB")

    # ------------------------------------------------ 4. 上传 + 服务器切换
    step(f"连接 {user}@{host}:{port}")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kw = dict(timeout=15, allow_agent=False, look_for_keys=False)
    if keyfile:
        kw["key_filename"] = os.path.expanduser(keyfile)
    elif password:
        kw["password"] = password
    else:
        die("请在 .env 配置 DEPLOY_PASS 或 DEPLOY_KEY")
    ssh.connect(host, port, user, **kw)

    def run_remote(cmd, timeout=180):
        _, out, err = ssh.exec_command(cmd, timeout=timeout)
        o = out.read().decode("utf-8", "replace")
        e = err.read().decode("utf-8", "replace")
        code = out.channel.recv_exit_status()
        return code, o, e

    # 生成本机密钥对应的 ecosystem(服务器端唯一配置源, 首次部署即自动创建进程)
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    key_js = repr(api_key) if api_key else "''"
    eco = (
        "module.exports = {\n"
        "  apps: [{\n"
        f"    name: '{pm2_name}',\n"
        "    script: 'index.mjs',\n"
        f"    cwd: '{remote_root}/deploy/server',\n"
        "    env: {\n"
        f"      DEEPSEEK_API_KEY: {key_js},\n"
        "      PORT: 8787,\n"
        "      HOST: '127.0.0.1',\n"
        "    },\n"
        "    max_memory_restart: '400M',\n"
        f"    out_file: '{remote_root}/logs/out.log',\n"
        f"    error_file: '{remote_root}/logs/error.log',\n"
        "    merge_logs: true,\n"
        "    time: true,\n"
        "  }]\n"
        "}\n"
    )

    step("上传")
    sftp = ssh.open_sftp()
    try:
        sftp.mkdir(remote_root)
    except IOError:
        pass
    try:
        sftp.mkdir(f"{remote_root}/logs")
    except IOError:
        pass
    sftp.put(pkg, "/tmp/hs2-prod.tar.gz")
    with sftp.open(f"{remote_root}/ecosystem.config.js", "w") as f:
        f.write(eco)
    sftp.close()
    print(f"上传完成({size_mb:.1f}MB + ecosystem)")

    R = f"{remote_root}/deploy"
    switch_cmd = f"""set -e
mkdir -p {R}
cp {R}/server/.env /tmp/hs2.env 2>/dev/null || true
rm -rf /tmp/hs2-new && mkdir /tmp/hs2-new
tar xzf /tmp/hs2-prod.tar.gz -C /tmp/hs2-new
rm -rf {R}/server.old {R}/dist.old
[ -d {R}/server ] && mv {R}/server {R}/server.old || true
[ -d {R}/dist ] && mv {R}/dist {R}/dist.old || true
mv /tmp/hs2-new/server {R}/server
mv /tmp/hs2-new/dist {R}/dist
[ -f /tmp/hs2.env ] && mv /tmp/hs2.env {R}/server/.env
[ -f {R}/server/.env ] && chmod 600 {R}/server/.env
cd {remote_root}
if pm2 describe {pm2_name} >/dev/null 2>&1; then pm2 reload {pm2_name}; else pm2 start ecosystem.config.js; fi
sleep 3
curl -fsS http://127.0.0.1:8787/health"""

    step("服务器切换 + 热重载")
    code, o, e = run_remote(switch_cmd, timeout=300)
    health = o.strip()
    print(health or e.strip())

    if code != 0 or '"ok"' not in health:
        step("健康检查失败, 自动回滚")
        run_remote(f"""[ -d {R}/server.old ] && (rm -rf {R}/server && mv {R}/server.old {R}/server) || true
[ -d {R}/dist.old ] && (rm -rf {R}/dist && mv {R}/dist.old {R}/dist) || true
pm2 reload {pm2_name} || pm2 restart {pm2_name}""")
        _, o2, _ = run_remote("curl -fsS http://127.0.0.1:8787/health || true")
        print("回滚后 health:", o2.strip()[:120])
        ssh.close()
        die("部署失败, 已回滚旧版本(详见上方输出)")

    # 成功: 清理保底目录与临时文件
    run_remote(f"rm -rf {R}/server.old {R}/dist.old /tmp/hs2-new /tmp/hs2-prod.tar.gz")
    ssh.close()

    ok = '"configured":true' in health
    print(f"""
\033[32m✓ 部署成功\033[0m  版本 {ver}  耗时 {time.time() - t0:.0f}s
  站点与接口已原子切换, pm2 已热重载""")
    if not ok:
        print("\033[33m⚠ 注意: 服务器 .env 缺 DEEPSEEK_API_KEY(助手会显示未配置)。\033[0m"
              "  请按 docs/linux-deploy.md 第 2.4 节在服务器补配后 pm2 restart hs2")


if __name__ == "__main__":
    main()
