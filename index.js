import z from '@deepseek-ai/schemastery'

/**
 * 工作区聚焦的设置项。
 *
 * - `enabled`：整个插件是否启用（关掉后头部不再显示工作区标签）。
 * - `focusEnabled`：聚焦功能本身是否开启（关掉时标签退回静态文本，
 *   正在进行的聚焦会被退出、侧边栏还原）。
 *
 * 两个字段都是 `.volatile()`：值写进 profile 的 Cordis patch，
 * 由 settings 服务持久化，重启和升级都不丢。
 *
 * 本 entry 不调用 `settings.configure({ auto: false })`，所以 settings 服务
 * 会为命名空间 `workspace-focus` 自动生成一页设置界面——这个插件只有一个开关，
 * 不值得手写设置页。
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  focusEnabled: z.boolean().default(true).volatile()
})

/** Host 半没有其它能力：聚焦完全跑在浏览器侧。 */
export function apply() {}

export const name = 'workspace-focus'
