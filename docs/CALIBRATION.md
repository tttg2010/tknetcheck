# 小白兔TKNC 阈值校准方案

> 回答 Zac 的核心问题：**怎么用主平台（TJ-Social）的真实发布数据，把拍脑袋的阈值变成被验证的阈值。**

现状：`JUDGMENT.md` 里每个阈值都标了「经验值·待校准」。它们全部收在 `@tknc/engine` 的 `DEFAULT_CONFIG` 里，引擎接受 config 覆盖——**校准的产物就是一份新 config**，上线就是换 config。这份文档讲怎么产出那份 config。

一句话路线图：**先攒数据 →（数据不够时）分层统计看信号 →（数据够了）逻辑回归学权重 → 版本化灰度上线 → 回滚兜底**。别一上来上重模型。

---

## 1. 校准的本质

我们有一堆规则（"机房 IP 扣 40"），但从没验证过：**机房 IP 的号真的更容易 0 播放吗？扣 40 是多了还是少了？**

校准 = 拿"检测时的信号快照" + "这个号后来真实发布结果（0播放/限流/正常）"，反过来问数据：

1. 哪些信号真的能区分好号和坏号？（有的可能根本没用）
2. 每个信号的"预测力"多大？→ 反推**权重**。
3. 每个信号从哪个值开始变坏？→ 反推**阈值**。
4. 总分多少该判 danger？→ 反推 **tier 边界**。

---

## 2. 反馈数据 schema

一条校准样本 = 一次检测的**信号快照** + 该号后续的**发布结果标签**，两者用一个匿名 join key 关联。

### 2.1 隐私约束（先说清，这是设计前提）

现有小工具**不存原始 IP**（`app.js` 的 `stripForStorage` 已删 `ip/raw/referenceIp/srflxIps` 等）。校准必须继承这个约束：

- **不存**：原始公网 IP、内网 IP、srflx IP、IPv6 地址、完整 UA、Canvas 原图。
- **存派生信号**：布尔/枚举/分桶后的数值（`isHosting`、`riskScore`、`tzCountryMatch`、`latency` 等）——这些已经是判断需要的全部，且不可反解身份。
- **国家/ASN**：存国家码和 ASN 号/机构名可以（这是判断信号，不是 PII）；不存具体到城市/坐标。
- **join key**：用平台账号 ID 的**单向哈希**（加盐）当关联键，不存明文账号。用户侧需一次性授权"用我的发布结果改进检测"。

> 原则：**存进校准库的，都是引擎已经会看到的派生信号，一个不多。** 校准不新增隐私暴露面。

### 2.2 信号快照表 `detection_snapshot`

一次检测存一行。字段直接对应 6 个模块 result 里**引擎实际用到的**派生字段（不是全量 result）。

| 字段 | 类型 | 来源 | 说明 |
|---|---|---|---|
| `snapshot_id` | string | 生成 | 主键 |
| `account_hash` | string | 平台 | 加盐单向哈希，join key |
| `detected_at` | timestamp | | 检测时间 |
| `config_version` | string | `report.configVersion` | 这次用哪版阈值算的（关键！） |
| `overall_score` | int | 引擎 | 当时给的总分 |
| `tier` | enum | 引擎 | 当时的分级 |
| — IP — | | | |
| `ip_country` | string | ip.country | 国家码 |
| `ip_asn` | string | ip.asn | ASN 号/机构（信号，非 PII） |
| `ip_is_hosting` | bool | ip.isHosting | |
| `ip_is_proxy` | bool | ip.isProxy | |
| `ip_risk_score` | int/null | ip.riskScore | null 保留（未知≠0） |
| — DNS — | | | |
| `dns_both_doh` | bool | dns.bothDohReachable | |
| `dns_baseline_consistent` | bool/null | dns.baselineConsistent | null 保留 |
| `dns_tz_match` | bool/null | dns.tzCountryMatch | null 保留 |
| — WebRTC — | | | |
| `rtc_leak` | bool | webrtc.hasWebRtcLeak | |
| `rtc_ipv6_leak` | bool | webrtc.hasIpv6Leak | |
| `rtc_referenced` | bool | webrtc.referenced | false=判定未执行 |
| — Stability — | | | |
| `st_latency` | int/null | stability.overall.latency | ms |
| `st_jitter` | int/null | stability.overall.jitter | ms |
| `st_tls` | int/null | stability.overall.tls | ms，null 保留 |
| `st_loss` | float | stability.overall.loss | % |
| `st_coarse` | bool | stability.coarse | 粗测模式，分析时要分层 |
| — Device — | | | |
| `dev_tz_match` | bool/null | device.tzCountryMatch | |
| `dev_lang_match` | bool/null | device.langCountryMatch | |
| `dev_ua_screen_match` | bool/null | device.uaScreenMatch | |
| — Reachability — | | | |
| `reach_all_ok` | bool | reachability.allOk | |
| `reach_retries` | int | reachability.totalRetries | |

> **null 必须原样存**（用可空列），不能填 0。引擎的核心克制就是"未知≠0"，校准若把 null 当 0 会得出错误结论。

### 2.3 发布结果标签表 `publish_outcome`

主平台已有发布数据。按 `account_hash` 关联，采集检测后一段观察窗内的真实表现。

| 字段 | 类型 | 说明 |
|---|---|---|
| `account_hash` | string | join key |
| `window_start` / `window_end` | timestamp | 观察窗（见下） |
| `posts_count` | int | 窗内发布条数 |
| `median_views` | int | 中位播放量 |
| `zero_play_rate` | float | 0/极低播放占比 |
| `is_shadowbanned` | bool/null | 平台侧限流判定（若有） |
| `label` | enum | **正常 / 限流 / 0播放**（标注结论，见 §3） |
| `label_confidence` | enum | high/med/low（能否排除内容因素） |

**关联规则**：一次检测 → 取该号**检测后 3–7 天**的发布结果（窗口太短没数据，太长掺入其它变量）。检测后如果换了 IP/环境再发，这条样本作废（环境变了，信号快照不再代表发布时环境）——需要平台侧能标记"检测后是否换过环境"。

---

## 3. 标注定义：什么算"环境导致的 0 播放"

**最大的坑：0 播放可能是内容烂，不是环境脏。** 混进来会把校准带偏。排除内容因素的办法（从强到弱）：

1. **同账号对照**：同一个号，环境变化前后播放量的突变，比跨号比较更干净（内容风格相对稳定）。优先用这种样本。
2. **批量新号信号**：一批新号同期注册、发相似内容，只有部分 0 播放 → 更可能是环境差异。
3. **排除明显内容问题**：违规下架、明显低质（时长过短、纯搬运）的先剔除或标 `label_confidence=low`。
4. **限流 vs 0 播放分开标**：
   - `0播放`：连续多条播放量≈0，且非新号冷启动期。
   - `限流`：播放量断崖式低于该号历史基线，或平台有 shadowban 信号。
   - `正常`：播放量在该号历史正常区间。
5. **只用 high/med confidence 样本做权重学习**；low 的仅供探索。

> 标注可先靠规则自动打（基于播放量分布），再人工抽检校正。冷启动期人工标一批"金标准"样本很值。

---

## 4. 校准方法：从简到繁

### 阶段 0（现在·数据=0）：先埋点，别动阈值

引擎和快照表先上线**只采集不改判断**。攒够样本前，`DEFAULT_CONFIG` 不动。目标：几周内攒到几百条带标签样本。

### 阶段 1（几百条）：分层统计——看每个信号到底有没有用

对每个信号，比较它在**坏号（0播放+限流）**和**好号（正常）**上的分布：

- **布尔信号**（isHosting、rtc_leak、tz_match…）：算 2×2 列联表 + 坏号率之比。
  例："机房 IP 的号 0 播放率 62%，非机房 18%" → 机房信号有效，`hostingPenalty=40` 合理；
  若发现"机房 vs 非机房 0 播放率几乎一样" → 这个信号没用，权重该降。
- **数值信号**（latency、jitter、loss…）：画坏号/好号的分布直方图，找**分界点**——坏号明显聚集的阈值就是新的 `low/high`。
  例：坏号延迟中位数 620ms、好号 210ms → 现在的 `latency.low=150/high=800` 可能该收紧。
- **输出**：一张"信号有效性表"——每个信号一个区分度指标（如坏号率之差、AUC）。据此**手工微调** config：砍掉无效信号权重、按数据挪阈值。这一步就能产出 `config-v1`，**不需要任何模型**。

这是投入产出比最高的一步，Zac 最先想看的就是这张表。

### 阶段 2（上千条）：逻辑回归——让数据反推权重和阈值

把"坏号=1/好号=0"作为标签，各信号作为特征，跑**逻辑回归**：

- **特征处理**：布尔直接进；数值先按阈值分桶或标准化；null 单独作一档（保留"未知"语义）。
- **回归系数 → 权重**：系数越大越能预测坏号，按系数重排 `weights` 和各扣分值。
- **决策边界 → tier**：用预测概率画 ROC，选定"判 danger"的阈值，反推 `tiers` 边界。
- **正则化**（L1/L2）防过拟合，样本少时尤其重要。
- **为什么用逻辑回归、不用深模型**：可解释（每个信号贡献看得见，能翻译成中文建议）、样本需求小、系数能直接映射回 config。深模型此阶段是杀鸡用牛刀，且不可解释就没法给用户"改这里"的建议。

### 阶段 3（可选·数据很多以后）：分群校准

不同地区/平台策略可能不同（美区 vs 东南亚阈值未必一样）。数据够时按国家/号型分群，各出一份 config，引擎按 `ip_country` 选对应 config。别过早做——先有一份全局校准版。

---

## 5. 上线机制：版本化 / 灰度 / A/B / 回滚

引擎已经 config 化，这里定"怎么安全换 config"。

- **版本化**：每份 config 有 `version`（如 `v1-logreg-2026Q1`）。评分时把 `configVersion` 写进 `detection_snapshot`——**永远知道某个分是用哪版算的**，这是能做前后对比的前提。config 以 JSON 存版本库/配置中心，不硬编码。
- **灰度**：新 config 先对 x% 流量生效（按 `account_hash` 取模分流）。引擎侧零改动——分流层决定给 `evaluate(results, {config})` 传哪份 config。
- **A/B**：老 config 组 vs 新 config 组，比"被判 danger 的号，后续真实 0 播放率"谁更准（即：新阈值是否更能提前预警）。指标：查准率/查全率、用户按建议改后是否真的改善。
- **回滚**：新 config 表现变差 → 一键切回上一版 version。因为引擎无状态、config 外置，回滚就是改一个版本号指针，秒级生效。
- **前端一致**：前端和后端引用同一份 config（前端可从后端拉当前 version，或打包进 bundle 时带版本），保证小工具和主平台判断**同分同建议**。

---

## 6. 冷启动：真实数据还不够时怎么办

1. **先上采集、不改判断**（阶段 0）——用 `DEFAULT_CONFIG` 顶着，同时攒样本。经验值虽未校准，但方向大体对（机房 IP 差、泄漏差，这是常识），不至于误导。
2. **借外部先验**：机房 IP、WebRTC 泄漏、DNS 劫持这些是行业公认强信号，先验很强，可信度高；国家白名单、具体延迟阈值先验弱，标注"实验性"，界面上语气放软（"可能影响"而非"一定")。
3. **专家标注金标准集**：人工挑几十个明确的好/坏环境样本，先做一版粗校准和回归测试基线。
4. **单信号先行**：不必等全部信号都够样本。哪个信号先攒够（比如 isHosting 布尔信号最快），就先校准它，局部替换 config 里那一项。
5. **主动制造样本**：内部/种子用户用不同环境（住宅 vs 机房、匹配 vs 不匹配时区）各发一批标准内容，快速拿到高质量对照样本，加速冷启动。

---

## 7. 给 Zac 的最短落地路径

1. 建 `detection_snapshot` + `publish_outcome` 两张表，引擎接入即写快照（含 `configVersion`）。**本周能做。**
2. 攒 2–4 周样本 → 出「信号有效性表」（阶段 1，纯统计）。**这是第一个能拿数据说话的产物。**
3. 据表手工调出 `config-v1`，灰度 10% → A/B → 全量。
4. 样本上千后再上逻辑回归出 `config-v2`。

**每一步都不推倒重来**：引擎不动，只换 config、只加数据。
