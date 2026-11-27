<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from 'vue'
import Taro, { useDidHide, useReady, useLoad, useUnload } from '@tarojs/taro'
import type { TrainingRecord } from '@/shared/core'
import { TARGET_REACH_GAME_ID } from '@/shared/target-config'
import { TRAJECTORY_FOLLOW_GAME_ID } from '@/shared/trajectory'
import { RIVER_DRIFT_GAME_ID } from '@/shared/river'
import { KART_RACING_GAME_ID } from '@/shared/kart'
import { getTrainingRepository } from '../../../app/MiniServices'
import { isMiniTrainingGameId } from '../../../app/TrainingGames'
import { presentSavedTraining } from '../../../app/TrainingRecordPresentation'
import { queryCanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { TargetReachReplayCanvas } from './TargetReachReplayCanvas'
import { TrajectoryFollowReplayCanvas } from './TrajectoryFollowReplayCanvas'
import { RiverDriftReplayCanvas } from './RiverDriftReplayCanvas'
import { KartRacingReplayCanvas } from './KartRacingReplayCanvas'

defineOptions({ name: 'TrainingRecordPage' })

const record = shallowRef<TrainingRecord | null>(null)
const loading = ref(true)
const error = ref('')
const playing = ref(false)
const trajectory = ref(false)
const elapsed = ref(0)
const duration = computed(() => record.value?.replay?.durationMs ?? 0)
const hasReplay = computed(() => !!record.value?.replay && isMiniTrainingGameId(record.value.gameId))
const details = computed(() => record.value ? presentSavedTraining(record.value) : null)
const replayReady = ref(false)
let id = ''
let frame: number | null = null
let lastFrameTime: number | null = null
/** 历史按记录中的游戏选择画布，播放、拖动和暂停由页面统一处理。 */
const replayCanvases = {
  [TARGET_REACH_GAME_ID]: TargetReachReplayCanvas,
  [TRAJECTORY_FOLLOW_GAME_ID]: TrajectoryFollowReplayCanvas,
  [RIVER_DRIFT_GAME_ID]: RiverDriftReplayCanvas,
  [KART_RACING_GAME_ID]: KartRacingReplayCanvas,
}
let canvas: InstanceType<(typeof replayCanvases)[keyof typeof replayCanvases]> | null = null
let unloaded = false

useLoad((options) => { id = options.id ?? '' })
useReady(() => { void loadRecord() })
useDidHide(pause)
useUnload(() => { unloaded = true; pause(); canvas = null })

async function loadRecord() {
  if (!id) {
    loading.value = false
    return
  }
  try {
    const stored = await getTrainingRepository().getById(id)
    if (unloaded) return
    record.value = stored
    loading.value = false
    if (stored?.replay && isMiniTrainingGameId(stored.gameId)) {
      await nextTick()
      const surface = await queryCanvasSurface('#replay-canvas')
      if (unloaded) return
      const ReplayCanvas = replayCanvases[stored.gameId]
      canvas = new ReplayCanvas(surface, stored.replay, stored.gameConfig)
      replayReady.value = true
      redraw()
    }
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '读取训练记录失败。'
  } finally { loading.value = false }
}

/** 画布帧推动回放，切出页面后暂停并释放尚未执行的帧。 */
function tick(stamp?: number) {
  if (!playing.value || !canvas) return
  const now = typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : Date.now()
  if (lastFrameTime !== null) elapsed.value = Math.min(duration.value, elapsed.value + Math.min(100, Math.max(0, now - lastFrameTime)))
  lastFrameTime = now
  redraw()
  if (elapsed.value >= duration.value) pause()
  else frame = canvas.node.requestAnimationFrame(tick)
}

function redraw() { canvas?.draw(elapsed.value, trajectory.value) }

function pause() {
  playing.value = false
  if (frame !== null) canvas?.node.cancelAnimationFrame(frame)
  frame = null
  lastFrameTime = null
}

function play() {
  if (!canvas || !duration.value) return
  if (playing.value) { pause(); return }
  if (elapsed.value >= duration.value) elapsed.value = 0
  trajectory.value = false
  playing.value = true
  frame = canvas.node.requestAnimationFrame(tick)
}

function seek(event: { detail: { value: number } }) {
  elapsed.value = Math.min(duration.value, Math.max(0, event.detail.value))
  redraw()
}

function switchMode() {
  pause()
  trajectory.value = !trajectory.value
  redraw()
}

async function removeRecord() {
  if (!record.value) return
  try {
    const result = await Taro.showModal({ title: '删除训练记录', content: '训练摘要与本地回放将一并删除。' })
    if (!result.confirm) return
    pause()
    await getTrainingRepository().delete(id)
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
        <text class="mini-description">{{ new Date(record.completedAt).toLocaleString() }}</text>
        <text class="mini-description">有效时长 {{ Math.round(record.result.durationMs / 1000) }} 秒</text>
        <text v-if="record.device" class="mini-description">{{ record.device.modelName }}</text>
        <text v-for="metric in details?.metrics ?? []" :key="metric.label" class="mini-description">
          {{ metric.label }} · {{ metric.value }}
        </text>
      </view>
      <view v-if="hasReplay" class="mini-card">
        <text class="mini-card-title">训练回放</text>
        <canvas id="replay-canvas" type="2d" class="mini-replay-canvas" />
        <slider v-if="replayReady && duration > 0" :max="duration" :value="Math.round(elapsed)" @change="seek" />
        <button v-if="replayReady" class="mini-primary" @tap="play">{{ playing ? '暂停回放' : '播放回放' }}</button>
        <button v-if="replayReady" @tap="switchMode">{{ trajectory ? '返回动态回放' : '查看完整轨迹' }}</button>
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
