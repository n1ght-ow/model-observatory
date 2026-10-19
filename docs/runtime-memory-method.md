# 桌面运行内存测量方法

本文描述 Model Observatory 桌面版运行内存与稳定性测量的固定方法。正式结果必须由同一份 fixture、harness 和打包产物生成，并以原始样本和 SHA-256 为证据。这里不记录或引用旧版本的测量结论。

## 隔离与输入

fixture 由独立脚本生成：

```powershell
node scripts/memory-fixture.mjs <output-dir> normal
node scripts/memory-fixture.mjs <output-dir> large
```

`normal` 的目标规模约为 3,000 条请求，`large` 约为 30,000 条。生成器使用固定种子、固定历史时间、多个模型、多个项目 / 会话和显式未知归属，拒绝覆盖已经存在的输出目录。fixture 包含 SQLite 历史、事件文件、Codex 源日志、清单和 SHA-256；其中源日志故意以不完整的 JSON 行结束，用来验证下一轮采集能否保留半行并从原位置续读。

每次测量都把 fixture 复制到独立的 `home`、Electron profile 和 store，不读取真实的 `~/.model-observatory`、用户项目、认证数据或现有客户端日志。请求时间全部是固定历史时刻，增量也是固定且非未来的记录。

## 正式运行

单轮命令为：

```powershell
node tests/desktop-memory.performance.mjs <label> <exe> <fixture> [run]
```

正式对照至少为每个版本、每种数据集各做 3 次独立运行，并交错执行前后顺序，例如每一轮按“普通基线、普通候选、大历史基线、大历史候选”的顺序运行，然后重复三轮。这样可减少整段机器状态、温度、后台任务和缓存冷热差异。`run` 是独立运行标识，应由正式执行者分配，不能重复使用已有输出。

`<exe>` 必须是打包后的 Electron 入口。harness 使用 Playwright `_electron.launch` 控制该 EXE，启动后检查版本、是否已打包、软件绘制状态和本地数据隔离。正式比较不得混用源码预览、开发服务器或未打包应用。

每个版本、数据集的前后顺序固定为：

1. 普通基线
2. 普通候选
3. 大历史基线
4. 大历史候选

重复 3 轮。这里描述的是执行顺序；完成情况以实际产生的 `<run>.summary.json` 和 `aggregate.json` 为准。

## 场景与断言

harness 覆盖首次启动和补采、稳定空闲、模型总览、50 条请求流水、模型详情展开、隐藏到托盘、恢复窗口、重复页面切换、持续增量以及关闭后的重启补采。模型详情通过主页的模型展开按钮进入，不依赖独立 URL。

持续增量部分从事件文件追加固定记录，每轮等待应用自身的 15 秒采集周期，至少观察 3 次自动提交；不使用显式强制采集替代定时提交。fixture 目标规模为 3,000 / 30,000 条，另有 3 条持续增量和 1 条重启补采记录；清单中的最终请求数应作为该 fixture 的唯一计数基准。

正确性核对分阶段进行：启动与半行恢复后先核对累计请求数和采集状态；总览阶段核对输入 / 输出 / 缓存 Token、模型分组及项目 / 会话归属；流水阶段单独核对 50 行分页；三次持续增量分别在每轮核对恰好新增一条；重启补采后再以最终快照全面核对请求、Token、模型、归属、分页、reconciliation 和错误状态。源日志的半行写在测试中完成，必须只新增预期的一条，不能重复计数。重启后追加的固定记录也必须被补采，且原有历史不能丢失。

## 内存口径

规范（canonical）内存来自 Windows `PowerShell Get-Process`：

- `PrivateMemorySize64` 汇总为该应用所有自有进程的 Private Bytes。
- `WorkingSet64` 汇总为 Working Set。
- 应用 PID 集合取自 Electron `app.getAppMetrics()`，只统计它返回的 Browser、GPU、网络、数据服务和界面进程。
- Playwright `_electron.launch` 可能额外留下 `cmd.exe` 或其他启动 wrapper。wrapper 的 OS 数据会另存为诊断信息，但不进入 canonical 总额。

Electron `app.getAppMetrics().memory` 同时按 PID、进程类型和 service 名称保存。Windows 文档将该对象的内存字段表示为 KiB，`privateBytes` 是 Windows 可选字段；样本中出现缺失或非正值时记为 `null`，不能当作零内存。canonical 汇总仍以 OS 字节值为准。

所有进程的 Working Set 相加可能重复计算共享 DLL、Electron 运行时和其他共享页，因此它适合观察所有自有进程的驻留规模，但不是去重后的物理内存。Private Bytes 排除跨进程共享页，更适合比较同一 fixture 下不同版本的私有分配；它仍包含每个进程自身的运行时开销，也不是操作系统报告的整机内存增长。

采样期间不调用 GC、`emptyWorkingSet`、工作集 trim、堆上限或其他强制释放手段，也不修改应用的 15 秒采集定时器。每个场景的稳定值取采样中位数，同时保留峰值和原始样本。正式汇总应按三次独立运行分别计算每个场景的中位数，并报告三次之间的 min / max；单次结果不能代表稳定分布。

## 启动采样边界

启动和补采阶段会同时保存低频 OS 样本和 Electron `getAppMetrics()` 约 250ms 间隔的高频样本。高频值只能称为 **sampled peak**：它可能捕捉到进程创建、补采或页面加载期间的较高值，也可能漏掉更短、更早的瞬时峰值。低频 OS canonical 值不能由高频 Electron 值替代。

启动 UI 耗时记录为从 Playwright 发起 launch 到首页请求总数可见的时间。它不是操作系统桌面快捷方式的完整冷启动，也不是安装后的首次启动承诺。没有采样覆盖的区间不能报告为零，也不能把空样本集合描述为真实峰值。

## CPU 口径

CPU 保存两类互不作替代的观察：

- Electron `cpu.percentCPUUsage` 是两次 `getAppMetrics()` 调用之间的区间平均，第一次调用返回零；同对象的 `cumulativeCPUUsage`（若提供）是进程启动以来的累计 CPU 秒数。本地 `electron.d.ts` 只定义这些时间区间，没有将百分比绑定为“一个核心的 100%”。Electron / Chromium 的 `percentCPUUsage` 可能按整机 logical CPUs 归一，因此它只能作为同一 Electron 口径下的区间相对活动指标，不能据此反推核心数，也不能与 OS 的核心秒数差分直接相加或换算。
- Windows `Get-Process CPU` 是进程启动以来的累计 CPU 秒数；对同一稳定场景的首末样本做差并除以经过时间，得到以单核心时间占比表示的 OS 汇总值。多个进程相加可能超过 100%，因为此时 100% 表示一个完整逻辑核心，而不是整机全部 logical CPUs 的上限。

报告分别保留 Electron 区间百分比和 OS 累计差分；不得把两者相加、相互替代，或少乘 `logicalCpus` 后宣称完成统一。CPU 采样不是能耗、温度、磁盘 I/O 或用户输入延迟的测量，也不能解释某个进程为何分配内存。

## 长稳运行

普通正式 3 轮默认不追加长稳循环。需要额外观察重复页面切换和正常采集缓存是否持续增长时，设置：

```powershell
$env:MEMORY_SOAK_ROUNDS = "20"
node tests/desktop-memory.performance.mjs <label> <exe> <fixture> <run>
Remove-Item Env:MEMORY_SOAK_ROUNDS
```

每一轮会重复“模型总览 / 请求流水”导航两次，然后采样 15 秒。报告记录请求数是否恒定、页面和 console 异常增量、每轮内存中位数 / 峰值以及首末轮变化。长稳运行是额外的同版本稳定性检查；不能因为重复 20 轮没有发生强制回收，就推断应用不存在保留、碎片化或未来增长。

## 输出与可比性

输出位于：

```text
logs/runtime-memory/<label>/
  <run>.summary.json
  <run>.samples.jsonl
  aggregate.json
```

`<run>.samples.jsonl` 保存原始样本，包括时间、场景、进程 PID / type / service、OS 字节值、Electron KiB 字段、wrapper 诊断数据、CPU 和采样来源。`<run>.summary.json` 保存规模、固定时间、fixture 文件 hash、semantic hash、EXE hash、`app.asar` hash、`server.cjs` hash、harness hash、机器环境、场景统计、API 延迟、采集延迟和正确性断言。

`aggregate.json` 只把 fixture semantic hash、harness hash、EXE hash、`app.asar` hash 和 `server.cjs` hash 完全一致的完整运行放在一起。正式比较必须使用同一 frozen harness；任何逻辑或存储行为变化同时改变 `server.cjs` / `app.asar` 时，必须建立新的版本组，不能直接把前后结果当成同组样本。

## 覆盖边界与不能推断的内容

当前 fixture 是确定为可复现的元数据负载，主要覆盖模型、Token、项目、会话、归属、证据和普通事件读取。它没有模拟数兆字节的工具输出 / 响应正文、成千上万个唯一模型名、超长项目路径、异常数据库 schema、压缩帧损坏、真实 Cursor / DSH / OpenCode 数据库的全部边界，也没有验证真实客户端目录规模或冷磁盘扫描。大历史和普通历史只提供两种固定规模，不能据此推导任意真实用户分布。

本方法也不能给出：

- 机器上所有应用的总内存变化或内存泄漏保证；
- 安装包安装、卸载、升级、签名、快捷方式或开机启动的验收结论；
- 对真实历史、认证文件、客户端正文和用户隐私数据的代表性；
- 某个内存数字在所有电脑、Windows 版本、显示缩放或窗口尺寸下成立的保证；
- 仅靠一次运行或多个不同 hash 运行得出的版本间性能结论；
- 把 sampled peak、Working Set 的共享页重复计算或 CPU 百分比误读为整机资源上限。

正式发行验收还必须单独覆盖安装版 / 免安装版的启动、升级、真实用户目录隔离、窗口生命周期和故障恢复。这里的测量只针对打包 Electron 程序在固定 fixture 上的运行时行为，不是安装版验收本身。
