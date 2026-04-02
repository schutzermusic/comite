#!/usr/bin/env node
/**
 * Scan for remaining English UI strings in TSX/JSX files.
 * Run: node scripts/scan-english-strings.mjs
 * 
 * Looks for common English patterns: label="...", title="...", placeholder="...",
 * and literal strings that might be UI text (heuristic).
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(process.cwd(), 'src');
const EXCLUDE_DIRS = new Set(['node_modules', '.next', 'locales', 'i18n']);
const EXCLUDE_FILES = /\.(test|spec|stories)\.(tsx?|jsx?)$/;

// English-only words that often appear in UI (avoid matching code/keys)
const ENGLISH_UI_WORDS = new Set([
  'All', 'Backlog', 'Billed', 'Cancel', 'Custom', 'Delete', 'Edit', 'Error', 'Export',
  'Filter', 'Filters', 'High Risk', 'Loading', 'Missing Docs', 'Save', 'Search',
  'Settings', 'Status', 'Submit', 'View', 'Warning', 'Export', 'Exposure',
  'Renewals 90d', 'Missing Docs', 'Click', 'Submit', 'Next', 'Previous',
  'Add', 'Remove', 'Update', 'Create', 'Copy', 'Paste', 'Refresh', 'Close',
  'Yes', 'No', 'OK', 'Apply', 'Reset', 'Clear', 'Select', 'Choose', 'Upload',
  'Download', 'Share', 'Print', 'Send', 'Back', 'Forward', 'Home', 'Menu',
  'Profile', 'Account', 'Logout', 'Login', 'Sign in', 'Sign out', 'Register',
  'Submit', 'Loading...', 'No results', 'Success', 'Failed', 'Pending',
  'Active', 'Inactive', 'Enabled', 'Disabled', 'Open', 'Closed', 'Live',
  'Average', 'Total', 'Average', 'Sum', 'Count', 'Min', 'Max', 'Avg',
  'Overview', 'Details', 'Summary', 'Report', 'Dashboard', 'Chart', 'Table',
  'List', 'Grid', 'Card', 'Panel', 'Modal', 'Dialog', 'Popup', 'Tooltip',
  'Placeholder', 'Label', 'Title', 'Description', 'Name', 'Date', 'Time',
  'Risk', 'Contract', 'Project', 'Meeting', 'Decision', 'Vote', 'Approved',
  'Rejected', 'Pending', 'Draft', 'Published', 'Archived', 'Expired',
  'Event Stream', 'Risk Exposure', 'Portfolio Overview', 'Finance Snapshot',
  'Decision SLA', 'Top risk contributors', 'SOC-style'
]);

// Patterns to search for (regex)
const PATTERNS = [
  { name: 'label="..."', regex: /label\s*=\s*["']([^"']+)["']/g },
  { name: 'title="..."', regex: /title\s*=\s*["']([^"']+)["']/g },
  { name: 'placeholder="..."', regex: /placeholder\s*=\s*["']([^"']+)["']/g },
  { name: '>English<', regex: />\s*([A-Z][a-z]+(?:\s+[A-Za-z]+)*)\s*</g },
];

function* walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !EXCLUDE_DIRS.has(e.name)) {
      yield* walk(full);
    } else if (e.isFile() && /\.(tsx|jsx)$/.test(e.name) && !EXCLUDE_FILES.test(e.name)) {
      yield full;
    }
  }
}

function mightBeEnglish(str) {
  const s = str.trim();
  if (!s || s.length < 2) return false;
  // Already translation key pattern
  if (/^[a-z]+\.[a-zA-Z]+$/.test(s) || s.startsWith('{t(')) return false;
  // Number or symbol only
  if (/^[\d\s\-\%\$\.,]+$/.test(s)) return false;
  // Portuguese common chars
  if (/[ãõçáéíóúâêôà]/.test(s)) return false;
  // Known English UI phrases
  if (ENGLISH_UI_WORDS.has(s)) return true;
  // CamelCase or Title Case English-like (multiple words)
  if (/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(s) && s.split(/\s+/).length >= 2) return true;
  // Single known word
  if (ENGLISH_UI_WORDS.has(s)) return true;
  return false;
}

const findings = [];
for (const file of walk(ROOT)) {
  const content = readFileSync(file, 'utf-8');
  const rel = file.replace(process.cwd(), '').replace(/^\//, '');
  for (const { name, regex } of PATTERNS) {
    let m;
    const re = new RegExp(regex.source, regex.flags);
    while ((m = re.exec(content)) !== null) {
      const value = m[1];
      if (mightBeEnglish(value)) {
        findings.push({ file: rel, pattern: name, value, line: content.slice(0, m.index).split('\n').length });
      }
    }
  }
}

console.log('\n=== English UI string scan (src/**/*.tsx, *.jsx) ===\n');
if (findings.length === 0) {
  console.log('No obvious English strings found. UI may be fully localized.\n');
  process.exit(0);
}
console.log(`Found ${findings.length} potential English string(s):\n`);
const byFile = {};
for (const f of findings) {
  if (!byFile[f.file]) byFile[f.file] = [];
  byFile[f.file].push({ pattern: f.pattern, value: f.value, line: f.line });
}
for (const [path, items] of Object.entries(byFile).sort()) {
  console.log(path);
  for (const { pattern, value, line } of items) {
    console.log(`  L${line} ${pattern}: "${value}"`);
  }
  console.log('');
}
console.log('Checklist: Replace these with useTranslations() and keys from locales/pt-BR/*.json\n');
process.exit(1);
