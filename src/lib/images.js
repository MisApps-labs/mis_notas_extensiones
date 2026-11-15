// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — copia las imágenes de la nota como adjuntos cifrados.
//
// Igual que ImageCompressor.kt: WebP con pérdida, lado mayor de 1600 px como máximo, calidad 0,75.
// Si una imagen no se puede descargar (p. ej. la web no lo permite) se deja como enlace remoto,
// que las apps también muestran.

import { encryptAttachment, attachmentFile, attachmentRef } from './codec.js';

const MAX_DIMENSION = 1600;
const QUALITY = 0.75;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/** ![alt](url) o ![alt](url "título") en una línea propia o dentro del texto. */
const IMAGE_RE = /!\[([^\]\n]*)\]\(\s*<?((?:https?:\/\/|data:image\/)[^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { credentials: 'omit', signal: ctrl.signal, referrerPolicy: 'no-referrer' });
  } finally {
    clearTimeout(timer);
  }
}

/** Descarga y recomprime una imagen. Devuelve los bytes o null si es diminuta (píxel espía, icono). */
async function compress(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`http-${res.status}`);
  const blob = await res.blob();
  if (blob.size === 0 || blob.size > MAX_INPUT_BYTES) throw new Error('size');
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < 24 || bitmap.height < 24) return null;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    let out = await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
    // Si el navegador no codifica WebP devuelve PNG: mejor JPEG (las apps detectan el tipo por los bytes).
    if (out.type !== 'image/webp') out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return new Uint8Array(await out.arrayBuffer());
  } finally {
    bitmap.close?.();
  }
}

/**
 * Sustituye las imágenes del Markdown por adjuntos cifrados.
 * @returns {Promise<{content: string, files: Array<{name, data, contentType}>}>}
 */
export async function embedImages(markdown, key, maxImages) {
  const urls = [];
  for (const m of markdown.matchAll(IMAGE_RE)) {
    if (!urls.includes(m[2]) && urls.length < maxImages) urls.push(m[2]);
  }
  const replacements = new Map();
  const files = [];
  // De tres en tres: más rápido sin saturar la web de origen.
  for (let i = 0; i < urls.length; i += 3) {
    await Promise.all(urls.slice(i, i + 3).map(async (url) => {
      try {
        const bytes = await compress(url);
        if (bytes === null) { replacements.set(url, null); return; }
        const id = crypto.randomUUID();
        files.push({
          name: attachmentFile(id),
          data: await encryptAttachment(bytes, id, key),
          contentType: 'application/octet-stream'
        });
        replacements.set(url, id);
      } catch {
        // Se queda como enlace remoto.
      }
    }));
  }

  const content = markdown.replace(IMAGE_RE, (whole, alt, url) => {
    if (!replacements.has(url)) return whole;
    const id = replacements.get(url);
    return id === null ? '' : `![${alt}](${attachmentRef(id)})`;
  });
  return { content: content.replace(/\n{3,}/g, '\n\n').trim(), files };
}
