# 小白兔TKNC

针对 TikTok 网络环境的移动端体检工具。30–60 秒输出一份 0–100 分的体检报告 + 具体改进建议。

## 模块

| # | 模块 | 检测内容 | 实现方式 |
|---|---|---|---|
| 1 | IP 身份 | 国家/城市/ASN/机房 IP/风险评分 | 云函数聚合 ipinfo.io、ip-api.com、scamalytics |
| 2 | DNS（降级版） | DoH 双源对比 + 时区/IP 国家交叉校验 | 浏览器侧（不含权威 DNS 服务器） |
| 3 | WebRTC / IPv6 泄漏 | ICE 候选解析 + IPv6 直连探测 | 浏览器侧 RTCPeerConnection |
| 4 | 网络稳定性 | 30 秒持续采样 TikTok 5 个域名 | PerformanceObserver + fetch no-cors |
| 5 | 设备一致性 | 时区/语言/Canvas/WebGL/UA | 浏览器侧 |
| 6 | TikTok 可达性 | 3 次 fetch 重试 | 浏览器侧 |

## 部署

需要安装 [Tencent CloudBase CLI](https://docs.cloudbase.net/cli-v1/intro)：

```bash
npm install -g @cloudbase/cli
tcb login
```

设置 CloudBase 环境 ID（编辑 `cloudbaserc.json` 中的 `envId`），然后：

```bash
# 设置云函数环境变量（API keys）
tcb fn config update ipinfo --envId YOUR_ENV_ID --envParams "IPINFO_TOKEN=xxx"

# 一键部署
tcb framework deploy
```

或分别部署：

```bash
tcb fn deploy ipinfo saveReport getReport cleanupReports
tcb hosting deploy ./public -e YOUR_ENV_ID
```

## 本地预览

```bash
cd public
python3 -m http.server 8080
# 浏览器访问 http://localhost:8080
```

注意：本地预览时云函数调用会失败（除非通过 `tcb fn invoke` 本地模拟）。模块 2-6 不依赖云函数，可独立测试。

## 环境变量

云函数 `ipinfo` 需要以下环境变量（在 CloudBase 控制台设置）：

- `IPINFO_TOKEN`：[ipinfo.io](https://ipinfo.io) 的 API token（免费档 50k/月）
- `SCAMALYTICS_KEY`（可选）：[scamalytics.com](https://scamalytics.com) 的 API key

## 隐私

- 不存储用户原始公网 IP
- 不存储 WebRTC 泄漏的真实 IP
- 不存储 Canvas 指纹原始 dataURL（仅 SHA-256 哈希）
- 分享报告 7 天后自动删除

## 已知限制（MVP）

- DNS 泄漏检测是降级版（仅 DoH 跨源对比 + 时区交叉校验）。完整版需自建权威 DNS 服务器
- 网络稳定性测试从用户当前网络发起，无多区节点对比
- 部分 TikTok 域名可能 CORS 阻断，依赖 Performance API 隐式计时
