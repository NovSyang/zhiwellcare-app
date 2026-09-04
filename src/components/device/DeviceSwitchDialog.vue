<script setup lang="ts">
import DeviceConnectionPanel from './DeviceConnectionPanel.vue'

const emit = defineEmits<{ close: []; connected: [] }>()

// 弹窗打开期间不会断开旧设备，只有用户确认连接新设备时才执行切换。
function connected(): void {
  emit('connected')
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="device-dialog-backdrop" @click.self="emit('close')">
      <section class="device-dialog" role="dialog" aria-modal="true" aria-label="更换训练设备">
        <header><div><p class="eyebrow">Device</p><h2>更换训练设备</h2></div><button class="button" @click="emit('close')">关闭</button></header>
        <p class="muted">取消不会影响当前连接或已保存的设备绑定。</p>
        <DeviceConnectionPanel mode="replace" @connected="connected" />
      </section>
    </div>
  </Teleport>
</template>
