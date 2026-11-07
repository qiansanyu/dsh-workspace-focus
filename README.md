# dsh-workspace-focus

把 DSH（DeepSeek Harness）Web UI 的侧边栏**收窄到当前聚焦的那一个工作区**，并在会话头部提供一个聚焦入口。

一个独立插件：装它一个就够了，不再依赖任何「顶部导航」框架。

```
未聚焦                              聚焦 demo
┌─────────────────────────┐        ┌─────────────────────────┐
│ 📁 demo            ▼     │        │ 📁 demo            ▼     │  ← 只剩聚焦的工作区
│   会话 A                 │        │   会话 A                 │
│ 🗂 api                   │        │ 会话 B / C 被藏起来       │
│ 🗂 ops                   │        └─────────────────────────┘
└─────────────────────────┘
```

---

## 安装

要求 DSH Web（`dsh web`）0.2.x。

```bash
# 1. 装依赖（Host 半用 schemastery 声明设置 schema）
pnpm install

# 2. 把本目录作为 bundle 装进 profile
dsh plugin --profile web add /path/to/dsh-workspace-focus
# 或在 DSH 会话里用 plugin_manager install_bundle，target = 本目录

# 3. 重启 dsh web（替换已安装的包需要新的 module generation）
```

> 本仓库不发布到 npm。用 `dsh plugin add <本地路径或 git 地址>` 安装即可。

## 使用

### 头部指示器

会话属于某个工作区时，标题栏右侧会出现一个工作区标签。三种状态：

| 状态 | 外观 | 含义 |
|---|---|---|
| 未聚焦 | 灰色标签 | 侧边栏照常显示所有工作区 |
| 聚焦中，且当前会话在范围内 | 蓝色标签 + 蓝点 | 侧边栏只剩这个工作区 |
| 聚焦中，但当前会话在范围外 | 警告色 + 「未聚焦」 | 你正在看的是别的工作区的会话 |

手势：

- **单击**：无反应（避免误触改变侧边栏）
- **双击**：聚焦到当前会话所在的工作区；已聚焦则退出
- **右键**：打开菜单（落在鼠标位置）
- **键盘** `Enter` / `Space`：等价于右键（菜单落在指示器下方）

菜单内容：工作区列表、聚焦到当前工作区、在此工作区新建会话、复制聚焦链接、退出聚焦。

> 当前会话不属于任何工作区时（例如子智能体），指示器不显示——没有可聚焦的目标。

### 设置

设置 → **工作区聚焦** 有两项：

| 字段 | 默认 | 作用 |
|---|---|---|
| `enabled` | 开 | 整个插件是否启用（关掉后头部不再显示标签） |
| `focusEnabled` | 开 | 聚焦功能是否开启（关掉时标签退回静态文本，正在进行的聚焦会被退出） |

两项都通过 `settings` 服务持久化在 profile 的 Cordis patch 里，重启和升级不丢。

## 作用域：每个标签页各记各的

| 载体 | 角色 |
|---|---|
| URL `?ws=<工作区路径>` | 显式状态，可分享 / 可收藏；优先级最高 |
| `sessionStorage['dsh.workspace.focus']` | 本标签页的记忆（刷新保留，跨标签页不可见） |
| `localStorage['dsh.workspace.focus.default']` | 新标签页的初始默认（"上次聚焦的工作区"） |

读取顺序：URL → sessionStorage → localStorage 默认。采用了默认值之后会立刻转存进本标签页的
sessionStorage，所以即使 localStorage 在多个标签页之间共享，各标签页也互不干扰。

**「退出聚焦」清掉全部三层**，否则刷新或新开标签页时会被默认值重新拉回聚焦状态。

**失效的作用域不动侧边栏**：URL 里的工作区若不在注册表里（被删了、或链接来自另一台机器），
启动时保留参数但不聚焦；前进/后退切到这样一个参数时退出聚焦并还原侧边栏，
而不是把每个工作区都折叠起来。

## 它怎么让侧边栏收窄

官方没有公开的"过滤会话列表"接口——浏览区是一个单槽 `sidebar.workspaces`，官方组件
`WorkspaceBrowser` 运行时也不导出。本插件走两条官方通道：

1. **视图状态**：从 `ctx.slots.entries('sidebar.workspaces')` 拿到官方浏览区自己注册的视图
   store（官方把 `create()` 固定成同一个实例），进入聚焦前快照它的 `groupBy` 与
   `groupExpansion`，聚焦时把非聚焦的工作区全部折叠，退出时按快照还原。
   只写与现状不同的项——官方每次 set 都会持久化并通知侧边栏重渲染。
2. **组标题行**：折叠只藏会话，工作区标题照旧渲染。官方给每个组标题行留了稳定标识
   `data-row-key="workspace:<工作区 id>"`，插件注入一条 CSS 规则把它藏起来：

   ```css
   [data-row-key^="workspace:"]:not([data-row-key="workspace:<聚焦 id>"]){display:none}
   ```

   规则按前缀写，不枚举每个工作区：大小恒定，工作区增删不用重算。

   官方 `data-row-key` 命名空间互不重叠（组标题 `workspace:`、会话行 `session:`、
   溢出按钮 `overflow:`、空态 `empty`），所以一条规则就够。

   只藏标题行：那些工作区的会话行本来就被折叠藏住了，官方组件的 hover 卡片、行菜单
   （pin / 重命名 / 分叉 / 归档 / 复制 ID）、拖拽排序、定时任务标记、搜索一样不少。

退出聚焦时清空这条规则，标题行全部回来。

> 取不到 store 时（例如官方浏览区还没挂上），插件静默降级：只保留头部状态，不动侧边栏。
> `ctx.slots.entries()` 是官方注释里的 *inspection surface*，不是稳定 API；
> 取不到就宁可少一个功能，也不弄坏侧边栏。

## 已知的边界

- **未分组桶会被整桶隐藏**：工作区成员关系是显式记账，只有 `attachSession` 会写入；
  只给了 cwd 创建的会话不会进任何工作区，聚焦时会从侧边栏消失。
- 官方视图状态存在 `localStorage`（key `dsh.workspace.view.v5`），**跨标签页共享**。
  两个标签页各自聚焦时，折叠状态会互相覆盖（这是官方存储的固有行为）。退出聚焦会还原到
  自己快照里的值，快照同样存在 localStorage。
- 严格隔离只作用于侧边栏的浏览区：官方浏览区上方的**搜索**走 Host 全量查询，仍可能搜到
  其它工作区的会话。
- 聚焦时当前会话若在别的工作区，那个工作区的会话在侧边栏里也不可见（头部会显示「未聚焦」）。
- 头部的「新建会话」按钮走官方逻辑，本插件不拦截；要确定落在聚焦工作区，用菜单里的
  「在此工作区新建会话」。
- 聚焦的工作区被删除时自动退出聚焦。
- 本插件靠官方 `data-row-key` 的 DOM 契约：官方改了标识就等于失效（表现退回
  "折叠但不隐藏标题"，不会坏掉）。

## 跨插件契约（可选）

控制器也挂在 window 上，方便调试或让别的插件接入：

- `window.__DSH_WORKSPACE_FOCUS__` —— 控制器（`focus(path)` / `exit()` / `toggle(path)` /
  `getState()` / `subscribe(fn)` / `focusUrl()` / `setEnabled(bool)` / `isEnabled()`）；
- `window` 上的 `dsh:workspace-focus` 事件 —— 状态变化广播；卸载时广播 `{ type: 'gone' }`。

```js
const controller = window.__DSH_WORKSPACE_FOCUS__
controller.focus('D:\\Code\\demo')
console.log(controller.getState()) // { focusedPath, focusedWorkspaceId, focusedTitle, hasFocus, enabled }
```

## 自检

```bash
node tools/check-client.mjs
```

在没有浏览器的情况下把 client 半跑一遍：作用域优先级、聚焦时的侧边栏折叠动作、
退出时对官方视图状态的还原、树形分组下的还原语义、聚焦链接、设置开关、
刷新路径、失效作用域、快照保护、写前差异、卸载清理，以及头部标签的渲染。

`tools/render-strict-isolation.mjs` 可以离线生成一张"只剩聚焦那一组"的 HTML 对照图。

## 目录结构

```
dsh-workspace-focus/
├── package.json        dsh.bundle.patch + dsh.client
├── cordis.patch.yml    插入 Host entry
├── index.js            Host：设置 schema（enabled / focusEnabled）
├── client.js           浏览器：作用域 + 侧边栏收窄 + 头部指示器
├── locale/{zh,en}.json 插件显示元数据
├── icon.svg
└── tools/
    ├── check-client.mjs            离线自检
    └── render-strict-isolation.mjs 收窄效果对照图
```

## 开发

改 `client.js` 后刷新页面即可（纯客户端改动）；改了 Host 半（`index.js` / `cordis.patch.yml`）
需要重启 `dsh web`。

## License

MIT
