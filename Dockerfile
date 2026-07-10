# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# Stage 1 — deps
#   Install only production-relevant tooling.
#   This project has no runtime npm dependencies, so node_modules
#   is not needed at runtime; we still install devDeps here only
#   if you want to run tests inside the image (optional).
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# Install devDependencies only in this layer so the final image
# stays lean. Use --ci for reproducible installs.
RUN npm ci --ignore-scripts

# ─────────────────────────────────────────────────────────────
# Stage 2 — final
#   Minimal runtime image. No devDependencies shipped.
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS final

# Run as non-root for security
RUN addgroup -S bridge && adduser -S bridge -G bridge

WORKDIR /app

# Copy source — no node_modules needed at runtime (zero runtime deps)
COPY --chown=bridge:bridge bin/        ./bin/
COPY --chown=bridge:bridge src/        ./src/
COPY --chown=bridge:bridge package.json ./

# Bridge runner writes logs/sessions to ~/.bridge-runner
# Mount a volume here to persist transcripts across restarts
VOLUME ["/home/bridge/.bridge-runner"]

USER bridge

# Default bridge port
EXPOSE 11437

# Pass secrets at runtime via --env-file or -e, never bake them into the image.
# e.g.:  docker run --env-file .env claude-local-bridge:latest "your prompt"
# Supported vars: BRIDGE_RUNNER_BRIDGE_URL, BRIDGE_CALLER_TOKEN

ENTRYPOINT ["node", "bin/local-bridge-runner.js"]
CMD ["--help"]
