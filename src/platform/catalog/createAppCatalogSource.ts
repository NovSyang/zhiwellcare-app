import { HttpCatalogSource } from '../../core/catalog/HttpCatalogSource'
import type { ICatalogSource } from '../../core/catalog/ICatalogSource'
import { MockCatalogSource } from '../../core/catalog/MockCatalogSource'

/** APP 使用自己的环境变量与浏览器 HTTP 实现。 */
export function createAppCatalogSource(): ICatalogSource {
  const base = import.meta.env.VITE_API_BASE
  return import.meta.env.VITE_CATALOG_MODE === 'http' && base
    ? new HttpCatalogSource(base.replace(/\/$/, ''))
    : new MockCatalogSource()
}
