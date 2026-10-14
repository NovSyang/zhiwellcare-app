import type { IAppLifecycleService } from './IAppLifecycleService'

/** 普通网页不执行原生安装，沿用默认前台状态；Tauri 使用真实窗口生命周期。 */
export class NoopAppLifecycleService implements IAppLifecycleService {
  onActiveChanged(callback: (active: boolean) => void): () => void {
    callback(true)
    return () => undefined
  }
  async dispose(): Promise<void> {}
}
