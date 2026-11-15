// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — extracción desde la pestaña y montaje final de la nota.

export const VENDOR_FILES = [
  'vendor/Readability.js',
  'vendor/turndown.js',
  'vendor/turndown-plugin-gfm.js',
  'src/content/extract.js'
];

/**
 * Extrae el contenido de una pestaña. Necesita permiso sobre ella (activeTab tras un clic en
 * el icono, el menú contextual o el atajo). Lanza si la página no admite scripts (chrome://, tienda…).
 */
export async function extractFromTab(tabId, options) {
  await chrome.scripting.executeScript({ target: { tabId }, files: VENDOR_FILES });
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts) => window.__misNotasExtract(opts),
    args: [options]
  });
  if (!res || !res.result) throw new Error('extract-failed');
  return res.result;
}

const mdUrl = (u) => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
const mdText = (t) => t.replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')')).replace(/\s+/g, ' ').trim();

/** Enlace Markdown a la página. */
export function markdownLink(title, url) {
  return `[${mdText(title || url)}](${mdUrl(url)})`;
}

/** Añade al final la línea de la fuente. */
export function withSource(markdown, { title, url }, label) {
  if (!url || !/^https?:/i.test(url)) return markdown;
  const footer = `${label}: ${markdownLink(title, url)}`;
  return markdown ? `${markdown.trim()}\n\n---\n\n${footer}` : footer;
}
