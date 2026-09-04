import type { GameDefinition } from '../core/game/GameDefinition'
import type { GameModule } from '../core/game/GameModule'
import { targetReachGameModule } from './target-reach/TargetReachGameModule'
import { trajectoryFollowGameModule } from './trajectory-follow/TrajectoryFollowGameModule'

/** Registry 需要容纳不同 Result/Config 泛型，实际解释始终由对应模块完成。 */
export type RegisteredGameModule = GameModule<any, any>

/** 构建注册表时拒绝重复 ID，避免路由与历史被错误模块解释。 */
export function createGameRegistry(modules: readonly RegisteredGameModule[]): Map<string, RegisteredGameModule> {
  const registry = new Map<string, RegisteredGameModule>()
  for (const module of modules) {
    if (registry.has(module.definition.id)) throw new Error(`训练游戏 ID 重复：${module.definition.id}`)
    registry.set(module.definition.id, module)
  }
  return registry
}

const gameRegistry = createGameRegistry([targetReachGameModule, trajectoryFollowGameModule])

export function getGameModule(gameId: string): RegisteredGameModule | null {
  return gameRegistry.get(gameId) ?? null
}

/** 返回展示元数据副本，页面不能修改 Registry 内的模块定义。 */
export function getGameDefinitions(): GameDefinition[] {
  return [...gameRegistry.values()].map((module) => ({ ...module.definition }))
}
