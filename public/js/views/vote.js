// The vote page: header, filters, overview, breakdown chart and the MEP table.

import { getVote, getParties } from '../api.js';
import {
  POSITIONS, VOTED, POSITION_LABEL, DIMENSIONS, SORTS, buildMembers, markRebels, applyFilters,
  aggregate, countPositions, votedTotal, allTotal, percent, describeSelection, slug, flag,
  rowsToCsv, membersToCsv,
} from '../data.js';
import { stackedBars, themeFromCss, LIGHT_THEME } from '../chart.js';
import { downloadCsv, downloadSvg, svgToPng, downloadBlob, copyPng } from '../export.js';
import { h, icon, toast, formatDate, multiSelect, captureDropdownState, restoreDropdownState } from '../ui.js';
import { rememberVote } from './search.js';

const EXPORT_WIDTH = 1200;
const PARTY_ROW_LIMIT = 20;
const TABLE_ROW_LIMIT = 60;

let current = null; // everything about the vote that is on screen right now
let resizeObserver = null;

// Charts have their colours written into the SVG, so redraw them when the theme changes.
window.addEventListener('eurovote:themechange', () => {
  if (current && document.getElementById('breakdown-card')) { renderOverview(); renderBreakdown(); }
});

// ---------- reading and writing the address bar ----------

function stateFromParams(params) {
  const list = (key) => new Set(params.getAll(key).flatMap((v) => v.split(',')).filter(Boolean));
  return {
    by: DIMENSIONS[params.get('by')] ? params.get('by') : 'group',
    sort: SORTS[params.get('sort')] ? params.get('sort') : 'for',
    includeAbsent: params.get('abs') === '1',
    scale: params.get('scale') === 'seats' ? 'seats' : 'percent',
    showAllRows: false,
    filters: {
      countries: list('c'),
      groups: list('g'),
      // Party keys contain commas in rare cases, so they are not comma-split.
      parties: new Set(params.getAll('p')),
    },
    table: { pos: 'all', q: '', sortKey: 'position', dir: 1, showAll: false },
  };
}

function writeUrl() {
  const s = current.state;
  const params = new URLSearchParams();
  if (s.by !== 'group') params.set('by', s.by);
  if (s.sort !== 'for') params.set('sort', s.sort);
  if (s.includeAbsent) params.set('abs', '1');
  if (s.scale === 'seats') params.set('scale', 'seats');
  if (s.filters.countries.size) params.set('c', [...s.filters.countries].join(','));
  if (s.filters.groups.size) params.set('g', [...s.filters.groups].join(','));
  for (const p of s.filters.parties) params.append('p', p);
  const qs = params.toString();
  history.replaceState(null, '', `#/vote/${current.vote.id}${qs ? '?' + qs : ''}`);
}

// ---------- entry point ----------

export async function renderVote(app, id, params) {
  resizeObserver?.disconnect();
  app.replaceChildren(h('div', { class: 'loading' }, h('div', { class: 'spinner' }), `Loading vote ${id}…`));

  let vote;
  let parties;
  try {
    [vote, parties] = await Promise.all([getVote(id), getParties()]);
  } catch (err) {
    app.replaceChildren(h('div', { class: 'error-box' },
      h('h2', {}, 'This vote could not be loaded'),
      h('p', {}, err.message),
      h('button', { class: 'btn', onclick: () => renderVote(app, id, params) }, 'Try again'),
      ' ',
      h('a', { class: 'btn ghost', href: '#/' }, 'Back to search')));
    return;
  }

  const members = buildMembers(vote, parties);
  markRebels(members);
  current = {
    app,
    vote,
    parties,
    members,
    state: stateFromParams(params),
    lookups: buildLookups(members),
  };
  rememberVote(vote);
  document.title = `${vote.display_title || 'Vote'} · EuroVote`;
  renderPage();
}

function buildLookups(members) {
  const countries = new Map();
  const groups = new Map();
  const parties = new Map();
  for (const m of members) {
    countries.set(m.country.code, m.country.label);
    groups.set(m.group.code, m.group.short);
    parties.set(m.partyKey, m.party || `Unknown party (${m.country.label})`);
  }
  return { countries, groups, parties };
}

// ---------- page layout ----------

function renderPage() {
  const { app, vote } = current;
  resizeObserver?.disconnect();

  const page = h('div', { class: 'vote-page' },
    h('a', { class: 'back-link', href: '#/' }, icon('back'), 'All votes'),
    renderHeader(vote),
    h('div', { class: 'filter-bar', id: 'filter-bar' }),
    h('section', { class: 'card', id: 'overview-card', 'aria-labelledby': 'overview-title' }),
    h('section', { class: 'card', id: 'breakdown-card', 'aria-labelledby': 'breakdown-title' }),
    h('section', { class: 'card', id: 'table-card', 'aria-labelledby': 'table-title' }),
  );
  app.replaceChildren(page);
  renderAll();

  // Redraw the charts when the window (and so the card) changes width.
  let lastWidth = 0;
  resizeObserver = new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (w !== lastWidth) { lastWidth = w; renderOverview(); renderBreakdown(); }
  });
  resizeObserver.observe(document.getElementById('breakdown-card'));
}

function renderAll() {
  renderFilterBar();
  renderOverview();
  renderBreakdown();
  renderTable();
  writeUrl();
}

function resultLabel(vote) {
  if (vote.result === 'ADOPTED') return { text: 'Adopted', cls: 'adopted' };
  if (vote.result === 'REJECTED') return { text: 'Rejected', cls: 'rejected' };
  if (vote.result) return { text: vote.result.charAt(0) + vote.result.slice(1).toLowerCase(), cls: 'neutral' };
  const t = vote.stats.total;
  return t.FOR > t.AGAINST
    ? { text: 'More for than against', cls: 'adopted', note: 'The official result is not published yet. Some votes need an absolute majority, so check the official minutes.' }
    : { text: 'Not more for than against', cls: 'rejected', note: 'The official result is not published yet.' };
}

function renderHeader(vote) {
  const result = resultLabel(vote);
  const t = vote.stats.total;
  const subtitleBits = [
    formatDate(vote.timestamp, true),
    vote.reference,
    vote.amendment_number ? `Amendment ${vote.amendment_number}` : null,
    vote.amendment_subject,
    vote.description,
  ].filter(Boolean);

  const links = [
    vote.document?.url ? ['Text on europarl.europa.eu', vote.document.url] : null,
    [`HowTheyVote.eu`, `https://howtheyvote.eu/votes/${vote.id}`],
    ['MEPWatch', `https://mepwatch.eu/10/vote.html?v=${vote.id}`],
  ].filter(Boolean);

  return h('header', { class: 'vote-head' },
    h('p', { class: 'eyebrow' }, subtitleBits.join(' · ')),
    h('h1', {}, vote.display_title || `Vote ${vote.id}`),
    h('div', { class: 'vote-head-row' },
      h('span', { class: `result-pill ${result.cls}`, title: result.note || '' },
        result.text, result.note ? ' (unofficial)' : ''),
      h('span', { class: 'head-totals' },
        `Whole Parliament: ${t.FOR} for · ${t.AGAINST} against · ${t.ABSTENTION} abstained · ${t.DID_NOT_VOTE} didn't vote`),
    ),
    h('p', { class: 'head-links' }, ...links.flatMap(([label, href], i) => [
      i ? ' · ' : null,
      h('a', { href, target: '_blank', rel: 'noopener' }, label, icon('external')),
    ])),
  );
}

// ---------- filter bar ----------

function setFilters(next) {
  current.state.filters = next;
  current.state.showAllRows = false;
  renderAll();
}

function renderFilterBar() {
  const bar = document.getElementById('filter-bar');
  const saved = captureDropdownState(bar);
  const { members, state, parties, lookups } = current;
  const f = state.filters;

  // Each dropdown only offers options that still exist given the OTHER filters,
  // e.g. choosing "Netherlands" limits the party list to Dutch parties.
  const without = (key) => applyFilters(members, { ...f, [key]: new Set() });
  const options = (list, keyFn, labelFn, prefixFn, sort) => {
    const map = new Map();
    for (const m of list) {
      const k = keyFn(m);
      if (!map.has(k)) map.set(k, { value: k, label: labelFn(m), prefix: prefixFn(m), n: 0, search: `${m.country.label} ${m.partyShort || ''}` });
      map.get(k).n += 1;
    }
    // Keep already selected values visible even if they no longer match.
    return [...map.values()].sort(sort).map((o) => ({ ...o, hint: `${o.n} MEP${o.n === 1 ? '' : 's'}` }));
  };

  const countryOpts = options(without('countries'), (m) => m.country.code, (m) => m.country.label, (m) => flag(m.country.iso_alpha_2), (a, b) => a.label.localeCompare(b.label));
  const groupOpts = options(without('groups'), (m) => m.group.code, (m) => m.group.short, () => '', (a, b) => SORTS.seating.fn({ key: a.value, label: a.label }, { key: b.value, label: b.label }));
  const partyOpts = options(without('parties'), (m) => m.partyKey, (m) => m.party || `Unknown party (${m.country.label})`, (m) => flag(m.country.iso_alpha_2), (a, b) => b.n - a.n || a.label.localeCompare(b.label));

  const controls = h('div', { class: 'filter-controls' },
    h('span', { class: 'filter-label' }, 'Show'),
    multiSelect({ label: 'Countries', options: countryOpts, selected: f.countries, onChange: (s) => setFilters({ ...f, countries: s }) }),
    multiSelect({ label: 'Groups', options: groupOpts, selected: f.groups, onChange: (s) => setFilters({ ...f, groups: s }) }),
    parties.count
      ? multiSelect({ label: 'Parties', options: partyOpts, selected: f.parties, onChange: (s) => setFilters({ ...f, parties: s }), placeholder: 'Search party or country…' })
      : h('span', { class: 'filter-warning', title: (parties.errors || []).join('\n') }, 'Party list unavailable'),
  );

  const chips = [];
  const chip = (text, onRemove) => h('button', { class: 'chip', type: 'button', onclick: onRemove, 'aria-label': `Remove filter ${text}` }, text, icon('close'));
  for (const c of f.countries) chips.push(chip(lookups.countries.get(c) || c, () => { const s = new Set(f.countries); s.delete(c); setFilters({ ...f, countries: s }); }));
  for (const g of f.groups) chips.push(chip(lookups.groups.get(g) || g, () => { const s = new Set(f.groups); s.delete(g); setFilters({ ...f, groups: s }); }));
  for (const p of f.parties) chips.push(chip(lookups.parties.get(p) || p.split('|')[1], () => { const s = new Set(f.parties); s.delete(p); setFilters({ ...f, parties: s }); }));
  if (chips.length > 1) {
    chips.push(h('button', { class: 'link-button', type: 'button', onclick: () => setFilters({ countries: new Set(), groups: new Set(), parties: new Set() }) }, 'Clear all'));
  }

  const selected = applyFilters(members, f);
  bar.replaceChildren(
    controls,
    h('div', { class: 'chip-row' },
      chips.length ? chips : h('span', { class: 'muted' }, 'All MEPs. Pick countries, groups or parties to narrow it down.'),
      h('span', { class: 'selection-count' }, `${selected.length} of ${members.length} MEPs`)),
  );
  restoreDropdownState(bar, saved);
}

// ---------- shared card pieces ----------

// Like replaceChildren, but skips empty (null) parts, which would otherwise show up as "null".
function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}

function selectionText() {
  return describeSelection(current.state.filters, current.lookups);
}

function exportButtons({ name, getChart, getCsv }) {
  // data-action lets the keyboard commands (keys.js) press these buttons, e.g. "wp" = PNG.
  const btn = (label, iconName, onClick, title) => h('button', { class: 'btn small ghost', type: 'button', onclick: onClick, title, 'data-action': label.toLowerCase() }, icon(iconName), label);
  const run = (fn) => async () => {
    try { await fn(); } catch (err) { toast(err.message, true); }
  };
  const base = `eurovote-${current.vote.id}-${name()}`;
  return h('div', { class: 'export-buttons', role: 'group', 'aria-label': 'Download or copy' },
    getChart ? btn('PNG', 'download', run(async () => {
      const c = getChart();
      downloadBlob(await svgToPng(c.svg, EXPORT_WIDTH, c.height), `${base}.png`);
    }), 'Download as image (white background, ready to share)') : null,
    getChart ? btn('SVG', 'download', run(() => downloadSvg(getChart().svg, `${base}.svg`)), 'Download as scalable vector image') : null,
    getCsv ? btn('CSV', 'download', run(() => downloadCsv(getCsv(), `${base}.csv`)), 'Download the numbers (opens in Excel)') : null,
    getChart ? btn('Copy', 'copy', run(async () => {
      const c = getChart();
      await copyPng(svgToPng(c.svg, EXPORT_WIDTH, c.height));
      toast('Image copied, paste it anywhere');
    }), 'Copy the image to the clipboard') : null,
  );
}

function exportSource(extra = '') {
  const v = current.vote;
  const date = formatDate(v.timestamp);
  return `Source: European Parliament roll-call vote ${v.id} (${date}), data from HowTheyVote.eu (ODbL)${extra}. Made with EuroVote, unofficial.`;
}

function legend(positions) {
  return h('ul', { class: 'legend', 'aria-label': 'Legend' },
    positions.map((p) => h('li', {}, h('span', { class: `swatch pos-${p}` }), POSITION_LABEL[p])));
}

// Shows a small box with exact numbers when you hover or focus a bar.
function attachTooltips(container, rowsByKey, includeAbsent) {
  const tip = h('div', { class: 'chart-tooltip', role: 'tooltip' });
  container.append(tip);
  const show = (rowEl, clientX, clientY) => {
    const row = rowsByKey.get(rowEl.dataset.key);
    if (!row) return;
    const total = includeAbsent ? allTotal(row.counts) : votedTotal(row.counts);
    tip.replaceChildren(
      h('strong', {}, `${row.prefix ? row.prefix + ' ' : ''}${row.long}`),
      h('table', {}, POSITIONS.map((p) => h('tr', {},
        h('td', {}, h('span', { class: `swatch pos-${p}` }), POSITION_LABEL[p]),
        h('td', { class: 'num' }, row.counts[p]),
        h('td', { class: 'num muted' }, p === 'DID_NOT_VOTE' && !includeAbsent ? '' : percent(row.counts[p], total))))),
      h('div', { class: 'muted' }, `${row.members} MEP${row.members === 1 ? '' : 's'} in total`),
    );
    const box = container.getBoundingClientRect();
    tip.classList.add('show');
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = clientX - box.left + 14;
    let y = clientY - box.top + 14;
    if (x + tw > box.width) x = Math.max(0, clientX - box.left - tw - 14);
    if (y + th > box.height + 40) y = clientY - box.top - th - 10;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  };
  const hide = () => tip.classList.remove('show');
  container.addEventListener('mousemove', (e) => {
    const rowEl = e.target.closest?.('.bar-row');
    if (rowEl) show(rowEl, e.clientX, e.clientY); else hide();
  });
  container.addEventListener('mouseleave', hide);
  container.addEventListener('focusin', (e) => {
    const rowEl = e.target.closest?.('.bar-row');
    if (!rowEl) return;
    const r = rowEl.getBoundingClientRect();
    show(rowEl, r.left + r.width * 0.55, r.top + r.height / 2);
  });
  container.addEventListener('focusout', hide);
}

// ---------- overview card ----------

function renderOverview() {
  const card = document.getElementById('overview-card');
  if (!card) return;
  const { members, state } = current;
  const selected = applyFilters(members, state.filters);
  const counts = countPositions(selected);
  const voted = votedTotal(counts);
  const sel = selectionText();
  const groupRebels = selected.filter((m) => m.groupRebel).length;
  const partyRebels = selected.filter((m) => m.partyRebel).length;

  const row = { key: 'all', label: sel, long: sel, prefix: '', counts, members: selected.length };
  const chartBox = h('div', { class: 'chart-box' });

  const tile = (p) => h('div', { class: `stat-tile pos-${p}` },
    h('div', { class: 'stat-label' }, h('span', { class: `swatch pos-${p}` }), POSITION_LABEL[p]),
    h('div', { class: 'stat-value' }, counts[p]),
    h('div', { class: 'stat-sub' }, p === 'DID_NOT_VOTE'
      ? `${percent(counts[p], selected.length)} of selected MEPs`
      : `${percent(counts[p], voted)} of those who voted`));

  const rebelText = [];
  if (groupRebels) rebelText.push(`${groupRebels} voted against their group's majority`);
  if (partyRebels) rebelText.push(`${partyRebels} against their national party's majority`);

  fill(card,
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { id: 'overview-title' }, 'Result'),
        h('p', { class: 'card-sub' }, `${sel} · ${voted} of ${selected.length} MEPs voted`)),
      exportButtons({
        name: () => `${slug(sel)}-result`,
        getChart: () => stackedBars([row], {
          width: EXPORT_WIDTH, theme: LIGHT_THEME, exportMode: true, includeAbsent: state.includeAbsent,
          title: current.vote.display_title || `Vote ${current.vote.id}`,
          subtitle: `${sel} · ${formatDate(current.vote.timestamp)}${current.vote.reference ? ' · ' + current.vote.reference : ''}`,
          source: exportSource(),
        }),
        getCsv: () => rowsToCsv([{ ...row, long: sel }], 'group').replace(/^[^,]+/, 'Selection'),
      })),
    h('div', { class: 'stat-row' }, POSITIONS.map(tile)),
    chartBox,
    rebelText.length
      ? h('p', { class: 'rebel-note' },
        `${rebelText.join(', and ')}. `,
        h('button', { class: 'link-button', type: 'button', onclick: () => { current.state.table.pos = 'rebels'; renderTable(); document.getElementById('table-card').scrollIntoView({ behavior: 'smooth' }); } }, 'Show them'))
      : null,
  );
  const { svg } = stackedBars([row], { width: chartBox.clientWidth || 600, theme: themeFromCss(document.documentElement), includeAbsent: state.includeAbsent });
  chartBox.innerHTML = svg;
  attachTooltips(chartBox, new Map([['all', row]]), state.includeAbsent);
}

// ---------- breakdown card ----------

function breakdownRows() {
  const { members, state } = current;
  const selected = applyFilters(members, state.filters);
  let rows = aggregate(selected, state.by);
  const totalRows = rows.length;
  let truncated = false;
  if (state.by === 'party' && !state.showAllRows && rows.length > PARTY_ROW_LIMIT) {
    rows = [...rows].sort(SORTS.size.fn).slice(0, PARTY_ROW_LIMIT);
    truncated = true;
  }
  rows.sort(SORTS[state.sort].fn);
  return { rows, totalRows, truncated };
}

function renderBreakdown() {
  const card = document.getElementById('breakdown-card');
  if (!card) return;
  const { state } = current;
  const { rows, totalRows, truncated } = breakdownRows();
  const sel = selectionText();
  const dim = DIMENSIONS[state.by];
  const chartBox = h('div', { class: 'chart-box' });

  const setState = (patch) => { Object.assign(state, patch); renderBreakdown(); renderOverview(); writeUrl(); };

  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Break down by' },
    Object.entries(DIMENSIONS).map(([key, d]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(state.by === key),
      class: state.by === key ? 'active' : '',
      onclick: () => setState({ by: key, showAllRows: false }),
      title: 'Keyboard: h / l (or gT / gt)',
    }, d.label)));

  const sortSelect = h('select', { 'aria-label': 'Sort rows', onchange: (e) => setState({ sort: e.target.value }) },
    Object.entries(SORTS).map(([key, s]) => h('option', { value: key, selected: state.sort === key }, s.label)));

  const scaleSwitch = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Bar size' },
    [['percent', 'Percentage'], ['seats', 'Seats']].map(([key, label]) => h('button', {
      type: 'button', class: state.scale === key ? 'active' : '', 'aria-pressed': String(state.scale === key),
      title: key === 'seats' ? 'Bar length = number of MEPs (keyboard: %)' : 'Every bar is 100% wide (keyboard: %)',
      onclick: () => setState({ scale: key }),
    }, label)));

  const absentToggle = h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', checked: state.includeAbsent, onchange: (e) => setState({ includeAbsent: e.target.checked }) }),
    "Count MEPs who didn't vote");

  const title = `Votes by ${dim.label.toLowerCase()}`;
  const partyNote = state.by === 'party' || state.filters.parties.size ? "; national parties from the European Parliament's MEP list" : '';

  fill(card,
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { id: 'breakdown-title' }, title),
        h('p', { class: 'card-sub' }, `${sel} · `, truncated
          ? `showing the ${PARTY_ROW_LIMIT} largest of ${totalRows} ${dim.plural}`
          : `${rows.length} ${rows.length === 1 ? dim.label.toLowerCase() : dim.plural}`)),
      exportButtons({
        name: () => `${slug(sel)}-by-${state.by}`,
        getChart: () => stackedBars(rows, {
          width: EXPORT_WIDTH, theme: LIGHT_THEME, exportMode: true, includeAbsent: state.includeAbsent, scale: state.scale,
          title: current.vote.display_title || `Vote ${current.vote.id}`,
          subtitle: `${sel}, by ${dim.label.toLowerCase()} · ${formatDate(current.vote.timestamp)}${current.vote.reference ? ' · ' + current.vote.reference : ''}`,
          source: exportSource(partyNote),
        }),
        getCsv: () => rowsToCsv(rows, state.by),
      })),
    h('div', { class: 'chart-controls' }, tabs, h('div', { class: 'chart-controls-right' }, scaleSwitch, h('label', { class: 'inline-label' }, 'Sort ', sortSelect), absentToggle)),
    legend(state.includeAbsent ? POSITIONS : VOTED),
    state.by === 'party' ? partyCoverageNote() : null,
    chartBox,
    truncated ? h('button', { class: 'btn ghost show-all', type: 'button', 'data-more': '', onclick: () => setState({ showAllRows: true }) }, `Show all ${totalRows} ${dim.plural}`) : null,
  );

  if (!rows.length) {
    chartBox.append(h('p', { class: 'muted empty' }, 'No MEPs match these filters.'));
    return;
  }
  const { svg } = stackedBars(rows, { width: chartBox.clientWidth || 800, theme: themeFromCss(document.documentElement), includeAbsent: state.includeAbsent, scale: state.scale, nav: true });
  chartBox.innerHTML = svg;
  attachTooltips(chartBox, new Map(rows.map((r) => [r.key, r])), state.includeAbsent);

  // Clicking a bar narrows the filters to it (e.g. click "S&D" to see only S&D MEPs).
  chartBox.addEventListener('click', (e) => {
    const rowEl = e.target.closest?.('.bar-row');
    if (rowEl) drillDown(rowEl.dataset.key);
  });
  chartBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList?.contains('bar-row')) drillDown(e.target.dataset.key);
  });
}

// Tells you when some MEPs have no known national party, instead of hiding it.
function partyCoverageNote() {
  const selected = applyFilters(current.members, current.state.filters);
  const unknown = selected.filter((m) => !m.party).length;
  if (!unknown) return null;
  if (!current.parties.count) {
    return h('p', { class: 'notice', title: (current.parties.errors || []).join('\n') },
      "The national party list (data/parties.json) is missing, so parties are unknown. Run “npm run update-parties”, or check the GitHub Action if this is the published site.");
  }
  return h('p', { class: 'notice' },
    `National party unknown for ${unknown} of ${selected.length} MEPs (they are not on the EP's current or outgoing MEP lists).`);
}

function drillDown(key) {
  const { state } = current;
  const f = state.filters;
  const map = { group: 'groups', country: 'countries', party: 'parties' };
  const field = map[state.by];
  // After narrowing to one group, the next useful view is usually per country, and so on.
  state.by = { group: 'country', country: 'party', party: 'party' }[state.by];
  setFilters({ ...f, [field]: new Set([key]) });
  toast(`Filtered to ${current.lookups[field].get(key) || key}`);
}

// ---------- MEP table ----------

const TABLE_COLUMNS = [
  { key: 'position', label: 'Vote', get: (m) => POSITIONS.indexOf(m.position) },
  { key: 'name', label: 'Name', get: (m) => `${m.lastName} ${m.firstName}`.toLowerCase() },
  { key: 'country', label: 'Country', get: (m) => m.country.label },
  { key: 'group', label: 'Group', get: (m) => m.group.short },
  { key: 'party', label: 'National party', get: (m) => m.party || '~' },
  { key: 'line', label: 'Followed majority?', get: (m) => (m.groupRebel ? 0 : 2) + (m.partyRebel ? 0 : 1) },
];

function tableMembers() {
  const { members, state } = current;
  const t = state.table;
  let list = applyFilters(members, state.filters);
  if (t.pos === 'rebels') list = list.filter((m) => m.groupRebel || m.partyRebel);
  else if (t.pos !== 'all') list = list.filter((m) => m.position === t.pos);
  if (t.q) {
    const q = t.q.toLowerCase();
    list = list.filter((m) => m.name.toLowerCase().includes(q) || (m.party || '').toLowerCase().includes(q));
  }
  const col = TABLE_COLUMNS.find((c) => c.key === t.sortKey) || TABLE_COLUMNS[0];
  const nameKey = TABLE_COLUMNS[1].get;
  return [...list].sort((a, b) => {
    const va = col.get(a);
    const vb = col.get(b);
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return (cmp || nameKey(a).localeCompare(nameKey(b))) * t.dir;
  });
}

function renderTable() {
  const card = document.getElementById('table-card');
  if (!card) return;
  const { state } = current;
  const t = state.table;
  const all = applyFilters(current.members, state.filters);
  const list = tableMembers();
  const sel = selectionText();

  const counts = countPositions(all);
  const rebels = all.filter((m) => m.groupRebel || m.partyRebel).length;
  const chips = [
    ['all', `All (${all.length})`],
    ...POSITIONS.map((p) => [p, `${POSITION_LABEL[p]} (${counts[p]})`]),
    ['rebels', `Broke with majority (${rebels})`],
  ];

  const search = h('input', {
    type: 'search', class: 'table-search', placeholder: 'Find MEP or party…', value: t.q, 'aria-label': 'Find MEP or party',
  });
  search.addEventListener('input', () => {
    t.q = search.value;
    const pos = search.selectionStart;
    renderTable();
    const again = document.querySelector('.table-search');
    again.focus();
    again.setSelectionRange(pos, pos);
  });

  const sortHeader = (col) => {
    const active = t.sortKey === col.key;
    return h('th', { 'aria-sort': active ? (t.dir === 1 ? 'ascending' : 'descending') : 'none' },
      h('button', {
        type: 'button', class: 'th-button',
        onclick: () => { if (active) t.dir *= -1; else { t.sortKey = col.key; t.dir = 1; } renderTable(); },
      }, col.label, h('span', { class: 'sort-mark', 'aria-hidden': 'true' }, active ? (t.dir === 1 ? '▲' : '▼') : '')));
  };

  const lineCell = (m) => {
    const bits = [];
    if (m.groupRebel) bits.push(h('span', { class: 'badge warn', title: `${m.group.short} majority voted ${POSITION_LABEL[m.groupLine].toLowerCase()}` }, `Not with ${m.group.short}`));
    if (m.partyRebel) bits.push(h('span', { class: 'badge warn', title: `${m.party} majority voted ${POSITION_LABEL[m.partyLine].toLowerCase()}` }, 'Not with party'));
    if (!bits.length) bits.push(h('span', { class: 'muted' }, VOTED.includes(m.position) ? 'Yes' : '–'));
    return h('td', {}, bits);
  };

  const visible = t.showAll ? list : list.slice(0, TABLE_ROW_LIMIT);
  const body = h('tbody', {}, visible.map((m) => h('tr', {
    tabindex: -1,
    'data-nav': `mep:${m.id}`,
    'data-href': `https://www.europarl.europa.eu/meps/en/${m.id}`,
  },
    h('td', { class: 'vote-cell' }, h('span', { class: `swatch pos-${m.position}` }), POSITION_LABEL[m.position]),
    h('td', {}, h('div', { class: 'name-cell' },
      m.photo
        ? h('img', { src: m.photo, alt: '', loading: 'lazy', width: 32, height: 32, onerror: (e) => e.target.replaceWith(h('span', { class: 'photo-placeholder' })) })
        : h('span', { class: 'photo-placeholder' }),
      h('a', { href: `https://www.europarl.europa.eu/meps/en/${m.id}`, target: '_blank', rel: 'noopener' }, m.name))),
    h('td', {}, `${flag(m.country.iso_alpha_2)} ${m.country.label}`),
    h('td', { title: m.group.label }, m.group.short),
    h('td', {}, m.party || h('span', { class: 'muted' }, 'Unknown')),
    lineCell(m))));

  fill(card,
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', { id: 'table-title' }, 'MEPs'),
        h('p', { class: 'card-sub' }, `${sel} · ${list.length} MEP${list.length === 1 ? '' : 's'} · “Followed majority?” compares each MEP with the majority of their group and of their national party`)),
      exportButtons({ name: () => `${slug(sel)}-meps`, getCsv: () => membersToCsv(list) })),
    h('div', { class: 'table-controls' },
      h('div', { class: 'pill-row', role: 'group', 'aria-label': 'Show only' }, chips.map(([key, label]) => h('button', {
        type: 'button', class: `pill${t.pos === key ? ' active' : ''}`, 'aria-pressed': String(t.pos === key),
        onclick: () => { t.pos = key; renderTable(); },
      }, key !== 'all' && key !== 'rebels' ? h('span', { class: `swatch pos-${key}` }) : null, label))),
      search),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'mep-table' },
        h('thead', {}, h('tr', {}, TABLE_COLUMNS.map(sortHeader))),
        body)),
    list.length ? null : h('p', { class: 'muted empty' }, 'No MEPs match.'),
    visible.length < list.length
      ? h('button', { class: 'btn ghost show-all', type: 'button', 'data-more': '', onclick: () => { t.showAll = true; renderTable(); } }, `Show all ${list.length} MEPs`)
      : null,
  );
}

// ---------- actions for keyboard commands (used by keys.js) ----------

const DIM_KEYS = Object.keys(DIMENSIONS);
const SORT_KEYS = Object.keys(SORTS);
const TABLE_FILTERS = ['all', ...POSITIONS, 'rebels'];
const cycle = (list, value, delta) => list[(list.indexOf(value) + delta + list.length * 10) % list.length];

// Returns null when no vote page is on screen, so the keys know these commands don't apply.
export function voteActions() {
  if (!current || !document.getElementById('breakdown-card')) return null;
  const { state } = current;
  const redrawBreakdown = () => { renderBreakdown(); renderOverview(); writeUrl(); };
  return {
    cycleTab(delta) {
      state.by = cycle(DIM_KEYS, state.by, delta);
      state.showAllRows = false;
      redrawBreakdown();
      toast(`By ${DIMENSIONS[state.by].label.toLowerCase()}`);
    },
    cycleSort(delta) {
      state.sort = cycle(SORT_KEYS, state.sort, delta);
      redrawBreakdown();
      toast(`Sorted: ${SORTS[state.sort].label}`);
    },
    toggleScale() {
      state.scale = state.scale === 'seats' ? 'percent' : 'seats';
      redrawBreakdown();
      toast(state.scale === 'seats' ? 'Bars show seats (number of MEPs)' : 'Bars show percentages');
    },
    toggleAbsent() {
      state.includeAbsent = !state.includeAbsent;
      redrawBreakdown();
      toast(state.includeAbsent ? "Counting MEPs who didn't vote" : 'Only MEPs who voted');
    },
    openFilter(index) {
      document.querySelectorAll('.filter-bar .dropdown-button')[index]?.click();
    },
    removeLastFilter() {
      const f = state.filters;
      // Remove from the most specific kind first: parties, then groups, then countries.
      for (const key of ['parties', 'groups', 'countries']) {
        if (f[key].size) {
          const s = new Set(f[key]);
          const last = [...s].pop();
          s.delete(last);
          setFilters({ ...f, [key]: s });
          toast(`Removed ${current.lookups[key].get(last) || last}`);
          return;
        }
      }
      toast('No filters to remove');
    },
    clearFilters() {
      setFilters({ countries: new Set(), groups: new Set(), parties: new Set() });
      toast('All filters cleared');
    },
    cycleTableFilter(delta) {
      state.table.pos = cycle(TABLE_FILTERS, state.table.pos, delta);
      renderTable();
      const label = { all: 'All MEPs', rebels: 'Broke with majority' }[state.table.pos] || POSITION_LABEL[state.table.pos];
      toast(`Table: ${label}`);
    },
    focusTableSearch() {
      const input = document.querySelector('.table-search');
      input?.scrollIntoView({ block: 'center' });
      input?.focus();
    },
    // card = 'overview' | 'breakdown' | 'table'; action = 'png' | 'svg' | 'csv' | 'copy'
    exportCard(card, action) {
      const button = document.querySelector(`#${card}-card [data-action="${action}"]`);
      if (button) button.click(); else toast(`Nothing to ${action === 'copy' ? 'copy' : 'download'} here`, true);
    },
  };
}
