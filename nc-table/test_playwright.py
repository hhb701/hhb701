"""NcTable demo 交互回归测试（Playwright / 无头 Chromium）

坐标依据实际布局常量：GUTTER=80，表头 32，行高 32，
冻结列 id[80,160) title[160,360)，滚动列 status[360,510) priority[510,620)
assignee[620,750) hours[750,850) progress[850,1030) due[1030,1170) done[1170,1270)
"""
import os
import pathlib

from playwright.sync_api import sync_playwright

url = pathlib.Path(r"D:\ai\no_table\nc-table\example\index.html").as_uri()
out = r"C:\Users\HUX\AppData\Local\Temp\opencode"
CHROME = os.path.expandvars(r"%LOCALAPPDATA%\ms-playwright\chromium-1217\chrome-win64\chrome.exe")

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(("PASS" if ok else "FAIL"), name, detail)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROME if os.path.exists(CHROME) else None)
    page = browser.new_page(viewport={"width": 1500, "height": 950})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(url)
    page.wait_for_timeout(1200)

    box = page.locator("#table1 canvas").bounding_box()
    cx, cy = box["x"], box["y"]

    def mousedown(x, y):
        page.mouse.click(cx + x, cy + y)

    def logs():
        return page.locator("#log .ev").all_inner_texts()

    # A. 初始渲染
    check("canvas rendered", page.locator("canvas").count() == 2)
    page.screenshot(path=out + r"\shot1_initial.png")

    # B. 表头排序（非冻结列 —— 曾经的 bug）
    mousedown(800, 48)  # hours 表头
    page.wait_for_timeout(200)
    check("header sort click", any("[sort]" in l for l in logs()))
    d = page.evaluate("table1._sort")
    check("sort asc", d and d["key"] == "hours" and d["asc"] is True, str(d))
    mousedown(800, 48)
    d = page.evaluate("table1._sort")
    check("sort desc", d and d["asc"] is False, str(d))
    mousedown(800, 48)  # 取消
    d = page.evaluate("table1._sort")
    check("sort cancel", d is None, str(d))

    # C. select 单元格：单击弹下拉，选择后 cell-change
    mousedown(435, 80)  # status 列第 1 行
    page.wait_for_timeout(200)
    disp = page.eval_on_selector("#table1 .nc-table__popup", "el => getComputedStyle(el).display")
    check("select popup opens", disp == "block", disp)
    n = page.locator("#table1 .nc-table__popup li").count()
    check("popup options=4", n == 4, f"n={n}")
    page.screenshot(path=out + r"\shot2_select_popup.png")
    page.locator("#table1 .nc-table__popup li").nth(2).dispatch_event("mousedown")
    page.wait_for_timeout(200)
    check("select commit cell-change log", any("[cell-change]" in l for l in logs()))
    check("status value updated", page.evaluate("table1.getData()[0].status") == "done")

    # D. 双击文本编辑 + Enter 提交下移
    page.mouse.dblclick(cx + 260, cy + 112)  # title 第 2 行
    page.wait_for_timeout(200)
    disp = page.eval_on_selector("#table1 .nc-table__editor", "el => getComputedStyle(el).display")
    check("editor opens on dblclick", disp == "block", disp)
    page.keyboard.type("HELLO")
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)
    check("text edit committed", page.evaluate("table1.getData()[1].title") == "HELLO")
    check("Enter moves down", page.evaluate("table1.activeCell.row") == 2)

    # D2. 自定义 progress 类型编辑（editType: input-number + parse 钳位 0-100）
    page.mouse.dblclick(cx + 940, cy + 80)  # progress 第 1 行
    page.wait_for_timeout(200)
    disp = page.eval_on_selector("#table1 .nc-table__editor", "el => getComputedStyle(el).display + '|' + el.type")
    check("progress editor opens (number)", disp == "block|number", disp)
    page.keyboard.type("66")
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    check("progress edit commits as number", page.evaluate("table1.getData()[0].progress") == 66)
    # 直接键入即编辑 + 超范围钳位：活动格 progress 列敲 999 -> 100
    page.evaluate("table1.setActiveCell(3, table1.columns.findIndex(c=>c.key==='progress')); table1.focus()")
    page.keyboard.press("9")
    page.wait_for_timeout(100)
    page.keyboard.type("99")
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    check("progress direct-type + clamp", page.evaluate("table1.getData()[3].progress") == 100)

    # D3. 自定义 switch 开关列（单击 / Enter 切换布尔值）
    pos = page.evaluate("""() => { const t = table1, ci = t.columns.findIndex(c => c.key === 'enabled');
      t.scrollToCell(0, ci);
      const r = t.cellRect(0, ci), h = t.el.getBoundingClientRect();
      return { x: h.left + r.x + r.width / 2, y: h.top + r.y + r.height / 2 }; }""")
    page.mouse.click(pos["x"], pos["y"])
    page.wait_for_timeout(150)
    check("switch click toggles off", page.evaluate("table1.getData()[0].enabled") is False)
    page.evaluate("table1.focus()")
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    check("switch Enter toggles on", page.evaluate("table1.getData()[0].enabled") is True)
    page.evaluate("table1.setScroll(0, 0)")

    # E. Space 切换 checkbox
    page.evaluate("table1.setActiveCell(0, table1.columns.findIndex(c=>c.key==='done')); table1.focus()")
    before_done = page.evaluate("table1.getData()[0].done")
    page.keyboard.press("Space")
    page.wait_for_timeout(100)
    check("space toggles checkbox", page.evaluate("table1.getData()[0].done") is not before_done, f"{before_done} -> {page.evaluate('table1.getData()[0].done')}")

    # F. 拖拽区域选择
    page.mouse.move(cx + 260, cy + 80)
    page.mouse.down()
    page.mouse.move(cx + 435, cy + 144, steps=6)
    page.mouse.up()
    page.wait_for_timeout(100)
    rng = page.evaluate("table1.getSelection()")
    check("drag range select", rng == {"startRow": 0, "endRow": 2, "startCol": 1, "endCol": 2}, str(rng))

    # G. copy 事件 -> TSV
    tsv = page.evaluate(
        """() => {
          const dt = new DataTransfer()
          const ev = new ClipboardEvent('copy', { clipboardData: dt, cancelable: true })
          document.querySelector('#table1 canvas').dispatchEvent(ev)
          return dt.getData('text/plain')
        }"""
    )
    lines = tsv.split("\n")
    check("copy TSV shape", len(lines) == 3 and all("\t" in ln for ln in lines), repr(tsv[:60]))
    check("copy contains HELLO", "HELLO" in tsv)

    # H. API pasteText（列类型自动解析）
    page.evaluate("table1.setActiveCell(20, 1); table1.pasteText('A1\\tB1\\nA2\\tB2')")
    check("pasteText cells", page.evaluate("table1.getData()[20].title") == "A1"
          and page.evaluate("table1.getData()[21].title") == "A2"
          and page.evaluate("table1.getData()[20].status") == "B1")

    # I. 原生 paste 事件 + select 选项按 label 映射 value
    page.evaluate("table1.setActiveCell(25, 1)")
    page.evaluate(
        """() => {
          const dt = new DataTransfer()
          dt.setData('text/plain', 'P1\\t高')
          const ev = new ClipboardEvent('paste', { clipboardData: dt, cancelable: true })
          document.querySelector('#table1 canvas').dispatchEvent(ev)
        }"""
    )
    check("paste event text", page.evaluate("table1.getData()[25].title") == "P1")
    check("select no match keeps raw", page.evaluate("table1.getData()[25].status") == "高")
    # priority 列选项 label=高/中/低 -> value high/mid/low，粘贴时按 label 映射
    page.evaluate("table1.setActiveCell(26, 3); table1.pasteText('低')")
    check("select priority label match", page.evaluate("table1.getData()[26].priority") == "low")

    # J. 填充手柄：同一次拖拽内向下填充 + 拖回选区自动回滚原值
    page.evaluate("table1.scrollToCell(0,0); table1.setActiveCell(0, 1)")
    page.wait_for_timeout(100)
    src = page.evaluate("table1.getData()[0].title")
    page.evaluate("table1.updateCell(4, 'title', 'ORIG-ROW5')")
    page.mouse.move(cx + 360, cy + 96)  # title 选区右下角 (360, 96)
    page.mouse.down()
    page.mouse.move(cx + 360, cy + 232, steps=6)  # 至 row ~5
    page.wait_for_timeout(100)
    filled = page.evaluate("table1.getData()[4].title")
    check("fill handle copies", filled == src, f"{filled!r} vs {src!r}")
    page.mouse.move(cx + 360, cy + 72, steps=6)  # 拖回选区内 -> 回滚
    page.mouse.up()
    page.wait_for_timeout(100)
    restored = page.evaluate("table1.getData()[4].title")
    check("fill rollback on shrink back", restored == "ORIG-ROW5", f"{restored!r}")

    # K. 列宽拖拽
    page.mouse.move(cx + 360, cy + 48)
    page.mouse.down()
    page.mouse.move(cx + 410, cy + 48, steps=6)
    page.mouse.up()
    w = page.evaluate("table1.columns[1].width")
    check("column resize", w == 250, f"w={w}")
    check("resize end log", any("[resize]" in l for l in logs()))

    # L. 行高切换
    page.click("#seg-rowh button[data-h='60']")
    check("setRowHeight 60", page.evaluate("table1.rowHeight") == 60)
    page.click("#seg-rowh button[data-h='32']")
    check("setRowHeight 32", page.evaluate("table1.rowHeight") == 32)

    # M. 滚动 + 远程分块加载
    page.mouse.move(cx + 500, cy + 200)
    page.mouse.wheel(0, 5000)
    page.wait_for_timeout(300)
    check("virtual scroll", page.evaluate("table1.scrollTop") > 100)
    box2 = page.locator("#table2 canvas").bounding_box()
    page.mouse.move(box2["x"] + 400, box2["y"] + 150)
    page.mouse.wheel(0, 12000)
    page.wait_for_timeout(1000)
    check("remote chunk fetch", any("[loadData]" in l for l in logs()))
    # 回归：chunk 闭包 offset 捕获 bug（首屏 0-49 行必须有真实数据而非 loading 占位）
    page.evaluate("table2.scrollToCell(0, 0)")
    page.wait_for_timeout(400)
    check("remote row0 cached", page.evaluate("!!table2._cachedRows.get(0)"))
    check("remote row0 data", page.evaluate("table2._cachedRows.get(0).title").startswith("任务项"))
    check("remote cached>=100", page.evaluate("table2._cachedRows.size") >= 100)
    page.screenshot(path=out + r"\shot3_after_interactions.png")

    # N. 勾选 + 删除
    page.evaluate("table1.scrollToCell(0,0)")
    page.wait_for_timeout(150)
    before = page.evaluate("table1.totalRows")
    mousedown(22, 80)  # 第 1 行勾选框（x<=36 命中 checkbox）
    page.wait_for_timeout(150)
    check("row check", page.evaluate("table1.selectedRows.size") == 1)
    # 单选模式：勾另一行自动取消前一行；表头全选框点击无效
    mousedown(22, 112)  # 第 2 行
    page.wait_for_timeout(150)
    check("single mode keeps one row",
          page.evaluate("JSON.stringify(Array.from(table1.selectedRows))") == "[1]",
          str(page.evaluate("Array.from(table1.selectedRows)")))
    mousedown(22, 80)  # 回到第 1 行
    page.wait_for_timeout(150)
    check("single mode switch", page.evaluate("JSON.stringify(Array.from(table1.selectedRows))") == "[0]")
    mousedown(22, 48)  # 表头全选区
    page.wait_for_timeout(150)
    check("single mode no select-all", page.evaluate("table1.selectedRows.size") == 1)
    # 示例 2 仍为多选：表头全选正常
    page.evaluate("table2._toggleSelectAll()")
    check("table2 multi mode intact",
          page.evaluate("table2.selectedRows.size") == page.evaluate("table2.totalRows"))
    page.evaluate("table2.selectedRows.clear()")
    # setRowSelection 运行时切换
    page.evaluate("table1.setRowSelection('multiple'); table1.selectedRows.clear(); table1._toggleSelectAll()")
    check("setRowSelection multiple enables select-all",
          page.evaluate("table1.selectedRows.size") == page.evaluate("table1.totalRows"))
    page.evaluate("table1.setRowSelection('single')")
    check("setRowSelection single trims to one", page.evaluate("table1.selectedRows.size") == 1)
    page.evaluate("table1.deleteSelected()")
    page.wait_for_timeout(150)
    check("deleteSelected", page.evaluate("table1.totalRows") == before - 1, f"{before} -> {page.evaluate('table1.totalRows')}")

    # O. Ctrl+A 全选 + 活动格 Delete
    page.evaluate("table1.focus()")
    page.keyboard.press("Control+a")
    rng = page.evaluate("table1.getSelection()")
    check("ctrl+a select all", rng and rng["startRow"] == 0 and rng["endCol"] == 14, str(rng))

    # O2. 查询定位（openSearch / Ctrl+F / 上下个环绕 / 数据变更后重算）
    page.evaluate("table1.openSearch()")
    page.wait_for_timeout(150)
    check("search bar visible", page.locator("#table1 .nc-table__search").is_visible())
    page.fill("#table1 .nc-table__search input", "任务项 #7")
    page.wait_for_timeout(150)
    mt = page.evaluate("table1._search.matches.length")
    check("search matches found", mt > 0, f"n={mt}")
    act0 = page.evaluate("table1.getActiveCell()")
    m0 = page.evaluate("table1._search.matches[0]")
    check("input auto-locates first match", act0["row"] == m0["row"] and act0["col"] == m0["col"], f"{act0} vs {m0}")
    page.evaluate("table1.searchNext()")
    m1 = page.evaluate("table1._search.matches[1]")
    act1 = page.evaluate("table1.getActiveCell()")
    check("searchNext to second match", act1["row"] == m1["row"] and act1["col"] == m1["col"], f"{act1} vs {m1}")
    page.evaluate("table1.searchPrev(); table1.searchPrev()")  # 1 -> 0 -> 环绕到最后一个
    actw = page.evaluate("table1.getActiveCell()")
    last = page.evaluate("table1._search.matches[table1._search.matches.length - 1]")
    check("searchPrev wraps to last", actw["row"] == last["row"] and actw["col"] == last["col"], f"{actw} vs {last}")
    page.keyboard.press("Escape")  # 焦点在搜索输入框
    page.wait_for_timeout(150)
    check("esc closes search bar", not page.locator("#table1 .nc-table__search").is_visible())
    page.evaluate("table1.focus()")
    page.keyboard.press("Control+f")
    page.wait_for_timeout(150)
    check("ctrl+f opens search bar", page.locator("#table1 .nc-table__search").is_visible())
    # 数据变更后匹配重算：查询“任务项 #2”（含 #2/#2x/#2xx），删除其所在首行后少一个
    page.fill("#table1 .nc-table__search input", "任务项 #2")
    page.wait_for_timeout(150)
    cntA = page.evaluate("table1._search.matches.length")
    firstRow = page.evaluate("table1._search.matches[0].row")
    page.evaluate(f"table1.closeSearch(); table1.deleteRows([{firstRow}])")
    page.evaluate("table1.openSearch()")
    page.fill("#table1 .nc-table__search input", "任务项 #2")
    page.wait_for_timeout(150)
    cntB = page.evaluate("table1._search.matches.length")
    check("recompute after deleteRows", cntA > 1 and cntB == cntA - 1, f"{cntA}->{cntB}")
    page.evaluate("table1.closeSearch()")
    page.screenshot(path=out + r"\shot3b_search.png")

    # O3. 垂直滚动条翻页按钮（首页/上一页/下一页/末页）
    btns = page.locator("#table2 .nc-table__page-btn")
    check("4 page buttons on v-scrollbar", btns.count() == 4)
    page.evaluate("table2.setScroll(0, 0)")
    page.wait_for_timeout(150)
    page.locator("#table2 .nc-table__page-btn--last").dispatch_event("click")
    page.wait_for_timeout(200)
    check("page-btn last", page.evaluate("table2.scrollTop") == page.evaluate("table2._maxScrollTop()"),
          str(page.evaluate("table2.scrollTop")))
    page.locator("#table2 .nc-table__page-btn--prev").dispatch_event("click")
    page.wait_for_timeout(200)
    check("page-btn prev", 0 < page.evaluate("table2.scrollTop") < page.evaluate("table2._maxScrollTop()"))
    page.locator("#table2 .nc-table__page-btn--first").dispatch_event("click")
    page.wait_for_timeout(200)
    check("page-btn first", page.evaluate("table2.scrollTop") == 0)
    page.locator("#table2 .nc-table__page-btn--next").dispatch_event("click")
    page.wait_for_timeout(200)
    check("page-btn next", page.evaluate("table2.scrollTop") > 0)
    page.evaluate("table2.setScroll(0, 0)")

    # P. 列设置菜单（chevron / toggle / 右键 / 排序 / 隐藏恢复 / 重命名 / 冻结 / 列 API）
    # 当前几何：GUTTER=80，冻结 id[80,160) title[160,410)，status[410,560) chevron 热区 [538,554]
    def menu_disp():
        return page.eval_on_selector("#table1 .nc-table__menu", "el => getComputedStyle(el).display")

    mousedown(546, 48)  # status 列 chevron
    page.wait_for_timeout(150)
    check("column menu opens on chevron", menu_disp() == "block")
    items = page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item")
    check("menu top-level count (field items lifted)", items.count() == 8, f"n={items.count()}")
    page.screenshot(path=out + r"\shot4_column_menu.png")
    mousedown(546, 48)  # 同列再点 -> toggle 关闭
    page.wait_for_timeout(150)
    check("column menu toggles closed", menu_disp() == "none")
    page.mouse.click(cx + 485, cy + 48, button="right")  # 右键列头
    page.wait_for_timeout(150)
    check("column menu opens on right-click", menu_disp() == "block")
    items.nth(1).dispatch_event("mousedown")  # 一级：数据排序 -> 展开二级
    page.wait_for_timeout(150)
    page.locator("#table1 .nc-table__menu--sub .nc-table__menu-item").nth(1).dispatch_event("mousedown")  # 降序排序
    page.wait_for_timeout(150)
    d = page.evaluate("table1._sort")
    check("menu sort desc", d and d["key"] == "status" and d["asc"] is False, str(d))
    mousedown(546, 48)
    page.wait_for_timeout(100)
    page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item").nth(5).dispatch_event("mousedown")  # 一级：隐藏字段
    page.wait_for_timeout(150)
    check("hide via menu", page.evaluate("table1.columns.length") == 14
          and page.evaluate("JSON.stringify(table1.getHiddenColumns())") == '["status"]')
    # 隐藏后 priority 右缘=520，chevron 热区 [498,514]，点 506；一级菜单出现"显示隐藏字段(1)"
    mousedown(506, 48)
    page.wait_for_timeout(150)
    top2 = page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item")
    check("menu shows restore entry", top2.count() == 9 and "显示隐藏字段" in top2.nth(6).inner_text(), f"n={top2.count()}")
    top2.nth(6).dispatch_event("mousedown")  # 显示隐藏字段（1）
    page.wait_for_timeout(150)
    check("showAllColumns restores", page.evaluate("table1.columns.length") == 15
          and page.evaluate("table1.getHiddenColumns()") == [])
    # 恢复后 status 回到 [410,560)，priority 移至 [560,670)，chevron 热区 [648,664]
    mousedown(656, 48)
    page.wait_for_timeout(150)
    page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item").nth(3).dispatch_event("mousedown")  # 一级：重命名字段
    page.wait_for_timeout(250)
    rd = page.eval_on_selector("#table1 .nc-table__rename", "el => getComputedStyle(el).display")
    check("rename input opens", rd == "block", rd)
    page.keyboard.type("优先级P")
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    check("rename commits", page.evaluate("table1._colByKey('priority').title") == "优先级P")
    # 数据对齐：一级「数据对齐」→ 二级「居中对齐」（priority 未冻结时 chevron=656）
    mousedown(656, 48)
    page.wait_for_timeout(150)
    page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item").nth(2).dispatch_event("mousedown")  # 数据对齐
    page.wait_for_timeout(150)
    subs = page.locator("#table1 .nc-table__menu--sub .nc-table__menu-item")
    check("align submenu three entries", subs.count() == 3, f"n={subs.count()}")
    subs.nth(2).dispatch_event("mousedown")  # 居中对齐
    page.wait_for_timeout(150)
    check("center align via menu", page.evaluate("table1._colByKey('priority').align") == "center")
    # 固定 priority（一级第 5 项：固定到左侧），固定列重排到前置块尾（index 2）
    mousedown(656, 48)
    page.wait_for_timeout(150)
    page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item").nth(4).dispatch_event("mousedown")  # 固定到左侧
    page.wait_for_timeout(150)
    check("pin via menu", page.evaluate("table1.columns[2].key") == "priority"
          and page.evaluate("table1.columns[2].fixed") is True)
    # 组带（两级表头）：几何 / 组菜单 / 重命名组 / 隐藏整组
    check("two-level header height", page.evaluate("table1.headerHeight") == 64)
    check("pipe title parsed", page.evaluate("table1._colByKey('status').title") == "状态"
          and page.evaluate("table1._colByKey('status').group.key") == "任务属性")
    check("ungrouped col no group", page.evaluate("table1._colByKey('id').group") is None)
    mousedown(146, 16)  # ID 列 chevron：未分组列头整高，组带行高度区仍可命中
    page.wait_for_timeout(150)
    check("full-height header chevron", menu_disp() == "block" and
          page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item").count() == 8)
    mousedown(146, 16)  # toggle 关闭
    page.wait_for_timeout(150)
    mousedown(430, 16)  # 组带「任务属性」[360,510)
    page.wait_for_timeout(150)
    gitems = page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item")
    check("group menu opens", menu_disp() == "block" and gitems.count() == 2, f"n={gitems.count()}")
    check("group menu entries", gitems.nth(0).inner_text() == "重命名组" and gitems.nth(1).inner_text() == "隐藏整组",
          gitems.nth(0).inner_text() + "/" + gitems.nth(1).inner_text())
    gitems.nth(0).dispatch_event("mousedown")
    page.wait_for_timeout(250)
    rdg = page.eval_on_selector("#table1 .nc-table__rename", "el => getComputedStyle(el).display")
    check("group rename input opens", rdg == "block", rdg)
    page.keyboard.type("档案资料")
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    check("group rename commits", page.evaluate("table1._colByKey('status').group.title") == "档案资料")
    page.evaluate("table1.hideGroup('时间信息')")
    page.wait_for_timeout(150)
    hd = page.evaluate("JSON.stringify(table1.getHiddenColumns())")
    check("hideGroup hides both", '"due"' in hd and '"checkin"' in hd, hd)
    page.evaluate("table1.showAllColumns()")
    page.wait_for_timeout(150)
    # 列头拖拽换位（column-reorder）：assignee 拖过 hours 右缘
    sort_before = page.evaluate("JSON.stringify(table1._sort)")
    keys0 = page.evaluate("table1.columns.map(c=>c.key)")
    si = keys0.index("assignee")
    hi = keys0.index("hours")
    x1 = page.evaluate(f"table1._colX({si}) + table1.columns[{si}].width / 2")
    x2 = page.evaluate(f"table1._colX({hi}) + table1.columns[{hi}].width + 4")
    page.mouse.move(cx + x1, cy + 48)
    page.mouse.down()
    page.mouse.move(cx + x1 + 15, cy + 48, steps=2)  # 超过 5px 阈值激活拖拽
    page.mouse.move(cx + x2, cy + 48, steps=4)
    page.mouse.up()
    page.wait_for_timeout(150)
    keys1 = page.evaluate("table1.columns.map(c=>c.key)")
    check("drag reorder assignee after hours",
          keys1[:si] == keys0[:si] and keys1[si] == "hours" and keys1[si + 1] == "assignee",
          f"{keys0} -> {keys1}")
    check("drag reorder no sort side-effect",
          page.evaluate("JSON.stringify(table1._sort)") == sort_before)
    # 冻结列不可拖：title 表头按下拖动后松开 = 点击排序
    page.mouse.move(cx + 200, cy + 48)
    page.mouse.down()
    page.mouse.move(cx + 260, cy + 48, steps=3)
    page.mouse.up()
    page.wait_for_timeout(150)
    d = page.evaluate("table1._sort")
    check("fixed col click-sorts", d and d["key"] == "title" and d["asc"] is True, str(d))
    page.evaluate("table1.sort('title', null)")
    # 还原列序：assignee 拖回 hours 前
    x1 = page.evaluate(f"table1._colX({si + 1}) + table1.columns[{si + 1}].width / 2")
    x2 = page.evaluate(f"table1._colX({si}) + 4")
    page.mouse.move(cx + x1, cy + 48)
    page.mouse.down()
    page.mouse.move(cx + x1 - 15, cy + 48, steps=2)
    page.mouse.move(cx + x2, cy + 48, steps=4)
    page.mouse.up()
    page.wait_for_timeout(150)
    check("drag back restores order", page.evaluate("table1.columns.map(c=>c.key)") == keys0,
          str(page.evaluate("table1.columns.map(c=>c.key)")))
    # 列 API：插入 / 删除
    page.evaluate("table1.insertColumn({key:'tmp', title:'临时列', type:'text', width:100}, 4)")
    check("insertColumn api", page.evaluate("table1.columns[4].key") == "tmp")
    page.evaluate("table1.deleteColumn('tmp')")
    check("deleteColumn api", page.evaluate("table1.columns.findIndex(c=>c.key==='tmp')") == -1)

    # P2. footer 聚合行（列配置 agg / 点击菜单切换 / 尊重筛选）
    expSum = page.evaluate("table1._rows.reduce((s,r)=>s+(typeof r.hours==='number'?r.hours:0),0)")
    check("agg sum via column config",
          abs(page.evaluate("table1._computeAgg(table1._colByKey('hours'))") - expSum) < 1e-6,
          str(page.evaluate("table1._computeAgg(table1._colByKey('hours'))")))
    expD = page.evaluate("new Set(table1._rows.map(r=>r.assignee).filter(v=>v!==''&&v!=null)).size")
    check("agg distinct via config", page.evaluate("table1._computeAgg(table1._colByKey('assignee'))") == expD)
    mousedown(page.evaluate("table1._colX(table1.columns.findIndex(c=>c.key==='status')) + 40"),
              page.evaluate("table1._cssH - table1._footerH()/2"))
    page.wait_for_timeout(150)
    check("agg menu opens on footer click", menu_disp() == "block")
    ait = page.locator("#table1 .nc-table__menu .nc-table__menu-item")
    check("agg menu has 7 options", ait.count() == 7, f"n={ait.count()}")
    ait.nth(2).dispatch_event("mousedown")  # 平均
    page.wait_for_timeout(150)
    check("setAggregation via menu", page.evaluate("table1.getAggregations().status") == "avg")
    page.evaluate("table1.setAggregation('status', null)")
    page.evaluate("table1.setFilter('status', ['done'])")
    page.wait_for_timeout(150)
    expFiltered = page.evaluate("table1._rows.filter(r=>r.status==='done').reduce((s,r)=>s+(typeof r.hours==='number'?r.hours:0),0)")
    check("agg respects active filters",
          abs(page.evaluate("table1._computeAgg(table1._colByKey('hours'))") - expFiltered) < 1e-6)
    page.evaluate("table1.clearFilters()")
    page.screenshot(path=out + r"\shot4b_aggbar.png")

    # Q. 操作列按钮（renderer.onClick 路由：编辑=updateCell / 删除=deleteRows）
    ix = page.evaluate("table1.columns.findIndex(c=>c.key==='_ops')")
    check("ops column exists", ix >= 0, f"ix={ix}")
    page.evaluate(f"table1.scrollToCell(0, {ix})")
    page.wait_for_timeout(150)
    x0 = page.evaluate(f"table1._colX({ix})")
    page.once("dialog", lambda d: d.accept("按钮改名"))
    page.mouse.click(cx + x0 + 31, cy + 80)  # 编辑按钮中心（局部 8+46/2=31）
    page.wait_for_timeout(250)
    check("ops edit button via onClick", page.evaluate("table1.getData()[0].title") == "按钮改名")
    before = page.evaluate("table1.totalRows")
    page.once("dialog", lambda d: d.accept())
    page.mouse.click(cx + x0 + 85, cy + 80)  # 删除按钮中心（局部 62+46/2=85）
    page.wait_for_timeout(250)
    check("ops delete button via onClick", page.evaluate("table1.totalRows") == before - 1, f"{before} -> {page.evaluate('table1.totalRows')}")
    # Enter 键也可触发交互单元格 onClick（nocodb 键盘激活）
    page.evaluate(f"table1.setActiveCell(1, {ix}); table1.focus()")
    page.once("dialog", lambda d: d.accept("键盘激活"))
    page.keyboard.press("Enter")
    page.wait_for_timeout(250)
    check("enter activates onClick cell", page.evaluate("table1.getData()[1].title") == "键盘激活")
    page.screenshot(path=out + r"\shot5_ops_buttons.png")

    # R. 数据筛选（Excel 式值勾选面板 / API / 远程参数 / 筛选视图删除映射）
    # 标题列已冻结 [160,410)，chevron 热区 [388,404]
    mousedown(396, 48)
    page.wait_for_timeout(150)
    items = page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item")
    check("first menu item is 数据筛选", items.nth(0).inner_text() == "数据筛选", items.nth(0).inner_text())
    items.nth(0).dispatch_event("mousedown")
    page.wait_for_timeout(250)
    fp = page.eval_on_selector("#table1 .nc-table__filter", "el => getComputedStyle(el).display")
    check("filter panel opens", fp == "block", fp)
    cnt = page.locator("#table1 .nc-table__filter-row").count()
    beforeR = page.evaluate("table1.totalRows")
    check("filter lists unique values", cnt >= 100, f"n={cnt}")
    page.locator("#table1 .nc-table__filter-row input[type=checkbox]").nth(0).click()
    page.locator("#table1 .nc-table__filter-foot button.is-primary").click()
    page.wait_for_timeout(250)
    check("filter applied hides rows", page.evaluate("table1.totalRows") == beforeR - 1,
          f"{beforeR} -> {page.evaluate('table1.totalRows')}")
    flt = page.evaluate("table1.getFilters()")
    check("getFilters has title", len(flt) == 1 and flt[0]["key"] == "title", str(flt)[:80])
    mousedown(396, 48)
    page.wait_for_timeout(150)
    items = page.locator("#table1 .nc-table__menu:not(.nc-table__menu--sub) .nc-table__menu-item")
    check("clear-filter entry in menu", items.count() == 9 and items.nth(1).inner_text() == "清除本列筛选", f"n={items.count()}")
    items.nth(1).dispatch_event("mousedown")
    page.wait_for_timeout(250)
    check("clear via menu restores", page.evaluate("table1.totalRows") == beforeR)
    # API 筛选
    page.evaluate("table1.setFilter('status', ['done'])")
    page.wait_for_timeout(150)
    exp = page.evaluate("table1._rows.filter(r=>r.status==='done').length")
    check("setFilter api", page.evaluate("table1.totalRows") == exp, f"{page.evaluate('table1.totalRows')} vs {exp}")
    # 面板搜索框 + 取消不改状态
    mousedown(396, 48)
    page.wait_for_timeout(150)
    page.locator("#table1 .nc-table__menu-item").nth(0).dispatch_event("mousedown")
    page.wait_for_timeout(250)
    page.fill("#table1 .nc-table__filter-search", "键盘")
    page.wait_for_timeout(150)
    scnt = page.locator("#table1 .nc-table__filter-row").count()
    check("search narrows list", 1 <= scnt <= 5, f"n={scnt}")
    page.locator("#table1 .nc-table__filter-foot button:not(.is-primary)").click()
    page.wait_for_timeout(150)
    check("cancel keeps filter", page.evaluate("table1.totalRows") == exp)
    page.evaluate("table1.clearFilters()")
    page.wait_for_timeout(150)
    check("clearFilters api", page.evaluate("table1.totalRows") == beforeR)
    # 远程模式：loadData 收到 filters 参数
    page.evaluate("table2.setFilter('status', ['done'])")
    page.wait_for_timeout(700)
    check("remote filters param", "filters=" in page.locator("#log").inner_text())
    page.evaluate("table2.clearFilters()")
    # 筛选视图下 deleteRows：视图索引 -> 源索引
    page.evaluate("table1.setFilter('status', ['done'])")
    page.wait_for_timeout(150)
    t0 = page.evaluate("table1.totalRows")
    src0 = page.evaluate("table1._rows.length")
    page.evaluate("table1.deleteRows([0])")
    page.wait_for_timeout(150)
    check("delete in filtered view", page.evaluate("table1.totalRows") == t0 - 1
          and page.evaluate("table1._rows.length") == src0 - 1)
    page.evaluate("table1.clearFilters()")
    page.screenshot(path=out + r"\shot6_filter.png")

    # S. datetime 编辑器（登记时间列 -> input type datetime-local）
    pos = page.evaluate("""() => { const t=table1, ci=t.columns.findIndex(c=>c.key==='checkin');
      t.scrollToCell(0,ci); const r=t.cellRect(0,ci), h=t.el.getBoundingClientRect();
      return {x:h.left+r.x+r.width/2, y:h.top+r.y+r.height/2}; }""")
    page.mouse.dblclick(pos["x"], pos["y"])
    page.wait_for_timeout(200)
    et = page.eval_on_selector("#table1 .nc-table__editor", "el => el.type")
    check("datetime editor type", et == "datetime-local", et)
    page.keyboard.press("Escape")

    # T. 自定义弹框录入（备注列：单击弹 modal，确定写回）
    pos2 = page.evaluate("""() => { const t=table1, ci=t.columns.findIndex(c=>c.key==='note');
      t.scrollToCell(1,ci); const r=t.cellRect(1,ci), h=t.el.getBoundingClientRect();
      return {x:h.left+r.x+r.width/2, y:h.top+r.y+r.height/2}; }""")
    page.mouse.click(pos2["x"], pos2["y"])
    page.wait_for_timeout(200)
    check("dialog opens", page.locator(".dlg-mask").count() == 1)
    page.fill(".dlg-box textarea", "弹框写入的备注")
    page.click(".dlg-btns button.primary")
    page.wait_for_timeout(200)
    check("dialog commit value", page.evaluate("table1.getData()[1].note") == "弹框写入的备注")
    check("dialog closed", page.locator(".dlg-mask").count() == 0)

    # W. year / yearmonth 单元类型：编辑器规格 + 值解析归一
    yr = page.evaluate("""() => {
      const t = table1
      t.setActiveCell(0, t.columns.findIndex(c=>c.key==='year'))
      t.makeCellEditable()
      const pu = document.querySelector('#table1 .nc-table__popup')
      const ed = document.querySelector('#table1 .nc-table__editor')
      return { display: getComputedStyle(pu).display, n: pu.querySelectorAll('li').length,
               first: pu.querySelector('li').textContent, hasActive: !!pu.querySelector('li.active'),
               editorHidden: getComputedStyle(ed).display === 'none' }
    }""")
    check("year dropdown opens", yr["display"] == "block" and yr["n"] >= 60 and yr["hasActive"] and yr["editorHidden"], str(yr))
    check("year dropdown desc order", int(yr["first"]) >= 2030, str(yr))
    before = page.evaluate("table1._rowAt(0).year")
    page.locator("#table1 .nc-table__popup li").nth(5).dispatch_event("mousedown")
    page.wait_for_timeout(150)
    after = page.evaluate("table1._rowAt(0).year")
    check("year dropdown picks value", after != before and isinstance(after, int) and 1000 <= after <= 9999, f"{before}->{after}")
    closed = page.evaluate("getComputedStyle(document.querySelector('#table1 .nc-table__popup')).display")
    check("year dropdown closes", closed == "none", closed)
    ym = page.evaluate("""() => {
      const t = table1
      t.setActiveCell(0, t.columns.findIndex(c=>c.key==='ym'))
      t.makeCellEditable()
      const ed = document.querySelector('#table1 .nc-table__editor')
      return { type: ed.type, value: ed.value }
    }""")
    check("yearmonth editor native month", ym["type"] == "month" and len(ym["value"]) == 7 and ym["value"][4] == "-", str(ym))
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    check("year parse 2026年", page.evaluate("table1._coerceValue(table1._colByKey('year'), '2026年')") == 2026)
    check("year parse invalid -> null", page.evaluate("table1._coerceValue(table1._colByKey('year'), 'abc')") is None)
    check("ym parse slash", page.evaluate("table1._coerceValue(table1._colByKey('ym'), '2026/3')") == "2026-03")
    check("ym parse date str", page.evaluate("table1._coerceValue(table1._colByKey('ym'), '2026-03-15')") == "2026-03")

    # U. 导出 xlsx：ZIP 合法 + 含关键部件 + export 事件
    ex = page.evaluate("""() => { let ev=null; const h=(p)=>ev=p; table1.on('export', h);
      const bytes = table1.exportExcel('t.xlsx', { rows: table1.getData().slice(0,3) });
      table1.off('export', h);
      const u = new Uint8Array(bytes); const sig = String.fromCharCode(u[0],u[1]);
      return { sig, len: u.length, ev: ev && { filename: ev.filename, rows: ev.rows } }; }""")
    check("xlsx zip signature", ex["sig"] == "PK", str(ex))
    check("xlsx export event", ex["ev"] and ex["ev"]["filename"] == "t.xlsx" and ex["ev"]["rows"] == 3, str(ex["ev"]))
    import zipfile, io
    zf = zipfile.ZipFile(io.BytesIO(bytes(page.evaluate("() => Array.from(table1.buildXlsx({rows: table1.getData().slice(0,3)}))"))))
    check("xlsx parts", set(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]).issubset(set(zf.namelist())))
    check("xlsx CRC ok", zf.testzip() is None)
    sheet = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
    check("xlsx has header 标题", "标题" in sheet and "登记时间" in sheet)
    check("xlsx cols width present", "<cols>" in sheet and '<col min="1" max="1" width="10.71"' in sheet, sheet[:400])
    check("xlsx two-row header + merges", '<mergeCell ref="C1:D1"' in sheet and '<mergeCell ref="A1:A2"' in sheet
          and '<row r="2">' in sheet and '<row r="3">' in sheet, sheet[:600])
    sty = zf.read("xl/styles.xml").decode("utf-8")
    check("xlsx grid borders in styles", 'style="thin"' in sty and 'borderId="1"' in sty, sty[:200])
    check("xlsx data cells bordered", ' s="2"' in sheet, sheet[600:900])
    check("xlsx align styles match table", ' s="3"' in sheet and ' s="4"' in sheet,
          "center={} right={}".format(sheet.count(' s="3"'), sheet.count(' s="4"')))

    # V. 下拉弹层底部翻转 + 背景色；列菜单矮表格内可滚动不溢出
    pop = page.evaluate("""() => { const t=table1, ci=t.columns.findIndex(c=>c.type==='select');
      t.setScroll(t._maxScrollTop(), t.scrollLeft); const row=t.totalRows-1;
      t.setActiveCell(row,ci); t.makeCellEditable();
      const pu=t.popup, host=t.el.getBoundingClientRect(), pr=pu.getBoundingClientRect(), cr=t.cellRect(row,ci);
      const bg=getComputedStyle(pu).backgroundColor;
      const within = pr.bottom<=host.bottom+1 && pr.top>=host.top-1;
      t._closePopup(); t.setScroll(0,0);
      return { bg, cellBottomInHost: cr.y+cr.height, cssH: t._cssH, within }; }""")
    check("popup bg nocodb default", pop["bg"] == "rgb(255, 255, 255)", pop["bg"])
    check("popup flips up at bottom", pop["cellBottomInHost"] > pop["cssH"]-70 and pop["within"] is True, str(pop))
    menu = page.evaluate("""() => { const t=window.table2; t._openMenu(0);
      const m=t.menu, host=t.el.getBoundingClientRect(), mr=m.getBoundingClientRect();
      return { within: mr.bottom<=host.bottom+1 && mr.top>=host.top-1, overflow: getComputedStyle(m).overflowY }; }""")
    check("column menu fits short table", menu["within"] is True and menu["overflow"] == "auto", str(menu))
    page.evaluate("window.table2._closeMenu()")

    print("\nJS ERRORS:", errors if errors else "none")
    print(f"\nRESULT: {len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        print("FAILED:", FAIL)
    browser.close()
    raise SystemExit(1 if (FAIL or errors) else 0)

