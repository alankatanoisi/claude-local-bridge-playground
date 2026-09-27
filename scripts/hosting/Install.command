#!/bin/zsh
# Finder opens this file in Terminal. It installs a private snapshot for this
# Mac, without moving branches, touching Claude credentials, or enabling login startup.
set -u
script_folder="${0:A:h}"
source_folder="${script_folder}/../.."
cd "$source_folder" || exit 1
printf 'Source folder: %s\n' "$PWD"
printf 'Install location: %s/Library/Application Support/Claude Bridge Lab\n' "$HOME"
# Finder has a smaller command search path than an interactive Terminal window.
node_program=""
for candidate in "$HOME/.local/bin/node" /opt/homebrew/bin/node /opt/homebrew/opt/node@22/bin/node /usr/local/bin/node /usr/local/opt/node@22/bin/node; do
  if [[ -x "$candidate" ]]; then node_program="$candidate"; break; fi
done
if [[ -z "$node_program" ]]; then
  printf 'Node.js 22 or newer was not found. Open docs/bridge-hosting-guide.html for installation steps.\n'
  result=1
else
  "$node_program" bin/bridge-hosts.js install
  result=$?
fi
printf '\nPress Return to close this window.\n'
read -r reply
exit "$result"
