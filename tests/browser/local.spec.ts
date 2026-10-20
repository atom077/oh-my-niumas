import { test, expect } from "@playwright/test";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

test("本地项目别名、合并恢复及会话备注贯通筛选和刷新", async ({ page }) => {
  const root = await readFile(".local/e2e-root.txt", "utf8");
  const text = await readFile(
    "fixtures/import-smoke/sessions/synthetic.jsonl",
    "utf8",
  );
  const second = join(root, "sessions", "second.jsonl");
  await writeFile(
    second,
    text
      .replaceAll("synthetic-http-session", "second-session")
      .replaceAll("/synthetic/http-demo", "/synthetic/second"),
  );
  try {
    await page.goto("/?source=demo");
    await page.getByLabel("数据来源").selectOption("local");
    await page.getByLabel("日期范围").selectOption("all");
    await page
      .getByRole("button", { name: "扫描 / 刷新", exact: true })
      .click();
    await expect(page.locator(".import-summary")).toContainText("2 个日志");
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await page.getByText("管理本地项目", { exact: true }).click();
    const names = page.getByLabel("项目别名");
    await names.nth(0).fill("前端体验");
    await page
      .getByRole("button", { name: "保存别名", exact: true })
      .nth(0)
      .click();
    await expect(page.getByLabel("项目筛选")).toContainText("前端体验");
    const target = await page
      .getByLabel("合并到项目")
      .nth(1)
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await page.getByLabel("合并到项目").nth(1).selectOption(target!);
    await page
      .getByRole("button", { name: "合并", exact: true })
      .nth(1)
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "查看会话 →" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.locator(".session-button").first().click();
    await page.getByLabel("会话备注").fill("检查登录回归");
    await page.getByRole("button", { name: "保存备注" }).click();
    await expect(page.locator(".session-label [role=status]")).toContainText(
      "已保存",
    );
    await page
      .getByRole("button", { name: "扫描 / 刷新", exact: true })
      .click();
    await expect(page.getByLabel("会话备注")).toHaveValue("检查登录回归");
    await page.getByRole("button", { name: "会话", exact: true }).click();
    await page.getByLabel("搜索会话").fill("登录回归");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "清除筛选 ↺" }).click();
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await page.getByText("管理本地项目", { exact: true }).click();
    await page
      .getByRole("button", { name: "恢复原始归属", exact: true })
      .nth(1)
      .click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.screenshot({
      path: "docs/screenshots/local-labels.png",
      fullPage: true,
    });
  } finally {
    await rm(second, { force: true });
  }
});

test("扫描过本机日志后，默认打开本机数据", async ({ page }) => {
  await page.goto("/?source=local");
  await page.getByLabel("日期范围").selectOption("all");
  await page.getByRole("button", { name: "扫描 / 刷新", exact: true }).click();
  await expect(page.locator(".refresh-status")).toContainText("最近刷新");
  await page.goto("/");
  await expect(page.getByLabel("数据来源")).toHaveValue("local");
  await expect(page.locator(".source-pill")).toHaveText("本机只读");
  await expect(page.locator(".density-matrix")).toContainText("http-demo");
  await expect(page.locator(".metric strong").first()).toHaveText("10 min");
  await page.getByLabel("数据来源").selectOption("demo");
  await expect(page.locator(".metric strong").first()).toHaveText("100 min");
});
