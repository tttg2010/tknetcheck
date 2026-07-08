# 小白兔TKNC 逐项报告内容规格（原版信息密度还原）

> 目的：新原型两版都把"逐项报告"砍成了每模块两行空泛结论（如"当前使用商业住宅IP，质量良好"），干货全丢了。
> 本规格从原版渲染代码（`public/app/ui/report.js` + `public/app/modules/*.js` + `public/app/recommendations.js`）逆向提取，
> 明确**每个模块在报告里到底渲染哪些字段行**，并给出一套完整假数据 JSON。Nina 重建原型时照此还原，接真引擎时数据形状不用改。
>
> 数据来源对照：每模块的 `result` 对象来自 `public/app/modules/<name>.js` 的 return；分数来自 `public/app/scoring.js`；建议来自 `public/app/recommendations.js`。

---

## 0. 报告顶层结构

原版 `renderReport(rootEl, payload)` 接收 `payload = { scores, results, recommendations, meta }`。

- **总分环**：`scores.overall`（0–100）→ 环形进度 + tier class。
- **档位（tierOf）**：`>=90 excellent` / `>=70 good` / `>=50 warning` / `<50 danger`。
- **档位标签**（`t.tier[tier]`）：优秀·可放心养号发布 / 良好·建议优化少数项 / 警告·存在风险，不建议发布新视频 / 危险·严重问题，立即停止使用。
- **金句 verdict**（`t.verdict[tier]`，截图用大字）：如 good = "网络环境良好，优化几项就能起飞 ✨"。
- **meta 行**：检测时间 / 版本等一句话。
- **6 个模块 section**，固定顺序：`ip → dns → webrtc → stability → device → reachability`。

每个 section 由三块组成（`buildSection`）：
1. **section-head**：icon + 模块名 + 右侧子分数徽章（`.sub-score.tier-*`）。
2. **findings 列表**（`buildFindings`）：一组带状态标记的字段行，这是**信息密度的核心**，每行一个 marker（✓ ok / ! warn / ✕ danger / ℹ info）+ 一句话事实。
3. **KV / 表格**（`buildKV`）：目前仅 stability 有逐域名表格。
4. **recs**（可选）：命中本模块的建议卡片（`<h5>建议</h5>` + 有序列表，每条 `<strong>title</strong> — body`）。

模块图标：`🌐 IP身份 / 🧭 DNS / 🛰️ WebRTC / 📈 稳定性 / 📱 设备 / 🎯 可达性`。

---

## 1. 逐模块内容清单（原版 findings 逐行还原）

下面每一行 = findings 列表里的一个 `<li>`。marker 列是状态点颜色规则；"取值来源"是 result 对象的字段。**不要概括，逐行渲染。**

### 1.1 🌐 IP 身份（`results.ip`，权重 25）

| 行 | 内容模板 | marker 规则 | 取值来源 |
|---|---|---|---|
| 地理位置 | `{countryName/country} · {city}` | info | `countryName`,`country`,`city` |
| 运营商/机构 | `{org 或 asn}` | info | `org`(即 ISP/机构),`asn` |
| 机房判定 | `机房 / IDC IP` 或 `非机房 IP` | isHosting → danger，否则 ok | `isHosting` |
| 代理标记 | `在风险库中被标记为代理` 或 `未被标记为代理` | isProxy → warn，否则 ok | `isProxy` |
| 风险评分 | `风险评分 {riskScore}/100` | ≥75 danger / ≥25 warn / else ok | `riskScore` |

> 补充可展示字段（原版 result 里有、findings 未全用，重建时建议在展开态补上以提密度）：`ip`（公网/代理 IP）、`region`、`isMobile`（移动网络）、`isResidential`（住宅）。类型标签建议合成一个"IP 类型"胶囊：住宅 / 机房 / 代理 / 移动。

### 1.2 🧭 DNS 降级版（`results.dns`，权重 15）

| 行 | 内容模板 | marker 规则 | 取值来源 |
|---|---|---|---|
| DoH 双源可达性 | `DoH 双源可达（Google + Cloudflare）` / `仅 {X} DoH 可达，另一家被屏蔽` / `Google / Cloudflare DoH 均不可达，可能被网络层过滤` | 双可达 ok / 单可达 warn / 全不可达 danger | `bothDohReachable`,`googleReachable`,`cloudflareReachable` |
| 非CDN基准一致性 | `{baselineTarget} 双源解析一致（非 CDN 基准）` / `... 双源解析不一致 — 疑似 DNS 劫持` | 一致 ok / 不一致 danger（null 时不渲染此行） | `baselineConsistent`,`baselineTarget` |
| 时区↔IP国家 | `时区与 IP 国家一致` / `时区与 IP 国家不一致` / `时区交叉校验：未执行（IP 国家未知）` | true ok / false danger / null-info | `tzCountryMatch`,`ipCountryKnown` |
| TikTok CDN 节点数 | `{target} 解析到 {N} 个 CDN 节点（CDN 多节点为正常）` | info | `tiktokGoogleIps`+`tiktokCloudflareIps` 合并计数 |
| 降级说明 | `完整 DNS 泄漏检测需付费版` | info | 固定文案 |

> 展开态密度增强：把 `tiktokGoogleIps` / `tiktokCloudflareIps` / `baselineGoogleIps` / `baselineCloudflareIps` 四个**真实 IP 列表**列出来（Google 对 tiktok 的解析 IP、Cloudflare 对 tiktok 的解析 IP、两家对 example.com 的解析 IP）。这正是用户说的"每个模块有具体字段明细"——原报告能看到解析出的实际 IP。

### 1.3 🛰️ WebRTC / IPv6 泄漏（`results.webrtc`，权重 15）

| 行 | 内容模板 | marker 规则 | 取值来源 |
|---|---|---|---|
| srflx 采集/泄漏判定 | 有基准：`WebRTC 公网 IP 泄漏` / `无 WebRTC 公网 IP 泄漏`；无基准：`WebRTC 探测完成（采集到 {N} 个公网候选）` + `泄漏判定：未执行（缺少 IP 基准，需先完成模块 1）` | 泄漏 danger / 不泄漏 ok / 未执行 info | `referenced`,`hasWebRtcLeak`,`srflxIps` |
| IPv6 直连 | `检测到 IPv6 直连` / `未检测到 IPv6` | 检测到 warn，否则 ok | `ipv6Detected` |
| 内网 IP 暴露 | `暴露内网 IP：{N} 个` / `内网 IP 已被浏览器匿名化` | 有暴露 info / 匿名化 ok | `realLocalIps` |

> 展开态密度增强：列出 `srflxIps`（STUN 看到的公网候选 IP，与 `referenceIp` 对比）、`ipv6Address`（真实 IPv6 地址）、`hostCandidates`（含 mDNS `.local` 候选）。

### 1.4 📈 网络稳定性（`results.stability`，权重 25）

findings（基于 `overall` 汇总）：

| 行 | 内容模板 | marker 规则 | 取值来源 |
|---|---|---|---|
| 平均延迟 | `平均延迟 {latency}ms` | ≤300 ok / ≤500 warn / else danger | `overall.latency` |
| 抖动 | `抖动 {jitter}ms` | ≤50 ok / ≤100 warn / else danger | `overall.jitter` |
| 丢包率 | `丢包率 {loss}%` | ≤1 ok / ≤3 warn / else danger | `overall.loss` |
| TLS 握手 | `TLS 握手 {tls}ms` 或 `TLS 握手时间：未测量（浏览器未暴露 Timing-Allow-Origin）` | ≤400 ok / ≤700 warn / else danger；null → info | `overall.tls` |
| 粗略模式 | `浏览器粗略模式（Performance API 未暴露 Timing-Allow-Origin）` | info（仅 coarse=true 时） | `coarse` |

**逐域名表格（`buildKV`，stability 独有，`.target-table`）**——每个 TikTok 相关域名一行：

| 主机(host) | 延迟(latency ms) | 抖动(jitter ms) | TLS(tls ms 或 −) | 丢包(loss %) | 协议(protocols) |
|---|---|---|---|---|---|

数据来源：`perTarget[]`（每项含 `host,latency,jitter,tls,dns,tcp,loss,expected,received,coarse,protocols`）。默认表格用 host/latency/jitter/tls/loss/protocols 六列；展开态可加 dns/tcp/expected/received。5 个目标域名固定：www.tiktok.com、api16-normal-useast5.tiktokv.com、v16-webapp.tiktok.com、p16-sign-va.tiktokcdn.com、mon.tiktokv.com。

### 1.5 📱 设备一致性（`results.device`，权重 10）

| 行 | 内容模板 | marker 规则 | 取值来源 |
|---|---|---|---|
| 时区交叉校验 | `时区与 IP 国家一致：{timezone}` / `时区与 IP 国家不一致：{timezone} vs {ipCountry}` / `时区：{timezone}（未与 IP 国家交叉校验：IP 信息缺失）` | true ok / false danger / null-info | `tzCountryMatch`,`timezone`,`ipCountry` |
| 语言交叉校验 | `语言与 IP 国家一致：{language}` / `语言与 IP 国家不一致：{language} vs {ipCountry}` / `语言：{language}（...）` | true ok / false warn / null-info | `langCountryMatch`,`language` |
| UA↔屏幕 | `屏幕：{w}×{h}` / `屏幕：{w}×{h}（与 UA 不匹配）` | 匹配 ok / 不匹配 warn | `uaScreenMatch`,`screen` |
| GPU/WebGL | `GPU：{webglRenderer(前80字符)}` | info | `webglRenderer` |

> 三项交叉校验 = 时区、语言、UA↔屏幕。展开态密度增强（原 result 里有的指纹字段，重建时应列出）：`ua`（完整 UA）、`platform`、`languages`（语言列表）、`cores`(CPU 核数)、`memory`(内存 GB)、`connType`(网络类型)、`screen.colorDepth`/`devicePixelRatio`、`canvasHash`(Canvas 指纹哈希)、`webglRenderer`(WebGL 完整串)。这些哈希/指纹字段正是"字段明细"的干货。

### 1.6 🎯 TikTok 可达性（`results.reachability`，权重 10）

findings——每个探针一行（`probes[]`，3 个：site/api/cdn）：

| 行 | 内容模板 | marker 规则 | 取值来源 |
|---|---|---|---|
| 每探针状态 | `{host}：成功（一次过 或 {attempts} 次）` / `{host}：失败（{attempts} 次后放弃）` | ok → ok / 失败 → danger | `probes[].ok`,`.host`,`.attempts` |

> 展开态密度增强：每探针加 `kind`(site/api/cdn)、`firstAttemptMs`(首次尝试耗时 ms)、`lastError`；汇总行 `successes/totalProbes`、`totalRetries`。原报告能看到 3 个探针各自的状态和耗时。

---

## 2. 完整假数据 JSON（总分 88 / 良好档）

> 直接把 `PAYLOAD` 塞进 `renderReport(rootEl, PAYLOAD)` 即可渲染满字段的报告。
> 形状 = `{ scores, results, recommendations, meta }`；`results.<module>` 完全对齐各模块 return 的 result 对象；`recommendations` 里的文案逐字取自 `recommendations.js`。

```json
{
  "meta": "检测于 2026-07-08 21:14 · 6 项全测 · MVP v0.9",
  "scores": {
    "overall": 88,
    "ip": 90,
    "dns": 85,
    "webrtc": 100,
    "stability": 82,
    "device": 90,
    "reachability": 90
  },
  "results": {
    "ip": {
      "ok": true,
      "durationMs": 1180,
      "ip": "24.60.183.47",
      "country": "US",
      "countryName": "United States",
      "city": "Boston",
      "region": "Massachusetts",
      "asn": "AS7922",
      "org": "AS7922 Comcast Cable Communications",
      "isHosting": false,
      "isProxy": false,
      "isMobile": false,
      "isResidential": true,
      "riskScore": 12,
      "raw": null
    },
    "dns": {
      "ok": true,
      "durationMs": 940,
      "target": "www.tiktok.com",
      "baselineTarget": "example.com",
      "tiktokGoogleIps": ["23.211.145.36", "23.211.145.51"],
      "tiktokCloudflareIps": ["23.62.126.19", "23.62.126.42"],
      "googleReachable": true,
      "cloudflareReachable": true,
      "bothDohReachable": true,
      "dohWorked": true,
      "baselineGoogleIps": ["93.184.216.34"],
      "baselineCloudflareIps": ["93.184.216.34"],
      "baselineConsistent": true,
      "timezone": "America/New_York",
      "ipCountry": "US",
      "ipCountryName": "United States",
      "ipCountryKnown": true,
      "tzCountryMatch": true,
      "degraded": true
    },
    "webrtc": {
      "ok": true,
      "durationMs": 3210,
      "referenced": true,
      "referenceIp": "24.60.183.47",
      "srflxIps": ["24.60.183.47"],
      "hostCandidates": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890.local"],
      "realLocalIps": [],
      "hasWebRtcLeak": false,
      "ipv6Detected": false,
      "ipv6Address": "",
      "hasIpv6Leak": false
    },
    "stability": {
      "ok": true,
      "durationMs": 30480,
      "totalMs": 30000,
      "coarse": false,
      "overall": {
        "latency": 214,
        "jitter": 38,
        "tls": 128,
        "loss": 0.8
      },
      "perTarget": [
        { "host": "www.tiktok.com",                    "latency": 168, "jitter": 22, "tls": 96,  "dns": 14, "tcp": 41, "loss": 0.0, "expected": 30, "received": 30, "coarse": false, "protocols": ["h2"] },
        { "host": "api16-normal-useast5.tiktokv.com",  "latency": 243, "jitter": 51, "tls": 152, "dns": 19, "tcp": 58, "loss": 3.3, "expected": 30, "received": 29, "coarse": false, "protocols": ["h2"] },
        { "host": "v16-webapp.tiktok.com",             "latency": 201, "jitter": 34, "tls": 118, "dns": 12, "tcp": 47, "loss": 0.0, "expected": 30, "received": 30, "coarse": false, "protocols": ["h2"] },
        { "host": "p16-sign-va.tiktokcdn.com",         "latency": 189, "jitter": 29, "tls": 104, "dns": 11, "tcp": 44, "loss": 0.0, "expected": 30, "received": 30, "coarse": false, "protocols": ["h2","h3"] },
        { "host": "mon.tiktokv.com",                   "latency": 269, "jitter": 54, "tls": 170, "dns": 21, "tcp": 63, "loss": 0.0, "expected": 30, "received": 30, "coarse": false, "protocols": ["h2"] }
      ]
    },
    "device": {
      "ok": true,
      "durationMs": 62,
      "timezone": "America/New_York",
      "language": "en-us",
      "languages": ["en-us", "en"],
      "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "platform": "iPhone",
      "cores": 6,
      "memory": 4,
      "connType": "4g",
      "screen": { "w": 390, "h": 844, "colorDepth": 24, "devicePixelRatio": 3 },
      "canvasHash": "8f3a2c9d5e1b7a04f6c8d2e9b0a1c3f5d7e8b2a4c6f9d1e3b5a7c9f0d2e4b6a8c",
      "webglRenderer": "Apple GPU (Apple, Metal, Apple A17 Pro)",
      "ipCountry": "US",
      "tzCountryMatch": true,
      "langCountryMatch": true,
      "uaScreenMatch": true
    },
    "reachability": {
      "ok": true,
      "durationMs": 2870,
      "totalProbes": 3,
      "successes": 3,
      "totalRetries": 1,
      "allOk": true,
      "probes": [
        { "kind": "site", "host": "www.tiktok.com",                   "ok": true, "attempts": 1, "firstAttemptMs": 342, "lastError": "" },
        { "kind": "api",  "host": "api16-normal-useast5.tiktokv.com", "ok": true, "attempts": 2, "firstAttemptMs": 8000, "lastError": "" },
        { "kind": "cdn",  "host": "p16-sign-va.tiktokcdn.com",        "ok": true, "attempts": 1, "firstAttemptMs": 288, "lastError": "" }
      ]
    }
  },
  "recommendations": [
    {
      "severity": "warn",
      "title": "部分域名需要重试（1 次）",
      "body": "连接 TikTok 域名时偶发失败。说明代理稳定性不足，可能影响视频上传与发布。"
    },
    {
      "severity": "warn",
      "title": "抖动偏高（54ms）",
      "body": "延迟波动过大会导致视频播放断断续续。建议检查软路由/分流策略，避免与下载等大流量任务共用线路。"
    },
    {
      "severity": "info",
      "title": "完整 DNS 检测需付费版",
      "body": "MVP 版仅做 DoH 可达性 + 非 CDN 基准对比 + 时区交叉校验。完整的 DNS 泄漏检测需要使用付费版工具（自建权威 DNS 服务器）。"
    }
  ]
}
```

> 说明：这套数据是"良好档"的典型样貌——IP 是干净住宅 IP（Comcast，风险 12），DNS 双源一致、时区匹配，WebRTC 无泄漏，稳定性整体不错但 api/mon 两个域名抖动偏高、api 有一次重试，可达性全通但 api 重试过一次。三条建议（2 warn + 1 info）刚好落到 stability 和 reachability 上，与 findings 呼应。接真引擎时字段名一一对应，渲染层零改动。

---

## 3. 展示层级建议（单页三态原型的报告态）

原版是**全量平铺**：6 个 section 依次铺开，所有 findings + stability 表格 + 建议全部一次性可见，信息密度极高但很长。新原型可以在**不丢任何字段**的前提下做折叠：

### 报告态默认（收起）
- 顶部：总分环 + 档位标签 + verdict 金句 + meta（保持不变，这是截图核心）。
- 6 个模块**卡片默认收起**，每张卡片默认展示：
  - 模块 icon + 名称 + 右侧子分数徽章（`.sub-score.tier-*`）。
  - **一个整体状态点**（该模块 findings 里最差 severity：任一 danger→红点，否则任一 warn→黄点，否则绿点）。
  - **一行摘要**：取该模块 findings 里最关键的一条（如 IP 卡"美国 · Boston · Comcast 住宅IP"、稳定性卡"平均延迟 214ms · 丢包 0.8%"）。
  - 若该模块有建议，标一个"N 条建议"角标。

### 展开后（点击卡片）
展开即还原**原版该模块的全部内容**，一条不少：
1. 完整 findings 列表（第 1 节列的每一行，带 marker 状态点）。
2. 该模块的明细字段（第 1 节各模块"展开态密度增强"列的字段：IP 类型/region、DNS 的解析 IP 列表、WebRTC 的 srflx/IPv6 地址、设备的 UA/指纹哈希、可达性每探针耗时）。
3. stability 卡展开时渲染逐域名 `.target-table`。
4. 该模块的建议卡片（`.recs`：`<h5>建议</h5>` + 有序列表）。

### 原则
- **收起 = 扫一眼看健康度；展开 = 看医生级明细。** 用户点名"逐项报告不如以前好"，核心是展开态必须把字段明细（尤其是具体 IP、延迟 ms、指纹哈希、每探针耗时）全部还原，不能只留两行结论。
- 建议默认可以在顶部再聚合一个"关键问题 Top 3"卡（`topIssues(recs,3)`，按 danger>warn>info 排序），既给概览又不影响各模块内展开看细节。
- 可复用的现成 CSS class：`.section`/`.section-head`/`.sub-score.tier-*`/`.findings`(含 `.marker.ok/warn/danger/info`)/`.target-table`/`.recs`/`.verdict-line`。Nina 重建时直接沿用这套视觉组件即可。
