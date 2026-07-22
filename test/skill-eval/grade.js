// Objective figma-readiness checker — the grader behind the figma-ready-html
// skill evals, usable standalone on any HTML file. MVP of the planned
// `html-to-figma lint` command (ROADMAP Phase 10.1).
//
// Usage: node test/skill-eval/grade.js <page.html> [--summary <summary.txt>] [--json <out.json>]
//   --summary  agent/author summary text; enables the stated-inventory check
//   --json     also write the full grading report as JSON
// Exit code: number of failed checks (0 = figma-ready).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = process.argv.slice(2);
const htmlPath = args.find((a) => !a.startsWith('--'));
const summaryPath = args.includes('--summary') ? args[args.indexOf('--summary') + 1] : null;
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
if (!htmlPath) {
  console.error('Usage: node test/skill-eval/grade.js <page.html> [--summary <summary.txt>] [--json <out.json>]');
  process.exit(2);
}

const expectations = [];
const check = (text, passed, evidence) => expectations.push({ text, passed: !!passed, evidence });

let src = '';
const exists = fs.existsSync(htmlPath);
check('HTML file exists', exists, exists ? htmlPath : `missing: ${htmlPath}`);
if (exists) src = fs.readFileSync(htmlPath, 'utf8');

const marks = [...src.matchAll(/data-figma-component="([^"]*)"/g)].map((m) => m[1]);
check(
  'Components explicitly marked with data-figma-component',
  marks.length >= 1,
  marks.length ? `marks: ${[...new Set(marks)].join(', ')}` : 'no data-figma-component attributes',
);
check(
  'Component names are human-readable design-system names',
  marks.length >= 1 && marks.every((m) => /[A-Za-z]{3,}/.test(m)),
  marks.join(', ') || 'n/a',
);
check('Layout uses flexbox', /display:\s*(inline-)?flex/.test(src), 'searched for display: flex');
check('No CSS Grid (would freeze Auto Layout)', !/display:\s*(inline-)?grid/.test(src), 'searched for display: grid');
check('No CSS transforms (unmapped)', !/[^-]transform\s*:/.test(src), 'searched for transform:');
check(
  'No ::before/::after content (would disappear)',
  !/::(before|after)\s*\{[^}]*content\s*:/s.test(src),
  'searched for pseudo-element content rules',
);
check(
  'Font stack ends in a generic fallback',
  /font-family[^;}]*(sans-serif|serif|monospace)/.test(src),
  'searched font-family declarations',
);
check(
  'Self-contained (no external stylesheets/scripts)',
  !/<link[^>]*stylesheet(?![^>]*fonts\.googleapis)/.test(src) || /fonts\.googleapis/.test(src),
  'external <link rel=stylesheet> check (Google Fonts allowed)',
);

let tree = null;
let cliOk = false;
let cliOut = '';
const convDir = fs.mkdtempSync(path.join(os.tmpdir(), 'htf-grade-'));
if (exists) {
  try {
    cliOut = execFileSync('node', ['bin/html-to-figma.js', path.resolve(htmlPath), '-o', convDir], {
      cwd: REPO, encoding: 'utf8', timeout: 120000,
    });
    cliOk = true;
    tree = JSON.parse(fs.readFileSync(path.join(convDir, 'tree.json'), 'utf8'));
  } catch (e) {
    cliOut = String(e.stdout || e.message).slice(0, 500);
  }
}
const componentLine = cliOut.match(/Extracted \d+ nodes, (\d+) component\(s\)/);
check('html-to-figma converts it successfully', cliOk, cliOk ? cliOut.split('\n').slice(1, 3).join(' | ') : cliOut);
check(
  'Converter detects at least one named component',
  componentLine && parseInt(componentLine[1], 10) >= 1,
  componentLine ? componentLine[0] : 'no component count in CLI output',
);

let nested = false;
const findNested = (node, insideComponent) => {
  if (node.component && insideComponent) nested = true;
  for (const c of node.children || []) findNested(c, insideComponent || !!node.component);
};
if (tree) findNested(tree, false);
check(
  'No nested component marks (instances not supported yet)',
  tree ? !nested : false,
  nested ? 'nested component found in tree' : tree ? 'tree clean' : 'no tree',
);

let mockOk = false;
let mockOut = '';
if (cliOk) {
  try {
    mockOut = execFileSync('node', ['test/mock-figma-run.js', path.join(convDir, 'figma-script.js')], {
      cwd: REPO, encoding: 'utf8', timeout: 60000,
    });
    mockOk = true;
  } catch (e) {
    mockOut = String(e.stdout || e.message).slice(0, 300);
  }
}
check('Generated script executes against the mock Figma API', mockOk, mockOut.split('\n')[0] || 'failed');

if (summaryPath && fs.existsSync(summaryPath)) {
  const summary = fs.readFileSync(summaryPath, 'utf8');
  const uniqueMarks = [...new Set(marks)];
  check(
    'Summary states the chosen component inventory (all marked names)',
    uniqueMarks.length > 0 && uniqueMarks.every((m) => summary.includes(m)),
    uniqueMarks.length
      ? `${uniqueMarks.filter((m) => summary.includes(m)).length}/${uniqueMarks.length} marked names appear in summary`
      : 'no marks to state',
  );
}

const passed = expectations.filter((e) => e.passed).length;
const total = expectations.length;
for (const e of expectations) {
  console.log(`${e.passed ? 'PASS' : 'FAIL'}  ${e.text}${e.passed ? '' : ` — ${e.evidence}`}`);
}
console.log(`\n${passed}/${total} checks passed${passed === total ? ' — figma-ready ✔' : ''}`);
if (jsonPath) {
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      { expectations, summary: { passed, failed: total - passed, total, pass_rate: +(passed / total).toFixed(3) } },
      null,
      2,
    ),
  );
}
process.exit(total - passed);
