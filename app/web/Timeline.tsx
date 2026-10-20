import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { CustomChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CustomSeriesOption } from "echarts/charts";
import type { Analysis } from "../core/types";
import {
  timelineItems,
  limitWindow,
  containsActivity,
  viewTime,
  type TimeWindow,
} from "./timeline-window";
echarts.use([
  CustomChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

export const time = (v: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(v);
const axisTime = (v: number, view: TimeWindow) => {
  const day = (at: number) => Math.floor((at + 8 * 3_600_000) / 86_400_000);
  const precise = view.to - view.from < 60_000;
  return day(view.from) !== day(view.to)
    ? viewTime(v, precise)
    : precise
      ? viewTime(v, true).slice(6)
      : time(v);
};
export const duration = (v: number | null) =>
  v === null
    ? "N/A"
    : v >= 7_200_000
      ? `${(v / 3_600_000).toFixed(1)} h`
      : v >= 60_000
        ? `${Number((v / 60_000).toFixed(1))} min`
        : `${(v / 1000).toFixed(1)} s`;
export const tokens = (v: number | null) =>
  v === null ? "N/A" : new Intl.NumberFormat("en-US").format(v);

const renderItem: NonNullable<CustomSeriesOption["renderItem"]> = (
  _params,
  api,
) => {
  const start = api.coord([api.value(1), api.value(0)]),
    end = api.coord([api.value(2), api.value(0)]);
  const kind = Number(api.value(3)),
    status = Number(api.value(4));
  if (kind === 2)
    return {
      type: "group",
      children: [
        {
          type: "line",
          shape: {
            x1: start[0],
            y1: start[1] - 9,
            x2: start[0],
            y2: start[1] + 9,
          },
          style: { stroke: "#969d99", lineWidth: 2, lineDash: [2, 2] },
        },
        {
          type: "text",
          style: {
            text: "?",
            x: start[0] + 5,
            y: start[1] - 8,
            fill: "#6e7771",
            fontSize: 12,
          },
        },
      ],
    };
  if (kind === 3)
    return {
      type: "polygon",
      shape: {
        points: [
          [start[0], start[1] - 6],
          [start[0] + 5, start[1]],
          [start[0], start[1] + 6],
          [start[0] - 5, start[1]],
        ],
      },
      style: { fill: "#283e66", stroke: "#fff", lineWidth: 1 },
    };
  return {
    type: "rect",
    shape: {
      x: start[0],
      y: start[1] - 10,
      width: Math.max(end[0] - start[0], 2),
      height: 20,
      r: 4,
    },
    style: {
      fill: kind === 1 ? "#fff2cf" : status ? "#edb3a2" : "#4b83e8",
      stroke: kind === 1 ? "#c39748" : status ? "#bb7867" : "#4b83e8",
      lineWidth: kind === 1 ? 1 : 0,
      lineDash: kind === 1 ? [4, 3] : undefined,
    },
  };
};

export function Timeline({
  data,
  onSession,
  view,
  onViewChange,
  showWait = true,
}: {
  data: Analysis;
  onSession: (id: string) => void;
  view: TimeWindow;
  onViewChange: (view: TimeWindow) => void;
  showWait?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const handlers = useRef({ onSession, onViewChange, full: data.window });
  handlers.current = { onSession, onViewChange, full: data.window };
  const hasSessions = data.sessions.length > 0;
  useEffect(() => {
    if (!host.current || !hasSessions) return;
    const chart = echarts.init(host.current);
    chartRef.current = chart;
    chart.on("click", (p) => {
      const id = (p.data as { sessionId?: string })?.sessionId;
      if (id) handlers.current.onSession(id);
    });
    chart.on("datazoom", (event) => {
      const item = event as {
        start?: number;
        end?: number;
        startValue?: number;
        endValue?: number;
        batch?: {
          start?: number;
          end?: number;
          startValue?: number;
          endValue?: number;
        }[];
      };
      const zoom = item.batch?.[0] ?? item,
        full = handlers.current.full;
      const from =
        zoom.startValue ??
        full.from + (Number(zoom.start) / 100) * (full.to - full.from);
      const to =
        zoom.endValue ??
        full.from + (Number(zoom.end) / 100) * (full.to - full.from);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from)
        handlers.current.onViewChange(limitWindow({ from, to }, full));
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [hasSessions]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const items = timelineItems(data, showWait);
    chart.setOption({
      animation: false,
      grid: { left: 10, right: 25, top: 35, bottom: 75 },
      tooltip: {
        formatter: (p: unknown) => {
          const v = (p as { value: number[] }).value;
          return v[3] === 2
            ? `${time(v[1])} · 边界未知或冲突<br/>未计入精确执行时长`
            : v[3] === 3
              ? `${time(v[1])} · 输入观测事件`
              : `${time(v[1])} — ${time(v[2])}<br/>${v[3] === 1 ? "闭合等待" : "AI 执行"} ${duration(v[2] - v[1])}<br/>点击查看会话 · Asia/Shanghai`;
        },
      },
      xAxis: {
        type: "time",
        min: data.window.from,
        max: data.window.to,
        axisLabel: {
          formatter: (v: number) => axisTime(v, view),
          color: "#8a8d95",
          hideOverlap: true,
        },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "#eceef2", type: "dashed" } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: data.sessions.map((s) => s.name),
        show: false,
      },
      dataZoom: [
        {
          id: "slider",
          type: "slider",
          xAxisIndex: 0,
          startValue: view.from,
          endValue: view.to,
          filterMode: "none",
          minValueSpan: 1,
          bottom: 8,
          height: 20,
          showDataShadow: false,
          fillerColor: "#dfe9fb",
          borderColor: "#d5deef",
          handleStyle: { color: "#5682d7", borderColor: "#5682d7" },
          moveHandleStyle: { color: "#adc2e9" },
          labelFormatter: (value: number) =>
            viewTime(value, view.to - view.from < 60000),
          brushSelect: false,
          throttle: 60,
        },
        {
          id: "inside",
          type: "inside",
          xAxisIndex: 0,
          startValue: view.from,
          endValue: view.to,
          filterMode: "none",
          zoomOnMouseWheel: "ctrl",
          moveOnMouseWheel: false,
          moveOnMouseMove: false,
          preventDefaultMouseMove: false,
          throttle: 60,
        },
      ],
      series: [
        {
          type: "custom",
          clip: true,
          encode: { x: [1, 2], y: 0 },
          renderItem,
          data: items,
        },
      ],
    });
  }, [data, view.from, view.to, showWait]);
  if (!data.sessions.length)
    return (
      <div className="empty">
        <span>☁</span>
        <h3>没有符合筛选的会话</h3>
        <p>调整日期或清除筛选，查看会话活动记录。</p>
      </div>
    );
  return (
    <>
      {!containsActivity(data, view, showWait) && (
        <p className="viewport-empty">当前显示范围没有活动</p>
      )}
      <div className="timeline-frame">
        <div className="fixed-names" style={{ paddingTop: 35 }}>
          {data.sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSession(s.id)}
              title={s.note ? `${s.name} · ${s.note}` : s.name}
              style={{ height: 60 }}
            >
              <small>{s.projectName}</small>
              {s.name}
              <span>↗</span>
            </button>
          ))}
        </div>
        <div className="chart-scroll">
          <div
            ref={host}
            role="img"
            aria-label="多会话协作时间轴，执行、等待、输入和未知状态均有独立形状"
            style={{
              height: data.sessions.length * 60 + 110,
              minWidth: 570,
            }}
          />
        </div>
      </div>
    </>
  );
}

export function Concurrency({
  data,
  view,
}: {
  data: Analysis;
  view: TimeWindow;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const chart = echarts.init(host.current);
    chart.setOption({
      animation: false,
      grid: { left: 35, right: 25, top: 15, bottom: 25 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "time",
        min: view.from,
        max: view.to,
        axisLabel: {
          formatter: (v: number) => axisTime(v, view),
          hideOverlap: true,
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        splitLine: { lineStyle: { color: "#eef0e8" } },
      },
      series: [
        {
          type: "line",
          step: "end",
          symbol: "none",
          areaStyle: { color: "#e8effc" },
          lineStyle: { color: "#4b83e8", width: 2 },
          data: data.concurrency.map((p) => [p.at, p.count]),
        },
      ],
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      chart.dispose();
    };
  }, [data, view.from, view.to]);
  return (
    <div
      ref={host}
      role="img"
      aria-label="AI 并发数随真实时间变化"
      style={{ height: 170 }}
    />
  );
}
