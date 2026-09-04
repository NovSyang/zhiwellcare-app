import type { IKeyValueStore } from '../storage/IKeyValueStore'
import { DEFAULT_UPDATE_POLICY, isUpdatePolicy, type UpdatePolicy } from './UpdatePolicy'

const UPDATE_POLICY_KEY = 'zhiwellcare.update-policy'

/** 更新偏好沿用轻量 localStorage，不写入训练数据库。 */
export class UpdatePolicyRepository {
  constructor(private readonly store: IKeyValueStore) {}

  async load(): Promise<UpdatePolicy> {
    const value = await this.store.get(UPDATE_POLICY_KEY)
    return isUpdatePolicy(value) ? value : DEFAULT_UPDATE_POLICY
  }

  save(policy: UpdatePolicy): Promise<void> {
    return this.store.set(UPDATE_POLICY_KEY, policy)
  }
}
