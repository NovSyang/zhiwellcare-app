import { afterEach, describe, expect, it, vi } from 'vitest'
import { MiniOperationSafety } from '../apps/wechat-mini/src/app/MiniOperationSafety'
import { MiniUpdateService } from '../apps/wechat-mini/src/app/MiniUpdateService'
import { readMiniVersion } from '../apps/wechat-mini/src/app/MiniVersion'
import { WeChatUpdateProvider } from '../apps/wechat-mini/src/platform/update/WeChatUpdateProvider'

const profile = 'pages/profile/index'
const result = 'features/training/result/index'
const session = 'features/training/session/index'
const disposals: Array<() => void> = []
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose())
  vi.useRealTimers()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup() {
  let route = profile
  const switchPage = (next: string) => { route = next; safety.show(Symbol(next), next) }
  const safety = new MiniOperationSafety(() => route)
  let ready = () => {}
  let failed = () => {}
  let check = (_result: { hasUpdate: boolean }) => {}
  const apply = vi.fn()
  const getManager = vi.fn(() => ({
    onCheckForUpdate: (callback: typeof check) => { check = callback },
    onUpdateReady: (callback: typeof ready) => { ready = callback },
    onUpdateFailed: (callback: typeof failed) => { failed = callback },
    applyUpdate: apply,
  }))
  const confirm = vi.fn(async () => false)
  const cleanup = vi.fn(async () => {})
  const service = new MiniUpdateService(new WeChatUpdateProvider(getManager), safety, confirm, cleanup, 100)
  disposals.push(() => service.dispose())
  service.initialize()
  return { service, safety, switchPage, apply, confirm, cleanup, getManager,
    ready: () => ready(), failed: () => failed(), check: (hasUpdate: boolean) => check({ hasUpdate }) }
}

describe('微信更新与业务安全门', () => {
  it('个人活动范围期间不提示，独立更新页就绪后可手动通过同一安全门', async () => {
    const env = setup()
    env.switchPage('features/settings/range/index')
    env.safety.setForeground(true)
    const release = env.safety.acquire('个人活动范围')
    env.ready()
    expect(env.service.getSnapshot().canRequest).toBe(false)
    env.switchPage('features/profile/update/index')
    expect(env.service.getSnapshot().canRequest).toBe(false)
    release()
    await vi.waitFor(() => expect(env.confirm).toHaveBeenCalledOnce())
    expect(env.service.getSnapshot().canRequest).toBe(true)
    await env.service.request(true)
    expect(env.confirm).toHaveBeenCalledTimes(2)
  })

  it('仅注册一次，显示原生检查、下载和失败状态，就绪优先于迟到事件', () => {
    const env = setup()
    env.service.initialize()
    env.service.onForeground()
    expect(env.getManager).toHaveBeenCalledTimes(1)
    expect(env.service.getSnapshot().state).toBe('waiting-check')
    env.check(true)
    expect(env.service.getSnapshot().state).toBe('downloading')
    env.failed()
    expect(env.service.getSnapshot().state).toBe('failed')
    env.ready()
    env.check(false)
    env.failed()
    env.ready()
    expect(env.service.getSnapshot().state).toBe('ready')

    const latest = setup()
    latest.check(false)
    expect(latest.service.getSnapshot().state).toBe('up-to-date')
  })

  it('旧环境和初始化异常都会降级为不支持', () => {
    for (const getManager of [() => undefined, () => { throw new Error('更新 API 不可用') }]) {
      const update = new MiniUpdateService(new WeChatUpdateProvider(getManager), new MiniOperationSafety(() => profile), async () => true, async () => {})
      update.initialize()
      expect(update.getSnapshot()).toMatchObject({ state: 'unsupported', canRequest: false })
      update.dispose()
    }
  })

  it('最后一把业务锁结束后才显示提醒，稍后更新在同一前台周期去重', async () => {
    const env = setup()
    env.switchPage(profile)
    env.safety.setForeground(true)
    const training = env.safety.acquire('训练')
    const scan = env.safety.acquire('扫描')
    const write = deferred<void>()
    const storing = env.safety.withLock('写回放', () => write.promise)
    env.ready()
    training()
    training()
    scan()
    expect(env.service.getSnapshot().safe).toBe(false)
    expect(env.confirm).not.toHaveBeenCalled()
    write.resolve(undefined)
    await storing
    await vi.waitFor(() => expect(env.confirm).toHaveBeenCalledTimes(1))
    env.safety.acquire('活动范围')()
    await Promise.resolve()
    expect(env.confirm).toHaveBeenCalledTimes(1)
    await env.service.request(true)
    expect(env.confirm).toHaveBeenCalledTimes(2)
    env.safety.setForeground(false)
    env.safety.setForeground(true)
    await vi.waitFor(() => expect(env.confirm).toHaveBeenCalledTimes(3))
  })

  it('前台仅在当前允许页可见时提示，保存失败和页面交接期间持续延迟', async () => {
    const env = setup()
    const training = env.safety.acquire('训练页')
    env.switchPage(session)
    env.ready()
    env.safety.setForeground(true)
    expect(env.service.getSnapshot().canRequest).toBe(false)
    await expect(env.safety.withLock('写回放', async () => { throw new Error('存储失败') })).rejects.toThrow('存储失败')
    expect(env.service.getSnapshot().canRequest).toBe(false)
    const payload = deferred<void>()
    const saving = env.safety.withLock('同一记录重试', () => payload.promise)
    training()
    env.switchPage(result)
    expect(env.service.getSnapshot().canRequest).toBe(false)
    env.safety.setForeground(false)
    payload.resolve(undefined)
    await saving
    expect(env.confirm).not.toHaveBeenCalled()
    env.safety.setForeground(true)
    await vi.waitFor(() => expect(env.confirm).toHaveBeenCalledTimes(1))
  })

  it('旧页隐藏失效，真实页面栈仍需与可见页一致', () => {
    let top = profile
    const safety = new MiniOperationSafety(() => top)
    const old = Symbol('旧页')
    const current = Symbol('当前页')
    safety.setForeground(true)
    safety.show(old, profile)
    top = result
    expect(safety.getSnapshot().safe).toBe(false)
    safety.show(current, result)
    safety.hide(old)
    expect(safety.getSnapshot().safe).toBe(true)
    safety.hide(current)
    expect(safety.getSnapshot().safe).toBe(false)
  })

  it.each(['业务锁', '后台', '切页'])('确认期间发生%s时不应用过期结果', async (change) => {
    const env = setup()
    const confirmation = deferred<boolean>()
    env.confirm.mockReturnValueOnce(confirmation.promise)
    env.switchPage(profile)
    env.safety.setForeground(true)
    env.ready()
    await vi.waitFor(() => expect(env.confirm).toHaveBeenCalledTimes(1))
    if (change === '业务锁') env.safety.acquire('连接设备')()
    if (change === '后台') env.safety.setForeground(false)
    if (change === '切页') env.switchPage(result)
    confirmation.resolve(true)
    await vi.waitFor(() => expect(env.service.getSnapshot().promptOpen).toBe(false))
    expect(env.apply).not.toHaveBeenCalled()
    expect(env.service.getSnapshot().state).toBe('ready')
  })

  it('确认后独占到清理结束，期间拒绝设备、导航与写入并只调用一次', async () => {
    const env = setup()
    const pending = deferred<void>()
    env.cleanup.mockReturnValueOnce(pending.promise)
    env.confirm.mockResolvedValue(true)
    env.switchPage(profile)
    env.safety.setForeground(true)
    env.ready()
    await vi.waitFor(() => expect(env.service.getSnapshot().applying).toBe(true))
    for (const reason of ['设备', '导航', '写入']) {
      await expect(env.safety.withLock(reason, async () => {})).rejects.toThrow('正在应用更新')
    }
    expect(env.apply).not.toHaveBeenCalled()
    pending.resolve(undefined)
    await vi.waitFor(() => expect(env.apply).toHaveBeenCalledTimes(1))
    env.ready()
    await env.service.request(true)
    expect(env.apply).toHaveBeenCalledTimes(1)
  })

  it.each(['清理失败', '调用异常'])('%s后保留 ready 供用户重试', async (failure) => {
    const env = setup()
    if (failure === '清理失败') env.cleanup.mockRejectedValueOnce(new Error(failure))
    else env.apply.mockImplementationOnce(() => { throw new Error(failure) })
    env.confirm.mockResolvedValue(true)
    env.switchPage(profile)
    env.safety.setForeground(true)
    env.ready()
    await vi.waitFor(() => expect(env.service.getSnapshot()).toMatchObject({
      state: 'ready', applying: false, error: '暂时无法应用更新，请稍后重试。',
    }))
    expect(env.apply).toHaveBeenCalledTimes(failure === '清理失败' ? 0 : 1)
  })

  it('清理超时仍保护在途原生操作，结束后不会自动调用旧更新', async () => {
    vi.useFakeTimers()
    const env = setup()
    const pending = deferred<void>()
    env.cleanup.mockReturnValueOnce(pending.promise)
    env.confirm.mockResolvedValue(true)
    env.switchPage(profile)
    env.safety.setForeground(true)
    env.ready()
    await vi.advanceTimersByTimeAsync(100)
    expect(env.service.getSnapshot()).toMatchObject({ state: 'ready', applying: true, canRequest: false })
    pending.resolve(undefined)
    await vi.advanceTimersByTimeAsync(1)
    expect(env.service.getSnapshot()).toMatchObject({ state: 'ready', applying: false, canRequest: true })
    expect(env.apply).not.toHaveBeenCalled()
  })

  it('清理中退后台再回到同页，旧确认失效并等待重新确认', async () => {
    const env = setup()
    const pending = deferred<void>()
    env.cleanup.mockReturnValueOnce(pending.promise)
    env.confirm.mockResolvedValue(true)
    env.switchPage(profile)
    env.safety.setForeground(true)
    env.ready()
    await vi.waitFor(() => expect(env.cleanup).toHaveBeenCalledOnce())
    env.safety.setForeground(false)
    env.safety.setForeground(true)
    expect(env.service.getSnapshot().applying).toBe(true)
    pending.resolve(undefined)
    await vi.waitFor(() => expect(env.service.getSnapshot().canRequest).toBe(true))
    expect(env.apply).not.toHaveBeenCalled()
    expect(env.confirm).toHaveBeenCalledOnce()
  })

  it('微信未重启时解除独占，保留手动重试且不自动再次应用', async () => {
    vi.useFakeTimers()
    const env = setup()
    env.confirm.mockResolvedValue(true)
    env.switchPage(profile)
    env.safety.setForeground(true)
    env.ready()
    await vi.advanceTimersByTimeAsync(100)
    expect(env.service.getSnapshot()).toMatchObject({ state: 'ready', applying: false, canRequest: true })
    expect(env.apply).toHaveBeenCalledTimes(1)
  })
})

describe('小程序独立版本展示', () => {
  it.each([
    ['release', '1.2.3', 'V1.2.3', '1.2.3'],
    ['release', 'bad', 'V0.1.0（构建版本）', null],
    ['develop', '1.2.3', 'V0.1.0（开发版）', null],
    ['trial', '1.2.3', 'V0.1.0（体验版）', null],
    ['other', '1.2.3', 'V0.1.0（环境未确认）', null],
  ])('%s 环境使用对应的版本来源', (envVersion, version, displayLabel, runtimeVersion) => {
    expect(readMiniVersion('0.1.0', () => ({ envVersion, version }))).toMatchObject({ displayLabel, runtimeVersion })
  })

  it('读取接口抛错时显示构建号', () => {
    expect(readMiniVersion('0.1.0', () => { throw new Error('旧微信') }).displayLabel).toBe('V0.1.0（环境未确认）')
  })
})
