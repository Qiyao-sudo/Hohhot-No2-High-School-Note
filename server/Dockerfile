# ============================================================
# 文档助手后端 · 腾讯云托管(CloudBase Run)镜像
# 构建上下文 = server/ 目录(控制台本地上传选 server/, 或 CI 中 --source server)
# 端口 8787 与服务端口配置保持一致
# ============================================================
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8787

WORKDIR /app

# server/ 目录即完整后端(零 npm 依赖, 知识库 kb.mjs 已随仓库提交)
COPY --chown=node:node . .

USER node

EXPOSE 8787

# 云托管健康检查探测 /health(返回 200 + JSON)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.mjs"]
