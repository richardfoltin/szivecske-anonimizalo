/**
 * Valósághű magyar jogi PDF előállítása a spike 2-höz.
 *
 * Szándékosan HARMADIK FÉL készíti a PDF-et (fejnélküli Chrome), nem mi — így a
 * betűkészlet-beágyazás, a részhalmazolás és a tartalomfolyam szerkezete olyan,
 * amilyennel a valóságban találkozunk, nem olyan, amit magunknak kényelmesre
 * gyártottunk.
 *
 *   npx tsx spike/make-sample-pdf.ts
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'spike', 'out');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

function findChrome(): string {
  for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c;
  throw new Error('Nem találtam Chrome-ot vagy Edge-et a PDF előállításához.');
}

/** A jogi irat HTML-je. Times-szerű szedés, ahogy egy bírósági beadvány kinéz. */
function buildHtml(text: string, title: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      // A ritkított nagybetűs címsorok ("K E R E S E T L E V E L E T") kiemelése.
      const isHeading = /^[A-ZÁÉÍÓÖŐÚÜŰ .]+$/.test(trimmed) && trimmed.length < 80;
      const cls = isHeading ? ' class="h"' : '';
      return `<p${cls}>${escapeHtml(trimmed).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 25mm 20mm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 11.5pt; line-height: 1.5; color: #000; }
  p { margin: 0 0 10pt; text-align: justify; }
  p.h { text-align: center; font-weight: bold; letter-spacing: 0.08em; margin: 16pt 0; }
</style></head><body>
${paragraphs}
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function makeSamplePdf(sampleStem: string): string {
  mkdirSync(OUT, { recursive: true });
  const sample = JSON.parse(readFileSync(join(ROOT, 'samples', `${sampleStem}.json`), 'utf8')) as {
    text: string;
    kind: string;
  };

  const htmlPath = join(OUT, `${sampleStem}.html`);
  const pdfPath = join(OUT, `${sampleStem}.pdf`);
  writeFileSync(htmlPath, buildHtml(sample.text, sample.kind), 'utf8');

  execFileSync(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: 'pipe', timeout: 120_000 },
  );

  if (!existsSync(pdfPath)) throw new Error('A PDF nem jött létre.');
  return pdfPath;
}

if (process.argv[1] && process.argv[1].endsWith('make-sample-pdf.ts')) {
  const stem = process.argv[2] ?? 'keresetlevel';
  const p = makeSamplePdf(stem);
  const size = readFileSync(p).length;
  console.log(`PDF kész: ${p} (${(size / 1024).toFixed(1)} kB)`);
}
