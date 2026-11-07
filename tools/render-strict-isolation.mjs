// 一次性验证：模拟官方浏览区的组结构（data-row-key="workspace:<id>"），
// 套上插件生成的隐藏规则，用 headless Chrome 截图确认"只剩聚焦的那一组"。
//
//   node tools/render-strict-isolation.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(join(here, '..', 'client.js'), 'utf8')

// 从 bundle 里抠出纯函数 hiddenGroupSelector
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`${name} not found`)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error('unbalanced')
}
const body = extractFunction(clientSource, 'hiddenGroupSelector')
const escapeBody = extractFunction(clientSource, 'escapeSelectorValue')
const hiddenGroupSelector = new Function(`${escapeBody}\n${body}; return hiddenGroupSelector`)()

const WORKSPACES = [
  { workspaceId: 'ws-a', path: 'D:\\Code\\demo', title: 'demo' },
  { workspaceId: 'ws-b', path: 'D:\\Work\\api', title: 'api' },
  { workspaceId: 'ws-c', path: 'D:\\Work\\ops', title: 'ops' }
]
const FOCUSED = 'ws-a'
const selector = hiddenGroupSelector(FOCUSED)
const css = `${selector}{display:none}`

// 官方行为：折叠的组只剩标题行，会话数组是空的（deriveGroups: sessions: []）
const group = (workspace, sessions, collapsed) => `
  <div class="groupSection">
    <div class="projectRow" data-row-key="workspace:${workspace.workspaceId}" role="treeitem">📁 ${workspace.title}</div>
    ${collapsed ? '' : sessions.map((title) => `<div class="sessionRow" data-row-key="session:${title}">${title}</div>`).join('\n    ')}
  </div>`

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#fff;font-family:system-ui,"Segoe UI",sans-serif;color:#222}
  .groupSection{margin-bottom:4px}
  .projectRow{font-size:14px;font-weight:600;padding:6px 8px;border-radius:6px;background:#f2f4f7;margin:2px 0}
  .sessionRow{font-size:13px;padding:5px 10px;color:#444}
  .note{font-size:12px;color:#888;margin:0 0 14px}
  ${css}
</style></head><body>
  <p class="note">聚焦 demo（ws-a）时侧边栏应有的样子 —— 其它工作区的组标题行被藏掉</p>
  ${group(WORKSPACES[0], ['DSH 工作区聚焦插件 (2)', 'DSH 工作区聚焦插件 (1)'], false)}
  ${group(WORKSPACES[1], ['api 的一次会话'], true)}
  ${group(WORKSPACES[2], ['ops 的一次会话'], true)}
  <div class="groupSection">
    <div class="projectRow" data-row-key="workspace:" role="treeitem">📁 未分组</div>
  </div>
</body></html>`

writeFileSync(join(here, '_strict-isolation.html'), html)
console.log('wrote tools/_strict-isolation.html')
console.log('rule:', css)
