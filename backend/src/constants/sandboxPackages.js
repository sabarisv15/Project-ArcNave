'use strict';

// Canonical list of the third-party packages sandbox-service/Dockerfile
// installs at build time for execute_code's Python sandbox (ADL-059;
// the 2026-08-28 six-skill build package) — the single source of truth
// so the tool description (aiToolRegistry.js) and the cold-start probe
// (scripts/sandbox-coldstart-probe.js) can't silently drift apart from
// each other, or from what the image actually installs. `pipName` is
// the exact `pip install` argument; `importName` is what Python code
// actually imports (they differ for python-docx/python-pptx, whose
// import names are docx/pptx) — see the Dockerfile's own comment for
// what each package is for.
const SANDBOX_PACKAGES = Object.freeze(
  [
    { pipName: 'pdfplumber', importName: 'pdfplumber' },
    { pipName: 'openpyxl', importName: 'openpyxl' },
    { pipName: 'pandas', importName: 'pandas' },
    { pipName: 'reportlab', importName: 'reportlab.pdfgen' },
    { pipName: 'pypdf', importName: 'pypdf' },
    { pipName: 'python-docx', importName: 'docx' },
    { pipName: 'python-pptx', importName: 'pptx' },
    { pipName: 'pdf2image', importName: 'pdf2image' },
    { pipName: 'pytesseract', importName: 'pytesseract' },
  ].map((entry) => Object.freeze(entry)),
);

// "a, b, c, and d" — the exact join style the execute_code tool
// description already used by hand before this module existed.
function formatPipNamesForDescription() {
  const names = SANDBOX_PACKAGES.map((p) => p.pipName);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

module.exports = { SANDBOX_PACKAGES, formatPipNamesForDescription };
