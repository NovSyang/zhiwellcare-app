<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import type { DeviceLibraryItem } from '../../stores/deviceLibrary'

defineProps<{ item: DeviceLibraryItem }>()
const emit = defineEmits<{ close: [] }>()

const STEPS: Array<{ title: string; detail: string }> = [
  { title: '检查电量', detail: '在设备首页查看电量显示，电量低于 20% 时请先给设备充电。' },
  { title: '靠近设备', detail: '让设备与本机保持在 1 米以内，中间避免金属物体或墙体遮挡。' },
  { title: '重启蓝牙', detail: '关闭再开启本机蓝牙，然后重新连接设备。' },
  { title: '重启设备', detail: '若仍无法连接，请长按设备电源键重启后再试一次。' },
]

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="device-dialog-backdrop" @click.self="emit('close')">
      <section class="device-dialog selfcheck-dialog" role="dialog" aria-modal="true" aria-label="故障自检">
        <header>
          <div>
            <p class="eyebrow">Device</p>
            <h2>故障自检</h2>
          </div>
          <button type="button" class="button" @click="emit('close')">关闭</button>
        </header>

        <p class="muted small">
          如果 {{ item.alias }} 无法连接，请按以下顺序逐项检查：
        </p>

        <ol class="selfcheck-steps">
          <li v-for="(step, index) in STEPS" :key="index">
            <span class="selfcheck-index" aria-hidden="true">{{ index + 1 }}</span>
            <span class="selfcheck-body">
              <strong>{{ step.title }}</strong>
              <small class="muted">{{ step.detail }}</small>
            </span>
          </li>
        </ol>

        <div class="compliance-note">
          <span aria-hidden="true">💡</span>
          <p>以上为演示用自检步骤。正式版会结合连接日志给出具体处理建议，多数掉线可通过“重新连接”自动恢复。</p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.selfcheck-dialog { display: flex; flex-direction: column; gap: 14px; }
.selfcheck-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.selfcheck-steps li { display: flex; align-items: flex-start; gap: 12px; }
.selfcheck-index {
  width: 26px; height: 26px; flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 50%; background: var(--grad-brand-soft); color: #fff;
  font-size: 13px; font-weight: 700;
}
.selfcheck-body { display: grid; gap: 2px; }
.selfcheck-body strong { font-size: 14px; }
.selfcheck-body small { font-size: 12px; line-height: 1.7; }
</style>
