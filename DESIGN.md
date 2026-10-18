---
name: Model Observatory
description: 以平静、可核对的模型账本呈现本机跨工具模型用量。
colors:
  ledger-ink: "#171717"
  selected-gray: "#e8e8e8"
  paper: "#ffffff"
  panel: "#f7f7f7"
  soft: "#eeeeee"
  ink: "#171717"
  muted: "#666666"
  line: "#e3e3e3"
  danger: "#171717"
  dark-ledger-ink: "#ededed"
  dark-selected-gray: "#303030"
  dark-paper: "#141414"
  dark-panel: "#1e1e1e"
  dark-soft: "#2b2b2b"
  dark-ink: "#ededed"
  dark-muted: "#a0a0a0"
  dark-line: "#303030"
  dark-danger: "#ededed"
  sidebar: "#f7f7f7"
  surface: "#fafafa"
  hover: "#f0f0f0"
  control-border: "#d4d4d4"
  dark-sidebar: "#101010"
  dark-surface: "#1a1a1a"
  dark-hover: "#242424"
  dark-control-border: "#494949"
  range-shadow: "#00000014"
  range-highlight: "#ffffff0d"
typography:
  display:
    fontFamily: "Geist, sans-serif"
    fontSize: "38px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist, sans-serif"
    fontSize: "28px"
    fontWeight: 550
    lineHeight: 1.35
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "Geist, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "11px"
    fontWeight: 400
  caption:
    fontFamily: "Geist, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  micro:
    fontFamily: "Geist, sans-serif"
    fontSize: "10px"
    fontWeight: 400
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: "11px"
  model-label:
    fontFamily: "Geist, sans-serif"
    fontSize: "13px"
    fontWeight: 550
  source-count:
    fontFamily: "Geist, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  brand:
    fontFamily: "Geist, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  brand-compact:
    fontFamily: "Geist, sans-serif"
    fontSize: "17px"
    fontWeight: 650
  introduction:
    fontFamily: "Geist, sans-serif"
    fontSize: "20px"
    fontWeight: 550
  introduction-mobile:
    fontFamily: "Geist, sans-serif"
    fontSize: "18px"
    fontWeight: 550
  route-title:
    fontFamily: "Geist, sans-serif"
    fontSize: "22px"
    fontWeight: 600
  reconciliation:
    fontFamily: "Geist, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    letterSpacing: "-0.03em"
  reconciliation-mobile:
    fontFamily: "Geist, sans-serif"
    fontSize: "23px"
    fontWeight: 550
  headline-mobile:
    fontFamily: "Geist, sans-serif"
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.035em"
  display-compact:
    fontFamily: "Geist, sans-serif"
    fontSize: "25px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  display-mobile:
    fontFamily: "Geist, sans-serif"
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.035em"
rounded:
  track: "2px"
  micro: "3px"
  tag: "4px"
  badge: "5px"
  icon: "6px"
  control: "7px"
  navigation: "8px"
  model: "9px"
  summary: "12px"
  source: "9px"
  brand: "12px"
spacing:
  micro: "4px"
  compact: "8px"
  control: "12px"
  row: "16px"
  mobile-gutter: "18px"
  section: "22px"
  split: "30px"
  desktop-gutter: "40px"
components:
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-outline-hover:
    backgroundColor: "{colors.panel}"
  button-icon:
    textColor: "{colors.muted}"
    rounded: "{rounded.icon}"
    width: "30px"
    height: "30px"
  input-search:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 11px"
  navigation-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.navigation}"
    padding: "12px"
  chip-source:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.muted}"
    rounded: "{rounded.tag}"
    padding: "2px 6px"
  range-active:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tag}"
    padding: "5px 13px"
  evidence-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    padding: "24px"
---

# Design System: Model Observatory

## Overview

**Creative North Star: "清晰的模型账本"**

界面像一份持续更新、可以逐行核对的账本。默认使用石墨深色：深黑侧栏、逐级提亮的阅读面与银白读数共同形成克制、安静、可信的气质。数字密度较高，标题、表头、细分标签和留白通过明度、字重和间距建立清晰层次。保留可记忆的浅色切换。

模型名称是阅读锚点，工具和路由作为可展开的出处。界面通过文本和状态图标同时表达证据状态，让已接入、待接入、异常和未知保持可辨认。视觉由原生 CSS、排版、表格、细线和内联 SVG 图标构成。应用品牌标识使用用户选定的生成图稿：石墨黑底、银白柱形与观测轨道；左上角、窗口、托盘及发行文件共用同一图标。

**Key Characteristics:**
- 黑白灰平面分区，文字与图标共同标示当前状态。
- Geist 排版、等宽数字和明确的表格节奏。
- 轻量边框、节制圆角、可展开的证据细节。
- 深浅主题、移动底部导航与减少动态效果支持。

## Colors

用户指定黑白配色。浅色以白底黑字呈现，深色以黑底浅字呈现，中性灰承担分区、轨道、选中背景与次级文字。状态依赖图标与明确文案区分。

### Primary
- **账本黑 / ledger-ink**：当前导航、交互重点、活动图与已核对证据。
- **选中灰 / selected-gray**：选中导航和局部切换器的轻底色。
- **夜间浅字 / dark-ledger-ink**：深色主题里的对应强调前景，维持黑白反转后的识别度。

### Neutral
- **纸白 / paper**：主阅读平面。
- **浅灰纸 / panel**：侧栏、表头、展开详情和悬停底色。
- **柔灰 / soft**：图表轨道、轻量符号与细微分组。
- **近黑墨色 / ink**：模型名、主要数字和标题。
- **中灰文字 / muted**：时间、单位、来源与说明文字。
- **纸面分隔 / line**：表格行、章节及布局分隔。
- **dark-paper、dark-panel、dark-soft、dark-ink、dark-muted、dark-line**：保留相同语义关系的深色映射；具体值以前置 tokens 为准。

### Semantic
- **状态前景 / danger**：读取异常、失败标记与重试提示沿用主要文字的黑白前景；深色主题使用 dark-danger。具体含义由“失败”“读取异常”和重试文案表达。
- 模型和工具识别方块使用统一的中性灰底与主要前景，以名称和首字母区分来源。

**The Semantic Pair Rule.** 深浅主题按角色整体切换；选中、错误和弱化文字都必须保持可读对比，状态含义通过文字与图标表达。

## Typography

**Display Font:** Geist，后备 sans-serif。
**Body Font:** Geist，后备 sans-serif；中文由系统字形补足。
**Label/Mono Font:** Geist Mono，后备 monospace，仅用于原始名称、事件标识和接入示例等代码内容。

**Character:** 几何感清晰但不张扬。以字重和间距区分标题与读数，表格与统计统一使用 tabular-nums，减少数字更新时的视觉跳动。

### Hierarchy
- **Display**：统计主读数，使用 display token；移动端读数收为 (28px)。
- **Headline**：页面标题，使用 headline token；移动端收为 (25px)。
- **Title**：账本、活动与方法说明区标题，使用 title token。
- **Body**：页面基准文字使用 body token；说明段通常为 (12px)。
- **Label**：表头、来源、时间与补充说明使用 label token；模型名为 (12px, 550)，移动端为 (11px)。
- **Brand**：桌面品牌 (17px, 600)，第二行使用 (12px) 次级文字。
- **Introduction**：接入页引言 (20px, 550)，移动端 (18px)；加载标题采用相同字号、字重 (500)。
- **Route title**：独立路由状态标题使用 route-title (22px, 600)。
- **Reconciliation**：核对统计 (30px, 500)，移动端 (23px)；来源记录数使用 source-count (15px, 500)。
- **Responsive readouts**：不超过 (900px) 的统计主读数为 (25px)，移动端使用 display-mobile (28px)；页面标题使用 headline-mobile (25px)。
- 方法说明最长 (65ch)，展开说明最长 (45ch)，防止长行削弱证据阅读。

**The Stable Digits Rule.** 可比较的数字保持等宽数字和一致对齐；单位留在次级字号，不能和读数争抢层级。

## Layout

桌面是固定左侧导航与可伸缩主阅读区。侧栏基准宽度 (224px)，主容器最大宽度 (1560px)，主区横向留白 (40px)，顶栏最小高度 (60px)。账本使用连续行、横向细线与轻微圆角外沿；统计是三列共用的一个阅读面，活动图放在账本之后。

视口不超过 (1200px) 时，侧栏收为 (190px)，主区留白收为 (28px)；不超过 (900px) 时侧栏为 (165px)，主区留白 (22px)，统计变两列，活动和工具分布上下排列，模型详情改为单列。次要表格列隐藏，核心数字仍保留。

不超过 (640px) 时，侧栏转换为高度 (60px) 的固定底部导航，页面预留 (64px) 底部空间，横向留白收为 (18px)，顶栏高度 (54px)。搜索和时间范围占满可用宽度；请求流水容器可横向滚动，模型名允许折行。超过 (1600px) 时增加顶部与章节空间，不放大表格文字。

## Elevation & Depth

分区通过背景明度、细边框和间距建立。页面主面、统计横条和账本保持平面，不叠放浮起卡片。统计与累计核对使用一个圆角 (12px) 阅读面；表格与覆盖列表外沿为 (9px)。时间范围中被选中的按钮以局部明度和轻量内沿强调当前项。

### Shadow Vocabulary
- **选中范围** (`0 1px 3px #00000014`)：仅用于当前时间范围，属于轻量状态线索。

**The Flat Ledger Rule.** 阅读区域依赖平面和细线形成层次，阴影只服务已存在的局部选择状态。

## Shapes

组件以轻微弧角和 (1px) 细边框为主。图表指标切换项使用 micro 圆角 (3px)，小标签使用 tag token；搜索和描边按钮使用 control token；导航使用 navigation token。模型识别方块使用 model token；来源状态符号使用 source 圆角 (9px)；品牌符号使用 brand token。表格本身无卡片外壳，连续的行与整齐的列构成视觉骨架。

## Components

### Buttons
明确、轻巧，和数据的存在感相匹配。
- **Shape:** 描边按钮使用 control 圆角与 (8px 12px) 内边距。
- **Primary:** 现有主要行动为描边按钮：纸面底、墨色字和细分隔色边框；不另造实心主按钮体系。
- **Hover / Focus:** 悬停换为 panel；焦点为 action 前景色 (2px) 轮廓，偏移 (4px)。常规背景过渡 (150ms)。
- **Ghost:** 图标按钮为 (30px) 方形、icon 圆角；悬停显示 soft 底与 ink 图标。禁用状态透明度 (.45)。

### Chips
- **Style:** 来源标签为 panel 底、muted 字、line 边框与 tag 圆角，内边距 (2px 6px)。
- **State:** 来源标签仅说明归属；选中态由导航或切换器表达，不能把来源标签误做筛选按钮。

### Cards / Containers
- **Corner Style:** 主要阅读区域保持平直；局部代码与错误提示使用 control 圆角。
- **Background:** 账本行和搜索使用 surface 底，统计与详情使用 panel 底；页内分隔使用 line。控件使用 control-border 提供比阅读分隔更明显的边界。
- **Shadow Strategy:** 遵循 Flat Ledger Rule。
- **Internal Padding:** 模型详情 (24px)，桌面三列内容间距 (30px)，窄屏改一列。

### Inputs / Fields
- **Style:** 搜索为细边框、control 圆角与 (7px 11px) 内边距；输入内容透明底、ink 字、muted 占位符。桌面输入宽 (185px)，移动端自适应；聚焦时容器边界提亮。
- **Focus:** 交互元素使用统一可见焦点；输入光标为 ledger-ink。
- **Error / Disabled:** 读取失败使用独立错误横条和重试，保留上次读数；按钮禁用以降低透明度表达。

### Navigation
- (13px) 图文并置；默认 muted，悬停 soft 底与 ink 字，当前页面为 panel 底与 ledger-ink 字，细边框和尾端圆点辅助标示当前位置。
- 桌面固定左侧，移动端底部横排，使用 (11px) 标签；当前页同时提供 aria-current。

### Model Ledger
- 模型名与识别方块成组，主要数值与输入/输出拆分上下排列。
- 统计横条使用“已记录 Token”和“已记录缓存读取”，覆盖比例紧邻相应数字。缺失输入或输出显示“—”；没有任何已报告用量时显示“未记录”和“用量尚未报告”。
- 模型存在部分用量时保留已记录总和，并显示“已记录 · x/y 条完整用量”；完整用量的分子只包括同时报告输入与输出的请求，不把单边记录视为完整覆盖。
- 模型行使用 surface，悬停与当前展开行使用 hover；通过模型名或末列展开按钮打开工具分布、原始名称与证据说明，展开状态提供 aria-expanded。
- 状态和计数保留文字；颜色和图标只是辅助。未知值必须有“未记录”等可读标注，缺少原始时间的请求显示“时间未记录”，不以日志读取时间替代。

### Activity & Refresh
- 活动条使用 action 前景与透明度 (.65)，当前项提高为 (1)；网格线为断续细线。
- Token 图只呈现已记录用量并明确说明缺失值不补零；移动端隐藏 SVG 轴标签，在图下使用 HTML 显示首末时间，保持小屏文字可读。
- 实时状态由圆点与文字共同表达，暂停和连接中断显示 muted；刷新中图标旋转，加载条使用低强度明暗变化。
- 遵循 prefers-reduced-motion 时关闭动画和过渡，并恢复自动滚动行为。

## Do's and Don'ts

### Do:
- **Do** 以完整具体模型名作为账本阅读锚点，用展开区域承载跨工具出处。
- **Do** 按角色同时维护深浅主题，保留文字状态、图标与可见键盘焦点。
- **Do** 用等宽数字、细线和局部背景建立高密度信息层次。
- **Do** 在窄屏保留主要读数，通过折行、展开与局部横向滚动容纳细节。
- **Do** 为减少动态效果偏好关闭非必要动画。

### Don't:
- **Don't** 用颜色替代证据状态或把未知读数画成确定的零。
- **Don't** 给模型、工具或状态添加品牌色和分类色；以名称、文字与图标区分。
- **Don't** 给连续账本和统计横条添加浮起卡片式阴影。
- **Don't** 在实现未使用图像的地方添加虚构的插画或生成图片规范。

<!-- Extracted from PRODUCT.md, src/app/observatory.css, src/app/layout.tsx,
src/app/globals.css, src/components/observatory/observatory.tsx, alias-editor.tsx and tray-controls.tsx on 2026-10-14.
The delegated visual authority selected qualitative names; token values are code-derived. -->


## Windows 桌面应用

2026-10-16 用户澄清需要保留原网页界面。Electron 窗口直接承载同一个 Observatory 前端，沿用本文件定义的布局、字体、图表、深浅主题及交互。不再使用默认 WinForms 控件重新实现产品界面。

窗口采用标准系统标题栏和边缘缩放，支持最大化、最小化与任务栏切换。Alt 菜单提供置顶、缩放、开机启动及退出。启动页使用本地资源，先显示窗口；本机服务启动失败时提供重试和日志入口。

统计由打包的数据服务统一提供，继续使用原有采集与归一逻辑。Cursor 轮次、模型配置未验证和缺失 Token 均保留可读说明。关闭窗口留在托盘，后台继续采集。界面资源、字体和脚本均为本地文件，桌面窗口只访问自有回环服务。


## 2026-10-16 栏目分工与去重

总览独占三项全局统计，随后为模型账本和活动趋势。来源分布仅在模型展开详情中呈现；最近请求不再复制到总览。请求流水以筛选、当前结果条数、记录和证据为中心，唯一请求导出入口位于该页。接入页以当前来源状态、历史累计核对、命名规则及折叠口径为中心，不提供时间切换与请求导出。异常和覆盖缺口优先排列。

顶部状态区统一承载采集状态、刷新时间和刷新控制，移除重复面包屑、宣传式副标题、侧栏说明和页脚口径。总览与流水共享时间范围，URL 保留明确范围，跨页保留暂停刷新偏好。模型名旁显示配置身份提示，详细依据仍可展开核对。

统计横条为三列；较窄桌面窗口保持导航标签完整，手机宽度下请求统计占整行、Token 和缓存并排。原有黑白主题、原生表格、可见焦点和减少动态效果继续适用。

## 2026-10-18 深色精修

默认深色覆盖首屏 HTML、启动页与窗口底色，明确选择的浅色或深色偏好在刷新后保留。侧栏使用深黑，主画布为石墨色，表格阅读面与统计面按明度区分；银白大读数配合等宽数字、灰色细线和分组留白构成层次。所有模型、工具、未知用量及覆盖状态保持原有语义。

小控件以 4–9px 圆角区分尺度，统计与日期面板使用 12px 圆角。桌面侧栏底部将本地运行和数据隐私拆成两行，避免紧凑窗口出现孤字。窄窗口沿用底部导航和局部表格滚动，不通过缩小全局字号容纳内容。
