// The start page: search votes, filter by date, and reopen recent votes.

import { searchVotes } from '../api.js';
import { h, formatDate } from '../ui.js';

const RECENT_KEY = 'eurovote.recent';

// Browser storage can be blocked (private windows), so every access is wrapped in try/catch.
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}

export function rememberVote(vote) {
  try {
    const entry = { id: String(vote.id), title: vote.display_title, timestamp: vote.timestamp, reference: vote.reference, description: vote.description };
    const list = [entry, ...loadRecent().filter((v) => v.id !== entry.id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function voteLabel(v) {
  if (v.amendment_number) return `Amendment ${v.amendment_number}${v.amendment_subject ? ` · ${v.amendment_subject}` : ''}`;
  return v.description || '';
}

function resultPill(result) {
  if (!result) return null;
  const cls = result === 'ADOPTED' ? 'adopted' : result === 'REJECTED' ? 'rejected' : 'neutral';
  return h('span', { class: `result-pill small ${cls}` }, result.charAt(0) + result.slice(1).toLowerCase());
}

function voteItem(v) {
  return h('li', {},
    h('a', { class: 'vote-item', href: `#/vote/${v.id}`, 'data-nav': `vote:${v.id}` },
      h('div', { class: 'vote-item-meta' },
        h('span', {}, formatDate(v.timestamp)),
        v.reference ? h('span', {}, v.reference) : null,
        h('span', { class: 'muted' }, `#${v.id}`),
        resultPill(v.result)),
      h('div', { class: 'vote-item-title' }, v.display_title || `Vote ${v.id}`),
      voteLabel(v) ? h('div', { class: 'vote-item-sub' }, voteLabel(v)) : null));
}

export async function renderSearch(app, params) {
  const q = params.get('q') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  document.title = q ? `${q} · EuroVote` : 'EuroVote';

  const list = h('ul', { class: 'vote-list' });
  const status = h('p', { class: 'muted', role: 'status' }, 'Loading votes…');
  const moreButton = h('button', { class: 'btn ghost', type: 'button', hidden: true, 'data-more': '' }, 'Load more');

  const updateUrl = (patch) => {
    const next = new URLSearchParams({ q, from, to, ...patch });
    for (const [k, v] of [...next]) if (!v) next.delete(k);
    location.hash = `#/${next.toString() ? '?' + next : ''}`;
  };

  const dateInput = (label, value, key) => h('label', { class: 'inline-label' }, label,
    h('input', { type: 'date', value, onchange: (e) => updateUrl({ [key]: e.target.value }) }));

  const recent = loadRecent();
  app.replaceChildren(h('div', { class: 'search-page' },
    h('div', { class: 'search-intro' },
      h('h1', {}, q ? `Votes matching “${q}”` : 'European Parliament votes'),
      h('p', { class: 'muted' }, 'Search by topic, document reference (e.g. B10-0424/2026) or paste a vote ID or MEPWatch link in the search bar above. Press / to jump to it.')),
    h('div', { class: 'search-filters' },
      dateInput('From', from, 'from'),
      dateInput('To', to, 'to'),
      (q || from || to) ? h('a', { class: 'link-button', href: '#/' }, 'Clear search') : null),
    !q && !from && !to && recent.length
      ? h('section', { class: 'recent' },
        h('h2', {}, 'Recently opened'),
        h('ul', { class: 'vote-list compact' }, recent.map(voteItem)))
      : null,
    h('section', {},
      h('h2', {}, q || from || to ? 'Results' : 'Latest votes'),
      status,
      list,
      moreButton)));

  let page = 1;
  async function load() {
    moreButton.disabled = true;
    try {
      const data = await searchVotes({ q, from, to, page });
      if (page === 1) list.replaceChildren();
      list.append(...data.results.map(voteItem));
      status.textContent = data.total
        ? `${data.total.toLocaleString('en-GB')} vote${data.total === 1 ? '' : 's'}`
        : 'No votes found. Try fewer or different words.';
      moreButton.hidden = !data.has_next;
    } catch (err) {
      status.replaceChildren(`Could not load votes: ${err.message}. `, h('button', { class: 'link-button', onclick: load }, 'Try again'));
    } finally {
      moreButton.disabled = false;
    }
  }
  moreButton.addEventListener('click', () => { page += 1; load(); });
  await load();
}

