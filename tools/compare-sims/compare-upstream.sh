#!/bin/bash
# Builds upstream and this checkout (including uncommitted changes), then plays the same
# seeded random battles on both and reports the first line where each battle's log differs.
# usage: tools/compare-sims/compare-upstream.sh [battles per format, default 60]
#   UPSTREAM_REF  upstream commit to compare against (default: where HEAD branched off origin/master)
#   UPSTREAM_DIR  where to keep the upstream worktree (default: ~/.cache/pokemon-showdown-upstream)
# Exits 1 if any battle differs.
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
ref=${UPSTREAM_REF:-$(git -C "$repo" merge-base HEAD origin/master)}
dir=${UPSTREAM_DIR:-$HOME/.cache/pokemon-showdown-upstream}
if [ ! -e "$dir/.git" ]; then
	git -C "$repo" worktree add --detach -q "$dir" "$ref"
	ln -s "$repo/node_modules" "$dir/node_modules"
else
	git -C "$dir" checkout --detach -q "$ref"
fi
build() {
	local out
	out=$(cd "$1" && node build 2>&1) || { echo "$out"; echo "build failed in $1"; exit 1; }
}
build "$dir"
build "$repo"
echo "A upstream $(git -C "$dir" log -1 --format='%h %s')"
echo "B ours     $(git -C "$repo" log -1 --format='%h %s')$(git -C "$repo" diff --quiet HEAD -- sim data lib || echo ' (with uncommitted changes)')"
node "$repo/tools/compare-sims/compare-sims.js" "$dir" "$repo" "${1:-60}"
