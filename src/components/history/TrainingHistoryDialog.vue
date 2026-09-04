<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import type { TrainingRecord } from '../../core/training/TrainingRecord'
import TrainingReplayPanel from './TrainingReplayPanel.vue'
import TrainingSummary from './TrainingSummary.vue'

defineProps<{ record: TrainingRecord }>()
const emit = defineEmits<{ close: [] }>()
// ESC 是明确的辅助关闭方式，避免长详情弹窗只能依赖鼠标操作。
function onKeydown(event: KeyboardEvent): void { if (event.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
function formatDate(value: number): string { return new Date(value).toLocaleString('zh-CN') }
</script>

<template><Teleport to="body"><div class="history-dialog-backdrop" @click.self="emit('close')"><section class="history-dialog" role="dialog" aria-modal="true" aria-label="训练详情"><header><div><p class="eyebrow">训练详情</p><h2>{{ record.gameName }}</h2><p class="muted small">{{ formatDate(record.completedAt) }}</p></div><button class="button danger" aria-label="关闭训练详情" @click="emit('close')">关闭</button></header><div class="history-dialog-body"><TrainingSummary :record="record" /><TrainingReplayPanel :record="record" /></div></section></div></Teleport></template>
