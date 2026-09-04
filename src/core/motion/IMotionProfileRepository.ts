import type { MotionProfile } from './MotionProfile'

/** MotionProfile 的持久化接口，后续可替换为原生存储。 */
export interface IMotionProfileRepository {
  load(): Promise<MotionProfile | null>
  save(profile: MotionProfile): Promise<void>
  clear(): Promise<void>
}
