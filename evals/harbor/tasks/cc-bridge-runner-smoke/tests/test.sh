#!/bin/bash
set -euo pipefail

cd /app

node - <<'NODE'
const { greet } = require('./src/greeting.js');

if (greet('Harbor') !== 'Hello, Harbor!') {
  console.error('Expected greet("Harbor") to return "Hello, Harbor!"');
  process.exit(1);
}
NODE

printf '1\n' > /logs/verifier/reward.txt
