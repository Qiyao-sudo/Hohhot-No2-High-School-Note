<script setup lang="ts">
import { withBase } from 'vitepress'

// 首页 Hero 与板块目录(真实校园航拍图来自源文档"航拍影像"板块)
const groups = [
  {
    name: '新生',
    items: [
      { title: '新生须知', desc: '录取 · 军训 · 校服', link: '/freshman' },
      { title: '日常生活', desc: '作息 · 食堂 · 住宿', link: '/daily' },
    ],
  },
  {
    name: '校园组织',
    items: [
      { title: '学生会 国旗班 播音站', desc: '加入与选拔', link: '/student-org' },
      { title: '社团相关', desc: '社团选择', link: '/clubs' },
    ],
  },
  {
    name: '政策与传统',
    items: [
      { title: '日常学习政策及环境', desc: '分班 · 课间 · 作业', link: '/study-policy' },
      { title: '日常管理', desc: '手机 · 头发 · 校规', link: '/management' },
      { title: '金川校区情况', desc: '常见问题 · 宿舍', link: '/jinchuan' },
      { title: '二中传统', desc: '校园景点', link: '/tradition' },
    ],
  },
  {
    name: '学习与互动',
    items: [
      { title: '学习板块', desc: '通用与分科方法', link: '/study' },
      { title: '留言处', desc: '匿名提问 · 及时解答', link: '/messages' },
      { title: '后记', desc: '创办一年有感', link: '/afterword' },
    ],
  },
]
</script>

<template>
  <div>
    <section class="home-hero">
      <div>
        <p class="home-hero-eyebrow">呼和浩特市第二中学</p>
        <h1 class="home-hero-title">呼市二中<br />学习生活指导</h1>
        <p class="home-hero-sub">
          来自 2022 级学长与所有参与建设的二中人。军训怎么过、食堂吃什么、
          怎么选社团、如何规划学习，这里都有过来人的答案。
        </p>
        <div class="home-hero-actions">
          <a class="btn btn-primary" :href="withBase('/freshman')">从新生须知开始</a>
          <a class="btn btn-ghost" :href="withBase('/messages')">去留言区提问</a>
        </div>
      </div>
      <figure class="home-hero-figure">
        <img :src="withBase('/images/hero.jpg')" alt="呼市二中校园" />
      </figure>
    </section>

    <section class="home-section">
      <h2 class="home-section-title">全部板块</h2>
      <div class="home-groups">
        <div v-for="g in groups" :key="g.name" class="home-group">
          <h3>{{ g.name }}</h3>
          <ul>
            <li v-for="it in g.items" :key="it.link">
              <a :href="withBase(it.link)">
                <span>{{ it.title }}</span>
                <span class="desc">{{ it.desc }}</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <section class="home-cta">
      <div class="home-cta-inner">
        <p>
          有问题？在留言处匿名提问（只需昵称，无需注册登录），会有学长学姐及时解答。
        </p>
        <a class="btn-primary" :href="withBase('/messages')">前往留言处</a>
      </div>
    </section>
  </div>
</template>
