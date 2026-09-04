import type { SensorDevice } from '../sensor/SensorDevice'
import type { DeviceModelInfo } from './DeviceCatalogTypes'
import { tagLabel, type MatchTag } from './CapabilityTags'

/** 匹配公式：设备能力标签 ⊇ 游戏所需标签。 */
export function tagsSatisfy(deviceTags: readonly MatchTag[], requiredTags: readonly MatchTag[]): boolean {
  return requiredTags.every((tag) => deviceTags.includes(tag))
}

/** 返回设备缺失的标签（用于“需要连接具备 XX 能力的设备”引导文案）。 */
export function missingTags(deviceTags: readonly MatchTag[], requiredTags: readonly MatchTag[]): MatchTag[] {
  return requiredTags.filter((tag) => !deviceTags.includes(tag))
}

export function describeMissingTags(tags: readonly MatchTag[]): string {
  return tags.map(tagLabel).join('、')
}

/** 依据 BLE 广播名片段把扫描设备归入已注册型号。 */
export function resolveDeviceModel(models: readonly DeviceModelInfo[], device: SensorDevice | null): DeviceModelInfo | null {
  if (!device) return null
  const name = (device.name || '').toLowerCase()
  if (!name) return null
  for (const model of models) {
    if (model.namePatterns.some((pattern) => name.includes(pattern.toLowerCase()))) return model
  }
  return null
}

/** 解析型号名称对应的目录项。 */
export function findModelById(models: readonly DeviceModelInfo[], modelId: string | null | undefined): DeviceModelInfo | null {
  if (!modelId) return null
  return models.find((model) => model.modelId === modelId) ?? null
}
