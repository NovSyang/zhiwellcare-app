export interface ReplayPosition { elapsed: number; trajectory: boolean }
export const REPLAY_RETURN = 'replayPosition'

let sequence = 0
const returns = new Map<string, ReplayPosition | null>()

/** 事件通道不可用时，只为当前详情页保留一份临时回放进度。 */
export function createReplayReturn(): string {
  const ticket = String(++sequence)
  returns.set(ticket, null)
  return ticket
}

export function saveReplayReturn(ticket: string, position: ReplayPosition) {
  if (returns.has(ticket)) returns.set(ticket, position)
}

export function takeReplayReturn(ticket: string): ReplayPosition | undefined {
  const position = returns.get(ticket)
  if (position) returns.delete(ticket)
  return position ?? undefined
}

export function discardReplayReturn(ticket: string) { returns.delete(ticket) }
