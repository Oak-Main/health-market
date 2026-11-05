#!/usr/bin/env bash
# Build a complete CMS release beside public/ so promotion stays on one filesystem.
set -euo pipefail
cd "$(dirname "$0")/.."
year=${PLAN_YEAR:-2026}
export NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=6500}
work=$(mktemp -d .benchmark-refresh.XXXXXX)
lock=.benchmark-refresh.lock
if ! mkdir "$lock"; then
  rmdir "$work"
  echo 'Another benchmark refresh owns the project lock.' >&2
  exit 1
fi
cleanup() {
  if [[ -d "$work/previous" && ! -e public/data ]]; then
    mv -- "$work/previous" public/data || { echo "Prior data retained in $work/previous" >&2; return 1; }
  fi
  rm -rf -- "$work"
  rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
node --import tsx src/etl/run.ts "--plan-year=$year" "--out=$work/staged"
node --import tsx src/etl/verify.ts "$work/staged" "$year"
if [[ -e public/data ]]; then mv -- public/data "$work/previous"; fi
mv -- "$work/staged" public/data
