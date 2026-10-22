
## 总览页

生成模式：内置 image_gen，沿用同套项目页合成数据。首先生成总览，再定向校正刻度、列数与合成数据页脚。最终交付为 overview.png。

### 首次生成

```text
Use case: ui-mockup.
Asset type: polished desktop app promotional screenshot for the open-source project oh-my-牛马s.
Create ONE realistic, production-quality UI mockup. Target dimensions 1488 x 1056, closely matching the attached reference's 1487 x 1058 aspect ratio. Full app viewport only, straight-on flat screenshot; no device bezel, browser chrome, perspective mockup, title poster, collage, watermark, or exterior canvas.
Input Image 1 is a VISUAL SYSTEM REFERENCE ONLY. Faithfully match its refined icy-white / pale-blue Apple iOS-inspired frosted glass material, ambient cloudy blue sidebar, near-white main canvas, restrained translucent panel edges, soft 16–20px panel radii, warm yellow selection pill and tiny yellow brand mark. Use the exact same brand wordmark "oh-my-牛马s" and subtitle "AI 会话协作看板". Preserve the sidebar width about 220px, content left padding about 32px, large airy header and the consistent top filter pill design. Typography must be crisp and readable Chinese PingFang / SF-style, 14–16px body text with strong large tabular numbers. The app's own text is editable UI, not a flattened illustration. No exaggerated bloom, no dark or purple background, no glare over text.
CRITICAL PRIVACY AND DATA REPLACEMENT: the reference is only for style. Every date, count, value, real-data label, source status and content on the new screen must be replaced with the entirely FICTIONAL dataset supplied here. Do not reuse any numeric usage totals from the reference. Do not read or imply local user logs. Never write "本机数据", "本机只读", or a refresh timestamp. Instead show a small clear amber badge "演示数据" beside the top controls and a discreet footer "示例数据 · 非真实使用记录". These two screenshots are for public project promotion. No personal names, user names, local paths, account IDs, log IDs, private project names, prompt text, API secrets or actual conversation text.
Current date anchor is 2026-10-22, Thursday, Asia/Shanghai. Show "2026年10月22日 周四" in the date pill. Time filter "今天", provider filter "全部来源", compact project filter appropriate to the page, a small search field/icon and refresh icon for styling consistency. Sidebar navigation is exactly 总览 / 项目 / 会话; lower-left 说明与设置. The selected page is specified below. No standalone 时间轴 tab. Do not invent scheduling, Agent control, billing, productivity scores, cost estimates, team-management features or subscriptions.
Shared synthetic dataset for both pages: 4 fictitious projects, 10 sessions, total AI workload 300 min, known Codex tokens 540,000. Project 前端应用: 4 sessions, 120 min AI workload, 35 min known closed waiting, 240,000 known Codex tokens; mixed Codex and Cursor (3 Codex / 1 Cursor). Project 数据服务: 3 Codex sessions, 90 min AI workload, 20 min known closed waiting, 180,000 known Codex tokens. Project 移动应用: 2 sessions (1 Codex / 1 Cursor), 60 min AI workload, 15 min known closed waiting, 120,000 known Codex tokens. Project 文档中心: 1 Cursor session, 30 min recorded/inferred workload, 10 min known closed waiting; Token unavailable, display "—", NEVER zero or a made-up token number. Workload ranking is descending 120,90,60,30; rows with Cursor may have tiny 含推算 badges. Token counts describe Codex only. Waiting is elapsed wait until the next input, never call it human labor. Treat all displayed values as synthetic examples, consistently.
Design one focused screen with one dominant content region and generous spacing. Prefer one clean table or focused turn list, not a feature inventory, not a wall of charts, no arbitrary extra cards or marketing slogans. Clear aligned labels, light hairline separators, elegant light-blue accents, semantic provider blue for Codex and violet for Cursor, subdued green completion tags. Fit all required rows and controls within the frame with comfortable margins.
Input Image 1 is the original OVERVIEW layout reference: preserve its refined visual hierarchy, four KPI strip, large project activity heatmap and two smaller supporting charts. Image 2 is the recently generated PROJECTS promotion screen: match its sidebar, fonts, framing, demo badge and frosted-blue visual system exactly so this new overview completes a three-tab public promotion set.
Screen: OVERVIEW / 首页总览, sidebar 总览 selected in the warm yellow pill, 项目 and 会话 unselected. Heading exact "AI 会话协作总览" with a tiny yellow dot. All source project names and original usage values in Image 1 MUST be replaced by the synthetic figures below. Only "演示数据" as the status at top right, NEVER 本机数据 or a local clock. Date 2026年10月22日 周四. Filter pills 今天 / 全部来源 / 全部项目 with a discreet search icon and refresh icon. Same 1488x1056 desktop screenshot presentation as Image 2, no extra promo headlines.
FOUR exact top KPIs, clear large numbers on the open page surface separated by fine vertical lines:
AI 总工作量 = 300 min, tiny 含推算 badge
AI 活跃覆盖 = 180 min, tiny 含推算 badge
平均并行倍数 = 1.7×, tiny 含推算 badge (300/180 rounded to 1 decimal)
已知 Token = 540,000, tiny 仅 Codex badge.
These are wholly fictional data; match the earlier synthetic project screen's totals (4 projects, 10 sessions, workload 300 min and known tokens 540,000).

Hero panel "项目活动分布" plus quiet context "4 个项目 · 10 个会话". Segmented view control 全天概览 selected / 小时分段 / 会话轮次. Four clear project rows:
前端应用 / 4 个会话 · Codex / Cursor / 120 min
数据服务 / 3 个会话 · Codex / 90 min
移动应用 / 2 个会话 · Codex / Cursor / 60 min
文档中心 / 1 个会话 · Cursor / 30 min.
Actual fictional viewing window is 09:00–12:00, 12 quarter-hour cells each row. Use a restrained tiny legend 输入密度（每15分钟）, with levels 0,1,2,3+. Very light empty cells, light blue to blue active cells, Cursor-only cells lavender; mixed project rows predominantly blue. These are INPUT DENSITY CELLS, NOT execution duration bars. Exact 15-min counts from 09:00,09:15,...11:45:
前端应用 [2,3,1,2,1,2,1,1,1,1,2,1]
数据服务 [1,0,1,0,2,1,2,1,1,1,1,1]
移动应用 [0,0,0,0,1,1,2,1,1,1,2,1]
文档中心 [0,0,0,0,0,0,0,0,1,1,1,1].
Keep project names, counts and duration labels aligned and clear. Do not use anonymous A/B/C/D labels, do not show fictitious private paths or chat titles.

Below hero exactly two small panels like the original overview, not an extra dashboard row:
Left wide panel "按小时工作量" with tiny 含推算 and unit min, three rounded blue columns:
09:00 75; 10:00 105; 11:00 120. Bars proportional to values and y-axis 0,40,80,120,160 (or a comparably correct simple scale). Values printed clearly atop each bar. These sum to 300 min. This is a fictional morning example, do NOT label any past hour 当前小时 and do NOT include other hours with invented data.
Right panel "来源工作量" with tiny 含推算, blue/violet donut with Codex 70% versus Cursor 30% (NOT equal halves). Center shows 300 and min. Exact legend: Codex 210 min（70.0%）; Cursor 90 min（30.0%）. This split also sums to the same 300 min.
Bottom quiet collapsed control 高级区间分析 · 自由缩放与并发, then the small footer "示例数据 · 非真实使用记录" consistent with Image 2. Do not add the project comparison table to overview, do not add a feed or a fifth KPI. Keep one main hero, graceful spacing, same high-end translucent Glacier Glass design, very readable Chinese labels and tabular numeric typography. ONE finished app screen only.
```

### 定向校正

```text
Use case: precise-object-edit.
Edit the attached synthetic-data promotional OVERVIEW screen. Change ONLY the timeline grid's column count and its time-axis labels, and add a small synthetic-data footer. Keep all other pixels/layout/material/colors/text/numbers as close to the source as possible. Do NOT redesign, do NOT change any KPI, project name, project workload, chart value, donut split, sidebar, filter, date, panel position, or typography. In particular preserve 300 min / 180 min / 1.7× / 540,000; project 120/90/60/30 min; bars75/105/120; Codex210min70% and Cursor90min30%; retain the 演示数据 status.
Precise correction 1: the time axis currently duplicates 11:30 and the heatmap has an extra column. Rebuild ONLY the heatmap column grid inside the SAME plot rectangle as EXACTLY TWELVE equal-width quarter-hour columns, with thirteen boundary ticks: 09:00, 09:15, 09:30, 09:45, 10:00, 10:15, 10:30, 10:45, 11:00, 11:15, 11:30, 11:45, 12:00. Each label appears ONCE. Show all ticks in small crisp gray type, or only major half-hour tick labels if needed to avoid crowding, but the last must be 12:00 and there must NEVER be a duplicated label. Each project row has TWELVE cells, not thirteen.
Exact input count levels for the 12 cells left-to-right:
前端应用 [2,3,1,2,1,2,1,1,1,1,2,1]
数据服务 [1,0,1,0,2,1,2,1,1,1,1,1]
移动应用 [0,0,0,0,1,1,2,1,1,1,2,1]
文档中心 [0,0,0,0,0,0,0,0,1,1,1,1].
Empty cells are near-white, 1 pale blue, 2 medium blue, 3 stronger blue; the last project's four nonempty cells are lavender. Keep all four project labels, session counts and workload totals untouched.
Precise correction 2: at the very bottom of the frame, right-aligned alongside the collapsed advanced-analysis row, add the exact small gray footer "示例数据 · 非真实使用记录". It must be fully visible inside the screenshot and not cover any existing label.
No other edits, no extra panels or figures, one screenshot, same dimensions.
```
