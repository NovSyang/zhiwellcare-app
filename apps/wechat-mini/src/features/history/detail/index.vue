<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import Taro, { useDidShow, useLoad, useUnload } from '@tarojs/taro'
import type { TrainingRecord } from '@/shared/core'
import { getTrainingRepository } from '../../../app/MiniServices'
import { presentSavedTraining } from '../../../app/TrainingRecordPresentation'
import { formatDateTime, formatDuration } from '../../../utils/DateTimeFormatter'
import { supportsReplay } from '../replay/ReplayCanvasFactory'
import { useTrainingReplayPlayer } from '../replay/useTrainingReplayPlayer'
import { createReplayReturn, discardReplayReturn, REPLAY_RETURN, takeReplayReturn, type ReplayPosition } from '../replay/ReplayReturn'

defineOptions({ name: 'TrainingRecordPage' })

const record = shallowRef<TrainingRecord | null>(null)
const loading = ref(true)
const error = ref('')
const expanding = ref(false)
const hasReplay = computed(() => supportsReplay(record.value))
const details = computed(() => record.value ? presentSavedTraining(record.value) : null)
const player = useTrainingReplayPlayer('#replay-canvas')
const { elapsed, duration, playing, trajectory, ready: replayReady, error: replayError } = player
let unloaded = false
let returnTicket = ''

useDidShow(() => {
  const position = takeReplayReturn(returnTicket)
  if (position) player.setPosition(position)
})
useUnload(() => { unloaded = true; discardReplayReturn(returnTicket) })
useLoad(async (options) => {
  try {
    const id = options.id ?? ''
    if (!id.trim()) throw new Error('缺少训练记录编号。')
    const stored = await getTrainingRepository().getById(id)
    if (!unloaded) {
      record.value = stored
      if (stored) player.setRecord(stored)
    }
  } catch (failure) {
    if (!unloaded) error.value = failure instanceof Error ? failure.message : '读取训练记录失败。'
  } finally {
    if (!unloaded) loading.value = false
  }
})

/** 打开全屏前停止内嵌播放，返回事件只更新显示进度。 */
async function expand() {
  if (!record.value || !replayReady.value || expanding.value) return
  expanding.value = true
  player.pause()
  const { elapsed, trajectory } = player.getPosition()
  discardReplayReturn(returnTicket)
  const ticket = createReplayReturn()
  returnTicket = ticket
  try {
    error.value = ''
    await Taro.navigateTo({
      url: `/features/history/replay/index?id=${encodeURIComponent(record.value.id)}&elapsed=${elapsed}&trajectory=${Number(trajectory)}&ticket=${ticket}`,
      events: {
        [REPLAY_RETURN]: (position: ReplayPosition) => {
          if (!unloaded && ticket === returnTicket && position) {
            discardReplayReturn(ticket)
            player.setPosition(position)
          }
        },
      },
    })
  } catch {
    discardReplayReturn(ticket)
    error.value = '暂时无法打开全屏回放，请重试。'
  }
  finally { expanding.value = false }
}

async function removeRecord() {
  if (!record.value) return
  try {
    const decision = await Taro.showModal({ title: '删除训练记录', content: '训练摘要与本地回放将一并删除。' })
    if (!decision.confirm) return
    player.pause()
    await getTrainingRepository().delete(record.value.id)
    await Taro.navigateBack()
  } catch (failure) { error.value = failure instanceof Error ? failure.message : '删除训练记录失败。' }
}
</script>

<template>
  <view class="mini-page">
    <text v-if="loading" class="mini-description">正在读取训练记录…</text>
    <template v-if="record">
      <text class="mini-heading">{{ record.gameName }}</text>
      <view class="mini-card">
        <text class="mini-card-title">训练摘要</text>
        <text class="mini-description">{{ formatDateTime(record.completedAt) }}</text>
        <text class="mini-description">有效时长 {{ formatDuration(record.result.durationMs) }}</text>
        <text v-if="record.device" class="mini-description">{{ record.device.modelName }}</text>
        <text v-for="metric in details?.metrics ?? []" :key="metric.label" class="mini-description">
          {{ metric.label }} · {{ metric.value }}
        </text>
      </view>
      <view v-if="hasReplay" class="mini-card">
        <text class="mini-card-title">训练回放</text>
        <button v-if="replayReady" size="mini" :disabled="expanding" @tap="expand">展开全屏</button>
        <text v-if="replayError" class="mini-error">{{ replayError }}</text>
        <button v-if="replayError" size="mini" @tap="player.refresh">重试回放</button>
        <canvas id="replay-canvas" type="2d" class="mini-replay-canvas" />
        <slider v-if="replayReady && duration > 0" :max="duration" :value="Math.round(elapsed)" @change="player.seek" />
        <button v-if="replayReady" class="mini-primary" @tap="player.togglePlay">{{ playing ? '暂停回放' : '播放回放' }}</button>
        <button v-if="replayReady" @tap="player.switchMode">{{ trajectory ? '返回动态回放' : '查看完整轨迹' }}</button>
      </view>
      <text v-else class="mini-description">这条记录的回放不可用。</text>
      <view v-for="section in details?.sections ?? []" :key="section.title" class="mini-card">
        <text class="mini-card-title">{{ section.title }}</text>
        <text v-for="item in section.items" :key="item.label" class="mini-description">
          {{ item.label }} · {{ item.value }} {{ item.detail }}
        </text>
      </view>
      <button class="mini-danger" @tap="removeRecord">删除此训练记录</button>
    </template>
    <text v-else-if="!loading && !error" class="mini-description">这条训练记录已不存在。</text>
    <text v-if="error" class="mini-error">{{ error }}</text>
  </view>
</template>

<style>
/* 回放画布按容器宽度布局，避免在小屏拉伸轨迹比例。 */
.mini-replay-canvas {
  display: block;
  width: 100%;
  height: 410px;
  margin-top: 18px;
  border-radius: 20px;
  background: var(--canvas-bg);
}
</style>
