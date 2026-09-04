import type { IKeyValueStore } from './IKeyValueStore'

/** 使用浏览器 localStorage 保存少量配置；不可用时安全降级为空存储。 */
export class LocalStorageStore implements IKeyValueStore {
  async get(key: string): Promise<string | null> {
    try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(key) }
    catch { return null }
  }

  async set(key: string, value: string): Promise<void> {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value) }
    catch { /* 存储受限时保持应用可用。 */ }
  }

  async remove(key: string): Promise<void> {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(key) }
    catch { /* 存储受限时保持应用可用。 */ }
  }
}
