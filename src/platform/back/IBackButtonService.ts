export interface NativeBackEvent { canGoBack: boolean }

export interface IBackButtonService {
  onBack(callback: (event: NativeBackEvent) => void): () => void
  minimizeApp(): Promise<void>
  dispose(): Promise<void>
}
