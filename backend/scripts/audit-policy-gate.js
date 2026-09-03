'use strict';

// ARCNAVE modernization P5 (O5: "no software bill of materials /
// signing... policy checks"). npm audit's raw output has been
// informational only since P0 (see ../../dependency-scan-baseline.md)
// because every fix available today needs a breaking major-version
// bump this repo hasn't scheduled yet. This gate turns that into a
// real regression signal without forcing those breaking upgrades
// blind: any HIGH/CRITICAL advisory already triaged and accepted
// lives in audit-allowlist.json (keyed by GHSA URL, the stable
// per-advisory id `npm audit --json` reports). Anything NOT on that
// list fails the build — a new high/critical vulnerability landing in
// a future dependency bump is caught immediately, not silently
// absorbed into "npm audit || true".
//
// Usage: npm audit --json | node scripts/audit-policy-gate.js audit-allowlist.json

const fs = require('fs');
const path = require('path');

function readStdinJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const allowlistPath = process.argv[2];
  if (!allowlistPath) {
    console.error('usage: npm audit --json | node audit-policy-gate.js <allowlist.json>');
    process.exit(2);
  }

  const allowlist = JSON.parse(fs.readFileSync(path.resolve(allowlistPath), 'utf8'));
  const allowedUrls = new Set(allowlist.accepted.map((entry) => entry.url));

  const audit = readStdinJson();
  const vulnerabilities = audit.vulnerabilities || {};

  const advisories = new Map(); // url -> { severity, title, packages: Set }
  for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object' || !via.url) continue;
      const existing = advisories.get(via.url) || {
        severity: via.severity,
        title: via.title,
        packages: new Set(),
      };
      existing.packages.add(pkgName);
      advisories.set(via.url, existing);
    }
  }

  const unallowed = [];
  for (const [url, info] of advisories) {
    if (info.severity !== 'high' && info.severity !== 'critical') continue;
    if (allowedUrls.has(url)) continue;
    unallowed.push({ url, ...info, packages: [...info.packages] });
  }

  if (unallowed.length > 0) {
    console.error(
      `Dependency policy gate FAILED — ${unallowed.length} new high/critical advisory(ies) not in ${allowlistPath}:`,
    );
    for (const u of unallowed) {
      console.error(`  - [${u.severity}] ${u.title} (${u.url}) via ${u.packages.join(', ')}`);
    }
    console.error(
      '\nIf this is a real, already-accepted risk, add it to the allowlist with a dated justification (see dependency-scan-baseline.md for the existing reasoning pattern). Otherwise, fix the dependency.',
    );
    process.exit(1);
  }

  console.log(
    `Dependency policy gate passed — 0 new high/critical advisories (${allowedUrls.size} pre-accepted, ${advisories.size} total advisories seen).`,
  );
}

main();
