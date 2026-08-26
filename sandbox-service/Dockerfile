# ADL-059 sandbox service — deliberately its own image, not layered on
# backend/Dockerfile: it must never accidentally inherit anything from
# the main app's build context (no chance of a stray COPY . . pulling in
# backend source, env files, or secrets).
FROM node:20-slim

# python3 only — no pip packages preinstalled beyond stdlib, keeping the
# image's own attack surface minimal. A future decision can add a fixed,
# reviewed package allowlist (e.g. pandas) if a real need names one;
# never `pip install` at request time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.js ./

# Runs as a non-root user — the container's own root account should
# never be what executes arbitrary submitted code.
RUN useradd --no-create-home --shell /usr/sbin/nologin sandboxrunner
USER sandboxrunner

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
