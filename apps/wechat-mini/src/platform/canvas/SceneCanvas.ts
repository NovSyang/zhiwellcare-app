export type CanvasPoint = { x: number; y: number }

/** 训练和回放共用简单的图形笔画，坐标以画布逻辑像素为单位。 */
export function fillPolygon(ctx: CanvasRenderingContext2D, points: readonly CanvasPoint[], color: string): void {
  if (!points.length) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

export function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, 2 * Math.PI)
  ctx.fillStyle = color
  ctx.fill()
}

export function drawSceneLabel(ctx: CanvasRenderingContext2D, label: string, width: number, y = 27): void {
  ctx.font = 'bold 17px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const halfWidth = ctx.measureText(label).width / 2 + 12
  ctx.fillStyle = 'rgba(8, 24, 40, 0.8)'
  ctx.fillRect(width / 2 - halfWidth, y - 13, halfWidth * 2, 26)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, width / 2, y)
}
