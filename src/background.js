// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — service worker: menú contextual, guardado, cola y avisos.

import { saveNote, createFolder, refreshFolders, flushQueue, errorCode } from './lib/sync.js';
import { getAccount, getKey, getPrefs, getQueue, getFolderCache } from './lib/store.js';
import { extractFromTab, markdownLink, withSource } from './lib/compose.js';

const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

// ------------------------------------------------------------------
// Instalación, menú contextual y reintentos
// ------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'save-page', title: t('menu_save_page'), contexts: ['page'] });
  chrome.contextMenus.create({ id: 'save-selection', title: t('menu_save_selection'), contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'save-link', title: t('menu_save_link'), contexts: ['link'] });
  chrome.contextMenus.create({ id: 'save-image', title: t('menu_save_image'), contexts: ['image'] });
  chrome.alarms.create('flush', { periodInMinutes: 15 });
  if (reason === 'install') chrome.runtime.openOptionsPage();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => tryFlush());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush') tryFlush();
});

async function tryFlush() {
  try {
    if ((await getQueue()).length) await flushQueue();
  } catch {
    // Se reintentará en la próxima alarma.
  }
  updateBadge();
}

// ------------------------------------------------------------------
// Insignia del icono: notas pendientes o resultado del último guardado
// ------------------------------------------------------------------

let flashTimer = null;

async function updateBadge() {
  if (flashTimer) return;
  const pending = (await getQueue()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#C77700' });
  await chrome.action.setBadgeText({ text: pending ? String(pending) : '' });
  await chrome.action.setTitle({ title: pending ? t('badge_pending', [String(pending)]) : t('ext_name') });
}

async function flashBadge(ok) {
  if (flashTimer) clearTimeout(flashTimer);
  await chrome.action.setBadgeBackgroundColor({ color: ok ? '#557331' : '#B3261E' });
  await chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  flashTimer = setTimeout(() => { flashTimer = null; updateBadge(); }, 2500);
}

// ------------------------------------------------------------------
// Menú contextual: guardado rápido en la carpeta por defecto
// ------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (!(await getAccount()) || !(await getKey())) {
      chrome.runtime.openOptionsPage();
      return;
    }
    const prefs = await getPrefs();
    const page = { title: tab?.title || '', url: info.pageUrl || tab?.url || '' };
    let title = page.title;
    let content = '';
    let addSource = prefs.addSource;

    if (info.menuItemId === 'save-link') {
      title = (info.linkText || info.linkUrl || '').trim();
      content = markdownLink(title, info.linkUrl);
    } else if (info.menuItemId === 'save-image') {
      content = `![](${info.srcUrl.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
    } else {
      const mode = info.menuItemId === 'save-selection' ? 'selection' : 'recipe'; // receta o, si no hay, artículo
      try {
        const res = await extractFromTab(tab.id, { mode, ingredientsAsTasks: prefs.ingredientsAsTasks });
        title = res.title || title;
        content = res.markdown;
      } catch {
        // Página sin scripts (p. ej. un PDF): texto plano de la selección o enlace.
        content = info.selectionText || markdownLink(page.title, page.url);
        if (!info.selectionText) addSource = false;
      }
    }
    if (addSource) content = withSource(content, page, t('source_label'));

    const result = await saveNote({ title, content, folderId: prefs.defaultFolderId });
    await flashBadge(true);
    if (result.status === 'queued') updateBadge();
  } catch (e) {
    console.warn('[Mis Notas]', e);
    await flashBadge(false);
    const code = errorCode(e);
    if (code === 'locked' || code === 'vault_changed' || code === 'not_configured') chrome.runtime.openOptionsPage();
  }
});

// ------------------------------------------------------------------
// Mensajes de la ventana emergente y de los ajustes
// ------------------------------------------------------------------

const handlers = {
  async status() {
    const [account, key, queue, folders, prefs] = await Promise.all([
      getAccount(), getKey(), getQueue(), getFolderCache(), getPrefs()
    ]);
    return {
      configured: Boolean(account),
      unlocked: Boolean(key),
      account: account ? { server: account.server, loginName: account.loginName } : null,
      pending: queue.map((i) => ({ id: i.id, kind: i.kind, label: i.label, attempts: i.attempts, lastError: i.lastError })),
      folders: folders.list,
      prefs
    };
  },
  async save({ note }) {
    const result = await saveNote(note);
    flashBadge(true);
    return result;
  },
  async folders() {
    return refreshFolders();
  },
  async createFolder({ name, parentId }) {
    return createFolder(name, parentId);
  },
  async flush() {
    const remaining = await flushQueue();
    updateBadge();
    return remaining;
  },
  async badge() {
    updateBadge();
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => {
      console.warn('[Mis Notas]', e);
      sendResponse({ ok: false, error: errorCode(e) });
    })
    .finally(() => updateBadge());
  return true;
});
