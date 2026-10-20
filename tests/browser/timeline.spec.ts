import { test, expect } from "@playwright/test";

test("时间轴默认贴合活动，可选上午、自定义、缩放且不改变统计", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("日期范围").selectOption("custom");
  await page.getByLabel("开始时间", { exact: true }).fill("2026-10-19T00:00");
  await page.getByLabel("结束时间", { exact: true }).fill("2026-10-20T00:00");
  const display = page.getByLabel("时间轴显示范围", { exact: true });
  await expect(display).toContainText("08:55");
  await expect(display).toContainText("09:55");
  await expect(
    page.getByText("HUMAN × AI / COLLABORATION", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("本地优先 · 只读观测", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "上午", exact: true }).click();
  await expect(display).toContainText("00:00");
  await expect(display).toContainText("12:00");
  await page.getByRole("button", { name: "下午", exact: true }).click();
  await expect(
    page.getByText("当前显示范围没有活动", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("显示开始", { exact: true }).fill("2026-10-19T09:10");
  await page.getByLabel("显示结束", { exact: true }).fill("2026-10-19T09:30");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  await expect(display).toContainText("09:10");
  await expect(display).toContainText("09:30");
  await expect(page.locator(".metric strong").first()).toHaveText("100 min");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(display).toContainText("09:15");
  await expect(display).toContainText("09:25");
  await page
    .getByRole("button", { name: "展开完整时间轴 ↗", exact: true })
    .click();
  await expect(display).toContainText("09:15");
  await page.getByLabel("显示结束", { exact: true }).fill("2026-10-19T09:00");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("结束时间");
  await expect(display).toContainText("09:25");
  await page.getByRole("button", { name: "完整日期范围", exact: true }).click();
  await expect(display).toContainText("10-20 00:00");
  await page.getByRole("button", { name: "贴合活动", exact: true }).click();
  await expect(display).toContainText("08:55");
  await page.screenshot({
    path: "docs/screenshots/timeline-range.png",
    fullPage: true,
  });
});

test("图表支持 Ctrl 滚轮缩放和滑块拖动，同轴并发跟随范围", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("日期范围").selectOption("custom");
  await page.getByLabel("开始时间", { exact: true }).fill("2026-10-19T00:00");
  await page.getByLabel("结束时间", { exact: true }).fill("2026-10-20T00:00");
  await page.getByRole("button", { name: "上午", exact: true }).click();
  const display = page.getByLabel("时间轴显示范围", { exact: true });
  await expect(display).toContainText("12:00");
  const beforeWheel = await display.innerText();
  const chart = page.getByRole("img", { name: /多会话协作时间轴/ });
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 80);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -600);
  await page.keyboard.up("Control");
  await expect(display).not.toHaveText(beforeWheel);
  await page.getByRole("button", { name: "贴合活动", exact: true }).click();
  await expect(display).toContainText("08:55");
  await chart.scrollIntoViewIfNeeded();
  const slider = await chart.boundingBox();
  const beforeDrag = await display.innerText();
  // Drag the selected 08:55–09:55 segment of the public 24 h slider.
  const x = slider!.x + 10 + ((slider!.width - 35) * (9 + 25 / 60)) / 24;
  const y = slider!.y + slider!.height - 18;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y, { steps: 10 });
  await page.mouse.up();
  await expect(display).not.toHaveText(beforeDrag);
  await expect(page.locator(".metric strong").first()).toHaveText("100 min");
  await page.getByRole("button", { name: "时间轴", exact: true }).click();
  await page
    .getByText("查看同轴并发曲线 · 平均倍数只针对活跃覆盖时段", { exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "AI 并发数随真实时间变化" }),
  ).toBeVisible();
  await page
    .getByLabel("显示开始", { exact: true })
    .fill("2026-10-19T09:10:05");
  await page
    .getByLabel("显示结束", { exact: true })
    .fill("2026-10-19T09:10:20");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  await expect(display).toContainText("09:10:05");
  await expect(display).toContainText("09:10:20");
});

test("跨日视窗有日期标识，手动刷新保留范围，换筛选重新贴合", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByLabel("演示场景").selectOption("boundaries");
  await page.getByLabel("搜索会话").fill("跨午夜");
  await page.getByLabel("日期范围").selectOption("custom");
  await page.getByLabel("开始时间", { exact: true }).fill("2026-10-18T22:00");
  await page.getByLabel("结束时间", { exact: true }).fill("2026-10-19T02:00");
  const display = page.getByLabel("时间轴显示范围", { exact: true });
  await expect(display).toContainText("10-18 23:45");
  await expect(display).toContainText("10-19 00:25");
  await expect(
    page.getByRole("button", { name: "上午", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("数据来源").selectOption("local");
  await page.getByLabel("日期范围").selectOption("all");
  await page.getByRole("button", { name: "扫描 / 刷新", exact: true }).click();
  await expect(display).toContainText("09:10");
  await page.getByLabel("显示开始", { exact: true }).fill("2026-10-19T09:02");
  await page.getByLabel("显示结束", { exact: true }).fill("2026-10-19T09:08");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  await page.getByRole("button", { name: "扫描 / 刷新", exact: true }).click();
  await expect(display).toContainText("09:02");
  await expect(display).toContainText("09:08");
  let refreshes = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/refresh") refreshes++;
  });
  await page.getByLabel("自动刷新").selectOption("15");
  await page.clock.runFor(15000);
  await expect.poll(() => refreshes).toBe(1);
  await expect(
    page.getByRole("button", { name: "扫描 / 刷新", exact: true }),
  ).toBeEnabled();
  await expect(display).toContainText("09:02");
  await expect(display).toContainText("09:08");
  await page.getByLabel("自动刷新").selectOption("off");
  await page.getByLabel("搜索会话").fill("验证日志导入");
  await expect(display).toContainText("09:00");
  await expect(display).toContainText("09:10");
});
