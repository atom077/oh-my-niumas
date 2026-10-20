import { useEffect, useState } from "react";
import type { Analysis } from "../core/types";
import {
  dayPreset,
  limitWindow,
  localDateTime,
  viewTime,
  type TimeWindow,
  type ViewChoice,
} from "./timeline-window";

export function TimelineControls({
  data,
  view,
  choice,
  onChange,
}: {
  data: Analysis;
  view: TimeWindow;
  choice: ViewChoice;
  onChange: (choice: ViewChoice) => void;
}) {
  const [from, setFrom] = useState(localDateTime(view.from)),
    [to, setTo] = useState(localDateTime(view.to));
  const [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!dirty) {
      setFrom(localDateTime(view.from));
      setTo(localDateTime(view.to));
    }
  }, [view.from, view.to, dirty]);
  const choose = (value: ViewChoice) => {
    setDirty(false);
    setError("");
    onChange(value);
  };
  const zoom = (factor: number) => {
    const minimum = Math.min(1000, data.window.to - data.window.from);
    const span = Math.max(minimum, (view.to - view.from) * factor),
      center = (view.to + view.from) / 2;
    choose({
      mode: "custom",
      window: limitWindow(
        { from: center - span / 2, to: center + span / 2 },
        data.window,
      ),
    });
  };
  return (
    <div className="timeline-range-controls">
      <div className="range-presets" role="group" aria-label="时间轴范围预设">
        <button
          aria-pressed={choice.mode === "fit"}
          onClick={() => choose({ mode: "fit" })}
        >
          贴合活动
        </button>
        <button
          aria-pressed={choice.mode === "full"}
          onClick={() => choose({ mode: "full" })}
        >
          完整日期范围
        </button>
        <button
          aria-pressed={choice.mode === "morning"}
          disabled={!dayPreset(data.window, "morning")}
          onClick={() => choose({ mode: "morning" })}
        >
          上午
        </button>
        <button
          aria-pressed={choice.mode === "afternoon"}
          disabled={!dayPreset(data.window, "afternoon")}
          onClick={() => choose({ mode: "afternoon" })}
        >
          下午
        </button>
        <button
          onClick={() => zoom(0.5)}
          disabled={
            view.to - view.from <=
            Math.min(1000, data.window.to - data.window.from)
          }
        >
          放大
        </button>
        <button
          onClick={() => zoom(2)}
          disabled={view.to - view.from >= data.window.to - data.window.from}
        >
          缩小
        </button>
      </div>
      <form
        className="range-custom"
        onSubmit={(e) => {
          e.preventDefault();
          const start = Date.parse(from + "+08:00"),
            end = Date.parse(to + "+08:00");
          if (
            !Number.isFinite(start) ||
            !Number.isFinite(end) ||
            end <= start
          ) {
            setError("结束时间必须晚于开始时间");
            return;
          }
          if (start < data.window.from || end > data.window.to) {
            setError("显示范围须位于顶部所选日期范围内");
            return;
          }
          choose({ mode: "custom", window: { from: start, to: end } });
        }}
      >
        <label>
          显示开始{" "}
          <input
            type="datetime-local"
            step="any"
            aria-label="显示开始"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label>
          显示结束{" "}
          <input
            type="datetime-local"
            step="any"
            aria-label="显示结束"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <button>应用范围</button>
      </form>
      {error && (
        <p role="alert" className="range-error">
          {error}
        </p>
      )}
      <div className="viewport-caption">
        <output aria-label="时间轴显示范围">
          {viewTime(view.from, view.to - view.from < 60000)} —{" "}
          {viewTime(view.to, view.to - view.from < 60000)}
        </output>
        <span>UTC+08:00 · 仅调整时间轴，指标仍按顶部日期统计</span>
        <small>拖动下方滑块平移 · Ctrl + 滚轮缩放</small>
      </div>
    </div>
  );
}
