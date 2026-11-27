import wristMotionHomeTrainerImage from '../assets/mall/wrist-motion-home-trainer.jpg'
import adultFingerSeparatorBoardImage from '../assets/mall/adult-finger-separator-board.jpg'
import headMassagerImage from '../assets/mall/head-massager.jpg'
import { mallGoodsCatalog, type Goods } from './mall.catalog'

export { mallCategories } from './mall.catalog'
export type { Goods, GoodsKind } from './mall.catalog'

const appImages: Partial<Record<string, string>> = {
  'wrist-wobble-trainer': wristMotionHomeTrainerImage,
  'adult-finger-separator-board': adultFingerSeparatorBoardImage,
  'head-massager': headMassagerImage,
}

/** 原 APP 使用 Vite 图片地址，商品资料与微信端共用。 */
export const mallGoods: Goods[] = mallGoodsCatalog.map((product) => {
  const coverImage = appImages[product.id]
  return coverImage ? { ...product, coverImage } : product
})

export function findGoodsById(id: string): Goods | undefined {
  return mallGoods.find((product) => product.id === id)
}
