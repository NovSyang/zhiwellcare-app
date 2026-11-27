import type { SensorService } from '../sensor/SensorService'
import type { IMotionProfileRepository } from './IMotionProfileRepository'
import { copyMotionProfile, createDefaultMotionProfile, motionConfigFromProfile, type MotionProfile } from './MotionProfile'

/** 负责加载、保存并将当前 Profile 应用到传感器输入链路。 */
export class MotionProfileService {
  private currentProfile = createDefaultMotionProfile()

  constructor(
    private readonly repository: IMotionProfileRepository,
    private readonly sensorService: SensorService,
  ) {}

  async load(): Promise<MotionProfile> {
    const loaded = await this.repository.load()
    this.currentProfile = loaded ?? createDefaultMotionProfile()
    this.apply(this.currentProfile)
    return this.getCurrent()
  }

  async save(profile: MotionProfile): Promise<void> {
    const copy = copyMotionProfile(profile)
    copy.updatedAt = Date.now()
    // 持久化成功之后再应用，存储失败时保留当前有效设置。
    await this.repository.save(copy)
    this.apply(copy)
  }

  apply(profile: MotionProfile): void {
    this.currentProfile = copyMotionProfile(profile)
    this.sensorService.updateMotionConfig(motionConfigFromProfile(profile))
  }

  getCurrent(): MotionProfile { return copyMotionProfile(this.currentProfile) }

  async reset(): Promise<MotionProfile> {
    await this.repository.clear()
    const profile = createDefaultMotionProfile()
    this.apply(profile)
    return this.getCurrent()
  }
}
