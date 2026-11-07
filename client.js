window.__ModuleLoader__.load({
  id: 'dsh-workspace-focus',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    /** locale 命名空间；同时也是 Host entry id 与 settings 命名空间。 */
    const NS = 'workspace-focus'
    /** settings 命名空间（= Host entry id）。 */
    const NAMESPACE = 'workspace-focus'

    // ---- 与外部世界的协作面 ----
    // 控制器挂在 window 上并广播 window 事件：既方便在控制台调试
    // （`__DSH_WORKSPACE_FOCUS__.getState()`），也让别的插件能按同一份契约接入。
    const GLOBAL_KEY = '__DSH_WORKSPACE_FOCUS__'
    const EVENT_NAME = 'dsh:workspace-focus'

    const zh = {
      'chip.hint': '双击聚焦，右键打开菜单',
      'chip.outside': '未聚焦',
      'focus.title': '聚焦到工作区',
      'focus.current': '聚焦到当前工作区',
      'focus.newSession': '在此工作区新建会话',
      'focus.copy': '复制聚焦链接',
      'focus.exit': '退出聚焦',
      'focus.copied': '已复制聚焦链接'
    }
    const en = {
      'chip.hint': 'Double-click to focus, right-click for the menu',
      'chip.outside': 'Not focused',
      'focus.title': 'Focus a workspace',
      'focus.current': 'Focus the current workspace',
      'focus.newSession': 'New session in this workspace',
      'focus.copy': 'Copy focus link',
      'focus.exit': 'Exit focus',
      'focus.copied': 'Focus link copied'
    }

    // 类名一律带 wf- 前缀：插件可能和别的头部插件共存，不抢通用类名。
    const css = `
.wf-root{position:relative;display:inline-flex}
.wf-chip{min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:default;align-items:center;gap:3px;padding:3px 2px;font-size:12px;line-height:18px;display:inline-flex}
.wf-name{max-width:180px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.wf-focusable{cursor:pointer;border-radius:8px;user-select:none;-webkit-user-select:none}
.wf-focusable:hover{background:var(--dsw-alias-interactive-bg-hover)}
.wf-focused{color:var(--dsw-alias-state-business-primary)}
.wf-outside{color:var(--dsw-alias-state-warn-primary)}
.wf-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.wf-flag{font-size:10px;line-height:14px;padding:0 4px;border-radius:3px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 20%,transparent);flex:none}
/* ---- 菜单 ----
   结构与样式抄自官方 ui-primitives 的 Menu，变量只引用 --dsw-alias-* 与官方几何 token，
   这样官方改主题时外观会跟着变，而不会因为写死颜色而脱节。 */
.wf-surface{position:fixed;z-index:1100;border-radius:var(--dsw-radius-lg);isolation:isolate}
.wf-material{position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--dsw-menu-surface-fill);backdrop-filter:var(--dsw-menu-backdrop-filter);pointer-events:none}
.wf-list{box-sizing:border-box;padding:4px;display:flex;flex-direction:column;gap:0;border:0;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);min-width:200px;max-width:360px;max-height:calc(100vh - 24px);overflow-y:auto}
.wf-viewport{display:flex;flex-direction:column;min-height:0}
.wf-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;cursor:pointer;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:left}
.wf-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.wf-item:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);outline:none}
.wf-item[aria-current=true]{font-weight:600}
.wf-itemIcon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-menu-icon)}
.wf-itemIcon svg,.wf-itemCheck{width:14px;height:14px}
.wf-itemLabel{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-path{flex:none;margin-left:auto;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.wf-itemCheck{flex:none;margin-left:6px;color:var(--dsw-alias-label-primary)}
.wf-separator{height:.5px;margin:3px 2px;background:var(--dsw-alias-border-l2)}
.wf-label{padding:6px 8px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}
`

    // 样式：bundle 形态的 client 模块没有 `styles` 全局，约定是插入一个
    // 带 data-plugin 的 <style>，client-modules 会按包名认领并在卸载时移除。
    const styleTagId = 'dsh-workspace-focus/workspace-focus.css'
    if (typeof document !== 'undefined'
      && document.querySelector(`style[data-plugin-css=${JSON.stringify(styleTagId)}]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-workspace-focus'
      tag.dataset.pluginCss = styleTagId
      tag.textContent = css
      document.head.appendChild(tag)
    }

    // ---- 作用域载体 ----
    // ① URL ?ws=<工作区路径>  显式状态，可分享 / 可收藏
    // ② sessionStorage        本标签页的记忆（刷新保留，跨标签页不可见）
    // ③ localStorage          新标签页的初始默认（"上次聚焦的工作区"）
    const URL_PARAM = 'ws'
    const SESSION_KEY = 'dsh.workspace.focus'
    const DEFAULT_KEY = 'dsh.workspace.focus.default'
    // 功能总开关的本地镜像。Host 配置是权威，但配置值要过一趟网络才到，
    // 页面加载时先按这份镜像决定要不要采纳记忆中的作用域：
    // 否则开关关着时刷新会"先聚焦、再被退出"，闪一下。
    // 镜像过期只会让闪烁重新出现（设置页的推送会立刻纠正），不会让状态错乱。
    const ENABLE_KEY = 'dsh.workspace.focus.enabled'

    function safeStorage(kind) {
      try {
        const store = kind === 'session' ? window.sessionStorage : window.localStorage
        store.getItem(kind)
        return store
      } catch {
        return null
      }
    }
    const sessionStore = safeStorage('session')
    const localStore = safeStorage('local')

    function readKey(store, key) {
      try { return store ? store.getItem(key) : null } catch { return null }
    }
    function writeKey(store, key, value) {
      try { if (store) store.setItem(key, value) } catch { /* 隐私模式：忽略 */ }
    }
    function removeKey(store, key) {
      try { if (store) store.removeItem(key) } catch { /* 忽略 */ }
    }

    function readUrlParam() {
      try {
        const raw = new URL(window.location.href).searchParams.get(URL_PARAM)
        return raw === null || raw === '' ? null : raw
      } catch {
        return null
      }
    }
    function writeUrlParam(path) {
      try {
        const url = new URL(window.location.href)
        if (path) url.searchParams.set(URL_PARAM, path)
        else url.searchParams.delete(URL_PARAM)
        // replaceState：不产生历史记录，不触发页面重载
        window.history.replaceState(window.history.state, '', url.toString())
      } catch { /* 忽略 */ }
    }

    // 收窄侧边栏之前，"用户原本的展开状态"快照。
    // 官方视图状态本身是持久化到 localStorage 的（每次变更都写回），
    // 所以这份快照也必须持久化：否则"聚焦 → 刷新 → 退出聚焦"时
    // 还原回去的是上一次收窄后的状态，侧边栏会一直保持收窄。
    const SNAPSHOT_KEY = 'dsh.workspace.focus.snapshot'

    function readSnapshot() {
      try {
        const raw = readKey(localStore, SNAPSHOT_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return null
        return {
          groupBy: parsed.groupBy,
          groupExpansion: parsed.groupExpansion && typeof parsed.groupExpansion === 'object'
            ? { ...parsed.groupExpansion }
            : {}
        }
      } catch {
        return null
      }
    }

    function writeSnapshot(snapshot) {
      writeKey(localStore, SNAPSHOT_KEY, JSON.stringify(snapshot))
    }

    function isDescendantPath(child, parent) {
      if (child === parent) return false
      const separator = parent.includes('\\') ? '\\' : '/'
      return child.startsWith(parent + separator)
    }

    // ------------------------------------------------------------------
    // 严格隔离：把非聚焦工作区的"组标题行"藏起来
    //
    // 官方浏览区没有"只显示某个工作区"的接口：折叠只会藏起会话，
    // 组标题行照旧渲染（官方 client.js 的 renderGroup 无条件渲染 ProjectRowItem）。
    // 影子化整个 sidebar.workspaces 槽才能真正过滤，但那个槽是 single 的，
    // 影子化会连官方自己声明的 5 个子槽（会话行菜单、行 hover 按钮、
    // 行前/行内装饰、目录选择流）一起丢掉——为了一个过滤重写整个浏览区不划算。
    //
    // 所以这里走另一条路：官方给每个组标题行留了稳定标识
    // `data-row-key="workspace:<工作区 id>"`（未分组的会话桶是 `workspace:`），
    // 用一条 CSS 规则把非聚焦工作区的标题行藏起来。
    // 只藏标题行：那些工作区的会话行本来就因为折叠而不可见，
    // 官方的 hover 卡片、行菜单（pin/重命名/分叉/归档）、拖拽排序、
    // 定时任务标记、搜索一行都不少。
    // ------------------------------------------------------------------
    const HIDDEN_CSS_ID = 'dsh-workspace-focus/hidden-groups.css'

    function escapeSelectorValue(value) {
      return String(value).replace(/["\\]/g, '\\$&')
    }

    /** 生成"藏起哪些组标题行"的选择器：除聚焦工作区外的全部组标题行（含未分组桶）。 */
    function hiddenGroupSelector(focusedId) {
      // 官方 DOM 契约：组标题行是 data-row-key="workspace:<工作区 id>"（未分组桶是
      // workspace:），会话行是 session:<id>，溢出按钮是 overflow:<key>（嵌在组体里）。
      // 前缀不重叠，所以一条「前缀 + :not(聚焦那一行)」就够了，不必枚举每个工作区：
      // 规则大小恒定，工作区增删也不用重算。
      return `[data-row-key^="workspace:"]:not([data-row-key="workspace:${escapeSelectorValue(focusedId)}"])`
    }

    // ------------------------------------------------------------------
    // 控制器：焦点状态的唯一持有者
    // ------------------------------------------------------------------
    function createController(ctx) {
      const listeners = new Set()
      let focusedPath = null
      let sidebarSnapshot = null
      // 退出聚焦时官方浏览区不在场：还原没做成，等它挂回来再补。
      // 只放在内存里 —— 跨标签页共享的 localStorage 快照会被另一个标签页
      // 正在进行的聚焦误用，不能拿它当"待还原"的信号。
      let pendingRestore = false
      let stateCache = null
      // 聚焦功能总开关。由设置页的 `focusEnabled` 字段控制（Host 侧 Config），
      // 经 configForms 推送过来。关闭时：退出聚焦、还原侧边栏，
      // 并且不再采纳任何作用域。
      // 初值取本地镜像（ENABLE_KEY）：Host 配置要过一趟网络才到，
      // 等它到之前先用镜像，避免开关关着时刷新先聚焦再被退出。
      let enabled = readKey(localStore, ENABLE_KEY) !== '0'
      // 藏非聚焦组标题行用的 <style>（懒创建，退出聚焦时清空内容）
      let hiddenStyleTag = null

      function ensureHiddenStyle() {
        if (hiddenStyleTag !== null) return hiddenStyleTag
        if (typeof document === 'undefined' || !document.head) return null
        try {
          const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(HIDDEN_CSS_ID)}]`)
          if (existing) {
            hiddenStyleTag = existing
            // 认领已有标签时同步缓存：否则"内容没变就不再写"的判断会拿着一份
            // 和 DOM 不一致的旧值，退出聚焦时也清不掉样式。
            appliedHiddenCss = existing.textContent ?? ''
            return existing
          }
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-workspace-focus'
          tag.dataset.pluginCss = HIDDEN_CSS_ID
          tag.textContent = ''
          document.head.appendChild(tag)
          hiddenStyleTag = tag
          return tag
        } catch {
          return null
        }
      }

      // 上一次真正写进 <style> 的规则。内容没变就不碰 DOM：
      // 赋值 textContent 会让整条规则重新匹配一遍。
      let appliedHiddenCss = ''

      /** 只藏非聚焦工作区的组标题行；会话行本来就折叠着。 */
      function applyHiddenGroups(focusedId) {
        const next = focusedId === null || focusedId === undefined
          ? ''
          : `${hiddenGroupSelector(focusedId)}{display:none}`
        if (next === appliedHiddenCss) return
        const tag = ensureHiddenStyle()
        if (!tag) return
        tag.textContent = next
        appliedHiddenCss = next
      }

      function clearHiddenGroups() {
        if (appliedHiddenCss === '') return
        appliedHiddenCss = ''
        if (hiddenStyleTag !== null) hiddenStyleTag.textContent = ''
      }

      function notify() {
        stateCache = computeState()
        for (const listener of [...listeners]) {
          try { listener() } catch (error) { console.error('workspace-focus: listener failed:', error) }
        }
        dispatch()
      }

      function dispatch() {
        try {
          window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { type: 'change' } }))
        } catch { /* 忽略 */ }
      }

      function workspaceList() {
        try {
          const snapshot = ctx.workspaces.list.getSnapshot()
          return Array.isArray(snapshot?.items) ? snapshot.items : []
        } catch {
          return []
        }
      }

      function findWorkspace(path) {
        if (!path) return undefined
        return workspaceList().find((item) => item && item.path === path)
      }

      // 官方浏览区（sidebar.workspaces）自己的视图 store：
      // 它是插件能触达的唯一官方通道 —— 官方没有公开的"过滤"接口。
      function sidebarStore() {
        try {
          const entries = ctx.slots.entries('sidebar.workspaces')
          const entry = (entries ?? []).find((item) => item && item.store)
          if (!entry) return null
          const instance = typeof entry.store.create === 'function' ? entry.store.create() : null
          return instance && instance.actions ? instance : null
        } catch {
          return null
        }
      }

      function applyToSidebar(path) {
        const list = workspaceList()
        const focused = findWorkspace(path)
        // 目标不在注册表里（列表还没到 / 刚被删掉）：宁可什么都不做，
        // 也不要把所有工作区都折叠起来 —— 那才是"侧边栏坏了"的样子。
        if (!focused) return
        // 藏起非聚焦工作区的组标题行。这条不依赖官方 store：
        // DOM 在就能生效，官方浏览区还没挂上时靠槽订阅再补一次。
        applyHiddenGroups(focused.workspaceId)
        const store = sidebarStore()
        if (!store) return
        const current = store.getSnapshot()
        if (sidebarSnapshot === null) {
          // 收窄之前先把"用户原本的展开状态"存下来。
          // 官方视图状态是持久化到 localStorage 的（每次变更都写回），
          // 所以这份快照也必须持久化：否则"聚焦 → 刷新 → 退出聚焦"
          // 还原回去的是上一次收窄后的状态，侧边栏会一直保持收窄。
          sidebarSnapshot = readSnapshot() ?? {
            groupBy: current.groupBy,
            groupExpansion: { ...(current.groupExpansion ?? {}) }
          }
          writeSnapshot(sidebarSnapshot)
        }
        pendingRestore = false
        const expansion = current.groupExpansion ?? {}
        const actions = store.actions
        try {
          // 官方每次 set 都会持久化并通知侧边栏重渲染，所以只写真正的差异：
          // 工作区列表变一次就把同一份收窄状态原样重写一遍是纯开销。
          // 兄弟分组模式：每个工作区独立折叠，互不影响。
          if (current.groupBy !== 'workspace') actions.setGroupBy('workspace')
          for (const workspace of list) {
            const expanded = workspace.path === path
            if (expansion[workspace.workspaceId] !== expanded) {
              actions.setGroupExpanded(workspace.workspaceId, expanded)
            }
          }
          // 未分组的会话桶同样收起来
          if (expansion[''] !== false) actions.setGroupExpanded('', false)
        } catch (error) {
          console.error('workspace-focus: sidebar narrowing failed:', error)
        }
      }

      function restoreSidebar() {
        // 先把藏起来的组标题行放回来
        clearHiddenGroups()
        const store = sidebarStore()
        const snapshot = sidebarSnapshot ?? readSnapshot()
        if (!snapshot) {
          sidebarSnapshot = null
          pendingRestore = false
          removeKey(localStore, SNAPSHOT_KEY)
          return
        }
        if (!store) {
          // 官方浏览区不在场（还没挂载 / 已卸载）：保留快照，等它挂回来再还原。
          // 先把快照删掉才是真坏事 —— 视图状态还停在收窄态，之后没有任何依据能还原。
          sidebarSnapshot = snapshot
          pendingRestore = true
          return
        }
        const list = workspaceList()
        const treeMode = snapshot.groupBy === 'workspace-tree'
        try {
          store.actions.setGroupBy(snapshot.groupBy)
          for (const workspace of list) {
            const original = snapshot.groupExpansion[workspace.workspaceId]
            // 官方语义：没有显式记录时，树模式下的祖先默认展开，兄弟模式下默认折叠
            const fallback = treeMode && list.some((other) => other.path !== workspace.path && isDescendantPath(other.path, workspace.path))
            store.actions.setGroupExpanded(workspace.workspaceId, original === undefined ? fallback : original)
          }
          const originalUngrouped = snapshot.groupExpansion['']
          store.actions.setGroupExpanded('', originalUngrouped === undefined ? false : originalUngrouped)
        } catch (error) {
          // 还原失败的快照同样留着：下一次聚焦/退出还能再试。
          console.error('workspace-focus: sidebar restore failed:', error)
          sidebarSnapshot = snapshot
          pendingRestore = true
          return
        }
        sidebarSnapshot = null
        pendingRestore = false
        removeKey(localStore, SNAPSHOT_KEY)
      }

      function computeState() {
        const workspace = findWorkspace(focusedPath)
        return {
          focusedPath,
          focusedWorkspaceId: workspace?.workspaceId ?? null,
          focusedTitle: workspace?.title ?? null,
          focusedRegistered: workspace !== undefined,
          hasFocus: focusedPath !== null,
          enabled
        }
      }

      function getState() {
        if (stateCache === null) stateCache = computeState()
        return stateCache
      }

      function setFocus(path, options = {}) {
        const next = path === undefined || path === null || path === '' ? null : path
        if (next === focusedPath) return
        // 功能关闭时不接受聚焦请求（退出聚焦仍然允许）
        if (!enabled && next !== null) return
        // 目标工作区不在注册表里（失效的 ?ws=、刚被删掉的工作区）：忽略请求。
        // 列表为空时先不校验 —— 首屏恢复时工作区可能还没加载出来。
        // 收敛到"全部折叠"比不聚焦更糟，而且和指示器的「未聚焦」提示对不上。
        if (next !== null && workspaceList().length > 0 && findWorkspace(next) === undefined) return
        focusedPath = next
        if (next === null) {
          removeKey(sessionStore, SESSION_KEY)
          // 退出聚焦必须彻底：三层载体（URL / sessionStorage / localStorage 默认值）
          // 全部清掉。只清前两层的话，刷新或新开标签页时会被"上次聚焦的默认值"
          // 重新拉回聚焦状态，看起来像退不掉。
          // 例外：功能总开关关闭时不清默认值 —— 那是"暂时不用这个功能"，
          // 不是"我不想记住这个工作区"，重新打开开关还要能恢复。
          if (options.forgetDefault !== false) removeKey(localStore, DEFAULT_KEY)
          writeUrlParam(null)
          restoreSidebar()
        } else {
          writeKey(sessionStore, SESSION_KEY, next)
          writeKey(localStore, DEFAULT_KEY, next)
          if (options.writeUrl !== false) writeUrlParam(next)
          applyToSidebar(next)
        }
        notify()
      }

      // 初始作用域：URL 优先，其次本标签页记忆，最后是"上次聚焦"的默认值。
      // 采用了默认值之后立刻转存到本标签页的 sessionStorage，
      // 这样即使 localStorage 在多个标签页之间共享，各标签页也互不干扰。
      function adoptInitialScope() {
        if (!enabled) return
        const candidate = readUrlParam() ?? readKey(sessionStore, SESSION_KEY) ?? readKey(localStore, DEFAULT_KEY)
        if (!candidate) return
        const list = workspaceList()
        if (list.length === 0) return
        if (!findWorkspace(candidate)) {
          // 指向一个还没注册（或已删除）的工作区：保留 URL，但暂不聚焦
          if (readUrlParam() === candidate) removeKey(sessionStore, SESSION_KEY)
          return
        }
        focusedPath = candidate
        writeKey(sessionStore, SESSION_KEY, candidate)
        writeKey(localStore, DEFAULT_KEY, candidate)
        applyToSidebar(candidate)
        notify()
      }

      // 工作区列表变化（新增 / 删除）后重新对齐一次
      function reconcile() {
        if (focusedPath === null) {
          adoptInitialScope()
          return
        }
        const list = workspaceList()
        if (list.length === 0) return
        if (findWorkspace(focusedPath) === undefined) {
          // 聚焦的工作区被删除了：退出聚焦。
          // 这里保留"上次聚焦的默认值"：工作区可能只是暂时没注册，
          // 留着它不会造成误聚焦（采纳时会校验工作区是否还在）。
          setFocus(null, { forgetDefault: false })
          return
        }
        applyToSidebar(focusedPath)
        // 工作区改名后，聚焦状态的公开字段（focusedTitle / focusedWorkspaceId）
        // 也要跟着刷新。只在真的变了时才广播，别让每次列表变化都惊动订阅者。
        const next = computeState()
        if (stateCache === null
          || next.focusedWorkspaceId !== stateCache.focusedWorkspaceId
          || next.focusedTitle !== stateCache.focusedTitle
          || next.focusedRegistered !== stateCache.focusedRegistered) {
          notify()
        }
      }

      const controller = {
        version: 1,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        getState,
        focus(path) { setFocus(path) },
        exit() { setFocus(null) },
        toggle(path) { setFocus(path === focusedPath ? null : path) },
        isFocused(path) { return focusedPath !== null && focusedPath === path },
        /** 功能总开关：关闭时退出聚焦并还原侧边栏；打开时重新采纳记住的作用域。 */
        setEnabled(next) {
          const value = next !== false
          if (value === enabled) return
          enabled = value
          // 记下这份镜像：下次页面加载时不用等配置到达就知道该不该聚焦
          writeKey(localStore, ENABLE_KEY, value ? '1' : '0')
          if (!enabled) {
            if (focusedPath !== null) {
              // 关总开关 ≠ 退出聚焦：保留"上次聚焦的工作区"，
              // 这样重新打开开关时还能回到同一个工作区。
              setFocus(null, { forgetDefault: false })
            } else {
              notify()
            }
            return
          }
          adoptInitialScope()
          notify()
        },
        isEnabled() { return enabled },
        /** 聚焦链接：带 ?ws= 的当前地址，粘到另一个标签页即同样聚焦 */
        focusUrl() {
          try {
            const url = new URL(window.location.href)
            if (focusedPath) url.searchParams.set(URL_PARAM, focusedPath)
            else url.searchParams.delete(URL_PARAM)
            return url.toString()
          } catch {
            return window.location.href
          }
        }
      }

      // 订阅与监听的清理钩子。bundle 被替换/卸载时必须全部拆掉：
      // 否则旧实例还会跟着工作区列表变化干活，两个实例一起写官方视图状态。
      const cleanups = []

      // 工作区列表变化
      try {
        const off = ctx.workspaces.list.subscribe(() => { reconcile() })
        if (typeof off === 'function') cleanups.push(off)
      } catch (error) {
        console.error('workspace-focus: workspace subscription failed:', error)
      }
      // 官方浏览区注册进来之后补一次（首次加载时它可能还没挂上）
      try {
        const off = ctx.slots.subscribe('sidebar.workspaces', () => {
          if (focusedPath !== null) applyToSidebar(focusedPath)
          // 退出聚焦时浏览区不在场，还原没做成：它挂回来了就补上
          else if (pendingRestore) restoreSidebar()
        })
        if (typeof off === 'function') cleanups.push(off)
      } catch (error) {
        console.error('workspace-focus: slot subscription failed:', error)
      }
      // URL 变化（前进 / 后退 / 外部粘贴）也跟随
      const onPopstate = () => {
        const param = readUrlParam()
        if (param === focusedPath) return
        // 失效作用域：退出聚焦，而不是把侧边栏收敛成"全部折叠"。
        // 保留"上次聚焦"的默认值和 URL 参数 —— 工作区以后重新注册时，
        // reconcile 还会从 URL 把它捡回来。
        if (param !== null && workspaceList().length > 0 && findWorkspace(param) === undefined) {
          setFocus(null, { writeUrl: false, forgetDefault: false })
          return
        }
        setFocus(param, { writeUrl: false })
      }
      try {
        window.addEventListener('popstate', onPopstate)
      } catch { /* 忽略 */ }

      /**
       * 卸载：拆掉所有订阅与监听，把侧边栏从收窄态放回去，再摘掉样式标签。
       *
       * 必须还原侧边栏 —— 收窄态是写进官方视图状态（localStorage）的，
       * 光拆监听会让它永久留在那里。聚焦记忆（默认值 / URL）刻意保留：
       * 替换上来的新实例会立刻重新采纳同一个工作区。
       */
      function dispose() {
        for (const off of cleanups.splice(0)) {
          try { off() } catch { /* 忽略 */ }
        }
        try { window.removeEventListener('popstate', onPopstate) } catch { /* 忽略 */ }
        try {
          if (focusedPath !== null) setFocus(null, { forgetDefault: false, writeUrl: false })
          else if (pendingRestore) restoreSidebar()
        } catch (error) {
          console.error('workspace-focus: dispose restore failed:', error)
        }
        clearHiddenGroups()
        if (hiddenStyleTag !== null && typeof hiddenStyleTag.remove === 'function') {
          try { hiddenStyleTag.remove() } catch { /* 忽略 */ }
        }
        hiddenStyleTag = null
        listeners.clear()
      }

      adoptInitialScope()
      return { controller, dispose }
    }

    // ---- 图标 ----
    function FolderIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M1.5 3.5C1.5 2.95 1.95 2.5 2.5 2.5H5L6.5 4H11.5C12.05 4 12.5 4.45 12.5 5V10.5C12.5 11.05 12.05 11.5 11.5 11.5H2.5C1.95 11.5 1.5 11.05 1.5 10.5V3.5Z',
          stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round'
        }))
    }
    function WarnIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M7 2.2 12.6 12H1.4L7 2.2Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
        h('path', { d: 'M7 5.8v2.7', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }))
    }
    function CheckIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M2.5 7.5 L5.5 10.5 L11.5 3.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }
    function TargetIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 7, cy: 7, r: 5, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('circle', { cx: 7, cy: 7, r: 1.6, fill: 'currentColor' }))
    }
    function PlusIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M7 3v8M3 7h8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
    }
    function LinkIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M5.8 8.2a2.2 2.2 0 0 0 3.1 0l1.6-1.6a2.2 2.2 0 0 0-3.1-3.1l-.6.6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M8.2 5.8a2.2 2.2 0 0 0-3.1 0l-1.6 1.6a2.2 2.2 0 0 0 3.1 3.1l.6-.6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }))
    }
    function ExitIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8.5 2.5H4.2v9h4.3', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('path', { d: 'M6.5 7h5.2M9.8 5.2 11.6 7 9.8 8.8', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    // ---- React 绑定 ----
    /** 订阅一个 ConfigForm 命名空间的快照。 */
    function useFormSnapshot(forms, namespace) {
      const form = useMemo(() => forms.get(namespace), [forms, namespace])
      const subscribe = useCallback((listener) => form.subscribe(listener), [form])
      const read = useCallback(() => form.getSnapshot(), [form])
      return useSyncExternalStore(subscribe, read, read)
    }

    /** 订阅控制器的公开状态。 */
    function useControllerState(controller) {
      const subscribe = useCallback((listener) => controller.subscribe(listener), [controller])
      const read = useCallback(() => controller.getState(), [controller])
      return useSyncExternalStore(subscribe, read, read)
    }

    // 菜单定位：贴在触发点（右键）或指示器（键盘）下方，并夹在视口内。
    function computeMenuPosition(placement, anchorRect, size) {
      const margin = 8
      const gap = 6
      const viewportWidth = window.innerWidth || 0
      const viewportHeight = window.innerHeight || 0
      const width = size?.width || 0
      const height = size?.height || 0
      let left
      let top
      if (placement && placement.mode === 'point') {
        left = placement.x
        top = placement.y
      } else if (anchorRect) {
        left = anchorRect.right - width
        top = anchorRect.bottom + gap
      } else {
        left = margin
        top = margin
      }
      if (width > 0 && left + width > viewportWidth - margin) left = viewportWidth - margin - width
      if (left < margin) left = margin
      if (height > 0 && top + height > viewportHeight - margin) {
        // 下方放不下：指示器场景往上翻，点菜场景贴着视口底部
        const above = anchorRect ? anchorRect.top - gap : null
        top = above !== null && above - height > margin ? above - height : viewportHeight - margin - height
      }
      if (top < margin) top = margin
      return { left: Math.round(left), top: Math.round(top) }
    }

    function FocusMenu({ controller, state, list, currentWorkspace, t, placement, anchorRef, onClose, onNewSession, onCopy }) {
      const menuRef = useRef(null)
      const [position, setPosition] = useState(null)

      // 位置：先按触发点算，再用实测尺寸夹进视口（首帧尺寸为 0，第二帧修正）
      useEffect(() => {
        const element = menuRef.current
        if (!element) return
        const rect = element.getBoundingClientRect()
        const anchorRect = anchorRef?.current?.getBoundingClientRect?.() ?? null
        const next = computeMenuPosition(placement, anchorRect, { width: rect.width, height: rect.height })
        setPosition((current) => (current && current.left === next.left && current.top === next.top ? current : next))
      })

      useEffect(() => {
        const onPointerDown = (event) => {
          if (menuRef.current && !menuRef.current.contains(event.target)) onClose()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          const element = menuRef.current
          if (!element) return
          const items = Array.from(element.querySelectorAll('[role="menuitem"]'))
          if (items.length === 0) return
          event.preventDefault()
          const current = items.indexOf(document.activeElement)
          const next = event.key === 'ArrowDown'
            ? (current + 1) % items.length
            : (current <= 0 ? items.length - 1 : current - 1)
          items[next].focus()
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', onClose)
        window.addEventListener('scroll', onClose, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', onClose)
          window.removeEventListener('scroll', onClose, true)
        }
      }, [onClose])

      // 打开后把键盘焦点放到第一个条目（等位置算出来，隐藏元素拿不到焦点）
      useEffect(() => {
        if (!position) return
        const element = menuRef.current
        if (!element) return
        const first = element.querySelector('[role="menuitem"]')
        if (first && typeof first.focus === 'function') first.focus()
      }, [position])

      const focused = state.hasFocus
      const focusedWorkspace = focused ? list.find((item) => item.path === state.focusedPath) : undefined
      const item = (key, icon, label, onClick) => h('button', {
        key, type: 'button', role: 'menuitem', className: 'wf-item', onClick
      }, h('span', { className: 'wf-itemIcon' }, icon), h('span', { className: 'wf-itemLabel' }, label))

      // 菜单必须 portal 到 body：会话标题容器带 mask-image + overflow: clip，
      // 留在 header 里的 position:fixed 浮层会被裁掉。
      const surface = h('div', {
        ref: menuRef, className: 'wf-surface', 'data-menu-material': 'translucent',
        style: position
          ? { left: `${position.left}px`, top: `${position.top}px` }
          : { left: '0px', top: '0px', visibility: 'hidden' }
      },
        h('div', { className: 'wf-material', 'aria-hidden': 'true' }),
        h('div', { className: 'wf-list', role: 'menu' },
          h('div', { className: 'wf-viewport', role: 'presentation' },
            h('div', { className: 'wf-label' }, t('focus.title')),
            list.map((entry) => h('button', {
              key: entry.workspaceId, type: 'button', role: 'menuitem', className: 'wf-item',
              'aria-current': entry.path === state.focusedPath ? 'true' : undefined,
              onClick: () => { controller.focus(entry.path); onClose() }
            },
              h('span', { className: 'wf-itemIcon' }, h(FolderIcon, null)),
              h('span', { className: 'wf-itemLabel' }, entry.title),
              h('span', { className: 'wf-path' }, entry.path),
              entry.path === state.focusedPath ? h('span', { className: 'wf-itemCheck' }, h(CheckIcon, null)) : null)),
            currentWorkspace && currentWorkspace.path !== state.focusedPath
              ? item('focus-current', h(TargetIcon, null), t('focus.current'), () => { controller.focus(currentWorkspace.path); onClose() })
              : null,
            focused && focusedWorkspace
              ? item('focus-new', h(PlusIcon, null), t('focus.newSession'), () => { onNewSession(focusedWorkspace); onClose() })
              : null,
            focused ? h('div', { key: 'focus-sep-1', className: 'wf-separator' }) : null,
            focused
              ? item('focus-copy', h(LinkIcon, null), t('focus.copy'), () => { onCopy(); onClose() })
              : null,
            focused
              ? item('focus-exit', h(ExitIcon, null), t('focus.exit'), () => { controller.exit(); onClose() })
              : null)))

      return createPortal(surface, document.body)
    }

    /**
     * 头部指示器。三态：聚焦中且当前会话在范围内（蓝点）／聚焦中但会话在范围外
     * （警告色 + 「未聚焦」）／未聚焦（普通样式）。
     *
     * 手势：单击无反应；双击切换聚焦；右键打开菜单（落在鼠标位置）；
     * 键盘 Enter / Space 等价于右键（菜单落在指示器下方）。
     */
    function WorkspaceIndicator({ forms, controller, sessionId, useWorkspaces, t, onNewSession, onCopy }) {
      const items = useWorkspaces((snapshot) => snapshot.items)
      const config = useFormSnapshot(forms, NAMESPACE)
      const value = config.value ?? {}
      const visible = value.enabled !== false
      const focusEnabled = value.focusEnabled !== false
      const state = useControllerState(controller)
      // 开关的本地镜像在首帧就是准的：关着时一开始就是静态标签，不会先可交互再变回去。
      const interactive = focusEnabled && state.enabled !== false
      const list = Array.isArray(items) ? items : []
      const workspace = list.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))
      const [open, setOpen] = useState(false)
      // 菜单的落点：{ mode: 'point', x, y } = 右键位置；{ mode: 'anchor' } = 指示器下方
      const [placement, setPlacement] = useState(null)
      const [copied, setCopied] = useState(false)
      const anchorRef = useRef(null)

      useEffect(() => {
        if (!copied) return
        const timer = setTimeout(() => { setCopied(false) }, 1600)
        return () => { clearTimeout(timer) }
      }, [copied])

      if (!visible) return null

      // 当前会话不属于任何工作区 → 没有工作区可显示，就不显示这个指示器。
      // 官方也是这个口径：子智能体从不进工作区的记账，侧边栏也不显示它们。
      if (workspace === undefined) return null

      if (!interactive) {
        const tip = workspace.path !== workspace.title ? `${workspace.title} · ${workspace.path}` : workspace.title
        return h('span', { className: 'wf-chip', title: tip, 'aria-label': tip },
          h(FolderIcon, null),
          h('span', { className: 'wf-name' }, workspace.title))
      }

      const focused = state.hasFocus
      const focusedWorkspace = focused ? list.find((item) => item.path === state.focusedPath) : undefined
      const inScope = focused && workspace.path === state.focusedPath
      const label = focused
        ? (inScope ? (focusedWorkspace?.title ?? state.focusedTitle ?? '') : workspace.title)
        : workspace.title
      const variant = focused ? (inScope ? 'wf-focused' : 'wf-outside') : ''
      const tip = focused
        ? (inScope
            ? `${focusedWorkspace?.title ?? state.focusedTitle ?? ''} · ${state.focusedPath ?? ''}`
            : `${t('chip.outside')} · ${workspace.title}`)
        : (workspace.path !== workspace.title ? `${workspace.title} · ${workspace.path}` : workspace.title)

      const openMenu = (next) => {
        setPlacement(next)
        setOpen(true)
      }
      const toggleFocus = () => {
        if (focused && state.focusedPath === workspace.path) controller.exit()
        else controller.focus(workspace.path)
      }

      const chip = h('span', {
        ref: anchorRef, className: `wf-chip wf-focusable ${variant}`.trim(),
        title: `${tip} · ${t('chip.hint')}`, 'aria-label': tip,
        role: 'button', tabIndex: 0,
        'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false',
        onDoubleClick: (event) => {
          event.preventDefault()
          setOpen(false)
          toggleFocus()
        },
        onContextMenu: (event) => {
          event.preventDefault()
          openMenu({ mode: 'point', x: event.clientX, y: event.clientY })
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openMenu({ mode: 'anchor' })
          }
        }
      },
        focused && !inScope ? h(WarnIcon, null) : h(FolderIcon, null),
        h('span', { className: 'wf-name' }, label),
        focused && inScope ? h('span', { className: 'wf-dot' }) : null,
        focused && !inScope ? h('span', { className: 'wf-flag' }, t('chip.outside')) : null,
        copied ? h('span', { className: 'wf-flag' }, t('focus.copied')) : null)

      return h('span', { className: 'wf-root' },
        chip,
        open
          ? h(FocusMenu, {
              controller, state, list, currentWorkspace: workspace, t,
              placement, anchorRef,
              onClose: () => { setOpen(false) },
              onNewSession,
              onCopy: () => { onCopy(() => { setCopied(true) }) }
            })
          : null)
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'workspaces'],
      apply(ctx) {
        const { controller, dispose } = createController(ctx)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-focus: dictionaries')
        const t = ctx.locale.bind(NS)

        let unhook = null
        try {
          const result = ctx.provide('workspaceFocus', controller)
          if (typeof result === 'function') unhook = result
        } catch { /* 忽略 */ }
        try {
          window[GLOBAL_KEY] = controller
          window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { type: 'ready' } }))
        } catch { /* 忽略 */ }

        // 设置页的开关 → 控制器。配置要过一趟网络才到（loading → ready / unavailable），
        // 在那之前不推：把"还没拿到"当成"开着"推送会把刚恢复的作用域又关掉。
        try {
          const form = ctx.configForms.get(NAMESPACE)
          const pushConfig = () => {
            const snapshot = form.getSnapshot()
            if (snapshot.status === 'loading') return
            controller.setEnabled((snapshot.value ?? {}).focusEnabled !== false)
          }
          ctx.effect(() => form.subscribe(pushConfig), 'workspace-focus: settings subscription')
          pushConfig()
        } catch (error) {
          console.error('workspace-focus: settings subscription failed:', error)
        }

        // 聚焦动作。uiWorkspace 不声明成必需依赖：它缺席时「在此工作区新建会话」不生效，
        // 其余功能不受影响。
        const startSessionIn = (workspace) => {
          try {
            const uiWorkspace = ctx.get('uiWorkspace')
            if (!uiWorkspace || !workspace) return
            uiWorkspace.startSession(workspace.workspaceId)
          } catch (error) {
            console.error('workspace-focus: focused session start failed:', error)
          }
        }
        const copyFocusLink = (onDone) => {
          const url = controller.focusUrl()
          const done = () => { if (typeof onDone === 'function') onDone() }
          try {
            const clipboard = navigator.clipboard
            if (clipboard && typeof clipboard.writeText === 'function') {
              clipboard.writeText(url).then(done, () => { fallbackCopy(url, done) })
              return
            }
          } catch { /* 继续走兜底 */ }
          fallbackCopy(url, done)
        }
        const fallbackCopy = (url, done) => {
          try {
            const area = document.createElement('textarea')
            area.value = url
            area.setAttribute('readonly', 'true')
            area.style.position = 'fixed'
            area.style.opacity = '0'
            document.body.appendChild(area)
            area.select()
            document.execCommand('copy')
            document.body.removeChild(area)
            done()
          } catch (error) {
            console.error('workspace-focus: focus link copy failed:', error)
          }
        }

        // 头部入口：从 slot 自带的选择器读会话数据，从 configForms 读设置。
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions', id: 'workspace-focus', order: 25, locale: NS
        }, function WorkspaceFocusEntry(props) {
          return h(WorkspaceIndicator, {
            forms: ctx.configForms,
            controller,
            sessionId: props.sessionId,
            useWorkspaces: props.useWorkspaces,
            t,
            onNewSession: startSessionIn,
            onCopy: copyFocusLink
          })
        }))

        // 返回 disposer：cordis 会把 apply 的返回值当清理钩子收集。
        return () => {
          try {
            if (window[GLOBAL_KEY] === controller) delete window[GLOBAL_KEY]
          } catch { /* 忽略 */ }
          try { dispose() } catch (error) { console.error('workspace-focus: dispose failed:', error) }
          try { if (unhook !== null) unhook() } catch { /* 忽略 */ }
          // 通知外部（调试面板 / 其它插件）句柄已经没了。
          try {
            window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { type: 'gone' } }))
          } catch { /* 忽略 */ }
        }
      }
    }
  }
})
