<script setup lang="ts">
// 全站图片灯箱: 点击正文区图片放大查看。
// 灯箱内支持滚轮缩放(1x-4x)、按住拖动平移、双击/点击图片在 1x/2x 间切换。
// 点击遮罩或按 Esc 关闭。事件委托, 无需为每张图片单独绑定。
import { onMounted, onUnmounted, ref } from 'vue'

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

const close = () => (open.value = false)

const onKey = (e: KeyboardEvent) => {
  if (!open.value) return
  if (e.key === 'Escape') close()
  if (e.key === '+' || e.key === '=') scale.value = Math.min(4, scale.value + 0.25)
  if (e.key === '-') scale.value = Math.max(1, scale.value - 0.25)
}

const onWheel = (e: WheelEvent) => {
  e.preventDefault()
  scale.value = Math.min(4, Math.max(1, scale.value + (e.deltaY < 0 ? 0.25 : -0.25)))
}

// 灯箱内点击图片本体: 在 1x 与 2x 间切换(不冒泡关闭)
const toggleZoom = (e: MouseEvent) => {
  e.stopPropagation()
  scale.value = scale.value >= 2 ? 1 : 2
  if (scale.value === 1) reset()
}

// 拖拽平移(缩放 > 1 时)
let dragging = false
let lastX = 0
let lastY = 0
const onPointerDown = (e: PointerEvent) => {
  if (scale.value <= 1) return
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
}
const onPointerMove = (e: PointerEvent) => {
  if (!dragging) return
  e.stopPropagation()
  tx.value += e.clientX - lastX
  ty.value += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
}
const onPointerUp = () => {
  dragging = false
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
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
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
        @pointerdown="onPointerDown"
        @dragstart.prevent
      />
      <span class="img-lightbox-hint">滚轮或 +/- 缩放 · 放大后可拖动 · 点击图片切换 1x/2x · Esc 关闭</span>
    </div>
  </Teleport>
</template>
