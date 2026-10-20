import { useEffect, useState } from "react";
import type { Analysis } from "../core/types";
import { Timeline, Concurrency } from "./Timeline";
import { TimelineControls } from "./TimelineControls";
import { resolveView, type ViewChoice } from "./timeline-window";

/** Preserve precise free-range analysis without putting it back on the default screen. */
export function AdvancedTimeline({
  data,
  onSession,
  scope,
  status,
  onStatus,
}: {
  data: Analysis;
  onSession: (id: string) => void;
  scope: string;
  status: string;
  onStatus: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ViewChoice>({ mode: "fit" });
  const [showWait, setShowWait] = useState(true);
  useEffect(() => setChoice({ mode: "fit" }), [scope]);
  const view = resolveView(data, choice);
  return (
    <details
      className="advanced-timeline"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>高级区间分析 · 自由缩放与并发</summary>
      {open && (
        <div className="panel">
          <div className="panel-heading">
            <h2>原始执行区间</h2>
            <select
              aria-label="包含轮次状态"
              value={status}
              onChange={(e) => onStatus(e.target.value)}
            >
              <option value="">全部状态</option>
              <option value="completed">已完成</option>
              <option value="aborted">已中止</option>
              <option value="failed">失败</option>
              <option value="unknown">未知 / 未闭合</option>
            </select>
          </div>
          <label className="check">
            <input
              type="checkbox"
              aria-label="高级显示闭合等待"
              checked={showWait}
              onChange={(e) => setShowWait(e.target.checked)}
            />
            显示闭合等待
          </label>
          <TimelineControls
            key={scope}
            data={data}
            view={view}
            choice={choice}
            onChange={setChoice}
          />
          <Timeline
            data={data}
            onSession={onSession}
            showWait={showWait}
            view={view}
            onViewChange={(window) => setChoice({ mode: "custom", window })}
          />
          <details
            className="concurrency"
            onToggle={(e) => {
              if (e.currentTarget.open)
                window.dispatchEvent(new Event("resize"));
            }}
          >
            <summary>同轴并发曲线</summary>
            <p>仅使用可定位执行区间；平均倍数按活跃覆盖计算。</p>
            <Concurrency data={data} view={view} />
          </details>
        </div>
      )}
    </details>
  );
}
