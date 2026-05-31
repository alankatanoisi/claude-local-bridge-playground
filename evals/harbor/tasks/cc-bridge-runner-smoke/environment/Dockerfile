FROM ubuntu:24.04

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates nodejs npm \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mkdir -p src \
  && printf '%s\n' \
    'function greet(name) {' \
    '  return `Hi, ${name}.`;' \
    '}' \
    '' \
    'module.exports = { greet };' \
    > src/greeting.js
