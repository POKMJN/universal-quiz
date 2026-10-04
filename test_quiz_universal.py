# -*- coding: utf-8 -*-
"""
通用刷题器端到端自动化测试套件 (Playwright E2E Test Suite)
验证项目：
1. 首页加载与默认题库初始化
2. 题库抽屉展开、多题库切换与状态同步
3. 练习模式与题干括号留白/作答后动态填入
4. 背题模式与做题模式切换
5. 答题卡抽屉与题目跳转
6. 题库导入工作台：一键范例模板填入、智能解析统计、卡片实时预览
7. 题库生成与无缝激活测试
8. 主题切换与视觉样式
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)

PORT = 8088
URL = f"http://127.0.0.1:{PORT}"
ARTIFACT_DIR = r"C:\Users\22816\.gemini\antigravity\brain\adef52dc-11fd-42ea-aaec-87c755a1728a"
os.makedirs(ARTIFACT_DIR, exist_ok=True)

def run_e2e_tests():
    print(f"=== 开始运行通用刷题器端到端验证测试 [目标: {URL}] ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 412, "height": 915})
        page = context.new_page()

        # 1. 访问首页
        print("\n[Step 1] 加载主页并等待初始化完成...")
        page.goto(URL)
        page.wait_for_selector("#loading", state="hidden", timeout=10000)
        page.wait_for_selector("#screen-home.active", timeout=5000)
        time.sleep(0.5)

        home_title = page.inner_text("#home-title")
        st_total = page.inner_text("#st-total")
        print(f"-> 默认独立示范题库标题: {home_title}, 题目总数: {st_total}")
        assert "通用常识" in home_title, "默认题库应为通用常识示范题库"
        assert int(st_total) == 7, "通用常识示范题库题目数应为7"

        shot_home = os.path.join(ARTIFACT_DIR, "shot_universal_home.png")
        page.screenshot(path=shot_home)
        print(f"已保存截图: {shot_home}")

        # 2. 测试题库管理抽屉
        print("\n[Step 2] 打开题库管理抽屉...")
        page.click("#bank-picker-btn")
        page.wait_for_selector("#bank-drawer.on", timeout=4000)
        time.sleep(0.4)

        shot_drawer = os.path.join(ARTIFACT_DIR, "shot_universal_bank_drawer.png")
        page.screenshot(path=shot_drawer)
        print(f"已保存抽屉截图: {shot_drawer}")

        # 关闭抽屉返回首页
        page.click("#bank-drawer .close")
        time.sleep(0.3)

        # 3. 测试练习模式与题干填空动态展示
        print("\n[Step 3] 进入基础练习，检验题干填空与作答联动...")
        page.click(".mode:nth-child(1)") # 基础练习
        page.wait_for_selector("#screen-practice.active", timeout=4000)
        time.sleep(0.4)

        stem_initial = page.inner_html("#p-body .stem")
        print("未作答题干 HTML:", stem_initial)
        assert "stem-bracket blank" in stem_initial, "初始状态必须显示未作答留白胶囊"

        # 点击作答选项 A (社会舆论)
        page.click("#p-body .opts button:nth-child(1)")
        time.sleep(0.3)

        stem_answered = page.inner_html("#p-body .stem")
        print("作答后题干 HTML:", stem_answered)
        assert "stem-bracket filled ok" in stem_answered, "作答后必须填充绿色高亮答案胶囊"
        assert "社会舆论" in stem_answered, "答案文本必须被嵌入题干"

        shot_practice_ok = os.path.join(ARTIFACT_DIR, "shot_universal_practice_answered.png")
        page.screenshot(path=shot_practice_ok)
        print(f"已保存作答填空截图: {shot_practice_ok}")

        # 测试背题模式切换
        print("\n[Step 4] 测试背题模式 (Recite Mode)...")
        page.click("#tab-mode-recite")
        time.sleep(0.3)
        page.click("#p-next")
        time.sleep(0.3)

        recite_stem = page.inner_html("#p-body .stem")
        print("背题模式题干 HTML:", recite_stem)
        assert "stem-bracket filled ok" in recite_stem, "背题模式下一题应直接嵌入标准答案"

        shot_recite = os.path.join(ARTIFACT_DIR, "shot_universal_recite_mode.png")
        page.screenshot(path=shot_recite)
        print(f"已保存背题模式截图: {shot_recite}")

        # 返回首页
        page.click("#screen-practice .navbar button.icon-btn:nth-child(1)")
        page.wait_for_selector("#screen-home.active", timeout=4000)
        time.sleep(0.3)

        # 4. 测试题库导入工作台与简易导入
        print("\n[Step 5] 测试题库导入工作台 (Import Workbench)...")
        page.click("button:has-text('➕ 导入题库')")
        page.wait_for_selector("#screen-import.active", timeout=4000)
        time.sleep(0.3)

        # 点击一键填入范例模板
        print("点击一键填入范例模板...")
        page.click("#btn-fill-template")
        time.sleep(0.5)

        total_parsed = page.inner_text("#stat-parsed-total")
        single_parsed = page.inner_text("#stat-parsed-single")
        judge_parsed = page.inner_text("#stat-parsed-judge")
        print(f"-> 智能解析识别统计: 总数={total_parsed}, 单选={single_parsed}, 判断={judge_parsed}")
        assert int(total_parsed) == 5, "范例模板应精准解析出5道题"
        assert int(single_parsed) == 3, "单选题应为3道"
        assert int(judge_parsed) == 2, "判断题应为2道"

        # 检查实时预览卡片
        preview_count = page.locator(".import-preview-item").count()
        print(f"-> 实时预览试题卡片数量: {preview_count}")
        assert preview_count >= 3, "必须渲染出实时试题预览卡片"

        # 修改导入题库名称
        page.fill("#inp-bank-name", "2026年终极考核测试题库")
        time.sleep(0.2)

        shot_import_bench = os.path.join(ARTIFACT_DIR, "shot_universal_import_workbench.png")
        page.screenshot(path=shot_import_bench)
        print(f"已保存导入工作台截图: {shot_import_bench}")

        # 确认导入
        print("确认导入并立即激活新题库...")
        page.click("#btn-submit-import")
        page.wait_for_selector("#screen-home.active", timeout=4000)
        time.sleep(0.5)

        active_title_after_import = page.inner_text("#home-title")
        active_total_after_import = page.inner_text("#st-total")
        print(f"-> 导入后当前活跃题库: {active_title_after_import}, 总数: {active_total_after_import}")
        assert "2026年终极考核测试题库" in active_title_after_import, "必须无缝切换至刚导入的新题库"
        assert int(active_total_after_import) == 5, "新题库题目数应为5"

        # 5. 在新导入题库中进行测试练习
        print("\n[Step 6] 检验新导入题库中的刷题交互...")
        page.click(".mode:nth-child(1)") # 基础练习
        page.wait_for_selector("#screen-practice.active", timeout=4000)
        time.sleep(0.4)

        imported_q1_stem = page.inner_html("#p-body .stem")
        print("新导入题库第1题题干:", imported_q1_stem)
        assert "道德" in imported_q1_stem and "stem-bracket blank" in imported_q1_stem

        # 切换到判断题 (第4题)
        page.click("#screen-practice .navbar button.icon-btn:nth-child(3)") # 答题卡
        page.wait_for_selector("#card-drawer.on", timeout=4000)
        time.sleep(0.3)
        page.click(".grid-card .cq:nth-child(4)") # 跳转第4题
        time.sleep(0.4)

        judge_stem = page.inner_text("#p-body .stem")
        print("跳转第4题(判断题):", judge_stem)
        assert "Python" in judge_stem

        # 作答正确 (A)
        page.click("#p-body .opts button:nth-child(1)")
        time.sleep(0.3)

        explain_text = page.inner_text("#p-body .explain")
        print("作答后解析:", explain_text)
        assert "回答正确" in explain_text

        shot_imported_practice = os.path.join(ARTIFACT_DIR, "shot_universal_imported_practicing.png")
        page.screenshot(path=shot_imported_practice)
        print(f"已保存新题库刷题截图: {shot_imported_practice}")

        # 退出到主页
        page.click("#screen-practice .navbar button.icon-btn:nth-child(1)")
        page.wait_for_selector("#screen-home.active", timeout=4000)

        # 6. 测试暗黑模式主题切换
        print("\n[Step 7] 测试外观主题切换 (暗黑模式)...")
        page.click("#theme-btn") # 浅色
        time.sleep(0.2)
        page.click("#theme-btn") # 深色
        time.sleep(0.3)

        dark_class = page.evaluate("() => document.documentElement.classList.contains('dark')")
        print(f"-> 暗黑模式已生效: {dark_class}")
        assert dark_class, "必须成功切换为深色模式"

        shot_dark = os.path.join(ARTIFACT_DIR, "shot_universal_dark_mode.png")
        page.screenshot(path=shot_dark)
        print(f"已保存暗黑模式截图: {shot_dark}")

        browser.close()

    print("\n🎉 === 全套自动化端到端测试 100% 通过！===")

if __name__ == "__main__":
    run_e2e_tests()
