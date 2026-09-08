/** 漂流场景统一使用左上高光、右下暗面的明快卡通色板。 */
export const riverDriftColors = {
  grassTop: 0x8fd06e,
  grassBottom: 0x5eaa57,
  grassHighlight: 0xc5e999,
  bankDark: 0x477f49,
  shallowWater: 0xa9e2e8,
  waterTop: 0xa8e4ee,
  waterBottom: 0x58abc8,
  waterHighlight: 0xeaffff,
  shadow: 0x21485c,
  boatSide: 0xc96b25,
  boatMain: 0xf3a238,
  boatLight: 0xffd276,
  boatInside: 0x9a4f28,
  whiteShell: 0xf8fbfd,
  whiteShellShade: 0xcbdce6,
  deviceBlue: 0x7bb8dc,
  deviceBlueShade: 0x4e8fb8,
  contact: 0x17242d,
  coinSide: 0xd88a18,
  coinFront: 0xffd64f,
  coinLight: 0xfff4a4,
} as const

/** 所有静态材质都复用同一光照方向，避免各物体看起来互不相干。 */
export const riverDriftLight = {
  highlightOffsetX: -0.24,
  highlightOffsetY: -0.28,
  shadowOffsetX: 0.16,
  shadowOffsetY: 0.20,
} as const
