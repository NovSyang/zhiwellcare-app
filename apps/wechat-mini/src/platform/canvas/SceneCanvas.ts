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

/** 横屏训练开场时，在画布正中绘制大号倒计时，小窗口按短边缩放。 */
export function drawSceneCountdown(ctx: CanvasRenderingContext2D, seconds: number, width: number, height: number): void {
  const x = width / 2
  const y = height / 2
  // 底板、数字和边框共用 70% 缩放比例，中心位置不变。
  const scale = 0.7
  const radius = Math.min(68, Math.min(width, height) * 0.22) * scale
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(8, 22, 48, 0.90)'
  ctx.fill()
  ctx.strokeStyle = '#9ed5ff'
  ctx.lineWidth = 2 * scale
  ctx.stroke()
  ctx.font = `bold ${Math.round(radius * 1.05)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.fillText(String(seconds), x, y)
  ctx.restore()
}
