import { describe, expect, it } from 'vitest'
import { createMascotVisual } from '../src/shared/game-art/mascot/MascotVisualFactory'
import { createKartItemGraphic, createKartObstacleGraphic, createKartVisual } from '../src/games/kart-racing/art/KartVisualFactory'

describe('KartRacingArtFactory', () => {
  it('共享角色保留可识别结构，角色与车辆通过插槽组合', () => {
    const mascot = createMascotVisual()
    expect(mascot.base.label).toBe('blue-hemisphere')
    expect(mascot.face.label).toBe('independent-face')
    const kart = createKartVisual()
    expect(kart.driverSlot.children).toContain(kart.mascot.root)
    expect(kart.root.getChildIndex(kart.driverSlot)).toBeGreaterThan(kart.root.getChildIndex(kart.body))
  })

  it('四类障碍和两类功能道具均有程序化图形', () => {
    expect(['cone', 'tire-stack', 'toolbox', 'puddle'].map((type) => createKartObstacleGraphic(type as any).label))
      .toEqual(['cone-texture', 'tire-stack-texture', 'toolbox-texture', 'puddle-texture'])
    expect(createKartItemGraphic('shield').label).toBe('shield-texture')
    expect(createKartItemGraphic('boost').label).toBe('boost-texture')
  })
})
