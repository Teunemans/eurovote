// Starts the app and decides which page to show based on the part of the
// address after "#", e.g. "#/vote/198051?by=country".

import { renderSearch } from './views/search.js';
import { renderVote } from './views/vote.js';
import { initKeys } from './keys.js';
import { initTheme } from './theme.js';
import { voteIdFromInput } from './data.js';

const app = document.getElementById('app');
const searchForm = document.getElementById('global-search');
const searchInput = searchForm.querySelector('input');

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = hash.split('?');
  return { path, params: new URLSearchParams(query) };
}

function route() {
  const { path, params } = parseHash();
  const voteMatch = path.match(/^\/vote\/(\d+)$/);
  window.scrollTo(0, 0);
  if (voteMatch) {
    renderVote(app, voteMatch[1], params);
  } else {
    searchInput.value = params.get('q') || '';
    renderSearch(app, params);
  }
}

// The search bar understands three things: a vote ID, a MEPWatch/HowTheyVote link, or words.
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = searchInput.value.trim();
  const id = voteIdFromInput(text);
  if (id) {
    searchInput.value = '';
    location.hash = `#/vote/${id}`;
  } else {
    location.hash = text ? `#/?q=${encodeURIComponent(text)}` : '#/';
  }
  searchInput.blur();
});

// Vim-style keyboard commands live in keys.js (press ? in the app for the list).
initKeys();
initTheme();

window.addEventListener('hashchange', route);
route();
