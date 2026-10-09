// Turns raw API answers into the shapes the views need: filtered MEP lists,
// per-group/country/party counts, "rebels", and CSV text.

export const POSITIONS = ['FOR', 'AGAINST', 'ABSTENTION', 'DID_NOT_VOTE'];
export const POSITION_LABEL = {
  FOR: 'For',
  AGAINST: 'Against',
  ABSTENTION: 'Abstained',
  DID_NOT_VOTE: "Didn't vote",
};
export const VOTED = ['FOR', 'AGAINST', 'ABSTENTION'];

export const DIMENSIONS = {
  group: { label: 'Political group', plural: 'political groups' },
  country: { label: 'Country', plural: 'countries' },
  party: { label: 'National party', plural: 'national parties' },
};

// Groups in the order they sit in the hemicycle (left to right), so lists feel familiar.
const GROUP_ORDER = ['GUE_NGL', 'GREEN_EFA', 'SD', 'RENEW', 'EPP', 'ECR', 'PFE', 'ESN', 'NI'];

// A flag emoji is made of two "regional indicator" letters, e.g. N + L = 🇳🇱.
export function flag(iso2) {
  if (!iso2 || iso2.length !== 2) return '';
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Combines the vote from HowTheyVote with the party list from the European Parliament.
export function buildMembers(vote, parties, htvBase = 'https://howtheyvote.eu') {
  const partyMap = parties?.meps || {};
  return vote.member_votes.map(({ member, position }) => {
    const partyName = partyMap[String(member.id)]?.party || null;
    return {
      id: member.id,
      name: member.full_name,
      firstName: member.first_name,
      lastName: member.last_name,
      country: member.country,
      group: member.group
        ? { code: member.group.code, short: member.group.short_label || member.group.code, label: member.group.label }
        : { code: 'UNKNOWN', short: 'Unknown', label: 'Unknown group' },
      party: partyName,
      // A party name can exist in two countries, so the key includes the country.
      partyKey: partyName ? `${member.country.code}|${partyName}` : `${member.country.code}|?`,
      position,
      photo: member.thumb_url ? new URL(member.thumb_url, htvBase).href : null,
    };
  });
}

export function emptyCounts() {
  return { FOR: 0, AGAINST: 0, ABSTENTION: 0, DID_NOT_VOTE: 0 };
}

export function countPositions(members) {
  const counts = emptyCounts();
  for (const m of members) counts[m.position] = (counts[m.position] || 0) + 1;
  return counts;
}

export const votedTotal = (c) => c.FOR + c.AGAINST + c.ABSTENTION;
export const allTotal = (c) => votedTotal(c) + c.DID_NOT_VOTE;

// The position most MEPs in a set took (ignoring those who didn't vote).
// Returns null if nobody voted or if there is a tie, because then there is no clear "line".
export function majorityPosition(counts) {
  const ranked = VOTED.map((p) => [p, counts[p]]).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === 0 || ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

// Marks each MEP who voted differently from the majority of their group / national party.
// The "line" is always computed on ALL members of the vote, not just the filtered ones.
export function markRebels(members) {
  const byGroup = new Map();
  const byParty = new Map();
  for (const m of members) {
    if (!byGroup.has(m.group.code)) byGroup.set(m.group.code, []);
    byGroup.get(m.group.code).push(m);
    if (m.party) {
      if (!byParty.has(m.partyKey)) byParty.set(m.partyKey, []);
      byParty.get(m.partyKey).push(m);
    }
  }
  const groupLine = new Map([...byGroup].map(([k, list]) => [k, majorityPosition(countPositions(list))]));
  const partyLine = new Map([...byParty].map(([k, list]) => {
    const counts = countPositions(list);
    // A party line only means something if at least two of its MEPs voted.
    return [k, votedTotal(counts) >= 2 ? majorityPosition(counts) : null];
  }));

  for (const m of members) {
    const voted = VOTED.includes(m.position);
    const gLine = m.group.code === 'NI' ? null : groupLine.get(m.group.code); // non-attached have no group line
    const pLine = m.party ? partyLine.get(m.partyKey) : null;
    m.groupLine = gLine;
    m.partyLine = pLine;
    m.groupRebel = Boolean(voted && gLine && m.position !== gLine);
    m.partyRebel = Boolean(voted && pLine && m.position !== pLine);
  }
  return { groupLine, partyLine };
}

// filters = { countries: Set, groups: Set, parties: Set }; an empty set means "everything".
export function applyFilters(members, filters) {
  return members.filter((m) =>
    (!filters.countries.size || filters.countries.has(m.country.code)) &&
    (!filters.groups.size || filters.groups.has(m.group.code)) &&
    (!filters.parties.size || filters.parties.has(m.partyKey)));
}

function keyFor(m, dimension) {
  if (dimension === 'group') return m.group.code;
  if (dimension === 'country') return m.country.code;
  return m.partyKey;
}

function labelFor(m, dimension) {
  if (dimension === 'group') return { label: m.group.short, long: m.group.label, prefix: '' };
  if (dimension === 'country') return { label: m.country.label, long: m.country.label, prefix: flag(m.country.iso_alpha_2) };
  return {
    label: m.party || `Unknown party (${m.country.label})`,
    long: m.party ? `${m.party} (${m.country.label})` : `Party unknown, ${m.country.label}`,
    prefix: flag(m.country.iso_alpha_2),
  };
}

// One row per group/country/party with its vote counts.
export function aggregate(members, dimension) {
  const rows = new Map();
  for (const m of members) {
    const key = keyFor(m, dimension);
    if (!rows.has(key)) rows.set(key, { key, ...labelFor(m, dimension), counts: emptyCounts(), members: 0 });
    const row = rows.get(key);
    row.counts[m.position] += 1;
    row.members += 1;
  }
  return [...rows.values()];
}

export const SORTS = {
  for: { label: 'Most in favour', fn: (a, b) => share(b, 'FOR') - share(a, 'FOR') || b.members - a.members },
  against: { label: 'Most against', fn: (a, b) => share(b, 'AGAINST') - share(a, 'AGAINST') || b.members - a.members },
  size: { label: 'Largest first', fn: (a, b) => b.members - a.members || a.label.localeCompare(b.label) },
  name: { label: 'A to Z', fn: (a, b) => a.label.localeCompare(b.label) },
  seating: {
    label: 'Seating order',
    fn: (a, b) => groupIndex(a.key) - groupIndex(b.key) || a.label.localeCompare(b.label),
  },
};

function groupIndex(code) {
  const i = GROUP_ORDER.indexOf(code);
  return i === -1 ? 99 : i;
}

// Share of a position among MEPs who voted (absentees are not counted).
export function share(row, position) {
  const total = votedTotal(row.counts);
  return total ? row.counts[position] / total : -1;
}

export function percent(part, whole) {
  if (!whole) return '–';
  const p = (part / whole) * 100;
  if (p > 0 && p < 1) return '<1%';
  if (p < 100 && p > 99) return '>99%';
  return `${Math.round(p)}%`;
}

// ---------- descriptions used in titles and filenames ----------

export function describeSelection(filters, lookups) {
  const parts = [];
  const names = (set, map) => [...set].map((k) => map.get(k) || k);
  if (filters.parties.size) parts.push(joinNames(names(filters.parties, lookups.parties)));
  if (filters.groups.size) parts.push(joinNames(names(filters.groups, lookups.groups)));
  if (filters.countries.size) parts.push(joinNames(names(filters.countries, lookups.countries)));
  return parts.length ? parts.join(' · ') : 'All MEPs';
}

function joinNames(list) {
  if (list.length <= 3) return list.join(', ');
  return `${list.slice(0, 2).join(', ')} and ${list.length - 2} more`;
}

export function slug(text) {
  return text
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ---------- CSV ----------

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function rowsToCsv(rows, dimension) {
  return toCsv(
    [DIMENSIONS[dimension].label, 'MEPs', 'For', 'Against', 'Abstained', "Didn't vote", '% for (of those who voted)', '% against (of those who voted)', '% abstained (of those who voted)'],
    rows.map((r) => {
      const v = votedTotal(r.counts);
      const pct = (p) => (v ? ((r.counts[p] / v) * 100).toFixed(1) : '');
      return [r.long, r.members, r.counts.FOR, r.counts.AGAINST, r.counts.ABSTENTION, r.counts.DID_NOT_VOTE, pct('FOR'), pct('AGAINST'), pct('ABSTENTION')];
    }),
  );
}

export function membersToCsv(members) {
  return toCsv(
    ['MEP ID', 'Name', 'Country', 'Political group', 'National party', 'Vote', 'Group majority', 'Against group majority', 'Party majority', 'Against party majority'],
    members.map((m) => [
      m.id, m.name, m.country.label, m.group.short, m.party || '', POSITION_LABEL[m.position],
      m.groupLine ? POSITION_LABEL[m.groupLine] : '', m.groupRebel ? 'yes' : 'no',
      m.partyLine ? POSITION_LABEL[m.partyLine] : '', m.partyRebel ? 'yes' : 'no',
    ]),
  );
}

// ---------- parsing what the user types into the search box ----------

// Accepts a vote ID ("198051"), a MEPWatch link, or a HowTheyVote link.
export function voteIdFromInput(text) {
  const t = text.trim();
  if (/^\d{4,8}$/.test(t)) return t;
  const fromQuery = t.match(/[?&]v=(\d{4,8})/);
  if (fromQuery) return fromQuery[1];
  const fromPath = t.match(/votes\/(\d{4,8})/);
  if (fromPath) return fromPath[1];
  return null;
}
