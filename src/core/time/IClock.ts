/** 时间戳用于存档和传感器，单调时钟只用于计算时间差。 */
export interface IClock {
  nowEpochMs(): number
  nowMonotonicMs(): number
}
