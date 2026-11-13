/**
 * NcTable - 独立表格控件（无依赖，原生 JS）
 *
 * 从 nocodb-develop/packages/nc-gui/components/smartsheet/grid/canvas 抽离核心架构：
 *   - useCanvasTable        -> 视口/滚动/活动单元格状态 + requestAnimationFrame 渲染循环
 *   - useCanvasRender       -> canvas 虚拟滚动渲染（仅绘制可视行列）+ dpr 缩放
 *   - utils/canvas.ts       -> truncateText / renderCheckbox / renderTagLabel 文本绘制
 *   - utils/constants.ts    -> 表头 32px、meta 列 80px、chunk 50、拖选上限 100
 *   - cells/index.ts        -> 按类型注册的 CellRenderer 注册表（registerCellType 可扩展）
 *   - useColumnResize.ts    -> 列宽拖拽（8px 热区，最小 50px）
 *   - useMouseSelection.ts  -> 点击/拖拽/Shift 单元格区域选择
 *   - useKeyboardNavigation -> 方向键/Enter/Tab/Esc/Delete/F2 导航编辑
 *   - useCopyPaste.ts       -> Ctrl+C / Ctrl+X / Ctrl+V 剪贴板（TSV）
 *   - useFillHandler.ts     -> 选区右下角填充手柄（向下拖拽复制值模式）
 *   - header/ColumnMenu.vue -> 表头 chevron 按钮 / 右键 -> 列设置菜单（筛选/重命名/排序/冻结/隐藏/删除/前后插入）
 *   - toolbar/Filter + 值选择 -> Excel 式数据筛选面板（值勾选/搜索/多列组合/漏斗标记，远程模式传 filters 参数）
 *   - useDataFetch.ts       -> 分块(chunk)异步加载 + loading 占位
 *   - Scroller.vue          -> 自绘滚动条
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory)
  else if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.NcTable = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // ------------------------------------------------------------ constants
  var HEADER_HEIGHT = 32
  var ROW_HEIGHT = 32 // 对齐 nocodb rowHeightInPx['1']（short 行高）
  var AGG_BAR_HEIGHT = 32 // 底部聚合行高（对应 nocodb AGGREGATION_HEIGHT）
  var CELL_PADDING = 8
  var ROW_META_COLUMN_WIDTH = 80
  var CHUNK_SIZE = 50
  var MAX_SELECTED_ROWS = 100
  var RESIZE_HANDLE_WIDTH = 8
  var MIN_COLUMN_WIDTH = 50
  var ADD_COLUMN_WIDTH = 60

  var FONT_TEXT = '500 13px Inter, ui-sans-serif, system-ui, sans-serif'
  var FONT_HEADER = '600 13px Inter, ui-sans-serif, system-ui, sans-serif'
  var COLOR_TEXT = '#4a5268'
  var COLOR_HEADER_TEXT = '#374151'
  // 默认配色 = nocodb 源码默认（nc-gui themeV3：gray50 #F9F9FA / gray100 #F4F4F5 / gray200 #E7E7E9 / gray300 #D5D5D9）
  var DEFAULT_THEME = {
    grid: '#e7e7e9',        // gray200：单元格/行/表头网格线
    footerGrid: '#e7e7e9',  // 聚合行边框（nocodb 与常规网格线同色）
    bg: '#ffffff',          // 单元格底色
    headerBg: '#f4f4f5',    // gray100：标题行底色
    headerGrid: '#d5d5d9',  // gray300：标题行内线条（同外边框色）
    headerActiveBg: '#e7e7e9', // 活动/选区列标题底色（gray200 加深）
    footerBg: '#f9f9fa',    // gray50：聚合行底色（nocodb renderAggregations 默认）
    gutterBg: '#ffffff',    // 序号列列身（nocodb 与单元格同底）
    fixedBg: '#ffffff',     // 固定列单元格底色（nocodb 白底）
    fixedEdge: '#d5d5d9',   // gray300：固定列区右边界竖线
  }
  var COLOR_ACCENT = '#3366ff'   // nocodb brand500：选区/活动单元格边框、勾选框、漏斗等
  var COLOR_ACCENT_LIGHT = '#f6f7fe' // nocodb 选中行底色
  var COLOR_TAG_TEXT = '#6687b0'
  var COLOR_TAG_BG = '#e7edf3'
  var COLOR_EMPTY_TEXT = '#bbbbc7'

  // ---------------------------------------------------------------- utils
  var measureCanvas = null
  function truncateText(ctx, text, maxWidth, font) {
    if (font) ctx.font = font
    var m = ctx.measureText(text).width
    if (m <= maxWidth) return { text: text, truncated: false, width: m }
    var chars = Math.max(0, Math.floor(text.length - (m - maxWidth) / 3.5))
    while (chars > 0 && ctx.measureText(text.slice(0, chars) + '...').width > maxWidth) chars--
    return { text: chars > 0 ? text.slice(0, chars) + '...' : '...', truncated: true, width: maxWidth }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function drawCheckbox(ctx, cx, cy, checked) {
    var size = 14
    var x = cx - size / 2
    var y = cy - size / 2
    ctx.save()
    roundRect(ctx, x, y, size, size, 3)
    if (checked) {
      ctx.fillStyle = COLOR_ACCENT
      ctx.fill()
    } else {
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.strokeStyle = '#c5c5c5'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.restore()
      return
    }
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x + 3.5, y + 7.5)
    ctx.lineTo(x + 6, y + 10.5)
    ctx.lineTo(x + 10.5, y + 4)
    ctx.stroke()
    ctx.restore()
  }

  function drawTag(ctx, x, y, height, text, forcedW) {
    ctx.save()
    ctx.font = FONT_TEXT
    var pad = 8
    var w = forcedW !== undefined ? forcedW : Math.min(ctx.measureText(text).width + pad * 2, 240)
    var h = 22
    var ty = y + (height - h) / 2
    ctx.fillStyle = COLOR_TAG_BG
    roundRect(ctx, x, ty, w, h, 4)
    ctx.fill()
    ctx.fillStyle = COLOR_TAG_TEXT
    ctx.textBaseline = 'middle'
    var clip = truncateText(ctx, text, w - pad * 2, FONT_TEXT)
    ctx.fillText(clip.text, x + pad, ty + h / 2 + 0.5)
    ctx.restore()
    return w
  }

  function effAlign(col) {
    if (col.align === 'left' || col.align === 'center' || col.align === 'right') return col.align
    return col.type === 'number' || col.type === 'year' ? 'right' : 'left'
  }

  // 按列对齐方式绘制单行文本（垂直居中，水平 left/center/right）
  function drawAligned(ctx, p, text) {
    var a = effAlign(p.column)
    var cy = p.y + p.height / 2 + 0.5
    if (a === 'right') {
      ctx.textAlign = 'right'
      ctx.fillText(text, p.x + p.width - CELL_PADDING, cy)
      ctx.textAlign = 'left'
    } else if (a === 'center') {
      ctx.textAlign = 'center'
      ctx.fillText(text, p.x + p.width / 2, cy)
      ctx.textAlign = 'left'
    } else {
      ctx.fillText(text, p.x + CELL_PADDING, cy)
    }
  }

  // 'YYYY-MM-DD' / 'YYYY/M' / '2026年3月' / Date -> 'YYYY-MM'；无法识别则原样字符串
  function normYearMonth(v) {
    if (v === null || v === undefined || v === '') return ''
    if (v instanceof Date) {
      var dm = v.getMonth() + 1
      return v.getFullYear() + '-' + (dm < 10 ? '0' + dm : dm)
    }
    var s = String(v).trim()
    var m = s.match(/^(\d{4})\D{0,1}(\d{1,2})/)
    if (m) {
      var mo = Number(m[2])
      if (mo >= 1 && mo <= 12) return m[1] + '-' + (mo < 10 ? '0' + mo : '' + mo)
    }
    return s
  }

  function defaultFormatter(value, col) {
    if (value === null || value === undefined || value === '') return ''
    if (col.type === 'year') {
      if (value instanceof Date) return String(value.getFullYear())
      var yn = Number(value)
      return isNaN(yn) ? String(value) : String(Math.trunc(yn))
    }
    if (col.type === 'yearmonth') return normYearMonth(value)
    if (col.type === 'number' && typeof value === 'number' && !isNaN(value)) {
      return value.toLocaleString('en-US', { maximumFractionDigits: 10 })
    }
    if (col.type === 'date' && value instanceof Date) {
      var p = function (n) { return n < 10 ? '0' + n : '' + n }
      return value.getFullYear() + '-' + p(value.getMonth() + 1) + '-' + p(value.getDate())
    }
    if (col.type === 'datetime') {
      var q = function (n) { return n < 10 ? '0' + n : '' + n }
      if (value instanceof Date) {
        return value.getFullYear() + '-' + q(value.getMonth() + 1) + '-' + q(value.getDate()) + ' ' + q(value.getHours()) + ':' + q(value.getMinutes())
      }
      var s = String(value)
      return s.indexOf('T') > 0 ? s.replace('T', ' ').slice(0, 16) : s
    }
    return String(value)
  }

  // ------------------------------------------------- cell renderer registry
  var cellRenderers = {
    text: {
      editType: 'input',
      render: function (ctx, p) {
        if (!p.text) {
          if (p.column.placeholder) {
            ctx.fillStyle = COLOR_EMPTY_TEXT
            ctx.font = FONT_TEXT
            ctx.textBaseline = 'middle'
            var c0 = truncateText(ctx, p.column.placeholder, p.width - CELL_PADDING * 2, FONT_TEXT)
            drawAligned(ctx, p, c0.text)
          }
          return
        }
        ctx.fillStyle = COLOR_TEXT
        ctx.font = FONT_TEXT
        ctx.textBaseline = 'middle'
        var clip = truncateText(ctx, p.text, p.width - CELL_PADDING * 2, FONT_TEXT)
        drawAligned(ctx, p, clip.text)
      },
    },
    number: {
      editType: 'input-number',
      render: function (ctx, p) {
        if (!p.text) return
        ctx.fillStyle = COLOR_TEXT
        ctx.font = FONT_TEXT
        ctx.textBaseline = 'middle'
        var clip = truncateText(ctx, p.text, p.width - CELL_PADDING * 2, FONT_TEXT)
        drawAligned(ctx, p, clip.text)
      },
    },
    checkbox: {
      editType: null,
      render: function (ctx, p) {
        drawCheckbox(ctx, p.x + p.width / 2, p.y + p.height / 2, !!p.value)
      },
    },
    select: {
      editType: 'select',
      render: function (ctx, p) {
        if (!p.text) return
        ctx.font = FONT_TEXT
        var pad = 8
        var w = Math.min(ctx.measureText(p.text).width + pad * 2, 240)
        if (w > p.width - CELL_PADDING * 2) w = p.width - CELL_PADDING * 2
        var a = effAlign(p.column)
        var tx
        if (a === 'right') tx = p.x + p.width - CELL_PADDING - w
        else if (a === 'center') tx = p.x + (p.width - w) / 2
        else tx = p.x + CELL_PADDING
        drawTag(ctx, tx, p.y, p.height, p.text, w)
      },
    },
    date: {
      editType: 'input-date',
      render: function (ctx, p) {
        if (!p.text) return
        ctx.fillStyle = COLOR_TEXT
        ctx.font = FONT_TEXT
        ctx.textBaseline = 'middle'
        var clip = truncateText(ctx, p.text, p.width - CELL_PADDING * 2, FONT_TEXT)
        drawAligned(ctx, p, clip.text)
      },
    },
    datetime: {
      editType: 'input-datetime',
      render: function (ctx, p) {
        if (!p.text) return
        ctx.fillStyle = COLOR_TEXT
        ctx.font = FONT_TEXT
        ctx.textBaseline = 'middle'
        var clip = truncateText(ctx, p.text, p.width - CELL_PADDING * 2, FONT_TEXT)
        drawAligned(ctx, p, clip.text)
      },
    },
    year: {
      editType: 'select-year',
      parse: function (raw) {
        var s = (raw === null || raw === undefined ? '' : String(raw)).trim()
        if (s === '') return null
        var m = s.match(/-?\d{4}/)
        if (!m) return null
        return Number(m[0])
      },
      render: function (ctx, p) {
        if (!p.text) return
        ctx.fillStyle = COLOR_TEXT
        ctx.font = FONT_TEXT
        ctx.textBaseline = 'middle'
        var clip = truncateText(ctx, p.text, p.width - CELL_PADDING * 2, FONT_TEXT)
        drawAligned(ctx, p, clip.text)
      },
    },
    yearmonth: {
      editType: 'input-yearmonth',
      parse: function (raw) {
        var s = (raw === null || raw === undefined ? '' : String(raw)).trim()
        if (s === '') return null
        var norm = normYearMonth(s)
        return /^\d{4}-\d{2}$/.test(norm) ? norm : null
      },
      render: function (ctx, p) {
        if (!p.text) return
        ctx.fillStyle = COLOR_TEXT
        ctx.font = FONT_TEXT
        ctx.textBaseline = 'middle'
        var clip = truncateText(ctx, p.text, p.width - CELL_PADDING * 2, FONT_TEXT)
        drawAligned(ctx, p, clip.text)
      },
    },
  }

  // -------------------------------------------------------------- scrollers
  function Scroller(container, table, vertical) {
    this.table = table
    this.vertical = vertical
    var self = this
    this.el = document.createElement('div')
    this.el.className = 'nc-table__scroller nc-table__scroller--' + (vertical ? 'v' : 'h')
    this.thumb = document.createElement('div')
    this.thumb.className = 'nc-table__thumb'
    this.el.appendChild(this.thumb)
    container.appendChild(this.el)
    this.dragging = false
    this.startPos = 0
    this.startScroll = 0
    this.thumb.addEventListener('mousedown', function (e) {
      e.preventDefault()
      e.stopPropagation()
      self.dragging = true
      self.startPos = vertical ? e.clientY : e.clientX
      self.startScroll = vertical ? table.scrollTop : table.scrollLeft
      document.body.style.userSelect = 'none'
    })
    this.el.addEventListener('mousedown', function (e) {
      if (e.target !== self.el) return
      var rect = self.el.getBoundingClientRect()
      var size = vertical ? rect.height : rect.width
      var pos = vertical ? e.clientY - rect.top : e.clientX - rect.left
      var ratio = pos / size - 0.5
      var max = vertical ? table._maxScrollTop() : table._maxScrollLeftReal()
      if (vertical) table.setScroll(table.scrollTop + ratio * max * 2, table.scrollLeft)
      else table.setScroll(table.scrollTop, table.scrollLeft + ratio * max * 2)
    })
    if (vertical) {
      // 翻页按钮：首页/上一页（顶部）、下一页/末页（底部）；步长=一屏行数-1
      var pageStep = function () {
        var rows = Math.max(1, Math.floor((table._cssH - table.headerHeight) / table.rowHeight) - 1)
        return rows * table.rowHeight
      }
      var mkBtn = function (cls, glyph, title, fn) {
        var b = document.createElement('div')
        b.className = 'nc-table__page-btn ' + cls
        b.textContent = glyph
        b.title = title
        b.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation() })
        b.addEventListener('click', function (e) { e.stopPropagation(); fn() })
        self.el.appendChild(b)
      }
      mkBtn('nc-table__page-btn--first', '', '首页', function () { table.setScroll(0, table.scrollLeft) })
      mkBtn('nc-table__page-btn--prev', '\u25B2', '上一页', function () { table.setScroll(Math.max(0, table.scrollTop - pageStep()), table.scrollLeft) })
      mkBtn('nc-table__page-btn--next', '\u25BC', '下一页', function () { table.setScroll(Math.min(table._maxScrollTop(), table.scrollTop + pageStep()), table.scrollLeft) })
      mkBtn('nc-table__page-btn--last', '', '末页', function () { table.setScroll(table._maxScrollTop(), table.scrollLeft) })
    }
  }

  Scroller.prototype.onMouseMove = function (e) {
    if (!this.dragging) return
    var t = this.table
    var track = this.vertical ? Math.max(40, (this.el.clientHeight || t._viewH) - 72) : Math.max(1, t._cssW - t.GUTTER - t._fixedWidth())
    var thumb = this.vertical ? t._vThumbSize : t._hThumbSize
    var delta = ((this.vertical ? e.clientY : e.clientX) - this.startPos) * (track / Math.max(40, thumb))
    if (this.vertical) t.setScroll(this.startScroll + delta, t.scrollLeft)
    else t.setScroll(t.scrollTop, this.startScroll + delta)
  }

  Scroller.prototype.onMouseUp = function () {
    if (!this.dragging) return
    this.dragging = false
    document.body.style.userSelect = ''
  }

  // -------------------------------------------------------------- NcTable
  function normalizeColumn(c, i) {
    var title = c.title !== undefined ? c.title : String(c.key || i)
    var group = c.group && c.group.key
      ? { key: String(c.group.key), title: c.group.title !== undefined ? String(c.group.title) : String(c.group.key) }
      : null
    // 简化写法：title 用 "组名|列名" 竖线分隔自动分组（仅两级；显式 group 优先）
    if (!group && String(title).indexOf('|') >= 0) {
      var sep = String(title).indexOf('|')
      var gTitle = String(title).slice(0, sep).trim()
      var cTitle = String(title).slice(sep + 1).trim()
      if (gTitle) {
        group = { key: gTitle, title: gTitle }
        title = cTitle
      }
    }
    return {
      key: c.key !== undefined ? c.key : 'col_' + i,
      title: title,
      type: c.type || 'text',
      width: c.width || 200,
      fixed: !!c.fixed,
      sortable: c.sortable !== false,
      options: c.options,
      formatter: c.formatter,
      placeholder: c.placeholder,
      min: c.min,
      max: c.max,
      agg: c.agg || null, // 底部聚合函数：sum|avg|min|max|count|distinct
      group: group, // 标题组（两级表头）
      align: c.align === 'left' || c.align === 'center' || c.align === 'right' ? c.align : null, // 数据对齐：null=按类型默认（number 右对齐，其余左对齐）
    }
  }

  function NcTable(el, options) {
    options = options || {}
    this.options = options

    this.columns = (options.columns || []).map(normalizeColumn)
    this._hiddenCols = []

    this.rowHeight = options.rowHeight || ROW_HEIGHT
    this.headerHeight = options.headerHeight || (this._hasGroups() ? HEADER_HEIGHT * 2 : HEADER_HEIGHT)
    this.showMetaColumn = options.showMetaColumn !== false
    this.readOnly = !!options.readOnly
    // 行勾选模式：'multiple'（默认）| 'single'（单选：勾新行自动取消旧行，隐藏表头全选框）
    this.rowSelection = options.rowSelection === 'single' ? 'single' : 'multiple'
    this.GUTTER = this.showMetaColumn ? ROW_META_COLUMN_WIDTH : 0

    // 配色主题：默认值即 DEFAULT_THEME，可通过 options.theme 覆盖任意键
    this.theme = {
      grid: options.theme && options.theme.grid !== undefined ? options.theme.grid : DEFAULT_THEME.grid,
      footerGrid: options.theme && options.theme.footerGrid !== undefined ? options.theme.footerGrid : DEFAULT_THEME.footerGrid,
      bg: options.theme && options.theme.bg !== undefined ? options.theme.bg : DEFAULT_THEME.bg,
      headerBg: options.theme && options.theme.headerBg !== undefined ? options.theme.headerBg : DEFAULT_THEME.headerBg,
      headerGrid: options.theme && options.theme.headerGrid !== undefined ? options.theme.headerGrid : DEFAULT_THEME.headerGrid,
      headerActiveBg: options.theme && options.theme.headerActiveBg !== undefined ? options.theme.headerActiveBg : DEFAULT_THEME.headerActiveBg,
      footerBg: options.theme && options.theme.footerBg !== undefined ? options.theme.footerBg : DEFAULT_THEME.footerBg,
      gutterBg: options.theme && options.theme.gutterBg !== undefined ? options.theme.gutterBg : DEFAULT_THEME.gutterBg,
      fixedBg: options.theme && options.theme.fixedBg !== undefined ? options.theme.fixedBg : DEFAULT_THEME.fixedBg,
      fixedEdge: options.theme && options.theme.fixedEdge !== undefined ? options.theme.fixedEdge : DEFAULT_THEME.fixedEdge,
    }

    this._remote = typeof options.loadData === 'function'
    this._rows = this._remote ? [] : (options.rows || []).slice()
    this._origRows = this._rows.slice() // 本地模式原始顺序快照（取消排序时恢复）
    this._cachedRows = new Map()
    this._chunkStates = []
    this.totalRows = this._remote ? options.totalRows || 0 : this._rows.length

    this._sort = null
    this._filters = {} // colKey -> [允许值]（null 代表空白），多列 AND
    this._view = null // 本地筛选后的行索引映射；null=不筛选
    this._filterColIndex = null
    this.scrollLeft = 0
    this.scrollTop = 0
    this.activeCell = this.totalRows ? { row: 0, col: 0 } : null
    this.selection = this.activeCell ? { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } } : null
    this.selectedRows = new Set()
    this._rangeSelectedRows = new Set()
    this.editing = null
    this._hoverResizeCol = null
    this._resizeCol = null
    this._dragging = false
    this._fill = null
    this._menuCol = null
    this._currentCol = null // 当前列索引：空数据（无 activeCell）时由表头点击维护
    this._subMenu = null
    this._subTimer = null
    this._colDrag = null
    this._hoverMenuCol = null
    this._renamingCol = null
    this._renamingGroup = null
    this._raf = 0
    this._listeners = {}

    this._mount(el)
  }

  NcTable.registerCellType = function (type, renderer) {
    cellRenderers[type] = renderer
  }

  NcTable.mount = function (el, options) {
    return new NcTable(el, options)
  }

  // 默认配色（可通过 new/mount 的 options.theme 覆盖单项）
  NcTable.DEFAULT_THEME = DEFAULT_THEME
  // 构建版本标记：排查浏览器缓存旧代码用（控制台/日志可见）
  NcTable.VERSION = '2026-09-12.2 (xlsx sheetViews-order + align styles)'

  NcTable.prototype._mount = function (el) {
    var self = this
    if (typeof el === 'string') el = document.querySelector(el)
    if (!el) throw new Error('[NcTable] mount target not found')
    this.el = el
    this._nc_table_prev = el._ncTable
    el._ncTable = this
    el.classList.add('nc-table')

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'nc-table__canvas'
    this.canvas.tabIndex = 0
    el.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.editor = document.createElement('input')
    this.editor.className = 'nc-table__editor'
    this.editor.style.display = 'none'
    el.appendChild(this.editor)

    this.popup = document.createElement('ul')
    this.popup.className = 'nc-table__popup'
    this.popup.style.display = 'none'
    el.appendChild(this.popup)

    // 列设置菜单（对应 nocodb SmartsheetHeaderColumnMenu）
    this.menu = document.createElement('div')
    this.menu.className = 'nc-table__menu'
    this.menu.style.display = 'none'
    el.appendChild(this.menu)

    // 表头重命名输入框（对应 EditColumn 的简化版）
    this.rename = document.createElement('input')
    this.rename.className = 'nc-table__rename'
    this.rename.style.display = 'none'
    el.appendChild(this.rename)

    // 数据筛选面板（Excel 式值勾选，对应 toolbar/Filter 的列级简化）
    this.fpanel = document.createElement('div')
    this.fpanel.className = 'nc-table__filter'
    this.fpanel.style.display = 'none'
    el.appendChild(this.fpanel)

    // 查询定位条（浮在列标题上的一层，对应 nocodb toolbar/SearchData 的简化版）
    this.searchBar = document.createElement('div')
    this.searchBar.className = 'nc-table__search'
    this.searchBar.style.display = 'none'
    el.appendChild(this.searchBar)
    this._search = { query: '', matches: [], index: -1 }
    this._searchDirty = false
    this._buildSearchBar()

    this.vScroller = new Scroller(el, this, true)
    this.hScroller = new Scroller(el, this, false)

    this._onWinMouseMove = function (e) {
      self.vScroller.onMouseMove(e)
      self.hScroller.onMouseMove(e)
      self._onResizeMove(e)
      self._onFillMove(e)
      self._onColDragMove(e)
    }
    this._onWinMouseUp = function (e) {
      self.vScroller.onMouseUp()
      self.hScroller.onMouseUp()
      self._onResizeEnd()
      self._onFillEnd()
      self._onColDragEnd()
      if (self._dragging === 'select') self._dragging = false
    }
    this._onDocMouseDown = function (e) {
      if (self.popup.style.display === 'block' && !self.popup.contains(e.target)) self._closePopup()
      if (self.fpanel.style.display === 'block' && !self.fpanel.contains(e.target)) self._closeFilterPanel()
      if (self.menu.style.display === 'block' && !self.menu.contains(e.target) && !(self._subMenu && self._subMenu.contains(e.target))) {
        // 点击当前已开菜单列的 chevron 不在此处关闭，交给 canvas 处理器做 toggle
        var keep = false
        if (e.target === self.canvas && self._menuCol !== null) {
          var pos = self._pos(e)
          keep = self._hitHeaderDropdown(pos.x, pos.y) === self._menuCol
        }
        if (!keep) self._closeMenu()
      }
    }
    this._onResize = function () { self._resize() }
    window.addEventListener('mousemove', this._onWinMouseMove)
    window.addEventListener('mouseup', this._onWinMouseUp)
    window.addEventListener('resize', this._onResize)
    document.addEventListener('mousedown', this._onDocMouseDown, true)

    this._bindCanvasEvents()
    this._bindEditorEvents()
    this._bindRenameEvents()
    this._bindKeyboard()

    this._resize()
    this._ensureChunksLoaded(0, CHUNK_SIZE)
    this.canvas.focus({ preventScroll: true }) // 挂载即聚焦，但不得抢滚动（多表同页时后者会把页面拽走）

    if (this.options.onReady) this.options.onReady(this)
  }

  // ---------------------------------------------------------- data api
  NcTable.prototype._rowAt = function (i) {
    if (this._remote) return this._cachedRows.get(i)
    return this._rows[this._view ? this._view[i] : i]
  }

  NcTable.prototype._filterAllows = function (col, v) {
    var allowed = this._filters[col.key]
    var isBlank = v === null || v === undefined || v === ''
    for (var i = 0; i < allowed.length; i++) {
      var a = allowed[i]
      if (a === null) { if (isBlank) return true; continue }
      if (!isBlank && a === v) return true
    }
    return false
  }

  // 依据当前筛选重建行视图（仅本地模式；远程模式由服务端按 filters 参数返回）
  NcTable.prototype._rebuildView = function () {
    this._searchDirty = true
    if (this._remote) return
    var keys = Object.keys(this._filters)
    if (!keys.length && !this._view) {
      this.totalRows = this._rows.length
      return
    }
    if (!keys.length) {
      this._view = null
    } else {
      var view = []
      for (var i = 0; i < this._rows.length; i++) {
        var row = this._rows[i], ok = true
        for (var k = 0; k < keys.length; k++) {
          var col = this._colByKey(keys[k])
          if (!col) continue
          if (!this._filterAllows(col, row[col.key])) { ok = false; break }
        }
        if (ok) view.push(i)
      }
      this._view = view
    }
    this.totalRows = this._view ? this._view.length : this._rows.length
    this.selectedRows.clear()
    this._rangeSelectedRows.clear()
    if (!this.totalRows) { this.activeCell = null; this.selection = null }
    else this._clampActive()
    this._clampScroll()
    this.scheduleRender()
  }

  NcTable.prototype.setFilter = function (colKey, values) {
    if (values === null || values === undefined) delete this._filters[colKey]
    else this._filters[colKey] = values.slice()
    if (this._remote) this.reload()
    else this._rebuildView()
    this._emit('filter-change', {
      column: this._colByKey(colKey),
      values: this._filters[colKey] ? this._filters[colKey].slice() : null,
      filters: this.getFilters(),
    })
  }

  NcTable.prototype.getFilters = function () {
    var out = []
    for (var k in this._filters) out.push({ key: k, values: this._filters[k].slice() })
    return out
  }

  NcTable.prototype.clearFilters = function () {
    this._filters = {}
    if (this._remote) this.reload()
    else this._rebuildView()
    this._emit('filter-change', { column: null, values: null, filters: [] })
  }

  // 收集列去重值（远程模式仅统计已缓存块；全量去重应由服务端提供，见文档）
  NcTable.prototype._collectColumnValues = function (col) {
    var map = {}, out = []
    var rows = this._remote ? Array.from(this._cachedRows.values()) : this._rows
    rows.forEach(function (row) {
      var v = row[col.key]
      var isBlank = v === null || v === undefined || v === ''
      var key = isBlank ? '\u0000b' : typeof v + ':' + String(v)
      if (key in map) return
      map[key] = true
      out.push({
        raw: isBlank ? null : v, key: key,
        label: isBlank ? '(空白)' : (col.formatter ? col.formatter(v, col, row) : defaultFormatter(v, col)),
      })
    })
    out.sort(function (a, b) {
      if (a.raw === null) return 1
      if (b.raw === null) return -1
      if (typeof a.raw === 'number' && typeof b.raw === 'number') return a.raw - b.raw
      return String(a.raw).localeCompare(String(b.raw))
    })
    return out
  }

  NcTable.prototype.setData = function (rows) {
    this._remote = false
    this.options.loadData = undefined
    this._rows = rows.slice()
    this._origRows = this._rows.slice()
    this._filters = {}
    this._view = null
    this.totalRows = this._rows.length
    this._searchDirty = true
    if (!this.totalRows) { this.activeCell = null; this.selection = null; this.selectedRows.clear(); this._rangeSelectedRows.clear() }
    else this._clampActive()
    this._clampScroll()
    this.scheduleRender()
  }

  NcTable.prototype.getData = function () {
    if (!this._remote) return this._rows.slice()
    var out = []
    this._cachedRows.forEach(function (r) { out.push(r) })
    return out
  }

  NcTable.prototype.setTotalRows = function (n) {
    this.totalRows = n
    this._clampScroll()
    this.scheduleRender()
  }

  // 行高切换（对应 nocodb RowHeight 工具栏：32 / 60 / 90 / 120）
  NcTable.prototype.setRowHeight = function (px) {
    this.rowHeight = px
    this._clampScroll()
    this.scheduleRender()
  }

  NcTable.prototype.addRows = function (rows, total) {
    if (!this._remote) return
    var base = this._rows.length
    for (var i = 0; i < rows.length; i++) this._rows.push(rows[i])
    var self = this
    rows.forEach(function (r, i) { self._cachedRows.set(base + i, r) })
    if (total !== undefined) this.totalRows = total
    this._clampScroll()
    this.scheduleRender()
  }

  NcTable.prototype.addRow = function (data) {
    if (this._remote) throw new Error('[NcTable] addRow only supported in local mode')
    this._searchDirty = true
    var row = data || {}
    this._rows.push(row)
    this._origRows.push(row)
    var srcIdx = this._rows.length - 1
    if (Object.keys(this._filters).length) {
      this._rebuildView()
    } else {
      this.totalRows = this._rows.length
      this.scheduleRender()
    }
    var viewIdx = this._view ? this._view.indexOf(srcIdx) : srcIdx
    this._emit('row-add', { row: row, index: viewIdx })
    return viewIdx
  }

  NcTable.prototype.deleteRows = function (indexes) {
    if (this._remote) throw new Error('[NcTable] deleteRows only supported in local mode')
    var self = this
    var set = {}
    indexes.forEach(function (i) { set[self._view ? self._view[i] : i] = true }) // 视图索引 -> 源索引
    var doomed = this._rows.filter(function (r, i) { return set[i] })
    this._rows = this._rows.filter(function (r, i) { return !set[i] })
    this._origRows = this._origRows.filter(function (r) { return doomed.indexOf(r) === -1 })
    this.totalRows = this._view ? 0 : this._rows.length
    this.selectedRows.clear()
    this._rangeSelectedRows.clear()
    this._rebuildView()
    if (!this.totalRows) { this.activeCell = null; this.selection = null }
    else this._clampActive()
    this.scheduleRender()
    this._emit('rows-delete', { indexes: Array.from(Object.keys(set), Number) })
  }

  NcTable.prototype.deleteSelected = function () {
    this.deleteRows(Array.from(this.selectedRows).sort(function (a, b) { return a - b }))
  }

  NcTable.prototype.updateCell = function (rowIndex, colKey, value, meta) {
    var row = this._rowAt(rowIndex)
    if (!row) return
    var prev = row[colKey]
    var next = meta && meta.toggle ? !prev : value
    if (prev === next && !(prev === null && next === null)) return
    row[colKey] = next
    this._emit('cell-change', { row: row, rowIndex: rowIndex, column: this._colByKey(colKey), prev: prev, value: next })
    this.scheduleRender()
  }

  NcTable.prototype._colByKey = function (key) {
    for (var i = 0; i < this.columns.length; i++) if (this.columns[i].key === key) return this.columns[i]
    return null
  }

  NcTable.prototype.getColumns = function () {
    return this.columns.map(function (c) { return Object.assign({}, c) })
  }

  NcTable.prototype.getSelectedRows = function () {
    var self = this
    return Array.from(this.selectedRows).sort(function (a, b) { return a - b }).map(function (i) {
      return { index: i, row: self._rowAt(i) }
    })
  }

  NcTable.prototype.reload = function () {
    if (!this._remote) return this.scheduleRender()
    this._cachedRows.clear()
    this._chunkStates = []
    this._searchDirty = true
    this.scheduleRender()
    var vr = this._visibleRows()
    this._ensureChunksLoaded(vr.first, vr.last)
  }

  NcTable.prototype.focus = function () {
    this.canvas.focus()
  }

  // ------------------------------------------------------- chunked fetch
  NcTable.prototype._chunkIndex = function (row) { return Math.floor(row / CHUNK_SIZE) }

  NcTable.prototype._ensureChunksLoaded = function (startRow, endRow) {
    if (!this._remote || this.options.loadData === undefined) return
    var c0 = this._chunkIndex(Math.max(0, startRow))
    var c1 = this._chunkIndex(Math.max(0, Math.min(endRow, Math.max(0, this.totalRows - 1))))
    if (c1 < c0) return
    var self = this
    for (var c = c0; c <= c1; c++) {
      if (this._chunkStates[c] === 'loading' || this._chunkStates[c] === 'loaded') continue
      this._chunkStates[c] = 'loading'
      ;(function (chunkId, offset) {
        Promise.resolve(self.options.loadData({
          offset: offset,
          limit: CHUNK_SIZE,
          sort: self._sort ? Object.assign({}, self._sort) : undefined,
          filters: self.getFilters().length ? self.getFilters() : undefined,
        })).then(function (rows) {
          for (var i = 0; i < rows.length; i++) self._cachedRows.set(offset + i, rows[i])
          self._chunkStates[chunkId] = 'loaded'
          self.scheduleRender()
        }).catch(function (err) {
          self._chunkStates[chunkId] = undefined
          self._emit('error', err)
        })
      })(c, c * CHUNK_SIZE)
    }
  }

  // ------------------------------------------------------------ sorting
  NcTable.prototype.sort = function (colKey, dir) {
    if (this.options.sortable === false) return // 表级关闭排序（如树形表，排序会破坏层级）
    var col = this._colByKey(colKey)
    if (!col || !col.sortable) return
    var cycle
    if (dir === 'asc' || dir === 'desc') cycle = dir
    else if (dir === null) cycle = null
    else if (!this._sort || this._sort.key !== colKey) cycle = 'asc'
    else if (this._sort.asc) cycle = 'desc'
    else cycle = null

    if (!cycle) {
      this._sort = null
      if (!this._remote) this._rows = this._origRows.slice() // 取消排序恢复原始顺序（nocodb 为向服务端重新拉取）
      else this.reload()
    } else {
      this._sort = { key: colKey, asc: cycle === 'asc' }
      if (!this._remote) {
        var sign = this._sort.asc ? 1 : -1
        this._rows = this._origRows.slice().sort(function (a, b) {
          var va = a[colKey], vb = b[colKey]
          if (va === vb) return 0
          if (va === null || va === undefined || va === '') return 1
          if (vb === null || vb === undefined || vb === '') return -1
          return (va > vb ? 1 : -1) * sign
        })
      } else {
        this.reload()
      }
    }
    this._emit('sort', { column: col, direction: cycle })
    this.commitEdit()
    if (!this._remote) this._rebuildView()
    this.scheduleRender()
  }

  // -------------------------------------------------- footer 聚合行（对应 nocodb renderAggregations 简化版）
  var AGG_FNS = [['', '无'], ['sum', '求和'], ['avg', '平均'], ['min', '最小值'], ['max', '最大值'], ['count', '计数'], ['distinct', '去重计数']]
  var AGG_PREFIX = { sum: '和', avg: '均', min: '小', max: '大', count: '数', distinct: '异' }

  NcTable.prototype._anyAgg = function () {
    for (var i = 0; i < this.columns.length; i++) if (this.columns[i].agg) return true
    return false
  }
  NcTable.prototype._footerH = function () {
    return this.options.showAggregation || this._anyAgg() ? AGG_BAR_HEIGHT : 0
  }

  NcTable.prototype.setAggregation = function (colKey, fn) {
    var col = this._colByKey(colKey)
    if (!col) return
    col.agg = fn || null
    this.scheduleRender()
    this._emit('aggregation', { column: col, fn: col.agg, value: col.agg ? this._computeAgg(col) : null })
  }

  NcTable.prototype.getAggregations = function () {
    var out = {}
    this.columns.forEach(function (c) { if (c.agg) out[c.key] = c.agg })
    return out
  }

  // 按当前视图行（尊重筛选/排序）计算；远程模式仅统计已加载行
  NcTable.prototype._computeAgg = function (col, fn) {
    fn = fn || col.agg
    if (!fn) return null
    var i, row, v
    if (fn === 'count' || fn === 'distinct') {
      var c = 0
      var set = fn === 'distinct' ? {} : null
      for (i = 0; i < this.totalRows; i++) {
        row = this._rowAt(i)
        v = row && row[col.key]
        if (v === null || v === undefined || v === '') continue
        c++
        if (set) set[String(v)] = 1
      }
      return set ? Object.keys(set).length : c
    }
    var sum = 0, cnt = 0, min = null, max = null
    for (i = 0; i < this.totalRows; i++) {
      row = this._rowAt(i)
      v = row && row[col.key]
      var num = typeof v === 'number' ? v : v === '' || v === null || v === undefined ? NaN : Number(v)
      if (isNaN(num)) continue
      sum += num
      cnt++
      if (min === null || num < min) min = num
      if (max === null || num > max) max = num
    }
    if (!cnt) return null
    if (fn === 'sum') return sum
    if (fn === 'avg') return sum / cnt
    if (fn === 'min') return min
    if (fn === 'max') return max
    return null
  }

  NcTable.prototype._renderAggBar = function (ctx) {
    var fh = this._footerH()
    if (!fh) return
    var y = this._cssH - fh
    ctx.fillStyle = this.theme.footerBg
    ctx.fillRect(0, y, this._cssW, fh)
    ctx.strokeStyle = this.theme.footerGrid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(this._cssW, y + 0.5)
    ctx.stroke()
    if (this.showMetaColumn) {
      ctx.fillStyle = '#6f7982'
      ctx.font = '600 11px Inter, ui-sans-serif, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      ctx.fillText(this.totalRows + ' 行', this.GUTTER / 2, y + fh / 2 + 0.5)
      ctx.textAlign = 'left'
    }
    var i
    for (i = 0; i < this.columns.length; i++) if (!this.columns[i].fixed) this._renderAggCell(ctx, i, this._colX(i), y, fh)
    var x = this.GUTTER
    for (i = 0; i < this.columns.length; i++) {
      if (!this.columns[i].fixed) continue
      this._renderAggCell(ctx, i, x, y, fh)
      x += this.columns[i].width
    }
  }

  NcTable.prototype._renderAggCell = function (ctx, colIndex, x, y, fh) {
    var col = this.columns[colIndex]
    var w = col.width
    ctx.strokeStyle = this.theme.footerGrid
    ctx.beginPath()
    ctx.moveTo(x + w - 0.5, y + 4)
    ctx.lineTo(x + w - 0.5, y + fh - 4)
    ctx.stroke()
    if (!col.agg) return
    var v = this._computeAgg(col)
    var text = v === null ? '-' : (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v))
    ctx.textBaseline = 'middle'
    ctx.font = '600 12px Inter, ui-sans-serif, sans-serif'
    var vw = ctx.measureText(text).width
    var prefix = AGG_PREFIX[col.agg] || ''
    ctx.font = '400 10px Inter, ui-sans-serif, sans-serif'
    var pw = ctx.measureText(prefix).width
    var total = pw + 4 + vw
    if (total > w - CELL_PADDING * 2) { prefix = ''; pw = 0; total = vw }
    var rx = x + w - CELL_PADDING
    ctx.fillStyle = '#9aa0ab'
    ctx.font = '400 10px Inter, ui-sans-serif, sans-serif'
    ctx.textAlign = 'right'
    if (prefix) ctx.fillText(prefix, rx - vw - 4, y + fh / 2 + 0.5)
    ctx.fillStyle = v === null ? '#bbbbc7' : '#4a5268'
    ctx.font = '600 12px Inter, ui-sans-serif, sans-serif'
    ctx.fillText(text, rx, y + fh / 2 + 0.5)
    ctx.textAlign = 'left'
  }

  NcTable.prototype._openAggMenu = function (colIndex) {
    var self = this
    var col = this.columns[colIndex]
    if (!col) return
    this._closePopup()
    this._cancelRename()
    this._closeSub()
    this._menuCol = colIndex
    var m = this.menu
    m.innerHTML = ''
    AGG_FNS.forEach(function (f) {
      var d = document.createElement('div')
      d.className = 'nc-table__menu-item' + ((col.agg || '') === f[0] ? ' is-active' : '')
      d.textContent = f[1]
      d.addEventListener('mousedown', function (e) {
        e.preventDefault()
        e.stopPropagation()
        self._closeMenu()
        self.setAggregation(col.key, f[0] || null)
      })
      m.appendChild(d)
    })
    m.style.display = 'block'
    var mw = m.offsetWidth || 150
    var left = Math.max(0, Math.min(this._colX(colIndex), this._cssW - mw - 2))
    m.style.left = left + 'px'
    m.style.top = Math.max(this.headerHeight + 2, this._cssH - this._footerH() - m.offsetHeight - 6) + 'px'
    this._emit('column-menu', { column: col, index: colIndex })
  }

  // ------------------------------------------- 列拖拽换位（对应 useColumnReorder + renderColumnDragIndicator）
  NcTable.prototype._firstScrollCol = function () {
    for (var i = 0; i < this.columns.length; i++) if (!this.columns[i].fixed) return i
    return this.columns.length
  }

  NcTable.prototype._onColDragMove = function (e) {
    var d = this._colDrag
    if (!d) return
    var p = this._pos(e)
    if (!d.active) {
      if (Math.abs(p.x - d.startX) < 5) return // 未超过阈值：仍视为潜在点击
      d.active = true
      this.commitEdit()
      this._closeMenu()
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'
    }
    var first = this._firstScrollCol()
    var t = first
    for (var i = first; i < this.columns.length; i++) {
      var mid = this._colX(i) + this.columns[i].width / 2
      if (p.x < mid) { t = i; break }
      t = i + 1
    }
    d.overIndex = Math.max(first, Math.min(t, this.columns.length))
    this.scheduleRender()
  }

  NcTable.prototype._onColDragEnd = function () {
    var d = this._colDrag
    if (!d) return
    this._colDrag = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (d.active) {
      this.moveColumn(this.columns[d.colIndex].key, d.overIndex)
    } else {
      this.sort(this.columns[d.colIndex].key) // 未移动 = 点击排序（原 mousedown 语义延后到 mouseup）
    }
  }

  // 将列移动到边界位置 boundary（插入到当前第 boundary 列之前；冻结列不参与拖序）
  NcTable.prototype.moveColumn = function (colKey, boundary) {
    var from = -1
    for (var i = 0; i < this.columns.length; i++) if (this.columns[i].key === colKey) { from = i; break }
    if (from < 0) return
    var col = this.columns[from]
    if (col.fixed) return
    var first = this._firstScrollCol()
    var t = Math.max(first, Math.min(boundary, this.columns.length))
    if (t === from || t === from + 1) return // 落点即原位
    var insertAt = t > from ? t - 1 : t
    this.columns.splice(from, 1)
    this.columns.splice(insertAt, 0, col)
    this._clampActive()
    this.scheduleRender()
    this._emit('column-reorder', { column: col, from: from, to: insertAt })
  }

  // ------------------------------------------------------------ geometry
  NcTable.prototype._fixedCols = function () { return this.columns.filter(function (c) { return c.fixed }) }
  NcTable.prototype._fixedWidth = function () {
    return this._fixedCols().reduce(function (w, c) { return w + c.width }, 0)
  }
  NcTable.prototype._hasGroups = function () {
    for (var i = 0; i < this.columns.length; i++) if (this.columns[i].group) return true
    return false
  }
  NcTable.prototype._groupH = function () { return this._hasGroups() ? HEADER_HEIGHT : 0 }
  // 相邻同组列合并为组带段：{ colIndex, endIndex, group, x0, x1 }
  NcTable.prototype._groupSpans = function () {
    var spans = [], i = 0
    while (i < this.columns.length) {
      var g = this.columns[i].group
      if (!g) { i++; continue }
      var j = i
      while (j + 1 < this.columns.length && this.columns[j + 1].group && this.columns[j + 1].group.key === g.key) j++
      spans.push({ colIndex: i, endIndex: j, group: g, x0: this._colX(i), x1: this._colX(j) + this.columns[j].width })
      i = j + 1
    }
    return spans
  }
  NcTable.prototype._hitGroupBand = function (x) {
    var spans = this._groupSpans()
    for (var s = 0; s < spans.length; s++) if (x >= spans[s].x0 && x < spans[s].x1) return spans[s].colIndex
    return -1
  }
  NcTable.prototype._totalWidth = function () {
    return this.GUTTER + this.columns.reduce(function (w, c) { return w + c.width }, 0) + ADD_COLUMN_WIDTH
  }

  NcTable.prototype._colX = function (i) {
    var x = this.GUTTER
    var k, c
    for (k = 0; k < i; k++) {
      c = this.columns[k]
      if (c.fixed) x += c.width
    }
    var fixedEnd = x
    if (this.columns[i].fixed) return fixedEnd
    x = this.GUTTER + this._fixedWidth() - this.scrollLeft
    for (k = 0; k < i; k++) if (!this.columns[k].fixed) x += this.columns[k].width
    return x
  }

  NcTable.prototype._rowY = function (i) {
    return this.headerHeight + i * this.rowHeight - this.scrollTop
  }

  NcTable.prototype._visibleRows = function () {
    var first = Math.max(0, Math.floor(this.scrollTop / this.rowHeight))
    var last = Math.max(first, Math.ceil((this.scrollTop + this._viewH) / this.rowHeight))
    return { first: first, last: Math.min(last, this.totalRows) }
  }

  NcTable.prototype._visibleCols = function () {
    var minX = this.GUTTER + this._fixedWidth()
    var acc = minX - this.scrollLeft
    var first = 0, i
    for (i = 0; i < this.columns.length; i++) {
      if (this.columns[i].fixed) { first = i + 1; continue }
      if (acc + this.columns[i].width > minX) break
      acc += this.columns[i].width
      first = i + 1
    }
    for (; i < this.columns.length; i++) {
      if (this.columns[i].fixed) continue
      acc += this.columns[i].width
      if (acc > this._cssW) break
    }
    return { first: first, last: Math.min(i + 1, this.columns.length) }
  }

  NcTable.prototype._maxScrollTop = function () {
    return Math.max(0, (this.totalRows + (this._remote ? 0 : 1)) * this.rowHeight - this._viewH)
  }

  NcTable.prototype._maxScrollLeftReal = function () {
    return Math.max(0, this._totalWidth() - this._cssW)
  }

  NcTable.prototype._clampScroll = function () {
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, this._maxScrollTop()))
    this.scrollLeft = Math.max(0, Math.min(this.scrollLeft, this._maxScrollLeftReal()))
  }

  NcTable.prototype._clampActive = function () {
    if (!this.activeCell || !this.totalRows) return
    var r = Math.max(0, Math.min(this.activeCell.row, this.totalRows - 1))
    var c = Math.max(0, Math.min(this.activeCell.col, this.columns.length - 1))
    this.setActiveCell(r, c)
  }

  NcTable.prototype.cellRect = function (row, col) {
    return { x: this._colX(col), y: this._rowY(row), width: this.columns[col].width, height: this.rowHeight }
  }

  NcTable.prototype.setScroll = function (top, left) {
    var newTop = Math.max(0, Math.min(top, this._maxScrollTop()))
    var newLeft = Math.max(0, Math.min(left, this._maxScrollLeftReal()))
    if (newTop === this.scrollTop && newLeft === this.scrollLeft) return
    this.scrollTop = newTop
    this.scrollLeft = newLeft
    this.commitEdit()
    if (this._menuCol !== null) this._closeMenu()
    if (this._filterColIndex !== null) this._closeFilterPanel()
    var vr = this._visibleRows()
    this._ensureChunksLoaded(vr.first, vr.last)
    this._emit('scroll', { scrollTop: this.scrollTop, scrollLeft: this.scrollLeft })
    this.scheduleRender()
  }

  NcTable.prototype.scrollToCell = function (row, col) {
    var top = row * this.rowHeight
    if (top < this.scrollTop) this.setScroll(top, this.scrollLeft)
    else if (top + this.rowHeight > this.scrollTop + this._viewH) this.setScroll(top + this.rowHeight - this._viewH, this.scrollLeft)

    var c = this.columns[col]
    if (c.fixed) return
    var viewLeft = this.GUTTER + this._fixedWidth()
    var x = this._colX(col)
    if (x < viewLeft) this.setScroll(this.scrollTop, this.scrollLeft - (viewLeft - x))
    else if (x + c.width > this._cssW) this.setScroll(this.scrollTop, this.scrollLeft + (x + c.width - this._cssW))
  }

  // -------------------------------------------------------- selection api
  NcTable.prototype.setActiveCell = function (row, col) {
    this.activeCell = { row: row, col: col }
    this.selection = { start: { row: row, col: col }, end: { row: row, col: col } }
    this._updateRangeSelectedRows()
    this._emit('selection-change', { active: this.activeCell, range: this.selection })
  }

  NcTable.prototype._updateRangeSelectedRows = function () {
    this._rangeSelectedRows.clear()
    if (!this.selection) return
    var r0 = Math.min(this.selection.start.row, this.selection.end.row)
    var r1 = Math.max(this.selection.start.row, this.selection.end.row)
    for (var r = r0; r <= r1; r++) this._rangeSelectedRows.add(r)
  }

  // 选区矩形（画布坐标），供区域描边 / 填充手柄共用
  NcTable.prototype._selectionRect = function () {
    var sel = this.selection
    if (!sel || !this.activeCell || !this.totalRows) return null
    var r0 = Math.max(0, Math.min(sel.start.row, sel.end.row))
    var r1 = Math.min(this.totalRows - 1, Math.max(sel.start.row, sel.end.row))
    var c0 = Math.min(sel.start.col, sel.end.col)
    var c1 = Math.max(sel.start.col, sel.end.col)
    var left = Infinity, right = -Infinity
    for (var c = c0; c <= c1; c++) {
      left = Math.min(left, this._colX(c))
      right = Math.max(right, this._colX(c) + this.columns[c].width)
    }
    return { left: left, right: right, top: this._rowY(r0), bottom: this._rowY(r1) + this.rowHeight, r0: r0, r1: r1, c0: c0, c1: c1 }
  }

  NcTable.prototype.getActiveCell = function () {
    return this.activeCell ? { row: this.activeCell.row, col: this.activeCell.col } : null
  }

  // 当前列：有数据取活动单元格所在列；空数据取最近一次点击表头的列
  NcTable.prototype.getActiveColumn = function () {
    var i = this.activeCell ? this.activeCell.col : this._currentCol
    return i === null || i === undefined || !this.columns[i] ? null : this.columns[i]
  }

  NcTable.prototype._setCurrentCol = function (colIndex) {
    var changed = this._currentCol !== colIndex
    this._currentCol = colIndex
    this._emit('column-click', { column: this.columns[colIndex], index: colIndex })
    if (changed) this.scheduleRender()
  }

  NcTable.prototype.getSelection = function () {
    if (!this.selection) return null
    var q = this._selectionRect()
    return q ? { startRow: q.r0, endRow: q.r1, startCol: q.c0, endCol: q.c1 } : null
  }

  // -------------------------------------------------- copy / paste（useCopyPaste）
  // 选区 -> TSV 文本（使用列 formatter 的显示文本，与 nocodb 复制显示值一致）
  NcTable.prototype.copyText = function () {
    var q = this._selectionRect()
    if (!q) return null
    var lines = []
    for (var r = q.r0; r <= q.r1; r++) {
      var row = this._rowAt(r)
      var cells = []
      for (var c = q.c0; c <= q.c1; c++) {
        var col = this.columns[c]
        if (!row) { cells.push(''); continue }
        var v = row[col.key]
        if (col.type === 'checkbox') { cells.push(v ? 'true' : 'false'); continue }
        cells.push(v === null || v === undefined ? '' : (col.formatter ? col.formatter(v, col, row) : defaultFormatter(v, col)))
      }
      lines.push(cells.join('\t'))
    }
    return lines.join('\n')
  }

  // 按列类型把剪贴板字符串解析为单元格值（renderer.parse 可被自定义类型覆盖）
  NcTable.prototype._coerceValue = function (col, raw) {
    var renderer = cellRenderers[col.type] || cellRenderers.text
    if (renderer.parse) { try { return renderer.parse(raw, col) } catch (e) { return raw } }
    var s = (raw === null || raw === undefined ? '' : String(raw)).trim()
    if (col.type === 'number') {
      if (s === '') return null
      var n = Number(s.replace(/,/g, ''))
      return isNaN(n) ? s : n
    }
    if (col.type === 'checkbox') return /^(true|1|yes|y|x|✓)$/i.test(s)
    if (col.type === 'select' && col.options) {
      var key = s.toLowerCase()
      for (var i = 0; i < col.options.length; i++) {
        var opt = col.options[i]
        var val = typeof opt === 'object' ? opt.value : opt
        var label = typeof opt === 'object' ? opt.label : opt
        if (String(val).toLowerCase() === key || String(label).toLowerCase() === key) return val
      }
    }
    return s === '' ? null : s
  }

  // 从活动单元格开始粘贴 TSV（超出数据范围的部分忽略）
  NcTable.prototype.pasteText = function (text) {
    if (this.readOnly || !this.activeCell || !text) return 0
    var a = this.activeCell
    var lines = text.replace(/\r\n?/g, '\n').split('\n')
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    var count = 0
    for (var i = 0; i < lines.length; i++) {
      var r = a.row + i
      if (r >= this.totalRows) break
      var row = this._rowAt(r)
      if (!row) continue
      var cells = lines[i].split('\t')
      for (var j = 0; j < cells.length; j++) {
        var c = a.col + j
        if (c >= this.columns.length) break
        var col = this.columns[c]
        var next = this._coerceValue(col, cells[j])
        var prev = row[col.key]
        if (prev === next) continue
        row[col.key] = next
        count++
        this._emit('cell-change', { row: row, rowIndex: r, column: col, prev: prev, value: next })
      }
    }
    if (count) this.scheduleRender()
    if (count) this._emit('paste', { text: text, cells: count })
    return count
  }

  NcTable.prototype.cutSelection = function () {
    var text = this.copyText()
    if (text === null) return
    this._clearSelection()
    this._emit('copy', { text: text, cut: true })
  }

  // -------------------------------------------------------------- editing
  NcTable.prototype.makeCellEditable = function (initial) {
    if (this.readOnly || !this.activeCell) return
    var col = this.columns[this.activeCell.col]
    var renderer = cellRenderers[col.type] || cellRenderers.text
    if (!renderer.editType) return
    if (this._remote && !this._rowAt(this.activeCell.row)) return

    var rect = this.cellRect(this.activeCell.row, this.activeCell.col)

    if (renderer.editType === 'select') {
      this.editing = { row: this.activeCell.row, col: this.activeCell.col, kind: 'select' }
      this._openSelectPopup(col, rect)
      this.scheduleRender()
      return
    }
    if (renderer.editType === 'select-year') {
      this.editing = { row: this.activeCell.row, col: this.activeCell.col, kind: 'select' }
      this._openYearPopup(col, rect)
      this.scheduleRender()
      return
    }

    var row = this._rowAt(this.activeCell.row)
    this.editing = { row: this.activeCell.row, col: this.activeCell.col, kind: 'input' }
    var ed = this.editor
    ed.style.display = 'block'
    ed.style.left = rect.x + 'px'
    ed.style.top = rect.y + 'px'
    ed.style.width = rect.width + 'px'
    ed.style.height = rect.height + 'px'
    ed.type = renderer.editType === 'input-number' ? 'number' : renderer.editType === 'input-date' ? 'date' : renderer.editType === 'input-datetime' ? 'datetime-local' : renderer.editType === 'input-yearmonth' ? 'month' : 'text'
    ed.style.textAlign = effAlign(col)
    ed.min = renderer.editType === 'input-number' && col.min !== undefined ? col.min : ''
    ed.max = renderer.editType === 'input-number' && col.max !== undefined ? col.max : ''
    var cur = row[col.key]
    ed.value = initial !== undefined ? initial : cur === null || cur === undefined ? '' : String(cur)
    var self = this
    setTimeout(function () { ed.focus({ preventScroll: true }); if (initial === undefined) ed.select() }, 0)
    this.scheduleRender()
  }

  NcTable.prototype._openSelectPopup = function (col, rect) {
    var self = this
    var pu = this.popup
    pu.innerHTML = ''
    pu.style.display = 'block'
    pu.style.left = rect.x + 'px'
    pu.style.width = Math.max(rect.width, 120) + 'px'
    ;(col.options || []).forEach(function (opt) {
      var val = typeof opt === 'object' ? opt.value : opt
      var label = typeof opt === 'object' ? opt.label : opt
      var li = document.createElement('li')
      li.textContent = label
      if (val === self._rowAt(self.activeCell.row)[col.key]) li.className = 'active'
      li.addEventListener('mousedown', function (e) {
        e.preventDefault()
        e.stopPropagation()
        var ed = self.editing
        self._closePopup()
        if (!ed) return
        self.editing = null
        self.updateCell(ed.row, col.key, val)
      })
      pu.appendChild(li)
    })
    var ph = pu.offsetHeight
    var top = rect.y + rect.height
    if (top + ph > this._cssH) top = Math.max(0, rect.y + rect.height - ph) // 下方放不下则向上翻转，盖住当前单元格
    pu.style.top = top + 'px'
  }

  NcTable.prototype._closePopup = function () {
    this.popup.style.display = 'none'
    if (this.editing && this.editing.kind === 'select') this.editing = null
  }

  // 年份下拉面板：降序年表（默认 当前年-50 ~ 当前年+10，列 min/max 可覆盖，自动扩展包含当前值）
  NcTable.prototype._openYearPopup = function (col, rect) {
    var self = this
    var pu = this.popup
    pu.innerHTML = ''
    pu.style.display = 'block'
    pu.style.left = rect.x + 'px'
    pu.style.width = Math.max(rect.width, 90) + 'px'
    var cur = this._rowAt(this.activeCell.row)[col.key]
    var curY = null
    if (cur instanceof Date) curY = cur.getFullYear()
    else {
      var mm = String(cur === null || cur === undefined ? '' : cur).match(/-?\d{4}/)
      if (mm) curY = Number(mm[0])
    }
    var nowY = new Date().getFullYear()
    var lo = col.min !== undefined ? Number(col.min) : nowY - 50
    var hi = col.max !== undefined ? Number(col.max) : nowY + 10
    if (curY !== null) {
      if (curY < lo) lo = curY
      if (curY > hi) hi = curY
    }
    for (var y = hi; y >= lo; y--) {
      var li = document.createElement('li')
      li.textContent = y
      li.setAttribute('data-year', y)
      if (y === curY) li.className = 'active'
      li.addEventListener('mousedown', function (e) {
        e.preventDefault()
        e.stopPropagation()
        var ed = self.editing
        var yy = Number(this.getAttribute('data-year'))
        self._closePopup()
        if (!ed) return
        self.editing = null
        self.updateCell(ed.row, col.key, yy)
      })
      pu.appendChild(li)
    }
    var ph = pu.offsetHeight
    var top = rect.y + rect.height
    if (top + ph > this._cssH) top = Math.max(0, rect.y + rect.height - ph) // 下方放不下则向上翻转，盖住当前单元格
    pu.style.top = top + 'px'
    var act = pu.querySelector('li.active')
    if (act) pu.scrollTop = Math.max(0, act.offsetTop - pu.clientHeight / 2 + act.offsetHeight / 2)
  }

  NcTable.prototype.commitEdit = function () {
    var ed = this.editing
    if (!ed || ed.kind !== 'input') return
    this.editing = null
    this.editor.style.display = 'none'
    var col = this.columns[ed.col]
    var raw = this.editor.value
    var renderer = cellRenderers[col.type] || cellRenderers.text
    var value = raw
    if (renderer.parse) value = renderer.parse(raw, col)
    else if (col.type === 'number') value = raw === '' ? null : Number(raw)
    this.editor.blur()
    this.updateCell(ed.row, col.key, value)
  }

  NcTable.prototype._bindEditorEvents = function () {
    var self = this
    this.editor.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        self.commitEdit()
        self.canvas.focus()
        self._moveActive(1, 0, false)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        self.editing = null
        self.editor.style.display = 'none'
        self.editor.blur()
        self.canvas.focus()
        self.scheduleRender()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        self.commitEdit()
        self.canvas.focus()
        self._moveActive(0, e.shiftKey ? -1 : 1, false)
      }
      e.stopPropagation()
    })
    this.editor.addEventListener('blur', function () { self.commitEdit() })
  }

  NcTable.prototype._bindRenameEvents = function () {
    var self = this
    this.rename.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); self._commitRename() }
      else if (e.key === 'Escape') { e.preventDefault(); self._cancelRename(); self.canvas.focus() }
      e.stopPropagation()
    })
    this.rename.addEventListener('blur', function () { self._commitRename() })
  }

  // --------------------------------------------------------- render loop
  NcTable.prototype.scheduleRender = function () {
    var self = this
    if (this._raf) return
    this._raf = requestAnimationFrame(function () {
      self._raf = 0
      self.render()
    })
  }

  NcTable.prototype._resize = function () {
    if (this._menuCol !== null) this._closeMenu()
    if (this._filterColIndex !== null) this._closeFilterPanel()
    var rect = this.el.getBoundingClientRect()
    this._cssW = Math.max(rect.width, 100)
    this._cssH = Math.max(rect.height, 100)
    var dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(this._cssW * dpr)
    this.canvas.height = Math.round(this._cssH * dpr)
    this.canvas.style.width = this._cssW + 'px'
    this.canvas.style.height = this._cssH + 'px'
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this._viewW = this._cssW
    this._viewH = this._cssH - this.headerHeight - this._footerH()
    this._clampScroll()
    this.scheduleRender()
  }

  NcTable.prototype.render = function () {
    var ctx = this.ctx
    ctx.clearRect(0, 0, this._cssW, this._cssH)
    ctx.fillStyle = this.theme.bg
    ctx.fillRect(0, 0, this._cssW, this._cssH)

    var vr = this._visibleRows()
    var vc = this._visibleCols()
    var rowH = this.rowHeight
    var r, c, i, x, y

    // ---- 行选中背景（勾选行）
    for (r = vr.first; r < vr.last; r++) {
      if (this.selectedRows.has(r)) {
        ctx.fillStyle = COLOR_ACCENT_LIGHT
        ctx.fillRect(this.GUTTER, this._rowY(r), this._cssW - this.GUTTER, rowH)
      }
    }

    // ---- 滚动区单元格
    for (r = vr.first; r < vr.last; r++) {
      y = this._rowY(r)
      for (c = vc.first; c < vc.last; c++) {
        if (this.columns[c].fixed) continue
        this._renderCell(ctx, c, r, this._colX(c), y)
      }
    }
    // ---- 滚动区行分隔线
    ctx.strokeStyle = this.theme.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (r = vr.first; r < vr.last; r++) {
      var ly = Math.floor(this._rowY(r)) + rowH + 0.5
      ctx.moveTo(this.GUTTER + this._fixedWidth(), ly)
      ctx.lineTo(this._cssW, ly)
    }
    ctx.stroke()

    // ---- 固定列单元格（不透明背景覆盖滚动内容）
    var fx = this.GUTTER
    for (i = 0; i < this.columns.length; i++) if (this.columns[i].fixed) fx += this.columns[i].width
    for (r = vr.first; r < vr.last; r++) {
      y = this._rowY(r)
      x = this.GUTTER
      for (i = 0; i < this.columns.length; i++) {
        if (!this.columns[i].fixed) continue
        this._renderCell(ctx, i, r, x, y)
        x += this.columns[i].width
      }
    }
    // 行分隔线统一在单元格画完后二次遍历绘制（否则会被下一行不透明底色覆盖）
    if (fx > this.GUTTER) {
      ctx.strokeStyle = this.theme.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (r = vr.first; r < vr.last; r++) {
        var fy = Math.floor(this._rowY(r)) + rowH + 0.5
        ctx.moveTo(this.GUTTER, fy)
        ctx.lineTo(fx, fy)
      }
      ctx.stroke()
    }

    // ---- 拖拽选区高亮（不含单元格描边）
    this._renderRangeOverlay(ctx)

    // ---- 查询定位匹配高亮（当前项橙色描边，其余淡黄）
    this._renderSearchHighlight(ctx)

    // ---- meta 列（行号/勾选框）
    if (this.showMetaColumn) this._renderGutter(ctx, vr)

    // ---- 活动单元格 + 区域描边（覆盖在固定列/meta 之上）
    this._renderSelection(ctx, vr)

    // ---- 填充手柄（选区右下角圆点，对应 nocodb getFillHandlerPosition）
    this._renderFillHandle(ctx)

    // ---- 表头
    this._renderHeader(ctx)

    // ---- 添加行占位（本地模式）
    this._renderAddRowPlaceholder(ctx)

    // ---- 固定列区右边界竖线（覆盖表头至行区，footer 区由其自身分隔线负责）
    this._renderFixedBoundary(ctx)

    // ---- footer 聚合行（覆盖底部，含固定列区）
    this._renderAggBar(ctx)

    // ---- 滚动条
    this._updateScrollers()
  }

  NcTable.prototype._renderFixedBoundary = function (ctx) {
    if (this._fixedWidth() <= 0) return
    var fx = this.GUTTER + this._fixedWidth()
    ctx.strokeStyle = this.theme.fixedEdge
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(fx - 0.5, 0)
    ctx.lineTo(fx - 0.5, this._cssH - this._footerH())
    ctx.stroke()
  }

  NcTable.prototype._renderCell = function (ctx, colIndex, rowIndex, x, y) {
    var col = this.columns[colIndex]
    var width = col.width
    var renderer = cellRenderers[col.type] || cellRenderers.text

    ctx.fillStyle = col.fixed ? this.theme.fixedBg : this.theme.bg
    ctx.fillRect(x, y, width, this.rowHeight)

    var row = this._rowAt(rowIndex)
    if (!row) {
      if (this._remote) this._renderLoadingBar(ctx, x, y, width)
      return
    }

    renderer.render(ctx, {
      x: x, y: y, width: width, height: this.rowHeight,
      column: col, row: row, rowIndex: rowIndex,
      value: row[col.key],
      text: col.formatter ? col.formatter(row[col.key], col, row) : defaultFormatter(row[col.key], col),
    })

    ctx.strokeStyle = this.theme.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + width - 0.5, y)
    ctx.lineTo(x + width - 0.5, y + this.rowHeight)
    ctx.stroke()
  }

  NcTable.prototype._renderLoadingBar = function (ctx, x, y, width) {
    ctx.save()
    ctx.fillStyle = 'rgba(94, 92, 120, 0.15)'
    roundRect(ctx, x + CELL_PADDING, y + this.rowHeight / 2 - 7, Math.min(width - CELL_PADDING * 2, 140), 14, 3)
    ctx.fill()
    ctx.restore()
  }

  NcTable.prototype._renderGutter = function (ctx, vr) {
    var self = this
    ctx.fillStyle = this.theme.gutterBg
    ctx.fillRect(0, this.headerHeight, this.GUTTER, this._cssH - this.headerHeight)

    var r, y
    for (r = vr.first; r < vr.last; r++) {
      y = this._rowY(r)
      if (this.activeCell && this.activeCell.row === r || this._rangeSelectedRows.has(r)) {
        ctx.fillStyle = this.theme.headerActiveBg // 与活动列标题底色一致，形成十字高亮
        ctx.fillRect(0, y, this.GUTTER, this.rowHeight)
      }
      drawCheckbox(ctx, 22, y + this.rowHeight / 2, this.selectedRows.has(r))
      ctx.fillStyle = '#6f7982'
      ctx.font = FONT_TEXT
      ctx.textBaseline = 'middle'
      ctx.fillText(String(r + 1), 42, y + this.rowHeight / 2 + 0.5)
      ctx.strokeStyle = this.theme.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, Math.floor(y) + this.rowHeight + 0.5)
      ctx.lineTo(this.GUTTER, Math.floor(y) + this.rowHeight + 0.5)
      ctx.stroke()
    }

    ctx.strokeStyle = this.theme.grid
    ctx.beginPath()
    ctx.moveTo(this.GUTTER - 0.5, this.headerHeight)
    ctx.lineTo(this.GUTTER - 0.5, this._cssH)
    ctx.stroke()
  }

  NcTable.prototype._renderHeader = function (ctx) {
    var H = this.headerHeight
    var minX = this.GUTTER + this._fixedWidth()

    ctx.fillStyle = this.theme.headerBg
    ctx.fillRect(0, 0, this._cssW, H)

    // 滚动列表头（被固定列/meta 覆盖）
    var vc = this._visibleCols()
    for (var i = vc.first; i < vc.last; i++) {
      if (this.columns[i].fixed) continue
      this._renderHeaderCell(ctx, i, this._colX(i))
    }
    // 固定列表头
    var x = this.GUTTER
    for (i = 0; i < this.columns.length; i++) {
      if (!this.columns[i].fixed) continue
      this._renderHeaderCell(ctx, i, x)
      x += this.columns[i].width
    }
    // add column 占位：画在全部列最右端（与 _hitAddColumn 点击区一致，随内容滚动）
    var ax = this.GUTTER + this._fixedWidth() - this.scrollLeft
    for (i = 0; i < this.columns.length; i++) if (!this.columns[i].fixed) ax += this.columns[i].width
    this._renderAddColumnHeader(ctx, ax)
    // 组带行（先画，允许滚动段左缘被 meta 表头覆盖）
    this._renderGroupBands(ctx)
    // meta 表头
    if (this.showMetaColumn) this._renderGutterHeader(ctx)

    // 列拖拽换位反馈：被拖列底色高亮 + 目标边界 2px 插入线（对应 renderColumnDragIndicator）
    var d = this._colDrag
    if (d && d.active) {
      var sx = this._colX(d.colIndex)
      ctx.fillStyle = 'rgba(51, 102, 255, 0.12)'
      ctx.fillRect(sx, 0, this.columns[d.colIndex].width, H)
      var lineX
      if (d.overIndex >= this.columns.length) {
        var last = this.columns.length - 1
        lineX = this._colX(last) + this.columns[last].width
      } else {
        lineX = this._colX(d.overIndex)
      }
      ctx.strokeStyle = COLOR_ACCENT
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(Math.round(lineX) + 0.5, 2)
      ctx.lineTo(Math.round(lineX) + 0.5, H - 2)
      ctx.stroke()
    }

    ctx.strokeStyle = this.theme.headerGrid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, H - 0.5)
    ctx.lineTo(this._cssW, H - 0.5)
    ctx.stroke()
  }

  // 活动单元格/选区覆盖的列区间 [min,max]；无活动单元格时回退到当前列（空数据表头点击），都没有返回 null
  NcTable.prototype._activeColRange = function () {
    if (!this.activeCell) {
      if (this._currentCol !== null && this._currentCol !== undefined && this.columns[this._currentCol]) {
        return [this._currentCol, this._currentCol]
      }
      return null
    }
    var s = this.activeCell.col
    var e = this.selection ? this.selection.end.col : s
    return [Math.min(s, e), Math.max(s, e)]
  }

  NcTable.prototype._renderHeaderCell = function (ctx, colIndex, x) {
    var col = this.columns[colIndex]
    var H = this.headerHeight
    var gy = col.group ? this._groupH() : 0 // 未分组列：表头整高（纵向合并两行）
    var w = col.width

    var ar = this._activeColRange()
    ctx.fillStyle = ar && colIndex >= ar[0] && colIndex <= ar[1] ? this.theme.headerActiveBg : this.theme.headerBg
    ctx.fillRect(x, gy, w, H - gy)

    var isResizeHover = this._hoverResizeCol === colIndex
    ctx.strokeStyle = isResizeHover ? COLOR_ACCENT : this.theme.headerGrid
    ctx.lineWidth = isResizeHover ? 2 : 1
    ctx.beginPath()
    ctx.moveTo(x + w - (isResizeHover ? 1 : 0.5), gy + 4)
    ctx.lineTo(x + w - (isResizeHover ? 1 : 0.5), H - 4)
    ctx.stroke()

    ctx.fillStyle = COLOR_HEADER_TEXT
    ctx.font = FONT_HEADER
    ctx.textBaseline = 'middle'
    var cy = gy + (H - gy) / 2 // 单元格内容垂直中心（整高列居中于全高，分组叶子列居中于叶子行）
    var sorted = this._sort && this._sort.key === col.key
    var filtered = !!this._filters[col.key]
    var iconSpace = (sorted ? 16 : 0) + 16 + (filtered ? 16 : 0) // 右侧预留 chevron 菜单按钮（nocodb iconSpace += 16）
    var clip = truncateText(ctx, col.title, w - CELL_PADDING * 2 - iconSpace, FONT_HEADER)
    ctx.fillText(clip.text, x + CELL_PADDING, cy + 0.5)

    // 筛选中漏斗标记（对应 nocodb 已筛选列的视觉提示）
    if (filtered) {
      var fx = x + w - 8 - 14 - 14
      ctx.fillStyle = COLOR_ACCENT
      ctx.beginPath()
      ctx.moveTo(fx, cy - 5)
      ctx.lineTo(fx + 10, cy - 5)
      ctx.lineTo(fx + 6, cy - 0.5)
      ctx.lineTo(fx + 6, cy + 5)
      ctx.lineTo(fx + 4, cy + 3.5)
      ctx.lineTo(fx + 4, cy - 0.5)
      ctx.closePath()
      ctx.fill()
    }

    if (sorted) {
      ctx.beginPath()
      var cx = x + CELL_PADDING + clip.width + 9
      if (this._sort.asc) {
        ctx.moveTo(cx - 4, cy + 2.5)
        ctx.lineTo(cx, cy - 3)
        ctx.lineTo(cx + 4, cy + 2.5)
      } else {
        ctx.moveTo(cx - 4, cy - 2.5)
        ctx.lineTo(cx, cy + 3)
        ctx.lineTo(cx + 4, cy - 2.5)
      }
      ctx.closePath()
      ctx.fill()
    }

    // chevronDown 菜单按钮（对应 useCanvasRender: 列右缘 - 8 - 16，size 14，#6a7184）
    var dx = x + w - 8 - 14
    ctx.strokeStyle = this._hoverMenuCol === colIndex ? COLOR_ACCENT : '#6a7184'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(dx + 2, cy - 2.5)
    ctx.lineTo(dx + 7, cy + 2.5)
    ctx.lineTo(dx + 12, cy - 2.5)
    ctx.stroke()
  }

  // 组带行（第一行）：相邻同组列合并单元格、标题居中
  NcTable.prototype._renderGroupBands = function (ctx) {
    var gy = this._groupH()
    if (!gy) return
    var spans = this._groupSpans()
    var fixedEnd = this.GUTTER + this._fixedWidth()
    for (var s = 0; s < spans.length; s++) {
      var sp = spans[s]
      var x0 = sp.x0, x1 = sp.x1
      // 起始于滚动列的组带：左缘被固定块盖住时裁剪到固定块右边界，避免分隔线/文字越界到固定区
      if (!this.columns[sp.colIndex].fixed) {
        if (x1 <= fixedEnd) continue
        if (x0 < fixedEnd) x0 = fixedEnd
      }
      var w = x1 - x0
      if (w <= 1) continue
      ctx.strokeStyle = this.theme.headerGrid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0 + 0.5, 4)
      ctx.lineTo(x0 + 0.5, gy - 4)
      ctx.moveTo(x1 - 0.5, 4)
      ctx.lineTo(x1 - 0.5, gy - 4)
      ctx.moveTo(x0, gy - 0.5)
      ctx.lineTo(x1, gy - 0.5) // 组带底线仅覆盖组区间（未分组列为整高合并格）
      ctx.stroke()
      ctx.fillStyle = COLOR_HEADER_TEXT
      ctx.font = FONT_HEADER
      ctx.textBaseline = 'middle'
      var clip = truncateText(ctx, sp.group.title, w - CELL_PADDING * 2, FONT_HEADER)
      ctx.fillText(clip.text, x0 + CELL_PADDING, gy / 2 + 0.5) // 与列标题统一：居左
    }
  }

  NcTable.prototype._renderAddColumnHeader = function (ctx, x) {
    ctx.strokeStyle = this.theme.headerGrid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 4)
    ctx.lineTo(x + 0.5, this.headerHeight - 4)
    ctx.stroke()
    ctx.fillStyle = '#6f7982'
    ctx.font = '700 14px Inter, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('+', x + 8, this.headerHeight / 2 + 1)
  }

  NcTable.prototype._renderGutterHeader = function (ctx) {
    var H = this.headerHeight
    ctx.fillStyle = this.theme.headerBg
    ctx.fillRect(0, 0, this.GUTTER, H)
    ctx.strokeStyle = this.theme.headerGrid
    ctx.beginPath()
    ctx.moveTo(this.GUTTER - 0.5, 0)
    ctx.lineTo(this.GUTTER - 0.5, H)
    ctx.moveTo(0, H - 0.5)
    ctx.lineTo(this.GUTTER, H - 0.5)
    ctx.stroke()
    var lcy = H / 2
    ctx.fillStyle = COLOR_HEADER_TEXT
    ctx.font = FONT_HEADER
    ctx.textBaseline = 'middle'
    ctx.fillText('#', 42, lcy + 0.5)
    if (this.rowSelection === 'single') return // 单选模式：不渲染表头全选框
    var all = this.totalRows > 0
    for (var i = 0; i < this.totalRows; i++) if (!this.selectedRows.has(i)) { all = false; break }
    drawCheckbox(ctx, 22, lcy, all)
  }

  NcTable.prototype._renderRangeOverlay = function (ctx) {
    var sel = this.selection
    if (!sel || !this.activeCell) return
    var sameCell = sel.start.row === sel.end.row && sel.start.col === sel.end.col
    if (sameCell) return
    var r0 = Math.max(0, Math.min(sel.start.row, sel.end.row))
    var r1 = Math.min(this.totalRows - 1, Math.max(sel.start.row, sel.end.row))
    var c0 = Math.min(sel.start.col, sel.end.col)
    var c1 = Math.max(sel.start.col, sel.end.col)
    var left = Infinity, right = -Infinity
    for (var c = c0; c <= c1; c++) {
      left = Math.min(left, this._colX(c))
      right = Math.max(right, this._colX(c) + this.columns[c].width)
    }
    ctx.fillStyle = COLOR_ACCENT_LIGHT
    ctx.fillRect(left, this._rowY(r0), right - left, (r1 - r0 + 1) * this.rowHeight)
  }

  NcTable.prototype._renderSelection = function (ctx, vr) {
    if (!this.activeCell) return
    var a = this.activeCell
    var sel = this.selection || { start: a, end: a }

    // 区域描边
    var r0 = Math.max(0, Math.min(sel.start.row, sel.end.row))
    var r1 = Math.min(this.totalRows - 1, Math.max(sel.start.row, sel.end.row))
    var c0 = Math.min(sel.start.col, sel.end.col)
    var c1 = Math.max(sel.start.col, sel.end.col)
    var left = Infinity, right = -Infinity, i
    for (i = c0; i <= c1; i++) {
      left = Math.min(left, this._colX(i))
      right = Math.max(right, this._colX(i) + this.columns[i].width)
    }
    ctx.strokeStyle = 'rgba(51, 102, 255, 0.55)'
    ctx.lineWidth = 1
    ctx.strokeRect(left + 0.5, this._rowY(r0) + 0.5, right - left - 1, (r1 - r0 + 1) * this.rowHeight - 1)

    // 活动单元格 2px 描边（nocodb 风格）
    var rect = this.cellRect(a.row, a.col)
    ctx.strokeStyle = COLOR_ACCENT
    ctx.lineWidth = 2
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2)
  }

  NcTable.prototype._renderFillHandle = function (ctx) {
    var q = this._selectionRect()
    if (!q || this.readOnly) return
    ctx.save()
    ctx.fillStyle = COLOR_ACCENT
    ctx.beginPath()
    ctx.arc(q.right, q.bottom, FILL_HANDLE_SIZE / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  NcTable.prototype._renderSearchHighlight = function (ctx) {
    var s = this._search
    if (this.searchBar.style.display === 'none' || !s.matches.length) return
    var top = this.headerHeight
    ctx.save()
    for (var i = 0; i < s.matches.length; i++) {
      var m = s.matches[i]
      var y = this._rowY(m.row)
      if (y + this.rowHeight < top || y > this._cssH) continue
      var x = this._colX(m.col)
      var w = this.columns[m.col].width
      var clip = Math.max(0, top - y)
      ctx.fillStyle = i === s.index ? 'rgba(245, 158, 11, 0.42)' : 'rgba(255, 213, 79, 0.26)'
      ctx.fillRect(x, y + clip, w, this.rowHeight - clip)
    }
    var cur = s.matches[s.index]
    if (cur) {
      var cy = this._rowY(cur.row)
      if (cy + this.rowHeight >= top) {
        ctx.strokeStyle = '#d97706'
        ctx.lineWidth = 2
        ctx.strokeRect(this._colX(cur.col) + 1, Math.max(cy, top) + 1, this.columns[cur.col].width - 2, this.rowHeight - 2)
      }
    }
    ctx.restore()
  }

  NcTable.prototype._renderAddRowPlaceholder = function (ctx) {
    this._addRowY = undefined
    if (this._remote || this.readOnly) return // 只读：不显示也不响应“添加一行”占位
    var y = this._rowY(this.totalRows)
    if (y < this.headerHeight || y > this._cssH) return
    ctx.fillStyle = this.theme.bg
    ctx.fillRect(this.GUTTER, y, this._cssW - this.GUTTER, this.rowHeight)
    ctx.fillStyle = COLOR_EMPTY_TEXT
    ctx.font = FONT_TEXT
    ctx.textBaseline = 'middle'
    ctx.fillText('在此处添加一行/记录', this.GUTTER + 16, y + this.rowHeight / 2 + 0.5)
    ctx.strokeStyle = this.theme.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y + this.rowHeight + 0.5)
    ctx.lineTo(this._cssW, y + this.rowHeight + 0.5)
    ctx.stroke()
    this._addRowY = y
  }

  NcTable.prototype._updateScrollers = function () {
    var vs = this.vScroller, hs = this.hScroller
    var totalH = (this.totalRows + (this._remote ? 0 : 1)) * this.rowHeight
    var vTrack = Math.max(40, (vs.el.clientHeight || this._viewH) - 72) // 扣除上下翻页按钮各 36px
    this._vThumbSize = Math.max(40, vTrack * Math.min(1, vTrack / Math.max(totalH, vTrack)))
    var maxTop = this._maxScrollTop()
    vs.el.style.display = maxTop > 1 ? 'block' : 'none'
    var fh = this._footerH()
    vs.el.style.bottom = (12 + fh) + 'px' // 避开 footer 与横向滚动条
    hs.el.style.bottom = fh + 'px'
    vs.thumb.style.height = this._vThumbSize + 'px'
    vs.thumb.style.transform = 'translateY(' + (maxTop > 0 ? Math.max(0, vTrack - this._vThumbSize) * (this.scrollTop / maxTop) : 0) + 'px)'

    var scrollableW = this.columns.reduce(function (w, c) { return w + c.width }, 0) + ADD_COLUMN_WIDTH
    var viewW = Math.max(1, this._cssW - this.GUTTER - this._fixedWidth())
    this._hThumbSize = Math.max(40, viewW * Math.min(1, viewW / Math.max(scrollableW, viewW)))
    var maxLeft = this._maxScrollLeftReal()
    hs.el.style.display = maxLeft > 1 ? 'block' : 'none'
    hs.thumb.style.width = this._hThumbSize + 'px'
    hs.thumb.style.transform = 'translateX(' + (maxLeft > 0 ? (viewW - this._hThumbSize) * (this.scrollLeft / maxLeft) : 0) + 'px)'
  }

  // --------------------------------------------------------------- events
  NcTable.prototype._pos = function (e) {
    var rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // 对应 useMouseSelection.findCellFromPosition
  NcTable.prototype._hitTest = function (x, y) {
    if (x < this.GUTTER) {
      var gr = Math.floor((y - this.headerHeight + this.scrollTop) / this.rowHeight)
      return { row: gr >= this.totalRows ? -2 : gr, col: -1 }
    }
    var acc = this.GUTTER
    var i = 0
    var colIdx = -1
    while (i < this.columns.length && this.columns[i].fixed) {
      if (x >= acc && x < acc + this.columns[i].width) { colIdx = i; break }
      acc += this.columns[i].width
      i++
    }
    if (colIdx < 0) {
      var adjusted = x + this.scrollLeft - acc
      for (; i < this.columns.length; i++) {
        if (this.columns[i].fixed) continue
        if (adjusted >= 0 && adjusted < this.columns[i].width) { colIdx = i; break }
        adjusted -= this.columns[i].width
      }
    }
    var row = Math.floor((y - this.headerHeight + this.scrollTop) / this.rowHeight)
    if (row >= this.totalRows) row = -2
    if (row < 0) row = -1
    return { row: row, col: colIdx }
  }

  // 列头顶部 y：分组列从叶子行开始，未分组列整高（与 _renderHeaderCell 的 gy 一致）
  NcTable.prototype._colHeadTop = function (col) { return col.group ? this._groupH() : 0 }

  // 对应 useColumnResize.resizeableColumn
  NcTable.prototype._hitResize = function (x, y) {
    if (y > this.headerHeight) return null
    var acc = this.GUTTER
    var i, c
    for (i = 0; i < this.columns.length; i++) {
      c = this.columns[i]
      if (!c.fixed) continue
      if (Math.abs(x - (acc + c.width)) <= RESIZE_HANDLE_WIDTH / 2) return y < this._colHeadTop(c) ? null : i
      acc += c.width
    }
    acc = this.GUTTER + this._fixedWidth() - this.scrollLeft
    for (i = 0; i < this.columns.length; i++) {
      c = this.columns[i]
      if (c.fixed) continue
      if (Math.abs(x - (acc + c.width)) <= RESIZE_HANDLE_WIDTH / 2) return y < this._colHeadTop(c) ? null : i
      acc += c.width
    }
    return null
  }

  NcTable.prototype._hitHeaderCol = function (x) {
    var acc = this.GUTTER
    var i
    // 冻结列：固定像素区间（与 _hitTest 同构，第一段循环只覆盖前置冻结列）
    for (i = 0; i < this.columns.length && this.columns[i].fixed; i++) {
      if (x >= acc && x < acc + this.columns[i].width) return i
      acc += this.columns[i].width
    }
    var adjusted = x + this.scrollLeft - acc
    for (; i < this.columns.length; i++) {
      if (this.columns[i].fixed) continue
      var w = this.columns[i].width
      if (adjusted >= 0 && adjusted < w) return i
      adjusted -= w
    }
    return -1
  }

  // 表头 chevron 菜单按钮命中（对应 index.vue: iconOffsetX <= x <= iconOffsetX + 14）
  NcTable.prototype._hitHeaderDropdown = function (x, y) {
    if (y > this.headerHeight) return null
    var clipX = this.GUTTER + this._fixedWidth()
    for (var i = 0; i < this.columns.length; i++) {
      var c = this.columns[i]
      if (y < this._colHeadTop(c)) continue // 分组列的组带行不响应列 chevron（该处属组菜单）
      var right = this._colX(i) + c.width
      if (!c.fixed && right - 6 < clipX) continue // 被冻结列不透明覆盖层遮住，不可点
      if (x >= right - 22 && x <= right - 6) return i
    }
    return null
  }

  // 末尾 + 列（添加字段入口，对应 nocodb ADD_NEW_COLUMN_WIDTH 点击区）
  NcTable.prototype._hitAddColumn = function (x) {
    if (x < this.GUTTER) return false
    var right = this.GUTTER + this._fixedWidth() - this.scrollLeft
    for (var i = 0; i < this.columns.length; i++) if (!this.columns[i].fixed) right += this.columns[i].width
    return x >= right && x <= right + ADD_COLUMN_WIDTH
  }

  // ---------------------------------------------------- 列设置菜单（两级：一级分组 + 二级子菜单）
  NcTable.prototype._openMenu = function (colIndex) {
    var self = this
    var col = this.columns[colIndex]
    if (!col) return
    this._closePopup()
    this._cancelRename()
    this._closeSub()
    this._menuCol = colIndex
    var m = this.menu
    m.innerHTML = ''
    m.onscroll = function () { self._closeSub() } // 主菜单滚动时收起子菜单，避免错位
    var sorted = this._sort && this._sort.key === col.key
    var dir = sorted ? (this._sort.asc ? 'asc' : 'desc') : null

    function item(label, opts, container) {
      opts = opts || {}
      var d = document.createElement('div')
      d.className = 'nc-table__menu-item' + (opts.danger ? ' nc-table__menu-item--danger' : '')
      d.textContent = label
      if (opts.active) d.className += ' is-active'
      if (opts.disabled) {
        d.className += ' is-disabled'
      } else {
        d.addEventListener('mousedown', function (e) {
          e.preventDefault()
          e.stopPropagation()
          self._closeMenu()
          if (opts.action) opts.action()
        })
      }
      ;(container || m).appendChild(d)
    }
    function sep() {
      var d = document.createElement('div')
      d.className = 'nc-table__menu-sep'
      m.appendChild(d)
    }
    // 一级分组项：悬停/点击展开二级子菜单
    function parent(label, build) {
      var d = document.createElement('div')
      d.className = 'nc-table__menu-item nc-table__menu-item--parent'
      d.textContent = label
      var ar = document.createElement('span')
      ar.className = 'nc-table__menu-arrow'
      ar.textContent = '▸'
      d.appendChild(ar)
      d.addEventListener('mouseenter', function () { self._openSub(d, build) })
      d.addEventListener('mouseleave', function () { self._scheduleCloseSub() })
      d.addEventListener('mousedown', function (e) {
        e.preventDefault()
        e.stopPropagation()
        if (self._subMenu && self._subMenu._parent === d) self._closeSub()
        else self._openSub(d, build)
      })
      m.appendChild(d)
    }

    item('数据筛选', { action: function () { self._openFilterPanel(colIndex) } })
    if (this._filters[col.key]) item('清除本列筛选', { action: function () { self.setFilter(col.key, null) } })
    sep()
    if (this.options.sortable !== false) {
      parent('数据排序', function (sub) {
        item('升序排序', { disabled: !col.sortable, active: dir === 'asc', action: function () { if (dir !== 'asc') self.sort(col.key, 'asc') } }, sub)
        item('降序排序', { disabled: !col.sortable, active: dir === 'desc', action: function () { if (dir !== 'desc') self.sort(col.key, 'desc') } }, sub)
        item('取消排序', { disabled: !sorted, action: function () { self.sort(col.key, null) } }, sub)
      })
    }
    parent('数据对齐', function (sub) {
      var ea = effAlign(col)
      item('左对齐', { active: ea === 'left', action: function () { self.updateColumn(col.key, { align: 'left' }) } }, sub)
      item('右对齐', { active: ea === 'right', action: function () { self.updateColumn(col.key, { align: 'right' }) } }, sub)
      item('居中对齐', { active: ea === 'center', action: function () { self.updateColumn(col.key, { align: 'center' }) } }, sub)
    })
    if (!this.readOnly) {
      item('重命名字段', { action: function () { self._startRename(colIndex) } })
      item(col.fixed ? '取消固定' : '固定到左侧', { action: function () { self.updateColumn(col.key, { fixed: !col.fixed }) } })
      item('隐藏字段', { action: function () { self.hideColumn(col.key) } })
      if (self._hiddenCols.length) {
        item('显示隐藏字段（' + self._hiddenCols.length + '）', { action: function () { self.showAllColumns() } })
      }
      parent('插入字段', function (sub) {
        item('在当前列前插入', { action: function () { self._emit('column-insert', { index: colIndex, ref: col }) } }, sub)
        item('在当前列后插入', { action: function () { self._emit('column-insert', { index: colIndex + 1, ref: col }) } }, sub)
      })
      sep()
      item('删除字段', { danger: true, action: function () { self.deleteColumn(col.key) } })
    }

    m.style.display = 'block'
    var top = this.headerHeight + 2
    var avail = this._cssH - top - 4
    m.style.maxHeight = (avail > 100 ? avail : 100) + 'px' // 受容器高度约束，超出则内部滚动，避免底部菜单项被裁剪
    m.style.overflowY = 'auto'
    var mw = m.offsetWidth || 180
    var left = Math.max(0, Math.min(this._colX(colIndex), this._cssW - mw - 2))
    m.style.left = left + 'px'
    m.style.top = top + 'px'
    this._emit('column-menu', { column: col, index: colIndex })
  }

  // 组带菜单（第一行）：重命名组 / 隐藏整组
  NcTable.prototype._openGroupMenu = function (colIndex) {
    var self = this
    var col = this.columns[colIndex]
    if (!col || !col.group) return
    this._closePopup()
    this._cancelRename()
    this._closeSub()
    this._menuCol = colIndex
    var m = this.menu
    m.innerHTML = ''
    m.onscroll = null

    function item(label, opts) {
      opts = opts || {}
      var d = document.createElement('div')
      d.className = 'nc-table__menu-item' + (opts.danger ? ' nc-table__menu-item--danger' : '')
      d.textContent = label
      d.addEventListener('mousedown', function (e) {
        e.preventDefault()
        e.stopPropagation()
        self._closeMenu()
        if (opts.action) opts.action()
      })
      m.appendChild(d)
    }

    item('重命名组', { action: function () { self._startGroupRename(colIndex) } })
    item('隐藏整组', { danger: true, action: function () { self.hideGroup(col.group.key) } })

    m.style.display = 'block'
    m.style.maxHeight = ''
    m.style.overflowY = 'visible'
    var spans = this._groupSpans()
    var sp = null
    for (var s = 0; s < spans.length; s++) if (spans[s].colIndex === colIndex) sp = spans[s]
    var mw = m.offsetWidth || 180
    var gleft = sp ? Math.max(0, Math.min(sp.x0, this._cssW - mw - 2)) : 0
    m.style.left = gleft + 'px'
    m.style.top = '2px'
    this._emit('group-menu', { group: col.group, index: colIndex })
  }

  // 重命名标题组（同 key 的所有列一起改）
  NcTable.prototype.renameGroup = function (groupKey, title) {
    var changed = false
    for (var i = 0; i < this.columns.length; i++) {
      var c = this.columns[i]
      if (c.group && c.group.key === groupKey) { c.group.title = String(title); changed = true }
    }
    if (!changed) return
    this.scheduleRender()
    this._emit('group-rename', { key: groupKey, title: String(title) })
  }

  // 隐藏整个标题组的列
  NcTable.prototype.hideGroup = function (groupKey) {
    var keys = []
    for (var i = 0; i < this.columns.length; i++) {
      var c = this.columns[i]
      if (c.group && c.group.key === groupKey) keys.push(c.key)
    }
    for (var k = 0; k < keys.length; k++) this.hideColumn(keys[k])
  }

  // 二级子菜单：挂在表格容器上（脱离主菜单 overflow 裁剪），悬停展开、离开延时收起
  NcTable.prototype._openSub = function (parentEl, build) {
    var self = this
    if (this._subTimer) { clearTimeout(this._subTimer); this._subTimer = null }
    if (this._subMenu && this._subMenu._parent === parentEl) return
    this._closeSub()
    var s = document.createElement('div')
    s.className = 'nc-table__menu nc-table__menu--sub'
    s._parent = parentEl
    s.addEventListener('mouseenter', function () { if (self._subTimer) { clearTimeout(self._subTimer); self._subTimer = null } })
    s.addEventListener('mouseleave', function () { self._scheduleCloseSub() })
    build(s)
    this.el.appendChild(s)
    s.style.display = 'block'
    var er = this.el.getBoundingClientRect()
    var pr = parentEl.getBoundingClientRect()
    var sw = s.offsetWidth || 150
    var sh = s.offsetHeight
    var left = pr.right - er.left + 2
    if (left + sw > this._cssW - 2) left = pr.left - er.left - sw - 2 // 右侧放不下则向左翻
    if (left < 2) left = 2
    var top = pr.top - er.top
    if (top + sh > this._cssH - 2) top = Math.max(2, this._cssH - sh - 2)
    s.style.left = left + 'px'
    s.style.top = top + 'px'
    this._subMenu = s
  }

  NcTable.prototype._closeSub = function () {
    if (this._subTimer) { clearTimeout(this._subTimer); this._subTimer = null }
    if (this._subMenu && this._subMenu.parentNode) this._subMenu.parentNode.removeChild(this._subMenu)
    this._subMenu = null
  }

  NcTable.prototype._scheduleCloseSub = function () {
    var self = this
    if (this._subTimer) clearTimeout(this._subTimer)
    this._subTimer = setTimeout(function () { self._closeSub() }, 250)
  }

  NcTable.prototype._closeMenu = function () {
    this._closeSub()
    this.menu.style.display = 'none'
    this.menu.innerHTML = '' // 清空避免隐藏项仍可被程序化触发
    this._menuCol = null
  }

  // ------------------------------------------------ 数据筛选面板（Excel 式值勾选）
  NcTable.prototype._openFilterPanel = function (colIndex) {
    var self = this
    var col = this.columns[colIndex]
    if (!col) return
    this._closeMenu()
    this._closePopup()
    this._cancelRename()
    this._filterColIndex = colIndex
    var entries = this._collectColumnValues(col)
    var existing = this._filters[col.key]
    var checked = {}
    if (existing) {
      for (var e = 0; e < existing.length; e++) {
        var ev = existing[e]
        checked[ev === null ? '\u0000b' : typeof ev + ':' + String(ev)] = true
      }
    } else {
      entries.forEach(function (en) { checked[en.key] = true })
    }
    // 选择集仍为“默认全选”且用户未手动改过：首次搜索自动收缩为匹配项
    var untouched = !existing

    var p = this.fpanel
    p.innerHTML = ''
    var search = document.createElement('input')
    search.className = 'nc-table__filter-search'
    search.placeholder = '搜索值…'
    p.appendChild(search)

    var head = document.createElement('label')
    head.className = 'nc-table__filter-head'
    var allCb = document.createElement('input')
    allCb.type = 'checkbox'
    var allTxt = document.createElement('span')
    head.appendChild(allCb)
    head.appendChild(allTxt)
    p.appendChild(head)

    var list = document.createElement('div')
    list.className = 'nc-table__filter-list'
    p.appendChild(list)

    var foot = document.createElement('div')
    foot.className = 'nc-table__filter-foot'
    var btnOk = document.createElement('button')
    btnOk.textContent = '确定'
    btnOk.className = 'is-primary'
    var btnCancel = document.createElement('button')
    btnCancel.textContent = '取消'
    foot.appendChild(btnOk)
    foot.appendChild(btnCancel)
    p.appendChild(foot)

    var rows = []
    function syncAll() {
      // 全选状态必须按“全部值”计算（而非仅搜索后可见行），否则搜索缩小列表后会被误判为全选
      var n = 0
      entries.forEach(function (en) { if (checked[en.key]) n++ })
      var all = entries.length > 0 && n === entries.length
      allCb.checked = all
      allCb.indeterminate = n > 0 && !all
      allTxt.textContent = '全选（' + entries.length + ' 个值' + (all ? '' : '，已选 ' + n) + '）'
    }
    function buildList() {
      list.innerHTML = ''
      rows = []
      var q = search.value.trim().toLowerCase()
      entries.forEach(function (en) {
        if (q && String(en.label).toLowerCase().indexOf(q) < 0) return
        var label = document.createElement('label')
        label.className = 'nc-table__filter-row'
        var cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = !!checked[en.key]
        var txt = document.createElement('span')
        txt.textContent = en.label
        cb.addEventListener('change', function () {
          untouched = false
          if (cb.checked) checked[en.key] = true
          else delete checked[en.key]
          syncAll()
        })
        label.appendChild(cb)
        label.appendChild(txt)
        list.appendChild(label)
        rows.push({ en: en, cb: cb })
      })
      syncAll()
    }
    allCb.addEventListener('change', function () {
      // 勾选作用于当前搜索结果中的行（Excel 语义）；半选态点击进入“全选”分支
      untouched = false
      rows.forEach(function (r) {
        r.cb.checked = allCb.checked
        if (allCb.checked) checked[r.en.key] = true
        else delete checked[r.en.key]
      })
      syncAll()
    })
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase()
      if (untouched && q) {
        var m = 0
        entries.forEach(function (en) {
          if (String(en.label).toLowerCase().indexOf(q) >= 0) m++
        })
        if (m > 0 && m < entries.length) {
          checked = {}
          entries.forEach(function (en) {
            if (String(en.label).toLowerCase().indexOf(q) >= 0) checked[en.key] = true
          })
        }
      }
      buildList()
    })
    btnOk.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation() })
    btnOk.addEventListener('click', function (e) {
      e.stopPropagation()
      var vals = []
      var allChecked = true
      entries.forEach(function (en) {
        if (checked[en.key]) vals.push(en.raw)
        else allChecked = false
      })
      self._closeFilterPanel()
      if (allChecked) { if (existing) self.setFilter(col.key, null) }
      else self.setFilter(col.key, vals)
    })
    btnCancel.addEventListener('click', function (e) { e.stopPropagation(); self._closeFilterPanel() })

    buildList()
    p.style.display = 'block'
    var pw = p.offsetWidth || 240
    var left = Math.max(0, Math.min(this._colX(colIndex), this._cssW - pw - 2))
    p.style.left = left + 'px'
    p.style.top = (this.headerHeight + 2) + 'px'
    this._emit('column-filter-open', { column: col })
  }

  NcTable.prototype._closeFilterPanel = function () {
    this.fpanel.style.display = 'none'
    this.fpanel.innerHTML = ''
    this._filterColIndex = null
  }

  // ---------------------------------------------------- 重命名输入框
  NcTable.prototype._startRename = function (colIndex) {
    var col = this.columns[colIndex]
    if (!col) return
    this._renamingCol = colIndex
    this._renamingGroup = null
    var gy = this._colHeadTop(col)
    var r = this.rename
    r.style.display = 'block'
    r.style.left = (this._colX(colIndex) + 4) + 'px'
    r.style.top = (gy + 4) + 'px'
    r.style.width = Math.max(60, col.width - 34) + 'px'
    r.style.height = (this.headerHeight - gy - 8) + 'px'
    r.value = col.title
    var self = this
    setTimeout(function () { r.focus({ preventScroll: true }); r.select() }, 0)
  }

  // 组带重命名：编辑框覆盖组带段
  NcTable.prototype._startGroupRename = function (colIndex) {
    var col = this.columns[colIndex]
    if (!col || !col.group) return
    var spans = this._groupSpans(), sp = null
    for (var s = 0; s < spans.length; s++) if (spans[s].colIndex === colIndex) sp = spans[s]
    if (!sp) return
    this._renamingCol = null
    this._renamingGroup = col.group.key
    var r = this.rename
    r.style.display = 'block'
    r.style.left = (sp.x0 + 4) + 'px'
    r.style.top = '4px'
    r.style.width = Math.max(60, sp.x1 - sp.x0 - 8) + 'px'
    r.style.height = (this._groupH() - 8) + 'px'
    r.value = col.group.title
    var self = this
    setTimeout(function () { r.focus({ preventScroll: true }); r.select() }, 0)
  }

  NcTable.prototype._commitRename = function () {
    var v = this.rename.value.trim()
    if (this._renamingGroup !== null) {
      var gkey = this._renamingGroup
      this._cancelRename()
      if (v) this.renameGroup(gkey, v)
      this.canvas.focus()
      return
    }
    if (this._renamingCol === null) return
    var col = this.columns[this._renamingCol]
    this._cancelRename()
    if (col && v && v !== col.title) this.updateColumn(col.key, { title: v })
    this.canvas.focus()
  }

  NcTable.prototype._cancelRename = function () {
    this._renamingCol = null
    this._renamingGroup = null
    this.rename.style.display = 'none'
  }

  // ---------------------------------------------------- 列操作 API
  NcTable.prototype.updateColumn = function (colKey, patch) {
    var col = this._colByKey(colKey)
    if (!col) return
    if (patch.title !== undefined) col.title = String(patch.title)
    if (patch.width !== undefined) col.width = Math.max(MIN_COLUMN_WIDTH, Number(patch.width) || MIN_COLUMN_WIDTH)
    if (patch.options !== undefined) col.options = patch.options
    if (patch.placeholder !== undefined) col.placeholder = patch.placeholder
    if (patch.formatter !== undefined) col.formatter = patch.formatter
    if (patch.sortable !== undefined) col.sortable = !!patch.sortable
    if (patch.type !== undefined) col.type = patch.type
    if (patch.align !== undefined) col.align = patch.align === 'left' || patch.align === 'center' || patch.align === 'right' ? patch.align : null
    if (patch.group !== undefined) {
      col.group = patch.group && patch.group.key
        ? { key: String(patch.group.key), title: patch.group.title !== undefined ? String(patch.group.title) : String(patch.group.key) }
        : null
      if (this.options.headerHeight === undefined) {
        this.headerHeight = this._hasGroups() ? HEADER_HEIGHT * 2 : HEADER_HEIGHT
        this._resize()
      }
    }
    if (patch.fixed !== undefined && !!patch.fixed !== col.fixed) {
      col.fixed = !!patch.fixed
      this._reorderFixed()
    }
    this._emit('column-update', { column: col, patch: patch })
    this.scheduleRender()
  }

  NcTable.prototype._reorderFixed = function () {
    var fixed = this.columns.filter(function (c) { return c.fixed })
    var rest = this.columns.filter(function (c) { return !c.fixed })
    this.columns = fixed.concat(rest)
  }

  NcTable.prototype.hideColumn = function (colKey) {
    var i = -1
    for (var k = 0; k < this.columns.length; k++) if (this.columns[k].key === colKey) { i = k; break }
    if (i < 0) return
    var col = this.columns.splice(i, 1)[0]
    this._hiddenCols.push({ column: col, index: i })
    if (this._filters[colKey]) { delete this._filters[colKey]; this._rebuildView() }
    else this._clampActive()
    this._emit('column-hide', { column: col, index: i, hidden: this.getHiddenColumns() })
    this.scheduleRender()
  }

  NcTable.prototype.showColumn = function (colKey) {
    for (var k = 0; k < this._hiddenCols.length; k++) {
      if (this._hiddenCols[k].column.key === colKey) {
        var rec = this._hiddenCols.splice(k, 1)[0]
        var at = Math.min(rec.index, this.columns.length)
        this.columns.splice(at, 0, rec.column)
        this._emit('column-show', { column: rec.column, index: at, hidden: this.getHiddenColumns() })
        this.scheduleRender()
        return true
      }
    }
    return false
  }

  NcTable.prototype.showAllColumns = function () {
    var self = this
    this._hiddenCols
      .slice()
      .sort(function (a, b) { return a.index - b.index })
      .forEach(function (h) { self.showColumn(h.column.key) })
  }

  NcTable.prototype.getHiddenColumns = function () {
    return this._hiddenCols.map(function (h) { return h.column.key })
  }

  NcTable.prototype.deleteColumn = function (colKey) {
    var i = -1
    for (var k = 0; k < this.columns.length; k++) if (this.columns[k].key === colKey) { i = k; break }
    if (i < 0) return
    var col = this.columns.splice(i, 1)[0]
    if (this._sort && this._sort.key === colKey) {
      this._sort = null
      if (!this._remote) this._rows = this._origRows.slice()
      else this.reload()
    }
    if (this._filters[colKey]) { delete this._filters[colKey]; this._rebuildView() }
    else this._clampActive()
    this._emit('column-delete', { column: col, index: i })
    this.scheduleRender()
  }

  NcTable.prototype.insertColumn = function (colDef, index) {
    var col = normalizeColumn(colDef, this.columns.length)
    var i = index === undefined ? this.columns.length : Math.max(0, Math.min(index, this.columns.length))
    this.columns.splice(i, 0, col)
    this._reorderFixed() // 保持冻结列前置不变式
    this._emit('column-added', { column: col, index: i })
    this.scheduleRender()
    return col
  }

  NcTable.prototype._bindCanvasEvents = function () {
    var self = this
    var canvas = this.canvas

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault()
      if (e.shiftKey && e.deltaY) self.setScroll(self.scrollTop, self.scrollLeft + e.deltaY)
      else self.setScroll(self.scrollTop + e.deltaY, self.scrollLeft + e.deltaX)
    }, { passive: false })

    // 剪贴板（对应 useCopyPaste：Ctrl+C / Ctrl+X / Ctrl+V，TSV 格式）
    canvas.addEventListener('copy', function (e) {
      var text = self.copyText()
      if (text === null) return
      e.preventDefault()
      if (e.clipboardData) e.clipboardData.setData('text/plain', text)
      self._emit('copy', { text: text })
    })
    canvas.addEventListener('cut', function (e) {
      if (self.readOnly) return
      var text = self.copyText()
      if (text === null) return
      e.preventDefault()
      if (e.clipboardData) e.clipboardData.setData('text/plain', text)
      self._clearSelection()
      self._emit('copy', { text: text, cut: true })
    })
    canvas.addEventListener('paste', function (e) {
      if (self.readOnly) return
      var text = e.clipboardData ? e.clipboardData.getData('text/plain') : ''
      if (!text) return
      e.preventDefault()
      self.pasteText(text)
    })

    canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return
      var pos = self._pos(e) // 先取坐标：focus() 可能引发页面滚动，使 rect 偏移
      canvas.focus({ preventScroll: true })
      var x = pos.x, y = pos.y

      // 0. 填充手柄（选区右下角圆点）
      if (self._fillHandlerHit(x, y)) {
        self.commitEdit()
        self._startFill()
        return
      }

      // 1. 列宽拖拽（只读模式也允许：仅改展示宽度，不动数据）
      var rc = self._hitResize(x, y)
      if (rc !== null) {
        self._dragging = 'resize'
        self._resizeCol = { colIndex: rc, startX: x, initialWidth: self.columns[rc].width }
        return
      }

      // 2. 表头：列菜单按钮 / 排序 / 添加列 / 全选
      if (y < self.headerHeight) {
        // 2a. 组带行：命中组带打开组菜单；未分组列（整高表头）继续走常规列操作
        var gci = y < self._groupH() ? self._hitGroupBand(x) : -1
        if (gci >= 0) {
          if (self._menuCol === gci) self._closeMenu(); else self._openGroupMenu(gci)
          return
        }
        if (x < self.GUTTER) {
          self._closeMenu()
          self._toggleSelectAll()
        } else {
          var dd = self._hitHeaderDropdown(x, y)
          if (dd !== null) {
            // 对应 nocodb：点击 chevron 打开菜单；同列再次点击则关闭
            self._setCurrentCol(dd)
            if (self._menuCol === dd) self._closeMenu()
            else self._openMenu(dd)
            return
          }
          self._closeMenu()
          var hc = self._hitHeaderCol(x)
          if (hc >= 0) {
            self._setCurrentCol(hc)
            // 只读/冻结列不可拖序：直接点击排序；否则挂起，移动超阈值进拖拽，抬起未动则视为点击排序
            if (self.readOnly || self.columns[hc].fixed) self.sort(self.columns[hc].key)
            else self._colDrag = { colIndex: hc, startX: x, active: false, overIndex: hc }
          } else if (self._hitAddColumn(x)) self._emit('add-column', {})
        }
        return
      }

      // 3. meta 列：勾选 / 整行选中
      if (x < self.GUTTER) {
        var hit = self._hitTest(x, y)
        if (hit.row >= 0) {
          if (x <= 36) self._toggleRowSelection(hit.row)
          else {
            self.activeCell = { row: hit.row, col: 0 }
            self.selection = null
            self._updateRangeSelectedRows()
            self._emit('row-select', { rows: [hit.row] })
          }
          self.scheduleRender()
        }
        return
      }

      // 3.5 footer 聚合行：点击列单元格打开聚合函数菜单
      var fh = self._footerH()
      if (fh && y >= self._cssH - fh) {
        if (x >= self.GUTTER) {
          var ac = self._hitTest(x, self.headerHeight + 1)
          if (ac.col >= 0) self._openAggMenu(ac.col)
        }
        return
      }

      // 4. 添加行占位
      if (self._addRowY !== undefined && y >= self._addRowY && y < self._addRowY + self.rowHeight && !self._remote) {
        var idx = self.addRow({})
        if (idx >= 0) {
          self.setActiveCell(idx, 0)
          self.scrollToCell(idx, 0)
        }
        return
      }

      // 5. 单元格选择
      var cell = self._hitTest(x, y)
      if (cell.row < 0) return
      if (cell.col < 0) return
      if (e.shiftKey && self.activeCell) {
        self._dragging = 'select'
        self.selection = {
          start: { row: self.activeCell.row, col: self.activeCell.col },
          end: { row: cell.row, col: cell.col },
        }
        self._updateRangeSelectedRows()
      } else {
        var col = self.columns[cell.col]
        var rend = cellRenderers[col.type] || cellRenderers.text
        // 交互式单元格（对应 nocodb CellRenderer.handleCellClick / getInteractRange）
        if (rend.onClick) {
          var crect = self.cellRect(cell.row, cell.col)
          var crow = self._rowAt(cell.row)
          self.setActiveCell(cell.row, cell.col)
          if (crow && rend.onClick({
            x: crect.x, y: crect.y, width: crect.width, height: crect.height,
            column: col, row: crow, rowIndex: cell.row, table: self,
          }, x - crect.x, y - crect.y)) {
            self.scheduleRender()
            return
          }
          self._dragging = 'select'
          self.scheduleRender()
          return
        }
        self.setActiveCell(cell.row, cell.col)
        self._dragging = 'select'
        if (col.type === 'checkbox') {
          self.updateCell(cell.row, col.key, undefined, { toggle: true })
        } else if (col.type === 'select') {
          self.makeCellEditable()
        }
      }
      self.scheduleRender()
    })

    canvas.addEventListener('dblclick', function (e) {
      var pos = self._pos(e)
      if (pos.y < self.headerHeight || pos.x < self.GUTTER) return
      var cell = self._hitTest(pos.x, pos.y)
      if (cell.col < 0 || cell.row < 0) return
      self.setActiveCell(cell.row, cell.col)
      var col = self.columns[cell.col]
      if (col.type === 'checkbox') self.updateCell(cell.row, col.key, undefined, { toggle: true })
      else self.makeCellEditable()
    })

    // 右键列头打开列菜单（对应 nocodb MouseClickType.RIGHT_CLICK）
    canvas.addEventListener('contextmenu', function (e) {
      var pos = self._pos(e)
      if (pos.y >= self.headerHeight || pos.x < self.GUTTER) return
      if (pos.y < self._groupH()) {
        var gci = self._hitGroupBand(pos.x)
        if (gci >= 0) { self._closeMenu(); self._openGroupMenu(gci); return }
        // 未分组列（整高表头）：继续打开列菜单
      }
      var hc = self._hitHeaderCol(pos.x)
      if (hc < 0) return
      e.preventDefault()
      self._setCurrentCol(hc)
      self._openMenu(hc)
    })

    canvas.addEventListener('mousemove', function (e) {
      var pos = self._pos(e)
      var x = pos.x, y = pos.y
      var rc = self._hitResize(x, y)
      if (rc !== self._hoverResizeCol) {
        self._hoverResizeCol = rc
        self.scheduleRender()
      }
      var dd = self._hitHeaderDropdown(x, y)
      if (dd !== self._hoverMenuCol) {
        self._hoverMenuCol = dd
        self.scheduleRender()
      }
      if (self._dragging === 'resize') { canvas.style.cursor = 'col-resize'; return }
      if (self._dragging === 'fill') { canvas.style.cursor = 'crosshair'; return }
      if (self._colDrag && self._colDrag.active) { canvas.style.cursor = 'grabbing'; return }
      var overAddRow = self._addRowY !== undefined && y >= self._addRowY && y < self._addRowY + self.rowHeight && x >= self.GUTTER
      var overAgg = self._footerH() && y >= self._cssH - self._footerH() && x >= self.GUTTER
      // 交互式单元格的自定义光标（renderer.cursor）
      var icur = null
      if (rc === null && dd === null && y >= self.headerHeight && x >= self.GUTTER) {
        var hc = self._hitTest(x, y)
        if (hc.row >= 0 && hc.col >= 0) {
          var hcol = self.columns[hc.col]
          var hr = cellRenderers[hcol.type] || cellRenderers.text
          var hrow = self._rowAt(hc.row)
          if (hr.cursor && hrow) {
            var hrect = self.cellRect(hc.row, hc.col)
            icur = hr.cursor({
              x: hrect.x, y: hrect.y, width: hrect.width, height: hrect.height,
              column: hcol, row: hrow, rowIndex: hc.row, table: self,
            }, x - hrect.x, y - hrect.y) || null
          }
        }
      }
      // 悬停可拖序列头显示 grab（冻结列/只读除外，与 nocodb 一致不可拖；分组列仅叶子行可拖）
      var hgrab = null
      if (rc === null && dd === null && y < self.headerHeight && x >= self.GUTTER && !self.readOnly) {
        var hgc = self._hitHeaderCol(x)
        if (hgc >= 0 && !self.columns[hgc].fixed && y >= self._colHeadTop(self.columns[hgc])) hgrab = 'grab'
      }
      var hband = y < self._groupH() && x >= self.GUTTER && self._hitGroupBand(x) >= 0
      canvas.style.cursor = rc !== null ? 'col-resize' : dd !== null ? 'pointer' : icur || (self._fillHandlerHit(x, y) ? 'crosshair' : overAgg ? 'pointer' : overAddRow ? 'pointer' : hband ? 'pointer' : hgrab || 'default')

      if (self._dragging === 'select' && y >= self.headerHeight && x >= self.GUTTER) {
        var cell = self._hitTest(x, y)
        if (cell.col >= 0 && cell.row >= 0 && self.selection) {
          // 对应 useMouseSelection：限制拖选行数上限
          var start = self.selection.start.row
          var maxRow = Math.max(start, cell.row)
          var minRow = Math.min(start, cell.row)
          if (maxRow - minRow >= MAX_SELECTED_ROWS) {
            var dir = cell.row > start ? 1 : -1
            cell.row = Math.max(0, Math.min(start + (MAX_SELECTED_ROWS - 1) * dir, self.totalRows - 1))
          }
          self.selection.end = { row: cell.row, col: cell.col }
          self._updateRangeSelectedRows()
          self.scrollToEdge(cell)
          self.scheduleRender()
        }
      }
    })

    canvas.addEventListener('mouseleave', function () {
      if (self._hoverResizeCol !== null) {
        self._hoverResizeCol = null
        self.scheduleRender()
      }
    })
  }

  NcTable.prototype.scrollToEdge = function (cell) {
    var edge = 4
    var y = this._rowY(cell.row)
    if (y < this.headerHeight + 1) this.setScroll(cell.row * this.rowHeight, this.scrollLeft)
    else if (y + this.rowHeight > this._cssH - edge) this.setScroll((cell.row + 1) * this.rowHeight - this._viewH, this.scrollLeft)
    if (this.columns[cell.col].fixed) return
    var x = this._colX(cell.col)
    var viewLeft = this.GUTTER + this._fixedWidth()
    if (x < viewLeft + 1) this.setScroll(this.scrollTop, this.scrollLeft - (viewLeft - x) - 1)
    else if (x + this.columns[cell.col].width > this._cssW - edge) this.setScroll(this.scrollTop, this.scrollLeft + (x + this.columns[cell.col].width - this._cssW) + edge)
  }

  NcTable.prototype._onResizeMove = function (e) {
    if (this._dragging !== 'resize' || !this._resizeCol) return
    var rect = this.canvas.getBoundingClientRect()
    var x = e.clientX - rect.left
    var delta = x - this._resizeCol.startX
    var newWidth = Math.max(MIN_COLUMN_WIDTH, this._resizeCol.initialWidth + delta)
    var col = this.columns[this._resizeCol.colIndex]
    if (col.width !== newWidth) {
      col.width = newWidth
      this._emit('column-resize', { column: col, width: newWidth })
      this.scheduleRender()
    }
  }

  NcTable.prototype._onResizeEnd = function () {
    if (this._dragging !== 'resize' || !this._resizeCol) return
    var col = this.columns[this._resizeCol.colIndex]
    this._emit('column-resize-end', { column: col, width: col.width })
    this._resizeCol = null
    this._dragging = false
  }

  NcTable.prototype._bindKeyboard = function () {
    var self = this
    // 对应 useKeyboardNavigation
    this.canvas.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); self.openSearch(); return }
      if (self.editing) return
      var a = self.activeCell
      if (!a) return
      var handled = true
      switch (e.key) {
        case 'ArrowUp': self._moveActive(-1, 0, e.shiftKey); break
        case 'ArrowDown': self._moveActive(1, 0, e.shiftKey); break
        case 'ArrowLeft': self._moveActive(0, -1, e.shiftKey); break
        case 'ArrowRight': self._moveActive(0, 1, e.shiftKey); break
        case 'Tab': self._moveActive(0, e.shiftKey ? -1 : 1, false); break
        case 'Enter': {
          var col = self.columns[a.col]
          var er = cellRenderers[col.type] || cellRenderers.text
          if (col.type === 'checkbox') self.updateCell(a.row, col.key, undefined, { toggle: true })
          else if (er.onClick) {
            var erect = self.cellRect(a.row, a.col)
            var erow = self._rowAt(a.row)
            var eparams = {
              x: erect.x, y: erect.y, width: erect.width, height: erect.height,
              column: col, row: erow, rowIndex: a.row, table: self,
            }
            if (erow) {
              if (er.onActivate) er.onActivate(eparams)
              else er.onClick(eparams, erect.width / 2, erect.height / 2)
            }
          } else self.makeCellEditable()
          break
        }
        case 'F2': self.makeCellEditable(); break
        case ' ': {
          var scol = self.columns[a.col]
          if (scol.type === 'checkbox') self.updateCell(a.row, scol.key, undefined, { toggle: true })
          else handled = false
          break
        }
        case 'Escape':
          self.setActiveCell(a.row, a.col)
          break
        case 'Delete':
        case 'Backspace':
          self._clearSelection()
          break
        case 'PageDown': self._moveActive(Math.floor(self._viewH / self.rowHeight), 0, false); break
        case 'PageUp': self._moveActive(-Math.floor(self._viewH / self.rowHeight), 0, false); break
        case 'Home':
          if (e.ctrlKey) self._moveActive(-a.row, 0, false)
          else self._moveActive(0, -a.col, false)
          break
        case 'End':
          if (e.ctrlKey) self._moveActive(self.totalRows - 1 - a.row, 0, false)
          else self._moveActive(0, self.columns.length - 1 - a.col, false)
          break
        default:
          var rend = cellRenderers[self.columns[a.col].type] || cellRenderers.text
          if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && rend.editType && rend.editType.indexOf('input') === 0) {
            self.makeCellEditable(e.key)
          } else if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) {
            if (self.totalRows) {
              self.activeCell = { row: 0, col: 0 }
              self.selection = { start: { row: 0, col: 0 }, end: { row: self.totalRows - 1, col: self.columns.length - 1 } }
              self._updateRangeSelectedRows()
              self._emit('selection-change', { range: self.selection })
              self.scheduleRender()
            }
          } else handled = false
      }
      if (handled) e.preventDefault()
    })
  }

  NcTable.prototype._moveActive = function (dRow, dCol, extend) {
    var a = this.activeCell
    if (!a) {
      if (this.totalRows) this.setActiveCell(0, 0)
      return
    }
    var row = Math.max(0, Math.min(a.row + dRow, this.totalRows - 1))
    var col = Math.max(0, Math.min(a.col + dCol, this.columns.length - 1))
    if (extend && this.selection) {
      this.selection.end = { row: row, col: col }
      this.activeCell = { row: row, col: col }
      this._updateRangeSelectedRows()
      this._emit('selection-change', { active: this.activeCell, range: this.selection })
    } else {
      this.commitEdit()
      this.setActiveCell(row, col)
    }
    this.scrollToCell(row, col)
    this.scheduleRender()
  }

  NcTable.prototype._clearSelection = function () {
    if (this.readOnly || !this.selection) return
    var sel = this.selection
    var r0 = Math.min(sel.start.row, sel.end.row)
    var r1 = Math.max(sel.start.row, sel.end.row)
    var c0 = Math.min(sel.start.col, sel.end.col)
    var c1 = Math.max(sel.start.col, sel.end.col)
    var changed = []
    for (var r = r0; r <= r1; r++) {
      var row = this._rowAt(r)
      if (!row) continue
      for (var c = c0; c <= c1; c++) {
        var col = this.columns[c]
        if (col.type === 'checkbox') continue
        var empty = null
        if (row[col.key] !== empty) {
          var prev = row[col.key]
          row[col.key] = empty
          changed.push({ row: row, rowIndex: r, column: col, value: empty, prev: prev })
        }
      }
    }
    var self = this
    changed.forEach(function (e) { self._emit('cell-change', e) })
    this.scheduleRender()
  }

  // ------------------------------------------------ 填充手柄（useFillHandler）
  var FILL_HANDLE_SIZE = 10

  NcTable.prototype._fillHandlerHit = function (x, y) {
    if (this.readOnly) return false
    var q = this._selectionRect()
    if (!q) return false
    var h = FILL_HANDLE_SIZE / 2 + 3
    return Math.abs(x - q.right) <= h && Math.abs(y - q.bottom) <= h
  }

  NcTable.prototype._startFill = function () {
    var q = this._selectionRect()
    if (!q) return
    this._dragging = 'fill'
    this._fill = { r0: q.r0, r1: q.r1, c0: q.c0, c1: q.c1, target: q.r1, applied: {} }
    document.body.style.userSelect = 'none'
  }

  // 将选区 r0..r1 的行值模式重复填充到 [lo..hi]；lo > hi 表示全部回滚为原值
  NcTable.prototype._applyFill = function (lo, hi) {
    var f = this._fill
    var self = this
    var span = f.r1 - f.r0 + 1
    function srcRow(tr) {
      var k = (tr - f.r0) % span
      if (k < 0) k += span
      return f.r0 + k
    }
    Object.keys(f.applied).forEach(function (key) {
      var tr = Number(key)
      if (tr >= lo && tr <= hi) return
      var row = self._rowAt(tr)
      var originals = f.applied[tr]
      if (row) {
        Object.keys(originals).forEach(function (k) {
          var prev = row[k], next = originals[k]
          if (prev !== next) {
            row[k] = next
            self._emit('cell-change', { row: row, rowIndex: tr, column: self._colByKey(k), prev: prev, value: next })
          }
        })
      }
      delete f.applied[tr]
    })
    for (var tr = lo; tr <= hi; tr++) {
      if (tr >= f.r0 && tr <= f.r1) continue
      var row = self._rowAt(tr)
      var src = self._rowAt(srcRow(tr))
      if (!row || !src) continue
      if (!f.applied[tr]) f.applied[tr] = {}
      for (var c = f.c0; c <= f.c1; c++) {
        var col = self.columns[c]
        if (!(col.key in f.applied[tr])) f.applied[tr][col.key] = row[col.key]
        var next = src[col.key]
        if (row[col.key] !== next) {
          var prev = row[col.key]
          row[col.key] = next
          self._emit('cell-change', { row: row, rowIndex: tr, column: col, prev: prev, value: next })
        }
      }
    }
  }

  NcTable.prototype._onFillMove = function (e) {
    if (this._dragging !== 'fill' || !this._fill) return
    var pos = this._pos(e)
    var row = Math.floor((pos.y - this.headerHeight + this.scrollTop) / this.rowHeight)
    row = Math.max(0, Math.min(row, this.totalRows - 1))
    var f = this._fill
    if (row === f.target) return
    f.target = row
    if (row > f.r1) this._applyFill(f.r1 + 1, row)
    else if (row < f.r0) this._applyFill(row, f.r0 - 1)
    else this._applyFill(0, -1)
    this.scheduleRender()
  }

  NcTable.prototype._onFillEnd = function () {
    if (this._dragging !== 'fill') return
    this._dragging = false
    this._fill = null
    document.body.style.userSelect = ''
  }

  NcTable.prototype._toggleRowSelection = function (rowIndex) {
    var has = this.selectedRows.has(rowIndex)
    if (this.rowSelection === 'single') {
      this.selectedRows.clear()
      if (!has) this.selectedRows.add(rowIndex)
    } else if (has) this.selectedRows.delete(rowIndex)
    else this.selectedRows.add(rowIndex)
    this._emit('row-check', {
      rowIndex: rowIndex,
      checked: !has,
      selectedRows: Array.from(this.selectedRows).sort(function (a, b) { return a - b }),
    })
    this.scheduleRender()
  }

  NcTable.prototype._toggleSelectAll = function () {
    if (this.rowSelection === 'single') return // 单选模式无全选语义
    if (this.selectedRows.size > 0) this.selectedRows.clear()
    else for (var i = 0; i < this.totalRows; i++) this.selectedRows.add(i)
    this._emit('row-check', { all: true, selectedRows: Array.from(this.selectedRows) })
    this.scheduleRender()
  }

  // 运行时切换行勾选模式；切到 single 时已有多个勾选只保留最小行号
  NcTable.prototype.setRowSelection = function (mode) {
    mode = mode === 'single' ? 'single' : 'multiple'
    if (mode === this.rowSelection) return
    this.rowSelection = mode
    if (mode === 'single' && this.selectedRows.size > 1) {
      var first = Math.min.apply(null, Array.from(this.selectedRows))
      this.selectedRows.clear()
      this.selectedRows.add(first)
      this._emit('row-check', { rowIndex: first, checked: true, selectedRows: [first] })
    }
    this.scheduleRender()
  }

  // -------------------------------------------------- 查询定位（表头浮层）
  var SEARCH_MAX = 5000 // 匹配上限，防止大表逐帧高亮开销失控

  NcTable.prototype._buildSearchBar = function () {
    var self = this
    var bar = this.searchBar
    bar.innerHTML = ''
    var input = document.createElement('input')
    input.type = 'text'
    input.placeholder = '查询内容，Enter 下一个 / Shift+Enter 上一个，Esc 关闭'
    var prev = document.createElement('button')
    prev.type = 'button'
    prev.textContent = '↑'
    prev.title = '查询上一个 (Shift+Enter)'
    var next = document.createElement('button')
    next.type = 'button'
    next.textContent = '↓'
    next.title = '查询下一个 (Enter)'
    var count = document.createElement('span')
    count.className = 'nc-table__search-count'
    var close = document.createElement('button')
    close.type = 'button'
    close.className = 'nc-table__search-close'
    close.textContent = '✕'
    close.title = '关闭 (Esc)'
    bar.appendChild(input)
    bar.appendChild(prev)
    bar.appendChild(next)
    bar.appendChild(count)
    bar.appendChild(close)
    this._searchInput = input
    this._searchCount = count

    input.addEventListener('input', function () {
      self._search.query = input.value
      self._searchCompute()
      self._searchGo(1, true) // 自动定位到第一个匹配
      self._emit('search', self._searchInfo())
    })
    input.addEventListener('keydown', function (e) {
      e.stopPropagation()
      if (e.key === 'Enter') { e.preventDefault(); self._searchGo(e.shiftKey ? -1 : 1); self._emit('search', self._searchInfo()) }
      else if (e.key === 'Escape') { e.preventDefault(); self.closeSearch() }
    })
    next.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation() })
    next.addEventListener('click', function () { self._searchGo(1); self._emit('search', self._searchInfo()); input.focus() })
    prev.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation() })
    prev.addEventListener('click', function () { self._searchGo(-1); self._emit('search', self._searchInfo()); input.focus() })
    close.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation() })
    close.addEventListener('click', function () { self.closeSearch() })
  }

  NcTable.prototype._searchInfo = function () {
    var s = this._search
    return {
      query: s.query,
      total: s.matches.length,
      index: s.index,
      match: s.index >= 0 && s.matches[s.index] ? { row: s.matches[s.index].row, col: s.matches[s.index].col } : null,
    }
  }

  // 按“显示文本”匹配（formatter/默认格式化，与渲染/复制/导出一致），大小写不敏感，行优先、列按显示顺序
  NcTable.prototype._searchCompute = function () {
    var s = this._search
    s.matches = []
    s.index = -1
    this._searchDirty = false
    var q = String(s.query || '').toLowerCase()
    this._searchCount.textContent = ''
    if (!q) { this.scheduleRender(); return }
    outer: for (var r = 0; r < this.totalRows; r++) {
      var row = this._rowAt(r)
      if (!row) continue
      for (var c = 0; c < this.columns.length; c++) {
        var col = this.columns[c]
        var v = row[col.key]
        var text = col.formatter ? col.formatter(v, col, row) : defaultFormatter(v, col)
        if (text && String(text).toLowerCase().indexOf(q) >= 0) {
          s.matches.push({ row: r, col: c })
          if (s.matches.length >= SEARCH_MAX) break outer
        }
      }
    }
    this._searchCount.textContent = s.matches.length ? String(s.matches.length) : '无匹配'
    this.scheduleRender()
  }

  // step=1 下一个 / -1 上一个，循环环绕；first=true 仅定位到 0 号匹配
  NcTable.prototype._searchGo = function (step, first) {
    var s = this._search
    if (this._searchDirty) this._searchCompute()
    if (!s.matches.length) { this.scheduleRender(); return }
    s.index = first ? 0 : (s.index + step + s.matches.length) % s.matches.length
    var m = s.matches[s.index]
    this.setActiveCell(m.row, m.col)
    this.scrollToCell(m.row, m.col)
    this._searchCount.textContent = (s.index + 1) + '/' + s.matches.length
    this.scheduleRender()
  }

  NcTable.prototype.searchNext = function () { this._searchGo(1); this._emit('search', this._searchInfo()) }
  NcTable.prototype.searchPrev = function () { this._searchGo(-1); this._emit('search', this._searchInfo()) }

  NcTable.prototype.openSearch = function () {
    this._closeMenu()
    this._closeFilterPanel()
    this._closePopup()
    this.searchBar.style.top = '1px'
    this.searchBar.style.height = (this.headerHeight - 2) + 'px'
    this.searchBar.style.display = 'flex'
    this._searchDirty = true
    if (this._search.query) this._searchCompute()
    this._searchInput.focus()
    this._searchInput.select()
    this.scheduleRender()
  }

  NcTable.prototype.closeSearch = function () {
    this.searchBar.style.display = 'none'
    this._search.query = ''
    this._search.matches = []
    this._search.index = -1
    this.canvas.focus({ preventScroll: true })
    this.scheduleRender()
  }

  // ----------------------------------------------------------- listener
  NcTable.prototype.on = function (event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn)
    return this
  }

  NcTable.prototype.off = function (event, fn) {
    if (!this._listeners[event]) return this
    this._listeners[event] = this._listeners[event].filter(function (f) { return f !== fn })
    return this
  }

  NcTable.prototype._emit = function (event, payload) {
    var optionName = 'on' + event.replace(/(^|[-_])(\w)/g, function (_, __, ch) { return ch.toUpperCase() })
    if (typeof this.options[optionName] === 'function') {
      try { this.options[optionName](payload) } catch (e) { console.error(e) }
    }
    ;(this._listeners[event] || []).forEach(function (fn) {
      try { fn(payload) } catch (e) { console.error(e) }
    })
    this.el.dispatchEvent(new CustomEvent('nc-table:' + event, { detail: payload, bubbles: true }))
  }

  // ------------------------------------------------------ Excel (.xlsx) 导出
  // 纯 JS 生成 xlsx（OOXML SpreadsheetML 打包为 ZIP，STORE 不压缩），无第三方依赖
  var _CRC_TABLE = null
  function crc32(bytes) {
    if (!_CRC_TABLE) {
      _CRC_TABLE = new Uint32Array(256)
      for (var n = 0; n < 256; n++) {
        var c = n
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
        _CRC_TABLE[n] = c >>> 0
      }
    }
    var crc = 0xFFFFFFFF
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ _CRC_TABLE[(crc ^ bytes[i]) & 0xFF]
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
  function colLetter(idx) {
    var s = '', i = idx + 1
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) }
    return s
  }
  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function zipStore(files) {
    var enc = new TextEncoder()
    var now = new Date()
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF
    var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF
    var chunks = [], central = [], offset = 0
    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name)
      var crc = crc32(f.data)
      var lh = new DataView(new ArrayBuffer(30))
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true)
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true)
      lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true)
      lh.setUint16(26, nameBytes.length, true); lh.setUint16(28, 0, true)
      chunks.push(new Uint8Array(lh.buffer), nameBytes, f.data)
      var cd = new DataView(new ArrayBuffer(46))
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true)
      cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true); cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true)
      cd.setUint32(16, crc, true); cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true)
      cd.setUint16(28, nameBytes.length, true); cd.setUint16(30, 0, true); cd.setUint16(32, 0, true)
      cd.setUint16(34, 0, true); cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true)
      central.push(new Uint8Array(cd.buffer), nameBytes)
      offset += 30 + nameBytes.length + f.data.length
    })
    var cdSize = 0
    central.forEach(function (c) { cdSize += c.length })
    var eocd = new DataView(new ArrayBuffer(22))
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true)
    eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true); eocd.setUint16(20, 0, true)
    var out = new Uint8Array(offset + cdSize + 22), p = 0
    chunks.concat(central).forEach(function (c) { out.set(c, p); p += c.length })
    out.set(new Uint8Array(eocd.buffer), p)
    return out
  }

  // 导出内容：opts.rows / opts.columns 可覆盖默认（默认取当前可见列 + 当前视图行）
  NcTable.prototype.buildXlsx = function (opts) {
    opts = opts || {}
    var self = this
    var cols = opts.columns || this.columns
    var rows = opts.rows
    if (!rows) {
      rows = []
      for (var i = 0; i < this.totalRows; i++) { var r = this._rowAt(i); if (r) rows.push(r) }
    }
    var sheetName = opts.sheetName || 'Sheet1'
    var enc = new TextEncoder()
    // 两行表头：含分组列时第一行为组带（横向合并），未分组列纵向合并两行
    var hasGroup = false
    for (var hg = 0; hg < cols.length; hg++) if (cols[hg].group) { hasGroup = true; break }
    var merges = []
    var s = ''
    s += '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    s += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    // CT_Worksheet 子元素顺序：sheetViews 必须在 cols 之前（Excel 严格校验）
    s += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + (hasGroup ? 2 : 1) +
      '" topLeftCell="A' + (hasGroup ? 3 : 2) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    // 列宽：像素近似换算为 Excel 字符宽（Calibri 11，MDW≈7px），与表格列宽保持一致
    s += '<cols>'
    for (var wc = 0; wc < cols.length; wc++) {
      var charW = Math.max(8, Math.min(80, Math.round(((cols[wc].width || 200) - 5) / 7 * 100) / 100))
      s += '<col min="' + (wc + 1) + '" max="' + (wc + 1) + '" width="' + charW + '" customWidth="1"/>'
    }
    s += '</cols>'
    s += '<sheetData>'
    if (hasGroup) {
      s += '<row r="1">'
      var cc = 0
      while (cc < cols.length) {
        var g = cols[cc].group
        if (!g) {
          s += '<c r="' + colLetter(cc) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cols[cc].title) + '</t></is></c>'
          merges.push(colLetter(cc) + '1:' + colLetter(cc) + '2') // 未分组列纵向合并
          cc++
          continue
        }
        var ee = cc
        while (ee + 1 < cols.length && cols[ee + 1].group && cols[ee + 1].group.key === g.key) ee++
        s += '<c r="' + colLetter(cc) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(g.title) + '</t></is></c>'
        for (var mk = cc + 1; mk <= ee; mk++) s += '<c r="' + colLetter(mk) + '1" s="1"/>'
        if (ee > cc) merges.push(colLetter(cc) + '1:' + colLetter(ee) + '1') // 组带横向合并
        cc = ee + 1
      }
      s += '</row>'
      s += '<row r="2">'
      for (var c2 = 0; c2 < cols.length; c2++) {
        if (!cols[c2].group) { s += '<c r="' + colLetter(c2) + '2" s="1"/>'; continue }
        s += '<c r="' + colLetter(c2) + '2" s="1" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cols[c2].title) + '</t></is></c>'
      }
      s += '</row>'
    } else {
      s += '<row r="1">'
      for (var c = 0; c < cols.length; c++) {
        s += '<c r="' + colLetter(c) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(cols[c].title) + '</t></is></c>'
      }
      s += '</row>'
    }
    var dataStart = hasGroup ? 3 : 2
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri], rn = ri + dataStart
      s += '<row r="' + rn + '">'
      for (var ci = 0; ci < cols.length; ci++) {
        var col = cols[ci], v = row[col.key]
        var ref = colLetter(ci) + rn
        var ea = effAlign(col) // 数据对齐与表格设置一致：s=2 左 / 3 中 / 4 右
        var st = ea === 'center' ? 3 : ea === 'right' ? 4 : 2
        if (v === null || v === undefined || v === '') { s += '<c r="' + ref + '" s="' + st + '"/>'; continue }
        if (typeof v === 'number' && isFinite(v)) {
          s += '<c r="' + ref + '" s="' + st + '"><v>' + v + '</v></c>'
        } else {
          var disp = col.formatter ? col.formatter(v, col, row) : defaultFormatter(v, col)
          if (disp === '') { s += '<c r="' + ref + '" s="' + st + '"/>'; continue }
          s += '<c r="' + ref + '" s="' + st + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(disp) + '</t></is></c>'
        }
      }
      s += '</row>'
    }
    s += '</sheetData>'
    if (merges.length) {
      s += '<mergeCells count="' + merges.length + '">'
      for (var mi = 0; mi < merges.length; mi++) s += '<mergeCell ref="' + merges[mi] + '"/>'
      s += '</mergeCells>'
    }
    s += '</worksheet>'
    var CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>'
    var RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
    var WB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xmlEsc(sheetName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>'
    var WBRELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>'
    var STY = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF374151"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F4F5"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFD5D5D9"/></left><right style="thin"><color rgb="FFD5D5D9"/></right>' +
      '<top style="thin"><color rgb="FFD5D5D9"/></top><bottom style="thin"><color rgb="FFD5D5D9"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    var files = [
      { name: '[Content_Types].xml', data: enc.encode(CT) },
      { name: '_rels/.rels', data: enc.encode(RELS) },
      { name: 'xl/workbook.xml', data: enc.encode(WB) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(WBRELS) },
      { name: 'xl/styles.xml', data: enc.encode(STY) },
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(s) },
    ]
    return zipStore(files)
  }

  NcTable.prototype.exportExcel = function (filename, opts) {
    var bytes = this.buildXlsx(opts)
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = filename || 'table.xlsx'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
    this._emit('export', { filename: a.download, rows: (opts && opts.rows ? opts.rows.length : this.totalRows), bytes: bytes.length })
    return bytes
  }

  NcTable.prototype.destroy = function () {
    var self = this
    window.removeEventListener('mousemove', this._onWinMouseMove)
    window.removeEventListener('mouseup', this._onWinMouseUp)
    window.removeEventListener('resize', this._onResize)
    document.removeEventListener('mousedown', this._onDocMouseDown, true)
    if (this._raf) cancelAnimationFrame(this._raf)
    this.el.innerHTML = ''
    this.el.classList.remove('nc-table')
    if (this._nc_table_prev) this.el._ncTable = this._nc_table_prev
    else delete this.el._ncTable
  }

  return NcTable
})
