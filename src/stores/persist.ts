/**
 * localStorage 读写的统一入口。
 * 读写都必须容错：隐私模式、存储被禁用，以及测试环境（node 下没有 localStorage）都会直接抛错。
 */

/**
 * 读取并浅合并默认值，使缺失字段与旧版本数据都能正常降级。
 *
 * @param key 存储键
 * @param fallback 默认值；解析结果会覆盖其同名字段
 */
export function loadJson<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch (error) {
    console.error(error)
  }
  return { ...fallback }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.error(error)
  }
}
