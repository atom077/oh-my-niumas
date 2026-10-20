import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../app/server.ts";

test("全天项目密度可下钻小时与分钟轮次，返回后保持选择", async ({ page }) => {
  await page.goto("/?source=demo");
  await expect(page.locator(".density-row")).toHaveCount(2);
  await expect(page.locator(".activity-overview")).toContainText(
    "不代表持续执行",
  );
  await page.screenshot({
    path: "docs/screenshots/layered-daily.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /前端应用 · 10-19 09:15/ }).click();
  await expect(page.locator(".hour-session-row")).toHaveCount(3);
  await expect(page.locator(".hour-summary")).toContainText(
    "2 个项目 · 3 个会话",
  );
  await page.screenshot({
    path: "docs/screenshots/layered-hour.png",
    fullPage: true,
  });
  const input = page
    .locator(".hour-session-row")
    .first()
    .locator(".input-mark")
    .first();
  const bar = page
    .locator(".hour-session-row")
    .first()
    .locator(".active-mark")
    .first();
  expect((await input.boundingBox())!.y + 26).toBeLessThanOrEqual(
    (await bar.boundingBox())!.y,
  );
  await page.locator(".hour-session-name").first().click();
  await expect(page.locator(".minute-turn-row")).toHaveCount(2);
  await page.locator(".minute-turn-name").nth(1).click();
  await expect(page.locator(".chosen-turn")).toContainText("第 2 轮");
  const before = await page.getByLabel("轮次显示范围").innerText();
  await page.getByRole("button", { name: "放大这一轮 →", exact: true }).click();
  await expect(page.getByLabel("轮次显示范围")).not.toHaveText(before);
  await page.getByRole("button", { name: "还原", exact: true }).click();
  await expect(page.getByLabel("轮次显示范围")).toHaveText(before);
  await page.screenshot({
    path: "docs/screenshots/timeline-stairs.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "← 返回小时视图", exact: true })
    .click();
  await expect(page.locator(".hour-session-row")).toHaveCount(3);
  await page.getByRole("button", { name: "← 全天概览", exact: true }).click();
  await expect(page.locator(".density-row")).toHaveCount(2);
  await expect(page.locator(".metric strong").first()).toHaveText("100 min");
});

test("小时边界、空时段和全局筛选重置层级，不改统计", async ({ page }) => {
  await page.goto("/?source=demo");
  await page.getByLabel("日期范围").selectOption("custom");
  await page.getByLabel("开始时间", { exact: true }).fill("2026-10-19T00:00");
  await page.getByLabel("结束时间", { exact: true }).fill("2026-10-20T00:00");
  await page.getByRole("button", { name: "小时分段", exact: true }).click();
  await page.getByLabel("小时开始").fill("2026-10-19T12:00");
  await expect(
    page.getByRole("heading", { name: "这一小时没有活动" }),
  ).toBeVisible();
  await expect(page.locator(".metric strong").first()).toHaveText("100 min");
  await page.getByLabel("小时开始").fill("2026-10-19T09:00");
  await expect(page.locator(".hour-session-row")).toHaveCount(3);
  await page.getByLabel("显示闭合等待").uncheck();
  await expect(page.locator(".wait-mark")).toHaveCount(0);
  await page.getByLabel("显示闭合等待").check();
  await expect(page.locator(".wait-mark")).not.toHaveCount(0);
  await page
    .getByRole("button", { name: "展开完整时间轴 ↗", exact: true })
    .click();
  await expect(page.getByLabel("小时开始")).toHaveValue("2026-10-19T09:00");
  await page.screenshot({
    path: "docs/screenshots/timeline-range.png",
    fullPage: true,
  });
  await page.getByLabel("项目筛选").selectOption({ label: "前端应用" });
  await expect(page.locator(".collaboration-timeline")).toHaveAttribute(
    "data-mode",
    "daily",
  );
  await expect(page.locator(".density-row")).toHaveCount(1);
});

test("多天概览按上海日期聚合，选日期后可进入具体小时", async ({ page }) => {
  await page.goto("/?source=demo");
  await page.getByLabel("演示场景").selectOption("boundaries");
  await expect(page.getByLabel("概览日期")).toBeVisible();
  await page.getByLabel("概览日期").fill("2026-10-19");
  await page
    .getByRole("button", {
      name: "查看 2026-10-19 00:00 这一小时",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("小时开始")).toHaveValue("2026-10-19T00:00");
  await expect(page.locator(".hourly-panel .active-mark")).not.toHaveCount(0);
  await expect(page.locator(".active-mark.preceded")).not.toHaveCount(0);
});

test("本机短问答在分钟视窗可读，缩放与刷新保留已选轮次", async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), "niumas-short-turns-"));
  await mkdir(join(root, "sessions"));
  const at = (seconds: number) =>
    new Date(Date.parse("2026-10-19T01:10:00Z") + seconds * 1000).toISOString();
  const rows: unknown[] = [
    {
      timestamp: at(0),
      type: "session_meta",
      payload: { id: "synthetic-short", cwd: "/synthetic/short" },
    },
  ];
  for (const [i, start, end] of [
    [1, 0, 11],
    [2, 300, 319],
  ]) {
    rows.push({
      timestamp: at(start),
      type: "event_msg",
      payload: {
        type: "item_completed",
        turn_id: `t${i}`,
        item: { type: "UserMessage", id: `u${i}` },
      },
    });
    rows.push({
      timestamp: at(start),
      type: "event_msg",
      payload: { type: "task_started", turn_id: `t${i}` },
    });
    rows.push({
      timestamp: at(end),
      type: "event_msg",
      payload: { type: "task_complete", turn_id: `t${i}` },
    });
  }
  await writeFile(
    join(root, "sessions", "short.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n"),
  );
  const server = await createApp({
    logRoot: root,
    dbPath: join(root, "cache.sqlite"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  try {
    await page.goto(`http://127.0.0.1:${address.port}/?source=local`);
    await page.getByLabel("日期范围").selectOption("all");
    await page
      .getByRole("button", { name: "扫描 / 刷新", exact: true })
      .click();
    await page.getByRole("button", { name: "小时分段", exact: true }).click();
    await page.locator(".hour-session-name").click();
    await expect(page.locator(".minute-turn-row")).toHaveCount(2);
    await expect(page.locator(".minute-turn-row").first()).toContainText(
      "11.0 s",
    );
    expect(
      (await page.locator(".minute-panel .active-mark").first().boundingBox())!
        .width,
    ).toBeGreaterThan(8);
    await page
      .getByRole("button", { name: "放大这一轮 →", exact: true })
      .click();
    await expect(page.locator(".minute-turn-row")).toHaveCount(1);
    const before = await page.getByLabel("轮次显示范围").innerText();
    await expect(page.locator(".time-plot-axis")).toContainText("09:10:");
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/analysis",
    );
    await page
      .getByRole("button", { name: "扫描 / 刷新", exact: true })
      .click();
    await response;
    await expect(page.getByLabel("轮次显示范围")).toHaveText(before);
    await expect(page.locator(".chosen-turn")).toContainText("第 1 轮");
    await page.screenshot({
      path: "docs/screenshots/layered-minute.png",
      fullPage: true,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("高级区间分析保留自定义范围、缩放、状态与同轴并发", async ({ page }) => {
  await page.goto("/?source=demo");
  await page.getByRole("button", { name: "时间轴", exact: true }).click();
  await page
    .getByText("高级区间分析 · 自由缩放与并发", { exact: true })
    .click();
  await page.getByRole("button", { name: "自定义范围", exact: true }).click();
  await page.getByLabel("显示开始", { exact: true }).fill("2026-10-19T09:10");
  await page.getByLabel("显示结束", { exact: true }).fill("2026-10-19T09:30");
  await page.getByRole("button", { name: "应用范围", exact: true }).click();
  await expect(
    page.getByLabel("时间轴显示范围", { exact: true }),
  ).toContainText("09:10");
  await page
    .locator(".advanced-timeline")
    .getByRole("button", { name: "放大", exact: true })
    .click();
  await expect(
    page.getByLabel("时间轴显示范围", { exact: true }),
  ).toContainText("09:15");
  await page.getByText("同轴并发曲线", { exact: true }).click();
  await expect(
    page.getByRole("img", { name: "AI 并发数随真实时间变化" }),
  ).toBeVisible();
  await page.getByLabel("包含轮次状态").selectOption("completed");
  await expect(page.locator(".density-row")).toHaveCount(2);
});
