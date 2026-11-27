import type { TrainingReplay } from '@/shared/core'
import {
  defaultRiverDriftGameConfig, isRiverDriftReplayEvent, type CoinSpawnPayload,
  type ObstacleSpawnPayload, type SegmentSpawnPayload,
} from '@/shared/river'
import { RiverDriftCanvas } from '../../../platform/canvas/RiverDriftCanvas'
import { projectRiverOverview } from '../../../platform/canvas/SceneOverviewProjection'
import type { CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { drawSceneOverview, eventTimes, readPositiveConfig, SceneReplayData } from './SceneReplayData'

/** 河段和物件从记录的生成位置出发，按当时的河流位移向下滚动。 */
export class RiverDriftReplayCanvas {
  readonly node: CanvasSurface['node']
  private readonly canvas: RiverDriftCanvas
  private readonly timeline: SceneReplayData
  private readonly segments
  private readonly coins
  private readonly obstacles
  private readonly track
  private readonly hits

  constructor(private readonly surface: CanvasSurface, replay: TrainingReplay, config: unknown) {
    this.node = surface.node
    this.timeline = new SceneReplayData(replay, 'river-scene')
    const riverWidthRatio = readPositiveConfig(config, 'riverWidthRatio', defaultRiverDriftGameConfig.riverWidthRatio)
    this.canvas = new RiverDriftCanvas(surface, { riverWidthRatio })
    const events = replay.events.filter(isRiverDriftReplayEvent)
    const collected = eventTimes(events, 'coin-collected')
    const hits = eventTimes(events, 'obstacle-hit')
    const atSpawn = (time: number) => this.timeline.at(time).distance
    this.segments = events.filter(({ type }) => type === 'segment-spawn').map(({ elapsedMs, payload }) => ({
      ...payload as SegmentSpawnPayload, from: elapsedMs, offset: atSpawn(elapsedMs),
    }))
    this.coins = events.filter(({ type }) => type === 'coin-spawn').map(({ elapsedMs, payload }) => {
      const coin = payload as CoinSpawnPayload
      return { ...coin, from: elapsedMs, offset: atSpawn(elapsedMs), until: collected.get(coin.id) ?? Infinity }
    })
    this.obstacles = events.filter(({ type }) => type === 'obstacle-spawn').map(({ elapsedMs, payload }) => {
      const obstacle = payload as ObstacleSpawnPayload
      return { ...obstacle, from: elapsedMs, offset: atSpawn(elapsedMs), hitAt: hits.get(obstacle.id) ?? Infinity }
    })
    const toTrack = (time: number, x: number) => projectRiverOverview(time, x, replay.durationMs)
    this.track = this.timeline.poses.map(({ elapsedMs, x }) => toTrack(elapsedMs, x))
    this.hits = [...hits.values()].map((time) => toTrack(time, this.timeline.at(time).x))
  }

  draw(elapsed: number, trajectory: boolean): void {
    if (trajectory) {
      drawSceneOverview(this.surface, this.track, this.hits, '漂流轨迹 · 红点为碰撞')
      return
    }
    const boat = this.timeline.at(elapsed)
    const distance = boat.distance
    this.canvas.draw({
      boat,
      worldDistance: distance,
      segments: this.segments.filter(({ from }) => from <= elapsed)
        .map((segment) => ({ ...segment, y: segment.y + distance - segment.offset }))
        .filter(({ y, height }) => y <= 1.3 && y + height >= -0.3),
      coins: this.coins.filter(({ from, until }) => from <= elapsed && elapsed < until)
        .map((coin) => ({ ...coin, y: coin.y + distance - coin.offset, active: true })),
      obstacles: this.obstacles.filter(({ from }) => from <= elapsed)
        .map((obstacle) => ({ ...obstacle, y: obstacle.y + distance - obstacle.offset, hit: obstacle.hitAt <= elapsed, active: true })),
    })
  }
}
