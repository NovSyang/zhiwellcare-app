import type { IBackButtonService, NativeBackEvent } from './IBackButtonService'

/** 非 Android 平台没有系统返回键监听。 */
export class NoopBackButtonService implements IBackButtonService {
  onBack(_callback: (event: NativeBackEvent) => void): () => void { return () => undefined }
  async minimizeApp(): Promise<void> {}
  async dispose(): Promise<void> {}
}
