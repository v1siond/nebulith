#!/usr/bin/env bash
#
# EVERY DOC, IN FULL, AT THE START OF EVERY TURN. No selection, no sections, no relevance judgment.
#
# ── why the whole thing and not the relevant part ───────────────────────────────────────────────
# The first version of this mapped file paths to spec sections, so editing the catalog would surface
# law 8 and editing the renderer would surface law 7. That is still a FILTER, and a filter reproduces
# the exact defect it was built to stop: the laws and invariants apply to every part of the system, so
# reading "the relevant section" means missing the rules that govern all of them. The failure was never
# that the wrong section was read. It was that something CHOSE.
#
# And the choosing was never necessary. Measured: SPEC.md is 30k tokens and all eleven docs together are
# 54k, against a session budget of 15 million. The entire corpus is 0.36% of the window. A retrieval
# system was built for a document that fits in context twenty times over.
#
# So there is nothing to select. Everything is loaded, every turn, and the question "which part applies"
# never gets asked by anything that can get it wrong.
set -uo pipefail

# THE REPO YOU ARE IN, never the repo this script lives in. A hook installed machine-wide in
# ~/.claude/settings.json would otherwise load game-engine's docs into every unrelated project, and tell
# other repositories to comply with a spec that is not theirs. Measured: it did exactly that.
REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
DOCS="$REPO/docs"

# NO DOCS, NOTHING TO LOAD, and nothing to say about it. Whether this repository ought to have a written
# framework is a judgment (`docs/FRAMEWORKS.md`: no framework is not permission to improvise, research
# and write one), and a judgment does not belong in a hook that runs on every turn of every project.
[ -d "$DOCS" ] || exit 0
ls "$DOCS"/*.md >/dev/null 2>&1 || exit 0

echo "════════ THE DOCS, IN FULL. Compare every change against ALL of this, not a section of it. ════════"
echo

for f in "$DOCS"/*.md; do
  echo "──────── $(basename "$f") ────────"
  cat "$f"
  echo
done
