# nc-table 会话历史（history.md）

> 工作目录 `D:\ai\no_table`：`nc-table/`（从 nocodb 抽离的零依赖 canvas 表格控件）+ `nocodb-develop/`（原版源码，分析参考用）。
> 记录日期：2026-09-11

## 一、环境

- 静态服务：`python -m http.server 8000`，根目录 `D:\ai\no_table\nc-table`（后台运行中），demo 页 `http://localhost:8000/example/index.html`、`.../tree.html`
- 测试：Playwright + 无头 Chromium（`%LOCALAPPDATA%\ms-playwright\chromium-1217`），Python 3.12；控制台需 `$env:PYTHONIOENCODING='utf-8'`
- 测试套件（全部通过）：
  - `nc-table/test_playwright.py`：**85 项**（含两级菜单、列拖拽换位 4 项）
  - Temp 脚本（本会话新增，可收编入库）：`test_tree.py` 17 项、`test_filter_fix.py` 15 项、`test_tree_filter.py` 8 项

## 二、本会话完成的工作

### 1. 树形表格 Demo（`example/tree.html` + `tree.js`，未改核心）
- 纯 demo 层实现：树模型（节点对象=行对象，带 `__level/__expanded/__parent`）→ 深度优先平铺 → `setData()` 重建
- 自定义 `tree` 单元格：缩进参考线、层级图标（🏢📁👤）、折叠徽标“· N 项”；`onClick` 仅在图标 ±1px 热区命中折叠，其余走默认选择
- 功能：展开/收起全部、添加/删除节点（连子树）、末行占位=加根节点、搜索定位（展开祖先路径）、勾选“完成”级联子孙、约 1600 节点虚拟滚动
- 展开图标迭代史：实心三角 →（用户嫌丑）→ +/- 方框 →（仍不满意）→ **尖括号 chevron（›/⌄，现行）**
- 修复渲染 bug：tree 渲染器漏加 `p.x`（相对坐标当绝对坐标用，内容被行号列盖住）
- 修复筛选 guard bug：原 `filter-change → refresh() → setData()` 会清空筛选（核心 setData 重置 `_filters`）。现 `refresh()` 先 `getFilters()` 后重放 `setFilter()`（带 `reapplying` 防循环），活动行映射改用 `_rowAt/viewIndexOf`；速查文案改为“数据筛选与展开状态共存”

### 2. 显示格式设置（tree demo）
- 基于核心 `updateColumn(key, {formatter})`，formatter 同步作用于渲染/Ctrl+C/筛选选项/Excel 导出（.xlsx 数字列保留原值，编辑器内为原值）
- 新增列：打卡时间(datetime)、预算金额(number)；工具栏“显示格式 ▾”面板：日期 7 式、日期时间 6 式（含仅时间）、金额 6 式（¥千分位/元后缀/美元/万元）、工时 5 式（小数位/带单位/占 40h 周百分比），支持“全部恢复原值”
- 格式库：`fmtDate(pattern)`（正则拆 YYYY-MM-DDTHH:mm 再拼装，MM 先于 mm 替换）、`fmtNumber(dec,prefix,suffix,div)`、`fmtNumberEn`、`fmtWan`、`fmtPctOf40`

### 3. 筛选面板修复（核心 `nc-table.js` `_openFilterPanel`）
用户反馈：搜索“253”只剩 1 值时“全选”误打勾、确定后未筛选。根因与修复：
1. `syncAll()` 原来只统计搜索后可见行 → 改为按**全部值**计算：全勾才打勾，部分勾选=**indeterminate 半选**，文案“全选（N 个值，已选 M）”
2. 面板初始全勾 + 搜索隐藏其余勾选项 → 用户以为只选了 1 项，确定时 allChecked=清空筛选。**新交互：首次搜索自动收缩**——选择集仍为默认全选且未手动干预（`untouched`）时，输入搜索词即把勾选收缩为匹配项（细化查询跟随收缩；手动勾选/取消或已有筛选时不再收缩，可跨搜索累积多选）
3. 曾加“仅选匹配”按钮，后按用户要求**删除**（自动收缩已覆盖该场景）

### 4. 列标题下拉菜单改两级（核心）
- 一级：`数据筛选`、`清除本列筛选`（条件）、`数据排序 ▸`、`字段管理 ▸`、`插入字段 ▸`、`删除字段`
- 二级：数据排序→升序/降序/取消；字段管理→重命名/冻结切换/隐藏/显示隐藏字段(N)；插入字段→前插/后插
- 实现：子菜单挂表格容器（脱离主菜单 overflow 裁剪），mouseenter 展开、mouseleave 250ms 延时收起、点击 toggle、右侧放不下自动左翻；`_closeMenu` 级联关闭；document mousedown 守卫含 `_subMenu.contains`
- CSS：`.nc-table__menu-arrow`、`.nc-table__menu--sub`

### 5. 列拖拽换位（核心，对应 nocodb useColumnReorder）
- 非冻结列表头按下，移动 ≥5px 激活拖拽；被拖列表头紫色高亮 + 目标边界 2px 紫色插入线；松手换位并发 `column-reorder` 事件；未移动松开=点击排序（排序从 mousedown 延后到 mouseup）
- 光标：悬停可拖列头 grab、拖拽中 grabbing（body cursor）
- 公开 API：`table.moveColumn(colKey, boundary)`（插入到第 boundary 列之前，冻结列不参与）
- 顺带修复**存量坐标 bug**：mousedown 里 `canvas.focus()` 在画布底部超出视口时滚动页面，`_pos(e)` 取到偏移坐标（点表头误判为点单元格）。修复：先取坐标再 `focus({preventScroll:true})`；编辑器/重命名输入框 focus 同加 preventScroll

### 6. 其他核心样式调整
- 表格外边框加深：`.nc-table` 加 `border:1px solid #c6cad3` + box-sizing
- select 下拉弹层边线加深：`.nc-table__menu` 不变，`.nc-table__popup` `#d8d0ef → #b3a1e0`
- demo 主页 sub 区加“树形 Demo”入口链接

### 7. nocodb canvas 源码深度分析（4 个并行探索任务，要点）
- **入口**：canvas 版受 feature flag `CANVAS_GRID_VIEW/CANVAS_GROUP_GRID_VIEW` 控制；`index.vue` props 46 个（数据/chunk/分组/行写回调/expandForm 等），emits 仅 2 个，expose 仅 `scrollToRow/openColumnCreate`；编辑器是 DOM overlay（`SmartsheetCell`/`SmartsheetVirtualCell`），`context/Cell.vue` 实为右键菜单（含 insert above/below、AI 生成、批量更新等）
- **渲染**（useCanvasRender 3387 行）：全量重绘无脏矩形；pass 顺序=行→选区→填充柄→表头→列拖影→聚合栏→clip 收尾；未加载行 shimmer 骨架；9 类 LRU 文本缓存 + OffscreenCanvas 测量；SpriteLoader（icon-size-color 精灵缓存）、ImageWindowLoader（无 LRU、失败退避重试 [2,5,8]s）、elementMap 每帧重建做命中测试
- **交互**：粘贴=原生 paste 事件 + papaparse TSV、`ColumnHelper.serializeValue` 按列类型转换、缺 option 自动补选项、矩阵平铺、MAX_ROWS=5000、附件列吃剪贴板文件；**无 Ctrl+X/Ctrl+A/F2/Home/End/Ctrl+D**（Space=打开记录详情！非 checkbox）；填充柄仅垂直、v2 走 `populateFillHandle` 等差/前后缀智能序列；行复选框拖选/矩形选区各限 100；列宽 resize 8px 热区（Attachment min100/Button 100-320）；行拖排序需 order 列+PK+无排序
- **数据**：CHUNK_SIZE=50、首屏 100、缓冲 ±100、预取阈值 50、API 节流 500ms；分组=path 键控二级缓存（组 chunk+行 chunk），`calculateGroupHeight/Range/RowTop` 几何体系；聚合栏 36px；undo/redo=作用域栈（Ctrl+Z / Ctrl+Shift+Z，无 Ctrl+Y），批量操作打包一条记录
- **常量**：表头 32/组头 48+12/行号列 80/行色条 4/新列 60/行高 32|60|90|120（移动 56）/外部源可见 100 行
- 本副本 realtime、脚本执行器、shared uuid 为空壳/缺失；TableMetaLoader/BaseRoleLoader 的 onSettled 传参有 bug（`() => triggerRefreshCanvas` 未调用）

## 三、讨论过但未实现（待用户确认）

1. **`multiSelect` 单元格类型**（一格多值、标签胶囊+下拉勾选、粘贴/导出 `a, b`）——已问“需要我实现吗”，未答复
2. **`rowSelection: 'single'|'multiple'` 行单选配置**——已问，未答复
3. Temp 下 3 个新测试脚本可收编进 `nc-table/`

## 四、踩坑备忘（重要）

- **PS5.1 `Get-Content|Set-Content` 会按 GBK 读写 UTF-8 文件造成不可逆损坏**（曾毁 index.html/tree.html，已重建）。改文件一律用 Edit/Write 工具
- `file://` 页面里 `<script src="x.js?v=1">` 带 query 会导致脚本加载失败（测试套件用 file://），demo 页因此**不加**版本号参数；http 端用户需 Ctrl+F5 强刷拿新 JS/CSS
- 控制台中文乱码是 GBK 显示问题，测试断言用 `PYTHONIOENCODING=utf-8`
- 核心 `setData()` 会重置 `_filters/_view/selectedRows`（树 demo 的筛选保持逻辑即为此设计）
- 自定义 renderer 的 `onClick/cursor` 收到的是**单元格相对坐标**（p 无 value/text）；`render` 的 p 含 value/text 且坐标为绝对——两套坐标系
