import { describe, expect, it } from 'vitest'
import { RiverDriftDynamicReplayArt } from '../src/games/river-drift/art/RiverDriftDynamicReplayArt'
import {
  createRiverDriftBoatVisual,
  createRiverDriftCrateGraphic,
  createRiverDriftMascot,
  createRiverDriftRockGraphic,
  createRiverDriftStumpGraphic,
  createRiverDriftWeedGraphic,
  riverDriftTextureNames,
  updateRiverDriftMascot,
} from '../src/games/river-drift/art/RiverDriftVisualFactory'

describe('RiverDriftArtFactory', () => {
  it('角色包含五个设备识别结构、两个接触区和独立面部', () => {
    const mascot = createRiverDriftMascot()
    expect(mascot.base.label).toBe('blue-hemisphere')
    expect(mascot.supportRing.label).toBe('support-ring')
    expect(mascot.stem.label).toBe('wide-stem')
    expect(mascot.topShell.label).toBe('wide-top-shell')
    expect(mascot.leftContact).not.toBe(mascot.rightContact)
    expect(mascot.face.label).toBe('independent-face')
    updateRiverDriftMascot(mascot, 4_100, false, 0.02)
    expect(mascot.closedFace.visible).toBe(true)
  })

  it('船体遮挡层级和四类障碍工厂完整', () => {
    const boat = createRiverDriftBoatVisual()
    expect(boat.root.getChildIndex(boat.mascot.root)).toBeLessThan(boat.root.getChildIndex(boat.frontRail))
    expect([
      createRiverDriftRockGraphic().label,
      createRiverDriftStumpGraphic().label,
      createRiverDriftCrateGraphic().label,
      createRiverDriftWeedGraphic().label,
    ]).toEqual(['rock-texture', 'stump-texture', 'crate-texture', 'weed-texture'])
    expect(riverDriftTextureNames).toEqual(['coin', 'particle', 'rock', 'stump', 'crate', 'weed'])
    expect(RiverDriftDynamicReplayArt.usesSharedFactories).toBe(true)
  })
})
