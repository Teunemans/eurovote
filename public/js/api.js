// Loads the data. Votes come straight from the HowTheyVote.eu API (it allows other
// websites to call it). National parties come from data/parties.json, a file that
// scripts/update-parties.mjs creates from the European Parliament's MEP list.
// Answers are kept in memory, so going back and forth between pages is instant.

export const HTV_BASE = 'https://howtheyvote.eu';

const memory = new Map();

async function getJson(url) {
  if (memory.has(url)) return memory.get(url);
  const promise = fetch(url).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error('This vote was not found on HowTheyVote.eu');
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }, () => {
    throw new Error('Could not reach HowTheyVote.eu. Check your internet connection.');
  });
  memory.set(url, promise);
  // Don't remember failures, so "try again" really tries again.
  promise.catch(() => memory.delete(url));
  return promise;
}

export function searchVotes({ q = '', from = '', to = '', page = 1, pageSize = 25 }) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (q) params.set('q', q);
  // Without a search text, "newest first" is the most useful order.
  // With a search text, HowTheyVote sorts by relevance.
  if (!q) { params.set('sort_by', 'date'); params.set('sort_order', 'desc'); }
  if (from) params.set('date[gte]', from);
  if (to) params.set('date[lte]', to);
  return getJson(`${HTV_BASE}/api/votes?${params}`);
}

export const getVote = (id) => getJson(`${HTV_BASE}/api/votes/${encodeURIComponent(id)}`);

// The party list is optional: if it is missing, the app still works, just without parties.
// (A relative URL, so it also works when the site lives in a subfolder like /eurovote/.)
export const getParties = () => getJson('data/parties.json').catch(() => ({ meps: {}, count: 0, errors: ['Party list unavailable'] }));
