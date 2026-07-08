# netcheck-api — 自托管后端

替代原 CloudBase 云函数。站点和后端在同一台服务器，浏览器**同源**调用 `/api/*`，
无跨域(CORS)、无 quota、零第三方依赖（仅 Node 20 内置模块 + 全局 fetch）。

## 路由（POST，body 为 JSON）

| 路由 | 入参 | 返回 |
|---|---|---|
| `/ipinfo` | `{ ip? }`（不传则用 CF-Connecting-IP） | `{ code:0, data:{ country,city,asn,org,isHosting,isProxy,isMobile,isResidential,riskScore,... } }` |
| `/saveReport` | `{ report }` | `{ code:0, shareId, expiresAt }` |
| `/getReport` | `{ shareId }` | `{ code:0, report, ... }` / `{ code:404\|410 }` |

数据源：**ip-api.com**（免 key，给出国家/城市/ASN/机房/代理/移动/住宅）为主；
`IPINFO_TOKEN` 设了则叠加 ipinfo.io；scamalytics 设了账号则给风险分。
分享报告存 `STORE_DIR`（本地文件，7 天过期，进程内每 6h 清理）。

## 部署（服务器）

```bash
# 1) 放代码
mkdir -p /opt/netcheck-api /var/lib/netcheck/reports
cp server.js /opt/netcheck-api/server.js

# 2) systemd 常驻（按需在 unit 里填 IPINFO_TOKEN）
cp netcheck-api.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now netcheck-api
curl -s http://127.0.0.1:8096/health   # {"ok":true,...}

# 3) nginx：在站点 443 server 块内反代 /api/ → 本机服务
#    location /api/ {
#        proxy_pass http://127.0.0.1:8096/;
#        proxy_http_version 1.1;
#        proxy_set_header Host $host;
#        proxy_set_header X-Real-IP $remote_addr;
#        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
#        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
#        proxy_read_timeout 20s;
#    }
nginx -t && systemctl reload nginx
```

前端 `public/app/api.js` 默认打到同源 `/api`（可用 `window.__API_BASE__` 覆盖）。
