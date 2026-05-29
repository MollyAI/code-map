#!/usr/bin/env bash
# install.sh — prepare code-map for installation as a local Claude Code plugin.
#
# After cloning this repo, run:
#     ./install.sh
# then paste the printed commands into Claude Code.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="code-map"
MARKETPLACE_NAME="code-map"

color() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
bold()  { color '1'    "$*"; }
green() { color '0;32' "$*"; }
red()   { color '0;31' "$*"; }
yellow(){ color '0;33' "$*"; }
dim()   { color '0;90' "$*"; }

fail() { echo "$(red "✗") $*" >&2; exit 1; }
ok()   { echo "$(green "✓") $*"; }

echo
echo "$(bold "code-map — local install helper")"
echo "$(dim "Repo: $REPO_DIR")"
echo

# ---------------------------------------------------------------------------
# 1. Sanity checks
# ---------------------------------------------------------------------------
[[ -f "$REPO_DIR/.claude-plugin/plugin.json"      ]] || fail "missing .claude-plugin/plugin.json — is this the code-map repo?"
[[ -f "$REPO_DIR/.claude-plugin/marketplace.json" ]] || fail "missing .claude-plugin/marketplace.json — please re-clone or pull the latest"
[[ -f "$REPO_DIR/commands/build.md"               ]] || fail "missing commands/build.md"
[[ -f "$REPO_DIR/commands/run.md"                 ]] || fail "missing commands/run.md"
[[ -f "$REPO_DIR/commands/stop.md"                ]] || fail "missing commands/stop.md"
[[ -f "$REPO_DIR/scripts/bootstrap.py"            ]] || fail "missing scripts/bootstrap.py"
ok "plugin files present"

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 not found — install Python 3.10+ first (e.g. 'brew install python@3.12' on macOS)"
fi
PY_VERSION="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
ok "python3 $PY_VERSION"

if ! command -v git >/dev/null 2>&1; then
  echo "$(yellow "!") git not found — bootstrap.py will still work, but you'll miss out on 'git pull' updates"
else
  ok "git $(git --version | awk '{print $3}')"
fi

# ---------------------------------------------------------------------------
# 2. (Optional) bootstrap tree-sitter grammars now
# ---------------------------------------------------------------------------
# bootstrap.py is normally run by /code-map:build against the *target* project,
# but we offer to do a dry-run here just to validate that pip works.
if [[ "${SKIP_PIP_CHECK:-0}" != "1" ]]; then
  if python3 -m pip --version >/dev/null 2>&1; then
    ok "pip available (used on first /code-map:build run to install tree-sitter grammars on demand)"
  else
    echo "$(yellow "!") python3 -m pip not available — install pip before running /code-map:build"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Print Claude Code install commands
# ---------------------------------------------------------------------------
CMD1="/plugin marketplace add $REPO_DIR"
CMD2="/plugin install $PLUGIN_NAME@$MARKETPLACE_NAME"

echo
echo "$(bold "Next — open Claude Code and run these two slash commands:")"
echo
echo "    $(green "$CMD1")"
echo "    $(green "$CMD2")"
echo

# Try to copy to clipboard on macOS / Linux (xclip / wl-copy)
COPIED=0
if command -v pbcopy >/dev/null 2>&1; then
  printf '%s\n%s\n' "$CMD1" "$CMD2" | pbcopy && COPIED=1
elif command -v wl-copy >/dev/null 2>&1; then
  printf '%s\n%s\n' "$CMD1" "$CMD2" | wl-copy && COPIED=1
elif command -v xclip >/dev/null 2>&1; then
  printf '%s\n%s\n' "$CMD1" "$CMD2" | xclip -selection clipboard && COPIED=1
fi
[[ "$COPIED" == "1" ]] && echo "$(dim "(Both commands copied to your clipboard.)")"

echo
echo "$(bold "Then, in any project directory, run:")"
echo "    $(green "/code-map:build")    $(dim "# extract + Phase 2 refinement")"
echo "    $(green "/code-map:run")      $(dim "# start the local server and open the browser")"
echo "    $(green "/code-map:stop")     $(dim "# stop the local server")"
echo
echo "$(dim "Uninstall later with: /plugin uninstall $PLUGIN_NAME@$MARKETPLACE_NAME")"
echo "$(dim "Update with:          cd $REPO_DIR && git pull   (Claude Code re-reads the symlinked source)")"
echo
