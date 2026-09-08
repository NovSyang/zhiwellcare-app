import type { Container, Sprite, Texture } from 'pixi.js'

/** 固定容量精灵池复用显示对象，避免移动端训练中频繁触发垃圾回收。 */
export class KartSpritePool {
  textureForKind: ((kind: string) => Texture) | null = null
  private available: Sprite[] = []
  private active = new Map<string, Sprite>()

  constructor(parent: Container, size: number, factory: () => Sprite) {
    for (let index = 0; index < size; index += 1) {
      const sprite = factory()
      sprite.visible = false
      parent.addChild(sprite)
      this.available.push(sprite)
    }
  }

  acquire(id: string, kind = ''): Sprite | null {
    const existing = this.active.get(id)
    if (existing) return existing
    const sprite = this.available.pop()
    if (!sprite) return null
    if (this.textureForKind) sprite.texture = this.textureForKind(kind)
    sprite.visible = true
    sprite.alpha = 1
    this.active.set(id, sprite)
    return sprite
  }

  releaseMissing(ids: ReadonlySet<string>): void {
    for (const [id, sprite] of this.active) {
      if (ids.has(id)) continue
      this.active.delete(id)
      sprite.visible = false
      this.available.push(sprite)
    }
  }

  destroy(): void {
    this.active.clear()
    this.available = []
  }
}
