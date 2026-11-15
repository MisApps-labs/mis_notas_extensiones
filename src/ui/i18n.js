// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — textos traducidos (_locales) en las páginas de la extensión.

export const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

/** Rellena los elementos con data-i18n, data-i18n-placeholder y data-i18n-title. */
export function localize(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute('aria-label', el.title);
  }
}

/** Mensaje de error legible a partir de su código. */
export function errorText(code) {
  const text = chrome.i18n.getMessage(`err_${code}`);
  return text || t('err_unknown');
}

/** Envía un mensaje al service worker y devuelve data o lanza un Error con .code. */
export async function call(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  if (!res) throw Object.assign(new Error('unknown'), { code: 'unknown' });
  if (!res.ok) throw Object.assign(new Error(res.error), { code: res.error });
  return res.data;
}

/** Lista de carpetas en árbol, con sangría, para un <select>. */
export function folderOptions(folders) {
  const children = new Map();
  const ids = new Set(folders.map((f) => f.id));
  for (const f of folders) {
    const parent = f.parentId && ids.has(f.parentId) ? f.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(f);
  }
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const out = [];
  const visit = (parent, depth, seen) => {
    const list = (children.get(parent) || []).sort((a, b) => collator.compare(a.name, b.name));
    for (const f of list) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, label: `${' '.repeat(depth)}${f.name || '—'}` });
      visit(f.id, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return out;
}

/** Rellena un <select> de carpetas: primero "Sin carpeta" y luego el árbol. */
export function fillFolderSelect(select, folders, selectedId, extra = []) {
  select.textContent = '';
  const none = new Option(t('folder_none'), '');
  select.add(none);
  for (const o of folderOptions(folders)) select.add(new Option(o.label, o.id));
  for (const o of extra) select.add(new Option(o.label, o.value));
  const wanted = selectedId || '';
  select.value = [...select.options].some((o) => o.value === wanted) ? wanted : '';
}
