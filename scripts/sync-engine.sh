#!/usr/bin/env bash
# 同步判断引擎源码 packages/tknc-engine/src → public/app/engine
#
# 为什么要复制而不是相对 import：
#   CloudBase Hosting 只部署 ./public 目录，部署后 public 里的代码无法 import
#   到 ../../packages（会 404）。所以把引擎源"复制"进 public，前端直接 import
#   本地副本。事实源仍是 packages/tknc-engine（smoke test 跑那份），public 只是它的镜像。
#
# 用法：
#   bash scripts/sync-engine.sh          # 复制/更新 public 副本
#   bash scripts/sync-engine.sh --check  # 只校验是否漂移（CI / 提交前用），漂移则退出码 1
#
# 每个副本文件顶部注入一行来源横幅，提醒"勿手改，改事实源后重跑本脚本"。
# 校验时会先剥掉横幅再和事实源逐字 diff，横幅本身不算漂移。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/tknc-engine/src"
DST="$ROOT/public/app/engine"
FILES=(index.js scoring.js recommendations.js math.js thresholds.js)

BANNER_PREFIX="// [GENERATED] 源自 packages/tknc-engine/src/"
BANNER_SUFFIX=" —— 勿手改；改事实源后运行 bash scripts/sync-engine.sh 同步。"

banner_for() {
  echo "${BANNER_PREFIX}${1}${BANNER_SUFFIX}"
}

check_mode=false
[ "${1:-}" = "--check" ] && check_mode=true

fail=0
for f in "${FILES[@]}"; do
  src_file="$SRC/$f"
  dst_file="$DST/$f"
  if [ ! -f "$src_file" ]; then
    echo "✗ 事实源缺失: $src_file" >&2
    exit 2
  fi

  if $check_mode; then
    if [ ! -f "$dst_file" ]; then
      echo "✗ 漂移：public 副本缺失 $f" >&2
      fail=1
      continue
    fi
    # 剥掉副本第 1 行横幅，与事实源逐字比对
    if ! diff -q <(tail -n +2 "$dst_file") "$src_file" >/dev/null; then
      echo "✗ 漂移：$f 与事实源不一致" >&2
      fail=1
    fi
  else
    mkdir -p "$DST"
    { banner_for "$f"; cat "$src_file"; } > "$dst_file"
    echo "✓ 同步 $f"
  fi
done

if $check_mode; then
  if [ "$fail" -eq 0 ]; then
    echo "✓ public/app/engine 与事实源一致，无漂移。"
  else
    echo "" >&2
    echo "引擎副本已漂移。运行： bash scripts/sync-engine.sh" >&2
    exit 1
  fi
else
  echo "✓ 引擎已同步到 public/app/engine（$(echo "${FILES[@]}" | wc -w | tr -d ' ') 个文件）"
fi
