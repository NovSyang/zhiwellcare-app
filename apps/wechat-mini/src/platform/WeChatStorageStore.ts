import type Taro from '@tarojs/taro'
import type { IKeyValueStore } from '../../../../src/core/shared'

type StorageApi = Pick<typeof Taro, 'getStorage' | 'setStorage' | 'removeStorage'>

/** Core 已负责编码 JSON，微信存储只保存字符串并区分缺失与读写失败。 */
export class WeChatStorageStore implements IKeyValueStore {
  constructor(private readonly api: StorageApi) {}

  async get(key: string): Promise<string | null> {
    try {
      const { data } = await this.api.getStorage<unknown>({ key })
      if (typeof data !== 'string') throw new Error('存储数据格式无效。')
      return data
    } catch (error) {
      if (isMissingStorageKey(error)) return null
      throw new Error('读取本地配置失败，请重试。', { cause: error })
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.api.setStorage({ key, data: value })
    } catch (error) {
      throw new Error('保存本地配置失败，请检查可用存储空间后重试。', { cause: error })
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.api.removeStorage({ key })
    } catch (error) {
      if (!isMissingStorageKey(error)) throw new Error('移除本地配置失败，请重试。', { cause: error })
    }
  }
}

function isMissingStorageKey(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'errMsg' in error
    && /(?:data|key) not found/i.test(String(error.errMsg))
}
