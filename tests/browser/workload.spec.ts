import { test, expect } from "@playwright/test";

test("工作量图表随筛选更新，点击柱图进入对应小时，空结果不展示假零", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/?source=demo");
  await expect(page.locator(".ring-total strong")).toHaveText("100");
  await expect(page.locator(".source-workload-legend")).toContainText("100.0%");
  await expect(page.locator(".workload-bars canvas")).toBeVisible();
  await page.screenshot({ path: ".local/glacier-qa/overview.png", fullPage: false });
  const bar = page.locator(".workload-bars");
  const box = await bar.boundingBox();
  if (!box) throw Error("柱图未渲染");
  await bar.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator(".collaboration-timeline")).toHaveAttribute("data-mode", "hour");
  await page.getByLabel("项目筛选").selectOption({ label: "数据服务" });
  await expect(page.locator(".ring-total strong")).toHaveText("25");
  await page.getByLabel("搜索会话").fill("不存在的会话");
  await expect(page.locator(".ring-total")).toHaveCount(0);
  await expect(page.locator(".chart-empty")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("窄屏保留导航与图表，页面没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?source=demo");
  await expect(page.locator(".ring-total strong")).toHaveText("100");
  await expect(page.getByRole("button", { name: "说明与设置", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".local/glacier-qa/mobile.png", fullPage: true });
});
