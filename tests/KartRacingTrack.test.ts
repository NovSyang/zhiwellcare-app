import { describe, expect, it } from 'vitest'
import { createDefaultKartTrack, getKartTrackSegment, kartTrackCenterOffset } from '../src/games/kart-racing/KartRacingTrack'

describe('KartRacingTrack', () => {
  it('赛段连续覆盖固定总长度并以低压力直道结束', () => {
    const track = createDefaultKartTrack(1_000)
    expect(track[0].startDistance).toBe(0)
    for (let index = 1; index < track.length; index += 1) {
      expect(track[index].startDistance).toBeCloseTo(track[index - 1].startDistance + track[index - 1].length)
    }
    expect(track.at(-1)!.startDistance + track.at(-1)!.length).toBeCloseTo(1_000)
    expect(track.at(-1)!.curvature).toBe(0)
    expect(track.every((segment) => segment.roadWidth > 0 && Math.abs(segment.curvature) <= 0.2)).toBe(true)
  })

  it('距离查询和弯道投影保持稳定', () => {
    const track = createDefaultKartTrack(1_000)
    expect(getKartTrackSegment(track, 200).id).toBe('gentle-left')
    expect(getKartTrackSegment(track, 520).id).toBe('gentle-right')
    expect(Number.isFinite(kartTrackCenterOffset(track, 150, 90))).toBe(true)
  })
})
