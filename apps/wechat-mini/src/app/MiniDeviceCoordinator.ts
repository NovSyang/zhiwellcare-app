import type { SensorConnectionManager } from '../../../../src/core/sensor/SensorConnectionManager'
import type { SensorConnectionState, SensorDevice } from '../../../../src/core/sensor/SensorDevice'
import type { MiniOperationSafety } from './MiniOperationSafety'
import type { MiniReconnectPolicy } from './MiniReconnectPolicy'

export type DeviceAction = 'idle' | 'scanning' | 'selecting' | 'reconnecting' | 'disconnecting' | 'forgetting' | 'calibrating' | 'auto-connecting' | 'suspending'
type Manager = Pick<SensorConnectionManager, 'getSnapshot' | 'cancelCurrentWorkflow' | 'connect' | 'switchDevice'
  | 'disconnectManually' | 'forgetCurrentDevice' | 'startupConnect' | 'reconnectAfterDrop' | 'reconnectNow'>

interface Options {
  manager: Manager
  policy: MiniReconnectPolicy
  safety: MiniOperationSafety
  initialize: () => Promise<void>
  scan: () => Promise<SensorDevice[]>
  suspendTransport: () => Promise<void>
  startCalibration: () => void
  resetCalibration: () => void
  permissionError: () => string | null
}

/** 所有微信页面共用一次设备动作；后台取消和用户断开优先。 */
export class MiniDeviceCoordinator {
  private visible = false
  private epoch = 0
  private autoEpoch = -1
  private revision = 0
  private dropPending = false
  private initialized = false
  private initialization: Promise<void> | null = null
  private work: Promise<unknown> | null = null
  private cleanup: Promise<void> | null = null
  private action: DeviceAction = 'idle'
  private owner: symbol | undefined
  private stopAction: DeviceAction = 'suspending'
  private state: SensorConnectionState = 'idle'
  private calibrationRelease: (() => void) | null = null
  private calibrating = false
  private error = ''
  private autoScheduled = false
  private readonly listeners = new Set<(snapshot: ReturnType<MiniDeviceCoordinator['getSnapshot']>) => void>()

  constructor(private readonly options: Options) {
    options.safety.onChanged(() => this.scheduleAuto())
  }

  getSnapshot() {
    const binding = this.options.manager.getSnapshot().binding
    return { initialized: this.initialized, foreground: this.visible, error: this.error,
      action: this.cleanup ? this.stopAction : this.calibrationRelease ? 'calibrating' as const : this.action,
      calibrating: this.calibrating,
      policyNeedsRepair: this.initialized && this.options.policy.needsRepair(binding?.deviceId),
      autoReconnectSuppressed: !!binding && !this.options.policy.allows(binding.deviceId) }
  }

  onChanged(listener: (snapshot: ReturnType<MiniDeviceCoordinator['getSnapshot']>) => void) {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization
    this.initialization = this.options.safety.withLock('读取设备设置', async () => {
      await this.options.initialize()
      try { await this.options.policy.load() } catch (failure) { this.setError(failure) }
      this.initialized = true
    }).catch((failure: unknown) => {
      this.initialization = null
      this.setError(failure)
      throw failure
    }).finally(() => this.publish())
    return this.initialization
  }

  show() {
    if (this.visible) return
    this.visible = true
    this.epoch += 1
    this.publish()
    this.scheduleAuto()
  }

  hide() {
    if (!this.visible) return
    this.visible = false
    this.dropPending = false
    this.revision += 1
    this.publish()
    // 更新清理已在独占门内进行，后台不并行打开第二条清理链。
    if (!this.options.safety.getSnapshot().applying) void this.close('suspending').catch(() => undefined)
  }

  onDrop() {
    if (!this.visible || this.cleanup || this.options.safety.getSnapshot().applying
      || this.options.manager.getSnapshot().operation !== 'idle'
      || !this.options.policy.allows(this.options.manager.getSnapshot().binding?.deviceId)) return
    this.dropPending = true
    this.scheduleAuto()
  }

  observeSensor(state: SensorConnectionState, calibrating: boolean) {
    const wasCalibrating = this.calibrating
    this.state = state
    this.calibrating = state === 'connected' && calibrating
    if (this.calibrationRelease && !this.calibrating) {
      const release = this.calibrationRelease
      this.calibrationRelease = null
      release()
      this.scheduleAuto()
    }
    if (wasCalibrating !== this.calibrating) this.publish()
  }

  scan(): Promise<SensorDevice[]> {
    return this.run('scanning', async () => this.options.scan())
  }

  select(device: SensorDevice, owner?: symbol): Promise<void> {
    return this.run('selecting', async (current) => {
      const binding = this.options.manager.getSnapshot().binding
      if (binding?.deviceId === device.id && this.state === 'connected') return
      if (binding?.deviceId === device.id) await this.options.manager.reconnectNow()
      else if (binding) await this.options.manager.switchDevice(device, this.options.policy.allows(binding.deviceId))
      else await this.options.manager.connect(device)
      this.confirmConnected(device.id, current)
      await this.options.policy.save(device.id, true)
    }, owner)
  }

  reconnect(requiredId?: string): Promise<void> {
    return this.run('reconnecting', async (current) => {
      const binding = this.options.manager.getSnapshot().binding
      if (!binding || (requiredId && binding.deviceId !== requiredId)) throw new Error('请先选择本次训练绑定的设备。')
      await this.options.manager.reconnectNow()
      this.confirmConnected(binding.deviceId, current)
      await this.options.policy.save(binding.deviceId, true)
    })
  }

  disconnect(): Promise<void> { return this.stopByUser('disconnecting') }
  forget(): Promise<void> { return this.stopByUser('forgetting') }

  cancelSelection(owner: symbol) {
    if (this.action === 'selecting' && this.owner === owner) void this.close('suspending').catch(() => undefined)
  }

  startCalibration() {
    this.checkIdle()
    if (this.state !== 'connected' || !this.initialized) throw new Error('连接设备后才能开始中心校准。')
    this.calibrationRelease = this.options.safety.acquire('中心校准')
    try { this.options.startCalibration() }
    catch (failure) {
      this.observeSensor(this.state, false)
      throw failure
    } finally { this.publish() }
  }

  cancelCalibration() {
    if (!this.calibrationRelease) return
    this.invalidateCalibration()
  }

  invalidateCalibration() {
    // 即使校准已完成，训练中断时也丢弃旧中心。
    this.options.resetCalibration()
    this.observeSensor(this.state, false)
  }

  /** 更新独占门由调用方持有，清理不改主动断开的偏好。 */
  async cleanupForUpdate() {
    if (this.work || this.cleanup || this.calibrationRelease) throw new Error('设备正在操作。')
    const restore = this.state === 'connected'
    try { await this.disconnectNative() }
    finally { if (restore && this.visible) this.dropPending = true }
  }

  private async run<T>(action: DeviceAction, execute: (current: () => boolean) => Promise<T>, owner?: symbol): Promise<T> {
    this.checkIdle()
    const release = this.options.safety.acquire(action)
    const revision = this.revision
    const current = () => this.revision === revision && this.visible
    if (action !== 'scanning') this.dropPending = false
    this.autoEpoch = this.epoch
    this.action = action
    this.owner = owner
    this.error = ''
    const job = Promise.resolve().then(async () => {
      await this.initialize()
      if (!current()) throw new Error('设备操作已取消。')
      return execute(current)
    })
    this.work = job
    this.publish()
    try {
      const result = await job
      if (!current()) throw new Error('设备操作已取消。')
      return result
    } catch (failure) {
      if (current()) this.setError(failure)
      throw failure
    } finally {
      this.work = null
      this.owner = undefined
      this.action = 'idle'
      release()
      this.publish()
      this.scheduleAuto()
    }
  }

  private checkIdle() {
    this.options.safety.checkAvailable()
    if (!this.visible) throw new Error('请回到小程序前台后再操作蓝牙。')
    if (this.work || this.cleanup || this.calibrationRelease || this.options.manager.getSnapshot().operation !== 'idle') {
      throw new Error('设备正在操作，请稍后重试。')
    }
  }

  private confirmConnected(id: string, current: () => boolean) {
    if (!current()) throw new Error('设备操作已取消。')
    const snapshot = this.options.manager.getSnapshot()
    if (this.state !== 'connected' || snapshot.binding?.deviceId !== id) {
      throw new Error(snapshot.message || '设备尚未完成连接，请重试。')
    }
  }

  private async stopByUser(action: 'disconnecting' | 'forgetting') {
    this.options.safety.checkAvailable()
    if (!this.visible || this.cleanup) throw new Error('设备正在清理，请稍后重试。')
    this.autoEpoch = this.epoch
    this.dropPending = false
    this.options.policy.suppress()
    this.error = ''
    return this.close(action)
  }

  private close(action: 'suspending' | 'disconnecting' | 'forgetting'): Promise<void> {
    if (this.cleanup) return this.cleanup
    const release = this.options.safety.acquire(action)
    const previous = this.work
    this.revision += 1
    this.options.manager.cancelCurrentWorkflow()
    this.invalidateCalibration()
    this.stopAction = action
    // 后台/过期选择只释放蓝牙。主动操作则把当前绑定的偏好写为 false。
    const job = Promise.resolve().then(async () => {
      let policyFailure: unknown
      const disableAuto = async () => {
        const binding = this.options.manager.getSnapshot().binding
        if (binding) try { await this.options.policy.save(binding.deviceId, false) } catch (failure) { policyFailure = failure }
      }
      if (!previous && action !== 'suspending') {
        await this.initialize().catch(() => undefined)
        this.options.policy.suppress()
        await disableAuto()
      }
      let disconnectFailure: unknown
      try { await this.disconnectNative() } catch (failure) { disconnectFailure = failure }
      finally { await previous?.catch(() => undefined) }
      if (previous && action !== 'suspending') await disableAuto()
      if (disconnectFailure) throw disconnectFailure
      if (action === 'forgetting') {
        await this.options.manager.forgetCurrentDevice()
        await this.options.policy.clear()
      }
      if (policyFailure) throw policyFailure
    }).catch((failure: unknown) => {
      this.setError(failure)
      throw failure
    }).finally(() => {
      if (this.cleanup === job) this.cleanup = null
      release()
      this.publish()
      this.scheduleAuto()
    })
    this.cleanup = job
    this.publish()
    return job
  }

  private async disconnectNative() {
    try { await this.options.manager.disconnectManually() }
    finally { await this.options.suspendTransport() }
  }

  private scheduleAuto() {
    if (this.autoScheduled) return
    this.autoScheduled = true
    void Promise.resolve().then(() => {
      this.autoScheduled = false
      if (!this.visible || this.cleanup || this.work || this.calibrationRelease || this.options.safety.getSnapshot().applying
        || this.options.manager.getSnapshot().operation !== 'idle' || (!this.dropPending && this.autoEpoch === this.epoch)) return
      const drop = this.dropPending
      this.dropPending = false
      void this.run('auto-connecting', async (current) => {
        const id = this.options.manager.getSnapshot().binding?.deviceId
        if (!id || this.state === 'connected' || !this.options.policy.allows(id)) return
        const blocked = this.options.permissionError()
        if (blocked) throw new Error(blocked)
        if (drop) await this.options.manager.reconnectAfterDrop()
        else await this.options.manager.startupConnect()
        this.confirmConnected(id, current)
      }).catch(() => undefined)
    })
  }

  private setError(failure: unknown) {
    this.error = failure instanceof Error ? failure.message : '设备操作失败，请重试。'
    this.publish()
  }

  private publish() {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
