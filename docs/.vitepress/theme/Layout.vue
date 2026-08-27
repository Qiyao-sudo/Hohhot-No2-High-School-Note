<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import WalineComment from './WalineComment.vue'

const { frontmatter } = useData()
</script>

<template>
  <DefaultTheme.Layout>
    <template #doc-after>
      <!-- 在带 comment: true 的页面(如留言处)渲染 Waline 评论 -->
      <WalineComment v-if="frontmatter.comment" />
    </template>
  </DefaultTheme.Layout>
</template>
