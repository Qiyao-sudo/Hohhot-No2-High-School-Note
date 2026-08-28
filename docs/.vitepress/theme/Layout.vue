<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import ImageLightbox from './ImageLightbox.vue'
// 评论功能暂时下线 — 恢复步骤:
// 1. import WalineComment from './WalineComment.vue'
// 2. 在 #doc-after 插槽放回 <WalineComment v-if="frontmatter.comment" />
// 3. scripts/sync_doc.py 中给留言处页加回 "comment": True
// 4. 配置 WALINE_SERVERURL(见 docs/waline-setup.md)
</script>

<template>
  <DefaultTheme.Layout>
    <!-- 全站图片点击放大(layout-bottom 插槽保证始终渲染) -->
    <template #layout-bottom>
      <ImageLightbox />
    </template>
  </DefaultTheme.Layout>
</template>
