// 商城沿用 APP 现有商品照片，编译器将导入值转换为小程序资源路径。
declare module '*.jpg' {
  const path: string
  export default path
}

// 由 Taro 在编译时注入，缺省使用内置目录。
declare const __MINI_CATALOG_BASE_URL__: string
/** 构建期注入的小程序独立版本。 */
declare const __MINI_BUILD_VERSION__: string
