---
title: 文档助手
description: 基于本站文档的 AI 问答助手——问二中学习生活的问题、定位文档原文。
layout: page
aside: false
sidebar: false
---

<script setup>
import AssistantChat from '../.vitepress/theme/AssistantChat.vue'
</script>

<div class="assistant-page">

<header class="assistant-head">

# 文档助手

<p class="assistant-sub">
  问它任何关于二中学习生活的问题——它会检索本站全部文档，引用原文回答，并附上可点击的来源定位。
  也可以切换到「快速检索」，不经过 AI 直接定位文档段落。
</p>

</header>

<ClientOnly>
  <AssistantChat />
</ClientOnly>

<p class="assistant-note">
  后端部署与配置说明见<a href="../assistant-setup">文档助手部署指南</a>。
  助手回答基于本站文档生成，如有出入请以<a href="https://docs.qq.com/doc/DYm5PeUxOVmdEZmxs" target="_blank" rel="noopener">源文档</a>与学校正式通知为准。
</p>

</div>
