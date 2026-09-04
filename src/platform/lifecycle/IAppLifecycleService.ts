export interface IAppLifecycleService {
  onActiveChanged(callback: (active: boolean) => void): () => void
  dispose(): Promise<void>
}
