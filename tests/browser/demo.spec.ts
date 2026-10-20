import { test, expect } from "@playwright/test";
test("四页导航、项目筛选与会话下钻保持一致", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "AI 会话协作总览." }),
  ).toBeVisible();
  await expect(page.locator(".metric strong").first()).toHaveText("100 min");
  await expect(page.locator(".metric strong").nth(2)).toHaveText("2.0×");
  await page.screenshot({
    path: "docs/screenshots/overview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await expect(page.getByRole("cell", { name: "前端应用" })).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/projects.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "查看会话 →" }).first().click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "会话 A · 登录体验打磨 ↗" }).click();
  await expect(page.getByText(/^会话跨度/)).toBeVisible();
  await expect(page.getByText("第 2 轮", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/session.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "时间轴", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "多会话时间轴" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /多会话协作时间轴/ }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "项目筛选" }).selectOption("");
  await expect(page.locator(".fixed-names button")).toHaveCount(3);
  await page.screenshot({
    path: "docs/screenshots/timeline.png",
    fullPage: true,
  });
  await page.getByRole("textbox", { name: "搜索会话" }).fill("不存在的会话");
  await expect(page.getByText("没有符合筛选的会话")).toBeVisible();
});

test("本机只读入口可以导入隔离日志并切回合成数据", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "数据来源" }).selectOption("local");
  await expect(page.getByLabel("自动刷新")).toHaveValue("off");
  await expect(page.getByLabel("自动刷新")).toBeDisabled();
  await page.getByRole("combobox", { name: "日期范围" }).selectOption("all");
  await page.getByRole("button", { name: "扫描 / 刷新" }).click();
  await expect(page.locator(".import-summary")).toContainText("1 个日志");
  await expect(page.locator(".metric strong").first()).toHaveText("10 min");
  await expect(page.locator(".metric strong").nth(3)).toHaveText("100");
  await expect(page.locator(".fixed-names")).toContainText("验证日志导入");
  await expect(page.locator(".fixed-names")).toContainText("http-demo");
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page
    .getByRole("button", { name: "验证日志导入 ↗", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "验证日志导入", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "总览", exact: true }).click();
  await page.getByRole("combobox", { name: "数据来源" }).selectOption("demo");
  await expect(page.locator(".metric strong").first()).toHaveText("100 min");
});

test("边界样例能按上海日期裁切，并显式展示缺失状态", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "演示场景" })
    .selectOption("boundaries");
  await page.getByRole("textbox", { name: "搜索会话" }).fill("跨午夜");
  await page.getByRole("combobox", { name: "日期范围" }).selectOption("custom");
  await page.getByLabel("开始时间").fill("2026-10-19T00:00");
  await page.getByLabel("结束时间").fill("2026-10-20T00:00");
  await expect(page.locator(".metric strong").first()).toHaveText("20 min");
  await page.getByRole("textbox", { name: "搜索会话" }).fill("缺失结束");
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: /会话 F · 缺失结束/ }).click();
  await expect(page.getByText("缺少结束", { exact: true })).toBeVisible();
  await expect(page.getByText(/轮次边界缺失/).first()).toBeVisible();
});
