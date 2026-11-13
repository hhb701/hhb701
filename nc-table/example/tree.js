/* NcTable 树形表格示例：不修改控件源码，纯 demo 层实现
 * 树模型（节点对象直接作为行数据） -> 深度优先平铺 -> setData()
 * 自定义 tree 单元格：缩进参考线 + ▶/▼ 折叠热区 + 层级图标 + 折叠子项徽标
 */
(function () {
  'use strict'

  var logEl = document.getElementById('log')
  function log(ev, msg) {
    var d = document.createElement('div')
    var t = new Date().toLocaleTimeString()
    d.innerHTML = '<span class="ts">' + t + '</span> <span class="ev">[' + ev + ']</span> ' + msg
    logEl.prepend(d)
    while (logEl.children.length > 80) logEl.removeChild(logEl.lastChild)
  }

  // ------------------------------------------------------------ 树常量
  var LEVELS = ['公司', '部门', '小组', '成员']
  var LEVEL_ICONS = ['🏢', '📁', '👥', '👤']
  var LEVEL_COLORS = [
    { bg: '#ede9fe', fg: '#7157d1' },
    { bg: '#e0f2fe', fg: '#0284c7' },
    { bg: '#dcfce7', fg: '#16a34a' },
    { bg: '#fef3c7', fg: '#d97706' },
  ]
  var STATUSES = ['todo', 'in progress', 'done', 'blocked']
  var PRIORITY = [
    { label: '高', value: 'high' },
    { label: '中', value: 'mid' },
    { label: '低', value: 'low' },
  ]
  var INDENT = 16      // 每级缩进像素
  var TRI_X = 8        // 首行三角起始 x（与内置 CELL_PADDING 对齐）
  var TRI_W = 16       // 三角命中宽度

  // ------------------------------------------------------------ 伪随机（可复现）
  var _seed = 20260911
  function rnd() {
    _seed = (_seed * 1103515245 + 12345) % 2147483648
    return _seed / 2147483648
  }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)] }
  function ri(min, max) { return min + Math.floor(rnd() * (max - min + 1)) }
  function pad2(n) { return n < 10 ? '0' + n : '' + n }

  // ------------------------------------------------------------ 显示格式化（日期/时间/金额/数字）
  function dateParts(v) {
    var m = String(v).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (!m) return null
    return { y: +m[1], mo: +m[2], d: +m[3], h: m[4] === undefined ? null : +m[4], mi: m[5] === undefined ? null : +m[5], s: m[6] === undefined ? null : +m[6] }
  }
  function fmtDate(pat) {
    return function (v) {
      if (v === null || v === undefined || v === '') return ''
      var t = dateParts(v)
      if (!t) return String(v)
      return pat
        .replace(/YYYY/g, t.y)
        .replace(/MM/g, pad2(t.mo))
        .replace(/DD/g, pad2(t.d))
        .replace(/HH/g, t.h === null ? '00' : pad2(t.h))
        .replace(/mm/g, t.mi === null ? '00' : pad2(t.mi))
        .replace(/ss/g, t.s === null ? '00' : pad2(t.s))
    }
  }
  function fmtNumber(dec, prefix, suffix, div) {
    return function (v) {
      if (v === null || v === undefined || v === '') return ''
      var n = Number(v)
      if (isNaN(n)) return String(v)
      if (div) n = n / div
      return (prefix || '') + n.toLocaleString('zh-CN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (suffix || '')
    }
  }
  function fmtNumberEn(dec, prefix, suffix) {
    return function (v) {
      if (v === null || v === undefined || v === '') return ''
      var n = Number(v)
      if (isNaN(n)) return String(v)
      return (prefix || '') + n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + (suffix || '')
    }
  }

  // ------------------------------------------------------------ 构树
  var SURNAMES = ['张', '李', '王', '赵', '刘', '陈', '杨', '黄', '周', '吴']
  var GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '洋', '勇', '杰', '涛', '明', '超']
  var COMPANIES = ['极客科技', '恒信数智', '蓝鲸软件', '智行云', '图灵数据', '九章智能']
  var DEPTS = ['研发中心', '产品设计部', '市场部', '运营部', '财务部', '行政部']
  var NODE_ID = 0

  function makeNode(name, extra) {
    var n = {
      id: ++NODE_ID,
      name: name,
      owner: '',
      status: pick(STATUSES),
      priority: pick(PRIORITY).value,
      progress: ri(0, 100),
      hours: ri(0, 240) / 2,
      budget: ri(8, 999) * 1000 + ri(0, 99) * 10,
      due: '2026-0' + ri(1, 9) + '-' + (ri(10, 28)),
      checkin: '2026-0' + ri(1, 9) + '-' + pad2(ri(10, 28)) + 'T' + pad2(ri(8, 19)) + ':' + pad2(ri(0, 59)),
      done: rnd() < 0.25,
      children: [],
      __level: 0,
      __expanded: false,
      __parent: null,
    }
    if (extra) for (var k in extra) n[k] = extra[k]
    return n
  }

  function newMember() {
    var n = makeNode(pick(SURNAMES) + pick(GIVEN) + pick(GIVEN))
    n.owner = n.name
    n.status = pick(['todo', 'in progress', 'done'])
    return n
  }

  var roots = []
  COMPANIES.forEach(function (co) {
    var c = makeNode(co + ' 有限公司')
    c.owner = '总经理办'
    c.__expanded = true
    DEPTS.slice(0, ri(4, 6)).forEach(function (dp) {
      var d = makeNode(dp)
      d.owner = '总监' + ri(1, 9)
      d.__expanded = rnd() < 0.8
      c.children.push(d)
      for (var t = 1; t <= ri(3, 6); t++) {
        var team = makeNode(dp.replace('部', '') + '一组'.slice(0, 1) + t + '组')
        team.owner = '组长' + ri(1, 20)
        d.children.push(team)
        for (var m = 0; m < ri(5, 9); m++) team.children.push(newMember())
      }
    })
    roots.push(c)
  })

  // ------------------------------------------------------------ 平铺 / 查询
  var flatRows = []
  function flatten() {
    flatRows = []
    function walk(node, level, parent) {
      node.__level = level
      node.__parent = parent
      flatRows.push(node)
      if (node.children && node.children.length && node.__expanded) {
        for (var i = 0; i < node.children.length; i++) walk(node.children[i], level + 1, node)
      }
    }
    roots.forEach(function (r) { walk(r, 0, null) })
    return flatRows
  }

  function forEachDescendant(node, fn) {
    ;(node.children || []).forEach(function (c) {
      fn(c)
      forEachDescendant(c, fn)
    })
  }
  function descendantCount(node) {
    var n = 0
    forEachDescendant(node, function () { n++ })
    return n
  }
  function findNode(query) {
    query = query.toLowerCase()
    var hit = null
    function walk(list) {
      for (var i = 0; i < list.length && !hit; i++) {
        var n = list[i]
        if (String(n.name).toLowerCase().indexOf(query) >= 0) { hit = n; break }
        walk(n.children)
      }
    }
    walk(roots)
    return hit
  }
  function countNodes() {
    var n = 0
    roots.forEach(function (r) { n++; forEachDescendant(r, function () { n++ }) })
    return n
  }

  // ------------------------------------------------------------ 自定义单元格：tree 名称列
  function kids(node) { return (node.children && node.children.length) || 0 }
  function triLeft(row) { return TRI_X + (row.__level || 0) * INDENT }
  function hitTri(p, mx, my) {
    if (!kids(p.row)) return false
    var tx = triLeft(p.row)
    return mx >= tx - 1 && mx <= tx + TRI_W + 1 && my >= 0 && my <= p.height
  }
  NcTable.registerCellType('tree', {
    editType: 'input', // 双击/F2/直接键入仍可行内重命名
    cursor: function (p, mx, my) { return hitTri(p, mx, my) ? 'pointer' : null },
    onClick: function (p, mx, my) {
      if (!hitTri(p, mx, my)) return false // 非尖括号区域：走默认选择/拖选
      p.row.__expanded = !p.row.__expanded
      refresh(p.row)
      return true
    },
    render: function (ctx, p) {
      var row = p.row
      var level = row.__level || 0
      var tx = triLeft(row) // 单元格内相对 x
      var ox = p.x          // 单元格画布绝对 x
      var cy = p.y + p.height / 2
      var n = kids(row)

      // 缩进参考线（对齐各祖先层级方框中心）
      ctx.strokeStyle = '#e3e5ea'
      ctx.lineWidth = 1
      for (var l = 0; l < level; l++) {
        var gx = Math.round(ox + TRI_X + l * INDENT + TRI_W / 2) + 0.5
        ctx.beginPath()
        ctx.moveTo(gx, p.y)
        ctx.lineTo(gx, p.y + p.height)
        ctx.stroke()
      }

      // 展开/收起 尖括号（chevron）：收起朝右 ›，展开朝下 ⌄
      if (n) {
        var cx = ox + tx + TRI_W / 2
        ctx.strokeStyle = '#6f7982'
        ctx.lineWidth = 1.8
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        if (row.__expanded) {
          ctx.moveTo(cx - 4.5, cy - 2)
          ctx.lineTo(cx, cy + 2.5)
          ctx.lineTo(cx + 4.5, cy - 2)
        } else {
          ctx.moveTo(cx - 2, cy - 4.5)
          ctx.lineTo(cx + 2.5, cy)
          ctx.lineTo(cx - 2, cy + 4.5)
        }
        ctx.stroke()
      }

      // 层级图标
      var iconX = ox + tx + TRI_W + 2
      ctx.font = '12px "Segoe UI Emoji", sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText(LEVEL_ICONS[Math.min(level, 3)], iconX, cy + 0.5)

      // 名称（顶级加粗）
      var textX = iconX + 17
      ctx.fillStyle = level === 0 ? '#1c1e26' : '#2e333d'
      ctx.font = (level <= 1 ? '600 ' : '400 ') + '12px Inter, ui-sans-serif, sans-serif'
      var name = String(row.name == null ? '' : row.name)
      var badge = n && !row.__expanded ? ' · ' + n + ' 项' : ''
      var badgeW = badge ? ctx.measureText(badge).width + 4 : 0
      var avail = p.width - (textX - ox) - 8 - badgeW
      if (avail > 8) {
        while (name.length > 1 && ctx.measureText(name).width > avail) name = name.slice(0, -1)
        var clipped = ctx.measureText(row.name || '').width > avail
        if (clipped && name.length > 1 && row.name.length > name.length) name = name.slice(0, -1) + '…'
      }
      ctx.fillText(name, textX, cy + 0.5)
      var nameW = ctx.measureText(name).width

      // 折叠徽标
      if (badge) {
        ctx.fillStyle = '#9aa0ab'
        ctx.font = '400 11px Inter, ui-sans-serif, sans-serif'
        ctx.fillText(badge, textX + nameW + 6, cy + 0.5)
      }
    },
  })

  // ------------------------------------------------------------ 自定义单元格：层级徽标列
  NcTable.registerCellType('levelbadge', {
    editType: null,
    render: function (ctx, p) {
      var lv = Math.min(p.row.__level || 0, 3)
      var text = LEVELS[lv]
      ctx.save()
      ctx.font = '500 11px Inter, ui-sans-serif, sans-serif'
      ctx.textBaseline = 'middle'
      var w = ctx.measureText(text).width + 14
      var x = p.x + 8
      var y = p.y + (p.height - 18) / 2
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, y, w, 18, 9)
      else ctx.rect(x, y, w, 18)
      ctx.fillStyle = LEVEL_COLORS[lv].bg
      ctx.fill()
      ctx.fillStyle = LEVEL_COLORS[lv].fg
      ctx.fillText(text, x + 7, y + 9.5)
      ctx.restore()
    },
  })

  // ------------------------------------------------------------ 自定义单元格：进度条
  NcTable.registerCellType('progress', {
    editType: 'input-number',
    parse: function (raw) {
      var s = String(raw === null || raw === undefined ? '' : raw).trim().replace(/%$/, '')
      if (s === '') return null
      var v = Number(s)
      return isNaN(v) ? s : Math.max(0, Math.min(100, v))
    },
    render: function (ctx, p) {
      var v = Math.max(0, Math.min(Number(p.value) || 0, 100))
      var w = p.width - 40
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
      ctx.textBaseline = 'middle'
      ctx.fillText(v + '%', p.x + w + 14, p.y + p.height / 2 + 0.5)
    },
  })

  // ------------------------------------------------------------ 列定义（全部关闭排序，避免破坏树）
  var columns = [
    { key: 'name', title: '名称', type: 'tree', width: 300, fixed: true, sortable: false, placeholder: '未命名' },
    { key: '__level', title: '层级', type: 'levelbadge', width: 76, fixed: true, sortable: false },
    { key: 'owner', title: '负责人', type: 'text', width: 110, sortable: false },
    { key: 'status', title: '状态', type: 'select', width: 120, sortable: false, options: STATUSES },
    { key: 'priority', title: '优先级', type: 'select', width: 100, sortable: false, options: PRIORITY },
    { key: 'progress', title: '进度', type: 'progress', width: 170, sortable: false, min: 0, max: 100 },
    { key: 'hours', title: '工时', type: 'number', width: 90, sortable: false },
    { key: 'due', title: '截止日期', type: 'date', width: 120, sortable: false },
    { key: 'checkin', title: '打卡时间', type: 'datetime', width: 150, sortable: false },
    { key: 'budget', title: '预算金额', type: 'number', width: 130, sortable: false },
    { key: 'done', title: '完成', type: 'checkbox', width: 80, sortable: false },
  ]

  // ------------------------------------------------------------ 挂载 + 平铺刷新
  var table = window.treeTable = NcTable.mount('#tree', {
    columns: columns,
    rows: flatten(),
    sortable: false, // 树形表：表级关闭排序（点表头不排序，菜单不出“数据排序”）
  })

  var stNodes = document.getElementById('st-nodes')
  var stRows = document.getElementById('st-rows')
  var stExpanded = document.getElementById('st-expanded')

  function updateStats() {
    var expanded = 0
    function cnt(n) { if (n.children.length && n.__expanded) expanded++; n.children.forEach(cnt) }
    roots.forEach(cnt)
    stNodes.textContent = countNodes()
    stRows.textContent = table.totalRows
    stExpanded.textContent = expanded
  }

  // 重建树视图；keepNode：优先保持其为活动行并保证可见；筛选条件跨重建保留（setData 会清空筛选）
  var reapplying = false
  function viewIndexOf(node) {
    var src = flatRows.indexOf(node)
    if (src < 0) return -1
    return table._view ? table._view.indexOf(src) : src
  }
  function refresh(keepNode) {
    var prev = table.getActiveCell()
    var prevNode = prev ? table._rowAt(prev.row) : null
    var prevCol = prev ? prev.col : 0
    var saved = table.getFilters()
    var rows = flatten()
    table.selectedRows.clear()
    table.setData(rows)
    if (saved.length) {
      reapplying = true
      saved.forEach(function (f) { table.setFilter(f.key, f.values) })
      reapplying = false
    }
    var target = keepNode || prevNode
    var i = target ? viewIndexOf(target) : -1
    if (i < 0 && target && target.__parent) i = viewIndexOf(target.__parent)
    if (i >= 0) {
      table.setActiveCell(i, prevCol)
      table.scrollToCell(i, prevCol)
    } else if (table.totalRows) {
      table.setActiveCell(Math.min(prev ? prev.row : 0, table.totalRows - 1), prevCol)
    }
    table.scheduleRender()
    updateStats()
  }

  // ------------------------------------------------------------ 事件
  table
    .on('cell-change', function (e) {
      log('cell-change', '第 ' + (e.rowIndex + 1) + ' 行 [' + e.column.title + ']：' + JSON.stringify(e.prev) + ' → ' + JSON.stringify(e.value))
      if (e.column.key === 'done') {
        var n = 0
        forEachDescendant(e.row, function (c) { c.done = !!e.value; n++ })
        if (n) {
          table.scheduleRender()
          log('cascade', '“完成”级联同步 ' + n + ' 个子孙节点')
        }
      }
    })
    .on('row-add', function (e) {
      if (roots.indexOf(e.row) < 0) {
        e.row.children = e.row.children || []
        roots.push(e.row)
        log('row-add', '新增根节点（公司）：' + (e.row.name || '未命名') + '，共 ' + countNodes() + ' 节点')
        refresh(e.row)
      }
    })
    .on('sort', function (e) {
      log('guard', '检测到排序操作（' + e.column.title + '），已恢复树形层级视图')
      refresh()
    })
    .on('filter-change', function (e) {
      if (reapplying) return
      log('filter', e.filters.length
        ? '筛选生效：' + e.filters.map(function (f) { return f.key + ' 保留 ' + f.values.length + ' 个值' }).join('；') + '，当前显示 ' + table.totalRows + ' 行'
        : '筛选已清除，恢复 ' + table.totalRows + ' 行')
    })
    .on('column-resize-end', function (e) {
      log('resize', '[' + e.column.title + '] 宽度 → ' + e.width + 'px')
    })

  // ------------------------------------------------------------ 工具栏
  function setAllExpanded(v) {
    function walk(n) {
      if (n.children.length) { n.__expanded = v; n.children.forEach(walk) }
    }
    roots.forEach(walk)
    refresh()
    log('api', (v ? 'expandAll()' : 'collapseAll()') + '，当前可见 ' + table.totalRows + ' 行')
  }
  document.getElementById('btn-expand').addEventListener('click', function () { setAllExpanded(true) })
  document.getElementById('btn-collapse').addEventListener('click', function () { setAllExpanded(false) })

  function activeNode() {
    var ac = table.getActiveCell()
    if (!ac) return null
    return table._rowAt(ac.row) || null
  }

  document.getElementById('btn-add-root').addEventListener('click', function () {
    var n = makeNode('新公司 #' + NODE_ID)
    roots.push(n)
    refresh(n)
    log('api', '添加根节点：' + n.name)
  })

  document.getElementById('btn-add-child').addEventListener('click', function () {
    var p = activeNode()
    if (!p) { log('api', '无活动行，无法添加子节点'); return }
    var c = makeNode(LEVELS[Math.min((p.__level || 0) + 1, 3)] + '（新）#' + NODE_ID, { owner: '待指派' })
    p.children.push(c)
    p.__expanded = true
    refresh(c)
    log('api', '在 [' + p.name + '] 下添加子节点：' + c.name)
  })

  document.getElementById('btn-del').addEventListener('click', function () {
    var n = activeNode()
    if (!n) { log('api', '无活动行，无法删除'); return }
    var dn = descendantCount(n)
    if (!confirm('删除节点 [' + n.name + ']' + (dn ? ' 及其 ' + dn + ' 个子孙节点' : '') + '？')) return
    if (n.__parent) n.__parent.children = n.__parent.children.filter(function (c) { return c !== n })
    else roots = roots.filter(function (r) { return r !== n })
    refresh()
    log('api', '删除节点 [' + n.name + ']（含 ' + dn + ' 子孙），剩余 ' + countNodes() + ' 节点')
  })

  function doSearch() {
    var q = document.getElementById('inp-search').value.trim()
    if (!q) return
    var hit = findNode(q)
    if (!hit) { log('search', '未找到名称包含“' + q + '”的节点'); return }
    var p = hit.__parent
    while (p) { p.__expanded = true; p = p.__parent }
    refresh(hit)
    var chain = []
    for (var n = hit; n; n = n.__parent) chain.unshift(n.name)
    log('search', '定位 [' + hit.name + ']：' + chain.join(' / ') + '（第 ' + (viewIndexOf(hit) + 1) + ' 行）')
  }
  document.getElementById('btn-search').addEventListener('click', doSearch)
  document.getElementById('inp-search').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doSearch()
    e.stopPropagation()
  })

  document.getElementById('btn-export').addEventListener('click', function () {
    var bytes = table.exportExcel('nc-table-tree.xlsx')
    log('api', 'exportExcel() 导出当前展开的 ' + table.totalRows + ' 行，共 ' + bytes.length + ' 字节')
  })

  // ------------------------------------------------------------ 显示格式设置面板
  function fmtWan(v) {
    if (v === null || v === undefined || v === '') return ''
    var n = Number(v)
    if (isNaN(n)) return String(v)
    return (n / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 万元'
  }
  function fmtPctOf40(v) {
    if (v === null || v === undefined || v === '') return ''
    var n = Number(v)
    if (isNaN(n)) return String(v)
    return (n / 40 * 100).toFixed(1) + '%'
  }
  var FMT_GROUPS = [
    {
      key: 'due', title: '截止日期', kind: '日期', def: 'd-my', opts: [
        { id: 'raw', label: '原值 (2026-09-05)', fmt: null },
        { id: 'd-my', label: 'YYYY-MM-DD', fmt: fmtDate('YYYY-MM-DD') },
        { id: 'd-slash', label: 'YYYY/MM/DD', fmt: fmtDate('YYYY/MM/DD') },
        { id: 'd-cn', label: 'YYYY年MM月DD日', fmt: fmtDate('YYYY年MM月DD日') },
        { id: 'd-us', label: 'MM/DD/YYYY', fmt: fmtDate('MM/DD/YYYY') },
        { id: 'd-day', label: 'DD-MM-YYYY', fmt: fmtDate('DD-MM-YYYY') },
        { id: 'd-md', label: 'MM-DD（短）', fmt: fmtDate('MM-DD') },
      ],
    },
    {
      key: 'checkin', title: '打卡时间', kind: '日期+时间', def: 't-min', opts: [
        { id: 'raw', label: '原值 (ISO 含 T)', fmt: null },
        { id: 't-min', label: 'YYYY-MM-DD HH:mm', fmt: fmtDate('YYYY-MM-DD HH:mm') },
        { id: 't-sec', label: 'YYYY-MM-DD HH:mm:ss', fmt: fmtDate('YYYY-MM-DD HH:mm:ss') },
        { id: 't-only', label: '仅时间 HH:mm:ss', fmt: fmtDate('HH:mm:ss') },
        { id: 't-cn', label: 'YYYY年MM月DD日 HH:mm', fmt: fmtDate('YYYY年MM月DD日 HH:mm') },
        { id: 't-slash', label: 'YYYY/MM/DD HH:mm', fmt: fmtDate('YYYY/MM/DD HH:mm') },
      ],
    },
    {
      key: 'budget', title: '预算金额', kind: '金额', def: 'm-cny2', opts: [
        { id: 'raw', label: '原数字（默认千分位）', fmt: null },
        { id: 'm-cny2', label: '¥1,234,560.00（两位小数）', fmt: fmtNumber(2, '¥') },
        { id: 'm-cny0', label: '¥1,234,560（整数）', fmt: fmtNumber(0, '¥') },
        { id: 'm-suffix', label: '1,234,560.00 元（后缀）', fmt: fmtNumber(2, '', ' 元') },
        { id: 'm-usd', label: '$1,234,560.00（美元）', fmt: fmtNumberEn(2, '$') },
        { id: 'm-wan', label: '123.46 万元', fmt: fmtWan },
      ],
    },
    {
      key: 'hours', title: '工时', kind: '数字', def: 'raw', opts: [
        { id: 'raw', label: '原数字（默认千分位）', fmt: null },
        { id: 'h1', label: '1 位小数', fmt: fmtNumber(1) },
        { id: 'h2', label: '2 位小数', fmt: fmtNumber(2) },
        { id: 'hint', label: '取整', fmt: fmtNumber(0) },
        { id: 'hunit', label: '12.0 h（带单位）', fmt: fmtNumber(1, '', ' h') },
        { id: 'hpct', label: '占标准周百分比（÷40h）', fmt: fmtPctOf40 },
      ],
    },
  ]

  var fmtSelMap = {}
  function applyFmt(group, id, silent) {
    var opt = null
    group.opts.forEach(function (o) { if (o.id === id) opt = o })
    if (!opt) return
    table.updateColumn(group.key, { formatter: opt.fmt })
    if (!silent) log('format', '列 [' + group.title + '] 显示格式 → ' + opt.label + '（渲染/复制/筛选面板/导出同步生效，编辑器与 xlsx 数值列仍为原值）')
  }
  function buildFmtPanel() {
    var panel = document.getElementById('fmt-panel')
    FMT_GROUPS.forEach(function (g) {
      var item = document.createElement('div')
      item.className = 'fmt-item'
      var lb = document.createElement('label')
      lb.textContent = g.title
      var tag = document.createElement('span')
      tag.className = 'kind'
      tag.textContent = g.kind
      var sel = document.createElement('select')
      g.opts.forEach(function (o) {
        var op = document.createElement('option')
        op.value = o.id
        op.textContent = o.label
        sel.appendChild(op)
      })
      sel.value = g.def
      sel.addEventListener('change', function () { applyFmt(g, sel.value) })
      applyFmt(g, g.def, true) // 初始化即应用默认格式
      fmtSelMap[g.key] = sel
      item.appendChild(lb)
      item.appendChild(tag)
      item.appendChild(sel)
      panel.appendChild(item)
    })
    var act = document.createElement('div')
    act.className = 'fmt-item fmt-actions'
    var reset = document.createElement('button')
    reset.textContent = '全部恢复原值'
    reset.addEventListener('click', function () {
      FMT_GROUPS.forEach(function (g) {
        fmtSelMap[g.key].value = 'raw'
        applyFmt(g, 'raw', true)
      })
      log('format', '所有列已恢复原值显示')
    })
    act.appendChild(reset)
    panel.appendChild(act)
  }
  buildFmtPanel()

  var fmtPanel = document.getElementById('fmt-panel')
  document.getElementById('btn-fmt').addEventListener('click', function () {
    fmtPanel.hidden = !fmtPanel.hidden
    this.classList.toggle('on', !fmtPanel.hidden)
  })

  updateStats()
  log('init', '树已就绪：' + countNodes() + ' 节点，初始展开显示 ' + table.totalRows + ' 行')
})()
