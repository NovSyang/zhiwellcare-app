const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const pad = (value: number) => String(value).padStart(2, '0')

/** Epoch 时间只在展示时转北京时间，避免受手机时区影响。 */
function beijingDate(timestamp: number): Date | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null
  const date = new Date(timestamp + BEIJING_OFFSET_MS)
  return Number.isFinite(date.getTime()) ? date : null
}

function dateText(year: number, month: number, day: number) {
  return `${year}年${pad(month)}月${pad(day)}日`
}

function timeText(date: Date, seconds = false) {
  const base = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  return seconds ? `${base}:${pad(date.getUTCSeconds())}` : base
}

export function formatDate(timestamp: number): string {
  const date = beijingDate(timestamp)
  return date ? dateText(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) : '暂无记录'
}

export function formatTime(timestamp: number): string {
  const date = beijingDate(timestamp)
  return date ? timeText(date) : '--'
}

export function formatDateTime(timestamp: number, options?: { seconds?: boolean }): string {
  const date = beijingDate(timestamp)
  return date ? `${dateText(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())} ${timeText(date, options?.seconds)}` : '暂无记录'
}

/** 打卡日期键保留原日期，只检查年月日是否构成合法的日历日期。 */
export function formatDateKey(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey)
  if (!match) return '--'
  const [, y, m, d] = match
  const year = Number(y), month = Number(m), day = Number(d)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return '--'
  return dateText(year, month, day)
}

/** 微调显示精度只影响文案，训练和回放仍以毫秒计算。 */
export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '--'
  const total = Math.round(durationMs / 1000)
  const hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60, seconds = total % 60
  return [hours ? `${hours}小时` : '', minutes ? `${minutes}分钟` : '', seconds || total === 0 ? `${seconds}秒` : ''].join('')
}
