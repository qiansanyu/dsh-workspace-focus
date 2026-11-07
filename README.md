# dsh-workspace-focus

给 DSH（DeepSeek Harness）Web UI 加一个「工作区聚焦」：**把侧边栏收窄到当前聚焦的那一个工作区**，
并在会话头部给你一个入口和状态提示。

```
未聚焦                              聚焦 demo
├─ 📁 demo                          └─ 📁 demo
│    └─ 会话 A                           └─ 会话 A
├─ 📁 api
│    └─ 会话 B
└─ 📁 ops
     └─ 会话 C
```

聚焦之后，`api`、`ops` 和它们下面的会话一起从侧边栏消失；退出聚焦则原样回来。

## 安装

前提：DSH Web `0.2.x`（`dsh --version` 确认；开发时用的是 `0.2.2-rc.1`），PATH 上有 `pnpm`——
`dsh plugin` 会把参数转发给 pnpm。

### 方式一：命令行（推荐）

```bash
dsh plugin --profile web add git+https://github.com/qiansanyu/dsh-workspace-focus.git
```

这条命令在 web profile 里执行 `pnpm add`，装完把 `dsh-workspace-focus` 追加进 profile 的
`dsh.profile.bundles`，**不用再手动改配置**。

装完刷新页面即可：`dsh web` 默认启用 `dsh-hmr`，它监视 profile 的 manifest，新的 bundle
会被重新组合进来；刷新后还是没反应就重启一次 `dsh web`（HMR 被关掉的 profile 只能重启）。

确认装上了：随便打开一个属于某个工作区的会话，头部右侧出现工作区标签；
「设置 → 工作区聚焦」出现两个开关。

补充说明：

- 等价简写：`github:qiansanyu/dsh-workspace-focus`（pnpm 会把上面那串也归一成这个）。
- HTTPS 拉不动（连接被重置之类）时换 SSH：`git+ssh://git@github.com/qiansanyu/dsh-workspace-focus.git`。
- 装下来的是**当时默认分支的快照**，不是跟随分支的滚动更新。换新版本：先 `remove` 再 `add`。

### 方式二：Web 界面

侧边栏 →「插件」→「添加插件」→「安装第三方插件」，把同一个地址填进去。
这条路同样会自动勾上 bundle，适合不想开终端的时候。

### 卸载

```bash
dsh plugin --profile web remove dsh-workspace-focus
```

依赖和 `dsh.profile.bundles` 里的条目会一起消失。也可以在「插件」页里移除。

> **不要和旧版同时装。** 如果你之前用别的方式装过一个功能相同的工作区聚焦插件
> （例如从一个本地目录 `link:` 安装的开发版），先把那个卸掉。两个一起装的后果是：
> 头部出现两个标签，而且它们抢同一个 `window.__DSH_WORKSPACE_FOCUS__` 句柄。

## 使用

### 头部标签

当前会话属于某个工作区时，会话标题栏右侧会出现一个工作区标签。三态：

| 状态 | 外观 | 含义 |
|---|---|---|
| 未聚焦 | 灰色标签 | 侧边栏照常显示所有工作区 |
| 聚焦中，当前会话在聚焦的工作区里 | 蓝色标签 + 蓝点 | 侧边栏只剩这个工作区 |
| 聚焦中，当前会话在别的工作区 | 警告色 +「未聚焦」 | 你正在看的是没聚焦的那个工作区的会话 |

手势：

- **单击**：不做事（避免误触把侧边栏改了）
- **双击**：聚焦到当前会话所在的工作区；已经聚焦在它上面就退出
- **右键**：在鼠标位置打开菜单
- **键盘** `Enter` / `Space`：同右键，菜单落在标签下方

菜单里有：工作区列表、聚焦到当前工作区、在此工作区新建会话、复制聚焦链接、退出聚焦。

> 当前会话不属于任何工作区时（例如子智能体的会话），标签不显示——没有可聚焦的目标。

### 设置

「设置 → 工作区聚焦」：

| 字段 | 默认 | 作用 |
|---|---|---|
| `enabled` | 开 | 整个插件是否启用。关掉后头部不再显示标签（已生效的聚焦保持不动） |
| `focusEnabled` | 开 | 聚焦功能是否开启。关掉后标签退回不可点的静态文本，正在进行的聚焦会被退出、侧边栏还原 |

两个开关都走 `settings` 服务，落在 profile 的 `cordis.patch.yml` 里，重启和升级都不丢。

### 聚焦链接

聚焦后地址栏会带上 `?ws=<工作区路径>`。用菜单里的「复制聚焦链接」把它发给别人（或另一个标签页），
对方打开就直接进入同一个聚焦状态，不依赖他那边的本地记忆。

- 链接里的工作区不存在（被删了，或者链接来自另一台机器）→ 参数保留但不聚焦，什么都不坏。
- 在标签页里前进/后退切到这样一个失效参数 → 退出聚焦并还原侧边栏，而不是把每个工作区都折叠起来。

## 作用域：每个标签页各记各的

| 载体 | 角色 |
|---|---|
| URL `?ws=<工作区路径>` | 显式状态，可分享、可收藏；优先级最高 |
| `sessionStorage['dsh.workspace.focus']` | 本标签页的记忆（刷新还在，别的标签页看不见） |
| `localStorage['dsh.workspace.focus.default']` | 新标签页的初始默认值（「上次聚焦的工作区」） |

读取顺序：URL → sessionStorage → localStorage 默认值。用了默认值之后会立刻转存进本标签页的
sessionStorage，所以即使 localStorage 在多个标签页之间共享，各标签页也互不干扰。

**「退出聚焦」会清掉全部三层**，否则刷新或新开标签页时会被默认值重新拉回聚焦状态。

## 已知的边界

- **未分组桶会整桶消失**：工作区成员关系是显式记账的，只有 `attachSession` 会写；
  只在某个目录里新建、没归到工作区的会话不在任何工作区里，聚焦时它们会从侧边栏消失。
- 官方视图状态本身存在 `localStorage`（key `dsh.workspace.view.v5`），**跨标签页共享**。
  两个标签页各自聚焦时，折叠状态会互相覆盖——这是官方存储的固有行为。
  退出聚焦会还原到自己快照里的值，快照同样在 localStorage（`dsh.workspace.focus.snapshot`）。
- 隔离只作用于侧边栏的浏览区：浏览区上方的**搜索**走 Host 全量查询，仍可能搜到别的工作区的会话。
- 聚焦时，如果当前会话在别的工作区，那个工作区的会话在侧边栏里也看不见（头部会显示「未聚焦」）。
- 头部的「新建会话」按钮走官方逻辑，本插件不拦；要确保落在聚焦的工作区，用菜单里的
  「在此工作区新建会话」。
- 聚焦的工作区被删除时自动退出聚焦。
- 收窄靠官方 `data-row-key` 的 DOM 契约。官方改了标识就等于失效，表现退回
  「折叠但不隐藏标题」——难看，但不会坏。

## 它怎么让侧边栏收窄

官方没有公开「过滤会话列表」的接口：浏览区是单槽 `sidebar.workspaces`，官方组件
`WorkspaceBrowser` 运行时也不导出。所以本插件走两条官方通道：

1. **视图状态**：从 `ctx.slots.entries('sidebar.workspaces')` 拿到官方浏览区自己注册的视图
   store（官方把 `create()` 固定成同一个实例）。进入聚焦前快照它的 `groupBy` 与
   `groupExpansion`，聚焦时把非聚焦的工作区全部折叠，退出时按快照还原。
   只写与现状不同的项——官方每次 set 都会持久化并通知侧边栏重渲染。
2. **组标题行**：折叠只藏会话，工作区标题照旧渲染。官方给每个组标题行留了稳定标识
   `data-row-key="workspace:<工作区 id>"`，插件注入一条 CSS 规则把它藏起来：

   ```css
   [data-row-key^="workspace:"]:not([data-row-key="workspace:<聚焦 id>"]){display:none}
   ```

   规则按前缀写，不枚举每个工作区：大小恒定，工作区增删不用重算。官方 `data-row-key`
   的命名空间互不重叠（组标题 `workspace:`、会话行 `session:`、溢出按钮 `overflow:`、空态
   `empty`），一条规则就够。只藏标题行，所以官方组件的 hover 卡片、行菜单（pin / 重命名 /
   分叉 / 归档 / 复制 ID）、拖拽排序、定时任务标记、搜索一样不少。

退出聚焦时清空这条规则，标题行全部回来。

> 取不到 store 时（例如官方浏览区还没挂上），插件静默降级：只保留头部状态，不动侧边栏。
> `ctx.slots.entries()` 是官方注释里的 *inspection surface*，不是稳定 API；
> 取不到就宁可少一个功能，也不弄坏侧边栏。

## 跨插件契约（可选）

控制器挂在 `window` 上，方便调试，也方便别的插件接入同一份状态：

- `window.__DSH_WORKSPACE_FOCUS__` —— 控制器：
  `focus(path)` / `exit()` / `toggle(path)` / `isFocused(path)` / `getState()` /
  `subscribe(fn)` / `focusUrl()` / `setEnabled(bool)` / `isEnabled()`；
- `window` 上的 `dsh:workspace-focus` 事件 —— 状态变化广播，`detail.type` 为 `ready` / `change`；
  插件卸载时广播 `{ type: 'gone' }`。

```js
const controller = window.__DSH_WORKSPACE_FOCUS__
controller.focus('D:\\Code\\demo')
console.log(controller.getState())
// { focusedPath, focusedWorkspaceId, focusedTitle, focusedRegistered, hasFocus, enabled }
```

## 从源码开发

先用 `link:` 把本地目录装进 profile（这样页面加载的就是你正在改的那份文件）：

```bash
git clone https://github.com/qiansanyu/dsh-workspace-focus.git
cd dsh-workspace-focus
pnpm install                                   # 必须：link: 不会安装本包声明的依赖

dsh plugin --profile web add link:"$(pwd)"     # macOS / Linux
dsh plugin --profile web add link:D:/Code/dshchajian/dsh-workspace-focus   # Windows
```

`pnpm install` 不能省：`link:` 只是把目录链接进 profile，不会安装这个包声明的依赖，
而 Host 半要 `import '@deepseek-ai/schemastery'` 来声明设置 schema。缺了它，Host 半加载即报错。

之后：

- 改 `client.js`（或 `index.js`）：`dsh-hmr` 会看到 link 目录里的改动并重载，刷新页面查看。
- 改 `cordis.patch.yml` 或 `package.json` 里的 `dsh` 声明：这两份只在组合时读，重启 `dsh web`。
- 每步改完跑一遍自检：

```bash
node tools/check-client.mjs
```

它在没有浏览器的情况下把 client 半跑一遍：作用域优先级、聚焦时的折叠动作、退出时对官方视图
状态的还原、树形分组下的还原语义、聚焦链接、设置开关、刷新路径、失效作用域、快照保护、
写前差异、卸载清理，以及头部标签的渲染。

`node tools/render-strict-isolation.mjs` 可以离线生成一张「只剩聚焦那一组」的 HTML 对照图。

## 目录结构

```
dsh-workspace-focus/
├── package.json        dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml    插入 Host entry
├── index.js            Host：设置 schema（enabled / focusEnabled）
├── client.js           浏览器：作用域 + 侧边栏收窄 + 头部标签
├── locale/{zh,en}.json 插件显示元数据
├── icon.svg
└── tools/
    ├── check-client.mjs            离线自检
    └── render-strict-isolation.mjs 收窄效果对照图
```

## License

MIT
