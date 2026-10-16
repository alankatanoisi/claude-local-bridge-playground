#!/bin/sh
# T3's "Local ACP command" starts this file directly. No Terminal command is
# needed for each chat: the agent advertises a Bridge host selector to T3.
# Keep the old t3-cursor-shim.sh for historical Cursor-provider configurations.
set -eu

# Find our neighboring agent using THIS file's location, not the chat's project.
# Use the real absolute path in T3; a symlink can point this lookup elsewhere.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# The packaged app's PATH may differ from Terminal's. An explicit Node setting
# wins, followed by the same fallbacks as our existing T3 launcher.
if [ -n "${BRIDGE_RUNNER_NODE:-}" ]; then
  NODE_BIN="$BRIDGE_RUNNER_NODE"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
elif [ -x /opt/homebrew/bin/node ]; then
  NODE_BIN=/opt/homebrew/bin/node
else
  NODE_BIN=/usr/local/bin/node
fi
if [ ! -x "$NODE_BIN" ]; then
  printf '%s\n' 't3-bridge-runner: set BRIDGE_RUNNER_NODE to an executable Node.js path.' >&2
  exit 127
fi

# Generic ACP needs no Cursor-specific flags. Refuse unexpected arguments so
# they cannot silently change the authority or connection of this launcher.
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != acp ]; }; then
  printf '%s\n' 't3-bridge-runner: leave Arguments empty in T3 Local ACP settings.' >&2
  exit 2
fi

# Tool availability and approval are different settings. Preserve Alan's
# existing explicit shell opt-in (--allow-shell) and workspace trust. "edits"
# adds file tools; it never removes the need for supervised shell approvals.
CAPS="${BRIDGE_RUNNER_CAPABILITIES:-}"
case ",$CAPS," in
  *shell*) printf '%s\n' 't3-bridge-runner: shell is not a capability group; this launcher explicitly enables it with --allow-shell.' >&2; exit 2 ;;
esac

# Standalone is the new-chat default, not an automatic fallback. Once a chat
# selects another host, only that host is used. No service starts until a prompt.
set -- --bridge-host "${BRIDGE_RUNNER_HOST:-standalone}" --trust-workspace --allow-shell
if [ -n "$CAPS" ]; then set -- "$@" --capabilities "$CAPS"; fi

# exec replaces the shell, so Stop and process shutdown reach the ACP agent.
# Nothing is printed to stdout: that pipe carries protocol messages only.
exec "$NODE_BIN" "$SCRIPT_DIR/local-bridge-acp.js" "$@"
