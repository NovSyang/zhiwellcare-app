import wristMotionHomeTrainerImage from '../assets/mall/wrist-motion-home-trainer.jpg'
import adultFingerSeparatorBoardImage from '../assets/mall/adult-finger-separator-board.jpg'
import headMassagerImage from '../assets/mall/head-massager.jpg'

/**
 * 商城 Mock 数据 —— 统一交易入口（实物硬件器材 + 上门居家健身指导服务）的演示占位数据。
 *
 * 合规基线（用户可见文案）：
 *  - 全部价格均为「演示价」，仅用于界面演示；正式版接入支付后由 Golang 后端订单系统处理真实订单。
 *  - 实物器材按用途区分主动训练设备、手部辅助用品和按摩用品，分别描述实际功能。
 *  - 上门类服务一律称「上门居家健身指导（非医疗服务）」，不涉及任何专业健康服务表述。
 *  - 文案遵守合规红线词表（详见产品合规文档）；「医疗」仅允许出现在上述强制声明短语中。
 */

export type GoodsKind = 'hardware' | 'service'

export interface Goods {
  id: string
  kind: GoodsKind
  category: '硬件器材' | '训练服务'
  name: string
  summary: string
  /** 演示用整数价格（无真实价格承诺）。 */
  price: number
  /** 计价单位，如 '台' / '次' / '套'。 */
  priceUnit: string
  /** 商品主图（emoji 占位）。 */
  cover: string
  /** 可选的真实商品图片；设置后优先于 emoji 主图展示。 */
  coverImage?: string
  /** 器材图可完整显示，避免裁切掉商品结构。 */
  coverFit?: 'cover' | 'contain'
  /** 辅具和按摩用品使用各自说明；未设置时沿用主动训练硬件文案。 */
  hardwareType?: 'hand-support' | 'massager'
  /** 硬件 = 能力标签 / 规格；服务 = 套餐内容。 */
  spec: string[]
  badges: string[]
  /** 详情要点段落。 */
  detail: string[]
  /** 专属免责文案。 */
  disclaimer: string
  /** 是否需搭配「桌面力矩主动训练底座」使用（手柄配件等）。 */
  relatedHardware?: boolean
}

export const mallCategories: Array<{ id: 'all' | 'hardware' | 'service'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'hardware', label: '硬件器材' },
  { id: 'service', label: '训练服务' },
]

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

export function findGoodsById(id: string): Goods | undefined {
  return mallGoods.find((goods) => goods.id === id)
}

/* =========================================================================
 * 商品清单（演示价；不发起任何网络请求）
 * ========================================================================= */

export const mallGoods: Goods[] = [
  /* ── 硬件器材 ─────────────────────────────────────────────── */
  {
    id: 'wrist-wobble-trainer',
    kind: 'hardware',
    category: '硬件器材',
    name: '腕动游戏居家训练仪',
    summary: '腕部姿态传感训练设备：佩戴后主动挥腕 / 绕腕发力驱动 APP 训练游戏，无电机、无被动驱动，随时在家开练。',
    price: 458,
    priceUnit: '台',
    cover: '⌚',
    coverImage: wristMotionHomeTrainerImage,
    spec: [
      '腕部姿态传感 · 蓝牙低功耗连接',
      '内置电池 · USB-C 充电',
      '不倒翁圆润造型 · 随手佩戴',
      '无电机 / 无被动驱动 / 纯主动发力',
    ],
    badges: ['新品', '姿态传感', '纯主动发力'],
    detail: [
      '腕动游戏居家训练仪通过腕部姿态传感捕捉您的主动挥腕动作，在 APP 中驱动「四方挥腕挑战」「8 字轨迹跟随」等训练游戏，用趣味跟练培养日常主动活动习惯。',
      '设备不包含电机或任何被动驱动部件：所有训练动作均由您主动发力完成，仅提供动作感知与游戏反馈。',
      '交易占位说明：当前版本为演示环境，展示价格为演示价，不发起真实订单、支付或任何网络请求；正式版接入 Golang 后端订单系统后开放下单。',
    ],
    disclaimer:
      '专属说明：腕动游戏居家训练仪为消费级腕部姿态传感训练设备，仅供日常居家主动训练使用；设备无电机、无被动驱动，训练完全由使用者主动发力完成，请量力而行，感到不适时立即停止。',
  },
  // 成人分指板独立上架，商品信息只保留面向使用者的规格和用途。
  {
    id: 'adult-finger-separator-board',
    kind: 'hardware',
    hardwareType: 'hand-support',
    category: '硬件器材',
    name: '塑性分指板',
    summary: '成人款手指分离与手掌承托用品，ABS 板体搭配可调粘扣绑带，便于固定手指、手掌和腕部位置，适合居家辅助使用。',
    price: 23,
    priceUnit: '个',
    cover: '🖐️',
    coverImage: adultFingerSeparatorBoardImage,
    coverFit: 'contain',
    spec: [
      '规格：成人分指板 · 均码',
      '材质：ABS 塑料、粘扣布、尼龙',
      '外观：白色板体 · 黑色绑带（如图）',
      '分指结构 · 手掌与腕部承托',
      '粘扣绑带 · 松紧可调',
    ],
    badges: ['成人款', 'ABS 板体', '可调绑带'],
    detail: [
      '塑性分指板为成人款手部辅助用品：分指板体承托手掌，配合手指、手掌及腕部绑带，帮助保持舒适的手指分离与手部放置姿势。',
      '材质与结构：ABS 塑料板体提供承托，粘扣布与尼龙绑带便于调节松紧；可根据手型调整绑带位置，以贴合、舒适为宜。',
      '规格说明：本商品为成人分指板均码款，白色板体搭配黑色绑带；使用前请确认手型适配，均码不代表适合所有手型。',
      '使用方式：先松开绑带，将手掌放在板体上，让各手指自然分开，再依次调整手指、手掌和腕部绑带；保持舒适，不要过度收紧或强行拉伸。',
    ],
    disclaimer:
      '专属说明：本商品为成人手部辅助用品，请按说明使用并确认手型适配；不要强行改变手指姿势，感到不适时立即松开绑带并停止使用。',
  },
  {
    // 按摩仪按日常放松用途展示，复用商城图片和购物车逻辑。
    id: 'head-massager',
    kind: 'hardware',
    hardwareType: 'massager',
    category: '硬件器材',
    name: '头部按摩仪',
    summary: '手持式头部按摩仪，揉捏按摩搭配 3 档调节和按键操作，采用 USB 电源方式，适合日常居家头部放松。',
    price: 58,
    priceUnit: '台',
    cover: '💆',
    coverImage: headMassagerImage,
    coverFit: 'contain',
    spec: [
      '款式：手持式头部按摩仪',
      '按摩方式：揉捏按摩',
      '档位：3 档可调',
      '电源方式：USB',
      '控制方式：按键式',
      '外观：白色机身 · 灰色按摩触头（如图）',
    ],
    badges: ['居家放松', '手持设计', '多点触头'],
    detail: [
      '头部按摩仪采用圆润的手持式机身，顶部设置操作按键，便于握持和使用，适合在日常休息时进行头部按摩放松。',
      '按摩与调节：采用揉捏按摩方式，提供 3 档调节，通过机身按键操作，可根据个人舒适感选择合适的档位。',
      '电源方式：USB。请按产品说明连接和操作，使用后妥善收纳机身及线材。',
      '外观与结构：白色机身搭配灰色按摩触头，底部多组触头便于与头部接触；商品外观以展示图片为参考。',
      '使用方式：请按产品说明操作，轻放于头部并保持舒适的接触力度，避免用力按压或拉扯头发；使用完毕后按说明清洁与收纳。',
    ],
    disclaimer:
      '专属说明：本商品为日常头部按摩放松用品，请按产品说明使用；使用时以舒适为宜，感到不适时立即停止使用。',
  },
  {
    id: 'desk-torque-base',
    kind: 'hardware',
    category: '硬件器材',
    name: '桌面力矩主动训练底座',
    summary: '桌面级纯主动阻力训练底座（演示 / 预售占位）：主动发力对抗阻尼，兼容方向盘、球形、T 型等多款手柄配件。',
    price: 599,
    priceUnit: '台',
    cover: '🕹️',
    spec: [
      '桌面固定底座 · 防滑承托',
      '可调阻尼 · 纯主动阻力（无电机）',
      '兼容方向盘 / 球形 / T 型手柄配件',
      '演示 / 预售占位 · 正式版开放购买',
    ],
    badges: ['预售演示', '纯主动阻力', '多手柄兼容'],
    detail: [
      '桌面力矩主动训练底座用于桌面场景下的上肢主动发力训练：将手柄配件安装到底座后，您主动发力对抗阻尼完成推拉、旋转等动作，配合 APP 游戏获得实时反馈。',
      '演示 / 预售说明：本商品当前处于演示与预售占位状态，暂不开放真实下单与支付；设备阻力由使用者主动发力对抗产生，不含电机与被动驱动部件。',
      '正式版说明：接入 Golang 后端订单系统与支付后开放购买，订单与物流状态在正式版订单中心查看；当前 APP 内不发起任何网络请求。',
    ],
    disclaimer:
      '专属说明：桌面力矩主动训练底座为消费级纯主动阻力训练设备（演示 / 预售占位），阻力由使用者主动发力对抗产生，无电机、无被动驱动、无医疗器械功能；正式版开售前不会产生真实交易。',
  },
  {
    id: 'handle-steering-wheel',
    kind: 'hardware',
    category: '硬件器材',
    name: '方向盘手柄配件',
    summary: '方向盘造型手柄：卡扣安装于桌面力矩主动训练底座，双手握持主动发力完成转向类训练动作。',
    price: 89,
    priceUnit: '个',
    cover: '🎡',
    spec: [
      '适配桌面力矩主动训练底座',
      '卡扣快装 · 旋转发力',
      '防滑握持表面',
      '纯主动发力配件 · 无电子部件',
    ],
    badges: ['训练底座配件', '纯主动发力'],
    detail: [
      '方向盘手柄为桌面力矩主动训练底座的配套配件：双手握持方向盘，主动发力完成左右转向等训练动作，动作幅度与力度由底座传感实时反馈到 APP。',
      '需搭配「桌面力矩主动训练底座」（另购）使用，本配件单独使用无法完成训练。',
      '交易占位说明：当前版本为演示环境，展示价格为演示价，不发起真实订单与支付；正式版接入支付后开放下单。',
    ],
    disclaimer:
      '专属说明：方向盘手柄为桌面力矩主动训练底座的纯主动发力配件，不含电机与电子驱动部件，需搭配训练底座使用；训练请量力而行，感到不适时立即停止。',
    relatedHardware: true,
  },
  {
    id: 'handle-sphere',
    kind: 'hardware',
    category: '硬件器材',
    name: '球形手柄配件',
    summary: '球形握持手柄：单手即可握住，搭配桌面力矩主动训练底座完成推拉与多方向主动发力训练。',
    price: 69,
    priceUnit: '个',
    cover: '🔮',
    spec: [
      '适配桌面力矩主动训练底座',
      '球形握持 · 单手操作',
      '多方向推拉发力',
      '纯主动发力配件 · 无电子部件',
    ],
    badges: ['训练底座配件', '纯主动发力'],
    detail: [
      '球形手柄为桌面力矩主动训练底座的配套配件：单手握住球体，向多个方向主动推拉发力，适合精细控制类的上肢主动训练动作。',
      '需搭配「桌面力矩主动训练底座」（另购）使用，本配件单独使用无法完成训练。',
      '交易占位说明：当前版本为演示环境，展示价格为演示价，不发起真实订单与支付；正式版接入支付后开放下单。',
    ],
    disclaimer:
      '专属说明：球形手柄为桌面力矩主动训练底座的纯主动发力配件，不含电机与电子驱动部件，需搭配训练底座使用；训练请量力而行，感到不适时立即停止。',
    relatedHardware: true,
  },
  {
    id: 'handle-t-shape',
    kind: 'hardware',
    category: '硬件器材',
    name: 'T 型手柄配件',
    summary: 'T 型双手手柄：双掌握持更稳固，搭配桌面力矩主动训练底座完成大范围主动发力训练动作。',
    price: 59,
    priceUnit: '个',
    cover: '🎮',
    spec: [
      '适配桌面力矩主动训练底座',
      'T 型双掌握持 · 更稳固',
      '大范围推拉发力',
      '纯主动发力配件 · 无电子部件',
    ],
    badges: ['训练底座配件', '纯主动发力'],
    detail: [
      'T 型手柄为桌面力矩主动训练底座的配套配件：双手分握两端，主动发力完成大幅度的推拉训练动作，动作轨迹实时反馈到 APP。',
      '需搭配「桌面力矩主动训练底座」（另购）使用，本配件单独使用无法完成训练。',
      '交易占位说明：当前版本为演示环境，展示价格为演示价，不发起真实订单与支付；正式版接入支付后开放下单。',
    ],
    disclaimer:
      '专属说明：T 型手柄为桌面力矩主动训练底座的纯主动发力配件，不含电机与电子驱动部件，需搭配训练底座使用；训练请量力而行，感到不适时立即停止。',
    relatedHardware: true,
  },

  /* ── 上门居家健身指导（非医疗服务） ─────────────────────── */
  {
    id: 'home-guide-trial',
    kind: 'service',
    category: '训练服务',
    name: '上门居家健身指导 · 体验课（1 次）',
    summary: '合作服务商提供 1 次上门居家健身指导（约 60 分钟）：健身动作演示与跟练，并指导搭配智为康乐主动训练硬件使用。',
    price: 99,
    priceUnit: '次',
    cover: '🤸',
    spec: [
      '上门居家健身指导 1 次 · 约 60 分钟',
      '居家健身动作演示 + 跟练',
      '含智为康乐主动训练硬件搭配指导',
      '非医疗服务 · 合作服务商承接',
    ],
    badges: ['1 次体验', '非医疗 · 健身指导'],
    detail: [
      '体验课内容：合作服务商教练上门，进行居家健身动作演示与跟练指导（非医疗服务），单次时长约 60 分钟，并讲解如何搭配智为康乐主动训练硬件开展日常练习。',
      '购买与核销（正式版占位）：正式版由 Golang 后端订单系统生成订单，经 UnionID 账号打通后跳转合作服务商小程序完成核销与上门时间安排；APP 内不展示派单 / 工单信息。',
      '演示环境说明：当前版本点击购买不会产生真实订单与扣款，展示价格均为演示价；服务承接与核销流程以正式版合作方小程序为准。',
    ],
    disclaimer:
      '专属说明：本服务为上门居家健身指导（非医疗服务），由合作服务商承接，仅提供居家健身动作演示与跟练支持，不包含任何专业健康服务内容；请量力而行，感到不适时立即停止。',
  },
  {
    id: 'home-guide-pack-10',
    kind: 'service',
    category: '训练服务',
    name: '上门居家健身指导 · 次卡（10 次）',
    summary: '10 次上门居家健身指导次卡：适合希望持续跟练的家庭用户，单次约 60 分钟，支持分次预约（演示：核销以正式版为准）。',
    price: 699,
    priceUnit: '次卡',
    cover: '🏠',
    spec: [
      '上门居家健身指导共 10 次 · 每次约 60 分钟',
      '居家健身动作演示 + 跟练',
      '支持分次预约（正式版核销）',
      '非医疗服务 · 合作服务商承接',
    ],
    badges: ['次卡 · 10 次', '非医疗 · 健身指导'],
    detail: [
      '次卡内容：共 10 次上门居家健身指导（非医疗服务），每次约 60 分钟，由合作服务商教练上门进行健身动作演示与跟练，适合家庭持续跟练场景。',
      '购买与核销（正式版占位）：正式版由 Golang 后端订单系统生成订单，经 UnionID 账号打通后跳转合作服务商小程序完成核销与分次预约；APP 内不展示派单 / 工单信息。',
      '演示环境说明：当前版本点击购买不会产生真实订单与扣款，展示价格均为演示价；服务承接与核销流程以正式版合作方小程序为准。',
    ],
    disclaimer:
      '专属说明：本服务为上门居家健身指导（非医疗服务），由合作服务商承接，仅提供居家健身动作演示与跟练支持，不包含任何专业健康服务内容；请量力而行，感到不适时立即停止。',
  },
  {
    id: 'home-guide-monthly',
    kind: 'service',
    category: '训练服务',
    name: '上门居家健身指导 · 月卡',
    summary: '月卡：30 天内约每周 1 次上门居家健身指导（演示），共 4 次，适合希望建立规律跟练节奏的家庭用户。',
    price: 899,
    priceUnit: '月',
    cover: '🧘',
    spec: [
      '30 天内有效 · 约每周 1 次上门居家健身指导',
      '共 4 次 · 每次约 60 分钟',
      '居家健身动作演示 + 跟练',
      '非医疗服务 · 合作服务商承接',
    ],
    badges: ['月卡', '非医疗 · 健身指导'],
    detail: [
      '月卡内容：30 天内可预约约每周 1 次、共 4 次上门居家健身指导（非医疗服务），帮助家庭用户建立规律的主动跟练节奏。',
      '购买与核销（正式版占位）：正式版由 Golang 后端订单系统生成订单，经 UnionID 账号打通后跳转合作服务商小程序完成核销与预约；APP 内不展示派单 / 工单信息。',
      '演示环境说明：当前版本点击购买不会产生真实订单与扣款，展示价格均为演示价；次数规则与承接流程以正式版合作方小程序为准。',
    ],
    disclaimer:
      '专属说明：本服务为上门居家健身指导（非医疗服务），由合作服务商承接，仅提供居家健身动作演示与跟练支持，不包含任何专业健康服务内容；请量力而行，感到不适时立即停止。',
  },
]
