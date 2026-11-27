/** 购物车本地占位存储键（localStorage）。 */
export const cartStorageKey = 'zhiwellcare.mall.cart.v1'

/** 购物车条目：仅记录商品 id 与数量，商品信息实时由 mallGoods 解析。 */
export interface MallCartItem {
  productId: string
  quantity: number
}

function isMallCartItem(value: unknown): value is MallCartItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.productId === 'string' &&
    typeof item.quantity === 'number' &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0
  )
}

/** 读取本地购物车；数据缺失或损坏时安全降级为空购物车。 */
export function readMallCart(): MallCartItem[] {
  try {
    const raw = localStorage.getItem(cartStorageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isMallCartItem)
  } catch {
    return []
  }
}

/** 写回本地购物车（演示占位，无网络请求）。 */
export function writeMallCart(items: MallCartItem[]): void {
  try {
    localStorage.setItem(cartStorageKey, JSON.stringify(items))
  } catch {
    /* 存储不可用时忽略，不影响页面浏览。 */
  }
}
