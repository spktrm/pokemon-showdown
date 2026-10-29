#!/bin/bash
# Builds upstream and our checkout, then plays the same seeded random battles on both and
# reports the first line where each battle's log differs.
# usage: tools/compare-sims/compare-upstream.sh [compare-sims.js options, like --suite core or --battles 10]
#   OURS_REF      our commit to check (default: this checkout, including uncommitted changes)
#   OURS_DIR      where to keep the worktree for OURS_REF (default: ~/.cache/pokemon-showdown-ours)
#   UPSTREAM_REF  upstream commit to compare against (default: where ours branched off origin/master)
#   UPSTREAM_DIR  where to keep the upstream worktree (default: ~/.cache/pokemon-showdown-upstream)
# Exits 1 if any battle differs.
set -euo pipefail
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)

# checks out a commit in a worktree that's kept between runs
worktree() {
	if [ ! -e "$1/.git" ]; then
		git -C "$repo" worktree add --detach -q "$1" "$2"
		ln -s "$repo/node_modules" "$1/node_modules"
	else
		git -C "$1" checkout --detach -q "$2"
	fi
}
build() {
	local out
	out=$(cd "$1" && node build 2>&1) || { echo "$out"; echo "build failed in $1"; exit 1; }
}

if [ -n "${OURS_REF:-}" ]; then
	ours=${OURS_DIR:-$HOME/.cache/pokemon-showdown-ours}
	worktree "$ours" "$OURS_REF"
	changes=''
else
	ours=$repo
	changes=$(git -C "$repo" diff --quiet HEAD -- sim data lib config || echo ' (with uncommitted changes)')
fi
upstream=${UPSTREAM_DIR:-$HOME/.cache/pokemon-showdown-upstream}
worktree "$upstream" "${UPSTREAM_REF:-$(git -C "$repo" merge-base "${OURS_REF:-HEAD}" origin/master)}"
build "$upstream"
build "$ours"
echo "A upstream $(git -C "$upstream" log -1 --format='%h %s')"
echo "B ours     $(git -C "$ours" log -1 --format='%h %s')$changes"
node "$repo/tools/compare-sims/compare-sims.js" "$upstream" "$ours" "$@"
