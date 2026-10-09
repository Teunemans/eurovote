// Light / dark mode switch. Light is the default; your choice is remembered in this browser.
// The choice is stored as data-theme="dark" on <html>, which switches the CSS variables in app.css.

import { ICONS } from './ui.js';

const KEY = 'eurovote.theme';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function updateButton(button) {
  const dark = currentTheme() === 'dark';
  // The button shows what you will switch TO, like most sites do.
  button.innerHTML = `${dark ? ICONS.sun : ICONS.moon}<span class="theme-label">${dark ? 'Light' : 'Dark'}</span>`;
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  button.setAttribute('aria-pressed', String(dark));
}

export function setTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(KEY, theme); } catch { /* storage blocked: the choice just isn't remembered */ }
  const button = document.getElementById('theme-toggle');
  if (button) updateButton(button);
  // The charts are SVG with colours baked in, so they have to be redrawn (see vote.js).
  window.dispatchEvent(new CustomEvent('eurovote:themechange', { detail: theme }));
}

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  const button = document.getElementById('theme-toggle');
  updateButton(button);
  button.addEventListener('click', toggleTheme);
}
