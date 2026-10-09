// Everything that turns a chart or table into a file you can share.

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(text, filename) {
  // The invisible "﻿" at the start tells Excel the file is UTF-8,
  // so names like "UŠAKOVS" don't turn into garbage characters.
  downloadBlob(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), filename);
}

export function downloadSvg(svg, filename) {
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), filename);
}

// Draws the SVG onto a canvas at twice the size (sharp on retina screens and in slides).
export function svgToPng(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create PNG'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render chart image')); };
    img.src = url;
  });
}

// Puts the PNG on the clipboard, so you can paste it straight into WhatsApp, Slack, Word...
export async function copyPng(pngPromise) {
  if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Your browser cannot copy images');
  // Safari needs the ClipboardItem to be created right away with a promise inside it.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
}
