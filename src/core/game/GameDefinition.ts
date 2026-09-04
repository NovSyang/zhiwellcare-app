/** 游戏选择页需要的最小展示与渲染能力信息。 */
export interface GameDefinition {
  id: string
  name: string
  description: string
  renderer: 'pixi' | 'three'
  enabled: boolean
}
