import { resolveDeviceModel, type SensorDevice, type TrainingRecordDeviceSnapshot } from '@/shared/core'
import { catalogService } from './MiniServices'
import { isMiniTrainingGameId } from './TrainingGames'

/** 对已完成 BS-BT91 握手的设备，优先用广播名识别，再用唯一协议型号兜底。 */
export async function getTrainingOffers(device?: SensorDevice) {
  const games = (await catalogService.listAllGames()).filter(({ gameId }) => isMiniTrainingGameId(gameId))
  const unavailable = () => games.map((game) => ({ game, device: null }))
  if (!games.length || !device) return unavailable()
  const models = (await catalogService.listDeviceModels()).filter(({ protocol }) => protocol === 'bs-bt91')
  const model = resolveDeviceModel(models, device) ?? (models.length === 1 ? models[0] : null)
  if (!model) return unavailable()
  const matching = await catalogService.listModelGames(model)
  const ids = new Set(matching.map(({ gameId }) => gameId))
  const snapshot: TrainingRecordDeviceSnapshot = { modelId: model.modelId, modelName: model.name, capabilityTags: [...model.capabilityTags] }
  return games.map((game) => ({ game, device: ids.has(game.gameId) ? snapshot : null }))
}
