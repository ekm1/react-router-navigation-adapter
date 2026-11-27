#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DEFAULT_TARGET_PACKAGE, formatAuditReport, transformSource } from './transform.ts';

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

function collectFiles(targets) {
  const files = [];
  const walk = (targetPath) => {
    const abs = path.resolve(targetPath);
    if (!fs.existsSync(abs)) {
      console.error(`Path not found: ${targetPath}`);
      process.exitCode = 1;
      return;
    }
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (EXTENSIONS.has(path.extname(abs))) files.push(abs);
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(path.join(abs, entry.name));
      }
    }
  };
  for (const t of targets) walk(t);
  return files;
}

function parseArgs(argv) {
  let write = false;
  let reportOnly = false;
  let json = false;
  let targetPackage = DEFAULT_TARGET_PACKAGE;
  const targets = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write' || arg === '-w') write = true;
    else if (arg === '--report-only') reportOnly = true;
    else if (arg === '--json') json = true;
    else if (arg === '--package' && argv[i + 1]) targetPackage = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'Usage: node codemod/cli.mjs <paths...> [options]',
          '',
          'Options:',
          '  --write, -w       Write rewritten imports to disk (default: dry-run)',
          '  --report-only     Only print the audit report without writing changes',
          '  --package <name>  Target adapter package (default: react-router-navigation-adapter)',
          '  --json            Output report as JSON',
        ].join('\n'),
      );
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      targets.push(arg);
    }
  }
  return { write: write && !reportOnly, json, targetPackage, targets };
}

const { write, json, targetPackage, targets } = parseArgs(process.argv.slice(2));
if (targets.length === 0) {
  console.error('Please specify at least one file or directory path. Use --help for usage.');
  process.exit(1);
}

const files = collectFiles(targets);
const results = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const relPath = path.relative(process.cwd(), file);
  const res = transformSource(source, relPath, { targetPackage });
  if (write && res.changed) {
    fs.writeFileSync(file, res.code, 'utf8');
  }
  results.push({
    filePath: relPath,
    changed: res.changed,
    rewrittenSymbols: res.rewrittenSymbols,
    findings: res.findings,
  });
}

console.log(formatAuditReport(results, { json }));
