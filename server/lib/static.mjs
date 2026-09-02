// ============================================================
// 静态文件托管(零依赖): 云服务器单进程同源部署时使用。
// 设置 STATIC_ROOT 环境变量(默认 <server>/../dist)后,
// 未命中 API 路由的 GET/HEAD 会回落到静态文件:
//   /a/b        → dist/a/b → dist/a/b/index.html → dist/a/b.html
//   404         → dist/404.html
// 缓存策略: 带内容哈希的 assets 长缓存; HTML 不缓存保证更新即时生效。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
}

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url))) // → server/

export function staticRoot() {
  // 默认 <仓库根>/dist(与 server/ 平级的构建产物)
  const root = process.env.STATIC_ROOT || path.resolve(serverDir, '..', 'dist')
  return fs.existsSync(root) ? root : null
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const full = path.resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded))
  if (full !== root && !full.startsWith(root + path.sep)) return null
  return full
}

function pickFile(root, urlPath) {
  // 依次尝试: 精确文件 → 目录默认页 → 无后缀补 .html(VitePress 优雅链接)
  const candidates = [
    urlPath === '/' ? path.join(root, 'index.html') : safeJoin(root, urlPath),
    ...(urlPath === '/' ? [] : [safeJoin(root, urlPath + '/index.html'), safeJoin(root, urlPath + '.html')]),
  ].filter(Boolean)
  for (const f of candidates) {
    try {
      if (fs.statSync(f).isFile()) return f
    } catch { /* 尝试下一个候选 */ }
  }
  return null
}

// 返回 true 表示已作为静态请求处理完毕
export function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const root = staticRoot()
  if (!root) return false

  let file = pickFile(root, pathname)
  let isNotFound = false
  if (!file) {
    const f404 = path.join(root, '404.html')
    if (!fs.existsSync(f404)) return false
    file = f404
    isNotFound = true
  }

  const ext = path.extname(file).toLowerCase()
  const mime = MIME[ext] || 'application/octet-stream'
  const headers = {
    'Content-Type': mime,
    // assets/* 文件名带内容哈希可长缓存; 其余(页面/图片等)协商缓存
    'Cache-Control': pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  }
  if (ext === '.html' || ext === '.js' || ext === '.css') {
    headers['Cross-Origin-Opener-Policy'] = 'same-origin'
  }

  const stat = fs.statSync(file)
  headers['Content-Length'] = stat.size
  res.writeHead(isNotFound ? 404 : 200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  fs.createReadStream(file).pipe(res)
  return true
}
