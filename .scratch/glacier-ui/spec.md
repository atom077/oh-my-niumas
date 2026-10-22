# 冰蓝玻璃 UI

2026-10-22：用户明确选定第一轮冰川白设计图，要求采用此 UI。直接升级现有应用。

- 保留总览 / 项目 / 会话与说明与设置的导航、筛选、刷新、排序及三层时间轴行为。
- 统一为冰蓝背景、半透明玻璃侧栏和面板、蓝色指标徽标、黄色选中态；总览精简工具栏和状态行。
- 总览新增按小时工作量柱状图及来源工作量环图，依照当前 Analysis 结果计算；跨日按日历分组并限制列数。
- 区间工作量按时间桶裁切；仅有记录的 Cursor 时长按记录输入时刻归属并标记；未知不得伪装成 0，不双算已定位 Cursor 记录。来源拆分与总览主指标同口径。
- 截图设计是视觉目标，日期、项目名和数值均由当前实际数据驱动；公开验证仅用合成数据，真实截图保存在 .local/。
- 验证类型、构建、指标模型与现有端到端行为，再按目标截图做浏览器视觉比较。

## 背景素材

内置 image_gen 生成并目视核验了无文字的冰蓝背景，保存为 `app/web/assets/glacier-background.webp`。没有将含真实项目名称的截图作为应用素材。

最终提示词：

```text
Create a seamless-looking abstract background texture for a premium desktop analytics app, landscape 1600x1200. NO interface, NO text, NO symbols, NO charts, NO objects. Almost white porcelain center and right, faint translucent frosted icy-blue cloudy light at the far left edge, subtle airy blue-white light along upper and lower edges, extremely low contrast, smooth optical blur, no hard shapes, no speckles, no strong waves, no purple saturation, no dark areas. Like diffuse daylight through frosted glass. Keep central 75 percent near-white to ensure dark UI text stays readable. Pure unobtrusive background only.
```
