import { test, expect } from "@playwright/test";
import { readFile, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

test("准实时刷新保持详情，处理追加截断、错误恢复、暂停与关闭", async ({
  page,
}) => {
  const root = await readFile(".local/e2e-root.txt", "utf8");
  const input = join(root, "sessions", "synthetic.jsonl");
  const original = await readFile(input, "utf8");
  await page.clock.install();
  let scans = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/refresh") scans++;
  });
  try {
    await page.goto("/");
    await page.getByLabel("数据来源").selectOption("local");
    await expect(page.getByLabel("自动刷新")).toBeVisible();
    await expect(page.getByLabel("自动刷新")).toHaveValue("off");
    await page.getByLabel("日期范围").selectOption("all");
    await page
      .getByRole("button", { name: "扫描 / 刷新", exact: true })
      .click();
    await expect(page.getByLabel("自动刷新")).toBeEnabled();
    await page.getByRole("button", { name: "会话", exact: true }).click();
    await page.locator(".session-button").first().click();
    await expect(page.locator(".turn")).toHaveCount(1);
    await page.getByLabel("自动刷新").selectOption("15");
    await appendFile(
      input,
      [
        {
          timestamp: "2026-10-19T01:20:00Z",
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-two" },
        },
        {
          timestamp: "2026-10-19T01:30:00Z",
          type: "event_msg",
          payload: { type: "task_complete", turn_id: "turn-two" },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
    const before = scans;
    await page.clock.runFor(15000);
    await expect(page.locator(".turn")).toHaveCount(2);
    await expect(page.locator(".refresh-status")).toContainText("新增 1 轮");
    await expect(page.getByLabel("日期范围")).toHaveValue("all");
    expect(scans).toBe(before + 1);

    await page.route("**/api/refresh", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await page.clock.runFor(15000);
    await expect(page.getByRole("alert")).toContainText("保留上次数据");
    await expect(page.locator(".turn")).toHaveCount(2);
    await page.unroute("**/api/refresh");
    await writeFile(input, original);
    await page.clock.runFor(15000);
    await expect(page.locator(".turn")).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hidden = scans;
    await page.clock.runFor(60000);
    expect(scans).toBe(hidden);
    await expect(page.locator(".refresh-status")).toContainText("暂停");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(15000);
    await expect.poll(() => scans).toBe(hidden + 1);
    await expect(
      page.getByRole("button", { name: "扫描 / 刷新", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("自动刷新").selectOption("off");
    const off = scans;
    await page.clock.runFor(60000);
    expect(scans).toBe(off);
    await page.getByLabel("自动刷新").selectOption("15");
    await page.getByLabel("数据来源").selectOption("demo");
    await page.clock.runFor(60000);
    expect(scans).toBe(off);
    await page.getByRole("button", { name: "总览", exact: true }).click();
    await expect(page.locator(".metric strong").first()).toHaveText("100 min");
  } finally {
    await writeFile(input, original);
  }
});

test("慢刷新不重叠，切换数据源取消过期结果", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByLabel("数据来源").selectOption("local");
  await page.getByRole("button", { name: "扫描 / 刷新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "扫描 / 刷新", exact: true }),
  ).toBeEnabled();
  let calls = 0,
    release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/refresh", async (route) => {
    calls++;
    await gate;
    await route
      .fulfill({ status: 200, contentType: "application/json", body: "{}" })
      .catch(() => {});
  });
  await page.getByLabel("自动刷新").selectOption("15");
  await page.clock.runFor(15000);
  await expect.poll(() => calls).toBe(1);
  await expect(
    page.getByRole("button", { name: "只读扫描中…", exact: true }),
  ).toBeDisabled();
  await page.clock.runFor(60000);
  expect(calls).toBe(1);
  await page.getByLabel("数据来源").selectOption("demo");
  release();
  await expect(page.locator(".metric strong").first()).toHaveText("100 min");
  await page.clock.runFor(60000);
  expect(calls).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const mode of ["关闭", "隐藏"])
  test(`扫描结束后${mode}会取消尚未返回的分析快照`, async ({ page }) => {
    const root = await readFile(".local/e2e-root.txt", "utf8");
    const input = join(root, "sessions", "synthetic.jsonl");
    const original = await readFile(input, "utf8");
    let release = () => {},
      captured = false;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    try {
      await page.clock.install();
      await page.goto("/");
      await page.getByLabel("数据来源").selectOption("local");
      await page.getByLabel("日期范围").selectOption("all");
      await page
        .getByRole("button", { name: "扫描 / 刷新", exact: true })
        .click();
      await expect(page.locator(".metric strong").first()).toHaveText("10 min");
      await appendFile(
        input,
        [
          {
            timestamp: "2026-10-19T01:20:00Z",
            type: "event_msg",
            payload: { type: "task_started", turn_id: "after-scan" },
          },
          {
            timestamp: "2026-10-19T01:30:00Z",
            type: "event_msg",
            payload: { type: "task_complete", turn_id: "after-scan" },
          },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n") + "\n",
      );
      await page.route("**/api/analysis?**", async (route) => {
        const snapshot = await route.fetch();
        captured = true;
        await gate;
        await route.fulfill({ response: snapshot }).catch(() => {});
      });
      await page.getByLabel("自动刷新").selectOption("15");
      await page.clock.runFor(15000);
      await expect.poll(() => captured).toBe(true);
      if (mode === "关闭")
        await page.getByLabel("自动刷新").selectOption("off");
      else
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "hidden",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      release();
      await page.unrouteAll({ behavior: "wait" });
      await expect(page.locator(".content")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(page.locator(".metric strong").first()).toHaveText("10 min");
      if (mode === "隐藏")
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => "visible",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      await page
        .getByRole("button", { name: "扫描 / 刷新", exact: true })
        .click();
      await expect(page.locator(".metric strong").first()).toHaveText("20 min");
    } finally {
      release();
      await writeFile(input, original);
    }
  });

test("Demo 初次加载时隐藏再显示仍能得到分析结果", async ({ page }) => {
  let release = () => {},
    captured = false;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/analysis?**", async (route) => {
    const snapshot = await route.fetch();
    captured = true;
    await gate;
    await route.fulfill({ response: snapshot }).catch(() => {});
  });
  try {
    await page.goto("/");
    await expect.poll(() => captured).toBe(true);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    release();
    await page.unrouteAll({ behavior: "wait" });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator(".metric strong").first()).toHaveText("100 min");
  } finally {
    release();
  }
});
