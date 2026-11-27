import type { IKeyValueStore } from '../storage/IKeyValueStore'

const CHECKIN_KEY = 'zhiwellcare.course.checkins.v1'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** 同一课程在使用者本地日期内最多打卡一次。 */
export class CourseCheckins {
  private pending = Promise.resolve()

  constructor(private readonly store: IKeyValueStore) {}

  async list(courseId: string): Promise<string[]> {
    return (await this.read())[courseId] ?? []
  }

  /** 一次读取所有课程的有效日期，用于首页累计和连续打卡统计。 */
  listAll(): Promise<Record<string, string[]>> {
    return this.read()
  }

  complete(courseId: string, date: Date): Promise<string[]> {
    const day = courseDayKey(date)
    // 两个打卡操作先后读取和写回，避免覆盖彼此的新日期。
    const task = this.pending.then(async () => {
      const map = await this.read()
      const dates = [...new Set([...(map[courseId] ?? []), day])].sort()
      map[courseId] = dates
      await this.store.set(CHECKIN_KEY, JSON.stringify(map))
      return dates
    })
    this.pending = task.then(() => undefined, () => undefined)
    return task
  }

  private async read(): Promise<Record<string, string[]>> {
    const raw = await this.store.get(CHECKIN_KEY)
    const map: Record<string, string[]> = Object.create(null)
    if (!raw) return map
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map
      for (const [id, list] of Object.entries(parsed)) {
        if (Array.isArray(list)) {
          map[id] = [...new Set(list.filter((item): item is string => typeof item === 'string' && DATE_PATTERN.test(item)))].sort()
        }
      }
    } catch { /* 旧格式或损坏内容不能作为有效的打卡记录。 */ }
    return map
  }
}

/** 按设备本地日期生成键，避免按 UTC 跨日。 */
export function courseDayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 连续打卡从今天倒推，今天尚未打卡时从昨天开始计算。 */
export function summarizeCourseCheckins(checkins: Record<string, string[]>, now: Date) {
  const day = courseDayKey(now)
  const courses = Object.values(checkins)
  const dates = new Set(courses.flat())
  let streakDays = 0
  const cursor = new Date(now)
  if (!dates.has(day)) cursor.setDate(cursor.getDate() - 1)
  while (dates.has(courseDayKey(cursor))) {
    streakDays += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return {
    day,
    todayCount: courses.filter((list) => list.includes(day)).length,
    totalCount: courses.reduce((sum, list) => sum + list.length, 0),
    streakDays,
  }
}
