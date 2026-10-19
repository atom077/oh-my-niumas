import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { CustomChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { CustomSeriesOption } from "echarts/charts";
import type { Analysis } from "../core/types";
echarts.use([
  CustomChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export const time = (v: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(v);
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
  zoom = false,
  showWait = true,
}: {
  data: Analysis;
  onSession: (id: string) => void;
  compact?: boolean;
  zoom?: boolean;
  showWait?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current || !data.sessions.length) return;
    const chart = echarts.init(host.current);
    const items = data.intervals
      .filter((i) => showWait || i.kind !== "awaiting_user")
      .map((i) => ({
        value: [
          data.sessions.findIndex((s) => s.id === i.sessionId),
          i.start,
          i.end,
          i.kind === "awaiting_user" ? 1 : 0,
          i.status === "completed" ? 0 : 1,
        ],
        sessionId: i.sessionId,
      }));
    data.sessions.forEach((s, lane) => {
      for (const t of s.turns)
        if (
          t.status === "unknown" &&
          t.start !== null &&
          t.start >= data.window.from &&
          t.start < data.window.to
        )
          items.push({
            value: [lane, t.start, t.start, 2, 0],
            sessionId: s.id,
          });
      for (const i of s.inputs)
        if (i.at >= data.window.from && i.at < data.window.to)
          items.push({ value: [lane, i.at, i.at, 3, 0], sessionId: s.id });
    });
    chart.setOption({
      animation: false,
      grid: { left: 10, right: 25, top: 35, bottom: 35 },
      tooltip: {
        formatter: (p: unknown) => {
          const v = (p as { value: number[] }).value;
          return v[3] === 2
            ? `${time(v[1])} · 结束未知<br/>未计入精确执行时长`
            : v[3] === 3
              ? `${time(v[1])} · 输入观测事件`
              : `${time(v[1])} — ${time(v[2])}<br/>${v[3] === 1 ? "闭合等待" : "AI 执行"} ${duration(v[2] - v[1])}<br/>点击查看会话 · Asia/Shanghai`;
        },
      },
      xAxis: {
        type: "time",
        min: data.window.from,
        max: data.window.to,
        axisLabel: { formatter: (v: number) => time(v), color: "#8a8d95" },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "#eceef2", type: "dashed" } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: data.sessions.map((s) => s.name),
        show: false,
      },
      series: [
        {
          type: "custom",
          encode: { x: [1, 2], y: 0 },
          renderItem,
          data: items,
        },
      ],
    });
    chart.on("click", (p) => {
      const id = (p.data as { sessionId?: string })?.sessionId;
      if (id) onSession(id);
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(host.current);
    return () => {
      resize.disconnect();
      chart.dispose();
    };
  }, [data, onSession, zoom, showWait]);
  if (!data.sessions.length)
    return (
      <div className="empty">
        <span>☁</span>
        <h3>这片工地暂时很安静</h3>
        <p>换个日期或清除筛选，看看牛马们的施工记录。</p>
      </div>
    );
  return (
    <div className="timeline-frame">
      <div className="fixed-names" style={{ paddingTop: 35 }}>
        {data.sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSession(s.id)}
            title={s.name}
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
            height: data.sessions.length * 60 + 70,
            minWidth: zoom ? 1400 : 570,
          }}
        />
      </div>
    </div>
  );
}

export function Concurrency({ data }: { data: Analysis }) {
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
        min: data.window.from,
        max: data.window.to,
        axisLabel: { formatter: (v: number) => time(v) },
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
  }, [data]);
  return (
    <div
      ref={host}
      role="img"
      aria-label="AI 并发数随真实时间变化"
      style={{ height: 170 }}
    />
  );
}
