#!/bin/sh
# bin/t3-cursor-shim.sh — the program T3 Code launches when a provider instance
# points at Bridge Runner.
#
# WHY THIS FILE EXISTS (read this first)
# ---------------------------------------
# T3 Code (the desktop coding-agent app) has a built-in "Cursor" provider
# driver. That driver knows nothing about Bridge Runner; it only knows how to
# start a command-line program and speak ACP (Agent Client Protocol: JSON lines
# over standard input/output) to it. The driver starts the program twice:
#
#   1. <program> about --format json     "who are you?" — a version/identity probe
#   2. <program> [flags] acp             the real session, kept alive for the thread
#
# The real ACP agent is bin/local-bridge-acp.js, a Node script. It cannot be the
# program T3 points at directly, for two reasons:
#   - it does not answer "about" (and its strict flag parser would crash on
#     "--format"), and
#   - T3 adds a few Cursor-only launch flags that the agent must never see.
#
# So this small shell script sits in between. It answers "about" itself, drops
# the Cursor-only flags, finds a node binary, and hands over (exec) to the agent
# with this instance's tool posture. An earlier copy lived in a T3 fork checkout
# that has since been deleted; it now lives here, next to the agent it launches,
# so a T3 configuration can never again depend on a folder that can vanish.
#
# In T3: Settings -> Providers -> "Add provider instance" -> driver "Cursor", and
# set "Binary path" to the ABSOLUTE path of this file. Do not symlink it: the
# script finds the agent relative to its own location, and a symlink would point
# that lookup at the wrong folder. Setup guide and checklist:
#   docs/t3-code-nightly-setup-2026-09-26.html
#
# Per-instance environment variables T3 lets you set on the provider card:
#   BRIDGE_RUNNER_NODE          absolute path to the node binary to use
#                               (the packaged app's PATH is not your Terminal's PATH)
#   BRIDGE_RUNNER_CAPABILITIES  comma-separated capability groups to enable,
#                               e.g. "edits". Unset = core tools PLUS shell;
#                               file-write tools need "edits" (see block 5).
#                               "shell" is refused here on purpose (see block 5).
#
# Exit codes: 0 = answered "about" or handed over to the agent;
#             2 = unexpected argument or refused posture; 127 = no node found.

set -eu

# ── 1. The identity probe ──────────────────────────────────────────────────────
# T3 runs "<program> about --format json" and, if that output looked
# unsupported, plain "<program> about". Both arrive with "about" as the first
# argument. We answer with shell built-ins only (no node, no PATH lookups), so
# the provider card can show "ready" even when node is not yet configured.
#
# What T3 checks in this JSON (verified against T3 source on 2026-09-26):
#   - cliVersion must start with YYYY.MM.DD and be at least 2026.04.08
#   - userEmail must be a non-empty string (a null value reads as "not logged in")
#   - subscriptionTier is only a label
# T3 caches the model list for 30 minutes keyed by cliVersion, so bumping the
# date in cliVersion is also how you force a fresh model list after a change.
if [ "${1:-}" = "about" ]; then
  printf '%s\n' '{"cliVersion":"2026.09.28-bridge-runner-nightly","userEmail":"bridge-runner@localhost","subscriptionTier":"local"}'
  exit 0
fi

# ── 2. Where am I? ─────────────────────────────────────────────────────────────
# This file lives in <repo>/bin/, and so does the agent. Resolving the folder
# from $0 means the script works from any checkout location without editing.
# (CDPATH= keeps "cd" from printing a path if the user has CDPATH set.)
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT="$SCRIPT_DIR/local-bridge-acp.js"

# ── 3. Drop T3's Cursor-only launch tokens ─────────────────────────────────────
# Real session launches look like one of these (T3 source, 2026-09-26):
#     acp                       supervised mode (the default)
#     --auto-review acp         "auto" mode
#     --force acp               "full access" mode
#     -e <url> ... acp          only when the instance has an API endpoint set
# Those flags tell the real Cursor CLI how to behave. Our agent gets its mode
# from T3 over ACP instead, so here they are simply removed. "-e" takes a value,
# so it consumes two tokens. Anything we do not recognise is a sign that T3's
# launch contract changed: we stop loudly (exit 2, message on stderr) rather
# than forward it, because the agent's strict flag parser would otherwise die
# with a stack trace that is much harder to read in T3's logs.
while [ $# -gt 0 ]; do
  case "$1" in
    -e)
      shift
      if [ $# -gt 0 ]; then shift; fi
      ;;
    --force|--auto-review)
      shift
      ;;
    acp)
      shift
      ;;
    *)
      printf 't3-cursor-shim: unexpected argument "%s" (has the T3 launch contract changed? see docs/t3-code-nightly-setup-2026-09-26.html)\n' "$1" >&2
      exit 2
      ;;
  esac
done

# ── 4. Find node ───────────────────────────────────────────────────────────────
# A packaged desktop app inherits a minimal PATH from the system, not the PATH
# your Terminal has, so "node" may not be findable. Order of preference:
#   a) BRIDGE_RUNNER_NODE from the provider instance's environment (explicit wins)
#   b) whatever "node" is on the PATH we were given
#   c) the two usual install locations on a Mac
if [ -n "${BRIDGE_RUNNER_NODE:-}" ]; then
  NODE_BIN="$BRIDGE_RUNNER_NODE"
  if [ ! -x "$NODE_BIN" ]; then
    printf 't3-cursor-shim: BRIDGE_RUNNER_NODE=%s is not an executable file\n' "$NODE_BIN" >&2
    exit 127
  fi
elif command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
elif [ -x /opt/homebrew/bin/node ]; then
  NODE_BIN=/opt/homebrew/bin/node
elif [ -x /usr/local/bin/node ]; then
  NODE_BIN=/usr/local/bin/node
else
  printf 't3-cursor-shim: cannot find node; set BRIDGE_RUNNER_NODE on the T3 provider instance (e.g. /Users/<you>/.local/bin/node)\n' >&2
  exit 127
fi

# ── 5. Tool posture for this instance ──────────────────────────────────────────
# Unset            -> core tools (read, search, glob, git status, questions)
#                     PLUS shell, because both exec paths below set --allow-shell.
# "edits"          -> also enables file-write tools. In supervised Ask mode,
#                     writes and shell commands request approval unless this
#                     ACP session already received "Allow for this session".
# No "edits" does not make the instance read-only: shell can also change files.
# Any group the agent does not know makes the agent exit with a clear message.
#
# "shell" is refused here on purpose. Shell is not a capability group; the ONLY
# way to expose it is the explicit --allow-shell flag on the agent command line,
# already present on BOTH exec paths in block 6 since Alan's 2026-09-28 edit.
# This environment variable selects extra tool groups; it is not a shell toggle.
# T3's access mode controls approvals separately from which tools are exposed.
CAPS="${BRIDGE_RUNNER_CAPABILITIES:-}"
case ",$CAPS," in
  *shell*)
    printf 't3-cursor-shim: "shell" is not a capability group and cannot be enabled from the environment; edit the exec line in this file (--allow-shell) if you really mean it\n' >&2
    exit 2
    ;;
esac

# ── 6. Hand over to the agent ──────────────────────────────────────────────────
# "exec" replaces this shell process with node, so T3 talks to the agent
# directly and signals (Stop, app quit) reach it without a middleman.
# --trust-workspace: a headless process cannot answer the interactive
# "do you trust this folder?" prompt, so without this flag every untrusted
# thread folder would fail closed. From here on, standard output is the ACP
# wire: nothing in this script may print to it after this point.
#
# --allow-shell: ADDED BY HAND 2026-09-28 at Alan's request. This is the one
# deliberate shell opt-in for this launcher, so shell is ON by default here.
# Supervised Ask mode requests approval unless this ACP session already received
# "Allow for this session". T3 full access auto-selects that answer, so commands
# can run without a card. The agent remembers it for later asks in this session;
# runner hard denies still apply. ACP Code mode accepts file edits automatically
# but still asks for shell; Plan mode records proposals without executing them.
# Remove the flag from both exec lines below to turn shell off.
if [ -n "$CAPS" ]; then
  exec "$NODE_BIN" "$AGENT" --trust-workspace --allow-shell --capabilities "$CAPS"
fi
exec "$NODE_BIN" "$AGENT" --trust-workspace --allow-shell
