import { describe, expect, it } from 'vitest'
import { createGameRegistry, getGameDefinitions, getGameModule } from '../src/games/GameRegistry'
import { targetReachGameModule } from '../src/games/target-reach/TargetReachGameModule'

describe('GameRegistry', () => {
  it('注册四款正式游戏并安全处理未知 ID', () => {
    expect(getGameModule('target-reach')?.definition.name).toBe('四方挥腕挑战')
    expect(getGameModule('trajectory-follow')?.definition.name).toBe('8字轨迹跟随')
    expect(getGameModule('river-drift')?.definition.name).toBe('森林溪谷漂流')
    expect(getGameModule('kart-racing')?.definition.name).toBe('欢乐卡丁车')
    expect(getGameModule('not-exist')).toBeNull()
    expect(getGameDefinitions().map((game) => game.id)).toEqual(['target-reach', 'trajectory-follow', 'river-drift', 'kart-racing'])
  })

  it('拒绝重复游戏 ID', () => {
    expect(() => createGameRegistry([targetReachGameModule, targetReachGameModule])).toThrow('训练游戏 ID 重复')
  })
})
