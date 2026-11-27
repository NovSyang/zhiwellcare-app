import { mallGoodsCatalog, type Goods } from '@/shared/mall-catalog'

export { mallCategories } from '@/shared/mall-catalog'
export type { Goods } from '@/shared/mall-catalog'

// 包根绝对路径在训练小程序的主包和内容分包中含义一致。
const miniImages: Partial<Record<string, string>> = {
  'wrist-wobble-trainer': '/assets/mall/wrist-motion-home-trainer.jpg',
  'adult-finger-separator-board': '/assets/mall/adult-finger-separator-board.jpg',
  'head-massager': '/assets/mall/head-massager.jpg',
}

export const mallGoods: Goods[] = mallGoodsCatalog.map((product) => {
  const coverImage = miniImages[product.id]
  return coverImage ? { ...product, coverImage } : product
})

export function findGoodsById(id: string): Goods | undefined {
  return mallGoods.find((product) => product.id === id)
}
