// Builds public/data/parties.json: which national party every MEP of this term
// belongs to (and since/until when). The website reads that file, because a
// browser is not allowed to read the European Parliament's data from another
// website (no CORS headers).
//
// Source 1 (preferred): the EP's Open Data API, made for programs like this one.
//   https://data.europarl.europa.eu/api/v2/  (term MEPs → their memberships → party names)
// Source 2 (fallback): the MEP lists on www.europarl.europa.eu (XML). Only used if
//   source 1 fails; it has no dates and that site sometimes blocks automated requests.
//
// Who runs this?
//  - GitHub Actions, once a day and on every push (see .github/workflows/deploy.yml)
//  - server.js, when you start the app on your own computer and the file is missing or old
//  - you, by hand:  npm run update-parties
//
// If both sources fail, the existing file is left alone, so the site keeps working.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PARTIES_FILE = path.join(ROOT, 'public', 'data', 'parties.json');

const TERM = Number(process.env.EP_TERM || 10);
const API = process.env.EP_API || 'https://data.europarl.europa.eu/api/v2';
const XML_URLS = (process.env.EP_XML_URLS ||
  'https://www.europarl.europa.eu/meps/en/full-list/xml,' +
  'https://www.europarl.europa.eu/meps/en/incoming-outgoing/outgoing/xml')
  .split(',').map((s) => s.trim()).filter(Boolean);

const MIN_HEALTHY = 300; // a term has 700+ MEPs; far fewer means something went wrong
const BATCH = 100;       // the API accepts up to ~100 comma-separated ids per request
const NATIONAL_PARTY = 'def/ep-entities/NATIONAL_POLITICAL_GROUP';
const HEADERS = { 'User-Agent': 'EuroVote (+https://github.com/Teunemans/eurovote)' };

const cleanParty = (p) => (p && p.trim() && p.trim() !== '-' ? p.trim() : null);
const idOf = (ref) => String(ref).split('/').pop(); // "org/6758" → "6758"

async function getJson(url, accept = 'application/ld+json') {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { ...HEADERS, Accept: accept }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt)); // short pause, then retry
    }
  }
}

// ---------- the shape of parties.json ----------
//
// {
//   "updated": "2026-10-09", "source": "EP Open Data API", "count": 745,
//   "orgs": { "6758": { "name": "Parti Socialiste", "short": "PS" }, ... },
//   "meps": { "1294": [["6758", "2024-07-16", null]], ... }   ← [party id, from, until]
// }
// An MEP can have several entries when they switched party during the term;
// the website picks the one that was valid on the day of the vote.

export function buildFile(persons, orgList, source) {
  const orgs = {};
  for (const o of orgList) {
    const name = cleanParty(o.prefLabel?.en || o.label);
    if (name) orgs[String(o.identifier)] = { name, short: cleanParty(o.label) || name };
  }
  const meps = {};
  for (const p of persons) {
    const periods = (p.memberships || [])
      .filter((m) => orgs[m.org])
      .sort((a, b) => String(a.start).localeCompare(String(b.start)))
      .map((m) => [m.org, m.start || null, m.end || null]);
    if (periods.length) meps[String(p.id)] = periods;
  }
  const sortKeys = (obj) => Object.fromEntries(Object.keys(obj).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)).map((k) => [k, obj[k]]));
  return { source, count: Object.keys(meps).length, orgs: sortKeys(orgs), meps: sortKeys(meps) };
}

// Keeps only the national-party memberships of one API "Person" (they also list
// committees, delegations, …), and only those that overlap with this term.
export function partyMemberships(person, termStart) {
  return (person.hasMembership || [])
    .filter((m) => m.membershipClassification === NATIONAL_PARTY)
    .map((m) => ({ org: idOf(m.organization), start: m.memberDuring?.startDate, end: m.memberDuring?.endDate }))
    .filter((m) => !m.end || !termStart || m.end >= termStart);
}

// ---------- source 1: EP Open Data API ----------

async function fromOpenDataApi() {
  const fmt = 'format=application%2Fld%2Bjson';
  const list = await getJson(`${API}/meps?parliamentary-term=${TERM}&${fmt}&offset=0&limit=2000`);
  const ids = list.data.map((m) => m.identifier);
  console.log(`  ${ids.length} MEPs in term ${TERM}`);

  const termStart = { 10: '2024-07-16', 9: '2019-07-02' }[TERM] || null;
  const persons = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const res = await getJson(`${API}/meps/${chunk.join(',')}?${fmt}`);
    for (const p of res.data) persons.push({ id: p.identifier, memberships: partyMemberships(p, termStart) });
  }

  const orgIds = [...new Set(persons.flatMap((p) => p.memberships.map((m) => m.org)))];
  const orgs = [];
  for (let i = 0; i < orgIds.length; i += BATCH) {
    const res = await getJson(`${API}/corporate-bodies/${orgIds.slice(i, i + BATCH).join(',')}?${fmt}`);
    orgs.push(...res.data);
  }
  console.log(`  ${orgIds.length} national parties`);
  return buildFile(persons, orgs, 'EP Open Data API');
}

// ---------- source 2: the XML lists on europarl.europa.eu ----------

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

function xmlField(block, name) {
  const match = block.match(new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[2]) : null;
}

function xmlAttribute(block, name, attribute) {
  const match = block.match(new RegExp(`<${name}\\s[^>]*${attribute}="([^"]*)"`));
  return match ? decodeXml(match[1]) : null;
}

// One XML (or JSON) list → { "<mep id>": { party, short } }
export function parseMepList(text) {
  const meps = {};
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    for (const m of JSON.parse(trimmed).list || []) {
      const party = cleanParty(m.nationalPoliticalGroupLabel);
      if (m.persId && party) meps[m.persId] = { party, short: party };
    }
    return meps;
  }
  for (const [, block] of text.matchAll(/<mep>([\s\S]*?)<\/mep>/g)) {
    const id = xmlField(block, 'id');
    const party = cleanParty(xmlField(block, 'nationalPoliticalGroup'));
    if (id && party) meps[id] = { party, short: cleanParty(xmlAttribute(block, 'nationalPoliticalGroup', 'bodyCode')) || party };
  }
  return meps;
}

async function fromXmlLists() {
  const found = {};
  for (const url of [...XML_URLS].reverse()) { // current list last, so it wins
    const res = await fetch(url, {
      // The EP site sends JSON instead of XML when a request prefers JSON.
      headers: { ...HEADERS, Accept: 'application/xml, text/xml;q=0.9, */*;q=0.1' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    Object.assign(found, parseMepList(await res.text()));
  }
  // Turn names into the same shape as the API version (the name doubles as the id).
  const orgs = {};
  const persons = Object.entries(found).map(([id, { party, short }]) => {
    orgs[party] = { identifier: party, label: short, prefLabel: { en: party } };
    return { id, memberships: [{ org: party }] };
  });
  return buildFile(persons, Object.values(orgs), 'europarl.europa.eu MEP lists');
}

// ---------- main ----------

async function readExisting() {
  try { return JSON.parse(await readFile(PARTIES_FILE, 'utf8')); } catch { return null; }
}

// Returns true when the file is up to date afterwards.
export async function updateParties() {
  console.log('Updating the national party list…');
  let data = null;
  for (const [name, load] of [['EP Open Data API', fromOpenDataApi], ['europarl.europa.eu XML', fromXmlLists]]) {
    try {
      data = await load();
      if (data.count >= MIN_HEALTHY) break;
      console.warn(`  ${name}: only ${data.count} MEPs, trying the next source`);
    } catch (err) {
      console.warn(`  ${name} failed: ${err.message}`);
    }
    data = null;
  }

  const old = await readExisting();
  if (!data) {
    console.warn(`  Keeping the existing file (${old?.count ?? 0} MEPs).`);
    return false;
  }
  if (old && JSON.stringify(old.meps) === JSON.stringify(data.meps) && JSON.stringify(old.orgs) === JSON.stringify(data.orgs)) {
    console.log(`  No changes (${data.count} MEPs).`);
    return true;
  }
  await mkdir(path.dirname(PARTIES_FILE), { recursive: true });
  await writeFile(PARTIES_FILE, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), ...data }) + '\n', 'utf8');
  console.log(`  Saved ${data.count} MEPs from the ${data.source} to public/data/parties.json`);
  return true;
}

// Run directly ("node scripts/update-parties.mjs"): exit code 1 if it failed,
// so GitHub shows a red cross, but the deploy still goes ahead with the old file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateParties().then((ok) => { process.exitCode = ok ? 0 : 1; });
}
