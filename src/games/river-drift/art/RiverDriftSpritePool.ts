import type { Container, Sprite, Texture } from 'pixi.js'

/** 固定容量精灵池维护业务 ID 到显示对象的绑定，离场后可立即复用。 */
export class RiverDriftSpritePool {
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

  acquire(id: string, kind = ''): Sprite {
    const existing = this.active.get(id)
    if (existing) return existing
    const sprite = this.available.pop()
    // 配置保证池容量大于同屏上限；防御分支只复用现有对象且不分配新纹理。
    if (!sprite) return [...this.active.values()][0]
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
