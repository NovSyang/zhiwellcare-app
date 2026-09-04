<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import type { ITrainingReplayPlayer, ReplayMode, ReplayPlayerSnapshot } from '../../core/replay/ITrainingReplayPlayer'
import type { TrainingRecord } from '../../core/training/TrainingRecord'
import { getGameModule } from '../../games/GameRegistry'

const props = defineProps<{ record: TrainingRecord }>()
const host = ref<HTMLElement | null>(null)
const mode = ref<ReplayMode>('dynamic')
const snapshot = ref<ReplayPlayerSnapshot>(emptySnapshot())
const loadError = ref('')
const unavailableMessage = ref('')
const ready = ref(false)
let player: ITrainingReplayPlayer | null = null
let unsubscribe: (() => void) | null = null

onMounted(async () => { await mountPlayer() })
onBeforeUnmount(cleanup)
watch(() => props.record, () => { void mountPlayer() })
watch(mode, (next) => player?.setMode(next))

/** 每次切换记录都新建对应游戏播放器，避免 Pixi Ticker 和 Canvas 残留。 */
async function mountPlayer(): Promise<void> {
  cleanup()
  snapshot.value = emptySnapshot()
  loadError.value = ''
  unavailableMessage.value = ''
  const replay = props.record.replay
  if (!replay) return
  const module = getGameModule(props.record.gameId)
  if (!module) { unavailableMessage.value = '当前版本无法识别该游戏，暂不能播放历史轨迹。'; return }
  player = module.createReplayPlayer()
  if (!player) { unavailableMessage.value = '当前游戏暂不支持历史回放。'; return }
  await nextTick()
  if (!host.value) return
  try {
    await player.mount(host.value)
    unsubscribe = player.onChanged((next) => { snapshot.value = next })
    // Vue Props 会被深度代理；播放器内部还会生成受限的独立普通对象快照。
    player.load(toRaw(replay))
    player.setMode(mode.value)
    ready.value = true
  } catch (error) {
    cleanup()
    loadError.value = error instanceof Error ? `回放数据加载失败：${error.message}` : '回放数据加载失败，请稍后重试。'
  }
}

function cleanup(): void {
  unsubscribe?.()
  unsubscribe = null
  player?.destroy()
  player = null
  ready.value = false
}
function toggle(): void { snapshot.value.state === 'playing' ? player?.pause() : player?.play() }
function restart(): void { player?.restart() }
function setRate(rate: number): void { player?.setPlaybackRate(rate) }
function seek(event: Event): void { player?.seek(Number((event.target as HTMLInputElement).value)) }
function format(value: number): string { const seconds = Math.floor(value / 1_000); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` }
function emptySnapshot(): ReplayPlayerSnapshot { return { state: 'idle', currentTimeMs: 0, durationMs: 0, playbackRate: 1 } }
</script>

<template>
  <section class="replay-panel">
    <template v-if="record.replay && !loadError && !unavailableMessage"><div class="replay-tabs"><button class="button" :class="{ primary: mode === 'dynamic' }" @click="mode = 'dynamic'">动态回放</button><button class="button" :class="{ primary: mode === 'trajectory' }" @click="mode = 'trajectory'">完整轨迹</button></div><div ref="host" class="replay-host"></div><div v-if="ready && mode === 'dynamic'" class="replay-controls"><button class="button primary" @click="toggle">{{ snapshot.state === 'playing' ? '暂停' : '播放' }}</button><button class="button" @click="restart">重新开始</button><input type="range" min="0" :max="snapshot.durationMs" :value="snapshot.currentTimeMs" @input="seek"><span>{{ format(snapshot.currentTimeMs) }} / {{ format(snapshot.durationMs) }}</span><div class="row"><button v-for="rate in [0.5, 1, 2]" :key="rate" class="button" :class="{ primary: snapshot.playbackRate === rate }" @click="setRate(rate)">{{ rate }}x</button></div></div><p v-else-if="ready" class="muted small">完整轨迹展示训练当时保存的二维运动事实，不重新执行游戏判定。</p></template>
    <p v-else-if="loadError" class="error replay-empty">{{ loadError }}</p><p v-else-if="unavailableMessage" class="muted replay-empty">{{ unavailableMessage }}</p><p v-else class="muted replay-empty">该训练记录创建于轨迹回放功能启用前，暂无训练轨迹数据。</p>
  </section>
</template>
