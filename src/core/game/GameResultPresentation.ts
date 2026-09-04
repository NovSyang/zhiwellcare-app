/** 结果页和历史详情共用的展示指标。 */
export interface ResultMetric {
  label: string
  value: string
}

export interface ResultSectionItem {
  label: string
  value: string
  detail?: string
}

export interface ResultSection {
  title: string
  items: ResultSectionItem[]
}

/** 游戏模块生成纯展示数据，Vue 页面不读取具体游戏结果字段。 */
export interface GameResultPresentation {
  title: string
  metrics: ResultMetric[]
  sections: ResultSection[]
}
