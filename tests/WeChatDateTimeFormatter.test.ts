import { describe, expect, it } from 'vitest'
import { formatDate, formatDateKey, formatDateTime, formatDuration, formatTime } from '../apps/wechat-mini/src/utils/DateTimeFormatter'

describe('小程序的日期和时长显示', () => {
  // UTC 的年末时刻在北京时间已进入第二年。
  it('使用北京时间、补零和 24 小时制', () => {
    const midnight = Date.UTC(2026, 11, 31, 16, 0, 0)
    expect(formatDateTime(midnight - 1_000, { seconds: true })).toBe('2026年12月31日 23:59:59')
    expect(formatDateTime(midnight)).toBe('2027年01月01日 00:00')
    expect(formatDate(midnight)).toBe('2027年01月01日')
    expect(formatTime(Date.UTC(2026, 10, 27, 10, 5))).toBe('18:05')
  })

  it('保留打卡日期的年月日并拒绝无效日期', () => {
    expect(formatDateKey('2024-02-29')).toBe('2024年02月29日')
    expect(formatDateKey('2026-02-29')).toBe('--')
    expect(formatDateKey('2026-11-31')).toBe('--')
    expect(formatDateKey('2026/11/27')).toBe('--')
  })

  it('对非法时间作兜底，并使用中文时长', () => {
    for (const invalid of [0, -1, NaN, Infinity, Number.MAX_VALUE]) expect(formatDateTime(invalid)).toBe('暂无记录')
    expect(formatDuration(45_000)).toBe('45秒')
    expect(formatDuration(155_000)).toBe('2分钟35秒')
    expect(formatDuration(3_600_000)).toBe('1小时')
    expect(formatDuration(5_100_000)).toBe('1小时25分钟')
    expect(formatDuration(-1000)).toBe('--')
  })
})
