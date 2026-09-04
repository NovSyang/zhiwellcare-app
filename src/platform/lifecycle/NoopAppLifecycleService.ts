import type { IAppLifecycleService } from './IAppLifecycleService'

/** 桌面端始终视为前台，保持原有训练生命周期。 */
export class NoopAppLifecycleService implements IAppLifecycleService {
  onActiveChanged(callback: (active: boolean) => void): () => void {
    callback(true)
    return () => undefined
  }
  async dispose(): Promise<void> {}
}
