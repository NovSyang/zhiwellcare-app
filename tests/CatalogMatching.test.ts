import { describe, expect, it } from 'vitest'
import { DeviceCapabilityTag, HandleTag, tagLabel } from '../src/core/catalog/CapabilityTags'
import { MockCatalogSource } from '../src/core/catalog/MockCatalogSource'
import { CatalogService } from '../src/core/catalog/CatalogService'
import { describeMissingTags, findModelById, missingTags, resolveDeviceModel, tagsSatisfy } from '../src/core/catalog/tagMatching'
import type { SensorDevice } from '../src/core/sensor/SensorDevice'
import { mockCatalog } from '../src/data/catalog'

describe('设备-游戏能力标签匹配', () => {
  const wobble = mockCatalog.deviceModels.find((model) => model.modelId === 'wobble-wrist-band')!
  const desk = mockCatalog.deviceModels.find((model) => model.modelId === 'desk-torque-base')!
  const postureGames = mockCatalog.games.filter((game) => game.requiredTags.includes(DeviceCapabilityTag.PostureSensor))

  it('匹配公式：设备能力标签 ⊇ 游戏所需标签', () => {
    for (const game of postureGames) {
      expect(tagsSatisfy(wobble.capabilityTags, game.requiredTags)).toBe(true)
    }
    // 姿态类游戏需要姿态传感，力矩底座不满足。
    expect(tagsSatisfy(desk.capabilityTags, postureGames[0].requiredTags)).toBe(false)
  })

  it('missingTags 返回缺失标签，便于“连接对应设备”引导', () => {
    const missing = missingTags(desk.capabilityTags, postureGames[0].requiredTags)
    expect(missing).toContain(DeviceCapabilityTag.PostureSensor)
    expect(describeMissingTags(missing)).toContain('姿态传感')
  })

  it('手柄配件作为二级标签参与匹配', () => {
    // 手柄标签本身可被要求（未来力矩游戏要求方向盘手柄时）。
    expect(tagsSatisfy([DeviceCapabilityTag.TorqueSensor, HandleTag.SteeringWheel], [HandleTag.SteeringWheel])).toBe(true)
    expect(tagLabel(HandleTag.Sphere)).toBe('球形手柄')
  })

  it('按 BLE 广播名把扫描设备归入已注册型号', () => {
    const device: SensorDevice = { id: '1', address: 'AA:BB', name: 'ZWKL-WRIST-001' }
    expect(resolveDeviceModel(mockCatalog.deviceModels, device)?.modelId).toBe('wobble-wrist-band')
    const unknown: SensorDevice = { id: '2', address: 'CC:DD', name: 'Fitness-Band-X' }
    expect(resolveDeviceModel(mockCatalog.deviceModels, unknown)).toBeNull()
  })

  it('findModelById 按型号 ID 查目录', () => {
    expect(findModelById(mockCatalog.deviceModels, 'desk-torque-base')?.name).toBe('桌面力矩主动训练底座')
    expect(findModelById(mockCatalog.deviceModels, 'not-exist')).toBeNull()
  })
})

describe('目录源与目录服务（Mock）', () => {
  it('Mock 源返回与后端同构的快照', async () => {
    const source = new MockCatalogSource()
    const snapshot = await source.loadSnapshot()
    expect(snapshot.deviceModels.length).toBeGreaterThan(0)
    expect(snapshot.games.length).toBeGreaterThan(0)
  })

  it('listModelGames 只返回姿态类游戏给不倒翁，力矩底座暂无可用游戏', async () => {
    const source = new MockCatalogSource()
    const wobbleGames = await source.listModelGames('wobble-wrist-band')
    expect(wobbleGames.map((game) => game.gameId).sort()).toEqual(['target-reach', 'trajectory-follow'])
    expect(await source.listModelGames('desk-torque-base')).toEqual([])
  })

  it('CatalogService.getDeviceGameProfile 派生可用/不可用清单', async () => {
    const service = new CatalogService(new MockCatalogSource())
    const profile = await service.getDeviceGameProfile(mockCatalog.deviceModels[1])
    expect(profile).not.toBeNull()
    expect(profile!.games).toEqual([])
    // 桌面底座面对两款姿态游戏均缺失姿态传感标签。
    expect(profile!.unavailableGames).toHaveLength(2)
    expect(profile!.unavailableGames[0].missingTags).toEqual([DeviceCapabilityTag.PostureSensor])
  })

  it('listGamesWithModels 为每款游戏标注兼容设备名', async () => {
    const service = new CatalogService(new MockCatalogSource())
    const items = await service.listGamesWithModels()
    expect(items.length).toBe(2)
    expect(items[0].compatibleModels).toContain('不倒翁手腕训练仪')
  })
})
