<script setup lang="ts">
// 全站图片灯箱: 点击正文区图片放大查看。
// 支持: 滚轮/双指捏合缩放(1x-8x)、按住拖动平移、
// 单击/双击在 1x/2x 间切换、点击遮罩或 Esc 关闭。
// 事件委托, 无需为每张图片单独绑定。
import { onMounted, onUnmounted, ref } from 'vue'
import {
  PhMagnifyingGlassPlus,
} from '@phosphor-icons/vue'

const MAX = 8
const MIN = 1

const src = ref('')
const open = ref(false)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)

const reset = () => {
  scale.value = 1
  tx.value = 0
  ty.value = 0
}

const clampScale = (v: number) => Math.min(MAX, Math.max(MIN, v))

const onClick = (e: MouseEvent) => {
  const t = e.target as HTMLElement
  if (t.tagName !== 'IMG') return
  // 内容区图片: 排除导航/侧栏/页脚/评论区与灯箱自身
  if (
    t.closest(
      '.img-lightbox, .VPNav, .VPSidebar, .VPFooter, .VPLocalNavOutline,' +
        ' .VPPageNav, .waline-wrapper, .wl-panel, .VPFlyout, .VPMenu'
    )
  )
    return
  src.value = (t as HTMLImageElement).currentSrc || (t as HTMLImageElement).src
  reset()
  open.value = true
}

// 双指手势刚结束的瞬间抑制 click, 避免捏合后误触发"切换缩放/关闭"
let pinchedAt = 0
const suppressClick = () => Date.now() - pinchedAt < 350

const close = () => {
  if (suppressClick()) return
  open.value = false
}

const onKey = (e: KeyboardEvent) => {
  if (!open.value) return
  if (e.key === 'Escape') close()
  if (e.key === '+' || e.key === '=') scale.value = clampScale(scale.value + 0.25)
  if (e.key === '-') scale.value = clampScale(scale.value - 0.25)
}

const onWheel = (e: WheelEvent) => {
  e.preventDefault()
  scale.value = clampScale(scale.value + (e.deltaY < 0 ? 0.25 : -0.25))
}

// 灯箱内点击图片本体: 在 1x 与 2x 间切换(不冒泡关闭)
const toggleZoom = (e: MouseEvent) => {
  e.stopPropagation()
  if (suppressClick()) return
  scale.value = scale.value >= 2 ? 1 : 2
  if (scale.value === 1) reset()
}

/* ------------------------ 指针: 单指拖动 + 双指捏合 ------------------------ */

const pointers = new Map<number, { x: number; y: number }>()
let dragging = false
let lastX = 0
let lastY = 0
// 捏合起手的参考量
let pinchStartDist = 0
let pinchStartScale = 1

const dist = () => {
  const [a, b] = [...pointers.values()]
  return Math.hypot(a.x - b.x, a.y - b.y)
}

const onPointerDown = (e: PointerEvent) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 2) {
    // 进入捏合: 取消拖动, 记录参考
    dragging = false
    pinchStartDist = dist()
    pinchStartScale = scale.value
  } else if (pointers.size === 1 && scale.value > 1) {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
  }
}

const onPointerMove = (e: PointerEvent) => {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size >= 2 && pinchStartDist > 0) {
    e.stopPropagation()
    scale.value = clampScale(pinchStartScale * (dist() / pinchStartDist))
    // 缩回 1x 时复位平移, 图片回中
    if (scale.value === MIN) {
      tx.value = 0
      ty.value = 0
    }
  } else if (dragging) {
    e.stopPropagation()
    tx.value += e.clientX - lastX
    ty.value += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
  }
}

const onPointerUp = (e: PointerEvent) => {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinchStartDist = 0
  if (pointers.size === 0) {
    dragging = false
    return
  }
  // 双指抬起一根后, 剩下的一根可继续拖动
  if (scale.value > 1) {
    const p = [...pointers.values()][0]
    dragging = true
    lastX = p.x
    lastY = p.y
    pinchedAt = Date.now()
  }
}

onMounted(() => {
  document.addEventListener('click', onClick)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onClick)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="img-lightbox"
      @click="close"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <img
        :src="src"
        alt="放大查看"
        :style="{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
        }"
        :class="{ zoomed: scale > 1, dragging }"
        @click="toggleZoom"
        @dragstart.prevent
      />
      <span class="img-lightbox-hint">
        <component :is="PhMagnifyingGlassPlus" :size="14" aria-hidden="true" />
        滚轮/双指缩放 · 放大后可拖动 · 点击图片切换 1x/2x · Esc 关闭
      </span>
    </div>
  </Teleport>
</template>
