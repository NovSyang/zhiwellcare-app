import { Application, Graphics, Text } from 'pixi.js'
import type { GameInput } from '../../core/game-input/GameInput'
import type { ITrainingGame } from '../../core/game/ITrainingGame'
import type { Direction } from '../../core/training/Direction'
import { TrainingSession } from '../../core/training/TrainingSession'
import type { TrainingSessionState } from '../../core/training/TrainingSessionState'
import {
  defaultTargetReachGameConfig,
  type TargetReachGameConfig,
} from './TargetReachGameConfig'
import type { TargetReachGameEvents } from './TargetReachGameEvents'
import { distanceBetween, getTargetPosition } from './TargetReachMath'
import {
  createTargetReachViewport,
  getPlayerRadiusPx,
  getTargetReachViewportInsets,
  normalizedToScreen,
} from './TargetReachViewportMapper'
import {
  buildTargetReachTrainingResult,
  type TargetAttemptResult,
  type TargetReachTrainingResult,
} from './TargetReachTrainingResult'

/** 使用归一化 GameInput 完成四方向目标触达训练的 PixiJS 游戏。 */
export class TargetReachGame implements ITrainingGame<TargetReachTrainingResult> {
  private app: Application | null = null
  private session = new TrainingSession()
  private latestInput: GameInput = emptyGameInput()
  private player: Graphics | null = null
  private target: Graphics | null = null
  private countdownText: Text | null = null
  private directionText: Text | null = null
  private resizeObserver: ResizeObserver | null = null
  private currentDirection: Direction | null = null
  private targetStartedAt = 0
  private targetStartedElapsedMs = 0
  private firstMovementAt: number | null = null
  private currentReactionTimeMs: number | null = null
  private targetHoldStartedElapsedMs: number | null = null
  private currentMaxInput = 0
  private attempts: TargetAttemptResult[] = []
  private lastNotifiedState: TrainingSessionState = 'idle'
  private renderedInteractionScale = -1

  constructor(
    private readonly config: TargetReachGameConfig = structuredClone(defaultTargetReachGameConfig),
    private readonly events: TargetReachGameEvents = {},
  ) {}

  async mount(container: HTMLElement): Promise<void> {
    this.destroy()
    const app = new Application()
    await app.init({
      resizeTo: container,
      antialias: true,
      background: '#08111f',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    container.appendChild(app.canvas)

    // 玩家球和目标圈的半径取决于最终视口，首次 render 时再绘制。
    const player = new Graphics()
    const target = new Graphics()
    const countdownText = new Text({ text: '', style: { fill: '#ffffff', fontSize: 72, fontWeight: '700' } })
    const directionText = new Text({ text: '', style: { fill: '#8fd8ff', fontSize: 22, fontWeight: '600' } })
    countdownText.anchor.set(0.5)
    directionText.anchor.set(0.5)
    target.visible = false
    directionText.visible = false
    app.stage.addChild(target, player, directionText, countdownText)

    this.app = app
    this.player = player
    this.target = target
    this.countdownText = countdownText
    this.directionText = directionText
    // 容器旋转或分屏后重新按最新 screen 计算目标、玩家和倒计时位置。
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.render(performance.now())))
    this.resizeObserver.observe(container)
    app.ticker.add(() => {
      const now = performance.now()
      this.update(now)
      this.render(now)
    })
  }

  setInput(input: GameInput): void {
    this.latestInput = input
    const state = this.session.getSnapshot().state
    if (!input.connected && (state === 'playing' || state === 'countdown')) this.pause()
  }

  start(): void {
    if (!this.latestInput.connected) throw new Error('开始训练前必须连接 BS-BT91')
    if (!this.latestInput.calibrated) throw new Error('开始训练前必须完成中心校准')

    this.attempts = []
    this.currentDirection = null
    this.currentReactionTimeMs = null
    this.targetHoldStartedElapsedMs = null
    this.session.start(performance.now(), 3000)
    this.notifySessionState()
  }

  pause(now = performance.now()): void {
    const state = this.session.getSnapshot(now).state
    if (state !== 'playing' && state !== 'countdown') return
    // 暂停会打断连续保持，恢复后必须重新满足完整 Hold 时间。
    this.targetHoldStartedElapsedMs = null
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'pause' })
    this.session.pause(now)
    this.notifySessionState()
  }

  resume(now = performance.now()): void {
    if (!this.latestInput.connected) throw new Error('传感器未连接，无法继续训练')
    if (!this.latestInput.calibrated) throw new Error('请重新完成中心校准后继续训练')

    if (this.session.getSnapshot(now).state !== 'paused') return
    this.session.resume(now)
    this.events.onReplayEvent?.({ elapsedMs: this.getTrainingElapsedMs(now), type: 'resume' })
    this.notifySessionState()
  }

  abort(): void {
    this.session.abort(performance.now())
    if (this.target) this.target.visible = false
    if (this.directionText) this.directionText.visible = false
    this.notifySessionState()
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.app?.destroy(true, { children: true })
    this.app = null
    this.player = null
    this.target = null
    this.countdownText = null
    this.directionText = null
    this.renderedInteractionScale = -1
  }

  private update(now: number): void {
    this.session.update(now)
    this.notifySessionState()
    const snapshot = this.session.getSnapshot(now)
    if (snapshot.state === 'countdown' || snapshot.state !== 'playing') return

    if (snapshot.playingElapsedMs >= this.config.sessionDurationMs || this.attempts.length >= this.config.targetCount) {
      this.complete(now)
      return
    }
    if (this.currentDirection === null) {
      this.beginNextTarget(now)
      return
    }
    if (this.getCurrentTargetElapsedMs(now) >= this.config.targetTimeoutMs) {
      this.finishCurrentTarget(now, false)
      return
    }
    this.updateCurrentAttempt(now)
  }

  private beginNextTarget(now: number): void {
    this.currentDirection = this.pickNextDirection()
    this.targetStartedAt = now
    this.targetStartedElapsedMs = this.session.getSnapshot(now).playingElapsedMs
    this.firstMovementAt = null
    this.currentReactionTimeMs = null
    this.targetHoldStartedElapsedMs = null
    this.currentMaxInput = 0
    if (this.target) this.target.visible = true
    this.events.onTargetChanged?.(this.currentDirection, this.attempts.length + 1)
    const targetPoint = getTargetPosition(this.currentDirection, this.config.targetDistance)
    this.events.onReplayEvent?.({
      elapsedMs: this.getTrainingElapsedMs(now),
      type: 'target-start',
      payload: {
        index: this.attempts.length + 1,
        direction: this.currentDirection,
        targetX: targetPoint.x,
        targetY: targetPoint.y,
      },
    })
  }

  private updateCurrentAttempt(now: number): void {
    if (!this.currentDirection) return
    const targetPoint = getTargetPosition(this.currentDirection, this.config.targetDistance)
    const currentPoint = { x: this.latestInput.x, y: this.latestInput.y }
    const magnitude = Math.max(Math.abs(currentPoint.x), Math.abs(currentPoint.y))
    this.currentMaxInput = Math.max(this.currentMaxInput, magnitude)
    if (this.firstMovementAt === null && magnitude >= this.config.movementThreshold) {
      this.firstMovementAt = now
      // 反应时间在首次有效动作时固定，不会受后续暂停影响。
      this.currentReactionTimeMs = this.getCurrentTargetElapsedMs(now)
    }

    if (distanceBetween(currentPoint, targetPoint) <= this.config.targetRadius) {
      const sessionElapsed = this.session.getSnapshot(now).playingElapsedMs
      this.targetHoldStartedElapsedMs ??= sessionElapsed
      if (sessionElapsed - this.targetHoldStartedElapsedMs >= this.config.holdTimeMs) {
        this.finishCurrentTarget(now, true)
      }
    } else {
      this.targetHoldStartedElapsedMs = null
    }
  }

  private finishCurrentTarget(now: number, success: boolean): void {
    const direction = this.currentDirection
    if (!direction) return
    this.attempts.push({
      index: this.attempts.length + 1,
      direction,
      startedAt: this.targetStartedAt,
      firstMovementAt: this.firstMovementAt,
      reachedAt: success ? now : null,
      endedAt: now,
      success,
      // 所有受暂停影响的业务时间使用 TrainingSession 的有效训练时间轴。
      reactionTimeMs: this.currentReactionTimeMs === null ? null : Math.max(0, this.currentReactionTimeMs),
      reachTimeMs: success ? Math.max(0, this.getCurrentTargetElapsedMs(now)) : null,
      maxInput: this.currentMaxInput,
    })
    this.events.onReplayEvent?.({
      elapsedMs: this.getTrainingElapsedMs(now),
      type: success ? 'target-success' : 'target-failed',
      payload: { index: this.attempts.length },
    })
    this.currentDirection = null
    this.targetHoldStartedElapsedMs = null
    if (this.target) this.target.visible = false
    const successCount = this.attempts.filter((attempt) => attempt.success).length
    this.events.onScoreChanged?.(successCount, this.attempts.length)
  }

  private complete(now: number): void {
    this.session.complete(now)
    if (this.target) this.target.visible = false
    if (this.directionText) this.directionText.visible = false
    const snapshot = this.session.getSnapshot(now)
    const result = buildTargetReachTrainingResult(
      snapshot.startedAt ?? now,
      snapshot.completedAt ?? now,
      snapshot.playingElapsedMs,
      this.attempts,
    )
    this.notifySessionState()
    this.events.onCompleted?.(result)
  }

  /** 返回当前目标已消耗的有效训练时间，自动排除任意次数的暂停。 */
  private getCurrentTargetElapsedMs(now: number): number {
    const sessionElapsed = this.session.getSnapshot(now).playingElapsedMs
    return Math.max(0, sessionElapsed - this.targetStartedElapsedMs)
  }

  /** 供训练页 Recorder 使用的有效训练时间，不包含真实暂停时长。 */
  getTrainingElapsedMs(now = performance.now()): number {
    return this.session.getSnapshot(now).playingElapsedMs
  }

  private pickNextDirection(): Direction {
    const directions = this.config.enabledDirections
    if (directions.length === 0) throw new Error('至少启用一个训练方向')
    if (directions.length === 1) return directions[0]
    const lastDirection = this.attempts.at(-1)?.direction
    const candidates = lastDirection ? directions.filter((direction) => direction !== lastDirection) : directions
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  private render(now: number): void {
    const { app, player, target, countdownText, directionText } = this
    if (!app || !player || !target || !countdownText || !directionText) return
    const insets = getTargetReachViewportInsets(app.screen.width, app.screen.height)
    const viewport = createTargetReachViewport(app.screen.width, app.screen.height, insets)
    this.redrawViewportGeometry(viewport.interactionScale)
    const playerPoint = normalizedToScreen(this.latestInput, viewport)
    player.position.set(playerPoint.x, playerPoint.y)
    player.alpha = this.latestInput.connected ? 1 : 0.35
    const snapshot = this.session.getSnapshot(now)

    if (this.currentDirection) {
      const point = getTargetPosition(this.currentDirection, this.config.targetDistance)
      const targetPoint = normalizedToScreen(point, viewport)
      target.position.set(targetPoint.x, targetPoint.y)
      directionText.text = directionLabel(this.currentDirection)
      // 方向文字位于顶部预留区中线，不与左右两侧 HUD 抢占空间。
      directionText.position.set(viewport.centerX, Math.max(22, viewport.insets.top / 2))
      directionText.visible = snapshot.state === 'playing'
    }
    if (snapshot.state === 'countdown') {
      countdownText.text = String(Math.max(1, Math.ceil(snapshot.countdownRemainingMs / 1000)))
      countdownText.position.set(viewport.centerX, viewport.centerY)
      countdownText.visible = true
      target.visible = false
      directionText.visible = false
    } else {
      countdownText.visible = false
    }
  }

  /** 仅在视口比例变化时重绘半径，避免 Pixi 每帧重复创建相同几何。 */
  private redrawViewportGeometry(interactionScale: number): void {
    if (!this.player || !this.target || this.renderedInteractionScale === interactionScale) return
    const playerRadiusPx = getPlayerRadiusPx(interactionScale, this.config.playerRadius)
    const targetRadiusPx = this.config.targetRadius * interactionScale
    this.player.clear().circle(0, 0, playerRadiusPx).fill('#68d391')
    this.target.clear().circle(0, 0, targetRadiusPx).stroke({ width: 5, color: '#4da3ff', alpha: 1 })
    this.renderedInteractionScale = interactionScale
  }

  private notifySessionState(): void {
    const state = this.session.getSnapshot().state
    if (state === this.lastNotifiedState) return
    this.lastNotifiedState = state
    this.events.onSessionStateChanged?.(state)
  }
}

function emptyGameInput(): GameInput {
  return { x: 0, y: 0, connected: false, calibrated: false, timestamp: 0 }
}

function directionLabel(direction: Direction): string {
  return { left: '向左挥动', right: '向右挥动', forward: '向前挥动', backward: '向后挥动' }[direction]
}
