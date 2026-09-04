/** 小型配置存储的异步抽象，便于浏览器与测试环境替换实现。 */
export interface IKeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}
