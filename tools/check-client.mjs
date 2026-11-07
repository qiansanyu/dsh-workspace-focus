// PROTOTYPE-FREE 冒烟检查：在没有浏览器的情况下把 focus 插件的 client 半跑一遍。
//
//   node tools/check-client.mjs
//
// 它验证：作用域优先级（URL > sessionStorage > localStorage 默认）、
// 聚焦时侧边栏的折叠动作、退出时对官方视图状态的还原、
// 以及工作区列表变化后的重新对齐。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

// ---- 假的浏览器环境 ----
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    dump: () => Object.fromEntries(map)
  }
}

function makeSandbox({ session = {}, local = {}, search = '', sessionStore, localStore } = {}) {
  // sessionStore / localStore 可以传入外部的存储实例，用来模拟"同一个标签页刷新"
  // （sessionStorage、localStorage 都不清空）或者"新开一个标签页"（sessionStorage 是空的）。
  const sessionStorage = sessionStore ?? makeStorage(session)
  const localStorage = localStore ?? makeStorage(local)
  const styleTags = []
  const listeners = new Set()
  const popstateListeners = new Set()
  const sandbox = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail } },
    sessionStorage,
    localStorage,
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: (tag) => { styleTags.push(tag) } }
    },
    location: { href: `http://127.0.0.1:3080/${search}` },
    history: {
      state: null,
      replaceState(_state, _title, url) { sandbox.location.href = url }
    },
    addEventListener(type, fn) {
      if (type === 'dsh:workspace-focus') listeners.add(fn)
      else if (type === 'popstate') popstateListeners.add(fn)
    },
    removeEventListener(type, fn) {
      if (type === 'dsh:workspace-focus') listeners.delete(fn)
      else if (type === 'popstate') popstateListeners.delete(fn)
    },
    dispatchEvent() { for (const fn of [...listeners]) fn() },
    __firePopstate() { for (const fn of [...popstateListeners]) fn() },
    __listeners: listeners,
    __styleTags: styleTags
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  return sandbox
}

// ---- 假的 Cordis 客户端上下文 ----
const WORKSPACES = [
  { workspaceId: 'ws-a', path: 'D:\\Code\\demo', title: 'demo', sessionIds: ['s1'] },
  { workspaceId: 'ws-b', path: 'D:\\Work\\api', title: 'api', sessionIds: ['s2'] }
]

function makeCtx({ groups = {}, state: sharedState, withSidebar = true, formStatus = 'ready', formValue: initialFormValue } = {}) {
  const calls = []
  // 每个 ctx 一份工作区副本，用例可以往里加工作区而互不影响
  const items = WORKSPACES.map((workspace) => ({ ...workspace }))
  // sharedState 用来模拟"官方视图状态是持久化的"：刷新后拿到的是同一份对象
  const state = sharedState ?? {
    groupBy: 'workspace',
    groupExpansion: { 'ws-a': true, '': false, ...groups }
  }
  const instance = {
    getSnapshot: () => state,
    actions: {
      setGroupBy(mode) { calls.push(['setGroupBy', mode]); state.groupBy = mode },
      setGroupExpanded(key, value) { calls.push(['setGroupExpanded', key, value]); state.groupExpansion[key] = value }
    }
  }
  const listSubscribers = new Set()
  const slotSubscribers = new Set()
  const registrations = []
  const provided = {}
  const formValue = initialFormValue ?? { enabled: true, focusEnabled: true }
  const form = {
    getSnapshot: () => ({ status: formStatus, value: formValue, writable: true, revision: 1, mode: 'host' }),
    subscribe: () => () => {}
  }
  const ctx = {
    calls,
    provided,
    items,
    formValue,
    registrations,
    // cordis 的 effect：回调返回 disposer
    effect(fn) {
      const off = fn()
      return () => { if (typeof off === 'function') off() }
    },
    get: () => undefined,
    locale: {
      register: () => () => {},
      bind: () => ((key, params) => (params ? `${key}:${JSON.stringify(params)}` : key))
    },
    configForms: { get: () => form },
    slots: {
      entries: () => (withSidebar ? [{ store: { create: () => instance } }] : []),
      subscribe(_name, fn) { slotSubscribers.add(fn); return () => { slotSubscribers.delete(fn) } },
      inject(_key, cb) { cb(); return () => {} },
      register(options, component) { registrations.push({ options, component }); return () => {} }
    },
    workspaces: {
      list: {
        getSnapshot: () => ({ items }),
        subscribe(fn) { listSubscribers.add(fn); return () => { listSubscribers.delete(fn) } }
      }
    },
    // 与 cordis 一致：provide 返回摘钩句柄
    provide(name, value) {
      provided[name] = value
      return () => { if (provided[name] === value) delete provided[name] }
    }
  }
  return { ctx, instance, state, items, listSubscribers, slotSubscribers, registrations, formValue }
}

/** 触发一组订阅者（工作区列表变化 / 侧边栏槽注册变化）。 */
function fire(subscribers) {
  for (const fn of [...subscribers]) fn()
}

/** 找出"隐藏非聚焦组标题行"那只 <style>（模块加载时还会插一只主样式）。 */
function hiddenStyleTag(sandbox) {
  return sandbox.__styleTags.find((tag) => tag.dataset?.pluginCss === 'dsh-workspace-focus/hidden-groups.css')
}

// ---- 迷你 React：只够跑通组件函数体 ----
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useSyncExternalStore: (_subscribe, read) => read(),
  useRef: (value) => ({ current: value }),
  Fragment: 'Fragment'
}

const portalCalls = []
const reactDomStub = {
  createPortal: (node, container) => { portalCalls.push({ node, container }); return node }
}

function load(sandbox) {
  let plugin = null
  sandbox.__ModuleLoader__ = {
    load(spec) {
      plugin = spec.factory((name) => {
        if (name === 'react') return ReactStub
        if (name === 'react-dom') return reactDomStub
        throw new Error(`unexpected require(${name})`)
      })
    }
  }
  vm.runInNewContext(source, sandbox)
  return plugin
}

// ---- 用例 ----
console.log('scope resolution')
{
  const sandbox = makeSandbox({ session: { 'dsh.workspace.focus': 'D:\\Work\\api' } })
  const { ctx } = makeCtx()
  const calls = ctx.calls
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  check('service provided', ctx.provided.workspaceFocus === controller)
  check('sessionStorage scope wins over default', controller.getState().focusedPath === 'D:\\Work\\api',
    JSON.stringify(controller.getState()))
  check('sidebar narrowed to the focused workspace',
    calls.some((call) => call[0] === 'setGroupExpanded' && call[1] === 'ws-b' && call[2] === true) &&
    calls.some((call) => call[0] === 'setGroupExpanded' && call[1] === 'ws-a' && call[2] === false),
    JSON.stringify(calls))
}
{
  const sandbox = makeSandbox({ search: '?ws=D%3A%5CCode%5Cdemo', session: { 'dsh.workspace.focus': 'D:\\Work\\api' } })
  const { ctx } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  check('URL scope wins over sessionStorage', controller.getState().focusedPath === 'D:\\Code\\demo',
    JSON.stringify(controller.getState()))
}
{
  const sandbox = makeSandbox({ local: { 'dsh.workspace.focus.default': 'D:\\Code\\demo' } })
  const { ctx } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  check('localStorage default is adopted', controller.getState().focusedPath === 'D:\\Code\\demo')
  check('adopted default is copied into this tab sessionStorage',
    sandbox.sessionStorage.getItem('dsh.workspace.focus') === 'D:\\Code\\demo')
}

console.log('focus and exit')
{
  const sandbox = makeSandbox()
  const { ctx, state } = makeCtx()
  const calls = ctx.calls
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  calls.length = 0

  controller.focus('D:\\Code\\demo')
  check('focus recorded', controller.getState().focusedPath === 'D:\\Code\\demo')
  check('focus written to sessionStorage', sandbox.sessionStorage.getItem('dsh.workspace.focus') === 'D:\\Code\\demo')
  check('focus written to the URL', sandbox.location.href.includes('ws=D%3A%5CCode%5Cdemo'), sandbox.location.href)
  check('other workspace collapsed',
    calls.some((call) => call[0] === 'setGroupExpanded' && call[1] === 'ws-b' && call[2] === false))
  // 未分组桶本来就是折叠的：写前 diff 之后不会再重复写一遍，所以断言状态而不是调用
  check('ungrouped bucket stays collapsed', state.groupExpansion[''] === false,
    JSON.stringify(state.groupExpansion))

  calls.length = 0
  controller.exit()
  check('focus cleared', controller.getState().focusedPath === null)
  check('URL parameter removed', !sandbox.location.href.includes('ws='), sandbox.location.href)
  check('original grouping restored', state.groupBy === 'workspace')
  check('original expansion restored', state.groupExpansion['ws-a'] === true, JSON.stringify(state.groupExpansion))
  check('collapse undone for the other workspace', state.groupExpansion['ws-b'] === false, JSON.stringify(state.groupExpansion))
}

console.log('tree mode restore')
{
  const sandbox = makeSandbox()
  const { ctx, state } = makeCtx({ groups: { 'ws-a': true } })
  state.groupBy = 'workspace-tree'
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  controller.focus('D:\\Work\\api')
  controller.exit()
  check('tree grouping restored', state.groupBy === 'workspace-tree', state.groupBy)
}

console.log('focus link')
{
  const sandbox = makeSandbox()
  const { ctx } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  controller.focus('D:\\Code\\demo')
  check('focus link carries the workspace', controller.focusUrl().includes('ws=D%3A%5CCode%5Cdemo'), controller.focusUrl())
}

console.log('feature switch')
{
  const sandbox = makeSandbox()
  const { ctx, state } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  controller.focus('D:\\Code\\demo')
  check('focused before switching off', controller.getState().hasFocus === true)

  controller.setEnabled(false)
  check('focus exited when the switch goes off', controller.getState().hasFocus === false)
  check('switch reported as off', controller.getState().enabled === false)
  check('sidebar expansion restored', state.groupExpansion['ws-a'] === true, JSON.stringify(state.groupExpansion))
  check('switch mirror written', sandbox.localStorage.getItem('dsh.workspace.focus.enabled') === '0',
    JSON.stringify(sandbox.localStorage.dump()))

  controller.focus('D:\\Work\\api')
  check('focus requests ignored while off', controller.getState().hasFocus === false)

  controller.setEnabled(true)
  check('switch reported as on', controller.getState().enabled === true)
  check('switch mirror written back', sandbox.localStorage.getItem('dsh.workspace.focus.enabled') === '1',
    JSON.stringify(sandbox.localStorage.dump()))
  check('remembered scope re-adopted', controller.getState().focusedPath === 'D:\\Code\\demo',
    JSON.stringify(controller.getState()))
  check('sidebar narrowed again', state.groupExpansion['ws-b'] === false, JSON.stringify(state.groupExpansion))
}

console.log('switch mirror decides the first paint')
{
  // 开关关着时刷新：镜像里已经是"关"，插件就不该采纳记忆中的作用域，
  // 否则会先聚焦、再被退出（闪一下）。这里让配置停在 loading，
  // 首帧就只能信镜像。
  const sandbox = makeSandbox({
    local: { 'dsh.workspace.focus.enabled': '0', 'dsh.workspace.focus.default': 'D:\\Code\\demo' }
  })
  const { ctx } = makeCtx({ formStatus: 'loading' })
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  check('switch starts off from the mirror', controller.getState().enabled === false)
  check('no scope adopted while the switch is off', controller.getState().hasFocus === false,
    JSON.stringify(controller.getState()))
  check('sidebar not narrowed', !ctx.calls.some((call) => call[0] === 'setGroupExpanded' && call[1] === 'ws-a' && call[2] === true),
    JSON.stringify(ctx.calls))
}
{
  // 镜像过期（开着但镜像写着关）：以镜像为准（不采纳），
  // 设置页随后推来真实配置时再纠正——不采纳总比"闪一下再退出"好。
  const sandbox = makeSandbox({
    local: { 'dsh.workspace.focus.enabled': '0', 'dsh.workspace.focus.default': 'D:\\Code\\demo' }
  })
  const { ctx } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  controller.setEnabled(true)
  check('the push re-adopts the remembered scope', controller.getState().focusedPath === 'D:\\Code\\demo',
    JSON.stringify(controller.getState()))
  check('mirror refreshed', sandbox.localStorage.getItem('dsh.workspace.focus.enabled') === '1')
}

console.log('the settings page drives the switch')
{
  // 配置里关掉聚焦：apply 之后控制器应当立刻是关的（镜像里写着开也没用）
  const sandbox = makeSandbox({ local: { 'dsh.workspace.focus.enabled': '1', 'dsh.workspace.focus.default': 'D:\\Code\\demo' } })
  const { ctx } = makeCtx({ formValue: { enabled: true, focusEnabled: false } })
  load(sandbox).apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  check('focus is off when the setting says so', controller.getState().enabled === false,
    JSON.stringify(controller.getState()))
  check('no scope is adopted while off', controller.getState().hasFocus === false,
    JSON.stringify(controller.getState()))
}
{
  // 镜像过期（写着关）但配置是开的：配置到达后立刻纠正
  const sandbox = makeSandbox({ local: { 'dsh.workspace.focus.enabled': '0', 'dsh.workspace.focus.default': 'D:\\Code\\demo' } })
  const { ctx } = makeCtx({ formValue: { enabled: true, focusEnabled: true } })
  load(sandbox).apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  check('the setting corrects a stale mirror', controller.getState().enabled === true,
    JSON.stringify(controller.getState()))
  check('the remembered scope is adopted', controller.getState().focusedPath === 'D:\\Code\\demo',
    JSON.stringify(controller.getState()))
}

console.log('exit survives a reload')
{
  // 场景：聚焦 → 退出聚焦 → 刷新页面。刷新时同一个标签页的
  // sessionStorage / localStorage 都还在，只有页面重新加载了。
  const sessionStorage = makeStorage()
  const localStorage = makeStorage()
  const first = makeSandbox({ sessionStore: sessionStorage, localStore: localStorage })
  const { ctx } = makeCtx()
  load(first).apply(ctx)
  const controller = first.window.__DSH_WORKSPACE_FOCUS__
  controller.focus('D:\\Code\\demo')
  controller.exit()

  check('exit cleared the remembered default', localStorage.getItem('dsh.workspace.focus.default') === null,
    JSON.stringify(localStorage.dump()))

  const second = makeSandbox({ sessionStore: sessionStorage, localStore: localStorage })
  const { ctx: ctx2 } = makeCtx()
  load(second).apply(ctx2)
  const controller2 = second.window.__DSH_WORKSPACE_FOCUS__
  check('no focus after reload', controller2.getState().hasFocus === false, JSON.stringify(controller2.getState()))
  check('no focus parameter after reload', !second.location.href.includes('ws='), second.location.href)
  check('sidebar not narrowed after reload',
    !ctx2.calls.some((call) => call[0] === 'setGroupExpanded' && call[1] === 'ws-b' && call[2] === true),
    JSON.stringify(ctx2.calls))
}

console.log('a new tab after an exit')
{
  // 退出聚焦之后新开的标签页：不应该被"上次聚焦的工作区"重新拉回聚焦状态
  const localStorage = makeStorage()
  const first = makeSandbox({ localStore: localStorage })
  const { ctx } = makeCtx()
  load(first).apply(ctx)
  const controller = first.window.__DSH_WORKSPACE_FOCUS__
  controller.focus('D:\\Code\\demo')
  controller.exit()

  const second = makeSandbox({ sessionStore: makeStorage(), localStore: localStorage })
  const { ctx: ctx2 } = makeCtx()
  load(second).apply(ctx2)
  const controller2 = second.window.__DSH_WORKSPACE_FOCUS__
  check('a new tab is not focused either', controller2.getState().hasFocus === false, JSON.stringify(controller2.getState()))
}

console.log('exit after a reload restores the original sidebar')
{
  // 官方视图状态是持久化的（localStorage），所以刷新后拿到的是同一份状态。
  // 聚焦前的"用户原本的展开状态"必须一起持久化，
  // 否则刷新后退出聚焦还原回去的是收窄后的状态，侧边栏会一直保持收窄。
  const sessionStorage = makeStorage()
  const localStorage = makeStorage()
  const viewState = { groupBy: 'workspace', groupExpansion: { 'ws-a': true, 'ws-b': false, '': false } }

  const first = makeSandbox({ sessionStore: sessionStorage, localStore: localStorage })
  const { ctx } = makeCtx({ state: viewState })
  load(first).apply(ctx)
  const controller = first.window.__DSH_WORKSPACE_FOCUS__
  controller.focus('D:\\Work\\api')
  check('narrowed to the focused workspace',
    viewState.groupExpansion['ws-b'] === true && viewState.groupExpansion['ws-a'] === false,
    JSON.stringify(viewState.groupExpansion))

  const second = makeSandbox({ sessionStore: sessionStorage, localStore: localStorage })
  const { ctx: ctx2 } = makeCtx({ state: viewState })
  load(second).apply(ctx2)
  const controller2 = second.window.__DSH_WORKSPACE_FOCUS__
  check('focus kept after a reload', controller2.getState().hasFocus === true, JSON.stringify(controller2.getState()))

  controller2.exit()
  check('original expansion restored after a reload', viewState.groupExpansion['ws-a'] === true,
    JSON.stringify(viewState.groupExpansion))
  check('focused workspace collapsed again', viewState.groupExpansion['ws-b'] === false,
    JSON.stringify(viewState.groupExpansion))
}

console.log('strict isolation hides the other workspace rows')
{
  // 官方浏览区没有"只显示某个工作区"的接口：折叠只藏会话，组标题照旧渲染。
  // 插件用官方留的稳定标识 data-row-key="workspace:<id>" 把别的组标题行藏起来。
  const sandbox = makeSandbox()
  const { ctx } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  controller.focus('D:\\Code\\demo')
  const style = hiddenStyleTag(sandbox)
  check('a style tag was injected', style !== undefined)
  const css = style?.textContent ?? ''
  // 一条「前缀 + :not(聚焦那一行)」的常量规则：不枚举每个工作区
  check('the rule hides every workspace row by prefix', css.includes('[data-row-key^="workspace:"]'), css)
  check('the focused workspace is the only exception', css.includes(':not([data-row-key="workspace:ws-a"])'), css)
  check('no per-workspace enumeration', !css.includes('workspace:ws-b'), css)
  check('the ungrouped bucket falls under the same prefix', !css.includes('[data-row-key="workspace:"]{'), css)
  check('the rule only hides', css.endsWith('{display:none}'), css)

  controller.exit()
  check('the rows come back on exit', (style?.textContent ?? '') === '', style?.textContent)
}
{
  // 选择器按前缀写：工作区增删不改变规则内容（也就不会因为列表变化重写样式）
  const sandbox = makeSandbox({ session: { 'dsh.workspace.focus': 'D:\\Code\\demo' } })
  const { ctx, state, items, listSubscribers } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const css = hiddenStyleTag(sandbox)?.textContent ?? ''
  items.push({ workspaceId: 'ws-c', path: 'D:\\Work\\web', title: 'web', sessionIds: [] })
  fire(listSubscribers)
  check('a new workspace leaves the rule unchanged', (hiddenStyleTag(sandbox)?.textContent ?? '') === css,
    hiddenStyleTag(sandbox)?.textContent)
  check('the new workspace is collapsed too', state.groupExpansion['ws-c'] === false,
    JSON.stringify(state.groupExpansion))
}

console.log('an unknown scope is refused')
{
  // 失效的 ?ws=（工作区被删了 / 链接是别人机器上的）不能把侧边栏收敛成
  // "所有工作区都折叠" —— 那比不聚焦更糟，而且和指示器的「未聚焦」提示对不上。
  const sandbox = makeSandbox()
  const { ctx, state } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  const before = JSON.stringify(state.groupExpansion)
  ctx.calls.length = 0

  controller.focus('D:\\Gone')
  check('the unknown workspace is not focused', controller.getState().hasFocus === false,
    JSON.stringify(controller.getState()))
  check('the sidebar is left alone', ctx.calls.length === 0, JSON.stringify(ctx.calls))
  check('the view state is untouched', JSON.stringify(state.groupExpansion) === before,
    JSON.stringify(state.groupExpansion))
  check('nothing gets hidden', (hiddenStyleTag(sandbox)?.textContent ?? '') === '')
}

console.log('a stale ?ws= in history does not collapse the sidebar')
{
  const sandbox = makeSandbox()
  const { ctx, state } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  controller.focus('D:\\Work\\api')
  check('focused on api', state.groupExpansion['ws-b'] === true, JSON.stringify(state.groupExpansion))

  sandbox.location.href = `http://127.0.0.1:3080/?ws=${encodeURIComponent('D:\\Gone')}`
  sandbox.__firePopstate()
  check('focus exited instead of narrowing to nothing', controller.getState().hasFocus === false,
    JSON.stringify(controller.getState()))
  check('the original layout is restored', state.groupExpansion['ws-a'] === true && state.groupExpansion['ws-b'] === false,
    JSON.stringify(state.groupExpansion))
  check('the remembered default survives', sandbox.localStorage.getItem('dsh.workspace.focus.default') === 'D:\\Work\\api',
    JSON.stringify(sandbox.localStorage.dump()))
}

console.log('an exit without the sidebar keeps the snapshot')
{
  const sandbox = makeSandbox({ session: { 'dsh.workspace.focus': 'D:\\Work\\api' } })
  const { ctx, instance, state, slotSubscribers } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  check('focused at boot', state.groupExpansion['ws-b'] === true, JSON.stringify(state.groupExpansion))
  check('the snapshot was written', sandbox.localStorage.getItem('dsh.workspace.focus.snapshot') !== null)

  // 退出聚焦的这一刻，官方浏览区不在场
  ctx.slots.entries = () => []
  controller.exit()
  check('the snapshot survives the failed restore',
    sandbox.localStorage.getItem('dsh.workspace.focus.snapshot') !== null)

  // 浏览区挂回来：补一次还原
  ctx.slots.entries = () => [{ store: { create: () => instance } }]
  fire(slotSubscribers)
  check('the sidebar is restored once it is back',
    state.groupExpansion['ws-a'] === true && state.groupExpansion['ws-b'] === false,
    JSON.stringify(state.groupExpansion))
  check('the snapshot is cleared after the restore',
    sandbox.localStorage.getItem('dsh.workspace.focus.snapshot') === null)
}

console.log('a list change does not rewrite an identical narrow state')
{
  const sandbox = makeSandbox({ session: { 'dsh.workspace.focus': 'D:\\Code\\demo' } })
  const { ctx, state, listSubscribers } = makeCtx()
  const plugin = load(sandbox)
  plugin.apply(ctx)
  ctx.calls.length = 0

  fire(listSubscribers)
  fire(listSubscribers)
  check('no store writes when nothing changed', ctx.calls.length === 0, JSON.stringify(ctx.calls))

  // 用户手动展开了另一个工作区：下一次列表变化只把这一条差异写回去
  state.groupExpansion['ws-b'] = true
  ctx.calls.length = 0
  fire(listSubscribers)
  check('only the divergent group is written back',
    ctx.calls.length === 1 && ctx.calls[0][0] === 'setGroupExpanded' && ctx.calls[0][1] === 'ws-b' && ctx.calls[0][2] === false,
    JSON.stringify(ctx.calls))
}

console.log('a rename refreshes the published state')
{
  const sandbox = makeSandbox({ session: { 'dsh.workspace.focus': 'D:\\Code\\demo' } })
  const { ctx, items, listSubscribers } = makeCtx()
  load(sandbox).apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  let events = 0
  sandbox.addEventListener('dsh:workspace-focus', () => { events += 1 })

  check('title before the rename', controller.getState().focusedTitle === 'demo',
    controller.getState().focusedTitle)
  items[0].title = '演示'
  fire(listSubscribers)
  check('title after the rename', controller.getState().focusedTitle === '演示',
    controller.getState().focusedTitle)
  check('a change event was broadcast', events > 0, String(events))

  const before = events
  fire(listSubscribers)
  check('no event when nothing changed', events === before, `${events} vs ${before}`)
}

console.log('dispose tears the instance down')
{
  const sandbox = makeSandbox({ session: { 'dsh.workspace.focus': 'D:\\Code\\demo' } })
  const { ctx, state, listSubscribers, slotSubscribers } = makeCtx()
  const dispose = load(sandbox).apply(ctx)
  const controller = sandbox.window.__DSH_WORKSPACE_FOCUS__
  check('apply returns a disposer', typeof dispose === 'function')
  check('focused at boot', controller.getState().focusedPath === 'D:\\Code\\demo',
    JSON.stringify(controller.getState()))
  const style = hiddenStyleTag(sandbox)

  dispose()
  check('subscriptions released', listSubscribers.size === 0 && slotSubscribers.size === 0,
    `${listSubscribers.size}/${slotSubscribers.size}`)
  check('global handle removed', sandbox.window.__DSH_WORKSPACE_FOCUS__ === undefined)
  check('sidebar restored on dispose', state.groupExpansion['ws-a'] === true && state.groupExpansion['ws-b'] === false,
    JSON.stringify(state.groupExpansion))
  check('hidden rule cleared', (style?.textContent ?? '') === '', style?.textContent)
  check('remembered workspace kept', sandbox.localStorage.getItem('dsh.workspace.focus.default') === 'D:\\Code\\demo',
    JSON.stringify(sandbox.localStorage.dump()))
  check('service unhooked', ctx.provided.workspaceFocus === undefined)
}

console.log('replacing the instance leaves one listener')
{
  const sandbox = makeSandbox({ session: { 'dsh.workspace.focus': 'D:\\Code\\demo' } })
  const { ctx, state, listSubscribers } = makeCtx()
  const dispose = load(sandbox).apply(ctx)
  dispose()
  load(sandbox).apply(ctx)

  check('exactly one list subscription after a replace', listSubscribers.size === 1, String(listSubscribers.size))
  // 两个实例都还在的话，这一条会被写两遍
  state.groupExpansion['ws-b'] = true
  ctx.calls.length = 0
  fire(listSubscribers)
  check('only one instance reacts', ctx.calls.length === 1, JSON.stringify(ctx.calls))
}

console.log('the header chip renders')
{
  const sandbox = makeSandbox()
  const { ctx } = makeCtx()
  load(sandbox).apply(ctx)

  const cssTag = sandbox.__styleTags.find((tag) => tag.dataset?.plugin === 'dsh-workspace-focus')
  check('the bundle injects its style tag', cssTag !== undefined && cssTag.textContent.includes('.wf-chip'))

  const entry = ctx.registrations.find((registration) => registration.options.id === 'workspace-focus')
  check('a header entry is registered', entry !== undefined,
    JSON.stringify(ctx.registrations.map((registration) => registration.options.id)))

  // 递归执行函数组件，保留 host 元素的 props（类名在 props 里）
  const run = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(run)
    if (typeof node.type === 'function') return run(node.type({ ...node.props }))
    return { type: node.type, props: node.props, children: (node.children ?? []).map(run) }
  }
  const props = { sessionId: 's1', useWorkspaces: (selector) => selector({ items: ctx.items }) }
  try {
    const rendered = run(entry.component(props))
    const text = JSON.stringify(rendered, (key, value) => (typeof value === 'function' ? '[fn]' : value))
    check('the chip shows the workspace title', text.includes('demo'), text.slice(0, 240))
    check('the chip is interactive (has the focusable class)', text.includes('wf-focusable'), text.slice(0, 240))
  } catch (error) {
    failures += 1
    console.log(`  FAIL the chip renders — ${error.constructor.name}: ${error.message}`)
  }
}
{
  // 设置页关掉整个插件：头部不渲染任何东西
  const sandbox = makeSandbox()
  const { ctx } = makeCtx({ formValue: { enabled: false, focusEnabled: true } })
  load(sandbox).apply(ctx)
  const entry = ctx.registrations.find((registration) => registration.options.id === 'workspace-focus')
  const props = { sessionId: 's1', useWorkspaces: (selector) => selector({ items: ctx.items }) }
  const tree = entry.component(props)
  const rendered = typeof tree?.type === 'function' ? tree.type({ ...tree.props }) : tree
  check('a disabled plugin renders nothing', rendered === null, JSON.stringify(rendered))
}
{
  // 当前会话不属于任何工作区：没有工作区可显示，指示器不出现
  const sandbox = makeSandbox()
  const { ctx } = makeCtx()
  load(sandbox).apply(ctx)
  const entry = ctx.registrations.find((registration) => registration.options.id === 'workspace-focus')
  const props = { sessionId: 'subagent', useWorkspaces: (selector) => selector({ items: ctx.items }) }
  const tree = entry.component(props)
  const rendered = typeof tree?.type === 'function' ? tree.type({ ...tree.props }) : tree
  check('a session outside every workspace shows nothing', rendered === null, JSON.stringify(rendered))
}


console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
