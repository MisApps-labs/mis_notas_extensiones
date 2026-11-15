// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — ventana emergente: vista previa, carpeta y guardar.

import { t, localize, errorText, call, fillFolderSelect } from '../ui/i18n.js';
import { extractFromTab, markdownLink, withSource } from '../lib/compose.js';
import { setPrefs } from '../lib/store.js';

const $ = (id) => document.getElementById(id);
const NEW_FOLDER = '__new__';

let status = null;
let tab = null;
let folders = [];
let currentMode = null;
let scriptable = true;

localize();
$('settings').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

function notice(text, kind = 'error') {
  const el = $('notice');
  el.className = `notice ${kind}`;
  el.textContent = text || '';
}

function showGate(text, buttonText) {
  $('gate').hidden = false;
  $('main').hidden = true;
  $('gate-text').textContent = text;
  $('gate-button').textContent = buttonText;
  $('gate-button').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
}

function renderFolders(selected) {
  fillFolderSelect($('folder'), folders, selected, [{ value: NEW_FOLDER, label: t('folder_new_option') }]);
}

function renderPending() {
  const n = status.pending.length;
  $('pending').textContent = n ? t('badge_pending', [String(n)]) : '';
}

function setModes(available) {
  for (const b of $('modes').querySelectorAll('button')) {
    const m = b.dataset.mode;
    const ok = scriptable ? (m !== 'recipe' || available.recipe) && (m !== 'selection' || available.selection) : m === 'link';
    b.hidden = !ok;
    b.setAttribute('aria-selected', String(m === currentMode));
  }
}

async function load(mode) {
  $('extracting').hidden = false;
  notice('');
  const page = { title: tab.title || '', url: tab.url || '' };
  try {
    if (!scriptable) throw new Error('not-scriptable');
    const res = await extractFromTab(tab.id, { mode, ingredientsAsTasks: status.prefs.ingredientsAsTasks });
    currentMode = res.mode;
    $('title').value = res.title || page.title;
    const content = res.mode !== 'link' && status.prefs.addSource
      ? withSource(res.markdown, { title: res.title || page.title, url: res.url }, t('source_label'))
      : res.markdown;
    $('content').value = content;
    setModes(res.modes);
  } catch {
    // chrome://, la tienda de extensiones, visores de PDF…: solo se puede guardar el enlace.
    scriptable = false;
    currentMode = 'link';
    $('title').value = page.title || page.url;
    $('content').value = page.url ? markdownLink(page.title, page.url) : '';
    setModes({});
    if (mode !== 'link') notice(t('popup_not_scriptable'), 'warn');
  } finally {
    $('extracting').hidden = true;
  }
}

$('modes').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b || b.dataset.mode === currentMode) return;
  load(b.dataset.mode);
});

// ------------------------------------------------------------------
// Carpetas
// ------------------------------------------------------------------

let previousFolder = '';

$('folder').addEventListener('focus', () => { previousFolder = $('folder').value; });
$('folder').addEventListener('change', () => {
  if ($('folder').value !== NEW_FOLDER) { previousFolder = $('folder').value; return; }
  $('new-folder').hidden = false;
  $('new-folder-name').value = '';
  $('new-folder-name').focus();
});

function closeNewFolder() {
  $('new-folder').hidden = true;
  if ($('folder').value === NEW_FOLDER) $('folder').value = previousFolder;
}

$('new-folder-cancel').addEventListener('click', closeNewFolder);
$('new-folder-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('new-folder-ok').click(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNewFolder(); }
});

$('new-folder-ok').addEventListener('click', async () => {
  const name = $('new-folder-name').value.trim();
  if (!name) return;
  $('new-folder-ok').disabled = true;
  try {
    const parentId = previousFolder || null;
    const res = await call('createFolder', { name, parentId });
    folders = [...folders.filter((f) => f.id !== res.folder.id), res.folder];
    renderFolders(res.folder.id);
    previousFolder = res.folder.id;
    $('new-folder').hidden = true;
    if (res.status === 'queued') notice(t('popup_folder_queued'), 'warn');
  } catch (e) {
    notice(errorText(e.code));
  } finally {
    $('new-folder-ok').disabled = false;
  }
});

// ------------------------------------------------------------------
// Guardar
// ------------------------------------------------------------------

async function save() {
  const content = $('content').value.trim();
  const title = $('title').value.trim();
  if (!content && !title) { notice(t('popup_empty')); return; }
  const folderId = $('folder').value === NEW_FOLDER ? previousFolder : $('folder').value;
  const saveImages = $('save-images').checked;

  $('save').disabled = true;
  $('save').innerHTML = '<span class="spinner"></span>';
  notice('');
  setPrefs({ lastFolderId: folderId || null, saveImages });
  try {
    const res = await call('save', { note: { title, content, folderId: folderId || null, saveImages } });
    if (res.status === 'saved') {
      notice(t('popup_saved'), 'ok');
      setTimeout(() => window.close(), 1100);
    } else {
      notice(`${t('popup_queued')} (${errorText(res.error)})`, 'warn');
      setTimeout(() => window.close(), 3000);
    }
    $('save').textContent = '✓';
  } catch (e) {
    notice(errorText(e.code));
    $('save').disabled = false;
    $('save').textContent = t('save');
  }
}

$('save').addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!$('save').disabled) save(); }
});

// ------------------------------------------------------------------
// Inicio
// ------------------------------------------------------------------

(async () => {
  try {
    status = await call('status');
  } catch (e) {
    showGate(errorText(e.code), t('popup_open_settings'));
    return;
  }
  if (!status.configured) { showGate(t('popup_not_configured'), t('popup_open_settings')); return; }
  if (!status.unlocked) { showGate(t('popup_locked'), t('popup_unlock')); return; }

  $('main').hidden = false;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  scriptable = Boolean(tab && /^(https?|file):/i.test(tab.url || ''));

  const prefs = status.prefs;
  $('save-images').checked = prefs.saveImages;
  folders = status.folders;
  const selected = prefs.lastFolderId !== undefined ? prefs.lastFolderId : prefs.defaultFolderId;
  renderFolders(selected);
  previousFolder = $('folder').value;
  renderPending();

  load('auto');
  $('title').focus();

  // Carpetas al día (sin bloquear la ventana).
  call('folders').then((list) => {
    folders = list;
    const keep = $('folder').value === NEW_FOLDER ? previousFolder : $('folder').value;
    renderFolders(keep);
  }).catch((e) => {
    if (['auth', 'vault_changed', 'vault_missing', 'root_missing'].includes(e.code)) notice(errorText(e.code));
  });
})();
