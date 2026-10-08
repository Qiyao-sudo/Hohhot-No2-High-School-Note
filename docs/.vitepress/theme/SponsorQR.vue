<script setup lang="ts">
// 赞助收款码卡片: 微信/支付宝两张并排, 卡片恒为白底(暗色模式下也保证可扫)。
// 图片交给全站灯箱(ImageLightbox 事件委托)——电脑端点击放大后用手机扫。
import { withBase } from 'vitepress'

const codes = [
  {
    name: '微信支付',
    dot: '#07c160',
    img: '/qr/wechat-qr.png',
    alt: '微信支付收款码',
  },
  {
    name: '支付宝',
    dot: '#1677ff',
    img: '/qr/alipay-qr.png',
    alt: '支付宝收款码',
  },
]
</script>

<template>
  <div class="sponsor-qr">
    <figure v-for="c in codes" :key="c.name" class="qr-card">
      <figcaption>
        <span class="dot" :style="{ background: c.dot }" aria-hidden="true"></span>
        {{ c.name }}
      </figcaption>
      <img :src="withBase(c.img)" :alt="c.alt" loading="lazy" />
    </figure>
    <p class="qr-hint">手机端长按或截图后识别，电脑端点击图片放大扫码。</p>
  </div>
</template>

<style scoped>
.sponsor-qr {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: stretch;
  gap: 1.2rem;
  margin: 1.8rem 0 0.6rem;
}

/* 卡片恒为白底: 二维码需要亮色静区, 暗色模式下以描边融入页面 */
.qr-card {
  margin: 0;
  padding: 1rem 1.1rem 0.9rem;
  background: #ffffff;
  border: 1px solid var(--vp-c-border);
  border-radius: var(--hs2-radius);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.7rem;
}

.qr-card figcaption {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.92rem;
  font-weight: 600;
  color: #26281f;
  letter-spacing: 0.02em;
}

.qr-card .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 覆盖 .vp-doc img 的通用图片样式(居中/边框/max-width), 保留 zoom-in 光标 */
.qr-card img {
  display: block;
  margin: 0;
  border: none;
  border-radius: var(--hs2-radius-sm);
  width: 100%;
  max-width: 200px;
  height: auto;
  cursor: zoom-in;
}

.qr-hint {
  flex-basis: 100%;
  margin: 0.4rem 0 0;
  text-align: center;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}

/* 窄屏两张卡片上下堆叠, 保证二维码有足够扫码尺寸 */
@media (max-width: 560px) {
  .sponsor-qr {
    flex-direction: column;
    align-items: center;
  }

  .qr-card {
    width: 100%;
    max-width: 260px;
  }
}
</style>
