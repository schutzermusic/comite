#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_INPUT = '/Users/schutzer/Desktop/Contratos em Andamento_ Recebimentos - Insight Energy.xlsx';
const DEFAULT_OUTPUT = 'src/data/contractsFromExcel.generated.ts';
const SHEET_NAME = 'ACOMPANHAMENTO - OS';

const inputPath = process.argv[2] || DEFAULT_INPUT;
const outputPath = process.argv[3] || DEFAULT_OUTPUT;

function unzipText(filePath, zipEntryPath) {
  const escapedInput = filePath.replace(/'/g, "'\\''");
  const escapedEntry = zipEntryPath.replace(/'/g, "'\\''");
  return execSync(`unzip -p '${escapedInput}' '${escapedEntry}'`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function colToIndex(col) {
  let value = 0;
  for (const ch of col) {
    value = value * 26 + (ch.charCodeAt(0) - 64);
  }
  return value;
}

function parseSharedStrings(filePath) {
  const xml = unzipText(filePath, 'xl/sharedStrings.xml');
  const entries = [...xml.matchAll(/<si[\s\S]*?<\/si>/g)];
  return entries.map((entry) => {
    const textParts = [...entry[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
    return textParts.join('');
  });
}

function parseWorkbook(filePath) {
  const workbookXml = unzipText(filePath, 'xl/workbook.xml');
  const relsXml = unzipText(filePath, 'xl/_rels/workbook.xml.rels');

  const sheetByRelId = new Map();
  for (const match of workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const name = decodeXml(match[1]);
    const relId = match[2];
    sheetByRelId.set(relId, name);
  }

  const targetByRelId = new Map();
  for (const match of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    targetByRelId.set(match[1], match[2]);
  }

  const sheets = new Map();
  for (const [relId, name] of sheetByRelId.entries()) {
    const target = targetByRelId.get(relId);
    if (!target || !target.startsWith('worksheets/')) continue;
    sheets.set(name, `xl/${target}`);
  }

  return sheets;
}

function parseSheetRows(filePath, sheetEntry, sharedStrings) {
  const xml = unzipText(filePath, sheetEntry);
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(rowMatch[1]);
    const rowXml = rowMatch[2];
    const cells = {};

    for (const cellMatch of rowXml.matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const column = cellMatch[1];
      const attrs = cellMatch[2] || '';
      const body = cellMatch[3] || '';
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || '';

      let rawValue = '';
      if (type === 'inlineStr') {
        rawValue = (body.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '';
      } else {
        rawValue = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '';
      }

      let value = decodeXml(String(rawValue));
      if (type === 's') {
        const idx = Number(rawValue);
        value = sharedStrings[idx] ?? '';
      }

      cells[column] = value.trim();
    }

    if (Object.keys(cells).length > 0) {
      rows.push({ rowNumber, cells });
    }
  }

  return rows;
}

function parseNumber(value) {
  if (value == null) return null;
  const clean = String(value).trim();
  if (!clean) return null;
  if (clean === '-' || /^n\/?a$/i.test(clean)) return null;
  let normalized = clean;
  if (/[eE]/.test(normalized)) {
    normalized = normalized.replace(',', '.');
  } else if (normalized.includes('.') && normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) return parsed;
  const fallback = Number(clean);
  return Number.isFinite(fallback) ? fallback : null;
}

function excelSerialToDate(serial) {
  if (!Number.isFinite(serial)) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 24 * 60 * 60 * 1000;
  return new Date(utc);
}

function parseDate(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw === '-' || /^a definir$/i.test(raw) || /^n\/?a$/i.test(raw)) {
    return null;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 1000) {
    return excelSerialToDate(numeric);
  }

  const dateMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    const year = Number(dateMatch[3]);
    return new Date(Date.UTC(year, month, day));
  }

  return null;
}

function normalizeCompanyName(clientName) {
  const parts = clientName.split('-');
  return (parts[0] || clientName).trim();
}

function deriveStatus(statusText, expirationDate) {
  const status = (statusText || '').toLowerCase();
  if (status.includes('cancel')) return 'expired';
  if (status.includes('finaliz')) return 'expired';

  if (expirationDate instanceof Date) {
    const diffMs = expirationDate.getTime() - Date.now();
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return 'expired';
    if (diffDays <= 90) return 'expiring_soon';
  }

  return 'active';
}

function deriveRisk(statusText, contractStatus) {
  const status = (statusText || '').toLowerCase();
  if (status.includes('a iniciar') || status.includes('aguardando') || status.includes('cancel')) {
    return 'high';
  }
  if (contractStatus === 'expiring_soon') {
    return 'medium';
  }
  if (contractStatus === 'expired') {
    return 'low';
  }
  return status.includes('em andamento') ? 'medium' : 'low';
}

function dateCode(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'sem-data';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function serializeContract(contract) {
  const parts = [];
  parts.push(`id: ${JSON.stringify(contract.id)}`);
  parts.push(`name: ${JSON.stringify(contract.name)}`);
  parts.push(`vendorOrParty: ${JSON.stringify(contract.vendorOrParty)}`);
  parts.push(`value: ${Number(contract.value.toFixed(2))}`);
  parts.push(`currency: 'BRL'`);

  if (contract.signingDate) {
    parts.push(`signingDate: new Date(${JSON.stringify(`${contract.signingDate}T00:00:00.000Z`)})`);
  }
  if (contract.expirationDate) {
    parts.push(`expirationDate: new Date(${JSON.stringify(`${contract.expirationDate}T00:00:00.000Z`)})`);
  }

  parts.push(`fileUrl: ''`);
  parts.push(`riskClassification: ${JSON.stringify(contract.riskClassification)}`);
  parts.push(`status: ${JSON.stringify(contract.status)}`);
  parts.push(`uploadedAt: new Date(${JSON.stringify(`${contract.uploadedAt}T00:00:00.000Z`)})`);

  if (contract.notes) {
    parts.push(`notes: ${JSON.stringify(contract.notes)}`);
  }

  return `  { ${parts.join(', ')} }`;
}

function serializeObjectArray(items, keyOrder) {
  return items
    .map((item) => {
      const kv = keyOrder
        .filter((k) => item[k] !== undefined)
        .map((k) => `${k}: ${JSON.stringify(item[k])}`)
        .join(', ');
      return `  { ${kv} }`;
    })
    .join(',\n');
}

const sharedStrings = parseSharedStrings(inputPath);
const workbookSheets = parseWorkbook(inputPath);
const sheetEntry = workbookSheets.get(SHEET_NAME);

if (!sheetEntry) {
  throw new Error(`Sheet not found: ${SHEET_NAME}`);
}

const rows = parseSheetRows(inputPath, sheetEntry, sharedStrings);
const headerRow = rows.find((r) => r.rowNumber === 1);
if (!headerRow) {
  throw new Error('Header row not found on sheet ACOMPANHAMENTO - OS');
}

const headers = Object.entries(headerRow.cells)
  .sort((a, b) => colToIndex(a[0]) - colToIndex(b[0]))
  .map(([col, value]) => ({ col, value }));

const dataRows = rows.filter((r) => r.rowNumber > 1 && (r.cells.C || '').trim());

const contracts = dataRows.map((row) => {
  const client = (row.cells.C || '').trim();
  const orderService = (row.cells.B || '').trim();
  const op = (row.cells.A || '').trim();
  const statusRaw = (row.cells.G || '').trim();
  const startDate = parseDate(row.cells.E);
  const endDate = parseDate(row.cells.F);
  const value = parseNumber(row.cells.J) || 0;

  const contractStatus = deriveStatus(statusRaw, endDate);
  const riskClassification = deriveRisk(statusRaw, contractStatus);

  const contractIdSuffix = (orderService || op || `row${row.rowNumber}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || `row-${row.rowNumber}`;

  return {
    id: `excel-${row.rowNumber}-${contractIdSuffix}`,
    name: orderService ? `OS ${orderService} - ${client}` : `OP ${op || row.rowNumber} - ${client}`,
    vendorOrParty: normalizeCompanyName(client),
    value,
    signingDate: toIsoDate(startDate),
    expirationDate: toIsoDate(endDate),
    riskClassification,
    status: contractStatus,
    uploadedAt: toIsoDate(startDate) || '2026-02-27',
    notes: (row.cells.M || '').trim() || undefined,
    totalInvoiced: parseNumber(row.cells.K) || 0,
    backlog: parseNumber(row.cells.L),
    sourceRow: row.rowNumber,
  };
});

const totals = contracts.reduce(
  (acc, contract) => {
    const backlog = contract.backlog == null ? Math.max(contract.value - contract.totalInvoiced, 0) : contract.backlog;
    acc.totalContracted += contract.value;
    acc.totalInvoiced += contract.totalInvoiced;
    acc.backlogToInvoice += backlog;
    return acc;
  },
  { totalContracted: 0, totalInvoiced: 0, backlogToInvoice: 0 }
);

const companyMap = new Map();
for (const contract of contracts) {
  const key = contract.vendorOrParty;
  const backlog = contract.backlog == null ? Math.max(contract.value - contract.totalInvoiced, 0) : contract.backlog;
  const current = companyMap.get(key) || {
    company: key,
    totalContracted: 0,
    backlogToInvoice: 0,
    contractsCount: 0,
  };

  current.totalContracted += contract.value;
  current.backlogToInvoice += backlog;
  current.contractsCount += 1;
  companyMap.set(key, current);
}

const companyBreakdown = [...companyMap.values()].sort((a, b) => b.totalContracted - a.totalContracted);

const contractRowsText = contracts.map(serializeContract).join(',\n');
const companyRowsText = serializeObjectArray(companyBreakdown, ['company', 'totalContracted', 'backlogToInvoice', 'contractsCount']);

const generated = `/* eslint-disable */
// AUTO-GENERATED FILE. DO NOT EDIT MANUALLY.
// Generated by scripts/sync-contracts-from-excel.mjs
// Source: ${inputPath}
// Sheet: ${SHEET_NAME}
// Headers: ${headers.map((h) => `${h.col}=${h.value}`).join(' | ')}

import type { Contract } from '@/lib/types';

export const EXCEL_SYNC_META = {
  sourcePath: ${JSON.stringify(inputPath)},
  sheetName: ${JSON.stringify(SHEET_NAME)},
  synchronizedAt: ${JSON.stringify(new Date().toISOString())},
  totalRowsSynchronized: ${contracts.length},
} as const;

export const excelContracts: Contract[] = [
${contractRowsText}
];

export const excelPortfolioTotals = {
  totalContracted: ${Number(totals.totalContracted.toFixed(2))},
  totalInvoiced: ${Number(totals.totalInvoiced.toFixed(2))},
  backlogToInvoice: ${Number(totals.backlogToInvoice.toFixed(2))},
  totalContracts: ${contracts.length},
};

export const excelCompanyBreakdown = [
${companyRowsText}
];
`;

writeFileSync(resolve(outputPath), generated, 'utf8');

console.log(`Synchronized ${contracts.length} rows from ${SHEET_NAME}`);
console.log(`Output: ${resolve(outputPath)}`);
