// Vim-style keyboard control.
//
// How it works:
//  - Every key you press (outside text fields) is added to a small "pending" buffer.
//  - Digits in front of a command are a count, like in Vim: "5j" moves down five rows.
//  - When the buffer matches a command exactly ("j", "gg", "wp"), that command runs.
//  - When it is only the start of a command ("g"), we wait for the next key.
//  - Anything else resets the buffer.
// Items you can move between (search results, chart rows, table rows) carry a
// data-nav attribute; j / k simply walk through those in page order.

import { voteActions } from './views/vote.js';
import { h, toast } from './ui.js';
import { toggleTheme } from './theme.js';

const SEQUENCE_TIMEOUT = 1200; // ms to wait for the second key of "gg", "yy", ...

// ---------- moving the selection ----------

let lastNavId = null;

function navItems() {
  return [...document.querySelectorAll('[data-nav]')].filter((el) => el.getClientRects().length > 0);
}

// The sticky bars at the top hide part of the page; we keep the selection below them.
function topLimit() {
  let limit = 0;
  for (const el of document.querySelectorAll('.topbar, .filter-bar')) {
    if (getComputedStyle(el).position === 'sticky') limit = Math.max(limit, el.getBoundingClientRect().bottom);
  }
  return limit + 8;
}

function ensureVisible(el, center = false) {
  const r = el.getBoundingClientRect();
  const top = topLimit();
  const bottom = window.innerHeight - 16;
  if (center) window.scrollBy(0, r.top - (top + bottom) / 2 + r.height / 2);
  else if (r.top < top) window.scrollBy(0, r.top - top);
  else if (r.bottom > bottom) window.scrollBy(0, r.bottom - bottom);
}

function currentIndex(items) {
  const active = document.activeElement?.closest?.('[data-nav]');
  let i = items.indexOf(active);
  // After a redraw the old element is gone; find its replacement by id.
  if (i === -1 && lastNavId) i = items.findIndex((el) => el.dataset.nav === lastNavId);
  return i;
}

function select(el, center = false) {
  if (!el) return;
  document.querySelectorAll('.nav-selected').forEach((x) => x.classList.remove('nav-selected'));
  el.classList.add('nav-selected');
  lastNavId = el.dataset.nav;
  el.focus({ preventScroll: true });
  ensureVisible(el, center);
}

function move(delta) {
  const items = navItems();
  if (!items.length) return toast('Nothing to move through here');
  let i = currentIndex(items);
  if (i === -1) {
    // Nothing selected yet: start at the first (or last) item that is on screen.
    const top = topLimit();
    const onScreen = items.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= top && r.bottom <= window.innerHeight;
    });
    const start = delta > 0 ? onScreen[0] : onScreen.at(-1);
    return select(start || items[0]);
  }
  select(items[Math.max(0, Math.min(items.length - 1, i + delta))]);
}

function goTo(position) {
  // position: 1-based item number, or -1 for the last item.
  const items = navItems();
  if (!items.length) return;
  select(position === -1 ? items.at(-1) : items[Math.min(items.length, Math.max(1, position)) - 1]);
}

function openSelected(newTab = false) {
  const items = navItems();
  const el = items[currentIndex(items)];
  if (!el) return toast('Select something first with j / k');
  if (el.dataset.href) window.open(el.dataset.href, '_blank', 'noopener');
  else if (el.tagName === 'A' && newTab) window.open(el.href, '_blank', 'noopener');
  else if (el.tagName === 'A') el.click();
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true })); // chart row: zoom in
}

function showMore() {
  const buttons = [...document.querySelectorAll('[data-more]')].filter((b) => !b.hidden && b.getClientRects().length);
  if (!buttons.length) return toast('Everything is already shown');
  // Prefer the button below the current selection (table) over one above it (chart).
  const items = navItems();
  const sel = items[currentIndex(items)];
  const below = sel ? buttons.find((b) => sel.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
  (below || buttons[0]).click();
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied');
  } catch {
    toast('Could not copy the link', true);
  }
}

function needVote(fn) {
  return (count) => {
    const actions = voteActions();
    if (!actions) return toast('Only works on a vote page');
    return fn(actions, count);
  };
}

// ---------- the list of commands (also used to build the help screen) ----------

export const COMMANDS = [
  { section: 'Moving around' },
  { keys: 'j', desc: 'Next item (search result, chart row or MEP)', run: (n) => move(n) },
  { keys: 'k', desc: 'Previous item', run: (n) => move(-n) },
  { keys: 'gg', desc: 'First item (5gg: fifth item)', run: (n, hadCount) => goTo(hadCount ? n : 1) },
  { keys: 'G', desc: 'Last item (5G: fifth item)', run: (n, hadCount) => goTo(hadCount ? n : -1) },
  { keys: '<C-d>', desc: 'Scroll half a page down', run: (n) => window.scrollBy(0, (window.innerHeight / 2) * n) },
  { keys: '<C-u>', desc: 'Scroll half a page up', run: (n) => window.scrollBy(0, (-window.innerHeight / 2) * n) },
  { keys: 'zz', desc: 'Scroll the selection to the middle', run: () => { const i = navItems(); const el = i[currentIndex(i)]; if (el) ensureVisible(el, true); } },
  { keys: 'o', desc: 'Open selection (vote, MEP page, or zoom into a bar)', run: () => openSelected() },
  { keys: 'O', desc: 'Open selection in a new browser tab', run: () => openSelected(true) },
  { keys: 'n', desc: 'Show more (load more votes / show all rows)', run: () => showMore() },
  { keys: 'H', desc: 'Back', run: () => history.back() },
  { keys: 'L', desc: 'Forward', run: () => history.forward() },
  { keys: '/', desc: 'Search votes', run: () => { const s = document.querySelector('#global-search input'); s.focus(); s.select(); } },
  { keys: 'gh', desc: 'Go home (latest votes)', run: () => { location.hash = '#/'; } },
  { keys: 'yy', desc: 'Copy the link to this exact view', run: () => copyLink() },
  { keys: 'gd', desc: 'Switch between light and dark mode', run: () => toggleTheme() },

  { section: 'Vote page: chart' },
  { keys: 'l', desc: 'Next breakdown (group → country → party)', run: needVote((a, n) => a.cycleTab(n)) },
  { keys: 'h', desc: 'Previous breakdown', run: needVote((a, n) => a.cycleTab(-n)) },
  { keys: 'gt', desc: 'Next breakdown (like Vim tabs)', run: needVote((a, n) => a.cycleTab(n)) },
  { keys: 'gT', desc: 'Previous breakdown', run: needVote((a, n) => a.cycleTab(-n)) },
  { keys: 's', desc: 'Next sort order', run: needVote((a, n) => a.cycleSort(n)) },
  { keys: 'S', desc: 'Previous sort order', run: needVote((a, n) => a.cycleSort(-n)) },
  { keys: 'a', desc: "Count MEPs who didn't vote (on/off)", run: needVote((a) => a.toggleAbsent()) },
  { keys: '%', desc: 'Switch bars between percentage and seats', run: needVote((a) => a.toggleScale()) },

  { section: 'Vote page: filters' },
  { keys: 'fc', desc: 'Open the Countries filter', run: needVote((a) => a.openFilter(0)) },
  { keys: 'fg', desc: 'Open the Groups filter', run: needVote((a) => a.openFilter(1)) },
  { keys: 'fp', desc: 'Open the Parties filter', run: needVote((a) => a.openFilter(2)) },
  { keys: 'x', desc: 'Remove the last filter', run: needVote((a, n) => { for (let i = 0; i < n; i += 1) a.removeLastFilter(); }) },
  { keys: 'X', desc: 'Remove all filters', run: needVote((a) => a.clearFilters()) },

  { section: 'Vote page: MEP table' },
  { keys: 't', desc: 'Next table filter (All → For → Against → …)', run: needVote((a, n) => a.cycleTableFilter(n)) },
  { keys: 'T', desc: 'Previous table filter', run: needVote((a, n) => a.cycleTableFilter(-n)) },
  { keys: 'i', desc: 'Type in the MEP search box', run: needVote((a) => a.focusTableSearch()) },

  { section: 'Vote page: share (w = write)' },
  { keys: 'wp', desc: 'Download chart as PNG', run: needVote((a) => a.exportCard('breakdown', 'png')) },
  { keys: 'ws', desc: 'Download chart as SVG', run: needVote((a) => a.exportCard('breakdown', 'svg')) },
  { keys: 'wc', desc: 'Download chart numbers as CSV', run: needVote((a) => a.exportCard('breakdown', 'csv')) },
  { keys: 'wt', desc: 'Download the MEP table as CSV', run: needVote((a) => a.exportCard('table', 'csv')) },
  { keys: 'wr', desc: 'Download the result card as PNG', run: needVote((a) => a.exportCard('overview', 'png')) },
  { keys: 'yc', desc: 'Copy chart image to the clipboard', run: needVote((a) => a.exportCard('breakdown', 'copy')) },

  { section: 'Help' },
  { keys: '?', desc: 'Show or hide this list', run: () => toggleHelp() },
  { keys: '<Esc>', desc: 'Close / leave a text field / clear the selection' },
];

const RUNNABLE = COMMANDS.filter((c) => c.keys && c.run);

// ---------- help screen ----------

function toggleHelp(force) {
  let dialog = document.getElementById('key-help');
  if (!dialog) {
    dialog = h('dialog', { id: 'key-help', class: 'key-help', 'aria-labelledby': 'key-help-title' },
      h('div', { class: 'key-help-head' },
        h('h2', { id: 'key-help-title' }, 'Keyboard (Vim style)'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => dialog.close() }, 'Close')),
      h('p', { class: 'muted' }, 'Put a number in front of a command to repeat it, e.g. 5j. Keys don’t work while you are typing in a text field: press Esc first.'),
      h('div', { class: 'key-help-grid' }, COMMANDS.map((c) => (c.section
        ? h('h3', {}, c.section)
        : h('div', { class: 'key-row' }, h('span', { class: 'key-combo' }, ...keyChips(c.keys)), h('span', {}, c.desc))))));
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // click outside closes
    document.body.append(dialog);
  }
  const open = force ?? !dialog.open;
  if (open && !dialog.open) dialog.showModal();
  if (!open && dialog.open) dialog.close();
}

function keyChips(keys) {
  // "<C-d>" is one key (Ctrl+d); "gg" is two keys.
  const parts = keys.match(/<[^>]+>|./g);
  return parts.map((k) => h('kbd', {}, k.startsWith('<') ? k.slice(1, -1).replace('C-', 'Ctrl+') : k));
}

// ---------- pending keys indicator (like Vim's "showcmd") ----------

let pending = '';
let countText = '';
let timer = null;
const indicator = h('div', { class: 'showcmd', 'aria-hidden': 'true' });
document.body.append(indicator);

function updateIndicator() {
  const text = countText + pending;
  indicator.textContent = text;
  indicator.classList.toggle('show', Boolean(text));
}

function reset() {
  pending = '';
  countText = '';
  clearTimeout(timer);
  updateIndicator();
}

function keyName(e) {
  if (e.key === 'Escape') return '<Esc>';
  if (e.ctrlKey && e.key.length === 1) return `<C-${e.key.toLowerCase()}>`;
  return e.key;
}

// ---------- keys inside the filter dropdowns ----------

function dropdownKeys(e) {
  const dropdown = e.target.closest?.('.dropdown.open');
  if (!dropdown) return false;
  const boxes = [...dropdown.querySelectorAll('.dropdown-option input')];
  const inSearch = e.target.classList.contains('dropdown-search');
  const i = boxes.indexOf(e.target);
  const down = (e.ctrlKey && e.key === 'n') || e.key === 'ArrowDown' || (!inSearch && e.key === 'j');
  const up = (e.ctrlKey && e.key === 'p') || e.key === 'ArrowUp' || (!inSearch && e.key === 'k');
  if (down || up) {
    e.preventDefault();
    if (inSearch) { if (down) boxes[0]?.focus(); return true; }
    const next = i + (down ? 1 : -1);
    if (next < 0) dropdown.querySelector('.dropdown-search').focus();
    else boxes[Math.min(boxes.length - 1, next)]?.focus();
    return true;
  }
  if (i !== -1 && e.key === 'Enter') {
    e.preventDefault();
    e.target.click(); // tick / untick
    return true;
  }
  if (i !== -1 && e.key === '/') {
    e.preventDefault();
    dropdown.querySelector('.dropdown-search').focus();
    return true;
  }
  return false;
}

// ---------- main key handler ----------

function onKeyDown(e) {
  if (e.metaKey || e.altKey || e.isComposing) return;
  if (dropdownKeys(e)) return;

  // Enter on a selected MEP row opens their page (links and chart rows handle Enter themselves).
  if (e.key === 'Enter' && e.target.dataset?.href) {
    e.preventDefault();
    window.open(e.target.dataset.href, '_blank', 'noopener');
    return;
  }

  const typing = e.target.closest?.('input:not([type=checkbox]), textarea, select, [contenteditable]');
  if (typing) {
    // Esc leaves the text field, so the Vim keys work again.
    if (e.key === 'Escape' && !e.target.closest('.dropdown')) { e.target.blur(); reset(); }
    return;
  }
  if (e.target.closest?.('.dropdown.open')) return; // ui.js handles Esc there
  if (document.getElementById('key-help')?.open && e.key !== '?' && e.key !== 'Escape') return;

  const key = keyName(e);
  if (key === '<Esc>') {
    if (pending || countText) return reset();
    document.querySelectorAll('.nav-selected').forEach((x) => x.classList.remove('nav-selected'));
    lastNavId = null;
    document.activeElement?.blur?.();
    return;
  }
  if (e.ctrlKey && !['<C-d>', '<C-u>'].includes(key)) return; // leave other Ctrl shortcuts to the browser
  if (['Shift', 'Control', 'CapsLock', 'Tab', 'Enter', ' '].includes(e.key) || e.key.startsWith('Arrow')) return;

  // A count: digits before a command (a leading 0 is not a count).
  if (!pending && /^[0-9]$/.test(key) && (countText || key !== '0')) {
    countText += key;
    e.preventDefault();
    updateIndicator();
    clearTimeout(timer);
    timer = setTimeout(reset, SEQUENCE_TIMEOUT * 2);
    return;
  }

  const attempt = pending + key;
  const exact = RUNNABLE.find((c) => c.keys === attempt);
  const isPrefix = RUNNABLE.some((c) => c.keys.startsWith(attempt) && c.keys !== attempt);

  if (exact) {
    e.preventDefault();
    const hadCount = countText !== '';
    const n = Math.min(999, Number(countText) || 1);
    reset();
    exact.run(n, hadCount);
  } else if (isPrefix) {
    e.preventDefault();
    pending = attempt;
    updateIndicator();
    clearTimeout(timer);
    timer = setTimeout(reset, SEQUENCE_TIMEOUT);
  } else {
    reset();
  }
}

export function initKeys() {
  document.addEventListener('keydown', onKeyDown);
  // Clicking somewhere with the mouse should also move the "current item".
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-nav]');
    document.querySelectorAll('.nav-selected').forEach((x) => { if (x !== el) x.classList.remove('nav-selected'); });
    if (el) { el.classList.add('nav-selected'); lastNavId = el.dataset.nav; }
  });
  // A new page means a fresh start.
  window.addEventListener('hashchange', () => { lastNavId = null; reset(); });
}
