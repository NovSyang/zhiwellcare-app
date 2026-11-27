import { describe, expect, it, vi } from 'vitest'
import { MiniDeviceCoordinator } from '../apps/wechat-mini/src/app/MiniDeviceCoordinator'
import { presentDeviceStatus } from '../apps/wechat-mini/src/app/MiniDeviceStatusPresentation'
import { MiniOperationSafety } from '../apps/wechat-mini/src/app/MiniOperationSafety'
import { MiniReconnectPolicy, RECONNECT_POLICY_KEY } from '../apps/wechat-mini/src/app/MiniReconnectPolicy'
import type { SensorDevice, SensorConnectionState } from '../src/core/sensor/SensorDevice'
import { SensorConnectionManager, type SensorConnectionPort } from '../src/core/sensor/SensorConnectionManager'
import type { DeviceBinding } from '../src/core/sensor/DeviceBinding'
import type { SensorRuntimeSnapshot } from '../src/core/sensor/SensorService'

const route = 'pages/device/index'
const first: SensorDevice = { id: 'dev-1', address: 'dev-1', name: 'BS-BT91' }
const second: SensorDevice = { id: 'dev-2', address: 'dev-2', name: first.name }
const oldBinding: DeviceBinding = { deviceId: first.id, address: first.address, name: first.name, updatedAt: 1 }
const preference = (deviceId: string, autoReconnect: boolean) => JSON.stringify({ schemaVersion: 1, deviceId, autoReconnect })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/** 共用真实连接管理器，替换微信蓝牙和存储以控制异步返回顺序。 */
function setup(binding: DeviceBinding | null = oldBinding, initialPolicy: string | null = null) {
  let persisted = binding
  let rawPolicy = initialPolicy
  let state: SensorConnectionState = 'idle'
  let onSensorState: Parameters<SensorConnectionPort['onSnapshot']>[0] | undefined
  const emit = (next: SensorConnectionState, active = false) => {
    state = next
    coordinator.observeSensor(next, active)
    onSensorState?.({ state: next })
  }
  const sensor = {
    scan: vi.fn(async () => [second, first]),
    connect: vi.fn(async (_id: string) => emit('connected')),
    disconnect: vi.fn(async () => emit('disconnected')),
    resetCalibration: () => emit(state),
    onSnapshot: (callback: typeof onSensorState) => {
      onSensorState = callback
      callback?.({ state })
      return () => { onSensorState = undefined }
    },
  }
  const repository = {
    load: vi.fn(async () => persisted),
    save: vi.fn(async (next: DeviceBinding) => { persisted = next }),
    clear: vi.fn(async () => { persisted = null }),
  }
  const store = {
    get: vi.fn(async (_key: string) => rawPolicy),
    set: vi.fn(async (_key: string, next: string) => { rawPolicy = next }),
    remove: vi.fn(async (_key: string) => { rawPolicy = null }),
  }
  const safety = new MiniOperationSafety(() => route)
  safety.show(Symbol(route), route)
  const manager = new SensorConnectionManager(sensor, repository, async () => {},
    (saved, devices) => devices.find(({ id }) => id === saved.deviceId) ?? null,
    () => coordinator.onDrop())
  const suspend = vi.fn(async () => {})
  const permission = vi.fn<() => string | null>(() => null)
  const coordinator = new MiniDeviceCoordinator({
    manager, safety, policy: new MiniReconnectPolicy(store), initialize: () => manager.initialize(),
    scan: sensor.scan, suspendTransport: suspend, permissionError: permission,
    startCalibration: () => emit(state, true), resetCalibration: sensor.resetCalibration,
  })
  function show() { safety.setForeground(true); coordinator.show() }
  function hide() { safety.setForeground(false); coordinator.hide() }
  const idle = () => vi.waitFor(() => expect(coordinator.getSnapshot().action).toBe('idle'))
  return { coordinator, safety, manager, sensor, repository, store, emit, suspend, permission, show, hide, idle,
    readPolicy: () => rawPolicy, readBinding: () => persisted }
}

describe('微信设备协调器', () => {
  it('首次启动无绑定时不访问蓝牙或主动检查授权，手动连接后才保存开启偏好', async () => {
    const env = setup(null)
    env.show()
    await vi.waitFor(() => expect(env.coordinator.getSnapshot().initialized).toBe(true))
    await env.idle()
    expect(env.sensor.scan).not.toHaveBeenCalled()
    expect(env.permission).not.toHaveBeenCalled()
    await env.coordinator.select(first)
    expect(env.readBinding()?.deviceId).toBe(first.id)
    expect(env.store.set).toHaveBeenCalledWith(RECONNECT_POLICY_KEY, preference(first.id, true))
    expect(env.coordinator.getSnapshot().calibrating).toBe(false)
  })

  it('兼容无策略的旧绑定，同名设备只匹配已绑定 ID，重复 onShow 不并行恢复', async () => {
    const env = setup()
    env.show()
    env.coordinator.show()
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledExactlyOnceWith(first.id))
    await env.idle()
    expect(env.sensor.scan).toHaveBeenCalledTimes(1)
    expect(env.store.set).not.toHaveBeenCalled()
  })

  it('匹配不到绑定时只使用原有有限重试，保留待用户处理状态', async () => {
    const env = setup()
    env.sensor.scan.mockResolvedValue([second])
    env.show()
    await vi.waitFor(() => expect(env.manager.getSnapshot().reconnectState).toBe('waiting-user'))
    await env.idle()
    env.coordinator.show()
    expect(env.sensor.scan).toHaveBeenCalledTimes(4)
    expect(env.sensor.connect).not.toHaveBeenCalled()
  })

  it('主动断开保留绑定，冷启动和再次前台均遵守策略；重连失败不恢复偏好', async () => {
    const env = setup()
    env.show()
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledOnce())
    await env.idle()
    await env.coordinator.disconnect()
    expect(env.readPolicy()).toBe(preference(first.id, false))
    expect(env.readBinding()?.deviceId).toBe(first.id)
    env.hide()
    env.show()
    await env.idle()
    expect(env.sensor.connect).toHaveBeenCalledOnce()

    const reboot = setup(env.readBinding(), env.readPolicy())
    reboot.show()
    await vi.waitFor(() => expect(reboot.coordinator.getSnapshot().initialized).toBe(true))
    await reboot.idle()
    expect(reboot.sensor.scan).not.toHaveBeenCalled()
    reboot.sensor.scan.mockResolvedValueOnce([]).mockResolvedValue([])
    await expect(reboot.coordinator.reconnect()).rejects.toThrow('未能连接')
    expect(reboot.readPolicy()).toBe(preference(first.id, false))
    reboot.sensor.scan.mockResolvedValue([first])
    await reboot.coordinator.reconnect()
    expect(reboot.readPolicy()).toBe(preference(first.id, true))
  })

  it('等后台清理真正结束再恢复；快速切回后台不会在旧前台重新打开蓝牙', async () => {
    const env = setup()
    env.show()
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledOnce())
    await env.idle()
    const pending = deferred<void>()
    env.suspend.mockReturnValueOnce(pending.promise)
    env.hide()
    env.show()
    await vi.waitFor(() => expect(env.suspend).toHaveBeenCalledOnce())
    expect(env.coordinator.getSnapshot().action).toBe('suspending')
    expect(env.sensor.connect).toHaveBeenCalledOnce()
    env.hide()
    pending.resolve(undefined)
    await env.idle()
    expect(env.sensor.connect).toHaveBeenCalledOnce()
    env.show()
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledTimes(2))
    expect(env.store.set).not.toHaveBeenCalled()
  })

  it('手动扫描持有同一个锁，候选返回前拒绝切换和重连', async () => {
    const env = setup(null)
    const pending = deferred<SensorDevice[]>()
    env.sensor.scan.mockReturnValueOnce(pending.promise)
    env.show()
    const scan = env.coordinator.scan()
    expect(env.safety.getSnapshot().safe).toBe(false)
    await expect(env.coordinator.select(first)).rejects.toThrow('设备正在操作')
    await expect(env.coordinator.reconnect()).rejects.toThrow('设备正在操作')
    expect(env.sensor.disconnect).not.toHaveBeenCalled()
    pending.resolve([first])
    await expect(scan).resolves.toEqual([first])
    expect(env.safety.getSnapshot().safe).toBe(true)
  })

  it.each(['请打开手机蓝牙', '请允许微信使用蓝牙'])('自动恢复遇到%s时停止', async (message) => {
    const env = setup()
    env.permission.mockReturnValue(message)
    env.show()
    await vi.waitFor(() => expect(env.coordinator.getSnapshot().error).toBe(message))
    expect(env.sensor.scan).not.toHaveBeenCalled()
  })

  it('旧设备已主动断开时，切换失败不会连接旧设备；成功后才写新偏好', async () => {
    const env = setup(oldBinding, preference(first.id, false))
    env.show()
    await vi.waitFor(() => expect(env.coordinator.getSnapshot().initialized).toBe(true))
    await env.idle()
    env.sensor.connect.mockRejectedValueOnce(new Error('新设备连接失败'))
    await expect(env.coordinator.select(second)).rejects.toThrow('新设备连接失败')
    expect(env.readBinding()?.deviceId).toBe(first.id)
    expect(env.readPolicy()).toBe(preference(first.id, false))
    expect(env.sensor.connect).toHaveBeenCalledExactlyOnceWith(second.id)
    await env.coordinator.select(second)
    expect(env.readPolicy()).toBe(preference(second.id, true))
  })

  it('忘记设备等待在途绑定写入，然后清除绑定及策略，旧结果不能复活', async () => {
    const env = setup(null)
    const writing = deferred<void>()
    const save = env.repository.save.getMockImplementation()
    env.repository.save.mockImplementationOnce(async (value) => { await writing.promise; await save?.(value) })
    env.show()
    const selection = env.coordinator.select(first).catch((error: unknown) => error)
    await vi.waitFor(() => expect(env.repository.save).toHaveBeenCalledOnce())
    const forgetting = env.coordinator.forget()
    expect(env.safety.getSnapshot().safe).toBe(false)
    expect(env.repository.clear).not.toHaveBeenCalled()
    writing.resolve(undefined)
    await forgetting
    expect(await selection).toBeInstanceOf(Error)
    expect(env.readBinding()).toBeNull()
    expect(env.readPolicy()).toBeNull()
  })

  it.each(['无效 JSON', preference(second.id, true)])('策略损坏或绑定不一致时等待用户修复', async (raw) => {
    const env = setup(oldBinding, raw)
    env.show()
    await vi.waitFor(() => expect(env.coordinator.getSnapshot().policyNeedsRepair).toBe(true))
    await env.idle()
    expect(env.sensor.scan).not.toHaveBeenCalled()
    await env.coordinator.reconnect()
    expect(env.readPolicy()).toBe(preference(first.id, true))
  })

  it('策略读写错误可见，写失败仍完成断开并在本进程抑制自动恢复', async () => {
    const env = setup()
    env.store.get.mockRejectedValueOnce(new Error('读取失败'))
    env.show()
    await vi.waitFor(() => expect(env.coordinator.getSnapshot().policyNeedsRepair).toBe(true))
    await env.idle()
    expect(env.sensor.scan).not.toHaveBeenCalled()
    await env.coordinator.reconnect()
    env.store.set.mockRejectedValueOnce(new Error('写入失败'))
    await expect(env.coordinator.disconnect()).rejects.toThrow('自动重连偏好保存失败')
    expect(env.coordinator.getSnapshot().autoReconnectSuppressed).toBe(true)
    expect(env.sensor.disconnect).toHaveBeenCalledOnce()
  })

  it('掉线恢复持有业务锁，更新独占时自动恢复等待到门释放', async () => {
    const env = setup()
    await env.coordinator.initialize()
    env.show()
    const install = env.safety.beginApply()
    expect(install).toBeTypeOf('function')
    await expect(env.coordinator.scan()).rejects.toThrow('正在应用更新')
    await Promise.resolve()
    expect(env.sensor.scan).not.toHaveBeenCalled()
    install?.()
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledOnce())
    await env.idle()
    const pending = deferred<SensorDevice[]>()
    env.sensor.scan.mockReturnValueOnce(pending.promise)
    env.emit('disconnected')
    await vi.waitFor(() => expect(env.sensor.scan).toHaveBeenCalledTimes(2))
    expect(env.safety.getSnapshot().safe).toBe(false)
    pending.resolve([first])
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledTimes(2))
    await env.idle()
    expect(env.safety.getSnapshot().safe).toBe(true)
  })

  it('选择页离开后取消旧连接，并等原生任务真正完成才开放新操作', async () => {
    const env = setup(null)
    const native = deferred<void>()
    const owner = Symbol('选择弹窗')
    env.sensor.connect.mockReturnValueOnce(native.promise)
    env.show()
    const selection = env.coordinator.select(first, owner).catch((error: unknown) => error)
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledOnce())
    env.coordinator.cancelSelection(owner)
    expect(env.safety.getSnapshot().safe).toBe(false)
    await expect(env.coordinator.scan()).rejects.toThrow('设备正在操作')
    native.resolve(undefined)
    expect(await selection).toBeInstanceOf(Error)
    await env.idle()
    expect(env.readBinding()).toBeNull()
  })

  it('无姿态帧时也能显示校准并持锁，取消或断线会清理校准状态', async () => {
    const env = setup()
    env.show()
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledOnce())
    await env.idle()
    env.coordinator.startCalibration()
    expect(env.coordinator.getSnapshot()).toMatchObject({ action: 'calibrating', calibrating: true })
    expect(env.safety.getSnapshot().safe).toBe(false)
    env.coordinator.cancelCalibration()
    expect(env.safety.getSnapshot().safe).toBe(true)
    env.coordinator.startCalibration()
    env.emit('disconnected')
    expect(env.coordinator.getSnapshot().calibrating).toBe(false)
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledTimes(2))
    await env.idle()
    expect(env.safety.getSnapshot().safe).toBe(true)
  })

  it('真实校准完成后立即释放占用，后续再次确认中心仍能启动', async () => {
    const env = setup()
    env.show()
    await vi.waitFor(() => expect(env.sensor.connect).toHaveBeenCalledOnce())
    await env.idle()
    env.coordinator.startCalibration()
    env.emit('connected', false)
    expect(env.coordinator.getSnapshot()).toMatchObject({ action: 'idle', calibrating: false })
    expect(env.safety.getSnapshot().safe).toBe(true)
    env.coordinator.startCalibration()
    env.coordinator.invalidateCalibration()
    expect(env.coordinator.getSnapshot()).toMatchObject({ action: 'idle', calibrating: false })
    expect(env.safety.getSnapshot().safe).toBe(true)
  })
})

describe('微信设备状态与电量', () => {
  it.each([
    ['idle', '设备未连接'], ['scanning', '正在查找设备'], ['connecting', '正在连接'],
    ['discovering', '设备初始化中'], ['subscribing', '设备初始化中'], ['configuring', '设备初始化中'],
    ['disconnected', '设备未连接'], ['error', '连接异常'],
  ] as const)('%s 隐藏旧电量', (state, label) => {
    const env = setup()
    const sensor = { state, battery: { percent: 100 } } as SensorRuntimeSnapshot
    expect(presentDeviceStatus({ ...env.coordinator.getSnapshot(), initialized: true, foreground: true,
      connection: env.manager.getSnapshot(), sensor })).toMatchObject({ label, batteryPercent: null })
  })

  it.each([[0, true], [20, true], [25, false], [100, false], [null, false], [-1, false], [101, false]] as const)(
    '已连接时电量 %s 不影响连接状态，扫描保留电量，切换隐藏',
    (percent, batteryLow) => {
      const env = setup()
      const sensor = { state: 'connected', battery: { percent }, gameInput: { calibrated: false } } as SensorRuntimeSnapshot
      const input = { ...env.coordinator.getSnapshot(), initialized: true, foreground: true, connection: env.manager.getSnapshot(), sensor }
      const batteryPercent = percent !== null && percent >= 0 && percent <= 100 ? percent : null
      expect(presentDeviceStatus({ ...input, action: 'scanning' })).toMatchObject({
        label: '设备已连接', batteryPercent, batteryLow, batteryFill: batteryPercent ?? 0, calibrationLabel: '需校准中心',
      })
      expect(presentDeviceStatus({ ...input, action: 'selecting' })).toMatchObject({ label: '正在更换设备', batteryPercent: null })
      expect(presentDeviceStatus({ ...input, calibrating: true })).toMatchObject({ label: '正在校准', batteryPercent })
    },
  )
})
