import Taro from '@tarojs/taro'

export interface CanvasSurface {
  node: Taro.Canvas
  width: number
  height: number
}

/** 训练和回放都按原生节点尺寸绘图，设备像素比统一在此处理。 */
export function queryCanvasSurface(selector: string): Promise<CanvasSurface> {
  return new Promise((resolve, reject) => Taro.createSelectorQuery().select(selector)
    .fields({ node: true, size: true }, (data: unknown) => {
      const canvas = data as Partial<CanvasSurface> | null
      if (!canvas?.node || !canvas.width || !canvas.height) reject(new Error('画布尚未就绪，请重试。'))
      else resolve({ node: canvas.node, width: canvas.width, height: canvas.height })
    }).exec())
}

/** 设置物理像素缓冲区，业务绘图仍然使用逻辑像素。 */
export function prepareCanvas(surface: CanvasSurface): CanvasRenderingContext2D {
  const scale = Math.min(2, Math.max(1, Taro.getWindowInfo().pixelRatio || 1))
  surface.node.width = Math.round(surface.width * scale)
  surface.node.height = Math.round(surface.height * scale)
  const context = surface.node.getContext('2d') as CanvasRenderingContext2D
  if (!context) throw new Error('当前环境无法创建 2D 画布。')
  context.scale(scale, scale)
  return context
}
