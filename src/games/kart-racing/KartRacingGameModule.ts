import type { GameModule } from '../../core/game/GameModule'
import { presentKartRacingResult } from './KartRacingResultPresentation'
import { KartRacingGame } from './KartRacingGame'
import { defaultKartRacingGameConfig, KART_RACING_GAME_ID, KART_RACING_GAME_NAME, type KartRacingGameConfig } from './KartRacingGameConfig'
import type { KartRacingTrainingResult } from './KartRacingTrainingResult'
import { KartRacingReplayPlayer } from './replay/KartRacingReplayPlayer'

/** 卡丁车模块通过统一契约接入选择、训练、结果、历史与回放。 */
export const kartRacingGameModule: GameModule<KartRacingTrainingResult, KartRacingGameConfig> = {
  definition: {
    id: KART_RACING_GAME_ID,
    name: KART_RACING_GAME_NAME,
    description: '控制卡丁车完成固定赛道，通过左右转向、前向加速和后向减速进行四方向协调训练。',
    renderer: 'pixi',
    enabled: true,
  },
  createGame: (events) => new KartRacingGame(structuredClone(defaultKartRacingGameConfig), events),
  getConfigSnapshot: () => structuredClone(defaultKartRacingGameConfig),
  presentResult: presentKartRacingResult,
  createReplayPlayer: () => new KartRacingReplayPlayer(),
}

// 保留原游戏模块的结果展示入口。
export { presentKartRacingResult } from './KartRacingResultPresentation'
