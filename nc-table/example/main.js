/* NcTable 用法示例 */
(function () {
  'use strict'

  console.log('[nc-table demo] build 2026-09-17d sidebar-rownav | core', NcTable.VERSION) // 版本标记：控制台可见，用于确认未命中旧缓存

  var logEl = document.getElementById('log')
  function log(ev, msg) {
    var d = document.createElement('div')
    var t = new Date().toLocaleTimeString()
    d.innerHTML = '<span class="ts">' + t + '</span> <span class="ev">[' + ev + ']</span> ' + msg
    logEl.prepend(d)
    while (logEl.children.length > 80) logEl.removeChild(logEl.lastChild)
  }

  // ------------------------------------------------ 自定义单元格类型（操作列：编辑/删除按钮）
  function opsRects(h) {
    var bh = 22, y = (h - bh) / 2
    return {
      edit: { x: 8, y: y, w: 46, h: bh },
      del: { x: 62, y: y, w: 46, h: bh },
    }
  }
  function hitOpsButton(mx, my, h) {
    var r = opsRects(h)
    function inR(b) { return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h }
    if (inR(r.edit)) return 'edit'
    if (inR(r.del)) return 'del'
    return null
  }
  function drawButton(ctx, px, py, b, label, filled) {
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(px + b.x, py + b.y, b.w, b.h, 4)
    else ctx.rect(px + b.x, py + b.y, b.w, b.h)
    if (filled) {
      ctx.fillStyle = '#7157d1'
      ctx.fill()
    } else {
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.strokeStyle = '#f0b4b4'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.fillStyle = filled ? '#fff' : '#e24d4d'
    ctx.font = '500 12px Inter, ui-sans-serif, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, px + b.x + b.w / 2, py + b.y + b.h / 2 + 0.5)
    ctx.textAlign = 'left'
  }
  function opsEdit(p) {
    var v = prompt('编辑第 ' + (p.rowIndex + 1) + ' 行标题：', p.row.title == null ? '' : p.row.title)
    if (v !== null) p.table.updateCell(p.rowIndex, 'title', v)
  }
  function opsDelete(p) {
    if (confirm('删除第 ' + (p.rowIndex + 1) + ' 行（' + (p.row.title || '') + '）？')) p.table.deleteRows([p.rowIndex])
  }
  NcTable.registerCellType('buttons', {
    editType: null, // 不走单元格编辑器，点击路由到 onClick
    cursor: function (p, mx, my) { return hitOpsButton(mx, my, p.height) ? 'pointer' : null },
    onClick: function (p, mx, my) {
      var b = hitOpsButton(mx, my, p.height)
      if (!b) return false
      if (b === 'edit') opsEdit(p)
      else opsDelete(p)
      return true
    },
    onActivate: function (p) { opsEdit(p) }, // Enter 触发主操作（编辑）
    render: function (ctx, p) {
      var r = opsRects(p.height)
      drawButton(ctx, p.x, p.y, r.edit, '编辑', true)
      drawButton(ctx, p.x, p.y, r.del, '删除', false)
    },
  })

  // ------------------------------------------------ 自定义单元格类型（进度条，可编辑）
  NcTable.registerCellType('progress', {
    editType: 'input-number', // 双击/F2/直接键入 -> 数字编辑器（0-100）
    parse: function (raw) {
      var s = String(raw === null || raw === undefined ? '' : raw).trim().replace(/%$/, '')
      if (s === '') return null
      var n = Number(s)
      return isNaN(n) ? s : Math.max(0, Math.min(100, n))
    },
    render: function (ctx, p) {
      var v = Math.max(0, Math.min(Number(p.value) || 0, 100))
      var w = p.width - 16
      ctx.fillStyle = '#ececf1'
      ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(p.x + 8, p.y + p.height / 2 - 4, w, 8, 4) : ctx.rect(p.x + 8, p.y + p.height / 2 - 4, w, 8)
      ctx.fill()
      ctx.fillStyle = v > 80 ? '#1fa958' : '#7157d1'
      ctx.beginPath()
      var fw = Math.max(8, (w * v) / 100)
      ctx.roundRect ? ctx.roundRect(p.x + 8, p.y + p.height / 2 - 4, fw, 8, 4) : ctx.rect(p.x + 8, p.y + p.height / 2 - 4, fw, 8)
      ctx.fill()
      ctx.fillStyle = '#4a5268'
      ctx.font = '500 11px Inter, sans-serif'
      ctx.textBaseline = 'bottom'
      ctx.fillText(v + '%', p.x + 8, p.y + p.height / 2 - 8)
    },
  })

  // ------------------------------------------------ 自定义单元格类型（开关列）
  function switchRect(h) {
    var w = 36, th = 20
    return { x: 8, y: (h - th) / 2, w: w, h: th }
  }
  NcTable.registerCellType('switch', {
    editType: null, // 不走编辑器，单击/Enter 直接切换布尔值
    cursor: function () { return 'pointer' },
    onClick: function (p) {
      p.table.updateCell(p.rowIndex, p.column.key, !p.row[p.column.key])
      return true
    },
    onActivate: function (p) { p.table.updateCell(p.rowIndex, p.column.key, !p.row[p.column.key]) },
    render: function (ctx, p) {
      var r = switchRect(p.height)
      var on = !!p.value
      ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(p.x + r.x, p.y + r.y, r.w, r.h, r.h / 2) : ctx.rect(p.x + r.x, p.y + r.y, r.w, r.h)
      ctx.fillStyle = on ? '#7157d1' : '#d5d7de'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p.x + r.x + (on ? r.w - r.h / 2 : r.h / 2), p.y + r.y + r.h / 2, r.h / 2 - 3, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
    },
  })

  // ------------------------------------------------ 自定义单元格类型（弹框录入：备注列）
  function ellipsis(ctx, s, maxW) {
    if (ctx.measureText(s).width <= maxW) return s
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
    return s + '…'
  }
  function openDlg(p) {
    var key = p.column.key
    var mask = document.createElement('div')
    mask.className = 'dlg-mask'
    var box = document.createElement('div')
    box.className = 'dlg-box'
    var title = document.createElement('div')
    title.className = 'dlg-title'
    title.textContent = p.column.title + ' · 第 ' + (p.rowIndex + 1) + ' 行'
    var ta = document.createElement('textarea')
    ta.value = p.row[key] == null ? '' : String(p.row[key])
    var btns = document.createElement('div')
    btns.className = 'dlg-btns'
    var ok = document.createElement('button')
    ok.className = 'primary'
    ok.textContent = '确定'
    var cancel = document.createElement('button')
    cancel.textContent = '取消'
    function onKey(e) { if (e.key === 'Escape') close() }
    function close() {
      document.removeEventListener('keydown', onKey)
      if (mask.parentNode) mask.parentNode.removeChild(mask)
      p.table.focus()
    }
    ok.addEventListener('click', function () { p.table.updateCell(p.rowIndex, key, ta.value.trim()); close() })
    cancel.addEventListener('click', close)
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close() })
    document.addEventListener('keydown', onKey)
    btns.appendChild(cancel)
    btns.appendChild(ok)
    box.appendChild(title)
    box.appendChild(ta)
    box.appendChild(btns)
    mask.appendChild(box)
    document.body.appendChild(mask)
    ta.focus()
  }
  NcTable.registerCellType('dlg', {
    editType: null, // 不走行内编辑器，点击弹自定义对话框
    cursor: function () { return 'pointer' },
    onClick: function (p) { openDlg(p); return true },
    onActivate: function (p) { openDlg(p) },
    render: function (ctx, p) {
      var w = p.width - 16, h = 22, x = p.x + 8, y = p.y + (p.height - h) / 2
      ctx.save()
      ctx.beginPath()
      ctx.roundRect ? ctx.roundRect(x, y, w, h, 5) : ctx.rect(x, y, w, h)
      ctx.fillStyle = p.text ? '#f3f0fb' : '#fafafa'
      ctx.fill()
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = p.text ? '#c9bdf0' : '#c6cad3'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = '400 12px Inter, ui-sans-serif, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = p.text ? '#4a5268' : '#9aa0ab'
      ctx.fillText(ellipsis(ctx, p.text || '点击录入…', w - 24), x + 8, y + h / 2 + 0.5)
      ctx.fillStyle = '#7157d1'
      ctx.textAlign = 'right'
      ctx.fillText('✎', x + w - 8, y + h / 2 + 0.5)
      ctx.textAlign = 'left'
      ctx.restore()
    },
  })

  // --------------------------------------------------------------- 数据准备
  var STATUSES = ['todo', 'in progress', 'done', 'blocked']
  var PRIORITY = [
    { label: '高', value: 'high' },
    { label: '中', value: 'mid' },
    { label: '低', value: 'low' },
  ]
  var NAMES = ['张三', '李四', '王五', '赵六', 'Alice', 'Bob', 'Carol']

  function makeRow(i) {
    return {
      id: i + 1,
      title: '任务项 #' + (i + 1),
      status: STATUSES[i % STATUSES.length],
      priority: ['high', 'mid', 'low'][i % 3],
      assignee: NAMES[i % NAMES.length],
      hours: Math.round((i % 40) * 1.5 * 10) / 10,
      progress: (i * 37) % 101,
      due: '2026-0' + ((i % 9) + 1) + '-1' + (i % 9),
      checkin: '2026-09-0' + ((i % 9) + 1) + 'T0' + (i % 10) + ':30',
      note: i % 5 === 0 ? '备注 #' + (i + 1) : '',
      done: i % 4 === 0,
      enabled: i % 3 === 0,
      year: 2020 + (i % 7),
      ym: '2026-' + ('0' + ((i % 12) + 1)).slice(-2),
    }
  }

  var columns = [
    { key: 'id', title: 'ID', type: 'number', width: 80, fixed: true, sortable: false },
    { key: 'title', title: '标题', type: 'text', width: 200, fixed: true, placeholder: '输入标题...' },
    { key: 'status', title: '任务属性|状态', type: 'select', width: 150, options: STATUSES },
    { key: 'priority', title: '任务属性|优先级', type: 'select', width: 110, options: PRIORITY },
    { key: 'assignee', title: '负责人', type: 'text', width: 130, agg: 'distinct' },
    { key: 'hours', title: '投入统计|工时', type: 'number', width: 100, agg: 'sum' },
    { key: 'progress', title: '投入统计|进度', type: 'progress', width: 180, min: 0, max: 100, agg: 'avg' },
    { key: 'due', title: '时间信息|截止日期', type: 'date', width: 140 },
    { key: 'checkin', title: '时间信息|登记时间', type: 'datetime', width: 165 },
    { key: 'year', title: '时间信息|年份', type: 'year', width: 110 },
    { key: 'ym', title: '时间信息|年月', type: 'yearmonth', width: 130 },
    { key: 'note', title: '备注', type: 'dlg', width: 160, sortable: false },
    { key: 'done', title: '已完成', type: 'checkbox', width: 100 },
    { key: 'enabled', title: '开关', type: 'switch', width: 90 },
    { key: '_ops', title: '操作', type: 'buttons', width: 150, sortable: false },
  ]

  // --------------------------------------------------- 示例 1：本地数据模式
  var rows = []
  for (var i = 0; i < 1000; i++) rows.push(makeRow(i))

  var table1 = window.table1 = NcTable.mount('#table1', {
    columns: columns,
    rows: rows,
    rowSelection: 'single', // 行勾选单选模式：勾新行自动取消旧行，表头无全选框
    showAggregation: true, // 底部聚合行（footer row），点击聚合单元格可切换函数
    onCellChange: function (e) {
      log('cell-change', '第 ' + (e.rowIndex + 1) + ' 行 [' + e.column.title + ']：' + JSON.stringify(e.prev) + ' → ' + JSON.stringify(e.value))
    },
  })

  table1
    .on('sort', function (e) {
      log('sort', e.column.title + ' ' + (e.direction || '(取消排序)'))
    })
    .on('column-resize-end', function (e) {
      log('resize', e.column.title + ' 宽度 → ' + e.width + 'px')
    })
    .on('row-check', function (e) {
      log('row-check', '已勾选 ' + e.selectedRows.length + ' 行')
    })
    .on('selection-change', function (e) {
      if (e.range && (e.range.start.row !== e.range.end.row || e.range.start.col !== e.range.end.col)) {
        log('selection', '区域 R' + (e.range.start.row + 1) + 'C' + (e.range.start.col + 1) + ' ~ R' + (e.range.end.row + 1) + 'C' + (e.range.end.col + 1))
      }
    })
    .on('copy', function (e) {
      log(e.cut ? 'cut' : 'copy', (e.text || '').slice(0, 60).replace(/\n/g, '\\n') + ((e.text || '').length > 60 ? '…' : ''))
    })
    .on('paste', function (e) {
      log('paste', '写入 ' + e.cells + ' 个单元格')
    })
    .on('column-menu', function (e) {
      log('column-menu', '[' + e.column.title + '] 列设置菜单打开')
    })
    .on('column-update', function (e) {
      log('column-update', '[' + e.column.title + '] ' + JSON.stringify(e.patch))
    })
    .on('column-reorder', function (e) {
      log('column-reorder', '[' + e.column.title + '] 拖拽换位：第 ' + (e.from + 1) + ' 列 → 第 ' + (e.to + 1) + ' 列')
    })
    .on('search', function (e) {
      log('search', e.query ? '“' + e.query + '” 匹配 ' + e.total + ' 处' + (e.index >= 0 ? '，当前第 ' + (e.index + 1) + ' 处' : '') : '查询关闭')
    })
    .on('aggregation', function (e) {
      log('aggregation', '[' + e.column.title + '] ' + (e.fn || '无') + (e.value !== null && e.value !== undefined ? ' = ' + e.value : ''))
    })
    .on('column-hide', function (e) {
      log('column-hide', '[' + e.column.title + '] 已隐藏，共 ' + e.hidden.length + ' 列隐藏（可在任意列表头菜单恢复）')
    })
    .on('column-show', function (e) {
      log('column-show', '[' + e.column.title + '] 已恢复显示')
    })
    .on('column-delete', function (e) {
      log('column-delete', '[' + e.column.title + '] 已删除（行数据保留）')
    })
    .on('rows-delete', function (e) {
      log('rows-delete', '删除 ' + e.indexes.length + ' 行（操作列按钮/工具栏）')
    })
    .on('filter-change', function (e) {
      log('filter-change', e.values ? '[' + e.column.title + '] 保留 ' + e.values.length + ' 个值，共 ' + e.filters.length + ' 列筛选' : '筛选清除，当前 ' + e.filters.length + ' 列')
    })
    .on('column-insert', function (e) {
      var name = prompt('输入新字段名称（将插入到第 ' + (e.index + 1) + ' 列位置）', '新字段')
      if (name) table1.insertColumn({ key: 'f_' + Date.now(), title: name, type: 'text', width: 140 }, e.index)
    })
    .on('add-column', function () {
      var name = prompt('输入新字段名称（追加到末尾）', '新字段')
      if (name) table1.insertColumn({ key: 'f_' + Date.now(), title: name, type: 'text', width: 140 })
    })

  document.getElementById('btn-add').addEventListener('click', function () {
    var base = table1.totalRows
    for (var k = 0; k < 10; k++) table1.addRow(makeRow(base + k))
    log('api', 'addRow() x10，当前 ' + table1.totalRows + ' 行')
  })

  document.getElementById('btn-del').addEventListener('click', function () {
    var n = table1.selectedRows.size
    table1.deleteSelected()
    log('api', 'deleteSelected() 删除 ' + n + ' 行')
  })

  document.getElementById('btn-clearf').addEventListener('click', function () {
    table1.clearFilters()
    log('api', 'clearFilters() 已清除全部列筛选')
  })

  document.getElementById('btn-copy').addEventListener('click', function () {
    var text = table1.copyText()
    if (text === null) { log('api', 'copyText()：无选区'); return }
    log('api', 'copyText() → ' + JSON.stringify(text.slice(0, 60)) + (text.length > 60 ? '…' : ''))
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {})
    table1.focus()
  })

  var SAMPLE_TSV =
    '粘贴示例A\t粘贴中\t2027-01-01\ttrue\n' +
    '粘贴示例B\t低\t2027-02-02\tfalse\n' +
    '粘贴示例C\t高\t2027-03-03\ttrue'

  document.getElementById('btn-paste').addEventListener('click', function () {
    var n = table1.pasteText(SAMPLE_TSV)
    log('api', 'pasteText() 写入 ' + n + ' 个单元格（自活动单元格起，按列类型自动解析）')
    table1.focus()
  })

  document.getElementById('btn-export').addEventListener('click', function () {
    var bytes = table1.exportExcel('nc-table-demo.xlsx')
    log('api', 'exportExcel() 导出当前视图 ' + table1.totalRows + ' 行 × ' + table1.columns.length + ' 列，共 ' + bytes.length + ' 字节')
  })

  var seg = document.getElementById('seg-rowh')
  Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.remove('on') })
      b.classList.add('on')
      table1.setRowHeight(Number(b.dataset.h))
      log('api', 'setRowHeight(' + b.dataset.h + ')，对齐 nocodb rowHeightInPx')
    })
  })

  var segSel = document.getElementById('seg-rowsel')
  Array.prototype.forEach.call(segSel.querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(segSel.querySelectorAll('button'), function (x) { x.classList.remove('on') })
      b.classList.add('on')
      table1.setRowSelection(b.dataset.m)
      log('api', 'setRowSelection(' + b.dataset.m + ')' + (b.dataset.m === 'single' ? '：勾新行自动取消旧行，表头全选框隐藏' : '：恢复多选与表头全选'))
    })
  })

  document.getElementById('btn-search').addEventListener('click', function () {
    table1.openSearch()
  })

  document.getElementById('btn-focus').addEventListener('click', function () {
    table1.focus()
  })

  // ------------------------------------------- 右侧侧边栏（tabs：列属性 / 行数据 / 单元格 / 自定义）
  function $(id) { return document.getElementById(id) }
  var side = $('side')
  var tabsEl = $('side-tabs')
  var sideCell = $('side-cell')
  var sideNote = $('side-note')
  var sideActiveRow = -1

  function sideVisible() { return !side.hidden }
  function sideRefreshLayout() { window.dispatchEvent(new Event('resize')) } // 容器变宽后让画布重新测量
  function sideCol() { var ac = table1.activeCell; return ac ? table1.columns[ac.col] : null }

  // ---------- tab 切换 ----------
  function sideActivateTab(name) {
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.stab'), function (b) { b.classList.toggle('on', b.dataset.tab === name) })
    Array.prototype.forEach.call(side.querySelectorAll('.spane'), function (p) { p.classList.toggle('on', p.dataset.pane === name) })
    if (name === 'row' && sideVisible()) { // 行数据树（nc-table）：首次进入才挂载，切回时重测画布尺寸
      if (rt) sideRefreshLayout()
      else ensureRt()
    }
  }
  tabsEl.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.stab') : null
    if (b) sideActivateTab(b.dataset.tab)
  })

  // ---------- 通用：select 选项 / 显示文本 / 按列类型生成录入控件 ----------
  function optEntries(options) {
    return (options || []).map(function (o) {
      return o && typeof o === 'object' ? { label: String(o.label), value: String(o.value) } : { label: String(o), value: String(o) }
    })
  }
  function displayText(col, row) {
    var v = row[col.key]
    if (col.formatter) return col.formatter(v, col, row)
    if (v === null || v === undefined) return '(空)'
    if (col.type === 'select') {
      var m = optEntries(col.options).filter(function (o) { return String(o.value) === String(v) })[0]
      return m ? m.label : String(v)
    }
    return String(v)
  }
  function buildControl(col, value, commit) {
    if (col.type === 'select') {
      var sel = document.createElement('select')
      var blank = document.createElement('option')
      blank.value = ''
      blank.textContent = '(空)'
      sel.appendChild(blank)
      optEntries(col.options).forEach(function (o) {
        var op = document.createElement('option')
        op.value = o.value
        op.textContent = o.label
        sel.appendChild(op)
      })
      sel.value = value == null ? '' : String(value)
      sel.addEventListener('change', function () { commit(sel.value === '' ? null : sel.value) })
      return sel
    }
    if (col.type === 'checkbox' || col.type === 'switch') {
      var wrap = document.createElement('label')
      wrap.className = 'chk'
      var cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = !!value
      var sp = document.createElement('span')
      sp.textContent = cb.checked ? '是' : '否'
      cb._lbl = sp
      cb.addEventListener('change', function () { sp.textContent = cb.checked ? '是' : '否'; commit(cb.checked) })
      wrap.appendChild(cb)
      wrap.appendChild(sp)
      return wrap
    }
    var inp = document.createElement('input')
    if (col.type === 'number' || col.type === 'year' || col.type === 'progress') inp.type = 'number'
    else if (col.type === 'date') inp.type = 'date'
    else if (col.type === 'datetime') inp.type = 'datetime-local'
    else if (col.type === 'yearmonth') inp.type = 'month'
    else inp.type = 'text'
    if (col.placeholder) inp.placeholder = col.placeholder
    inp.value = value == null ? '' : String(value)
    inp.addEventListener('change', function () {
      var v = inp.value
      if (inp.type === 'number') { commit(v === '' ? null : Number(v)); return }
      commit(v === '' ? null : v)
    })
    return inp
  }
  function colDataTitle(col) { return (col.group ? col.group.title + '|' : '') + col.title }
  function isDataCol(col) { return col.type !== 'buttons' && !/^_/.test(col.key) }

  // ---------- tab 1：列属性 ----------
  var cpEls = { form: $('cp-form'), empty: $('cp-empty'), title: $('cp-title'), key: $('cp-key'), type: $('cp-type'), optionsWrap: $('cp-options-wrap'), options: $('cp-options'), placeholder: $('cp-placeholder'), width: $('cp-width'), align: $('cp-align'), fixed: $('cp-fixed'), sortable: $('cp-sortable') }
  var COL_TYPES = [
    ['text', 'text 文本'], ['number', 'number 数字'], ['select', 'select 单选'],
    ['date', 'date 日期'], ['datetime', 'datetime 日期时间'], ['year', 'year 年份'],
    ['yearmonth', 'yearmonth 年月'], ['checkbox', 'checkbox 复选'],
    ['progress', 'progress 进度条（自定义）'], ['switch', 'switch 开关（自定义）'], ['dlg', 'dlg 弹框录入（自定义）'],
  ]
  COL_TYPES.forEach(function (t) {
    var op = document.createElement('option')
    op.value = t[0]
    op.textContent = t[1]
    cpEls.type.appendChild(op)
  })
  function parseOptionsText(text) {
    var out = []
    String(text || '').split(/\n+/).forEach(function (line) {
      line = line.trim()
      if (!line) return
      var i = line.indexOf('=')
      if (i > 0) out.push({ label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() })
      else out.push(line)
    })
    return out
  }
  function renderColTab() {
    var col = sideCol()
    cpEls.empty.hidden = !!col
    cpEls.form.style.display = col ? '' : 'none'
    renderHiddenList()
    if (!col) return
    var a = document.activeElement
    function setv(node, v) { if (node !== a) node.value = v }
    setv(cpEls.title, col.title)
    cpEls.key.textContent = col.key + (col.group ? ' · 分组：' + col.group.title : '')
    setv(cpEls.type, col.type)
    setv(cpEls.placeholder, col.placeholder || '')
    setv(cpEls.width, Math.round(col.width))
    setv(cpEls.align, col.align || '')
    cpEls.fixed.checked = !!col.fixed
    cpEls.sortable.checked = !!col.sortable
    cpEls.optionsWrap.style.display = col.type === 'select' ? '' : 'none'
    if (col.type === 'select') setv(cpEls.options, optEntries(col.options).map(function (o) { return o.label === o.value ? o.value : o.label + '=' + o.value }).join('\n'))
  }
  cpEls.title.addEventListener('change', function () { var c = sideCol(); if (c) table1.updateColumn(c.key, { title: cpEls.title.value.trim() || c.title }) })
  cpEls.type.addEventListener('change', function () { var c = sideCol(); if (c) table1.updateColumn(c.key, { type: cpEls.type.value }) })
  cpEls.width.addEventListener('change', function () { var c = sideCol(); if (c) table1.updateColumn(c.key, { width: Number(cpEls.width.value) || c.width }) })
  cpEls.align.addEventListener('change', function () { var c = sideCol(); if (c) table1.updateColumn(c.key, { align: cpEls.align.value }) })
  cpEls.fixed.addEventListener('change', function () { var c = sideCol(); if (c) table1.updateColumn(c.key, { fixed: cpEls.fixed.checked }) })
  cpEls.sortable.addEventListener('change', function () { var c = sideCol(); if (c) table1.updateColumn(c.key, { sortable: cpEls.sortable.checked }) })
  cpEls.placeholder.addEventListener('change', function () { var c = sideCol(); if (c) table1.updateColumn(c.key, { placeholder: cpEls.placeholder.value || undefined }) })
  cpEls.options.addEventListener('change', function () { var c = sideCol(); if (c) table1.updateColumn(c.key, { options: parseOptionsText(cpEls.options.value) }) })
  $('btn-cp-hide').addEventListener('click', function () {
    var c = sideCol()
    if (c) { table1.hideColumn(c.key); log('side', '已隐藏列 [' + colDataTitle(c) + ']，可在列属性底部恢复') }
  })
  $('btn-cp-del').addEventListener('click', function () {
    var c = sideCol()
    if (c && confirm('删除字段 [' + colDataTitle(c) + '] ？（行数据保留）')) table1.deleteColumn(c.key)
  })
  function renderHiddenList() {
    var wrap = $('cp-hidden')
    var hs = table1._hiddenCols || []
    $('cp-hidden-n').textContent = hs.length
    $('cp-hidden-sec').style.display = hs.length || sideCol() ? '' : 'none'
    wrap.innerHTML = ''
    if (!hs.length) {
      var none = document.createElement('div')
      none.className = 'hint'
      none.textContent = '（无）'
      wrap.appendChild(none)
      return
    }
    hs.forEach(function (rec) {
      var it = document.createElement('div')
      it.className = 'it'
      var sp = document.createElement('span')
      sp.textContent = colDataTitle(rec.column)
      var b = document.createElement('button')
      b.className = 'sbtn'
      b.textContent = '恢复'
      b.addEventListener('click', function () { table1.showColumn(rec.column.key) })
      it.appendChild(sp)
      it.appendChild(b)
      wrap.appendChild(it)
    })
  }
  $('btn-cp-showall').addEventListener('click', function () { table1.showAllColumns() })

  // ---------- tab 2：行数据（用 nc-table 渲染树形表：标题/数值两列；分组列为组行、数值留空） ----------
  var sideCollapsed = {} // 组 key -> 是否折叠（跨行切换保持）
  var rt = window.rtTable = null // 侧栏树 NcTable 实例（首次进入“行数据”tab 才挂载）
  function buildGroupTree(cols) {
    var nodes = [], gmap = {}
    cols.forEach(function (col) {
      if (col.group) {
        if (!gmap[col.group.key]) {
          gmap[col.group.key] = { group: col.group, children: [] }
          nodes.push(gmap[col.group.key])
        }
        gmap[col.group.key].children.push(col)
      } else nodes.push({ col: col })
    })
    return nodes
  }
  function rtLeafNode(row, col, level) {
    var v = row[col.key]
    var bool = col.type === 'checkbox' || col.type === 'switch'
    return { label: col.title, col: col, level: level, raw: v, vtext: bool ? (v ? '是' : '否') : displayText(col, row), empty: v === null || v === undefined || v === '' }
  }
  function rtRowNodes() {
    var ac = table1.activeCell
    var row = ac ? table1._rowAt(ac.row) : null
    if (!row) return []
    var out = []
    buildGroupTree(table1.columns.filter(isDataCol)).forEach(function (node) {
      if (node.col) { out.push(rtLeafNode(row, node.col, 0)); return }
      var gk = node.group.key
      var expanded = !sideCollapsed[gk]
      out.push({ label: node.group.title, gkey: gk, level: 0, expanded: expanded, n: node.children.length })
      if (expanded) node.children.forEach(function (col) { out.push(rtLeafNode(row, col, 1)) })
    })
    return out
  }
  function rebuildRt() { if (rt) rt.setData(rtRowNodes()) }
  function ensureRt() {
    if (rt) return
    rt = window.rtTable = NcTable.mount('#rv-grid', {
      columns: [
        { key: 'label', title: '标题', type: 'rtree', width: 104, sortable: false },
        { key: 'vtext', title: '数值', type: 'rowval', width: 112, sortable: false },
      ],
      rows: rtRowNodes(),
      showMetaColumn: false, // 无行号/勾选区，两列占满侧栏宽度
      readOnly: true, // 本表仅展示：无添加行占位/复制/粘贴/填充；写回统一走 table1.updateCell（不受 readOnly 限制）
      sortable: false,
      rowHeight: 26,
    })
  }
  // 弹层编辑器：按列类型生成原生控件（select/date/number…），commit 写回 table1 当前行
  var rtPop = null
  function rtPopDocDown(e) { if (rtPop && !rtPop.contains(e.target)) closeRtPop() }
  function closeRtPop() {
    if (!rtPop) return
    document.removeEventListener('mousedown', rtPopDocDown, true)
    if (rtPop.parentNode) rtPop.parentNode.removeChild(rtPop)
    rtPop = null
  }
  function openRtEditor(node, p) {
    closeRtPop()
    var host = p.table.canvas.getBoundingClientRect()
    rtPop = document.createElement('div')
    rtPop.className = 'rt-pop'
    rtPop.style.left = Math.max(8, Math.min(host.left + p.x, window.innerWidth - 210)) + 'px'
    var below = host.top + p.y + p.height + 2
    rtPop.style.top = (below + 120 > window.innerHeight ? host.top + p.y - 70 : below) + 'px'
    var t = document.createElement('div')
    t.className = 't'
    t.textContent = node.label
    rtPop.appendChild(t)
    rtPop.appendChild(buildControl(node.col, node.raw, function (v) { closeRtPop(); table1.updateCell(sideActiveRow, node.col.key, v) }))
    rtPop.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeRtPop() })
    document.body.appendChild(rtPop)
    var inp = rtPop.querySelector('input,select')
    if (inp) inp.focus({ preventScroll: true })
    setTimeout(function () { document.addEventListener('mousedown', rtPopDocDown, true) }, 0)
  }
  function rtRowvalActivate(p) {
    var node = p.row
    if (!node.col || node.gkey || sideActiveRow < 0) return false
    if (node.col.type === 'checkbox' || node.col.type === 'switch') {
      table1.updateCell(sideActiveRow, node.col.key, !node.raw)
      return true
    }
    openRtEditor(node, p)
    return true
  }
  // 树标题列：组行带 ›/⌄ 折叠热区（仅热区点击生效，其余走默认选择）
  var RT_TRI_X = 6, RT_TRI_W = 16
  function rtHitTri(p, mx, my) {
    if (!p.row.gkey) return false
    return mx >= RT_TRI_X - 1 && mx <= RT_TRI_X + RT_TRI_W + 1 && my >= 0 && my <= p.height
  }
  NcTable.registerCellType('rtree', {
    editType: null,
    cursor: function (p, mx, my) { return rtHitTri(p, mx, my) ? 'pointer' : null },
    onClick: function (p, mx, my) {
      if (!rtHitTri(p, mx, my)) return false
      sideCollapsed[p.row.gkey] = !sideCollapsed[p.row.gkey]
      rebuildRt()
      return true
    },
    render: function (ctx, p) {
      var node = p.row, ox = p.x, cy = p.y + p.height / 2
      if (node.gkey) {
        ctx.fillStyle = '#f6f4fc'
        ctx.fillRect(ox, p.y, p.width, p.height)
      }
      if (node.level) {
        ctx.strokeStyle = '#e3e5ea'
        ctx.lineWidth = 1
        var gx = Math.round(ox + RT_TRI_X + RT_TRI_W / 2) + 0.5
        ctx.beginPath()
        ctx.moveTo(gx, p.y)
        ctx.lineTo(gx, p.y + p.height)
        ctx.stroke()
      }
      if (node.gkey) {
        var cx = ox + RT_TRI_X + RT_TRI_W / 2
        ctx.strokeStyle = '#7157d1'
        ctx.lineWidth = 1.6
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        if (node.expanded) { ctx.moveTo(cx - 4, cy - 1.5); ctx.lineTo(cx, cy + 2.5); ctx.lineTo(cx + 4, cy - 1.5) }
        else { ctx.moveTo(cx - 1.5, cy - 4); ctx.lineTo(cx + 2.5, cy); ctx.lineTo(cx - 1.5, cy + 4) }
        ctx.stroke()
      }
      var tx = ox + (node.gkey ? RT_TRI_X + RT_TRI_W : node.level ? RT_TRI_X + RT_TRI_W + 4 : RT_TRI_X + 2)
      ctx.textBaseline = 'middle'
      ctx.font = node.gkey ? '600 12px Inter, ui-sans-serif, sans-serif' : '400 12px Inter, ui-sans-serif, sans-serif'
      ctx.fillStyle = node.gkey ? '#4a3f7e' : '#2e333d'
      var full = String(node.label)
      var s = full
      while (s.length > 1 && ctx.measureText(s).width > p.width - (tx - ox) - 8) s = s.slice(0, -1)
      if (s.length < full.length) s = s.slice(0, -1) + '…'
      ctx.fillText(s, tx, cy + 0.5)
    },
  })
  // 数值列：叶子行显示值（布尔着色/进度条/空值占位）；组行留空，折叠时显示徽标
  NcTable.registerCellType('rowval', {
    editType: null,
    cursor: function (p) { return p.row.gkey || !p.row.col ? null : 'pointer' },
    onClick: function (p) { return rtRowvalActivate(p) },
    onActivate: function (p) { rtRowvalActivate(p) },
    render: function (ctx, p) {
      var node = p.row, ox = p.x, cy = p.y + p.height / 2
      ctx.textBaseline = 'middle'
      if (node.gkey) {
        ctx.fillStyle = '#f6f4fc'
        ctx.fillRect(ox, p.y, p.width, p.height)
        if (!node.expanded) {
          ctx.fillStyle = '#9aa2af'
          ctx.font = '400 11px Inter, ui-sans-serif, sans-serif'
          ctx.fillText('已折叠 · ' + node.n + ' 项', ox + 8, cy + 0.5)
        }
        return
      }
      var col = node.col
      if (col && col.type === 'progress') {
        var v = Math.max(0, Math.min(Number(node.raw) || 0, 100))
        var bw = Math.max(20, p.width - 16 - 32)
        ctx.fillStyle = '#ececf1'
        ctx.beginPath()
        ctx.roundRect ? ctx.roundRect(ox + 8, cy - 3, bw, 6, 3) : ctx.rect(ox + 8, cy - 3, bw, 6)
        ctx.fill()
        ctx.fillStyle = v > 80 ? '#1fa958' : '#7157d1'
        ctx.beginPath()
        var fw = Math.max(6, (bw * v) / 100)
        ctx.roundRect ? ctx.roundRect(ox + 8, cy - 3, fw, 6, 3) : ctx.rect(ox + 8, cy - 3, fw, 6)
        ctx.fill()
        ctx.fillStyle = '#4a5268'
        ctx.font = '500 11px Inter, sans-serif'
        ctx.fillText(v + '%', ox + 10 + bw + 4, cy + 0.5)
        return
      }
      ctx.font = '400 12px Inter, ui-sans-serif, sans-serif'
      if (node.empty) ctx.fillStyle = '#b3b9c4'
      else if (col && (col.type === 'checkbox' || col.type === 'switch')) ctx.fillStyle = node.raw ? '#1fa958' : '#9aa0ab'
      else ctx.fillStyle = '#2e333d'
      var full = String(node.vtext)
      var s = full
      while (s.length > 1 && ctx.measureText(s).width > p.width - 16) s = s.slice(0, -1)
      if (s.length < full.length) s = s.slice(0, -1) + '…'
      ctx.fillText(s, ox + 8, cy + 0.5)
    },
  })
  function renderRowForm() {
    var ac = table1.activeCell
    var total = table1.totalRows
    $('rv-total').textContent = total
    var cur = $('rv-cur')
    if (cur !== document.activeElement) cur.value = ac ? ac.row + 1 : ''
    $('btn-rv-first').disabled = $('btn-rv-prev').disabled = !ac || ac.row <= 0
    $('btn-rv-next').disabled = $('btn-rv-last').disabled = !ac || ac.row >= total - 1
    var row = ac ? table1._rowAt(ac.row) : null
    if (!row) {
      sideActiveRow = -1
      rebuildRt()
      return
    }
    sideActiveRow = ac.row
    if (rt) rebuildRt()
    else if (document.querySelector('[data-pane="row"]').classList.contains('on')) ensureRt()
  }
  // 行导航：首行/上一行/下一行/末行 + 行号直达（保持当前活动列）
  function rvJump(r) {
    if (!table1.totalRows) return
    r = Math.max(0, Math.min(table1.totalRows - 1, r))
    var c = table1.activeCell ? table1.activeCell.col : 0
    table1.setActiveCell(r, c)
    table1.scrollToCell(r, c)
    $('rv-cur').value = r + 1
    renderRowForm()
  }
  $('btn-rv-first').addEventListener('click', function () { rvJump(0) })
  $('btn-rv-prev').addEventListener('click', function () { var a = table1.activeCell; if (a) rvJump(a.row - 1) })
  $('btn-rv-next').addEventListener('click', function () { var a = table1.activeCell; if (a) rvJump(a.row + 1) })
  $('btn-rv-last').addEventListener('click', function () { rvJump(table1.totalRows - 1) })
  $('rv-cur').addEventListener('change', function () { rvJump((Number($('rv-cur').value) || 1) - 1) })

  // ---------- tab 3：单元格 ----------
  function renderCellTab() {
    var ac = table1.activeCell
    var row = ac ? table1._rowAt(ac.row) : null
    var edit = $('cc-edit')
    if (!ac || !row) {
      sideCell.textContent = '未选中'
      $('cc-raw').textContent = '-'
      $('cc-text').textContent = '-'
      edit.innerHTML = ''
      edit.dataset.key = ''
      return
    }
    var col = table1.columns[ac.col]
    sideCell.textContent = '第 ' + (ac.row + 1) + ' 行 · ' + colDataTitle(col) + '（' + col.type + '）'
    if (col.type === 'buttons') {
      $('cc-raw').textContent = '—'
      $('cc-text').textContent = '操作列无存储值'
      edit.innerHTML = ''
      edit.dataset.key = ''
      return
    }
    var v = row[col.key]
    $('cc-raw').textContent = JSON.stringify(v === undefined ? null : v)
    $('cc-text').textContent = displayText(col, row)
    if (edit.dataset.key !== col.key) {
      edit.dataset.key = col.key
      edit.innerHTML = ''
      edit.appendChild(buildControl(col, v, function (nv) {
        var a = table1.activeCell
        if (a) table1.updateCell(a.row, col.key, nv)
      }))
    } else {
      var node = edit.querySelector('input,select')
      if (node && node !== document.activeElement) {
        if (node.type === 'checkbox') { node.checked = !!v; if (node._lbl) node._lbl.textContent = node.checked ? '是' : '否' }
        else node.value = v == null ? '' : String(v)
      }
    }
  }
  $('btn-cc-copy').addEventListener('click', function () {
    var ac = table1.activeCell
    if (!ac) return
    var row = table1._rowAt(ac.row)
    if (!row) return
    var text = displayText(table1.columns[ac.col], row)
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {})
    log('side', '复制显示值：' + JSON.stringify(text))
  })
  $('btn-cc-clear').addEventListener('click', function () {
    var ac = table1.activeCell
    if (ac && table1._rowAt(ac.row)) table1.updateCell(ac.row, table1.columns[ac.col].key, null)
  })

  // ---------- tab 4：自定义（快捷备注 + 扩展插槽） ----------
  function renderExtTab() {
    var ac = table1.activeCell
    var row = ac ? table1._rowAt(ac.row) : null
    if (row && sideNote !== document.activeElement) sideNote.value = row.note || ''
  }
  $('btn-note-save').addEventListener('click', function () {
    var ac = table1.activeCell
    if (!ac) return
    table1.updateCell(ac.row, 'note', sideNote.value || null)
    log('side', '备注已保存到第 ' + (ac.row + 1) + ' 行')
  })

  // ---------- 开合与事件联动 ----------
  function renderSide() {
    renderColTab()
    renderRowForm()
    renderCellTab()
    renderExtTab()
  }
  $('btn-side').addEventListener('click', function () {
    side.hidden = !side.hidden
    sideRefreshLayout()
    if (sideVisible()) renderSide()
    log('api', '侧边栏 ' + (side.hidden ? '关闭' : '打开'))
  })
  $('btn-side-close').addEventListener('click', function () {
    side.hidden = true
    sideRefreshLayout()
  })

  table1.on('selection-change', function () { if (sideVisible()) renderSide() })
  table1.on('cell-change', function (e) {
    if (!sideVisible()) return
    var ac = table1.activeCell
    if (ac && e.rowIndex === ac.row) {
      renderRowForm()
      renderCellTab()
      if (e.column.key === 'note' && sideNote !== document.activeElement) sideNote.value = e.value || ''
    }
  })
  table1.on('column-update', function () { if (sideVisible()) { renderColTab(); renderRowForm() } })
  ;['column-hide', 'column-show', 'column-delete', 'column-insert', 'column-added', 'column-reorder'].forEach(function (ev) {
    table1.on(ev, function () { if (sideVisible()) { renderColTab(); renderRowForm() } })
  })
  ;['sort', 'filter-change', 'rows-delete'].forEach(function (ev) {
    table1.on(ev, function () { if (sideVisible()) renderSide() }) // 行映射可能变化：刷新行数据树
  })

  // ----------------------------------------------- 示例 2：远程分块加载模式
  var TOTAL = 50000
  var table2 = window.table2 = NcTable.mount('#table2', {
    columns: columns,
    totalRows: TOTAL,
    // 模拟服务端：每次拉取一个 chunk（50 行），延迟 300ms
    loadData: function (params) {
      return new Promise(function (resolve) {
        log('loadData', 'offset=' + params.offset + ' limit=' + params.limit + (params.sort ? ' sort=' + JSON.stringify(params.sort) : '') + (params.filters ? ' filters=' + JSON.stringify(params.filters) : ''))
        setTimeout(function () {
          var out = []
          for (var i = 0; i < params.limit && params.offset + i < TOTAL; i++) {
            out.push(makeRow(params.offset + i))
          }
          resolve(out)
        }, 300)
      })
    },
    onCellChange: function (e) {
      log('cell-change(远程)', '索引 ' + e.rowIndex + ' [' + e.column.title + '] → ' + JSON.stringify(e.value))
    },
    onFilterChange: function (e) {
      log('filter-change(远程)', e.filters.length ? '服务端将收到 ' + JSON.stringify(e.filters) : '筛选清空')
    },
  })
})()
