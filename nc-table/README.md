# nc-table

从 [NocoDB](../nocodb-develop) 的 canvas 表格控件（`packages/nc-gui/components/smartsheet/grid/canvas`）中抽离出的**独立、零依赖的原生 JS 表格控件**。

原控件与 Nuxt/Vue、nocodb-sdk、pinia、vueuse 等深度耦合，无法独立运行。本控件保留其**核心架构与交互模型**，用纯 JS + Canvas 重新实现：

| NocoDB 原模块 | 抽离后的实现 |
|---|---|
| `useCanvasTable` / `useCanvasRender` | `requestAnimationFrame` 渲染循环 + canvas 虚拟滚动（只渲染可视行列）+ dpr 高清缩放 |
| `cells/index.ts`（cellTypesRegistry） | `NcTable.registerCellType()` 单元格渲染器注册表，内置 text / number / checkbox / select / date |
| `utils/canvas.ts` | `truncateText`（按像素估算 + 收敛的二进制截断）、`renderCheckbox`、`renderTagLabel`（select 标签）逐一对应移植 |
| `useColumnResize.ts` | 表头 8px 热区拖拽列宽、最小 50px、resize 时紫色描边 |
| `useColumnReorder.ts` | 列头拖拽换位：5px 激活阈值、grab/grabbing 光标、被拖列高亮 + 插入线指示、冻结列不参与、`moveColumn` API |
| `useMouseSelection.ts` | 单击/拖拽/Shift 单元格区域选择，拖选上限 100 行（MAX_SELECTED_ROWS），边缘自动滚动 |
| `useKeyboardNavigation.ts` | 方向键、Tab、Enter、F2、Esc、Delete/Backspace 清空、Ctrl+A、PageUp/Down、Home/End、直接键入即编辑 |
| `useCopyPaste.ts` | Ctrl+C / Ctrl+X / Ctrl+V 剪贴板（TSV），粘贴按列类型自动解析（number/checkbox/select 选项 label→value） |
| `useFillHandler.ts` | 选区右下角填充手柄：向下拖拽重复填充选区值模式，拖回自动回滚 |
| `header/ColumnMenu.vue` | 表头 ∨ 按钮（14px 热区）/ 右键列头 -> 列设置菜单：重命名/定向排序/冻结/隐藏/前后插入/删除 |
| `CellRenderer.handleCellClick` | 渲染器 `onClick/onActivate/cursor` 交互钩子（demo 操作列 = 编辑/删除按钮） |
| `toolbar/Filter` + 值选择 | Excel 式数据筛选：列菜单第一项 -> 值勾选面板（搜索/全选/多列 AND/漏斗标记），远程模式经 `filters` 参数下发服务端 |
| `useDataFetch.ts` + CHUNK_SIZE | `loadData({offset, limit, sort, filters})` 分块异步加载，未加载块渲染 loading 占位条 |
| `renderAggregations` + Aggregation.vue | footer 聚合行（32px）：列 `agg` 配置或点击聚合单元格弹菜单切换 无/求和/平均/最小/最大/计数/去重计数，按当前视图行（尊重筛选/排序）实时计算，左缘显示总行数 |
| `Scroller.vue` | 自绘横/纵滚动条（thumb 拖拽 + 轨道点击翻页）；垂直条上下附 4 个翻页按钮：横杠+▲ 首页 / ▲ 上一页 / ▼ 下一页 / ▼+横杠 末页 |
| `constants.ts` | 表头 32px、meta 列 80px、chunk 50、拖选上限 100、行高 32（对齐 `rowHeightInPx['1']`） |
| `index.vue` 固定列层级 | 冻结列（fixed）独立绘制层，滚动内容被其不透明背景覆盖 |

## 文件结构

```
nc-table/
├── src/
│   ├── nc-table.js     # 控件本体（UMD，可直接 <script> 引入 / require / import）
│   └── nc-table.css    # 控件样式（编辑器、下拉、滚动条覆盖层）
├── example/
│   ├── index.html      # 用法示例页（内置"操作方法速查"面板 + 事件日志）
│   └── main.js         # 示例脚本（本地模式 + 远程分块模式 + 自定义单元格）
├── 操作指南.md          # 控件操作方法详解（鼠标/键盘/剪贴板/填充/API）
└── test_playwright.py  # 81 项交互回归测试（无头 Chromium）
```

## 快速开始

```html
<link rel="stylesheet" href="src/nc-table.css" />
<div id="grid" style="height: 420px"></div>
<script src="src/nc-table.js"></script>
<script>
  const table = NcTable.mount('#grid', {
    columns: [
      { key: 'id',    title: 'ID',    type: 'number',  width: 80,  fixed: true },
      { key: 'title', title: '标题',   type: 'text',    width: 200, fixed: true },
      { key: 'status', title: '状态',  type: 'select',  width: 150, options: ['todo', 'done'] },
      { key: 'due',   title: '截止日期', type: 'date',  width: 140 },
      { key: 'done',  title: '完成',   type: 'checkbox', width: 100 },
    ],
    rows: [{ id: 1, title: '示例', status: 'todo', due: '2026-09-01', done: false }],
    onCellChange: (e) => console.log('保存单元格', e.rowIndex, e.column.key, e.value),
  })
</script>
```

## 运行示例

无需构建，直接用浏览器打开 `example/index.html`；或本地起一个静态服务器：

```bash
cd nc-table
python -m http.server 8080
# 打开 http://localhost:8080/example/
```

示例包含两个表格：

1. **本地模式**：1,000 行，演示全部内置类型、冻结列、排序（点表头，取消恢复原序）、列宽拖拽、
   区域选择、键盘导航、复制/粘贴（TSV）、填充手柄、行高切换（32/60/90）、
   `addRow / deleteSelected` API，以及注册自定义 `progress` 进度条（可编辑）、`switch` 开关、
   `dlg` 弹框录入（备注列）、`buttons` 操作列（编辑/删除按钮）单元格类型；内置 `datetime` 日期时间列；工具栏一键 `exportExcel` 导出 .xlsx。
2. **远程分块模式**：声明 `loadData` + `totalRows: 50000`，滚动时按 50 行 chunk 异步拉取，
   未加载块显示 loading 占位条（与 nocodb canvas 表格行为一致）。

## API

### 构造 / 挂载

```js
const table = NcTable.mount(el, options)   // el: 选择器或 DOM 节点
new NcTable(el, options)                   // 等价
```

### options

| 选项 | 类型 | 说明 |
|---|---|---|
| `columns` | `Array<Column>` | 列定义：`{ key, title, type, width, fixed, sortable, options, formatter, placeholder, agg }`；`agg` 为底部聚合函数 |
| `rows` | `Array<object>` | 本地数据 |
| `loadData` | `(params) => Promise<rows[]>` | 远程模式，`params = { offset, limit, sort }` |
| `totalRows` | `number` | 远程模式总行数 |
| `rowHeight` / `headerHeight` | `number` | 默认 32 / 32（nocodb 行高档位 32/60/90/120） |
| `showMetaColumn` | `boolean` | 左侧行号+勾选列，默认 true |
| `rowSelection` | `'multiple' \| 'single'` | 行勾选模式，默认 multiple；single 时勾新行自动取消旧行、隐藏表头全选框 |
| `showAggregation` | `boolean` | 常显底部聚合行（footer row，32px）；默认 false，任一列设了 `agg` 也会显示 |
| `readOnly` | `boolean` | 只读模式 |
| `onCellChange` / `onSort` / `onRowAdd` / `onRowsDelete` / `onScroll` ... | 回调 | 事件也可用 `table.on(event, fn)` |

### 实例方法

```js
table.setData(rows)          table.getData()
table.addRow(data)           table.deleteRows([i, ...])   table.deleteSelected()
table.updateCell(row, key, value)
table.sort(colKey)           table.scrollToCell(row, col) table.setRowHeight(60)
table.getSelectedRows()      table.setTotalRows(n)        table.reload()
table.setRowSelection('single'|'multiple')  // 运行时切换行勾选模式（single 收敛已有多选为最小行号）
table.setAggregation(colKey, 'sum'|'avg'|'min'|'max'|'count'|'distinct'|null)  table.getAggregations()  table._computeAgg(col)
table.openSearch()  table.closeSearch()  table.searchNext()  table.searchPrev()  // 查询定位（Ctrl+F，表头浮层）
table.getActiveCell()        table.getSelection()         table.setActiveCell(r, c)
table.copyText()             table.pasteText(tsv)         table.cutSelection()
table.updateColumn(key, patch)  table.hideColumn/showColumn/showAllColumns()  table.deleteColumn/insertColumn()
table.moveColumn(colKey, boundary)  // 拖拽换位同款 API：插入到第 boundary 列之前（冻结列除外）
table.setFilter(key, values|null)  table.getFilters()  table.clearFilters()
table.exportExcel(filename, opts?)  table.buildXlsx(opts?)  // 纯 JS 生成 .xlsx（当前视图/列）
table.focus()                table.destroy()
```

### 事件

`cell-change`、`selection-change`、`row-check`、`row-select`、`row-add`、`rows-delete`、
`sort`、`scroll`、`copy`、`paste`、`column-resize`、`column-resize-end`、`error`、`aggregation`，以及列操作类：`column-menu`、`column-update`、`column-hide`、`column-show`、`column-delete`、`column-insert`、`column-added`、`add-column`、`filter-change`、`column-filter-open`、`column-reorder`、`search`。
同时会以 `nc-table:<event>` CustomEvent 冒泡派发，可在任意祖先节点监听。

### 注册自定义单元格类型

```js
NcTable.registerCellType('progress', {
  editType: 'input-number', // 'input' | 'input-number' | 'input-date' | 'input-datetime' | 'select' | null(只读)
  parse: (raw) => Math.max(0, Math.min(100, Number(raw))), // 编辑/粘贴/填充时的值解析
  render(ctx, p) {
    // p: { x, y, width, height, column, row, rowIndex, value, text }
  },
})
// 列上使用： { key: 'progress', type: 'progress', min: 0, max: 100 }
```

## 交互速查

完整说明见 [操作指南.md](./操作指南.md)。

| 操作 | 行为 |
|---|---|
| 单击单元格 | 设为活动单元格（checkbox 直接切换，select 弹下拉） |
| 拖拽 / Shift+单击 | 区域选择（上限 100 行，边缘自动滚动） |
| 双击 / Enter / F2 / 直接键入 | 进入编辑 |
| Tab / Enter | 提交并右移 / 下移 |
| Esc | 取消编辑 / 收敛选区 |
| Delete / Backspace | 清空选区内容 |
| 方向键 / PageUp/Down / Home / End / Ctrl+Home/End | 导航 |
| Ctrl+C / Ctrl+X / Ctrl+V | 复制 / 剪切 / 粘贴选区（TSV，按列类型解析） |
| 选区右下角紫点下拖 | 填充手柄：重复选区值模式，拖回自动回滚 |
| 单击表头 | 排序（升 → 降 → 取消，取消恢复原序） |
| 表头右侧 ∨ 按钮 / 右键列头 | 列设置菜单（**数据筛选**/重命名/定向排序/冻结/隐藏/前后插入/删除） |
| 数据筛选面板 | 勾选列值过滤（可搜索、全选、多列 AND），筛选列显示漏斗标记；`setFilter/getFilters/clearFilters` |
| 单击末尾 + 列 | 触发 `add-column` 事件（demo 弹窗添加字段） |
| 拖拽表头列边界（8px 热区） | 调整列宽（最小 50px） |
| 左侧勾选框 | 勾选行（表头全选），配合 `getSelectedRows()/deleteSelected()`；`rowSelection:'single'` 则勾新消旧 |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> / `openSearch()` | 查询定位：表头右上浮层按显示文本匹配，全部命中淡黄高亮、当前项橙框，Enter/↑↓ 按钮循环跳转并滚动定位 |
| 滚轮 / Shift+滚轮 / 自绘滚动条 | 横向纵向滚动；远程模式自动按块拉取 |

## 测试

```bash
cd nc-table
python test_playwright.py   # 81 项交互断言（含列设置菜单、自定义类型编辑、操作列按钮、Excel 式数据筛选、datetime/弹框/导出）
```
