// Downloads the European Parliament's MEP lists and saves each MEP's national party
// to public/data/parties.json. The website reads that file, because browsers are not
// allowed to read the EP's lists directly from another website (no CORS headers).
//
// Who runs this?
//  - GitHub Actions, once a day and on every push (see .github/workflows/deploy.yml)
//  - server.js, when you start the app on your own computer and the file is missing or old
//  - you, by hand:  npm run update-parties
//
// If the download fails, the existing file is left alone, so the site keeps working.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PARTIES_FILE = path.join(ROOT, 'public', 'data', 'parties.json');

const EP_URLS = (process.env.EP_XML_URLS ||
  'https://www.europarl.europa.eu/meps/en/full-list/xml,' +
  'https://www.europarl.europa.eu/meps/en/incoming-outgoing/outgoing/xml')
  .split(',').map((s) => s.trim()).filter(Boolean);

// A healthy list has 700+ MEPs; anything much smaller means a download went wrong.
const MIN_HEALTHY = 300;

// ---------- reading the EP's answer ----------

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

// Reads <name>text</name>, also when the tag has attributes like <country countryCode="HU">.
function xmlField(block, name) {
  const match = block.match(new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[2]) : null;
}

function xmlAttribute(block, name, attribute) {
  const match = block.match(new RegExp(`<${name}\\s[^>]*${attribute}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

const cleanParty = (p) => (p && p.trim() && p.trim() !== '-' ? p.trim() : null);

// Turns one EP list into { "<mep id>": { party, short? } }.
// The EP site answers in XML or JSON depending on the request, so we understand both.
export function parseMepList(text) {
  const meps = {};
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    for (const m of JSON.parse(trimmed).list || []) {
      const party = cleanParty(m.nationalPoliticalGroupLabel);
      if (m.persId && party) meps[m.persId] = { party };
    }
    return meps;
  }
  for (const [, block] of text.matchAll(/<mep>([\s\S]*?)<\/mep>/g)) {
    const id = xmlField(block, 'id');
    const party = cleanParty(xmlField(block, 'nationalPoliticalGroup'));
    if (!id || !party) continue;
    const entry = { party };
    // Some lists include a short party name, e.g. bodyCode="Fidesz-KDNP".
    const short = cleanParty(xmlAttribute(block, 'nationalPoliticalGroup', 'bodyCode'));
    if (short) entry.short = short;
    meps[id] = entry;
  }
  return meps;
}

// ---------- downloading ----------

export async function downloadParties() {
  const meps = {};
  const errors = [];
  // The outgoing list goes first, so the current list wins when an MEP appears in both.
  for (const url of [...EP_URLS].reverse()) {
    try {
      const res = await fetch(url, {
        // Important: the EP site sends JSON instead of XML when a request prefers JSON.
        headers: { Accept: 'application/xml, text/xml;q=0.9, */*;q=0.1', 'User-Agent': 'Mozilla/5.0 (EuroVote)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const text = await res.text();
      const found = parseMepList(text);
      const n = Object.keys(found).length;
      if (n === 0) throw new Error(`no MEPs found (answer starts with: ${text.slice(0, 80).replace(/\s+/g, ' ')})`);
      console.log(`  ${n} MEPs from ${url}`);
      Object.assign(meps, found);
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  return { meps, errors };
}

async function existingCount() {
  try { return JSON.parse(await readFile(PARTIES_FILE, 'utf8')).count || 0; } catch { return 0; }
}

// Returns true when the file was (re)written.
export async function updateParties() {
  console.log('Updating the national party list…');
  const { meps, errors } = await downloadParties();
  const count = Object.keys(meps).length;
  for (const e of errors) console.warn(`  Problem: ${e}`);

  if (count < MIN_HEALTHY) {
    const old = await existingCount();
    console.warn(`  Only ${count} MEPs found; keeping the existing file (${old} MEPs).`);
    return false;
  }
  // Sorted keys, so the file only changes when the data really changes (cleaner git history).
  const sorted = Object.fromEntries(Object.keys(meps).sort().map((id) => [id, meps[id]]));
  try {
    const old = JSON.parse(await readFile(PARTIES_FILE, 'utf8'));
    if (JSON.stringify(old.meps) === JSON.stringify(sorted)) {
      console.log(`  No changes (${count} MEPs).`);
      return true;
    }
  } catch { /* no old file yet */ }
  const data = { updated: new Date().toISOString().slice(0, 10), count, meps: sorted };
  await mkdir(path.dirname(PARTIES_FILE), { recursive: true });
  await writeFile(PARTIES_FILE, JSON.stringify(data, null, 0) + '\n', 'utf8');
  console.log(`  Saved ${count} MEPs to public/data/parties.json`);
  return true;
}

// Run directly ("node scripts/update-parties.mjs"): exit code 1 if it failed,
// so GitHub shows a red cross, but the deploy still goes ahead with the old file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateParties().then((ok) => { process.exitCode = ok ? 0 : 1; });
}
