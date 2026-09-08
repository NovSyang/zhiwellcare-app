import { CATALOG_SCHEMA_VERSION, type CatalogSnapshot } from '../core/catalog/DeviceCatalogTypes'
import { DeviceCapabilityTag, HandleTag } from '../core/catalog/CapabilityTags'

/**
 * 本地 Mock 目录数据 —— 等价于 Golang 后端目录配置表的一页快照。
 * 后端就绪后切 VITE_CATALOG_MODE=http，本文件仅作为离线兜底与单测数据。
 *
 * 合规基线：全部设备为纯消费级主动训练硬件，无电机驱动、无医疗功能。
 */
export const mockCatalog: CatalogSnapshot = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  deviceModels: [
    {
      modelId: 'wobble-wrist-band',
      name: '不倒翁手腕训练仪',
      manufacturer: '智为康乐',
      category: 'wrist',
      description: '腕部姿态传感训练设备：佩戴后通过主动挥腕/绕腕发力驱动训练游戏，无电机、无被动驱动。',
      capabilityTags: [DeviceCapabilityTag.PostureSensor],
      supportedHandleTags: [],
      namePatterns: ['bt91', 'wobble', 'zwkl-wrist', '不倒翁'],
      protocol: 'bs-bt91',
      minAppVersion: '0.1.0',
      firmwareUpdatable: true,
      consumerOnly: true,
      icon: '⌚',
    },
    {
      modelId: 'desk-torque-base',
      name: '桌面力矩主动训练底座',
      manufacturer: '智为康乐',
      category: 'desk-torque',
      description: '桌面级纯主动阻力训练底座：用户主动发力对抗阻尼，支持多款手柄配件，无电机驱动。',
      capabilityTags: [DeviceCapabilityTag.TorqueSensor],
      supportedHandleTags: [HandleTag.SteeringWheel, HandleTag.Sphere, HandleTag.TShape, HandleTag.Key],
      namePatterns: ['zwkl-desk', 'torque-base', '力矩底座'],
      protocol: 'generic-ble',
      minAppVersion: '0.1.0',
      firmwareUpdatable: false,
      consumerOnly: true,
      icon: '🕹️',
    },
  ],
  games: [
    {
      gameId: 'target-reach',
      name: '四方挥腕挑战',
      summary: '按提示方向主动挥腕，把运动圆点送入目标框；训练腕部方向控制与反应协调。',
      requiredTags: [DeviceCapabilityTag.PostureSensor],
      durationPresetsMin: [1, 3, 5],
      resourceVersion: '1.0.0',
      resourceUrl: '',
      status: 'on',
      categoryLabel: '腕部协调',
      playMode: 'active-force',
    },
    {
      gameId: 'trajectory-follow',
      name: '8字轨迹跟随',
      summary: '沿 8 字引导轨迹主动匀速挥腕移动，训练手腕空间轨迹控制与稳定性。',
      requiredTags: [DeviceCapabilityTag.PostureSensor],
      durationPresetsMin: [1, 3, 5],
      resourceVersion: '1.0.0',
      resourceUrl: '',
      status: 'on',
      categoryLabel: '腕部控制',
      playMode: 'active-force',
    },
    {
      gameId: 'river-drift',
      name: '森林溪谷漂流',
      summary: '控制康复小船沿溪流前进，收集金币并避开障碍，训练腕部连续方向控制与协调能力。',
      requiredTags: [DeviceCapabilityTag.PostureSensor],
      // 当前版本固定训练 90 秒，因此目录只展示一个 1.5 分钟预设。
      durationPresetsMin: [1.5],
      resourceVersion: '1.0.0',
      resourceUrl: '',
      status: 'on',
      categoryLabel: '腕部协调',
      playMode: 'active-force',
    },
  ],
}
