<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useData, withBase } from 'vitepress'
import MarkdownIt from 'markdown-it'
import {
  PhSparkle,
  PhMagnifyingGlass,
  PhPaperPlaneRight,
  PhStopCircle,
  PhCopySimple,
  PhCheck,
  PhArrowCounterClockwise,
  PhWarningCircle,
  PhBookmarks,
  PhChatCircleDots,
} from '@phosphor-icons/vue'

// 后端地址: 构建时由 config.ts 注入。
// 默认同源 /api/assistant —— 适用于 Vercel 同项目部署(前端 + api/ 函数);
// 独立部署后端时通过 ASSISTANT_API 环境变量指向其地址。
const apiBase =
  (typeof __ASSISTANT_API__ !== 'undefined' && __ASSISTANT_API__) || '/api/assistant'

const props = defineProps<{ compact?: boolean }>()

interface Source { n: number, page: string, path: string, heading: string, anchor: string }
interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  kind?: 'answer' | 'results' | 'error'
  content: string
  sources?: Source[]
  results?: { page: string, path: string, heading: string, anchor: string, snippet: string }[]
  streaming?: boolean
}

const { isDark } = useData()

// ------------------------------------------------------------------ 状态
const mode = ref<'chat' | 'find'>('chat')
const messages = ref<ChatMessage[]>([])
const input = ref('')
const busy = ref(false)
// checking=探测后端中 ready=可用 off=后端未配置 down=后端不可达
const status = ref<'checking' | 'ready' | 'off' | 'down'>('checking')
const healthInfo = ref<{ model?: string, kbTime?: string }>({})
const copiedId = ref<number | null>(null)
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
let abortCtrl: AbortController | null = null
let idSeq = 1

const STORE_KEY = 'hs2-assistant-msgs'

// ------------------------------------------------------------------ markdown 渲染
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
// 外链新窗口打开
const defaultLink =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener')
  return defaultLink(tokens, idx, options, env, self)
}

// 把模型输出的 [[n]] 引用标记转为可点击角标(点击打开来源页面)
function renderAnswer(msg: ChatMessage): string {
  let html = md.render(msg.content || '')
  html = html.replace(
    /\[\[(\d+)\]\]/g,
    (_, n) =>
      `<a class="cit" href="#" data-cite="${n}" title="查看来源">${n}</a>`
  )
  return html
}

function onAnswerClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest?.('a[data-cite]') as HTMLAnchorElement | null
  if (!a) return
  e.preventDefault()
  const n = Number(a.dataset.cite)
  openSource(n, messages.value.find((m) => m.sources?.some((s) => s.n === n))?.sources)
}

function openSource(n: number, sources?: Source[]) {
  const s = sources?.find((x) => x.n === n)
  if (s) window.open(withBase(`${s.path}#${s.anchor}`), '_blank', 'noopener')
}

function sourceHref(s: { path: string, anchor: string }) {
  return withBase(`${s.path}#${s.anchor}`)
}

// ------------------------------------------------------------------ 健康检查
async function checkHealth() {
  status.value = 'checking'
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(`${apiBase}/health`, { signal: ctrl.signal })
    clearTimeout(timer)
    const data = await res.json()
    if (data.ok && data.configured) {
      status.value = 'ready'
      healthInfo.value = {
        model: data.model,
        kbTime: data.kb?.generatedAt?.slice(0, 10),
      }
    } else {
      status.value = 'off'
    }
  } catch {
    status.value = 'down'
  }
}

onMounted(() => {
  checkHealth()
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]')
    if (Array.isArray(saved)) {
      messages.value = saved.filter((m: ChatMessage) => m && m.role && typeof m.content === 'string').slice(-40)
      idSeq = messages.value.reduce((mx, m) => Math.max(mx, m.id ?? 0), 0) + 1
    }
  } catch { /* 忽略损坏的本地历史 */ }
})

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(messages.value.slice(-40)))
  } catch { /* 存储满时静默失败 */ }
}

// ------------------------------------------------------------------ 滚动跟随
let pinned = true
function onScroll() {
  const el = listEl.value
  if (!el) return
  pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 90
}
async function scrollBottom(force = false) {
  if (!force && !pinned) return
  await nextTick()
  const el = listEl.value
  if (el) el.scrollTop = el.scrollHeight
}

// ------------------------------------------------------------------ 发送
const suggestions = [
  '新生什么时候报到？需要准备什么？',
  '军训大概几天，有哪些安排？',
  '学校对手机和发型有什么管理规定？',
  '食堂和宿舍条件怎么样？',
  '金川校区和呼伦校区有什么区别？',
  '想参加社团或学生会该怎么准备？',
]

const canSend = computed(
  () => status.value === 'ready' && !busy.value && input.value.trim().length > 0
)

async function send(text?: string) {
  const q = (text ?? input.value).trim()
  if (!q || busy.value || status.value !== 'ready') return
  input.value = ''
  messages.value.push({ id: idSeq++, role: 'user', content: q })
  pinned = true
  scrollBottom(true)
  if (mode.value === 'find') await doSearch(q)
  else await doAsk(q)
  persist()
}

async function doSearch(q: string) {
  busy.value = true
  const msg: ChatMessage = { id: idSeq++, role: 'assistant', kind: 'results', content: '', streaming: true }
  messages.value.push(msg)
  try {
    const res = await fetch(`${apiBase}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `检索失败 (${res.status})`)
    msg.results = data.results || []
    msg.content = msg.results.length
      ? `在站内找到 ${msg.results.length} 处相关内容：`
      : ''
  } catch (e: any) {
    msg.kind = 'error'
    msg.content = `检索失败：${e?.message || '网络错误'}`
  } finally {
    msg.streaming = false
    busy.value = false
    scrollBottom()
  }
}

async function doAsk(q: string) {
  busy.value = true
  const msg: ChatMessage = { id: idSeq++, role: 'assistant', kind: 'answer', content: '', streaming: true }
  messages.value.push(msg)
  abortCtrl = new AbortController()

  const history = messages.value
    .filter((m) => !m.streaming && m.kind !== 'error')
    .slice(-7)
    .map((m) => ({ role: m.role, content: m.content }))

  try {
    const res = await fetch(`${apiBase}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, stream: true }),
      signal: abortCtrl.signal,
    })
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `服务返回 ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i)
        buf = buf.slice(i + 2)
        const ev = (frame.match(/^event: (.*)$/m) || [])[1]
        const raw = (frame.match(/^data: (.*)$/m) || [])[1]
        if (!ev || !raw) continue
        const data = JSON.parse(raw)
        if (ev === 'meta') msg.sources = data.sources || []
        else if (ev === 'delta') {
          msg.content += data.t
          scrollBottom()
        } else if (ev === 'error') throw new Error(data.message)
        else if (ev === 'done') { /* 流结束 */ }
      }
    }
    if (!msg.content) msg.content = '（未收到回答，请重试。）'
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      msg.content += msg.content ? '\n\n*（已停止生成）*' : '*（已停止）*'
    } else {
      msg.kind = 'error'
      msg.content = `出错了：${e?.message || '网络错误，请稍后重试'}`
    }
  } finally {
    msg.streaming = false
    busy.value = false
    abortCtrl = null
    scrollBottom()
  }
}

function stop() {
  abortCtrl?.abort()
}

function clearChat() {
  if (busy.value) abortCtrl?.abort()
  messages.value = []
  persist()
}

async function copyAnswer(msg: ChatMessage) {
  try {
    await navigator.clipboard.writeText(msg.content.replace(/\s*\[\[\d+\]\]/g, ''))
    copiedId.value = msg.id
    setTimeout(() => (copiedId.value = null), 1500)
  } catch { /* 剪贴板权限被拒时忽略 */ }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey) return
  // 触屏设备(手机/平板)回车换行; 触屏笔记本的实体键盘仍可直接回车发送
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return
  e.preventDefault()
  send()
}

function modeLabel() {
  return mode.value === 'find' ? '快速检索' : '智能问答'
}

defineExpose({ focus: () => inputEl.value?.focus() })
</script>

<template>
  <div class="ai-chat" :class="{ compact }">
    <!-- 头部 -->
    <div class="ai-chat-head">
      <div class="head-title">
        <component :is="PhSparkle" :size="20" weight="duotone" aria-hidden="true" />
        <div>
          <strong>文档助手</strong>
          <span v-if="status === 'ready' && healthInfo.model" class="head-meta">
            {{ healthInfo.model }} · 知识库 {{ healthInfo.kbTime }}
          </span>
        </div>
      </div>
      <div class="head-actions">
        <button
          v-if="messages.length"
          class="icon-btn"
          title="清空对话"
          aria-label="清空对话"
          @click="clearChat"
        >
          <component :is="PhArrowCounterClockwise" :size="17" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- 模式切换 -->
    <div class="ai-modes" role="tablist">
      <button
        class="mode-btn"
        :class="{ active: mode === 'chat' }"
        role="tab"
        :aria-selected="mode === 'chat'"
        @click="mode = 'chat'"
      >
        <component :is="PhChatCircleDots" :size="15" weight="fill" aria-hidden="true" />
        智能问答
      </button>
      <button
        class="mode-btn"
        :class="{ active: mode === 'find' }"
        role="tab"
        :aria-selected="mode === 'find'"
        @click="mode = 'find'"
      >
        <component :is="PhMagnifyingGlass" :size="15" weight="bold" aria-hidden="true" />
        快速检索
      </button>
    </div>

    <!-- 未配置 / 不可用提示 -->
    <div v-if="status === 'off' || status === 'down'" class="ai-notice">
      <component :is="PhWarningCircle" :size="18" weight="fill" aria-hidden="true" />
      <template v-if="status === 'off'">
        文档助手后端尚未配置（缺少 DeepSeek API Key），站点其余功能不受影响。维护者可参考
        <a :href="withBase('/assistant-setup')">文档助手部署指南</a> 完成配置。
      </template>
      <template v-else>
        文档助手服务暂时无法连接{{ apiBase.startsWith('http') ? '' : '（本部署未附带后端）' }}，请稍后重试。
        <a href="#" @click.prevent="checkHealth">重新检测</a>
      </template>
    </div>

    <!-- 消息区 -->
    <div ref="listEl" class="ai-list" @scroll.passive="onScroll" @click="onAnswerClick">
      <!-- 空状态: 推荐问题 -->
      <div v-if="!messages.length" class="ai-empty">
        <div class="empty-icon">
          <component :is="PhSparkle" :size="30" weight="duotone" aria-hidden="true" />
        </div>
        <p class="empty-title">
          你好！我是本站的 AI 文档助手，读过站内全部资料。
        </p>
        <p class="empty-sub">
          直接提问二中学习生活的问题，我会引用原文回答；也可以切换到「快速检索」直接定位文档。
        </p>
        <div class="suggest">
          <button
            v-for="s in suggestions"
            :key="s"
            class="suggest-item"
            :disabled="status !== 'ready'"
            @click="send(s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <template v-for="m in messages" :key="m.id">
        <div v-if="m.role === 'user'" class="msg user">
          <div class="bubble">{{ m.content }}</div>
        </div>

        <!-- 检索结果卡片 -->
        <div v-else-if="m.kind === 'results'" class="msg bot">
          <div v-if="m.content" class="results-title">
            <component :is="PhMagnifyingGlass" :size="15" weight="bold" aria-hidden="true" />
            {{ m.content }}
          </div>
          <a
            v-for="(r, i) in m.results"
            :key="i"
            class="result-card"
            :href="sourceHref(r)"
          >
            <span class="rc-page">{{ r.page }} › {{ r.heading }}</span>
            <span class="rc-snippet">{{ r.snippet }}</span>
          </a>
          <div v-if="m.results && !m.results.length" class="no-hit">
            没有找到相关内容，换个说法试试，或用「智能问答」提问。
          </div>
        </div>

        <!-- 回答 -->
        <div v-else class="msg bot">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="answer" :class="{ err: m.kind === 'error' }" v-html="renderAnswer(m)" />
          <span v-if="m.streaming && !m.content" class="typing">
            <i></i><i></i><i></i>
          </span>
          <div v-if="m.sources && m.sources.length" class="sources">
            <span class="src-label">
              <component :is="PhBookmarks" :size="13" weight="fill" aria-hidden="true" />
              来源
            </span>
            <a
              v-for="s in m.sources"
              :key="s.n"
              class="src-chip"
              :href="sourceHref(s)"
              :title="`${s.page} › ${s.heading}`"
            >{{ s.n }}. {{ s.page }} › {{ s.heading }}</a>
          </div>
          <div v-if="!m.streaming && m.kind !== 'error'" class="msg-ops">
            <button class="icon-btn" title="复制回答" aria-label="复制回答" @click="copyAnswer(m)">
              <component :is="copiedId === m.id ? PhCheck : PhCopySimple" :size="15" aria-hidden="true" />
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 输入区 -->
    <div class="ai-input-row">
      <textarea
        ref="inputEl"
        v-model="input"
        :rows="compact ? 1 : 2"
        :placeholder="status === 'ready' ? (mode === 'find' ? '输入关键词，直接定位文档…' : '问点什么，比如：军训要带什么？') : '文档助手暂不可用…'"
        :disabled="status !== 'ready'"
        @keydown="onKeydown"
      />
      <button v-if="busy" class="send-btn stop" title="停止生成" aria-label="停止生成" @click="stop">
        <component :is="PhStopCircle" :size="20" weight="fill" aria-hidden="true" />
      </button>
      <button v-else class="send-btn" :disabled="!canSend" :title="modeLabel()" :aria-label="modeLabel()" @click="send()">
        <component :is="PhPaperPlaneRight" :size="19" weight="fill" aria-hidden="true" />
      </button>
    </div>
    <p class="ai-foot">
      回答由 AI 基于本站文档生成（{{ modeLabel() }}），可能存在偏差；关键信息请以学校正式通知为准。
    </p>
  </div>
</template>

<style scoped>
.ai-chat {
  display: flex;
  flex-direction: column;
  height: calc(100dvh - 13rem);
  min-height: 480px;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius);
  background: var(--vp-c-bg-elv);
  overflow: hidden;
}
.ai-chat.compact {
  height: 100%;
  min-height: 0;
  border: none;
  border-radius: 0;
}

/* 头部 */
.ai-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid var(--vp-c-divider);
  color: var(--hs2-blue);
}
.head-title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}
.head-title strong {
  color: var(--vp-c-text-1);
  font-size: 1rem;
  letter-spacing: 0.01em;
  display: block;
  line-height: 1.3;
}
.head-meta {
  display: block;
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
  font-weight: 400;
  font-family: var(--vp-font-family-mono);
}

/* 模式切换 */
.ai-modes {
  display: flex;
  gap: 0.4rem;
  padding: 0.6rem 1rem 0;
}
.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--vp-c-border);
  background: transparent;
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s;
}
.mode-btn:hover { border-color: var(--hs2-blue); color: var(--hs2-blue); }
.mode-btn.active {
  background: var(--hs2-blue-soft);
  border-color: var(--hs2-blue-soft-2);
  color: var(--hs2-blue);
  font-weight: 600;
}

/* 提示条 */
.ai-notice {
  margin: 0.75rem 1rem 0;
  padding: 0.7rem 0.9rem;
  border: 1px dashed var(--vp-c-border);
  border-radius: var(--hs2-radius-sm);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 0.84rem;
  line-height: 1.7;
  display: flex;
  gap: 0.5rem;
}
.ai-notice svg { flex: none; margin-top: 0.2rem; color: var(--vp-c-warning, #b8860b); }
.ai-notice a { color: var(--vp-c-brand-1); text-decoration: underline; text-underline-offset: 3px; }

/* 消息列表 */
.ai-list {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  scroll-behavior: smooth;
}
.msg { display: flex; flex-direction: column; max-width: 92%; }
.msg.user { align-self: flex-end; align-items: flex-end; }
.msg.bot { align-self: flex-start; }
.msg.user .bubble {
  background: var(--hs2-blue);
  color: #fff;
  padding: 0.55rem 0.85rem;
  border-radius: 12px 12px 3px 12px;
  font-size: 0.9rem;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 回答排版 */
.answer {
  font-size: 0.9rem;
  line-height: 1.8;
  color: var(--vp-c-text-1);
  word-break: break-word;
}
.answer :deep(p) { margin: 0.35em 0; }
.answer :deep(ul), .answer :deep(ol) { padding-left: 1.3em; margin: 0.35em 0; }
.answer :deep(li) { margin: 0.2em 0; }
.answer :deep(strong) { color: var(--vp-c-text-1); }
.answer :deep(a) { color: var(--vp-c-brand-1); text-decoration: underline; text-underline-offset: 3px; }
.answer :deep(code) {
  background: var(--vp-c-bg-soft);
  padding: 0.1em 0.4em;
  border-radius: 4px;
  font-size: 0.86em;
}
.answer :deep(h1), .answer :deep(h2), .answer :deep(h3), .answer :deep(h4) {
  font-size: 0.95rem;
  margin: 0.7em 0 0.3em;
  border: none;
  padding: 0;
  letter-spacing: 0;
}
.answer :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
  font-size: 0.85em;
  display: block;
  overflow-x: auto;
}
.answer :deep(th), .answer :deep(td) {
  border: 1px solid var(--vp-c-border);
  padding: 0.3em 0.6em;
}
.answer.err { color: var(--vp-c-danger-1, #c0392b); }

/* 引用角标 */
.answer :deep(.cit) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.15em;
  height: 1.15em;
  margin: 0 0.12em;
  padding: 0 0.15em;
  border-radius: 4px;
  background: var(--hs2-blue-soft-2);
  color: var(--hs2-blue-deep) !important;
  font-size: 0.68em;
  font-weight: 700;
  text-decoration: none !important;
  vertical-align: super;
  line-height: 1;
  cursor: pointer;
}
.answer :deep(.cit:hover) { background: var(--hs2-blue); color: #fff !important; }

/* 来源 chips */
.sources {
  margin-top: 0.6rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}
.src-label {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--vp-c-text-3);
  font-size: 0.75rem;
}
.src-chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0.18rem 0.55rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  font-size: 0.74rem;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  transition: all 0.15s;
}
.src-chip:hover {
  border-color: var(--hs2-blue);
  color: var(--hs2-blue);
}

/* 检索结果 */
.results-title {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.84rem;
  color: var(--vp-c-text-2);
  margin-bottom: 0.5rem;
}
.result-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius-sm);
  background: var(--vp-c-bg);
  margin-bottom: 0.5rem;
  text-decoration: none;
  transition: border-color 0.15s, transform 0.15s;
}
.result-card:hover { border-color: var(--hs2-blue); transform: translateY(-1px); }
.rc-page {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
.rc-snippet {
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.no-hit {
  font-size: 0.84rem;
  color: var(--vp-c-text-2);
  padding: 0.6rem 0.8rem;
  border: 1px dashed var(--vp-c-divider);
  border-radius: var(--hs2-radius-sm);
}

/* 打字动画 */
.typing {
  display: inline-flex;
  gap: 4px;
  padding: 0.4rem 0;
}
.typing i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-text-3);
  animation: blink 1.2s infinite ease-in-out;
}
.typing i:nth-child(2) { animation-delay: 0.2s; }
.typing i:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}

/* 空状态 */
.ai-empty {
  margin: auto 0;
  text-align: center;
  padding: 1.5rem 0.5rem;
}
.empty-icon { color: var(--hs2-blue); opacity: 0.85; }
.empty-title {
  margin-top: 0.8rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.empty-sub {
  margin: 0.4rem auto 1.2rem;
  max-width: 34em;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  line-height: 1.7;
}
.suggest {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  max-width: 36em;
  margin: 0 auto;
}
.suggest-item {
  padding: 0.42rem 0.85rem;
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s;
}
.suggest-item:hover:not(:disabled) {
  border-color: var(--hs2-blue);
  color: var(--hs2-blue);
  background: var(--hs2-blue-soft);
}
.suggest-item:disabled { opacity: 0.5; cursor: not-allowed; }

/* 消息操作 */
.msg-ops {
  margin-top: 0.35rem;
  display: flex;
  gap: 0.25rem;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition: all 0.15s;
}
.icon-btn:hover { background: var(--vp-c-bg-soft); color: var(--vp-c-brand-1); }
.head-actions { flex: none; }

/* 输入区 */
.ai-input-row {
  display: flex;
  align-items: flex-end;
  gap: 0.55rem;
  padding: 0.75rem 1rem 0.4rem;
  border-top: 1px solid var(--vp-c-divider);
}
.ai-input-row textarea {
  flex: 1;
  resize: none;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius-sm);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 0.9rem;
  line-height: 1.6;
  outline: none;
  transition: border-color 0.15s;
  max-height: 8em;
}
.ai-input-row textarea:focus { border-color: var(--hs2-blue); }
.ai-input-row textarea:disabled { opacity: 0.55; }
.send-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 50%;
  background: var(--hs2-blue);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.send-btn:hover:not(:disabled) { background: var(--hs2-blue-deep); }
.send-btn:active:not(:disabled) { transform: scale(0.94); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn.stop { background: var(--vp-c-danger-1, #c0392b); }

.ai-foot {
  padding: 0 1rem 0.6rem;
  font-size: 0.7rem;
  color: var(--vp-c-text-3);
  margin: 0;
  line-height: 1.5;
}
</style>
