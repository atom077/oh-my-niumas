import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { Info } from "@phosphor-icons/react";
import type { Analysis } from "../core/types";
import { duration } from "./Timeline";
import { DAY, HOUR, hourStart } from "./activity-model";
import { workloadCharts } from "./workload-model";

echarts.use([BarChart, PieChart, GridComponent, TooltipComponent, CanvasRenderer]);
const sourceColors = { codex: "#4a95ff", cursor: "#9a73ff" };
const minutes = (ms: number) => Number((ms / 60_000).toFixed(1));

export function WorkloadCharts({
  data,
  onPeriod,
  onProvider,
}: {
  data: Analysis;
  onPeriod: (at: number, step: number) => void;
  onProvider?: (provider: "codex" | "cursor") => void;
}) {
  const model = useMemo(() => workloadCharts(data), [data]);
  const bars = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onPeriod, onProvider });
  callbacks.current = { onPeriod, onProvider };
  const note = model.reportedOnly ? "Cursor 记录" : model.inferred
    ? "含推算"
    : model.unlocated
    ? "含记录"
    : model.partial
    ? "部分已知"
    : undefined;
  const current = hourStart(Date.now());

  useEffect(() => {
    if (!bars.current || !ring.current || !model.known) return;
    const hourly = echarts.init(bars.current);
    const donut = echarts.init(ring.current);
    const fontFamily = '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    const animation = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    hourly.setOption({
      animation,
      textStyle: { fontFamily, color: "#63728a" },
      grid: { left: 50, right: 18, top: 22, bottom: 46 },
      tooltip: {
        trigger: "axis",
        renderMode: "richText",
        valueFormatter: (v: number) => `${v} min`,
        axisPointer: { type: "shadow", shadowStyle: { color: "#eef5ff" } },
      },
      xAxis: {
        type: "category",
        data: model.buckets.map((b) => b.label),
        axisLine: { lineStyle: { color: "#e2eaf5" } },
        axisTick: { show: false },
        axisLabel: {
          margin: 14,
          color: "#63728a",
          hideOverlap: true,
          formatter: (label: string, i: number) =>
            model.step === HOUR && model.buckets[i].from === current
              ? `${label}\n当前小时`
              : label,
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        axisLabel: { color: "#63728a" },
        splitNumber: 3,
        splitLine: { lineStyle: { color: "#eaf0f8" } },
      },
      series: [
        {
          name: "工作量",
          type: "bar",
          barMaxWidth: 64,
          data: model.buckets.map((b) => minutes(b.ms)),
          itemStyle: { color: "#4a95ff", borderRadius: [7, 7, 0, 0] },
          emphasis: { itemStyle: { color: "#277bf0" } },
          label: {
            show: model.buckets.length <= 12,
            position: "top",
            color: "#18243b",
            fontWeight: 600,
            fontSize: 13,
            formatter: (p: { value: number }) => (p.value > 0 ? `${p.value}` : ""),
          },
        },
      ],
    });
    donut.setOption({
      animation,
      textStyle: { fontFamily },
      tooltip: {
        trigger: "item",
        renderMode: "richText",
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}  ${minutes(p.value)} min  (${p.percent.toFixed(1)}%)`,
      },
      series: [
        {
          type: "pie",
          radius: ["65%", "91%"],
          center: ["50%", "50%"],
          startAngle: 90,
          clockwise: true,
          stillShowZeroSum: false,
          label: { show: false },
          emphasis: { scaleSize: 4 },
          itemStyle: { borderRadius: 4, borderColor: "#ffffff", borderWidth: 2 },
          data: model.sources
            .filter((s) => s.ms !== null)
            .map((s) => ({ name: s.name, value: s.ms, itemStyle: { color: sourceColors[s.provider] } })),
        },
      ],
    });
    hourly.on("click", (p) => {
      const bucket = model.buckets[p.dataIndex];
      if (bucket) callbacks.current.onPeriod(bucket.from, model.step);
    });
    donut.on("click", (p) => {
      const source = model.sources.find((s) => s.name === p.name);
      if (source) callbacks.current.onProvider?.(source.provider);
    });
    const observer = new ResizeObserver(() => {
      hourly.resize();
      donut.resize();
    });
    observer.observe(bars.current);
    observer.observe(ring.current);
    return () => {
      observer.disconnect();
      hourly.dispose();
      donut.dispose();
    };
  }, [model, current]);

  const tag = note && <span className="metric-tag">{note}</span>;
  return (
    <div className="workload-charts">
      <section className="panel workload-panel" aria-label="工作量分布统计">
        <div className="panel-heading">
          <h2>{model.step >= DAY ? "按日工作量" : "按小时工作量"}
            <span className="chart-info" title={model.reportedOnly ? "Cursor 单来源与累计 KPI 一致：记录时长按输入时刻整笔归属。点击柱子查看对应活动。" : "按上海时间裁切执行区间；未定位记录按输入时刻整笔归属。点击柱子查看对应活动。"}><Info size={15} aria-label="时长分桶口径" /></span>
            {tag}
          </h2>
          <span className="chart-unit">单位：min{model.step > DAY ? ` · 每 ${model.step / DAY} 天` : ""}</span>
        </div>
        {model.known ? <>
          <div ref={bars} className="workload-bars" role="img" aria-label="各时间段 AI 工作量柱状图" />
          <div className="sr-only">
            {model.buckets.map((b) => <button key={b.from} onClick={() => onPeriod(b.from, model.step)}>
              {b.label}：{minutes(b.ms)} min，查看活动
            </button>)}
          </div>
        </> : <div className="chart-empty">{data.sessions.length ? "N/A · 缺少可核验时长" : "暂无工作量数据"}</div>}
      </section>
      <section className="panel source-workload-panel" aria-label="来源工作量统计">
        <div className="panel-heading">
          <h2>来源工作量
            <span className="chart-info" title="与 AI 总工作量同口径，来源时长相加；未知时长不当作 0。"><Info size={15} aria-label="来源工作量口径" /></span>
            {tag}
          </h2>
          <span className="chart-unit">单位：min</span>
        </div>
        {model.known ? <div className="source-workload-content">
          <div className="workload-ring-wrap">
            <div ref={ring} className="workload-ring" aria-hidden="true" />
            <div className="ring-total"><strong>{minutes(model.total)}</strong><span>min</span></div>
          </div>
          <div className="source-workload-legend">
            {model.sources.map((s) => <button key={s.provider} type="button"
              className={`source-workload-item source-${s.provider}`}
              disabled={!onProvider} onClick={() => onProvider?.(s.provider)}>
              <span className="source-color" />
              <span><b>{s.name}</b><small>{s.ms === null ? "N/A" : `${minutes(s.ms)} min`}
                {s.ms !== null && model.total > 0 ? `（${(100 * s.ms / model.total).toFixed(1)}%）` : ""}
              </small></span>
            </button>)}
          </div>
        </div> : <div className="chart-empty">{data.sessions.length ? "N/A · 缺少可核验时长" : "暂无工作量数据"}</div>}
      </section>
    </div>
  );
}
