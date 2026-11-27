import type { IKeyValueStore } from '../../../../src/core/storage/IKeyValueStore'

export const RECONNECT_POLICY_KEY = 'zhiwellcare.mini.device.reconnect-policy.v1'
interface ReconnectPreference { schemaVersion: 1; deviceId: string; autoReconnect: boolean }

/** 保留旧绑定结构，单独存储用户是否允许恢复该设备。 */
export class MiniReconnectPolicy {
  private preference: ReconnectPreference | null = null
  private available = false

  constructor(private readonly store: IKeyValueStore) {}

  async load() {
    this.available = false
    try {
      const raw = await this.store.get(RECONNECT_POLICY_KEY)
      if (raw === null) {
        this.preference = null
      } else {
        const value = JSON.parse(raw) as Partial<ReconnectPreference> | null
        if (value?.schemaVersion !== 1 || typeof value.deviceId !== 'string' || !value.deviceId.trim()
          || typeof value.autoReconnect !== 'boolean') throw new Error('无效策略')
        this.preference = { schemaVersion: 1, deviceId: value.deviceId, autoReconnect: value.autoReconnect }
      }
      this.available = true
    } catch { throw new Error('无法读取自动重连偏好，请手动连接设备以修复。') }
  }

  allows(deviceId: string | undefined) {
    return !!deviceId && this.available && (this.preference === null
      || (this.preference.deviceId === deviceId && this.preference.autoReconnect))
  }

  needsRepair(deviceId: string | undefined) {
    return !!deviceId && (!this.available || (this.preference !== null && this.preference.deviceId !== deviceId))
  }

  suppress() {
    // 断开指令立即生效，持久化会等较早的设备写入结束。
    this.available = false
  }

  async save(deviceId: string, autoReconnect: boolean) {
    const preference: ReconnectPreference = { schemaVersion: 1, deviceId, autoReconnect }
    this.preference = preference
    this.available = true
    try { await this.store.set(RECONNECT_POLICY_KEY, JSON.stringify(preference)) }
    catch {
      this.available = false
      throw new Error('自动重连偏好保存失败，重新打开后的行为可能与本次不同。')
    }
  }

  async clear() {
    this.preference = null
    this.available = false
    try {
      await this.store.remove(RECONNECT_POLICY_KEY)
      this.available = true
    } catch { throw new Error('设备已忘记，自动重连偏好清理失败。') }
  }
}
