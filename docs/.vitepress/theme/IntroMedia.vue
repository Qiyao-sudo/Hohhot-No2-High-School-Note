<script setup lang="ts">
// 首页"文档简介"面板底部的媒体行: 音频播放器 + 源文档链接 + 校歌图片(点击放大)
// 路径统一经 withBase 处理(适配 GitHub Pages 子路径部署)
import { onMounted, onUnmounted, ref } from 'vue'
import { withBase } from 'vitepress'

defineProps<{
  audio?: string
  name?: string
  thumb?: string
  link: string
}>()

const zoom = ref(false)

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') zoom.value = false
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <footer class="doc-intro-foot">
    <div v-if="audio" class="doc-intro-audio">
      <span v-if="name" class="audio-name">{{ name }}</span>
      <audio controls preload="none" :src="withBase(audio)">
        您的浏览器不支持音频播放
      </audio>
    </div>
    <a :href="link">查看源文档</a>
    <img
      v-if="thumb"
      class="thumb"
      :src="withBase(thumb)"
      alt="校歌（点击放大）"
      title="点击放大查看"
      @click="zoom = true"
    />
    <Teleport to="body">
      <div v-if="zoom" class="img-lightbox" @click="zoom = false">
        <img :src="withBase(thumb)" alt="校歌" />
        <span class="img-lightbox-hint">点击任意处或按 Esc 关闭</span>
      </div>
    </Teleport>
  </footer>
</template>
