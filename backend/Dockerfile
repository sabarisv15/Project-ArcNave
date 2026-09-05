FROM node:20-slim

# poppler-utils (pdftoppm) — rasterizes PDF pages to PNG for
# ocr/pdfRasterizer.js, so tesseractOcr.js's own image-only OCR can
# process a PDF the same way it already does a plain photo. System
# dependency, not an npm package: no pure-JS pdftoppm equivalent exists
# that doesn't itself just wrap this same native binary.
# postgresql-client-16 — pg_dump/pg_restore for scripts/backup-database.js
# and scripts/restore-database.js (ARCNAVE modernization P1, PDF D7).
# Debian bookworm's own postgresql-client package is v15 (a version
# mismatch pg_dump refuses to run against this project's real pg16
# server, pgvector/pgvector:pg16 in docker-compose.yml) — the PGDG apt
# repo is what actually ships a matching v16 client.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates poppler-utils curl gnupg lsb-release \
    && update-ca-certificates \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y curl gnupg lsb-release \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "src/index.js"]
