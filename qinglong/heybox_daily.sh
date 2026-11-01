#!/usr/bin/env sh
# Pure QingLong entrypoint. Build and task execution share the same lock.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
MODE=${1:-run}
case "$MODE" in
  run|check) ;;
  --inside-lock)
    shift
    MODE=${1:-run}
    case "$MODE" in run|check) ;; *) echo '任务模式只能是 run 或 check' >&2; exit 2 ;; esac
    ;;
  *) echo '任务模式只能是 run 或 check' >&2; exit 2 ;;
esac
# Lock the build as well as daily tasks to prevent parallel dependency installs.
if [ "${1:-}" != '--inside-lock' ] && command -v flock >/dev/null 2>&1; then
  LOCK_DIR=${HEYBOX_QL_LOCK_DIR:-${QL_DIR:-/ql/data}/heybox-daily}
  mkdir -p "$LOCK_DIR"
  exec flock -n "$LOCK_DIR/run.lock" sh "$ROOT/qinglong/heybox_daily.sh" --inside-lock "$MODE"
fi
if ! command -v node >/dev/null 2>&1; then
  echo '需要 Node.js 24 或更新版本' >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "当前 Node.js 为 $(node --version)，项目要求 Node.js >= 24" >&2
  exit 1
fi
NEEDS_BUILD=0
if [ ! -f dist/cli.js ]; then
  NEEDS_BUILD=1
elif [ -n "$(find src -type f -name '*.ts' -newer dist/cli.js -print -quit)" ] || [ package.json -nt dist/cli.js ]; then
  NEEDS_BUILD=1
fi
if [ "$NEEDS_BUILD" -eq 1 ]; then
  echo '正在初始化或更新 Heybox Daily 核心程序…'
  if command -v pnpm >/dev/null 2>&1 && [ "$(pnpm --version)" = '12.15.0' ]; then
    pnpm install --filter heybox-daily --frozen-lockfile --ignore-scripts
    pnpm build
  elif command -v npm >/dev/null 2>&1; then
    npm exec --yes --package=pnpm@12.15.0 -- pnpm install --filter heybox-daily --frozen-lockfile --ignore-scripts
    npm exec --yes --package=pnpm@12.15.0 -- pnpm build
  else
    echo '缺少 pnpm 和 npm，无法构建 TypeScript 核心' >&2
    exit 1
  fi
fi
exec node qinglong/heybox_daily.mjs "$MODE"
