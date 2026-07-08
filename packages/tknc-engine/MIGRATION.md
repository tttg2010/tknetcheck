# 前端迁移到 @tknc/engine

本次只做**抽取**，没有动 `public/app` 下的引用（避免顺手改乱前端）。下面是把前端切到共享引擎的步骤，判断结果保证等价（有 `test/smoke.test.js` 锁死）。

## 现状

`public/app/scoring.js` 和 `public/app/recommendations.js` 是**判断逻辑的复制源**。引擎从它们逐字抽取而来，行为一致，只多了 config 参数化。

## 目标

前端不再维护两份判断逻辑，改成 import 引擎。采集层（`public/app/modules/*.js`）**保持不动**——那是平台相关的探测代码，不抽取。

## 改法（三选一）

### 方案 A（推荐·最干净）：前端直接 import 引擎

`public/app/app.js` 里把：

```js
import { scoreIp, scoreDns, /* ... */ overall, tierOf } from './scoring.js';
import { buildRecommendations } from './recommendations.js';
```

换成引擎的门面：

```js
import { evaluate } from '../../packages/tknc-engine/src/index.js';
```

然后把 `runAllModules()` 结尾那段手工逐模块打分：

```js
state.scores.ip = scoreIp(ipResult);
// ... 其余模块
state.scores.overall = overall(state.scores);
state.recommendations = buildRecommendations(state.results, state.scores);
```

替换为一次调用（在所有模块 result 都 ready 后）：

```js
const report = evaluate(state.results);
state.scores = report.scores;               // 含 overall
state.recommendations = report.recommendations;
```

> 注意：进度条上"每个模块跑完就点亮 ok/warn/fail"的即时反馈，仍需要单模块分数。这时保留 `import { scoreIp, ... } from '../../packages/tknc-engine/src/scoring.js'` + `import { resolveConfig } from '.../index.js'`，即时用 `scoreIp(r, resolveConfig())`，最后用 `evaluate` 出总报告即可。两者结果一致。

`share.html` / `report.js` 里若引用了 `tierOf`，同样从引擎 import：`import { tierOf, resolveConfig } from '.../index.js'` → `tierOf(score, resolveConfig())`。

### 方案 B（保守）：让旧文件转发到引擎

保留 `public/app/scoring.js` 文件名不变，把内容改成 re-export，前端其它文件一行都不用动：

```js
// public/app/scoring.js
import { resolveConfig, scoreIp as _ip, /* ... */ } from '../../packages/tknc-engine/src/index.js';
const C = resolveConfig();
export const scoreIp = (r) => _ip(r, C);
// ... 其余同理；overall/tierOf 同理包一层默认 config
```

好处：改动面最小、可灰度。坏处：多一层包装。

### 方案 C：构建期打包

若前端将来上打包器（Vite/esbuild），把 `@tknc/engine` 作为本地 workspace 依赖引用，import 路径写成 `@tknc/engine` 而非相对路径。

## 验证

改完跑一遍真实检测，对比改动前后同一环境的总分与建议列表应完全一致。引擎侧已有：

```bash
cd packages/tknc-engine && npm test
```

## 关于浏览器直接 import 相对路径

引擎是纯 ESM、零依赖、不碰任何浏览器/Node 专有 API，浏览器 `<script type="module">` 可直接 import `packages/tknc-engine/src/index.js`。CloudBase 静态托管把 `packages/` 一起部署即可（或在方案 C 里打包进 bundle）。
