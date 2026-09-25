#!/usr/bin/env bash
#
# STOP HOOK. Refuses to let the turn end when code changed and the docs were not compared to it, or when
# a source file changed without the test that covers it. Exit 2 blocks and feeds stderr back.
#
# INSTALL, in the "hooks" object of ~/.claude/settings.json:
#
#   "Stop": [ { "hooks": [ { "type": "command", "timeout": 180,
#       "command": ".../nebulith/bin/hooks/stop-spec-gate.sh" } ] } ]
#
# ── the two rules, and neither one asks anything of the model ───────────────────────────────────
#
# 1. PATH PAIRING. `assets/` changed and no `test/e2e/*.exs` changed is unfinishable. `lib/` changed and
#    no `test/` changed is unfinishable. This is a COUNT, not a judgment, which is the entire point: the
#    excuse it exists to kill is "I can't test the frontend", and a count cannot be talked out of.
#    Measured, the excuse has been made with the tool sitting there: fps was called unmeasurable while
#    `Canvas.readout_fps` existed, and REWIRE was called untestable while 16 Playwright-in-Elixir
#    scenarios existed. Both times a rule was written into memory afterwards. Both times it happened
#    again. Prose cannot fix this. A count can.
#
# 2. THE DOCS ARE COMPARED. Not a section of them: `load-docs.sh` puts all eleven in context at the start
#    of the turn, because at 54k tokens against a 15M window there is nothing to select, and any
#    selection recreates the bug where the laws that govern everything get skipped.
#
# ── the two guards, learned by getting them wrong ───────────────────────────────────────────────
#
# `stop_hook_active` stops an infinite loop: without it the session can never end.
#
# THE FINGERPRINT stops the worse failure. The first version blocked on any dirty working tree, so it
# fired on seven consecutive turns that contained no code at all, including one answering a user in
# crisis. A gate that fires when it has no subject is a gate that gets switched off. So the change set is
# fingerprinted when it blocks, and an identical change set never blocks twice: it fires on NEW work, not
# on the tree being dirty.
set -uo pipefail

INPUT="$(cat)"

read -r ACTIVE HOOK_CWD <<<"$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print(d.get("stop_hook_active", False), d.get("cwd", ""))
except Exception:
    print(False, "")' 2>/dev/null || echo "False ")"

[ "$ACTIVE" = "True" ] && exit 0

# THE REPO YOU ARE IN, never the repo this script lives in.
#
# The first version resolved the repo from `BASH_SOURCE`, so a hook installed globally in
# ~/.claude/settings.json pointed at game-engine from EVERY project on the machine. Other repositories
# were then blocked and told to comply with a spec that is not theirs. A machine-wide hook must derive
# its subject from where the work is happening.
cd "${HOOK_CWD:-$PWD}" 2>/dev/null || exit 0
REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$REPO" ] || exit 0
cd "$REPO" || exit 0

# NO SPEC, NOTHING TO COMPARE AGAINST, so this says nothing at all. A gate cannot check a document that
# does not exist, and a gate that fires where it has no subject is one that gets switched off everywhere.
#
# This is deliberately SILENT rather than a warning. Whether a repository needs a written framework is a
# judgment (`docs/FRAMEWORKS.md`: no framework is not permission to improvise, research and write one),
# and a judgment is not a thing to nag about on every turn of every unrelated project.
[ -f "$REPO/docs/SPEC.md" ] || exit 0
[ -x "$REPO/bin/spec-check" ] || exit 0

SEEN="$REPO/.git/.stop-spec-gate-seen"

# What changed, ignoring generated output: a baked png and a render sheet are products of a change.
CHANGED="$(git status --porcelain 2>/dev/null \
  | awk '{print $NF}' \
  | grep -vE '\.(png|jpg|jpeg|gif|webp|ico|woff2?)$' \
  | grep -vE '^docs/renders/' || true)"

[ -z "$CHANGED" ] && exit 0

# NEW work since the last block, or nothing to say. The content hash covers edits to a file that was
# already dirty, so a further change to the same path still counts as new.
FINGERPRINT="$(printf '%s' "$CHANGED" | tr '\n' ' ')|$(git diff HEAD 2>/dev/null | md5sum | cut -d' ' -f1)"
[ -f "$SEEN" ] && [ "$(cat "$SEEN")" = "$FINGERPRINT" ] && exit 0

changed_any() { printf '%s\n' "$CHANGED" | grep -qE "$1"; }

FAILURES=""
changed_any '^assets/' && ! changed_any '^test/e2e/.*\.exs$' &&
  FAILURES="$FAILURES\n  assets/ changed and no test/e2e/*.exs did. The frontend is tested by DRIVING IT as a user, with Playwright from Elixir (bin/e2e). There is no case where this is unnecessary."
changed_any '^lib/' && ! changed_any '^test/' &&
  FAILURES="$FAILURES\n  lib/ changed and no test/ did. Both layers, always (docs/TESTING.md)."

OUT="$(bin/spec-check --quiet 2>&1)"
GATE=$?

printf '%s' "$FINGERPRINT" > "$SEEN"

{
  echo "STOP BLOCKED."
  echo
  if [ -n "$FAILURES" ]; then
    echo "MISSING TESTS:"
    printf '%b\n' "$FAILURES"
    echo
  fi
  if [ "$GATE" -ne 0 ]; then
    echo "THE SPEC SCHEMA GATE FAILED. That is a defect, not a warning:"
    echo "$OUT" | tail -30
    echo
  fi
  echo "Before you may finish:"
  echo
  echo "  1. Compare what you changed against ALL the docs, which were loaded in full at the start of"
  echo "     this turn. Not a section. The laws and invariants apply to every part of the system."
  echo "  2. State every clause your change violates, BEFORE claiming the work is done."
  echo "  3. Calling a PHASE done means quoting its TABLES / REWIRE / DELETE / GATE lines and answering"
  echo "     all four. A phase with only the TABLES half is not done (SPEC 8.0)."
  echo "  4. Any feature with a backend and a frontend has BOTH tested, the frontend as a user."
} >&2

exit 2
