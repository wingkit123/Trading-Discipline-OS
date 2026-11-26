import AdmZip from 'adm-zip';
import { ServiceError } from './trade-service.js';

function colLettersToIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readSharedStrings(zip: AdmZip): string[] {
  const sstEntry = zip.getEntry('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (!sstEntry) return shared;
  const sstXml = sstEntry.getData().toString('utf8');
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let si: RegExpExecArray | null;
  while ((si = siRe.exec(sstXml)) !== null) {
    const parts: string[] = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(si[1])) !== null) parts.push(unescapeXml(t[1]));
    shared.push(parts.join(''));
  }
  return shared;
}

function resolveSheetTargets(zip: AdmZip): Array<{ name: string; entryPath: string }> {
  const wbEntry = zip.getEntry('xl/workbook.xml');
  const relsEntry = zip.getEntry('xl/_rels/workbook.xml.rels');
  const rIdToPath = new Map<string, string>();
  if (relsEntry) {
    const relsXml = relsEntry.getData().toString('utf8');
    for (const m of relsXml.matchAll(/<Relationship\b([^>]+)\/?>/g)) {
      const attrs = m[1];
      const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
      if (id && target) {
        const clean = target.replace(/^\/+/, '');
        rIdToPath.set(id, clean.startsWith('xl/') ? clean : `xl/${clean}`);
      }
    }
  }
  if (wbEntry) {
    const wbXml = wbEntry.getData().toString('utf8');
    const sheets: Array<{ name: string; entryPath: string }> = [];
    for (const m of wbXml.matchAll(/<sheet\b([^>]+)\/?>/g)) {
      const attrs = m[1];
      const name = /\bname="([^"]+)"/.exec(attrs)?.[1] ?? 'Sheet';
      const rId = /\br:id="([^"]+)"/.exec(attrs)?.[1];
      const entryPath = rId ? rIdToPath.get(rId) : undefined;
      if (entryPath && zip.getEntry(entryPath)) sheets.push({ name: unescapeXml(name), entryPath });
    }
    if (sheets.length) return sheets;
  }
  return zip
    .getEntries()
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName))
    .map((e) => ({ name: e.entryName.replace(/^.*\//, '').replace(/\.xml$/, ''), entryPath: e.entryName }));
}

function parseWorksheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rMatch: RegExpExecArray | null;
  while ((rMatch = rowRe.exec(xml)) !== null) {
    const row: string[] = [];
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = cRe.exec(rMatch[1])) !== null) {
      const attrs = cMatch[1];
      const inner = cMatch[2] ?? '';
      const refM = attrs.match(/\br="([A-Z]+\d+)"/i);
      const typeM = attrs.match(/\bt="([^"]+)"/i);
      const colIdx = refM ? colLettersToIndex(refM[1]) : row.length;
      while (row.length <= colIdx) row.push('');
      if (!inner) continue;
      const vM = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
      const isM = inner.match(/<is[^>]*>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      if (isM) {
        row[colIdx] = unescapeXml(isM[1]);
      } else if (vM) {
        const rawVal = unescapeXml(vM[1]);
        row[colIdx] = typeM?.[1] === 's' ? (shared[Number(rawVal)] ?? '') : rawVal;
      }
    }
    if (row.some((c) => c.trim())) rows.push(row);
  }
  return rows;
}

export function readXlsxWorkbook(buf: Buffer): Array<{ name: string; rows: string[][] }> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buf);
  } catch {
    throw new ServiceError('Invalid XLSX archive');
  }
  const shared = readSharedStrings(zip);
  const targets = resolveSheetTargets(zip);
  if (!targets.length) throw new ServiceError('No worksheet found in XLSX');
  return targets.map((t) => ({
    name: t.name,
    rows: parseWorksheetRows(zip.getEntry(t.entryPath)!.getData().toString('utf8'), shared),
  }));
}
