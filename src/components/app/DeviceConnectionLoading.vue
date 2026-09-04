<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { connectionManager } from '../../app/AppServices'
import type { SensorConnectionSnapshot } from '../../core/sensor/SensorConnectionManager'

const connection = ref<SensorConnectionSnapshot>(connectionManager.getSnapshot())
const showSuccess = ref(false)
let unsubscribe: (() => void) | null = null
let hideTimer: number | null = null

// 启动和手动重连使用全局卡片；训练中恢复只由训练页的暂停提示处理。
const isGlobalWorkflow = computed(() => connection.value.operation === 'startup' || connection.value.operation === 'manual-reconnect')
const visible = computed(() => isGlobalWorkflow.value || showSuccess.value)

onMounted(() => {
  unsubscribe = connectionManager.onChanged((next) => {
    const wasGlobalWorkflow = connection.value.operation === 'startup' || connection.value.operation === 'manual-reconnect'
    connection.value = next
    if (isGlobalWorkflow.value) {
      showSuccess.value = false
      if (hideTimer !== null) window.clearTimeout(hideTimer)
    } else if (wasGlobalWorkflow && next.reconnectState === 'idle') {
      showSuccess.value = true
      hideTimer = window.setTimeout(() => { showSuccess.value = false }, 1200)
    }
  })
})
onBeforeUnmount(() => { unsubscribe?.(); if (hideTimer !== null) window.clearTimeout(hideTimer) })

const detail = computed(() => showSuccess.value && !isGlobalWorkflow.value
  ? '设备连接成功'
  : connection.value.message || '正在搜索并连接训练设备…')
const stepText = computed(() => connection.value.attemptNumber > 0
  ? `第 ${connection.value.attemptNumber} / ${connection.value.maxAttempts} 次尝试`
  : '')
</script>

<template>
  <aside v-if="visible" class="device-connection-loading" aria-live="polite">
    <span class="loading-spinner" :class="{ success: showSuccess && !isGlobalWorkflow }"></span>
    <div><strong>{{ showSuccess && !isGlobalWorkflow ? '设备已连接' : '正在连接设备' }}</strong><p>{{ detail }}</p><small v-if="stepText">{{ stepText }}</small></div>
  </aside>
</template>
