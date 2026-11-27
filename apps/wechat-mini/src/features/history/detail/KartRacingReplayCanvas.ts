import type { TrainingReplay } from '@/shared/core'
import {
  createDefaultKartTrack, defaultKartRacingGameConfig, isKartRacingReplayEvent,
  type KartCompletePayload, type KartEntitySpawnPayload,
} from '@/shared/kart'
import { KartRacingCanvas } from '../../../platform/canvas/KartRacingCanvas'
import { projectKartOverview } from '../../../platform/canvas/SceneOverviewProjection'
import type { CanvasSurface } from '../../../platform/canvas/WeChatCanvasSurface'
import { drawSceneOverview, eventTimes, readPositiveConfig, SceneReplayData } from './SceneReplayData'

/** 按保存的车辆位置和道具事件播放，拖动后也能正确显示护盾与加速。 */
export class KartRacingReplayCanvas {
  readonly node: CanvasSurface['node']
  private readonly canvas: KartRacingCanvas
  private readonly timeline: SceneReplayData
  private readonly track
  private readonly visibleDistance: number
  private readonly coins
  private readonly obstacles
  private readonly items
  private readonly path
  private readonly hits
  private readonly finish

  constructor(private readonly surface: CanvasSurface, replay: TrainingReplay, config: unknown) {
    this.node = surface.node
    this.timeline = new SceneReplayData(replay, 'kart-scene')
    const trackLength = readPositiveConfig(config, 'trackLength', defaultKartRacingGameConfig.trackLength)
    this.visibleDistance = readPositiveConfig(config, 'spawnLookAheadDistance', defaultKartRacingGameConfig.spawnLookAheadDistance)
    this.track = createDefaultKartTrack(trackLength)
    this.canvas = new KartRacingCanvas(surface, { trackLength, spawnLookAheadDistance: this.visibleDistance })
    const events = replay.events.filter(isKartRacingReplayEvent)
    const spawn = (type: string) => events.filter((event) => event.type === type).map(({ elapsedMs, payload }) => ({
      ...payload as KartEntitySpawnPayload, from: elapsedMs,
    }))
    const coins = eventTimes(events, 'coin-collected')
    const hits = eventTimes(events, 'obstacle-hit')
    const items = eventTimes(events, 'item-collected')
    this.coins = spawn('coin-spawn').map((coin) => ({ ...coin, until: coins.get(coin.id) ?? Infinity }))
    this.obstacles = spawn('obstacle-spawn').map((item) => ({ ...item, obstacleType: item.kind, hitAt: hits.get(item.id) ?? Infinity }))
    this.items = spawn('item-spawn').map((item) => ({ ...item, itemType: item.kind, until: items.get(item.id) ?? Infinity }))
    this.finish = events.find(({ type }) => type === 'kart-complete')
    const point = ({ x, distance }: { x: number; distance: number }) => projectKartOverview(x, distance, trackLength)
    this.path = this.timeline.poses.map(point)
    this.hits = [...hits.values()].map((time) => point(this.timeline.at(time)))
  }

  draw(elapsed: number, trajectory: boolean): void {
    if (trajectory) {
      drawSceneOverview(this.surface, this.path, this.hits, '驾驶轨迹 · 红点为碰撞')
      return
    }
    const pose = this.timeline.at(elapsed)
    const visible = (item: { from: number; distance: number }) => item.from <= elapsed
      && item.distance >= pose.distance - 4 && item.distance <= pose.distance + this.visibleDistance
    const finished = this.finish && elapsed >= this.finish.elapsedMs
    const finishLabel = (this.finish?.payload as KartCompletePayload | undefined)?.reason === 'finish-line' ? '已到达终点' : '训练完成'
    this.canvas.draw({
      track: this.track,
      kart: { lateral: pose.x, distance: pose.distance },
      coins: this.coins.filter((item) => visible(item) && elapsed < item.until).map((item) => ({ ...item, active: true })),
      obstacles: this.obstacles.filter(visible).map((item) => ({ ...item, active: true, hit: item.hitAt <= elapsed })),
      items: this.items.filter((item) => visible(item) && elapsed < item.until).map((item) => ({ ...item, active: true })),
      shieldActive: (pose.flags & 1) !== 0,
      boostActive: (pose.flags & 2) !== 0,
      label: finished ? finishLabel : undefined,
    })
  }
}
