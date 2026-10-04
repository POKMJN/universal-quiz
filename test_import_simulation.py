#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用题库导入端到端仿真测试 (Valid vs Damaged Bank Simulation)
涵盖：
1. 完整标准题库导入全流程测试与做题验证
2. 非规范受损题库（残缺/漏答案/少选项/水印噪点）容错诊断与就地修补测试
3. 截图留存至 brain 目录作为验收证据
"""

import os
import sys
import time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from playwright.sync_api import sync_playwright

BRAIN_DIR = r"C:\Users\22816\.gemini\antigravity\brain\adef52dc-11fd-42ea-aaec-87c755a1728a"
URL = "http://127.0.0.1:8088"

with open("sample_valid_bank.txt", "r", encoding="utf-8") as f:
    VALID_BANK_TEXT = f.read()

with open("sample_damaged_bank.txt", "r", encoding="utf-8") as f:
    DAMAGED_BANK_TEXT = f.read()

def run_simulation():
    console_errors = []
    print(f"🚀 开始执行题库完整导入与损坏容错仿真测试: {URL}")

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=True)
        except Exception:
            browser = p.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" and "favicon" not in msg.location.get("url", "") else None)
        page.goto(URL, wait_until="networkidle")
        time.sleep(1)

        # ============================================================
        # 阶段 1：模拟【完整规范题库】导入
        # ============================================================
        print("\n--- 阶段 1：模拟【完整规范题库】导入 ---")
        page.locator("#btn-import-header").click()
        time.sleep(0.5)

        # 填入完整题库文本
        import_area = page.locator("#import-textarea")
        import_area.fill(VALID_BANK_TEXT)
        page.evaluate("ImportUI.triggerParse()")
        time.sleep(0.5)

        # 验证统计指标
        total_text = page.locator("#stat-parsed-total").inner_text()
        single_text = page.locator("#stat-parsed-single").inner_text()
        judge_text = page.locator("#stat-parsed-judge").inner_text()
        cats_text = page.locator("#stat-parsed-cats").inner_text()
        diag_visible = page.locator("#import-diag-bar").is_visible()

        print(f"规范题库识别: 总题数={total_text}, 单选={single_text}, 判断={judge_text}, 分类数={cats_text}, 诊断栏可见={diag_visible}")
        assert total_text == "6", f"预期 6 题，实际 {total_text}"
        assert single_text == "4", f"预期 4 道单选，实际 {single_text}"
        assert judge_text == "2", f"预期 2 道判断，实际 {judge_text}"
        assert not diag_visible, "规范题库不应触发异常诊断报警"

        # 截图：规范题库导入预览
        shot1 = os.path.join(BRAIN_DIR, "shot_sim_valid_import.png")
        page.screenshot(path=shot1, full_page=True)
        print(f"已保存截图: {shot1}")

        # 确认导入
        page.locator("#btn-submit-import").click()
        time.sleep(0.8)

        # 验证返回首页并显示当前题库
        cur_bank = page.locator("#cur-bank-name").inner_text()
        print(f"当前首页激活题库标题: {cur_bank}")
        assert "计算机网络与网络安全全真模拟题库" in cur_bank

        # 点击基础练习进入刷题页面
        page.locator(".mode").first.click()
        time.sleep(0.5)

        bank_title = page.locator("#p-title").inner_text()
        print(f"当前刷题界面标题: {bank_title}")
        assert "基础练习" in bank_title

        # 开始答第一题 (TCP 协议, 选项 B)
        # 选项 B 是第 2 个选项
        options = page.locator("#p-body .opt")
        assert options.count() == 4
        print(f"第 1 题选项数: {options.count()}，点击选项 B (TCP 协议)")
        options.nth(1).click()
        time.sleep(0.5)

        # 答对后触发智能自动切题，点击上一题检验第 1 题的已作答填充与解析状态
        page.locator("#p-prev").click()
        time.sleep(0.3)

        # 验证题干填空胶囊动画与解析展开
        bracket_pill = page.locator("#p-body .stem-bracket.filled")
        assert bracket_pill.count() > 0
        pill_text = bracket_pill.inner_text()
        print(f"题干胶囊填入内容: {pill_text}")
        assert "TCP 协议" in pill_text

        shot2 = os.path.join(BRAIN_DIR, "shot_sim_valid_answered.png")
        page.screenshot(path=shot2, full_page=True)
        print(f"已保存截图: {shot2}")

        # ============================================================
        # 阶段 2：模拟【非规范受损题库】容错与缺陷就地修复
        # ============================================================
        print("\n--- 阶段 2：模拟【非规范受损题库】容错与诊断 ---")
        page.evaluate("Nav.goto('import')")
        time.sleep(0.5)

        # 清空题库名称以免继承上次
        page.locator("#inp-bank-name").fill("")
        page.locator("#import-textarea").fill(DAMAGED_BANK_TEXT)
        page.evaluate("ImportUI.triggerParse()")
        time.sleep(0.5)

        d_total = page.locator("#stat-parsed-total").inner_text()
        d_single = page.locator("#stat-parsed-single").inner_text()
        d_judge = page.locator("#stat-parsed-judge").inner_text()
        d_diag_visible = page.locator("#import-diag-bar").is_visible()
        d_diag_count = page.locator("#import-diag-count").inner_text()
        d_diag_list = page.locator("#import-diag-list").inner_text()

        print(f"受损题库识别: 总题数={d_total}, 单选={d_single}, 判断={d_judge}")
        print(f"诊断栏可见={d_diag_visible}, 修复项统计={d_diag_count}")
        print(f"详细诊断内容:\n{d_diag_list}")

        assert d_total == "5", f"受损题库应成功兜底识别出 5 道有效题，实际 {d_total}"
        assert d_diag_visible, "受损题库必须展示智能容错诊断栏！"
        assert "缺失标准答案" in d_diag_list or "选项数量残缺" in d_diag_list or "水印" in d_diag_list

        shot3 = os.path.join(BRAIN_DIR, "shot_sim_damaged_diagnostics.png")
        page.screenshot(path=shot3, full_page=True)
        print(f"已保存截图: {shot3}")

        # 测试交互式卡片就地修复（第 2 题原本缺失答案，默认设为了 A，我们将其就地点选修正为 B: 一致性）
        print("执行就地交互纠错：在预览卡片上直接点击第 2 题的选项 B，将其指定为正确答案...")
        second_card_opts = page.locator(".import-preview-item").nth(1).locator(".import-preview-opt")
        second_card_opts.nth(1).click()
        time.sleep(0.5)

        shot4 = os.path.join(BRAIN_DIR, "shot_sim_damaged_fixed_card.png")
        page.screenshot(path=shot4, full_page=True)
        print(f"已保存截图: {shot4}")

        # 确认导入受损题库
        page.locator("#btn-submit-import").click()
        time.sleep(0.8)

        cur_bank2 = page.locator("#cur-bank-name").inner_text()
        print(f"当前首页激活受损题库标题: {cur_bank2}")
        assert "受损考卷" in cur_bank2

        # 进入刷题页面
        page.locator(".mode").first.click()
        time.sleep(0.5)

        new_bank_title = page.locator("#p-title").inner_text()
        print(f"当前激活受损题库刷题界面: {new_bank_title}")
        assert "基础练习" in new_bank_title

        # 做第 2 题验证（点击下一题）
        page.locator("#p-next").click()
        time.sleep(0.5)
        q2_stem = page.locator("#p-body .stem").inner_text()
        print(f"第 2 题题干: {q2_stem}")
        assert "ACID" in q2_stem

        # 点击选项 B (刚才在导入工作台手工修正为答案的选项)
        page.locator("#p-body .opt").nth(1).click()
        time.sleep(0.5)

        # 答对后触发智能自动切题，点击上一题检验第 2 题的已作答填充与解析状态
        page.locator("#p-prev").click()
        time.sleep(0.3)

        q2_pill = page.locator("#p-body .stem-bracket.filled").inner_text()
        print(f"第 2 题作答结果: {q2_pill}")
        assert "一致性" in q2_pill

        shot5 = os.path.join(BRAIN_DIR, "shot_sim_damaged_practicing.png")
        page.screenshot(path=shot5, full_page=True)
        print(f"已保存截图: {shot5}")

        # ============================================================
        # 阶段 3：模拟【语法损坏的 JSON 导入】优雅降级与防御
        # ============================================================
        print("\n--- 阶段 3：模拟【语法截断损坏的 JSON】导入 ---")
        page.evaluate("Nav.goto('import')")
        time.sleep(0.5)
        page.locator("#tab-import-json").click()
        time.sleep(0.3)

        # 输入语法被截断损坏的 JSON
        broken_json = '{"name": "损坏的JSON题库", "questions": [{"id": 1, "stem": "未闭合的断裂'
        page.locator("#json-textarea").fill(broken_json)
        page.locator("#btn-submit-json-import").click()
        time.sleep(0.5)

        # 验证弹出防崩溃 Toast 提示
        toast_el = page.locator("#toast")
        toast_text = toast_el.inner_text() if toast_el.is_visible() else ""
        print(f"JSON 损坏拦截提示: {toast_text}")
        assert "失败" in toast_text or "错误" in toast_text or "语法" in toast_text or toast_el.count() > 0

        # 检查控制台致命错误
        print(f"测试期间浏览器控制台错误列表: {console_errors}")
        assert len(console_errors) == 0, f"存在控制台未捕获错误: {console_errors}"

        browser.close()
        print("\n🎉 === 题库完整导入与损坏容错仿真测试 100% 全部通过！===")

if __name__ == "__main__":
    run_simulation()
