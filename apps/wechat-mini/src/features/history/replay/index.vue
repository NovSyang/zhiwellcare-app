<script setup lang="ts">
import { ref } from 'vue'
import Taro, { useLoad, useUnload } from '@tarojs/taro'
import { getTrainingRepository } from '../../../app/MiniServices'
import { readImmersiveLayout } from '../../../platform/ImmersiveLayout'
import { formatDuration } from '../../../utils/DateTimeFormatter'
import { supportsReplay } from './ReplayCanvasFactory'
import { useTrainingReplayPlayer } from './useTrainingReplayPlayer'
import { REPLAY_RETURN, saveReplayReturn } from './ReplayReturn'

defineOptions({ name: 'FullscreenReplayPage' })

const insets = ref(readImmersiveLayout())
const error = ref('')
const loading = ref(true)
const player = useTrainingReplayPlayer('#fullscreen-replay-canvas', () => { insets.value = readImmersiveLayout() })
const { ready, playing, trajectory, elapsed, duration, error: replayError } = player
let opener: Pick<Taro.EventChannel, 'emit'> | undefined
let unloaded = false
let ticket = ''
let loaded = false

useLoad(async (options) => {
  const pages = Taro.getCurrentPages()
  opener = pages[pages.length - 1]?.getOpenerEventChannel?.() as Pick<Taro.EventChannel, 'emit'> | undefined
  ticket = options.ticket ?? ''
  try {
    const id = options.id ?? ''
    if (!id.trim()) throw new Error('缺少训练记录编号。')
    const record = await getTrainingRepository().getById(id)
    if (!record || !supportsReplay(record)) throw new Error('这条记录的回放不可用。')
    if (!unloaded) {
      player.setRecord(record, { elapsed: Number(options.elapsed), trajectory: options.trajectory === '1' })
      loaded = true
    }
  } catch (failure) {
    if (!unloaded) error.value = failure instanceof Error ? failure.message : '读取训练回放失败。'
  } finally {
    if (!unloaded) loading.value = false
  }
})

// 微信返回手势和页面内返回按钮都经过卸载，统一交还当前进度。
useUnload(() => {
  unloaded = true
  if (!loaded) return
  const position = player.getPosition()
  saveReplayReturn(ticket, position)
  try { opener?.emit?.(REPLAY_RETURN, position) }
  catch { /* 详情页会在回到前台时读取临时进度。 */ }
})

async function goBack() {
  player.pause()
  if (loaded) saveReplayReturn(ticket, player.getPosition())
  try {
    if (Taro.getCurrentPages().length > 1) await Taro.navigateBack()
    else await Taro.switchTab({ url: '/pages/profile/index' })
  } catch { error.value = '返回历史详情失败，请重试。' }
}
</script>

<template>
  <view class="immersive-shell" :style="insets">
    <canvas id="fullscreen-replay-canvas" type="2d" class="immersive-canvas" />
    <view class="immersive-toolbar">
      <button size="mini" class="immersive-button" @tap="goBack">返回详情</button>
      <view v-if="ready" class="immersive-row">
        <button size="mini" class="immersive-button" @tap="player.switchMode">{{ trajectory ? '动态回放' : '完整轨迹' }}</button>
        <button size="mini" class="immersive-button immersive-primary" :disabled="duration === 0" @tap="player.togglePlay">{{ playing ? '暂停' : '播放' }}</button>
      </view>
    </view>
    <view v-if="ready" class="fullscreen-replay-progress">
      <text>{{ formatDuration(elapsed) }} / {{ formatDuration(duration) }}</text>
      <slider v-if="duration > 0" :max="duration" :value="Math.round(elapsed)" @change="player.seek" />
    </view>
    <view v-if="loading || error || replayError" class="fullscreen-replay-message">
      <text>{{ error || replayError || '正在读取训练回放…' }}</text>
      <button v-if="replayError" size="mini" class="immersive-button" @tap="player.refresh">重试回放</button>
    </view>
  </view>
</template>

<style>
/* 播放控件悬浮在底部安全区，Canvas 使用真实横屏窗口。 */
.fullscreen-replay-progress {
  position: absolute;
  bottom: var(--safe-bottom, 12px);
  left: var(--safe-left, 12px);
  right: var(--safe-right, 12px);
  display: flex;
  align-items: center;
  gap: 8PX;
  padding: 3PX 12PX;
  border-radius: 16px;
  background: rgba(8, 22, 48, 0.9);
  font-size: 14PX;
}
.fullscreen-replay-progress slider { flex: 1; margin: 4px 8px; }
.fullscreen-replay-message {
  position: absolute;
  left: 20%;
  right: 20%;
  top: 42%;
  padding: 20px;
  border-radius: 16px;
  background: #10264a;
  text-align: center;
}
</style>
