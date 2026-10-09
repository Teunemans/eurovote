// Draws the horizontal 100% stacked bar chart as an SVG string.
// The same function draws the on-screen chart and the downloadable image;
// for downloads it adds a title, legend and source line so the picture
// still makes sense when someone sees it on its own.

import { POSITIONS, VOTED, POSITION_LABEL, votedTotal, allTotal, percent } from './data.js';

export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Colours: blue = for, orange = against (safe for colour-blind readers, unlike red/green),
// grey = abstained, light grey = didn't vote.
export const LIGHT_THEME = {
  surface: '#ffffff',
  text: '#16161a',
  textSecondary: '#52514e',
  muted: '#77756f',
  grid: '#e6e5df',
  axis: '#c3c2b7',
  colors: { FOR: '#2a78d6', AGAINST: '#eb6834', ABSTENTION: '#8a8780', DID_NOT_VOTE: '#dcdbd4' },
};

// Reads the live colours from the CSS variables, so the on-screen chart follows dark mode.
export function themeFromCss(element) {
  const css = getComputedStyle(element);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    surface: v('--surface', LIGHT_THEME.surface),
    text: v('--text', LIGHT_THEME.text),
    textSecondary: v('--text-secondary', LIGHT_THEME.textSecondary),
    muted: v('--muted', LIGHT_THEME.muted),
    grid: v('--grid', LIGHT_THEME.grid),
    axis: v('--axis', LIGHT_THEME.axis),
    colors: {
      FOR: v('--vote-for', LIGHT_THEME.colors.FOR),
      AGAINST: v('--vote-against', LIGHT_THEME.colors.AGAINST),
      ABSTENTION: v('--vote-abstain', LIGHT_THEME.colors.ABSTENTION),
      DID_NOT_VOTE: v('--vote-absent', LIGHT_THEME.colors.DID_NOT_VOTE),
    },
  };
}

// ---------- text helpers ----------

const measureCtx = document.createElement('canvas').getContext('2d');

export function textWidth(text, size, weight = 400) {
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
}

// Shortens text with "…" until it fits. (The full text is always in the tooltip and CSV.)
function fit(text, maxWidth, size, weight) {
  if (textWidth(text, size, weight) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(text.slice(0, mid) + '…', size, weight) <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, Math.max(1, lo)).trimEnd() + '…';
}

function wrap(text, maxWidth, size, weight, maxLines = 3) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (textWidth(attempt, size, weight) <= maxWidth || !line) line = attempt;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth, size, weight);
    return kept;
  }
  return lines;
}

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Picks black or white text for a label placed on top of a coloured bar.
function inkOn(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const onWhite = 1.05 / (L + 0.05);
  const onBlack = (L + 0.05) / 0.05;
  // White reads nicer on coloured bars, so we use it whenever it is readable enough.
  return onWhite >= 4.5 || onWhite >= onBlack ? '#ffffff' : '#111111';
}

// Rectangle with only the right-hand corners rounded (the "end" of a bar).
function roundedEnd(x, y, w, h, r) {
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z`;
}

// "Nice" round axis steps (1, 2, 5, 10, 20, 50 …) for the seats scale.
// Returns e.g. [0, 20, 40, 60, 80, 100] for a maximum of 87.
function niceTicks(max, target) {
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].find((m) => m * magnitude >= raw) * magnitude);
  const ticks = [];
  for (let v = 0; v < max + step; v += step) ticks.push(v);
  return ticks;
}

// ---------- the chart ----------

/**
 * rows: [{ key, label, long, prefix, counts, members }]
 * opts: { width, theme, includeAbsent, exportMode, title, subtitle, source, axisTitle,
 *         scale: 'percent' (every bar is 100% wide) or 'seats' (bar length = number of MEPs) }
 * Returns { svg, height }.
 */
export function stackedBars(rows, opts) {
  const { width, theme, includeAbsent = false, exportMode = false } = opts;
  const positions = includeAbsent ? POSITIONS : VOTED;
  const pad = exportMode ? 44 : 0;
  const innerW = width - pad * 2;
  const narrow = innerW < 520;

  const out = [];
  let y = pad;

  // Title block (downloads only; on screen the card already has a title).
  if (exportMode) {
    for (const line of wrap(opts.title, innerW, 26, 700)) {
      y += 32;
      out.push(`<text x="${pad}" y="${y}" font-size="26" font-weight="700" fill="${theme.text}">${esc(line)}</text>`);
    }
    if (opts.subtitle) {
      for (const line of wrap(opts.subtitle, innerW, 16, 400, 2)) {
        y += 24;
        out.push(`<text x="${pad}" y="${y}" font-size="16" fill="${theme.textSecondary}">${esc(line)}</text>`);
      }
    }
    // Legend
    y += 34;
    let lx = pad;
    for (const p of positions) {
      out.push(`<rect x="${lx}" y="${y - 11}" width="14" height="14" rx="3" fill="${theme.colors[p]}"/>`);
      out.push(`<text x="${lx + 20}" y="${y}" font-size="14" fill="${theme.text}">${esc(POSITION_LABEL[p])}</text>`);
      lx += 20 + textWidth(POSITION_LABEL[p], 14) + 26;
    }
    y += 22;
  }

  // Label column: as wide as the longest label needs, within limits.
  const labelSize = 14;
  const metaFor = (row) => (includeAbsent
    ? `${row.members} MEP${row.members === 1 ? '' : 's'}`
    : `${votedTotal(row.counts)} of ${row.members} voted`);
  const longest = Math.max(60, ...rows.map((r) => Math.max(
    textWidth(`${r.prefix ? r.prefix + ' ' : ''}${r.label}`, labelSize, 600),
    textWidth(metaFor(r), 12, 400))));
  // On narrow screens (phones) the label goes ABOVE the bar, so the bar can use the full width.
  const stacked = narrow && !exportMode;
  const maxLabel = exportMode ? Math.min(420, innerW * 0.4) : Math.min(300, innerW * 0.34);
  const labelW = stacked ? innerW : Math.min(longest + 8, maxLabel);
  const gap = stacked ? 0 : 14;
  const plotX = stacked ? pad : pad + labelW + gap;
  const plotW = stacked ? innerW : Math.max(60, innerW - labelW - gap);

  const rowH = stacked ? 50 : 44;
  const barH = stacked ? 20 : 22;
  const plotTop = y;
  const plotH = rows.length * rowH;

  // Two ways to size the bars:
  //  - percent: every bar is the full width, so you compare shares;
  //  - seats:   all bars share one MEP scale, so a party with 8 MEPs is 8× as long as one with 1.
  const seats = opts.scale === 'seats';
  const rowTotal = (row) => (includeAbsent ? allTotal(row.counts) : votedTotal(row.counts));
  const seatTicks = seats ? niceTicks(Math.max(1, ...rows.map(rowTotal)), plotW < 320 ? 3 : 6) : null;
  const domainMax = seats ? seatTicks.at(-1) : 1;

  // Gridlines (drawn first so bars sit on top). Fewer of them when the plot is narrow,
  // so the labels never overlap. In percent mode the 50% line is a bit stronger:
  // that is where a majority starts.
  const ticks = seats
    ? seatTicks.map((v) => v / domainMax)
    : plotW < 320 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  const tickLabel = (t) => (seats ? String(Math.round(t * domainMax)) : `${t * 100}%`);
  const gridLines = (y1, y2) => {
    for (const t of ticks) {
      const gx = plotX + t * plotW;
      const strong = t === 0 || (!seats && t === 0.5);
      out.push(`<line x1="${gx}" y1="${y1}" x2="${gx}" y2="${y2}" stroke="${strong ? theme.axis : theme.grid}" stroke-width="1"/>`);
    }
  };
  // In the stacked (phone) layout the lines are drawn per row, so they don't cross the labels.
  if (!stacked) gridLines(plotTop, plotTop + plotH);

  rows.forEach((row, i) => {
    const top = plotTop + i * rowH;
    const total = rowTotal(row);
    const label = `${row.prefix ? row.prefix + ' ' : ''}${row.label}`;
    const meta = metaFor(row);

    const nav = opts.nav ? ` data-nav="row:${esc(row.key)}"` : '';
    out.push(`<g class="bar-row" data-key="${esc(row.key)}" tabindex="${exportMode ? -1 : 0}"${nav}>`);
    // Invisible rectangle that makes the whole row easy to hover.
    if (!exportMode) out.push(`<rect class="hit" x="${pad}" y="${top}" width="${innerW}" height="${rowH}" fill="transparent"/>`);
    if (stacked) {
      // One line: "Name  ·  12 of 15 voted", then the bar underneath.
      const metaW = textWidth(meta, 12) + 12;
      const name = fit(label, Math.max(40, innerW - metaW), labelSize, 600);
      out.push(`<text x="${pad}" y="${top + 16}" font-size="${labelSize}" font-weight="600" fill="${theme.text}">${esc(name)}</text>`);
      out.push(`<text x="${pad + innerW}" y="${top + 16}" font-size="12" text-anchor="end" fill="${theme.muted}">${esc(meta)}</text>`);
    } else {
      out.push(`<text x="${pad}" y="${top + 19}" font-size="${labelSize}" font-weight="600" fill="${theme.text}">${esc(fit(label, labelW, labelSize, 600))}</text>`);
      out.push(`<text x="${pad}" y="${top + 36}" font-size="12" fill="${theme.muted}">${esc(meta)}</text>`);
    }

    const barY = stacked ? top + 23 : top + (rowH - barH) / 2;
    if (stacked) gridLines(barY - 3, barY + barH + 3);
    if (!total) {
      out.push(`<text x="${plotX + 8}" y="${barY + barH / 2 + 4}" font-size="12" fill="${theme.muted}">Nobody voted</text>`);
    } else {
      const shown = positions.filter((p) => row.counts[p] > 0);
      let x = plotX;
      shown.forEach((p, j) => {
        const isLast = j === shown.length - 1;
        const fullW = (row.counts[p] / (seats ? domainMax : total)) * plotW;
        const w = Math.max(1, isLast ? fullW : fullW - 2); // 2px gap between segments
        const fill = theme.colors[p];
        const shape = isLast
          ? `<path d="${roundedEnd(x, barY, w, barH, 4)}" fill="${fill}"/>`
          : `<rect x="${x}" y="${barY}" width="${w}" height="${barH}" fill="${fill}"/>`;
        out.push(`<g class="seg" data-pos="${p}">${shape}</g>`);
        // Only print the number when it fits comfortably inside the segment.
        const pct = seats ? String(row.counts[p]) : percent(row.counts[p], total);
        if (w >= textWidth(pct, 12, 600) + 12) {
          out.push(`<text x="${x + w / 2}" y="${barY + barH / 2 + 4}" font-size="12" font-weight="600" text-anchor="middle" fill="${inkOn(fill)}" pointer-events="none">${pct}</text>`);
        }
        x += fullW;
      });
    }
    out.push('</g>');
  });

  // X axis labels
  y = plotTop + plotH + 18;
  for (const t of ticks) {
    const anchor = t === 0 ? 'start' : t === 1 ? 'end' : 'middle';
    out.push(`<text x="${plotX + t * plotW}" y="${y}" font-size="12" fill="${theme.muted}" text-anchor="${anchor}">${tickLabel(t)}</text>`);
  }
  y += 20;
  const axisTitle = opts.axisTitle || (seats
    ? (includeAbsent ? 'Number of MEPs (including those who didn’t vote)' : 'Number of MEPs who voted')
    : (includeAbsent ? 'Share of all MEPs (including those who didn’t vote)' : 'Share of MEPs who voted'));
  out.push(`<text x="${plotX + plotW / 2}" y="${y}" font-size="12" fill="${theme.textSecondary}" text-anchor="middle">${esc(axisTitle)}</text>`);

  if (exportMode && opts.source) {
    y += 36;
    out.push(`<line x1="${pad}" y1="${y - 18}" x2="${width - pad}" y2="${y - 18}" stroke="${theme.grid}"/>`);
    for (const line of wrap(opts.source, innerW, 12, 400, 2)) {
      out.push(`<text x="${pad}" y="${y}" font-size="12" fill="${theme.muted}">${esc(line)}</text>`);
      y += 17;
    }
    y -= 17;
  }

  const height = Math.ceil(y + (exportMode ? pad - 8 : 6));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${esc(FONT)}" role="img" aria-label="${esc(opts.title || 'Vote breakdown')}">` +
    (exportMode ? `<rect width="100%" height="100%" fill="${theme.surface}"/>` : '') +
    out.join('') + '</svg>';
  return { svg, height };
}
