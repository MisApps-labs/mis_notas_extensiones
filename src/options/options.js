// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ferlagod
// Mis Notas para Chromium — ajustes: cuenta de Nextcloud, contraseña maestra y preferencias.

import { t, localize, errorText, call, fillFolderSelect } from '../ui/i18n.js';
import {
  normalizeServer, buildRootUrl, requestServerPermission, startLoginFlow, fetchUserId, originPattern
} from '../lib/nextcloud.js';
import { passwordVariants, deriveKeyBytes, importAesKey } from '../lib/crypto.js';
import { verifyKey } from '../lib/codec.js';
import { fetchKeyInfo, errorCode } from '../lib/sync.js';
import {
  getAccount, setAccount, clearAccount, getKey, setKey, clearKey, setVault, getPrefs, setPrefs,
  getFolderCache, clearQueue
} from '../lib/store.js';

const $ = (id) => document.getElementById(id);
const IMAGE_ORIGINS = { origins: ['https://*/*', 'http://*/*'] };

localize();

function notice(id, text, kind = 'error') {
  const el = $(id);
  el.className = `notice ${kind}`;
  el.textContent = text || '';
}

function busy(button, on) {
  button.disabled = on;
  if (on) {
    button.dataset.label = button.textContent;
    button.innerHTML = '<span class="spinner"></span>';
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

/** Mensaje para un error de conexión o de servidor. */
function describe(e) {
  const m = e?.message || '';
  if (e?.code) return errorText(e.code);
  if (m === 'auth' || m === 'network') return errorText(m);
  if (/^http-/.test(m)) return errorText('server');
  if (/^login-flow/.test(m)) return t('err_login_flow');
  if (e instanceof TypeError) return errorText('network');
  return errorText(errorCode(e));
}

// ------------------------------------------------------------------
// Estado
// ------------------------------------------------------------------

async function render() {
  const account = await getAccount();
  const key = account ? await getKey() : null;

  $('account-connected').hidden = !account;
  $('account-form').hidden = Boolean(account);
  if (account) {
    $('account-summary').textContent = t('opt_connected_as', [account.loginName, account.server]);
  }

  $('vault-needs-account').hidden = Boolean(account);
  $('vault-unlocked').hidden = !(account && key);
  $('vault-form').hidden = !(account && !key);

  await renderPrefs();
  await renderQueue();
}

async function renderPrefs() {
  const prefs = await getPrefs();
  const cache = await getFolderCache();
  fillFolderSelect($('default-folder'), cache.list, prefs.defaultFolderId);
  $('pref-images').checked = prefs.saveImages;
  $('pref-source').checked = prefs.addSource;
  $('pref-tasks').checked = prefs.ingredientsAsTasks;
  const granted = await chrome.permissions.contains(IMAGE_ORIGINS);
  $('images-permission').hidden = !prefs.saveImages || granted;
}

async function renderQueue() {
  let status;
  try {
    status = await call('status');
  } catch {
    return;
  }
  $('queue').hidden = status.pending.length === 0;
  $('queue-list').textContent = '';
  for (const item of status.pending) {
    const li = document.createElement('li');
    const kind = item.kind === 'folder' ? t('queue_folder') : t('queue_note');
    li.textContent = `${kind}: ${item.label || '—'}${item.lastError ? ` — ${errorText(item.lastError)}` : ''}`;
    $('queue-list').append(li);
  }
}

async function refreshFolders() {
  try {
    await call('folders');
    await renderPrefs();
  } catch (e) {
    if (e.code !== 'locked' && e.code !== 'not_configured') notice('vault-notice', errorText(e.code));
  }
}

// ------------------------------------------------------------------
// 1. Cuenta
// ------------------------------------------------------------------

/** Guarda la cuenta tras comprobar las credenciales y que exista la bóveda de Mis Notas. */
async function saveAccount(server, loginName, appPassword) {
  const userId = await fetchUserId(server, loginName, appPassword);
  await setAccount({ server, loginName, userId, appPassword, rootUrl: buildRootUrl(server, userId) });
  try {
    await fetchKeyInfo();
    notice('account-notice', t('opt_connected_ok'), 'ok');
  } catch (e) {
    // La cuenta vale, pero aún no hay notas sincronizadas: se avisa y se mantiene.
    notice('account-notice', errorText(errorCode(e)), 'warn');
  }
  await render();
  if (!$('vault-form').hidden) $('master').focus();
}

function readServer() {
  try {
    return normalizeServer($('server').value);
  } catch (e) {
    notice('account-notice', e.message === 'server-empty' ? t('err_server_empty') : t('err_server_invalid'));
    return null;
  }
}

let loginAbort = null;
let loginTabId = null;

$('login-flow').addEventListener('click', async () => {
  const server = readServer();
  if (!server) return;
  notice('account-notice', '');
  // El permiso se pide lo primero: solo se concede durante el clic.
  if (!(await requestServerPermission(server))) {
    notice('account-notice', t('err_permission'));
    return;
  }
  loginAbort = new AbortController();
  busy($('login-flow'), true);
  try {
    const flow = await startLoginFlow(server, { signal: loginAbort.signal });
    const tab = await chrome.tabs.create({ url: flow.loginUrl });
    loginTabId = tab.id;
    $('login-waiting').hidden = false;
    const result = await flow.poll();
    await saveAccount(server, result.loginName, result.appPassword);
  } catch (e) {
    if (e?.name !== 'AbortError') notice('account-notice', describe(e));
  } finally {
    $('login-waiting').hidden = true;
    busy($('login-flow'), false);
    if (loginTabId != null) {
      chrome.tabs.remove(loginTabId).catch(() => {});
      loginTabId = null;
      chrome.tabs.getCurrent().then((me) => me && chrome.tabs.update(me.id, { active: true })).catch(() => {});
    }
    loginAbort = null;
  }
});

$('login-cancel').addEventListener('click', () => loginAbort?.abort());

$('show-manual').addEventListener('click', () => {
  $('manual').hidden = !$('manual').hidden;
  if (!$('manual').hidden) $('username').focus();
});

$('connect').addEventListener('click', async () => {
  const server = readServer();
  const loginName = $('username').value.trim();
  const appPassword = $('app-password').value.trim();
  if (!server) return;
  if (!loginName || !appPassword) { notice('account-notice', t('err_fields')); return; }
  if (!(await requestServerPermission(server))) {
    notice('account-notice', t('err_permission'));
    return;
  }
  busy($('connect'), true);
  notice('account-notice', '');
  try {
    await saveAccount(server, loginName, appPassword);
    $('app-password').value = '';
  } catch (e) {
    notice('account-notice', describe(e));
  } finally {
    busy($('connect'), false);
  }
});

$('disconnect').addEventListener('click', async () => {
  const status = await call('status').catch(() => null);
  const pending = status?.pending.length || 0;
  if (!confirm(pending ? t('opt_disconnect_confirm_pending', [String(pending)]) : t('opt_disconnect_confirm'))) return;
  const account = await getAccount();
  await clearAccount();
  await setPrefs({ defaultFolderId: null, lastFolderId: undefined });
  if (account) chrome.permissions.remove({ origins: [originPattern(account.server)] }).catch(() => {});
  notice('account-notice', '');
  notice('vault-notice', '');
  await call('badge').catch(() => {});
  await render();
});

// ------------------------------------------------------------------
// 2. Contraseña maestra
// ------------------------------------------------------------------

async function unlock() {
  const password = $('master').value;
  if (!password) return;
  busy($('unlock'), true);
  notice('vault-notice', '');
  try {
    const info = await fetchKeyInfo();
    let raw = null;
    for (const variant of passwordVariants(password)) {
      const bytes = await deriveKeyBytes(variant, info.salt, info.iterations);
      if (await verifyKey(info, await importAesKey(bytes))) { raw = bytes; break; }
    }
    if (!raw) { notice('vault-notice', t('err_wrong_password')); return; }
    await setKey(raw, $('remember').checked);
    raw.fill(0);
    await setVault({ saltB64: info.saltB64, iterations: info.iterations, check: info.check });
    await setPrefs({ rememberKey: $('remember').checked });
    $('master').value = '';
    notice('vault-notice', t('opt_unlocked_ok'), 'ok');
    await render();
    await refreshFolders();
    call('flush').then(renderQueue).catch(() => {});
  } catch (e) {
    notice('vault-notice', describe(e));
  } finally {
    busy($('unlock'), false);
  }
}

$('unlock').addEventListener('click', unlock);
$('master').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

$('lock').addEventListener('click', async () => {
  await clearKey();
  notice('vault-notice', '');
  await render();
});

// ------------------------------------------------------------------
// 3. Preferencias
// ------------------------------------------------------------------

$('default-folder').addEventListener('change', () => setPrefs({ defaultFolderId: $('default-folder').value || null }));
$('refresh-folders').addEventListener('click', async () => {
  busy($('refresh-folders'), true);
  await refreshFolders();
  busy($('refresh-folders'), false);
});

$('pref-images').addEventListener('change', async () => {
  const on = $('pref-images').checked;
  // Se pide el permiso dentro del clic; si se rechaza, se sigue intentando con las webs que lo permiten.
  if (on) await chrome.permissions.request(IMAGE_ORIGINS).catch(() => false);
  await setPrefs({ saveImages: on });
  await renderPrefs();
});

$('grant-images').addEventListener('click', async () => {
  await chrome.permissions.request(IMAGE_ORIGINS).catch(() => false);
  await renderPrefs();
});

$('pref-source').addEventListener('change', () => setPrefs({ addSource: $('pref-source').checked }));
$('pref-tasks').addEventListener('change', () => setPrefs({ ingredientsAsTasks: $('pref-tasks').checked }));

$('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  // Firefox tiene su propia API; en Chromium se abre la página de atajos.
  if (chrome.commands?.openShortcutSettings) chrome.commands.openShortcutSettings();
  else chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {});
});

// ------------------------------------------------------------------
// Pendientes
// ------------------------------------------------------------------

$('retry').addEventListener('click', async () => {
  busy($('retry'), true);
  notice('queue-notice', '');
  try {
    const remaining = await call('flush');
    notice('queue-notice', remaining ? t('opt_queue_still', [String(remaining)]) : t('opt_queue_done'), remaining ? 'warn' : 'ok');
  } catch (e) {
    notice('queue-notice', errorText(e.code));
  } finally {
    busy($('retry'), false);
    await renderQueue();
  }
});

$('discard').addEventListener('click', async () => {
  if (!confirm(t('opt_discard_confirm'))) return;
  await clearQueue();
  await call('badge').catch(() => {});
  await renderQueue();
});

// ------------------------------------------------------------------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.folders) renderPrefs();
});

render().then(async () => {
  if ((await getAccount()) && (await getKey())) refreshFolders();
});
