# Model Observatory

本机模型用量账本。**具体模型是主轴，工具和路由是维度。** 同一模型在 Codex、pi、ZCode、DeepSeek Harness 等工具中的调用汇总到同一行；不同模型版本不会因为属于同一家族而合并。

## Windows 桌面应用

日常只需安装并打开 EXE，桌面应用是唯一用户使用入口。无需另外运行网页版、启动浏览器或执行 npm 命令。

源码中的 React 界面和轻量 Node 数据服务随 EXE 打包；Next 只在构建时导出静态界面，运行时不加载 Next 服务器或 node_modules。Electron 自带的 Chromium 负责在应用窗口内绘制界面，并不依赖系统安装的 Chrome / Edge。

以下命令仅供从源码构建和维护：

```powershell
npm run desktop:build
# Install or upgrade from this checkout:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-desktop.ps1 -NoBuild -Start
```

发行文件位于 `dist/desktop/`：`Model-Observatory-0.2.8-Setup.exe` 为安装包，`Model-Observatory-0.2.8-Portable.exe` 为免安装版。支持 Windows 10 / 11 x64。其他电脑只需要安装包或免安装 EXE，不需要源码、系统 Node.js、npm、Edge / WebView2 安装步骤或单独启动网页服务器。安装版创建桌面及开始菜单快捷方式。

桌面采用 **Electron**，直接保留原有 React 界面与交互。应用自带 Chromium、Node 和轻量本机数据服务；窗口只加载本机打包资源，字体、脚本及样式不访问外部网络。不会打开或控制外部 Chrome / Edge，也不会在运行时执行 npm install、构建或搜索源码目录。首次打开会先显示本地启动页，本机服务失败时提供重试及诊断日志入口。

界面使用软件绘制，减少 Windows 图形驱动的常驻分配；适合当前表格和 SVG 图表。仍支持深浅主题、系统标题栏和窗口缩放。这个单窗口应用不启用备用渲染进程、后退缓存、独立音频进程，以及翻译、媒体路由和优化提示这些用不到的 Chromium 服务。

应用图标采用石墨黑底、银白柱形与观测轨道，窗口、托盘、EXE、安装包和界面 favicon 共用同一套图稿。原图及生成提示词位于 `desktop/artwork/`，运行 `python scripts/generate-app-icon.py` 可重新导出 16 至 256 像素的 9 种 ICO 尺寸。

手动启动显示标准桌面窗口，支持任务栏 / Alt+Tab、边缘缩放、最大化、最小化及位置尺寸保存。关闭窗口收起到托盘并继续采集；应用菜单和托盘菜单均提供“退出”（`Ctrl+Q`）及“重新启动”（`Ctrl+Shift+R`）。退出会等待已接收的事件写入和正在执行的补采，再关闭自有数据服务；超过 12 秒仍未完成时结束服务，下次启动从保留的源日志重扫，SQLite 已提交历史不受影响。重新启动先清理旧服务，再打开新窗口；退出后也可随时双击 EXE 重新打开。命令行支持 `ModelObservatory.exe --quit` 和 `ModelObservatory.exe --restart`。

`Alt+A` 唤出窗口，`Ctrl+R` 重新加载，`Ctrl++` / `Ctrl+-` 调整显示比例；按 `Alt` 显示菜单，可设置置顶及开机启动。开机启动进入托盘，不弹出窗口；重复收到自启命令也不会打断当前窗口状态。自启菜单读取 Windows 的实际启用状态，在系统设置中禁用后可从菜单重新开启。手动退出不取消开机启动。免安装单文件版本不提供开机启动，因为它每次会展开到临时目录。

原模型总览、活动图、请求流水、来源覆盖、命名规则、深浅主题和 CSV 导出均共用原前端。Cursor 继续标明会话请求轮次，未知 Token 不补零。下载会调用系统文件保存对话框。

主进程每 15 秒驱动后台采集；关闭窗口留在托盘后仍继续。暂停状态与历史账本持久保存，退出后重新打开会补读仍存在的原始日志。端口自动选择，常用端口占用不会导致应用打不开。

Windows 安装包尚未使用商业代码签名证书，系统可能提示未知发布者。安装包包含运行依赖，不包含本机历史、配置密钥或环境文件。安装到另一台电脑后，会读取那台电脑自身保留的工具记录；不会自动复制当前电脑的历史。

再次启动会立即扫描仍然存在的原始日志，即使上次刚退出也不会因为最近采集过而跳过首次补读；补读退出期间的请求，并按稳定 ID 去重。**已采集的原始观测保存在 `~/.model-observatory/history.sqlite`**，源文件清理或暂时无法读取不会删除已入账历史；更新同一请求的用量会修订原记录。SQLite 事务和 WAL 保护写入，命名规则与跨来源匹配仍在查询时统一应用。暂停状态重启后保留，需要主动恢复。

补读的前提是工具在托盘退出期间仍然记录并保留日志。关闭托盘期间，统一事件 HTTP 接口若无独立服务会不可达，调用方需保存并重试；未落日志的封闭客户端调用无法事后还原。不要将这个能力理解为全机流量拦截。

窗口设置位于 `%APPDATA%/Model Observatory/window.json`，日志位于同目录的 `logs/desktop.log`。可在 Windows 设置中卸载安装版，统计历史目录不会随卸载删除。`install-desktop.ps1` 安装或升级当前版本，0.2.1 起支持用 `ModelObservatory.exe --quit` 正常退出后升级。旧 C# / WinForms / WebView2 实现、配套构建与测试、旧截图和参考目录均已移除，只维护当前桌面发行链路。

## 页面

调用活动使用固定高度的细柱图，标题与请求 / Token 切换紧凑排列，不常驻说明文字。悬停、点击或键盘聚焦时段时，在图中显示紧凑浮层，只保留时间、具体模型、请求数和已记录 Token；同一天的结束时间省略重复日期，单模型不再重复总量，多模型才显示合计。明细随当前图表指标排序，模型较多时可在浮层内滚动；左右方向键切换时段，Esc 或点击外部关闭。缺失 Token 显示“—”，列名明确为已记录用量，辅助读屏提供完整用量请求数；输入 / 输出拆分及部分用量覆盖仍在模型账本查看，缓存不重复计入 Token。轴文字保持固定字号，深浅主题与窄窗口共享同一套图表层次，浮层自动避让窗口边缘，窄屏优先放在图上方以免挡住时段操作。

- `/`：模型总览，独占全局请求、Token 和缓存统计；具体模型账本位于活动趋势之前。展开模型可核对工具分布、原始名称和模型身份依据，并钻取请求。配置名称明确标记，不代表响应已验证。最近调用以北京时间分两行显示完整日期与秒级时间，缺失或非法时间显示“—”。
- `/projects`：项目账本，按当前时间范围内的请求数或已记录 Token 排序。项目以可靠来源、规范化路径或来源稳定 `project_id` 区分，同名不同路径不会合并；列表显示涉及模型数与最近活动，详情列出当前项目下的最终模型和关联会话，并提供未知项目入口。
- `/sessions`：会话账本，显示可靠会话 ID、来源 / 工具、项目归属、请求数、已记录 Token、涉及模型数和范围内最近活动。详情补充范围内首末活动、完整用量覆盖、归属依据及最终模型，并提供未知会话入口。
- `/requests`：逐请求流水，提供时间 / 模型 / 工具 / 项目 / 会话 / 未知归属 / 关键词筛选、结果条数、50 条分页、原始证据和 CSV 导出。不重复总览统计；“导出筛选结果”导出全部匹配记录，不局限于当前页。
- `/tools`：当前来源状态与历史累计观测、合并和待核对证据，包含模型命名规则及可展开的统计口径。异常、待接入、暂无记录来源排在正常来源之前。此页不显示时间筛选和请求导出，所有来源数量与核对数量明确为历史累计。
- `/models`：重定向到模型总览。

项目与会话页面只汇总当前时间范围内的请求；会话跨出范围时，详情也不会补入范围外请求。项目、会话与模型筛选可以组合，并从账本或详情进入请求流水。项目 / 会话 URL 保留 `range` / `from` / `to`、`sort`、`project`、`session`，进入流水时继续携带 `range` 和适用的 `project` / `session` / `model` / `unknown` 筛选。所选 opaque key 由接口原样传递，界面不拼接或解析；刷新、前进后退和跨页返回沿用这些参数。未知项目与未知会话分别提供入口。

时间筛选提供「今天 / 这周 / 这月 / 全部 / 任意时间」。默认按北京时间的今天统计；这周从周一零点、这月从每月 1 日零点开始。任意时间以按钮旁的悬浮面板显示，不占用页面布局；使用黑白月历连续点选开始与结束日期并高亮区间，也可直接输入 YYYY-MM-DD 或切换年月。点击“应用”后生效，按北京时间包含起止当天；点外部、取消或按 Esc 保留原范围，开始日期晚于结束日期时提示并禁用应用。日历支持方向键、Home / End 及 PageUp / PageDown。五种范围在总览、请求流水、项目与会话账本间共享当前桌面窗口的选择，经过接入页后返回仍保留；模型钻取与 CSV 导出携带相同的时间条件，URL 中的明确范围（`range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`）优先于窗口记忆。切换时间会同步更新 URL 并重置分页，界面显示实际范围；全部历史包含原始时间缺失的记录，其他范围排除缺少时间的请求和未来记录。总览不再重复显示最近请求列表、全局工具分布图或来源接入数量，来源信息在模型详情与接入页按各自任务呈现。

每次界面请求完成 5 秒后再次刷新，避免请求重叠；窗口隐藏或最小化时停止界面轮询，显示后恢复。主进程继续每 15 秒采集；界面轮询和切换筛选只查询账本，不再额外扫描原始日志。首次读取仍立即补采，已有历史先显示，没有历史时等待首次采集。显式采集与恢复采集仍可立即补读。顶部唯一状态区集中显示后台采集、补读、刷新时间、暂停刷新及手动刷新；自动刷新偏好在栏目间保留，暂停刷新仍允许手动刷新或切换筛选。刷新失败会保留上次读数并明确提示。更新时间使用实际入库时间。

## 运行与构建边界

`src/server/http.ts` 只使用 Node 内置模块提供静态文件与原有数据接口，文件按流读取，请求体在接收时按接口限额限制。`scripts/prepare-desktop.mjs` 将数据服务打包成一个约 60 KiB 的 CommonJS 文件，并复制静态 UI。Next、React 构建工具和 esbuild 都属于开发依赖，不作为服务依赖带入安装包。Electron 内的 React 客户端仍保留原有交互。

Windows 静态导出的分段预取文件会在构建时统一为客户端要求的名称；自动验收会检查导航和资源没有 404。`/models` 由轻量服务重定向到首页，无需额外页面实现。

桌面导航白名单包含项目和会话页面，支持栏目切换、完整页面跳转和刷新；外部地址和 API 地址仍不能作为界面导航目标。

## 活跃数据链路

```text
原始本地记录 / 统一事件
  -> readers.ts：来源适配、归属投影和 Token 定义
  -> jsonl.ts：只提交完整 JSON 行，增量读取
  -> archive.ts：事务保存原始观测和暂停状态，保留历史
  -> ledger.ts：请求归一、一对一匹配、具体模型汇总
  -> src/server/：本机 HTTP、范围、流水筛选、分页、CSV
  -> Electron 桌面窗口中的 React 界面
```

`src/lib/observatory/` 是唯一统计核心。SQLite 读取缓存在本进程复用，并通过 `data_version` 感知其他进程写入；未变化的观测跳过重复 SQL。原始记录在增量读取、归档和查询间共享不可变对象，修订使用新对象；不再长期保留每条记录的 JSON 字符串副本。本进程入库后直接更新内存账本，不重新读取解析整库；启动或其他连接写入后再通过 SQLite 迭代器加载。归一、去重及排序结果在记录或命名规则变化时更新，时间范围仍按当前时间筛选。查询结果会一直复用，直到账本、覆盖、命名规则或时间窗口里的记录集合发生变化，而不是每秒重建一次。界面按当前视图取数：总览只要最近 5 条，流水按 50 条分页，接入页不重复拉取流水；导出仍包含全部筛选结果。JSONL 在成功入库后释放已解析行，保留文件游标和解析状态，之后只读新增字节；文件被替换或变短后从头读取。DSH 按帧或行增量读取，工具输出等无关长行在确认类型后即丢弃，不再把整个会话文件放进内存。SQLite 使用有限页缓存且不把账本文件映射进进程。DSH 解码位于 `sources/dsh.ts`，文件遍历位于 `files.ts`，Grok 直接使用同一套增量 JSONL 读取。旧 `metrics/`、`collectors/`、CC Switch 导入、账户额度、旧仪表盘及未使用的组件库已经移除。

查询和导出统一使用 `/api/observatory`，数据接入和命名规则分别使用其 `/events`、`/aliases` 子路径；`/api/health` 供桌面进程探测。已删除旧 `/api/metrics`、`/api/sources`、`/api/command-code`，旧地址现在返回 404。

### 归属接口

`GET /api/observatory` 的归属结果分两层。`snapshot.attribution` 包含当前范围的项目 / 会话概览、分别的 `unknownProjects` / `unknownSessions` 和 `coverage`；`coverage` 中的已知 / 未知请求数与完整用量请求数描述整个时间范围，不随归属筛选重算。`snapshot.selection` 只在带归属筛选或详情视图时出现，包含 `filters` 以及筛选后的 `totals`、`models`、`projects`、`sessions`、`unknownProjects` 和 `unknownSessions`。顶层 `snapshot.totals` 与 `snapshot.models` 仍保持整个时间范围，不因归属筛选变为子集；筛选后的流水条数见 `requestCount`。

`view` 支持 `summary|projects|sessions|project|session|unknown|full`。没有归属筛选且未指定 `view` 时默认 `summary`，该视图不携带完整的 `projects` / `sessions` 明细；`projects`、`sessions` 返回对应账本，`project`、`session`、`unknown` 返回筛选详情，`full` 返回完整归属概览。`project=<opaque key>|unknown` 与 `session=<opaque key>|unknown` 分别选择已知键或未知维度，`unknown=project|session|both` 选择未知条件，同时出现时按 AND 组合。只带归属筛选时可省略 `view`，接口按 `project`、`session`、`unknown` 的顺序推断详情视图。

DSH 已入库的解码记录也会释放，保留独立序号、文件游标及未完成帧的读取位置。JSONL 的备用请求 ID 使用跨采集保留的序号，释放记录不会覆盖旧请求；压缩帧的校验尾部未写完时等待下次采集。未变化的 SQLite 元数据重读不会重建账本；后台提交使旧账本失效时立即释放查询缓存，窗口隐藏期间也不长期保留旧修订。ZCode / OpenCode 按 SQLite 迭代器转换记录，入库后只保留数据库与 WAL 签名，未变化时跳过全量记录重放。CSV 按 128 条分批输出并响应下载取消，避免同时构造整份导出内容的多个副本。大文件采集不再将整个事件数组展开为函数参数，避免记录量超过 JavaScript 参数上限时丢失整个来源。

历史从 SQLite 解码时，在发布不可变观测前共享重复的模型、工具、路由和证据来源字符串；共享池最多保留 2048 个名称，避免来源名称增长使池无限扩张。去重按原始模型名复用本次归一结果，命名规则变化后重新生成。不会修改已发布观测，也不保留逐行 JSON 副本。

0.2.8 的宿主健康检查、后台采集和数据服务直接使用 Node 内置 HTTP；不再为本机请求加载 Fetch 客户端或在 Node / Web Streams 之间转换。CSV 保留分批输出、背压和下载取消，写入限额、同源校验与桌面会话校验保持不变。历史核对使用数字索引，只为待匹配路由涉及的模型 / 输出用量建索引，时间戳只解析一次；没有路由证据时跳过匹配索引。来源统计避免为每条历史记录创建临时数组和集合。

归档提交不再在内存中复制一整份按请求 ID 索引的归属 Map，也不再预载全部历史归属。冷启动或空增量后需要修订存量请求时，只按该请求 ID 读取原记录；缺失归属的合并、较低用量修订产生的归属冲突、较高用量保留、已发布不可变对象、`data_version` 外部写入失效和查询缓存行为保持不变。这条路径避免历史规模增加时重复常驻一份归属证据。

Codex 增量读取最多检查行首 512 字节，在明确识别为响应正文、工具输出或非用量事件时直接跳过后续字节；未完成的大段工具输出也不再常驻缓冲区。`session_meta`、`turn_context`、`token_count` 和无法识别字段顺序的记录保留完整解析，不截断有效用量。文件截短、替换、跨采集周期续写及稳定请求序号仍按原规则处理。采集间隔、软件绘制和 React 界面不变，不使用强制 GC、堆上限或工作集清理来降低测量值。

应用界面默认采用石墨深色主题：深黑侧栏、分层灰色阅读面、银白读数与细分隔线。统计横条、模型账本、请求证据及日期面板使用统一的排版和控件层次。启动页及窗口底色同样采用深色，避免启动闪白；侧栏仍可切换浅色，明确选择的主题会保留。模型与工具以名称区分，采集状态同时使用图标和文字；选中、悬停、焦点与错误提示均保留可读标记。样式使用原生 CSS，不依赖 Tailwind、shadcn 或图表组件库。

## 原始采集来源

| 来源 | 本地证据 | 结构化归属字段 | 主要边界 |
| --- | --- | --- | --- |
| Cursor | `%APPDATA%/Cursor/User/globalStorage/state.vscdb` 的请求元数据 | 会话：`composerData:<composer>` / `bubbleId:<composer>:*` 中的 composer；项目、父会话：未知 | 按 requestId 合并分叉副本；只计有响应的会话请求轮次，不能代表内部逐步模型调用。模型取自当轮配置，Token 保持未知；不读取对话和认证字段 |
| Codex CLI / Desktop | `~/.codex/sessions` 和 `archived_sessions` 的 token_count | 会话：`session_meta.payload.id`；项目：`session_meta.payload.cwd` 或 `turn_context.payload.cwd`；父会话：`session_meta.payload.source.subagent.spawn.parent_thread_id` | 跳过重复累计快照；模型取自当次 turn_context，未确认响应模型时标记 configured。事件工具仍区分 CLI / Desktop，归属命名空间统一为 Codex |
| Codex Router | `~/.codex/codex-router/usage-events.jsonl` | 项目、会话、父会话：`source-unsupported` | 优先 responseModel，否则使用日志 model；无法与客户端记录核对时统一显示“客户端未记录”，不从路由名称猜测客户端 |
| DeepSeek Harness | `~/.dsh/sessions` 的原始压缩 usage | 会话：session header `id`；项目：session header `cwd`；父会话：未投影 | 复用文件格式解码，不采用 CC Switch 导入。文件路径 fallback 只稳定原请求 ID，不作为可靠 session |
| pi | `~/.pi/agent/sessions` | 会话：session header `id`；项目：session header `cwd`；父会话：未知 | 按原始 message id 计数，输入包含 cacheRead/cacheWrite。`parentSession` 通常保存父日志路径，不把路径伪造为父 session ID |
| ZCode | `~/.zcode/cli/db/db.sqlite` 的 model_usage | `PRAGMA table_info` 后读取 `model_usage.session_id`、`session.directory`、`session.project_id`、`session.parent_id` | 每个实际 attempt 分别计数；读取 completed/error/cancelled；input_tokens 已含缓存 |
| OpenCode | `~/.local/share/opencode/opencode.db` 的 assistant usage | `PRAGMA table_info` 后读取 `message.session_id`、`session.directory`、`session.project_id`、`session.parent_id` | 输入加缓存，输出加独立 reasoning；只提取用量和上述归属元数据 |
| Claude Code | `~/.claude/projects` 的 assistant message | 会话：assistant row `sessionId`；项目：assistant row `cwd`；父会话：未知 | 相同 message id 的流式更新只计一次；输入加缓存读写 |
| Command Code CLI | `~/.commandcode/projects` 的原始 message usage | 项目、会话、父会话：`source-unsupported` | 读取逐请求，不把账户额度当调用次数 |
| Grok CLI | `~/.grok/sessions` 的本地记录 | 项目、会话、父会话：`source-unsupported` | 缺少可靠调用时间与 Token，仅在全部历史计数；用量保持未知 |
| ChatGPT 桌面端 / 网页 | 尚无逐请求 usage 接口 | 项目、会话：`source-unsupported` | 未覆盖说明放在“数字怎样算 → 已知边界”，不显示空占位卡片；普通聊天不会自动写入 Codex/API 日志 |

SQLite 的主文件和 WAL 均参与缓存失效。JSONL 只解析已完成的行，半行等待下次刷新；文件截短后重新读取。来源读取失败只影响该来源，下次采集重试。

客户端未记录的历史路由请求继续计入对应模型；模型展开详情解释证据缺口，流水筛选与 CSV 使用相同名称，不改写原始归档。采集覆盖只在统一事件接口已有记录或读取异常时显示该来源；空接口的接入方法保留在“数字怎样算 → 统一接入”。API 的覆盖信息仍保留未接入状态。

本系统是**原始记录聚合器**，不是全机网络拦截器。无法读取的工具、封闭客户端加密流量、未落日志的失败与内部调用不应被声称为已覆盖。上游隐藏模型或使用不透明别名时，不可能仅凭本地配置确认真正执行的权重。页面保留证据与未验证状态。

归档内存中内容完全相同的项目、会话与父会话归属共享不可变对象，共享池最多保留 4096 种完整值；比较包括来源、状态和全部冲突候选，不能仅按归属键合并。新入库记录与从磁盘加载的记录共用同一套模型、工具及路由元数据。完整账本加载后复用现有请求 ID 索引；冷启动补读直接比较未变化的元数据，避免为每条历史记录分配两份完整 JSON 字符串，归属未变时复用原包装对象。读取器已有显式归属时不再先创建会被覆盖的缺省归属。原始归档、统计口径及已发布记录保持不变。

源读取期间也复用完全相同原始元数据对应的不可变归属，最多缓存 1024 种、编码键不超过 2 MiB，成功入库后释放。无效类型绕过缓存，不把未提供的标识与 `null` 混为一谈。

### 归属、隐私与未知

采集器只投影上表列出的归属字段。JSONL 不提取提示词、响应正文、工具参数或认证数据；SQLite 先通过 `PRAGMA table_info` 确认列，再只选择 ID、会话关联、工作目录、项目 ID、父会话 ID 和既有用量元数据。Cursor 的对话正文、认证表和未列入白名单的键、OpenCode / ZCode 的消息正文、标题、摘要及费用列均不读取。项目可由可靠 `cwd` 形成路径键，也可由来源提供的稳定 `project_id` 独立形成项目键；同名但路径不同的项目不合并。会话键绑定来源、工具与稳定会话 ID，不同来源的相同会话 ID 不合并。

项目、会话和父会话分别报告 `known / missing / unsupported / invalid / conflict`；未知项目与未知会话也分别计数。字段存在但当前记录未提供值时为 `missing / not-provided`；安装版本或旧 schema 明确没有对应列、或来源没有这类字段时为 `unsupported / source-unsupported`；字段类型错误为 `invalid`；同一请求得到不同可靠值时为 `conflict`，并保留全部 candidates。缺失父会话不会抹掉已知会话，已知项目和未知会话也不会互相覆盖。旧历史若没有 attribution，会显示为 legacy 未知，不能仅凭同一请求推测其项目或会话。

本功能不计算费用。OpenCode / ZCode 数据库中的 cost 或账户额度不作为费用结论，也不参与请求计数；缺失 Token 继续显示未记录。

正常启动仍会按稳定请求 ID 扫描仍存在的源日志并补读退出期间的请求，已入库事件会获得新读取器能投影的归属元数据。源日志已删除、轮转后不可得，或原始记录从未保存 cwd / 会话字段时，旧历史无法事后还原，只能保留为未知。SQLite 的 session 关联只有在 ID 唯一时才投影；异常 schema 出现重复 session ID 时，请求行仍只计一次，项目与父会话标记为 `invalid / invalid-id`，不能任意选择映射，也不能放大用量行数。

## 计数和模型身份

1. 先移除明确识别的路由 / 供应商命名空间。保留版本号、日期、fast、vision 等具体变体，不把全部 DeepSeek 或 GPT 调用折叠成一个家族。
2. 同一来源的稳定请求 ID 重传或流式修订只记一次。同一来源的两次独立请求，即使时间与 Token 相同，也分别计数。
3. 路由与会话的模型、输入、输出和时间同时匹配、且候选唯一时，一对一合并证据。存在多个候选的路由证据暂不加总，在接入页单列。未匹配的路由记录保留，工具身份保持未知。DSH 使用会话内序号而非整个扫描结果的位置生成稳定 ID，避免新会话改变旧请求身份；同一会话的日志副本不会再次计数。无法证明的跨来源重叠仍可能存在，不能保证所有历史记录都能自动去重。
4. Token 输入含缓存，缓存只是输入的子集；已记录 Token = 已记录输入 + 已记录输出。缺失 Token 保持 null；无用量的模型显示“未记录”，部分覆盖显示完整用量的请求比例，不当作已知的 0。
5. 已采集的观测持久保存到本地 SQLite。原始日志删除不影响已保存历史；尚未采集且已删除的日志无法补回。统一事件文件也单独保存。

对于已核实的别名，在接入页添加规则。规则存储在 `~/.model-observatory/aliases.json`，原始名称始终保留，删除规则即可恢复。不要把无法确认的两个版本手动合并。

## 为任意工具接入统一事件

向 `POST /api/observatory/events` 发送 `Content-Type: application/json`：

```json
{
  "id": "stable-upstream-request-id",
  "at": "2026-10-14T06:00:00.000Z",
  "model": "upstream-reported-model",
  "client": "My Harness",
  "upstream": "My Route",
  "input": 1000,
  "output": 120,
  "cache": 600,
  "status": "ok"
}
```

`id` 在同一采集器 / client 内必须稳定且唯一。重传不会增加计数。`input` 已包含 `cache`，未知用量可以省略。不要发送密钥或对话正文。只需模型、时间、工具和用量。此接口不主动配置任何应用的代理，也不自动拦截流量。

事件保存在 `~/.model-observatory/events.jsonl`。测试可用 `OBSERVATORY_DATA_DIR` 指向隔离临时目录。

## 验证

已移除独立网页启动入口。界面开发先运行 `npm run desktop:prepare`，再运行 `npm run desktop:dev`，直接在桌面窗口中预览。界面和静态资源只接受当前桌面进程的会话标识；普通浏览器访问本机界面地址返回 403。数据 API 保留给采集、导出和诊断使用。

```powershell
npm test
npm run lint
npm run desktop:build
npm run test:ui
npm run test:desktop
```

归属改动的补充验收可单独运行：

```powershell
node --test tests/attribution-readers.unit.cjs
node tests/attribution-ui.e2e.mjs
```

后者使用 `npm run desktop:build` 生成的打包 EXE 和隔离 fixture，普通浏览器不替代桌面验收。`attribution-readers` 检查来源投影、冲突与旧 schema 边界；`attribution-ui` 检查归属 API、项目 / 会话账本、组合筛选、跨范围详情、未知入口及 390px / 320px 布局。

单元测试同时验证轻量服务的桌面会话、静态资源、请求体限额、同源修改、分页、完整 CSV 和命名规则；并覆盖具体模型合计、版本与命名空间、别名、重复重传、一对一证据匹配、歧义隔离、缓存口径、时区、未知值、增量 JSONL 与截断恢复，以及独立进程退出、离线补读、暂停保留与源文件删除后的历史保留。界面验收直接启动打包 EXE，使用真实本地账本的隔离副本；写命名规则的 UI 测试拦截为测试响应，不改变真实规则和统计。桌面验收复制真实打包程序到带中文和空格的临时目录，在隔离用户目录且 PATH 不包含 Node 的环境中启动；验证原界面、本地字体、外部请求阻断、CSV、窗口缩放 / 最小化 / 最大化、关闭到托盘后继续采集、单实例唤回、服务和界面进程意外退出重试、无重复采集进程、隐藏时停止界面轮询、损坏设置容错、命令正常退出、端口冲突和历史持久保存。测试不修改真实历史和命名规则。

性能复测可运行 `node tests/desktop.performance.mjs <label> <exe> <fixture>`，fixture 目录包含脱离真实用户目录的 `history.sqlite`、`events.jsonl` 和可选 `aliases.json`。报告在 `logs/performance/`，方法和限制见 `docs/desktop-evidence.md`；测试仅操作隔离副本。

运行内存测量方法见 [`docs/runtime-memory-method.md`](docs/runtime-memory-method.md)，本次 12 轮 short、formal-soak 中断边界与 20 轮独立诊断结果见 [`docs/runtime-memory-2026-10-19.md`](docs/runtime-memory-2026-10-19.md)。

界面自动验收截图及报告位于 `logs/desktop-ui-acceptance/`；打包桌面验收截图与报告位于 `logs/desktop-acceptance/`。

## 参考

借鉴 [Langfuse Metrics API](https://langfuse.com/docs/metrics/features/metrics-api) 的模型维度聚合、时间趋势与可追溯指标；参考 [LiteLLM Spend Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) 将使用记录和调用来源作为维度。本项目的产品主轴是本机跨工具的具体模型汇总，未接入这两个云服务。

### Cursor 本地采集

Cursor 保留的每个会话请求 ID 计一条，思考、工具步骤及分叉副本不会重复计数。composer 作为会话归属；同一 requestId 若出现在多个 composer，请求仍只计一条，但会话归属标记为冲突并保留候选 composer。总览、流水证据和 CSV 明确标注会话轮次；它与其他来源的逐模型调用证据粒度不同，合计不是完整底层调用数。不会拿当前会话的最新模型倒填旧请求，也不会把默认 `tokenCount: {inputTokens: 0, outputTokens: 0}` 当成真实零用量。

采集器只通过 SQLite JSON 投影读取请求 ID、composer 会话键、顺序、时间、模型配置与消息类型，不提取提示词、响应正文、代码或认证字段。数据库和 WAL 的变化都会触发重读；只读失败显示读取异常，保留已采集历史。默认自动定位 Cursor 用户数据目录；自定义配置可在启动服务前设置 `CURSOR_USER_DATA_DIR`，指向包含 `User` 子目录的 Cursor 数据目录。
