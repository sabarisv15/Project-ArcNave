# ADL-059 sandbox service — deliberately its own image, not layered on
# backend/Dockerfile: it must never accidentally inherit anything from
# the main app's build context (no chance of a stray COPY . . pulling in
# backend source, env files, or secrets).
FROM node:20-slim

# The "future decision" this file's previous comment anticipated has
# arrived, and a real need named it. The document-analysis thread
# (ADL-055 through ADL-058) has spent six slices building deterministic
# table extraction in JavaScript inside the backend, and ADL-058 records
# where that stops: y-bucketing recovers a merged-cell PDF's identity
# columns 23/23 but MISATTRIBUTES its numeric columns, because correct
# attribution needs x-column-boundary detection that was done by hand.
# pdfplumber's extract_tables() does exactly that detection, and is the
# tool that produced this project's own independent ground truth for the
# ledger statement (1020 rows across 49 pages).
#
# So: a FIXED, REVIEWED allowlist, pinned, installed at build time.
# Never `pip install` at request time — that would give executed code a
# network path off this container, which the deny-all egress rule and
# this image's whole design exist to prevent.
#
# Each package earns its place against a measured case:
#   pdfplumber - column-boundary-aware PDF table extraction (ADL-058)
#   openpyxl   - reading and writing xlsx with real formulas
#   pandas     - aggregation over extracted rows
# python3-pip and the build deps are removed again afterwards so the
# shipped image cannot install anything further even if code found a
# way to reach a network.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && pip3 install --no-cache-dir --break-system-packages \
        pdfplumber==0.11.4 \
        openpyxl==3.1.5 \
        pandas==2.2.3 \
    && apt-get purge -y python3-pip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# LibreOffice — the recalculation half of the xlsx quality gate
# (scripts/recalc.py). openpyxl WRITES formulas but never evaluates them
# (no cached value survives its own save), so a generated workbook's
# totals are undefined until something recalculates them. This is that
# something.
#
# `libreoffice-calc` only, not the full `libreoffice` suite — Impress/
# Writer/Draw are dead weight for a service that only ever converts
# spreadsheets, and this image's whole design (F2's own comment) already
# treats every added package as image-size and cold-start cost that must
# earn its place. Real cost, measured after this build, not before: F2
# is still open on that number.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-calc \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.js ./
COPY scripts/recalc.py scripts/recalc.py

# Runs as a non-root user — the container's own root account should
# never be what executes arbitrary submitted code.
RUN useradd --no-create-home --shell /usr/sbin/nologin sandboxrunner
USER sandboxrunner

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
