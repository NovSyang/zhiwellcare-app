<script setup lang="ts">
const emit = defineEmits<{ start: []; later: [] }>()
</script>

<template>
  <Teleport to="body">
    <div class="initial-range-prompt-backdrop">
      <section
        class="initial-range-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="initial-range-prompt-title"
      >
        <div class="initial-range-prompt-icon" aria-hidden="true">↔</div>
        <p class="eyebrow">Personal Range</p>
        <h2 id="initial-range-prompt-title">完成个人活动范围测量</h2>
        <p>设备已连接成功。为了让后续训练幅度更适合你，建议先测量手腕向前、向后、向左、向右的舒适活动范围。</p>
        <p class="muted small">整个过程约 1 分钟，每一步都会提供动作提示。请以舒适、安全为准，不要勉强。</p>
        <div class="initial-range-prompt-actions">
          <button type="button" class="button primary" @click="emit('start')">开始测量</button>
          <button type="button" class="button" @click="emit('later')">稍后</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
/* 首次提示高于普通页面控件；更新锁与 App 级判断负责避免其他弹窗叠加。 */
.initial-range-prompt-backdrop {
  position: fixed;
  z-index: 65;
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(16px, var(--app-safe-top)) max(16px, var(--app-safe-right)) max(16px, var(--app-safe-bottom)) max(16px, var(--app-safe-left));
  background: rgba(4, 20, 46, .56);
  backdrop-filter: blur(5px);
}
.initial-range-prompt {
  width: min(480px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 28px;
  border-radius: var(--radius-l);
  background: var(--c-bg);
  box-shadow: var(--shadow-lift);
  text-align: center;
}
.initial-range-prompt-icon {
  width: 58px;
  height: 58px;
  margin: 0 auto 14px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: var(--grad-brand);
  color: #fff;
  font-size: 30px;
  font-weight: 800;
}
.initial-range-prompt h2 { margin-bottom: 14px; }
.initial-range-prompt p { line-height: 1.75; }
.initial-range-prompt-actions { display: grid; gap: 10px; margin-top: 22px; }
.initial-range-prompt-actions .button { min-height: 48px; }

@media (max-width: 479px) {
  .initial-range-prompt { padding: 24px 18px; }
}
</style>
