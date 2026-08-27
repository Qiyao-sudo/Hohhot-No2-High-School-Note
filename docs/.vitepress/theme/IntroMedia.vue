<script setup lang="ts">
// 首页"文档简介"面板底部的媒体行: 音频播放器 + 源文档链接 + 校歌图片。
// 图片点击放大由全局 ImageLightbox 组件处理(Layout 挂载)。
// 路径统一经 withBase 处理(适配 GitHub Pages 子路径部署)。
import { withBase } from 'vitepress'

defineProps<{
  audio?: string
  name?: string
  thumb?: string
  link: string
}>()
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
    />
  </footer>
</template>
