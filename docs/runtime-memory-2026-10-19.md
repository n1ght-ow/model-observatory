# 桌面运行内存正式对照（2026-10-19）

由 `scripts/summarize-runtime-memory.mjs` 从本轮 12 个 formal summary 与 raw samples 生成；完整字段见 [`comparison.json`](../logs/runtime-memory/comparison.json)，方法见 [`runtime-memory-method.md`](runtime-memory-method.md)。

## 证据与可比性

- Formal short：12/12 complete；每个版本、数据集严格 3 次独立且不重叠运行。
- Formal status：complete；soak status：interrupted；overall status：partial。
- Independent diagnostic status：complete。
- Main-inspector control status：complete。
- Harness：`c6c7685a01819e21166b7be63c21aa88156b78b878c244981fc8b5bc1fe4f85e`
- 普通 / 大历史 fixture：`bc2b7ef3710e06be34f2da1fc55eb1a7e2f95f0b774f1efee62935895a3f5daf` / `c52025131ce7ad72300a639a34c439c1e23e52e5752720890f581c33f8d746d7`
- Profile / 产物组内一致性：通过；每个数据集的 baseline 与 candidate 使用相同 fixture，每个 variant 的 6 个 formal run 使用相同应用产物。
- 基线 app.asar / server.cjs：`9ab366d59f9d120d79407c8187fc86bd5d45a8246ea6a394860a70cccd830fa5` / `3c56ab5382f3fb688dce2840fe10b312042f70a1d3654b9ad8a014c323625941`
- 候选 app.asar / server.cjs：`9ab366d59f9d120d79407c8187fc86bd5d45a8246ea6a394860a70cccd830fa5` / `cc4e0db56b7e09c8a223ed9e92270ae5e20aebef31f2094471bef12e3640dede`
- 应用产物组合是否不同：是

**长稳未通过：** soak evidence 存在中断失败，不能计为通过；详细边界见“20 轮长稳观察”。12 轮 short 证据仍有效。

执行顺序：

```text
01. normal/baseline/run1 @ 2026-10-19T12:28:02.840Z
02. normal/candidate/run1 @ 2026-10-19T12:29:34.433Z
03. large/baseline/run1 @ 2026-10-19T12:31:05.970Z
04. large/candidate/run1 @ 2026-10-19T12:32:38.537Z
05. normal/baseline/run2 @ 2026-10-19T12:34:09.738Z
06. normal/candidate/run2 @ 2026-10-19T12:35:41.212Z
07. large/baseline/run2 @ 2026-10-19T12:37:11.047Z
08. large/candidate/run2 @ 2026-10-19T12:38:43.323Z
09. normal/baseline/run3 @ 2026-10-19T12:40:15.956Z
10. normal/candidate/run3 @ 2026-10-19T12:41:47.297Z
11. large/baseline/run3 @ 2026-10-19T12:43:18.473Z
12. large/candidate/run3 @ 2026-10-19T12:44:51.274Z
```

## 普通历史场景内存

每格是三次 run 场景中位数的 median `[min–max]`，单位 MiB。

| 场景 | 基线 Private | 候选 Private | Δ Private | 基线 WorkingSet | 候选 WorkingSet | Δ WorkingSet |
| --- | --- | --- | --- | --- | --- | --- |
| `stable-idle` 稳定空闲 | 242.88 [242.75–243.72] | 238.57 [236.69–239.85] | -1.8% | 552.44 [552.35–553.37] | 549.72 [547.51–551.37] | -0.5% |
| `overview` 模型总览 | 247.16 [246.32–247.25] | 242.75 [240.70–243.60] | -1.8% | 549.08 [548.97–549.76] | 546.37 [544.12–548.45] | -0.5% |
| `requests-50` 请求流水 50 条 | 257.98 [257.44–259.87] | 256.26 [256.24–257.05] | -0.7% | 571.20 [570.47–572.77] | 570.18 [569.41–570.69] | -0.2% |
| `model-detail` 模型详情 | 266.19 [265.94–279.86] | 265.01 [263.79–278.93] | -0.4% | 624.10 [623.89–637.98] | 623.50 [623.32–637.07] | -0.1% |
| `hidden` 隐藏窗口 | 234.93 [233.59–236.13] | 233.42 [230.44–235.53] | -0.6% | 538.89 [537.99–539.39] | 538.07 [534.06–540.73] | -0.2% |
| `restored` 恢复窗口 | 241.46 [240.68–241.72] | 238.89 [238.09–242.16] | -1.1% | 555.02 [554.70–555.61] | 553.83 [551.55–557.14] | -0.2% |
| `after-repeated-switching` 重复切换后 | 252.41 [251.93–254.54] | 251.73 [250.60–252.57] | -0.3% | 574.39 [574.37–576.05] | 574.41 [572.32–575.77] | +0.0% |
| `after-increments` 持续增量后 | 260.12 [256.02–260.92] | 255.25 [248.65–258.29] | -1.9% | 582.18 [580.91–587.13] | 580.49 [557.83–582.21] | -0.3% |
| `restart-stable` 重启后稳定 | 220.87 [216.74–222.38] | 212.37 [211.12–213.65] | -3.8% | 514.72 [511.93–515.22] | 502.34 [500.44–507.46] | -2.4% |

## 大历史场景内存

每格是三次 run 场景中位数的 median `[min–max]`，单位 MiB。

| 场景 | 基线 Private | 候选 Private | Δ Private | 基线 WorkingSet | 候选 WorkingSet | Δ WorkingSet |
| --- | --- | --- | --- | --- | --- | --- |
| `stable-idle` 稳定空闲 | 387.32 [386.14–391.55] | 351.72 [349.03–352.96] | -9.2% | 697.36 [695.89–700.74] | 660.89 [657.85–662.53] | -5.2% |
| `overview` 模型总览 | 392.32 [391.77–397.11] | 356.40 [354.09–358.11] | -9.2% | 695.68 [695.15–699.70] | 659.07 [656.25–661.39] | -5.3% |
| `requests-50` 请求流水 50 条 | 410.72 [410.02–416.64] | 374.93 [372.06–376.30] | -8.7% | 725.24 [724.51–730.18] | 687.70 [684.83–690.26] | -5.2% |
| `model-detail` 模型详情 | 442.61 [442.21–448.88] | 405.68 [397.75–406.89] | -8.3% | 800.99 [799.35–806.49] | 762.36 [755.29–764.55] | -4.8% |
| `hidden` 隐藏窗口 | 310.42 [308.56–316.52] | 281.45 [280.29–305.82] | -9.3% | 614.97 [613.55–620.17] | 585.50 [578.39–607.86] | -4.8% |
| `restored` 恢复窗口 | 318.96 [317.18–323.58] | 289.85 [288.46–313.95] | -9.1% | 633.72 [631.41–638.33] | 603.30 [597.54–626.38] | -4.8% |
| `after-repeated-switching` 重复切换后 | 334.28 [334.10–339.33] | 302.92 [299.70–304.11] | -9.4% | 657.01 [656.52–661.75] | 621.03 [618.93–626.53] | -5.5% |
| `after-increments` 持续增量后 | 354.54 [346.83–360.93] | 327.34 [311.07–328.05] | -7.7% | 666.25 [657.90–671.63] | 631.82 [621.91–638.10] | -5.2% |
| `restart-stable` 重启后稳定 | 359.76 [359.30–360.20] | 316.44 [314.98–321.77] | -12.0% | 658.20 [653.88–666.54] | 622.53 [621.80–627.30] | -5.4% |

## 启动、查询、交互与采集

| 数据集 / 指标 | 基线 | 候选 | Δ absolute | Δ% |
| --- | --- | --- | --- | --- |
| normal / 启动到首页就绪 | 836.1 ms [791.4 ms–836.8 ms] | 813.9 ms [810.8 ms–831.8 ms] | -22.1 ms | -2.6% |
| normal / 启动低频 OS 样本最高值（覆盖有限） | 95.8 MiB [94.2 MiB–97.2 MiB] | 95.9 MiB [94.1 MiB–100.6 MiB] | +0.1 MiB | +0.1% |
| normal / 启动低频 OS 样本 WorkingSet 最高值（覆盖有限） | 277.4 MiB [251.5 MiB–280.6 MiB] | 278.6 MiB [257.6 MiB–283.1 MiB] | +1.2 MiB | +0.4% |
| normal / 启动 Electron 250ms sampled Private 最高值 | 230.1 MiB [228.3 MiB–232.1 MiB] | 221.4 MiB [221.0 MiB–223.6 MiB] | -8.8 MiB | -3.8% |
| normal / 启动 Electron 250ms sampled WorkingSet 最高值 | 521.7 MiB [512.0 MiB–526.6 MiB] | 503.5 MiB [503.1 MiB–508.8 MiB] | -18.3 MiB | -3.5% |
| normal / 查询中位数 | 5.188 ms [4.377 ms–5.587 ms] | 4.928 ms [4.923 ms–5.590 ms] | -0.260 ms | -5.0% |
| normal / 滚动 frame p95 | 6.100 ms [6.100 ms–6.100 ms] | 6.100 ms [6.100 ms–6.100 ms] | 0.000 ms | 0.0% |
| normal / 滚动 frame count | 595 [594–595] | 594 [594–595] | -1 | -0.2% |
| normal / 滚动 >33ms frame count | 0 [0–0] | 0 [0–0] | 0 | — |
| normal / 显式采集 HTTP | 31.825 ms [25.624 ms–33.415 ms] | 31.317 ms [20.712 ms–36.757 ms] | -0.508 ms | -1.6% |
| normal / 自动采集延迟 | 15364.0 ms [15349.0 ms–15389.0 ms] | 15350.0 ms [13891.0 ms–15464.0 ms] | -14.0 ms | -0.1% |
| normal / 首会话整体 OS 单核心 CPU | 6.02% [5.90%–6.39%] | 6.39% [6.09%–6.43%] | +0.37% | +6.2% |
| normal / 重启补采 wall | 744.3 ms [726.4 ms–746.2 ms] | 757.1 ms [750.3 ms–821.1 ms] | +12.8 ms | +1.7% |
| normal / 重启 Electron sampled Private peak | 185.7 MiB [181.9 MiB–186.5 MiB] | 187.4 MiB [184.3 MiB–189.3 MiB] | +1.8 MiB | +0.9% |
| large / 启动到首页就绪 | 1553.0 ms [1548.1 ms–1562.3 ms] | 1536.8 ms [1531.1 ms–1551.1 ms] | -16.1 ms | -1.0% |
| large / 启动低频 OS 样本最高值（覆盖有限） | 335.6 MiB [329.7 MiB–336.6 MiB] | 299.6 MiB [296.8 MiB–301.1 MiB] | -36.0 MiB | -10.7% |
| large / 启动低频 OS 样本 WorkingSet 最高值（覆盖有限） | 612.4 MiB [605.8 MiB–613.7 MiB] | 594.3 MiB [592.0 MiB–597.6 MiB] | -18.0 MiB | -2.9% |
| large / 启动 Electron 250ms sampled Private 最高值 | 368.9 MiB [364.7 MiB–371.1 MiB] | 303.3 MiB [302.0 MiB–303.6 MiB] | -65.6 MiB | -17.8% |
| large / 启动 Electron 250ms sampled WorkingSet 最高值 | 665.1 MiB [661.0 MiB–666.1 MiB] | 597.6 MiB [596.5 MiB–599.8 MiB] | -67.5 MiB | -10.1% |
| large / 查询中位数 | 8.681 ms [8.040 ms–9.298 ms] | 8.600 ms [7.912 ms–8.865 ms] | -0.081 ms | -0.9% |
| large / 滚动 frame p95 | 6.100 ms [6.100 ms–6.100 ms] | 6.100 ms [6.100 ms–6.100 ms] | 0.000 ms | 0.0% |
| large / 滚动 frame count | 594 [594–595] | 595 [594–595] | +1 | +0.2% |
| large / 滚动 >33ms frame count | 0 [0–0] | 0 [0–0] | 0 | — |
| large / 显式采集 HTTP | 29.400 ms [28.909 ms–30.191 ms] | 32.526 ms [23.052 ms–32.532 ms] | +3.126 ms | +10.6% |
| large / 自动采集延迟 | 15503.0 ms [15471.0 ms–15503.0 ms] | 15453.0 ms [13908.0 ms–15465.0 ms] | -50.0 ms | -0.3% |
| large / 首会话整体 OS 单核心 CPU | 8.67% [8.46%–9.27%] | 7.65% [7.51%–8.28%] | -1.03% | -11.8% |
| large / 重启补采 wall | 1795.3 ms [1788.8 ms–1822.0 ms] | 1791.9 ms [1779.5 ms–1796.4 ms] | -3.4 ms | -0.2% |
| large / 重启 Electron sampled Private peak | 364.3 MiB [363.0 MiB–365.5 MiB] | 321.0 MiB [320.5 MiB–329.3 MiB] | -43.3 MiB | -11.9% |

## 启动采样覆盖

OS 是低频样本最高值，不是完整启动峰；如果样本少或 processCount 范围偏小，可能漏掉早期/短时峰值。Electron `sampled` 为约 250ms 间隔的高频样本，仍可能漏掉更短区间，不能替代 OS canonical 峰值。

| 数据集 / 版本 / run | OS 样本数 | OS processCount 范围 | OS Private 最高值（有限覆盖） | Electron sampled 样本数 | Electron processCount 范围 | Electron sampled Private 最高值 | 覆盖判断 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| normal / baseline / run1 | 1 | 4–4 | 94.2 MiB | 3 | 4–5 | 232.1 MiB | 样本少/范围小，可能漏峰 |
| normal / candidate / run1 | 1 | 4–4 | 100.6 MiB | 3 | 4–5 | 223.6 MiB | 样本少/范围小，可能漏峰 |
| large / baseline / run1 | 2 | 4–5 | 329.7 MiB | 6 | 4–5 | 368.9 MiB | 2 个低频样本，仍可能漏峰 |
| large / candidate / run1 | 2 | 4–5 | 296.8 MiB | 6 | 4–5 | 302.0 MiB | 2 个低频样本，仍可能漏峰 |
| normal / baseline / run2 | 1 | 4–4 | 95.8 MiB | 3 | 4–5 | 230.1 MiB | 样本少/范围小，可能漏峰 |
| normal / candidate / run2 | 1 | 4–4 | 94.1 MiB | 3 | 4–5 | 221.0 MiB | 样本少/范围小，可能漏峰 |
| large / baseline / run2 | 2 | 4–5 | 335.6 MiB | 6 | 4–5 | 364.7 MiB | 2 个低频样本，仍可能漏峰 |
| large / candidate / run2 | 2 | 4–5 | 301.1 MiB | 6 | 4–5 | 303.6 MiB | 2 个低频样本，仍可能漏峰 |
| normal / baseline / run3 | 1 | 4–4 | 97.2 MiB | 3 | 4–5 | 228.3 MiB | 样本少/范围小，可能漏峰 |
| normal / candidate / run3 | 1 | 4–4 | 95.9 MiB | 3 | 4–5 | 221.4 MiB | 样本少/范围小，可能漏峰 |
| large / baseline / run3 | 2 | 4–5 | 336.6 MiB | 6 | 4–5 | 371.1 MiB | 2 个低频样本，仍可能漏峰 |
| large / candidate / run3 | 2 | 4–5 | 299.6 MiB | 6 | 4–5 | 303.3 MiB | 2 个低频样本，仍可能漏峰 |

## CPU 口径

Electron `percentCPUUsage` 是 Electron 按指标区间归一后的场景中位数；OS 项由 `Get-Process CPU` 累计秒差除以场景墙钟时间得到，表示单逻辑核心百分比。两者不可直接换算。稳定场景的少量样本不能代表整个会话或长期 CPU。

**CPU 回归观察：**

- normal / stable-idle OS CPU：0.95% → 1.57%（+0.62 单核心 pp；+65.0%；基线范围 0.32%–1.56%，候选范围 0.96%–2.22%）。
- normal / overview OS CPU：0.48% → 1.43%（+0.95 单核心 pp；+196.5%；基线范围 0.47%–1.92%，候选范围 0.48%–3.84%）。
- normal / requests-50 OS CPU：0.00% → 0.96%（+0.96 单核心 pp；—；基线范围 0.00%–0.00%，候选范围 0.48%–0.96%）。
- normal / model-detail OS CPU：0.00% → 0.48%（+0.48 单核心 pp；—；基线范围 0.00%–0.48%，候选范围 0.00%–0.48%）。
- normal / hidden OS CPU：2.89% → 3.35%（+0.46 单核心 pp；+16.0%；基线范围 1.92%–3.33%，候选范围 3.33%–5.74%）。
- normal / restored OS CPU：0.00% → 0.95%（+0.95 单核心 pp；—；基线范围 0.00%–0.00%，候选范围 0.48%–0.96%）。
- normal / after-repeated-switching OS CPU：0.48% → 0.95%（+0.47 单核心 pp；+99.0%；基线范围 0.48%–0.48%，候选范围 0.00%–0.96%）。
- normal / first-session OS CPU：6.02% → 6.39%（+0.37 单核心 pp；+6.2%；基线范围 5.90%–6.39%，候选范围 6.09%–6.43%）。
- large / stable-idle OS CPU：1.27% → 2.21%（+0.94 单核心 pp；+73.6%；基线范围 1.24%–2.23%，候选范围 2.20%–2.54%）。
- large / overview OS CPU：0.94% → 1.42%（+0.48 单核心 pp；+51.3%；基线范围 0.48%–0.95%，候选范围 0.94%–2.39%）。
- large / restored OS CPU：0.00% → 0.48%（+0.48 单核心 pp；—；基线范围 0.00%–0.95%，候选范围 0.00%–0.48%）。
- large / restart-stable OS CPU：2.22% → 2.23%（+0.01 单核心 pp；+0.4%；基线范围 1.42%–2.87%，候选范围 1.58%–2.56%）。

这些是当前三个正式 run 的描述性回归观察，不能由内存改善抵消；soak 已因环境中断，不能作为通过结论。

| 数据集 / 场景 | 基线 Electron | 基线 OS 单核心 | 候选 Electron | 候选 OS 单核心 | Δ Electron | Δ OS |
| --- | --- | --- | --- | --- | --- | --- |
| normal / `stable-idle` | 0.14% [0.13%–0.14%] | 0.95% [0.32%–1.56%] | 0.15% [0.14%–0.16%] | 1.57% [0.96%–2.22%] | +5.8% | +65.0% |
| normal / `overview` | 0.02% [0.02%–0.02%] | 0.48% [0.47%–1.92%] | 0.02% [0.02%–0.02%] | 1.43% [0.48%–3.84%] | -5.6% | +196.5% |
| normal / `requests-50` | 0.01% [0.01%–0.01%] | 0.00% [0.00%–0.00%] | 0.01% [0.01%–0.01%] | 0.96% [0.48%–0.96%] | -7.1% | — |
| normal / `model-detail` | 0.01% [0.01%–0.01%] | 0.00% [0.00%–0.48%] | 0.01% [0.01%–0.01%] | 0.48% [0.00%–0.48%] | -7.7% | — |
| normal / `hidden` | 0.09% [0.08%–0.09%] | 2.89% [1.92%–3.33%] | 0.09% [0.08%–0.09%] | 3.35% [3.33%–5.74%] | -3.4% | +16.0% |
| normal / `restored` | 0.17% [0.14%–0.21%] | 0.00% [0.00%–0.00%] | 0.20% [0.14%–0.22%] | 0.95% [0.48%–0.96%] | +16.0% | — |
| normal / `after-repeated-switching` | 0.04% [0.03%–0.07%] | 0.48% [0.48%–0.48%] | 0.04% [0.04%–0.07%] | 0.95% [0.00%–0.96%] | +16.2% | +99.0% |
| normal / `after-increments` | 0.27% [0.26%–0.28%] | 1.92% [1.44%–3.32%] | 0.31% [0.25%–0.32%] | 1.92% [1.89%–4.75%] | +13.7% | 0.0% |
| normal / `restart-stable` | 0.13% [0.11%–0.15%] | 2.55% [0.64%–2.88%] | 0.04% [0.04%–0.13%] | 1.43% [0.47%–1.59%] | -67.2% | -44.0% |

| 数据集 / 场景 | 基线 Electron | 基线 OS 单核心 | 候选 Electron | 候选 OS 单核心 | Δ Electron | Δ OS |
| --- | --- | --- | --- | --- | --- | --- |
| large / `stable-idle` | 0.16% [0.15%–0.17%] | 1.27% [1.24%–2.23%] | 0.14% [0.14%–0.15%] | 2.21% [2.20%–2.54%] | -11.3% | +73.6% |
| large / `overview` | 0.01% [0.01%–0.01%] | 0.94% [0.48%–0.95%] | 0.01% [0.01%–0.01%] | 1.42% [0.94%–2.39%] | -10.0% | +51.3% |
| large / `requests-50` | 0.02% [0.01%–0.02%] | 0.00% [0.00%–0.00%] | 0.02% [0.01%–0.02%] | 0.00% [0.00%–0.48%] | +6.3% | — |
| large / `model-detail` | 0.01% [0.01%–0.01%] | 0.00% [0.00%–0.47%] | 0.01% [0.01%–0.01%] | 0.00% [0.00%–0.00%] | +8.3% | — |
| large / `hidden` | 0.04% [0.03%–0.04%] | 0.47% [0.00%–0.48%] | 0.04% [0.04%–0.05%] | 0.46% [0.00%–0.96%] | +28.6% | -2.7% |
| large / `restored` | 0.19% [0.17%–0.23%] | 0.00% [0.00%–0.95%] | 0.20% [0.17%–0.25%] | 0.48% [0.00%–0.48%] | +3.2% | — |
| large / `after-repeated-switching` | 0.04% [0.04%–0.04%] | 0.48% [0.48%–0.48%] | 0.04% [0.04%–0.07%] | 0.48% [0.46%–1.91%] | +13.2% | -0.6% |
| large / `after-increments` | 0.40% [0.36%–0.44%] | 1.92% [0.95%–4.33%] | 0.28% [0.01%–0.35%] | 1.92% [0.00%–2.39%] | -29.7% | -0.3% |
| large / `restart-stable` | 0.09% [0.04%–0.13%] | 2.22% [1.42%–2.87%] | 0.08% [0.05%–0.09%] | 2.23% [1.58%–2.56%] | -12.5% | +0.4% |

## 首会话整体 CPU

窗口截止到首次 `restart-*` 样本之前，结束值为最后一个完整 OS 样本；起点为相同 PID 集合的最早完整 OS 样本。`Get-Process CPU` 秒差除以两条样本时间戳的实际 elapsed 秒，得到单核心百分比。窗口包含启动、UI 切换和自动采集，排除重启及 Playwright wrapper，不能把 stable-idle 的短窗口当作整体结论。

| 数据集 | 基线 median | 候选 median | Δ 单核心 | Δ |
| --- | --- | --- | --- | --- |
| normal | 6.02% [5.90%–6.39%] | 6.39% [6.09%–6.43%] | +0.37 pp | +6.2% |
| large | 8.67% [8.46%–9.27%] | 7.65% [7.51%–8.28%] | -1.03 pp | -11.8% |

| 数据集 / 版本 / run | 窗口起 | 窗口止 | 实际秒数 | PID 集合 | CPU 秒差 | 单核心 CPU |
| --- | --- | --- | --- | --- | --- | --- |
| normal / baseline / run1 | 2026-10-19T12:28:09.337Z | 2026-10-19T12:29:24.603Z | 75.266 s | 28044,28232,31080,34320,35708 | 4.531 s | 6.02% |
| normal / candidate / run1 | 2026-10-19T12:29:40.969Z | 2026-10-19T12:30:56.024Z | 75.055 s | 26116,27812,35036,35472,35564 | 4.828 s | 6.43% |
| large / baseline / run1 | 2026-10-19T12:31:07.634Z | 2026-10-19T12:32:27.542Z | 79.908 s | 26736,27976,31596,33956,35764 | 7.406 s | 9.27% |
| large / candidate / run1 | 2026-10-19T12:32:40.235Z | 2026-10-19T12:33:58.916Z | 78.681 s | 10312,12848,29516,31380,35600 | 6.016 s | 7.65% |
| normal / baseline / run2 | 2026-10-19T12:34:16.291Z | 2026-10-19T12:35:31.393Z | 75.102 s | 16372,21808,26888,32944,33996 | 4.797 s | 6.39% |
| normal / candidate / run2 | 2026-10-19T12:35:47.749Z | 2026-10-19T12:37:01.588Z | 73.839 s | 14272,28996,35372,35408,35508 | 4.719 s | 6.39% |
| large / baseline / run2 | 2026-10-19T12:37:12.859Z | 2026-10-19T12:38:32.863Z | 80.004 s | 2192,11500,32516,33996,35808 | 6.938 s | 8.67% |
| large / candidate / run2 | 2026-10-19T12:38:45.008Z | 2026-10-19T12:40:05.031Z | 80.023 s | 16692,28708,32592,32944,33396 | 6.625 s | 8.28% |
| normal / baseline / run3 | 2026-10-19T12:40:22.511Z | 2026-10-19T12:41:37.473Z | 74.962 s | 25876,27832,29512,32020,35456 | 4.422 s | 5.90% |
| normal / candidate / run3 | 2026-10-19T12:41:53.791Z | 2026-10-19T12:43:08.929Z | 75.138 s | 27212,30404,31476,32508,34204 | 4.578 s | 6.09% |
| large / baseline / run3 | 2026-10-19T12:43:20.221Z | 2026-10-19T12:44:40.182Z | 79.961 s | 14668,24616,27216,28440,34732 | 6.766 s | 8.46% |
| large / candidate / run3 | 2026-10-19T12:44:52.993Z | 2026-10-19T12:46:12.928Z | 79.935 s | 26020,31692,31732,34376,35532 | 6.000 s | 7.51% |

## 进程拆分

`service` 只表示 `node.mojom.NodeService` / 本机数据采集；Network Service 和明确辅助进程归 `helper`；其它 Utility 或不可靠类别归 `unknown`。`processes[].labels` 保留 PID 对应的 type、name、serviceName，raw JSONL 保留完整原始样本。

| 数据集 / 版本 / run | main | renderer | data service | GPU | helper | unknown | changing PIDs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| normal / baseline / run1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| normal / candidate / run1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| large / baseline / run1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| large / candidate / run1 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| normal / baseline / run2 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| normal / candidate / run2 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| large / baseline / run2 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| large / candidate / run2 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| normal / baseline / run3 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| normal / candidate / run3 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| large / baseline / run3 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |
| large / candidate / run3 | 1 | 1 | 1 | 1 | 1 | 0 | 0 |

## 20 轮长稳观察

- soak status：interrupted；expected rounds：20。
- baseline：interrupted（timeout）；已完成 rounds 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18；failure `logs/runtime-memory/formal-soak-baseline/soak1.failure.json`；raw `logs/runtime-memory/formal-soak-baseline/soak1.samples.jsonl`。
- candidate：interrupted（browser-closed）；已完成 rounds none；failure `logs/runtime-memory/formal-soak-candidate/soak1.failure.json`；raw `logs/runtime-memory/formal-soak-candidate/soak1.samples.jsonl`。

### 长稳失败边界

| 版本 | 状态 | 类型 | 完成轮次 | failure | raw samples | 错误首行 |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | interrupted | timeout | 18/20 (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18) | `logs/runtime-memory/formal-soak-baseline/soak1.failure.json` | `logs/runtime-memory/formal-soak-baseline/soak1.samples.jsonl` | locator.waitFor: Timeout 45000ms exceeded. |
| candidate | interrupted | browser-closed | 0/20  | `logs/runtime-memory/formal-soak-candidate/soak1.failure.json` | `logs/runtime-memory/formal-soak-candidate/soak1.samples.jsonl` | locator.waitFor: Target page, context or browser has been closed |

中断前已完成轮次（仅作为边界证据，不构成通过或完整趋势）：

| 版本 | round | Private | WorkingSet | OS CPU 单核心 |
| --- | --- | --- | --- | --- |
| baseline | 1 | 368.68 MiB | 687.50 MiB | 4.14% |
| baseline | 2 | 376.23 MiB | 693.13 MiB | 1.18% |
| baseline | 3 | 371.85 MiB | 687.89 MiB | 1.06% |
| baseline | 4 | 389.35 MiB | 704.23 MiB | 1.17% |
| baseline | 5 | 408.68 MiB | 724.96 MiB | 1.18% |
| baseline | 6 | 418.87 MiB | 736.25 MiB | 1.30% |
| baseline | 7 | 428.79 MiB | 744.45 MiB | 1.30% |
| baseline | 8 | 435.14 MiB | 749.63 MiB | 0.47% |
| baseline | 9 | 455.47 MiB | 769.30 MiB | 1.29% |
| baseline | 10 | 467.11 MiB | 780.86 MiB | 3.05% |
| baseline | 11 | 467.53 MiB | 779.12 MiB | 1.55% |
| baseline | 12 | 491.62 MiB | 803.13 MiB | 0.71% |
| baseline | 13 | 503.79 MiB | 815.27 MiB | 0.82% |
| baseline | 14 | 510.87 MiB | 823.22 MiB | 2.23% |
| baseline | 15 | 523.09 MiB | 836.75 MiB | 1.89% |
| baseline | 16 | 520.74 MiB | 832.46 MiB | 1.85% |
| baseline | 17 | 536.22 MiB | 848.15 MiB | 2.20% |
| baseline | 18 | 525.72 MiB | 837.70 MiB | 1.06% |

failure 记录没有 `.summary.json`，因此不能标记 complete；该环境中断不能被当作代码 bug 或性能通过。需要 fresh-label 重测。原始 failure 文件名未被改名或覆盖。

## 20 轮独立诊断

固定读取 `diagnostics/retest-baseline` 与 `diagnostics/retest-candidate` 下 latest `status: complete` 目录；较早的 failure/incomplete 目录保留在“非 complete 目录”列，明确不计通过。该诊断是独立功能稳定性重测，不替换或消除原 formal-soak failure。

| 版本 | selected run | 持续时间 | rounds / nav / requests | collection | app exit | 非 complete 目录 |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | `logs/runtime-memory/diagnostics/retest-baseline/2026-10-19T13-00-38-224Z` | 422.9 s | 20 / 80 / 30000 | 2026-10-19T13:00:43.249Z → 2026-10-19T13:07:39.205Z；advancing=true | 0 | logs/runtime-memory/diagnostics/retest-baseline/2026-10-19T12-59-28-476Z (failed) |
| candidate | `logs/runtime-memory/diagnostics/retest-candidate/2026-10-19T13-07-41-605Z` | 425.0 s | 20 / 80 / 30000 | 2026-10-19T13:07:46.023Z → 2026-10-19T13:14:42.562Z；advancing=true | 0 | none |

各进程首末 Private / WorkingSet（取 round 1 与 round 20 的最后一个完整 OS 样本；MiB）：

| 版本 | 进程类别 | Private first | Private last | Δ Private | WorkingSet first | WorkingSet last | Δ WorkingSet |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | main | 38.43 | 37.53 | -0.90 | 101.59 | 104.16 | 2.57 |
| baseline | renderer | 143.66 | 294.78 | 151.12 | 239.45 | 383.32 | 143.87 |
| baseline | gpu | 27.92 | 27.60 | -0.32 | 112.48 | 112.54 | 0.05 |
| baseline | service | 217.23 | 137.54 | -79.69 | 246.43 | 167.89 | -78.55 |
| baseline | helper | 13.45 | 12.82 | -0.64 | 50.49 | 50.33 | -0.16 |
| baseline | unknown | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| candidate | main | 37.53 | 37.96 | 0.43 | 100.80 | 104.66 | 3.86 |
| candidate | renderer | 144.92 | 298.02 | 153.09 | 241.13 | 390.13 | 149.00 |
| candidate | gpu | 27.92 | 27.73 | -0.18 | 112.59 | 112.75 | 0.16 |
| candidate | service | 185.96 | 105.29 | -80.66 | 216.73 | 136.83 | -79.90 |
| candidate | helper | 13.57 | 12.95 | -0.62 | 50.63 | 50.41 | -0.22 |
| candidate | unknown | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

JS heap / DOM / listener 序列范围：

| 版本 | JS used MiB | Embedder MiB | Total heap MiB | DOM nodes | Documents | JS event listeners | listener scopes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 9.16 → 10.32 [7.92–10.43] | 9.87 → 10.15 [8.92–10.22] | 15.56 → 13.06 [11.81–16.31] | 2822 → 2823 [2822–2823] | 1 → 1 [1–1] | 3138 → 5245 [1032–5245] | body=1 stable; document=143 stable; documentElement=0 stable; window=12 stable |
| candidate | 9.14 → 9.68 [8.03–10.37] | 9.74 → 10.11 [8.89–10.26] | 15.81 → 13.06 [10.81–16.06] | 2822 → 2823 [2822–2823] | 1 → 1 [1–1] | 3138 → 5245 [1032–5245] | body=1 stable; document=143 stable; documentElement=0 stable; window=12 stable |

- baseline：renderer Private 143.66 → 294.78 MiB（151.12 MiB）；JS used 9.16 → 10.32 MiB；embedder 9.87 → 10.15 MiB；DOM nodes 2822 → 2823；app-events 99，exit code 0。
- baseline network：requests=196 / responses=196 / failures=19，ContentBytes=399518；contentBytes 仅是 Content-Length 的累加；没有该 header 的 API 响应和 chunked body 会漏计，不能据此排除 Network 缓存活动。

- candidate：renderer Private 144.92 → 298.02 MiB（153.09 MiB）；JS used 9.14 → 9.68 MiB；embedder 9.74 → 10.11 MiB；DOM nodes 2822 → 2823；app-events 98，exit code 0。
- candidate network：requests=196 / responses=196 / failures=19，ContentBytes=399070；contentBytes 仅是 Content-Length 的累加；没有该 header 的 API 响应和 chunked body 会漏计，不能据此排除 Network 缓存活动。

20 轮功能完成、请求保持 30,000、collection 时间持续推进，只能证明本次运行完成和功能稳定；native renderer 增长仍未归因到 JS、DOM 或上述 listener scope，不能声称长期无泄漏。旧 formal-soak 外部中断和 failure 记录继续保留，不能由本节覆盖。

## Main-inspector 对照（candidate-only）

- 8 轮、32 次导航、每轮 30,000 requests、range=all、主窗 visible；每个端点均为 5 个进程。
- 直接 spawn 候选 EXE，仅 main-process Node inspector；webContents.executeJavaScript 导航，未连接 renderer DevTools/Network。
- 默认主窗外框 1440x960；main-only 脚本未显式 setContentSize(1440,1000)。该尺寸不在 summary 字段中，按本次运行方式记录。
- 候选 executable / app.asar / server.cjs 哈希与 formal candidate 完全一致：`56a1ca97d232c8359dd95545f75e7056ab53c52f124d75cd0aa3f2bcf1473755` / `9ab366d59f9d120d79407c8187fc86bd5d45a8246ea6a394860a70cccd830fa5` / `cc4e0db56b7e09c8a223ed9e92270ae5e20aebef31f2094471bef12e3640dede`。

| Round | Renderer endpoint MiB | Renderer median MiB | Renderer WorkingSet MiB | Data service Private MiB |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 121.66 | 125.65 | 222.24 | 182.05 |
| 2 | 83.19 | 85.61 | 184.53 | 107.01 |
| 3 | 95.25 | 88.68 | 195.73 | 106.97 |
| 4 | 90.80 | 87.58 | 203.58 | 103.94 |
| 5 | 95.28 | 86.28 | 189.56 | 104.76 |
| 6 | 90.39 | 87.12 | 185.98 | 103.94 |
| 7 | 93.06 | 87.11 | 188.38 | 104.61 |
| 8 | 92.02 | 87.84 | 187.30 | 103.72 |

- 20 轮 CDP candidate renderer：144.92 → 298.02 MiB（153.09 MiB）。Main-inspector endpoint：121.66 → 92.02 MiB（-29.64 MiB）；第 2–8 轮为 83.19–95.28 MiB，未出现 CDP 观察中每轮约 10 MiB 的持续增长。
- API metadata：status=200，contentLength=null，transferEncoding=chunked，bodyBytes=786758。该值由脚本 Node-fetch 单次验证；ContentBytes=399070 仍只是 Content-Length 累加，不能当总响应量或排除 Network 缓存。
- 仅连接 main-process Node inspector；通过 webContents.executeJavaScript 导航，未连接 renderer DevTools 或 Network domain。
- 20 轮 CDP 诊断显式设置 1440x1000 内容尺寸，导航驱动与每轮 API 探测也不同；8 轮 main-only 只支持观测环境相关假设。 8 轮更短，导航驱动、每轮 API 探测和窗口尺寸均不同；结果只支持“renderer 调试观测可能参与增长”的假设，不能确认精确缓冲根因，也不能计为额外生产降幅。

## 解释边界

- 三次独立运行只提供描述性样本，不是显著性检验或通用性能保证。
- OS Private 为规范内存口径；Working Set 会重复计算共享页。
- 启动 Electron 值是 250ms sampled peak，不能替代低频 OS canonical peak。
- CPU 需同时核对首会话整体窗口与 soak；stable-idle 短窗口不能单独证明无退步。
- 本报告只使用本次 formal evidence，不引用旧版本结果。
