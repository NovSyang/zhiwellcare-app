import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import type { TrainingReplay } from '../src/core/replay/TrainingReplay'
import { defaultTargetReachGameConfig } from '../src/games/target-reach/TargetReachGameConfig'
import { getPlayerRadiusPx, normalizedToScreen } from '../src/games/target-reach/TargetReachViewportMapper'
import {
  copyTrainingReplay,
  createTargetReachReplayGeometry,
  resolveTargetReachGameConfig,
  TargetReachReplayPlayer,
} from '../src/games/target-reach/replay/TargetReachReplayPlayer'

describe('TargetReachReplayPlayer', () => {
  it('可加载 Vue 响应式 Replay，不会对 Proxy 执行 structuredClone', () => {
    const replay = reactive<TrainingReplay>({
      schemaVersion: 1,
      durationMs: 1200,
      sampleRateHz: 25,
      samples: [{ elapsedMs: 0, x: 0, y: 0 }, { elapsedMs: 40, x: 0.5, y: -0.5 }],
      events: [{ elapsedMs: 0, type: 'target-start', payload: { index: 1, targetX: 0.7, targetY: 0, ignored: () => undefined } }],
    })
    const player = new TargetReachReplayPlayer()

    const gameConfig = reactive({ targetDistance: 0.6, targetRadius: 0.12, playerRadius: 18 })
    // 先覆盖旧记录无渲染上下文，再覆盖带 Vue Proxy 配置的新记录。
    expect(() => player.load(replay)).not.toThrow()
    expect(() => player.load(replay, { gameConfig })).not.toThrow()
    expect(player.getSnapshot()).toMatchObject({ state: 'paused', durationMs: 1200, currentTimeMs: 0 })
  })

  it('读取有效历史视觉配置，其他字段继续使用默认值', () => {
    const config = resolveTargetReachGameConfig({
      targetDistance: 0.55,
      targetRadius: 0.11,
      playerRadius: 19,
      sessionDurationMs: 1,
    })

    expect(config).toMatchObject({ targetDistance: 0.55, targetRadius: 0.11, playerRadius: 19 })
    expect(config.sessionDurationMs).toBe(defaultTargetReachGameConfig.sessionDurationMs)
  })

  it('缺失或异常历史配置安全回退默认值', () => {
    expect(resolveTargetReachGameConfig(undefined)).toEqual(defaultTargetReachGameConfig)
    expect(resolveTargetReachGameConfig({
      targetDistance: 0,
      targetRadius: Number.NaN,
      playerRadius: '14',
    })).toEqual(defaultTargetReachGameConfig)
  })

  it.each([[320, 180], [640, 360], [960, 540]])('%d×%d 舞台复用统一坐标与半径规则', (width, height) => {
    const config = resolveTargetReachGameConfig({ targetDistance: 0.7, targetRadius: 0.13, playerRadius: 20 })
    const geometry = createTargetReachReplayGeometry(width, height, config)
    const center = normalizedToScreen({ x: 0, y: 0 }, geometry.viewport)
    const historicalTarget = normalizedToScreen({ x: 0.62, y: 0 }, geometry.viewport)

    expect((historicalTarget.x - center.x) / geometry.viewport.interactionScale).toBeCloseTo(0.62)
    expect(geometry.targetRadiusPx).toBeCloseTo(config.targetRadius * geometry.viewport.interactionScale)
    expect(geometry.playerRadiusPx).toBe(getPlayerRadiusPx(geometry.viewport.interactionScale, config.playerRadius))
  })

  it('复制时规范化无效数值并仅保留基础事件 payload', () => {
    const copy = copyTrainingReplay({
      schemaVersion: 1,
      durationMs: Number.NaN,
      sampleRateHz: -1,
      samples: [{ elapsedMs: -2, x: 2, y: -2 }, { elapsedMs: Number.NaN, x: 0, y: 0 }],
      events: [{ elapsedMs: -1, type: 'target-start', payload: { index: 1, callback: () => undefined } }],
    })

    expect(copy.durationMs).toBe(0)
    expect(copy.sampleRateHz).toBe(0)
    expect(copy.samples).toEqual([{ elapsedMs: 0, x: 1, y: -1 }])
    expect(copy.events).toEqual([{ elapsedMs: 0, type: 'target-start', payload: { index: 1 } }])
  })
})
