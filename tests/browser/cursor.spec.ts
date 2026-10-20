import { test, expect } from "@playwright/test";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../app/server.ts";
import { cursorFixture } from "../helpers/cursor-fixture.ts";

test("Cursor 来源筛选、未知指标、记录时长与跨来源时间轴", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "niumas-cursor-browser-"));
  await cp("fixtures/import-smoke", root, { recursive: true });
  const cursorRoot = join(root, "cursor");
  await cursorFixture(cursorRoot);
  const server = await createApp({
    logRoot: root,
    cursorRoot,
    dbPath: join(root, "cache.sqlite"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("missing address");
  try {
    await page.goto(`http://127.0.0.1:${address.port}/?source=demo`);
    await page.getByLabel("数据来源").selectOption("local");
    await page.getByLabel("日期范围").selectOption("all");
    await page
      .getByRole("button", { name: "扫描 / 刷新", exact: true })
      .click();
    await expect(page.locator(".import-summary")).toContainText(
      "Cursor 1 个会话",
    );
    await expect(page.locator(".density-row")).toHaveCount(1);
    await page.getByRole("button", { name: "小时分段", exact: true }).click();
    await expect(page.locator(".hour-session-row")).toHaveCount(2);
    await expect(page.locator(".hourly-panel")).toContainText("Codex");
    await expect(page.locator(".hourly-panel")).toContainText("Cursor");
    await page.getByRole("button", { name: "全天概览", exact: true }).click();
    await page.getByLabel("会话来源").selectOption("cursor");
    await expect(page.locator(".metric strong").first()).toHaveText("1.3 min");
    await expect(page.locator(".metrics .metric").first()).toContainText(
      "AI 累计时长 · Cursor 记录",
    );
    await expect(page.locator(".metrics .metric").first()).toContainText(
      "记录覆盖 2/2 轮",
    );
    await expect(
      page.locator(".metrics .metric").nth(1).locator("strong"),
    ).toHaveText("N/A");
    await expect(page.locator(".metrics .metric").nth(2)).toContainText(
      "缺少可定位的执行区间",
    );
    await expect(page.locator(".cursor-coverage")).toContainText(
      "整轮边界及 Token 未验证",
    );
    await page.screenshot({
      path: "docs/screenshots/cursor-overview.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await expect(page.locator("tbody tr td").nth(2)).toContainText("1.3 min");
    await expect(page.locator("tbody tr td").nth(2)).toContainText(
      "Cursor 记录",
    );
    await page.getByRole("button", { name: "会话", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody .provider-badge")).toHaveText("Cursor");
    await expect(page.locator("tbody tr td").nth(3)).toContainText("1.3 min");
    await page
      .locator(".session-button")
      .filter({ hasText: "Cursor 合成写作" })
      .click();
    await expect(page.locator(".reported-duration").first()).toContainText(
      "40.0 s",
    );
    await expect(
      page.locator(".detail-metrics .metric strong").first(),
    ).toHaveText("1.3 min");
    await page.getByRole("button", { name: "时间轴", exact: true }).click();
    await expect(page.locator(".density-row")).toHaveCount(1);
    await page.getByRole("button", { name: "小时分段", exact: true }).click();
    await expect(page.locator(".hourly-panel")).toContainText(
      "Cursor 合成写作",
    );
    await expect(page.locator(".hourly-panel .active-mark")).toHaveCount(0);
    await expect(page.locator(".hourly-panel .input-mark")).toHaveCount(2);
    await page.locator(".hour-session-name").click();
    await expect(page.locator(".minute-turn-row")).toHaveCount(2);
    await expect(page.locator(".minute-panel .active-mark")).toHaveCount(0);
    await expect(page.locator(".chosen-turn .reported-duration")).toContainText(
      "40.0 s",
    );
    await page.screenshot({
      path: "docs/screenshots/cursor.png",
      fullPage: true,
    });
    await page.getByLabel("会话来源").selectOption("codex");
    await expect(page.locator(".collaboration-timeline")).not.toContainText(
      "Cursor 合成写作",
    );
    await page.getByRole("button", { name: "总览", exact: true }).click();
    await expect(page.locator(".metric strong").first()).toHaveText("10 min");
    await expect(page.locator(".metrics .metric").first()).not.toContainText(
      "Cursor 记录",
    );
    await page.getByLabel("会话来源").selectOption("");
    await expect(page.locator(".metric strong").first()).toHaveText("11.3 min");
    await expect(page.locator(".metrics .metric").first()).toContainText(
      "Codex 10 min + Cursor 记录 1.3 min",
    );
    await expect(page.locator(".metrics .metric").nth(2)).toContainText(
      "10 min ÷ 10 min",
    );
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await expect(page.locator("tbody tr td").nth(2)).toContainText("11.3 min");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
