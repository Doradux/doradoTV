import { TvMinimal, ArrowRight, Plus, DoorOpen, LockKeyhole, Mail, LogOut, Settings2, Copy, Download, X, ChevronDown } from 'lucide';
import { iconSvg, morphSvg, escapeHtml } from './ui.js';
import { roomApi, navigateRoom } from './room-api.js';
import { createDialog, reveal } from './motion.js';
import { createCustomSelect } from './custom-select.js';
import { renderGoogleSignIn } from './google-signin.js';

const brand = `<a class="brand" href="/">${iconSvg(TvMinimal, 'h-6 w-6')}<span>Dorado<span class="brand-tv">TV</span></span></a>`;
let turnstilePromise;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstilePromise) turnstilePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
    script.onload = () => resolve(window.turnstile); script.onerror = () => { turnstilePromise = null; script.remove(); reject(new Error('No se pudo cargar la comprobación de seguridad.')); };
    document.head.append(script);
  });
  return turnstilePromise;
}
export async function mountPortal(app, config, initial = {}) {
  let mode = initial.mode || 'join', widget = null, captchaToken = '', needsCaptcha = false;
  const requestedRoom = new URLSearchParams(location.search).get('room') || '';
  app.innerHTML = `<main class="portal-shell"><div class="portal-layout"><header class="portal-header">${brand}</header><section class="portal-card" aria-labelledby="entry-title"><div class="portal-tabs" role="group" aria-label="Tipo de acceso"><button type="button" data-mode="join">${iconSvg(DoorOpen, 'h-4 w-4')}Entrar en una sala</button><button type="button" data-mode="login">${iconSvg(LockKeyhole, 'h-4 w-4')}Mis salas</button></div><div class="portal-card-content"></div></section></div></main>`;
  const card = app.querySelector('.portal-card');
  const content = card.querySelector('.portal-card-content');
  card.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button || mode === button.dataset.mode) return;
    mode = button.dataset.mode; needsCaptcha = false; initial.message = ''; render();
    card.querySelector(`[data-mode="${mode}"]`)?.focus({ preventScroll: true });
  });
  const disposeWidget = () => { if (widget !== null && window.turnstile) window.turnstile.remove(widget); widget = null; captchaToken = ''; };
  async function renderCaptcha() {
    if (!config.siteKey || !app.querySelector('#captcha')) return;
    const container = app.querySelector('#captcha');
    try {
      const turnstile = await loadTurnstile();
      if (!container.isConnected) return;
      widget = turnstile.render(container, { sitekey: config.siteKey, theme: 'dark', size: container.clientWidth < 300 ? 'compact' : 'normal', action: 'access', callback: (token) => { captchaToken = token; }, 'expired-callback': () => { captchaToken = ''; }, 'error-callback': () => { captchaToken = ''; } });
    } catch (error) { if (container.isConnected) app.querySelector('#entry-message').textContent = error.message; }
  }
  function render(message = '') {
    disposeWidget();
    if (!['join', 'profile'].includes(mode)) mode = 'login';
    const titles = { join: 'Entrar en una sala', login: 'Mis salas', profile: 'Nombre de usuario' };
    card.dataset.access = mode === 'join' ? 'join' : 'account';
    card.querySelectorAll('.portal-tabs button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === 'join' ? mode === 'join' : mode !== 'join')));
    card.querySelector('.portal-tabs')?.classList.toggle('hidden', mode === 'profile');
    if (mode === 'login') {
      if (config.googleClientId) {
        content.innerHTML = `<div class="portal-card-heading"><div class="portal-card-icon" aria-hidden="true">${iconSvg(LockKeyhole, 'h-5 w-5')}</div><h2 id="entry-title">${titles[mode]}</h2></div><div class="google-access"><div id="google-button" class="google-button"></div><p class="field-help">La primera vez elegirás tu nombre de usuario.</p><p id="entry-message" class="form-message" role="status" aria-live="polite">${escapeHtml(message || initial.message || '')}</p><button id="google-retry" type="button" class="secondary-button hidden">Volver a intentar</button></div>`;
        const container = content.querySelector('#google-button'), status = content.querySelector('#entry-message'), retry = content.querySelector('#google-retry');
        const start = () => {
          retry.classList.add('hidden');
          renderGoogleSignIn(container, config.googleClientId, {
            onPending: () => { status.textContent = 'Comprobando tu cuenta…'; },
            onSuccess: (account) => {
              if (account?.needsUsername) {
                mode = 'profile';
                render();
              } else {
                navigateRoom();
              }
            },
            onError: (error) => { status.textContent = error.message; retry.classList.remove('hidden'); },
          });
        };
        retry.onclick = () => { status.textContent = ''; start(); };
        reveal(content); start(); return;
      }
      content.innerHTML = `<div class="portal-card-heading"><div class="portal-card-icon" aria-hidden="true">${iconSvg(LockKeyhole, 'h-5 w-5')}</div><h2 id="entry-title">${titles[mode]}</h2></div><p class="form-message" role="status">${escapeHtml(message || initial.message || 'El acceso a cuentas está configurado únicamente con Google. Configura GOOGLE_CLIENT_ID.')}</p>`;
      reveal(content); return;
    }
    content.innerHTML = `<div class="portal-card-heading"><div class="portal-card-icon" aria-hidden="true">${iconSvg(mode === 'join' ? DoorOpen : LockKeyhole, 'h-5 w-5')}</div><h2 id="entry-title">${titles[mode]}</h2></div><form id="entry-form" class="room-form">
      ${mode === 'join' ? `<label>Nombre único de la sala<input name="room" required minlength="3" maxlength="40" pattern="[a-zA-Z0-9][a-zA-Z0-9-]{2,39}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="por-ejemplo-casa" value="${escapeHtml(requestedRoom)}" /></label><label>Contraseña de la sala<input name="password" type="password" required maxlength="128" autocomplete="current-password" placeholder="Tu contraseña" /></label>` : ''}
      ${mode === 'profile' ? '<label>Nombre de usuario<input name="username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_.-]{3,30}" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="usuario" /><small>3–30 letras, números, puntos o guiones.</small></label>' : ''}
      ${needsCaptcha && config.siteKey ? '<div id="captcha"></div>' : ''}
      <p id="entry-message" class="form-message" role="status" aria-live="polite">${escapeHtml(message || initial.message || (!config.ready ? 'Las salas no están habilitadas. Falta completar la configuración del servicio.' : ''))}</p>
      <button class="primary-button" type="submit" ${!config.ready ? 'disabled' : ''}>${mode === 'join' ? 'Entrar en la sala' : 'Guardar y continuar'}${iconSvg(ArrowRight, 'h-4 w-4')}</button></form>
      ${mode === 'profile' ? '<div class="portal-secondary"><button id="profile-logout" type="button">Cerrar sesión</button></div>' : ''}`;
    reveal(content);
    const profileLogout = content.querySelector('#profile-logout');
    if (profileLogout) profileLogout.onclick = async () => {
      try { await roomApi('logout', { data: {} }); navigateRoom(); }
      catch (error) { content.querySelector('#entry-message').textContent = error.message; }
    };
    app.querySelector('#entry-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector('[type="submit"]'), status = app.querySelector('#entry-message'), submittedMode = mode;
      button.disabled = true; status.textContent = 'Un momento…';
      try {
        const data = { ...Object.fromEntries(new FormData(form)), captcha: captchaToken };
        const result = await roomApi(submittedMode === 'profile' ? 'username' : submittedMode, { data });
        if (!form.isConnected) return;
        if (submittedMode === 'join') navigateRoom(result.room.slug);
        else if (submittedMode === 'profile') navigateRoom();
      } catch (error) {
        if (!form.isConnected) return;
        status.textContent = error.message;
        if (error.captchaRequired && !needsCaptcha && config.siteKey) {
          needsCaptcha = true;
          const container = document.createElement('div'); container.id = 'captcha'; status.before(container); renderCaptcha();
        }
      } finally {
        if (button.isConnected) button.disabled = false;
        if (form.isConnected && widget !== null) { window.turnstile.reset(widget); captchaToken = ''; }
      }
    });
    if (app.querySelector('#captcha')) renderCaptcha();
  }
  render();
}

export async function mountDashboard(app, account) {
  app.innerHTML = `<div class="app-shell rooms-dashboard"><header class="app-header">${brand}<div class="header-actions"><span class="account-name">${escapeHtml((account.username || account.name))}</span><button id="account-logout" class="icon-button" aria-label="Cerrar sesión">${iconSvg(LogOut)}</button></div></header><main><div class="dashboard-heading"><div><h1>Mis salas</h1></div><button id="create-open" class="primary-button">${iconSvg(Plus)} Crear sala</button></div><section id="create-panel" class="room-create-panel hidden" aria-labelledby="create-title"><div><h2 id="create-title">Nueva sala</h2><p>Hasta 3 salas por cuenta. La contraseña de la sala es independiente de la de tu cuenta.</p></div><form id="create-room" class="room-form"><label>Título de la sala<input name="title" required maxlength="60" placeholder="La tele de casa" /></label><label>Nombre único<input name="slug" required pattern="[a-z0-9][a-z0-9-]{2,39}" minlength="3" maxlength="40" autocapitalize="none" spellcheck="false" placeholder="la-tele-de-casa" /><small>Solo letras minúsculas, números y guiones.</small></label><label>Contraseña para invitados<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="Al menos 10 caracteres" /></label><p class="form-message" id="create-message" role="status"></p><button type="submit" class="primary-button">Crear sala ${iconSvg(ArrowRight)}</button></form></section><div id="rooms-grid" class="rooms-grid" aria-live="polite"><p class="list-empty">Cargando tus salas…</p></div><p class="dashboard-footnote">Tus invitados solo necesitan el nombre de la sala y su contraseña.</p><a class="text-link" href="/?join=1">Entrar en otra sala como invitado ${iconSvg(ArrowRight, 'h-4 w-4')}</a></main></div>`;
  app.querySelector('#account-logout').onclick = async () => { await roomApi('logout', { data: {} }); navigateRoom(); };
  app.querySelector('#create-open').onclick = () => { const panel = app.querySelector('#create-panel'); panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) panel.querySelector('input').focus(); };
  app.querySelector('#create-room').onsubmit = async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try { const room = await roomApi('create', { data: Object.fromEntries(new FormData(event.currentTarget)) }); navigateRoom(room.slug); }
    catch (error) { app.querySelector('#create-message').textContent = error.message; button.disabled = false; }
  };
  try {
    const { rooms } = await roomApi('mine');
    app.querySelector('#create-open').disabled = rooms.length >= 3;
    app.querySelector('#rooms-grid').innerHTML = rooms.length ? rooms.map((room, index) => `<a class="room-card" href="/?room=${encodeURIComponent(room.slug)}" style="--row-delay:${index * 60}ms"><div class="room-card-top"><span class="room-card-icon">${iconSvg(TvMinimal, 'h-6 w-6')}</span><span class="room-private">${iconSvg(LockKeyhole, 'h-3 w-3')} Privada</span></div><h2>${escapeHtml(room.title)}</h2><p class="room-slug">${escapeHtml(room.slug)}</p><div class="room-card-bottom"><span>${room.channelCount ? `${room.channelCount.toLocaleString('es')} canales` : 'Lista pendiente de subir'}</span>${iconSvg(ArrowRight)}</div></a>`).join('') : `<div class="rooms-empty"><span class="empty-icon">${iconSvg(DoorOpen, 'h-9 w-9')}</span><h2>No has creado ninguna sala.</h2></div>`;
  } catch (error) { app.querySelector('#rooms-grid').textContent = error.message; }
}

export function mountRoomSettings(shell, initialRoom, opener, { account, onUpdate, onRevoke }) {
  let room = initialRoom;
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 hidden items-center justify-center p-4'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'settings-title');
  modal.innerHTML = `<div class="room-settings-panel"><div class="settings-heading"><div><h2 id="settings-title">Ajustes de la sala</h2></div><button id="settings-close" class="icon-button" aria-label="Cerrar ajustes">${iconSvg(X)}</button></div><form id="settings-form" class="room-form"><label>Título<input name="title" required maxlength="60" /></label><div class="room-share"><span>${escapeHtml(room.slug)}</span><button id="copy-room" type="button" class="text-link">${iconSvg(Copy, 'h-4 w-4')} Copiar enlace</button></div><label>Nueva contraseña de la sala<input name="password" type="password" minlength="10" maxlength="128" autocomplete="new-password" placeholder="Dejar vacío para mantener la actual" /><small>Al cambiarla se cerrarán los accesos anteriores.</small></label><div><label id="limit-label" class="field-label">Conexiones simultáneas en la app</label><div class="category-field"><select id="room-limit" hidden tabindex="-1" aria-hidden="true"></select><button id="room-limit-trigger" type="button" role="combobox" class="select-trigger" aria-labelledby="limit-label room-limit-value" aria-haspopup="listbox" aria-expanded="false" aria-controls="room-limit-options"><span id="room-limit-value"></span>${morphSvg(ChevronDown, 'room-limit-chevron', 'h-4 w-4')}</button><div id="room-limit-options" class="select-menu" role="listbox" aria-label="Conexiones simultáneas" aria-hidden="true"></div></div><input id="custom-limit" type="number" min="1" max="10000" step="1" aria-label="Número de conexiones" class="hidden" /><p id="limit-description" class="field-help"></p></div><p class="form-message" id="settings-message" role="status"></p><button type="submit" class="primary-button">Guardar cambios</button></form><div class="settings-actions"><button id="revoke-room" class="secondary-button">Cerrar todos los accesos</button><button id="export-room" class="secondary-button">${iconSvg(Download, 'h-4 w-4')} Exportar copia</button>${account?.legacy ? '<button id="import-legacy" class="secondary-button">Importar mi lista anterior</button>' : ''}<button id="delete-room" class="danger-button">Eliminar sala</button></div><div id="room-confirm" class="confirmation-box hidden"><p id="confirm-description"></p><div><button id="confirm-action" class="danger-button">Confirmar</button><button id="confirm-cancel" class="secondary-button">Cancelar</button></div></div></div>`;
  shell.append(modal);
  const $ = (query) => modal.querySelector(query);
  const dialog = createDialog(modal, opener, $('#settings-close'));
  const select = createCustomSelect($('#room-limit'), $('#room-limit-trigger'), $('#room-limit-options'), $('#room-limit-value'), $('#room-limit-chevron'), { portal: true, labelPrefix: 'Conexiones simultáneas' });
  const message = (text) => { $('#settings-message').textContent = text; };
  function refresh(next = room) {
    room = next; $('#settings-form').reset(); $('[name="title"]').value = room.title;
    const max = room.detectedMaximum;
    $('#room-limit').innerHTML = `${max === null ? '<option value="">Sin límite configurado</option>' : ''}${Array.from({ length: Math.min(max ?? 10, 10) }, (_, index) => `<option value="${index + 1}">${index + 1} ${index ? 'conexiones' : 'conexión'}</option>`).join('')}<option value="custom">Elegir otra cantidad…</option>`;
    $('#room-limit').value = room.limit === null ? '' : room.limit <= 10 ? String(room.limit) : 'custom';
    $('#custom-limit').value = room.limit || 1; $('#custom-limit').max = max ?? 10000;
    $('#custom-limit').classList.toggle('hidden', $('#room-limit').value !== 'custom');
    $('#limit-description').textContent = max === null ? 'Límite del proveedor desconocido. Puedes fijar un máximo manual.' : `Máximo detectado: ${max}. Puedes habilitar entre 1 y ${max}.`;
    select.refresh();
  }
  const limitValue = () => $('#room-limit').value === '' ? null : Number($('#room-limit').value === 'custom' ? $('#custom-limit').value : $('#room-limit').value);
  $('#room-limit').onchange = () => $('#custom-limit').classList.toggle('hidden', $('#room-limit').value !== 'custom');
  opener.onclick = () => { refresh(); message(''); $('#room-confirm').classList.add('hidden'); dialog.show(); };
  $('#settings-close').onclick = () => dialog.hide();
  modal.addEventListener('click', (event) => { if (event.target === modal) dialog.hide(); });
  modal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); dialog.hide(); } });
  $('#copy-room').onclick = async () => { try { await navigator.clipboard.writeText(`${location.origin}/?room=${encodeURIComponent(room.slug)}`); message('Enlace copiado. Comparte la contraseña por separado.'); } catch { message(`Enlace: ${location.origin}/?room=${room.slug}`); } };
  $('#settings-form').onsubmit = async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try { const next = await roomApi('update', { room: room.slug, data: { ...Object.fromEntries(new FormData(event.currentTarget)), limit: limitValue(), revision: room.revision } }); refresh(next); onUpdate(next); message('Cambios guardados.'); }
    catch (error) { message(error.message); } finally { button.disabled = false; }
  };
  function confirmAction(text, action) {
    $('#confirm-description').textContent = text; $('#room-confirm').classList.remove('hidden'); $('#confirm-action').focus();
    $('#confirm-action').onclick = async () => { $('#confirm-action').disabled = true; try { await action(); $('#room-confirm').classList.add('hidden'); } catch (error) { message(error.message); } finally { $('#confirm-action').disabled = false; } };
  }
  $('#confirm-cancel').onclick = () => $('#room-confirm').classList.add('hidden');
  $('#revoke-room').onclick = () => confirmAction('Se cerrarán los accesos y las reproducciones actuales. Los invitados podrán volver a entrar con la contraseña de la sala.', async () => { const next = await roomApi('update', { room: room.slug, data: { revision: room.revision, limit: room.limit, revoke: true } }); refresh(next); onUpdate(next); onRevoke(); message('Accesos cerrados.'); });
  $('#delete-room').onclick = () => confirmAction('Se eliminarán esta sala y su lista. Esta acción no se puede deshacer.', async () => { await roomApi('delete', { room: room.slug, data: { revision: room.revision } }); navigateRoom(); });
  $('#export-room').onclick = () => confirmAction('La copia incluye las direcciones de tus canales. Guárdala en un lugar privado.', async () => { const backup = await roomApi('export', { room: room.slug }); const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `${room.slug}-backup.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); message('Copia exportada.'); });
  if ($('#import-legacy')) $('#import-legacy').onclick = async () => { const button = $('#import-legacy'); button.disabled = true; try { const next = await roomApi('import-legacy', { room: room.slug, data: { revision: room.revision } }); refresh(next); onUpdate(next, true); message('Lista anterior importada.'); } catch (error) { message(error.message); } finally { button.disabled = false; } };
  refresh();
  return { refresh, destroy: () => select.destroy() };
}
