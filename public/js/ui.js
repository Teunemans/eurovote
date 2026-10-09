// Small building blocks shared by the views: creating elements, icons,
// a pop-up message ("toast") and the filter dropdown.

// h('div', { class: 'x', onclick: fn }, child1, child2) creates <div class="x">child1 child2</div>.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const svgIcon = (paths) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  download: svgIcon('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
  copy: svgIcon('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
  link: svgIcon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  close: svgIcon('<path d="M6 6l12 12M18 6 6 18"/>'),
  search: svgIcon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  chevron: svgIcon('<path d="m6 9 6 6 6-6"/>'),
  external: svgIcon('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  back: svgIcon('<path d="M15 6l-6 6 6 6"/>'),
  moon: svgIcon('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  sun: svgIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
};

export function icon(name) {
  return h('span', { class: 'icon', html: ICONS[name] });
}

let toastTimer;
export function toast(message, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

// ---------- filter dropdown with checkboxes and a search field ----------

let openDropdown = null;
document.addEventListener('click', (e) => {
  if (openDropdown && !openDropdown.contains(e.target)) closeDropdown();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openDropdown) {
    const button = openDropdown.querySelector('.dropdown-button');
    closeDropdown();
    button?.focus();
  }
});
function closeDropdown() {
  openDropdown?.classList.remove('open');
  openDropdown?.querySelector('.dropdown-button')?.setAttribute('aria-expanded', 'false');
  openDropdown = null;
}

/**
 * options: [{ value, label, prefix, hint }]   (hint = small grey text, e.g. "135 MEPs")
 * selected: Set of values. onChange(newSet) is called on every click.
 */
export function multiSelect({ label, options, selected, onChange, placeholder = 'Search…' }) {
  const root = h('div', { class: 'dropdown' });
  const count = selected.size ? h('span', { class: 'count-badge' }, selected.size) : null;
  const button = h('button', {
    class: `dropdown-button${selected.size ? ' active' : ''}`,
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
  }, label, count, icon('chevron'));

  const list = h('div', { class: 'dropdown-list', role: 'listbox', 'aria-multiselectable': 'true' });
  const search = h('input', { type: 'search', class: 'dropdown-search', placeholder, 'aria-label': `Search ${label.toLowerCase()}` });
  const panel = h('div', { class: 'dropdown-panel' }, search, list);

  function renderList() {
    const term = search.value.trim().toLowerCase();
    list.replaceChildren();
    const matches = options.filter((o) => !term || o.label.toLowerCase().includes(term) || (o.search || '').toLowerCase().includes(term));
    if (!matches.length) list.append(h('div', { class: 'dropdown-empty' }, 'No matches'));
    for (const o of matches) {
      const box = h('input', { type: 'checkbox', checked: selected.has(o.value), 'data-value': o.value });
      box.addEventListener('change', () => {
        const next = new Set(selected);
        if (box.checked) next.add(o.value); else next.delete(o.value);
        onChange(next);
      });
      list.append(h('label', { class: 'dropdown-option' },
        box,
        h('span', { class: 'option-label' }, o.prefix ? `${o.prefix} ` : '', o.label),
        o.hint ? h('span', { class: 'option-hint' }, o.hint) : null));
    }
  }
  search.addEventListener('input', renderList);
  renderList();

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = root.classList.contains('open');
    closeDropdown();
    if (!wasOpen) {
      root.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      openDropdown = root;
      search.focus();
    }
  });

  root.append(button, panel);
  return root;
}

// The filter bar is rebuilt after every change (the party list depends on the chosen
// countries, for example). These two functions remember which dropdown was open,
// what was typed in it and where it was scrolled, and put that back afterwards.
export function captureDropdownState(container) {
  const all = [...container.querySelectorAll('.dropdown')];
  const index = all.findIndex((d) => d.classList.contains('open'));
  if (index === -1) return null;
  const root = all[index];
  return {
    index,
    term: root.querySelector('.dropdown-search').value,
    scrollTop: root.querySelector('.dropdown-list').scrollTop,
    focusValue: document.activeElement?.dataset?.value ?? null,
    searchFocused: document.activeElement === root.querySelector('.dropdown-search'),
  };
}

export function restoreDropdownState(container, state) {
  if (!state) return;
  const root = container.querySelectorAll('.dropdown')[state.index];
  if (!root) return;
  root.classList.add('open');
  root.querySelector('.dropdown-button').setAttribute('aria-expanded', 'true');
  openDropdown = root;
  const search = root.querySelector('.dropdown-search');
  if (state.term) {
    search.value = state.term;
    search.dispatchEvent(new Event('input'));
  }
  root.querySelector('.dropdown-list').scrollTop = state.scrollTop;
  const target = state.searchFocused
    ? search
    : [...root.querySelectorAll('input[type=checkbox]')].find((b) => b.dataset.value === state.focusValue);
  target?.focus({ preventScroll: true });
}
