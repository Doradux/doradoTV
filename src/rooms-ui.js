import { TvMinimal, ArrowRight, Plus, DoorOpen, LockKeyhole, Mail, LogOut, Settings2, Copy, Download, X, ChevronDown } from 'lucide';
import { iconSvg, morphSvg, escapeHtml } from './ui.js';
import { roomApi, navigateRoom } from './room-api.js';
import { createDialog, reveal } from './motion.js';
import { createCustomSelect } from './custom-select.js';
import { renderGoogleSignIn } from './google-signin.js';

const brand = `<a class="brand" href="/"><img class="brand-logo" src="/favicon.svg" width="45" height="48" alt="" /><span class="brand-title">DORADOTV</span></a>`;
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

function maskPrivateConfigurationInputs(root) {
  if (typeof CSS === 'undefined' || !CSS.supports('-webkit-text-security', 'disc')) {
    root.querySelectorAll('[data-private-input]').forEach((field) => { field.type = 'password'; });
  }
}

export async function mountDashboard(app, account) {
  app.innerHTML = `<div class="app-shell rooms-dashboard"><header class="app-header">${brand}<div class="header-actions"><span class="account-name">${escapeHtml((account.username || account.name))}</span><button id="account-logout" class="icon-button" aria-label="Cerrar sesión">${iconSvg(LogOut)}</button></div></header><main><div class="dashboard-heading"><div><h1>Mis salas</h1></div><button id="create-open" class="primary-button">${iconSvg(Plus)} Crear sala</button></div><section id="create-panel" class="room-create-panel hidden" aria-labelledby="create-title"><div><h2 id="create-title">Nueva sala</h2><p>Hasta 3 salas por cuenta. La contraseña de la sala es independiente de la de tu cuenta.</p></div><form id="create-room" class="room-form" autocomplete="off" data-form-type="other" data-lpignore="true"><label>Título de la sala<input name="title" required maxlength="60" placeholder="La tele de casa" /></label><label>Nombre único<input name="slug" required pattern="[a-z0-9][a-z0-9-]{2,39}" minlength="3" maxlength="40" autocapitalize="none" spellcheck="false" placeholder="la-tele-de-casa" /><small>Solo letras minúsculas, números y guiones.</small></label><label>Contraseña para invitados<input name="password" type="text" class="room-secret-input" data-private-input autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" spellcheck="false" autocapitalize="off" required minlength="10" maxlength="128" placeholder="Al menos 10 caracteres" /></label><fieldset class="provider-fields"><legend>Proveedor IPTV (Xtream, opcional)</legend><p class="field-help">Solo si utilizas una cuenta Xtream. No introduzcas aquí la URL ni la clave del relay.</p>
  <label>URL del servidor<input id="create-provider-origin" type="url" placeholder="https://proveedor.example" autocomplete="off"></label>
  <label>Usuario del proveedor<input id="create-provider-user" maxlength="128" autocomplete="off"></label>
  <label>Contraseña del proveedor<input id="create-provider-pass" type="text" class="room-secret-input" data-private-input autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" spellcheck="false" autocapitalize="off" maxlength="256"></label>
  <button id="create-verify-provider" type="button" class="secondary-button">Comprobar credenciales</button>
  <p id="create-provider-status" class="form-message" role="status"></p>
</fieldset><fieldset class="provider-fields relay-fields"><legend>Relay privado de esta sala</legend>
  <small class="field-help">Despliega tu relay en Northflank u otro alojamiento y configura un servicio diferente para cada sala.</small>
  <label>URL HTTPS del relay<input id="create-relay-url" type="url" placeholder="https://mi-relay.code.run" required autocomplete="off"></label>
  <label>Clave privada del relay<input id="create-relay-secret" type="text" class="room-secret-input" data-private-input autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" spellcheck="false" autocapitalize="off" minlength="16" maxlength="256" required></label>
  <button id="create-verify-relay" type="button" class="secondary-button">Comprobar relay y clave</button>
  <p id="create-relay-status" class="form-message" role="status"></p>
</fieldset><p class="form-message" id="create-message" role="status"></p><button type="submit" class="primary-button">Crear sala ${iconSvg(ArrowRight)}</button></form></section><div id="rooms-grid" class="rooms-grid" aria-live="polite"><p class="list-empty">Cargando tus salas…</p></div><section class="visited-section" aria-labelledby="visited-heading">
  <div class="visited-heading"><div><h2 id="visited-heading">Salas visitadas</h2><p>Salas de otros propietarios a las que has entrado con tu cuenta. Para volver a entrar puede ser necesaria la contraseña.</p></div></div>
  <div id="visited-grid" class="rooms-grid visited-grid" aria-live="polite"><p class="visited-empty">Cargando tu historial…</p></div>
  <p id="visited-status" class="form-message" role="status"></p>
</section>
<p class="dashboard-footnote">El historial no otorga permisos sobre salas ajenas ni almacena contraseñas de sala.</p><a class="text-link" href="/?join=1">Entrar en otra sala como invitado ${iconSvg(ArrowRight, 'h-4 w-4')}</a></main></div>`;
  maskPrivateConfigurationInputs(app.querySelector('#create-room'));
  app.querySelector('#account-logout').onclick = async () => { await roomApi('logout', { data: {} }); navigateRoom(); };
  app.querySelector('#create-open').onclick = () => { const panel = app.querySelector('#create-panel'); panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) panel.querySelector('input').focus(); };
  app.querySelector('#visited-grid').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-forget-visited]');
    if (!button) return;
    const slug = button.dataset.forgetVisited;
    button.disabled = true;
    try {
      await roomApi('forget-visited', { room: slug, data: {} });
      button.closest('.visited-card')?.remove();
      if (!app.querySelector('#visited-grid .visited-card')) app.querySelector('#visited-grid').innerHTML =
        '<p class="visited-empty">Ya no quedan salas en el historial.</p>';
      app.querySelector('#visited-status').textContent = '';
    } catch (error) {
      button.disabled = false;
      app.querySelector('#visited-status').textContent = error.message;
    }
  });
  const createForm = app.querySelector('#create-room');
  const createProvider = () => ({
    origin: app.querySelector('#create-provider-origin').value.trim(),
    username: app.querySelector('#create-provider-user').value.trim(),
    password: app.querySelector('#create-provider-pass').value,
  });
  createForm.querySelectorAll('.provider-fields:not(.relay-fields) input').forEach((field) => field.addEventListener('input', () => {
    createForm.dataset.providerVerified = '';
    app.querySelector('#create-provider-status').textContent = '';
  }));
  app.querySelector('#create-verify-provider').onclick = async () => {
    const button = app.querySelector('#create-verify-provider');
    button.disabled = true;
    app.querySelector('#create-provider-status').textContent = 'Comprobando conexión…';
    try {
      const result = await roomApi('verify-provider', { data: { provider: createProvider() } });
      createForm.dataset.providerVerified = 'true';
      app.querySelector('#create-provider-status').textContent = 'Credenciales válidas (' + result.host + ').';
    } catch (error) {
      createForm.dataset.providerVerified = '';
      app.querySelector('#create-provider-status').textContent = error.message;
    } finally { button.disabled = false; }
  };
  const createRelay = () => ({
    url: app.querySelector('#create-relay-url').value.trim(),
    secret: app.querySelector('#create-relay-secret').value,
  });
  createForm.querySelectorAll('.relay-fields input').forEach((field) => field.addEventListener('input', () => {
    createForm.dataset.relayVerified = '';
    app.querySelector('#create-relay-status').textContent = '';
  }));
  app.querySelector('#create-verify-relay').onclick = async () => {
    const button = app.querySelector('#create-verify-relay');
    button.disabled = true;
    app.querySelector('#create-relay-status').textContent = 'Comprobando relay y clave…';
    try {
      const result = await roomApi('verify-relay', { data: { relay: createRelay() } });
      createForm.dataset.relayVerified = 'true';
      app.querySelector('#create-relay-status').textContent = 'Relay verificado: ' + result.host;
    } catch (error) {
      createForm.dataset.relayVerified = '';
      app.querySelector('#create-relay-status').textContent = error.message;
    } finally { button.disabled = false; }
  };
  app.querySelector('#create-room').onsubmit = async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button[type="submit"]');
    const provider = createProvider();
    const hasProvider = Object.values(provider).some(Boolean);
    if (hasProvider && event.currentTarget.dataset.providerVerified !== 'true') {
      app.querySelector('#create-provider-status').textContent = 'Comprueba las credenciales IPTV antes de crear la sala o deja sus campos vacíos.';
      return;
    }
    if (event.currentTarget.dataset.relayVerified !== 'true') {
      app.querySelector('#create-relay-status').textContent = 'Comprueba tu relay y su clave antes de crear la sala.';
      return;
    }
    button.disabled = true;
    try { const room = await roomApi('create', { data: { ...Object.fromEntries(new FormData(event.currentTarget)), ...(hasProvider ? { provider } : {}), relay: createRelay() } }); navigateRoom(room.slug); }
    catch (error) { app.querySelector('#create-message').textContent = error.message; button.disabled = false; }
  };
  try {
    const { rooms, visited = [] } = await roomApi('mine');
    app.querySelector('#create-open').disabled = rooms.length >= 3;
    app.querySelector('#rooms-grid').innerHTML = rooms.length ? rooms.map((room, index) => `<a class="room-card" href="/?room=${encodeURIComponent(room.slug)}" style="--row-delay:${index * 60}ms"><div class="room-card-top"><span class="room-card-icon">${iconSvg(TvMinimal, 'h-6 w-6')}</span><span class="room-private">${iconSvg(LockKeyhole, 'h-3 w-3')} Privada</span></div><h2>${escapeHtml(room.title)}</h2><p class="room-slug">${escapeHtml(room.slug)}</p><div class="room-card-bottom"><span>${room.channelCount ? `${room.channelCount.toLocaleString('es')} canales` : 'Lista pendiente de subir'}</span>${iconSvg(ArrowRight)}</div></a>`).join('') : `<div class="rooms-empty"><span class="empty-icon">${iconSvg(DoorOpen, 'h-9 w-9')}</span><h2>No has creado ninguna sala.</h2></div>`;
    const history = visited.filter((item) => !rooms.some((owned) => owned.slug === item.slug));
    app.querySelector('#visited-grid').innerHTML = history.length ? history.map((item, index) => `
      <div class="visited-card">
        <a class="room-card" href="/?room=${encodeURIComponent(item.slug)}" style="--row-delay:${index * 40}ms">
          <div class="room-card-top"><span class="room-card-icon">${iconSvg(DoorOpen, 'h-6 w-6')}</span>
            <span class="room-private">${iconSvg(LockKeyhole, 'h-3 w-3')} Invitado</span></div>
          <h2>${escapeHtml(item.title)}</h2><p class="room-slug">${escapeHtml(item.slug)}</p>
          <div class="room-card-bottom"><span>Volver a entrar</span>${iconSvg(ArrowRight)}</div>
        </a>
        <button type="button" class="visited-remove" data-forget-visited="${escapeHtml(item.slug)}" aria-label="Quitar ${escapeHtml(item.title)} del historial">Quitar del historial</button>
      </div>`).join('') : '<p class="visited-empty">Todavía no hay salas ajenas en tu historial. Aparecerán aquí después de entrar con tu cuenta iniciada.</p>';
  } catch (error) { app.querySelector('#rooms-grid').textContent = error.message; }
}

export function mountRoomSettings(shell, initialRoom, opener, { onUpdate, onRevoke }) {
  let room = initialRoom;
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 hidden items-center justify-center p-4'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'settings-title');
  modal.innerHTML = `<div class="room-settings-panel"><div class="settings-heading"><div><h2 id="settings-title">Ajustes de la sala</h2></div><button id="settings-close" class="icon-button" aria-label="Cerrar ajustes">${iconSvg(X)}</button></div><form id="settings-form" class="room-form" autocomplete="off" data-form-type="other" data-lpignore="true"><label>Título<input name="title" required maxlength="60" /></label><div class="room-share"><span>${escapeHtml(room.slug)}</span><button id="copy-room" type="button" class="text-link">${iconSvg(Copy, 'h-4 w-4')} Copiar enlace</button></div><label>Nueva contraseña de la sala<input name="password" type="text" class="room-secret-input" data-private-input autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" spellcheck="false" autocapitalize="off" minlength="10" maxlength="128" placeholder="Dejar vacío para mantener la actual" /><small>Al cambiarla se cerrarán los accesos anteriores.</small></label><fieldset class="provider-fields"><legend>Proveedor IPTV (Xtream, opcional)</legend><p class="field-help">Solo si utilizas una cuenta Xtream. No introduzcas aquí la URL ni la clave del relay.</p>
  <p id="provider-current" class="field-help"></p>
  <label>URL del servidor<input id="settings-provider-origin" type="url" placeholder="https://proveedor.example" autocomplete="off"></label>
  <label>Usuario<input id="settings-provider-user" maxlength="128" autocomplete="off"></label>
  <label>Contraseña<input id="settings-provider-pass" type="text" class="room-secret-input" data-private-input autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" spellcheck="false" autocapitalize="off" maxlength="256" placeholder="Nueva contraseña"></label>
  <button id="settings-verify-provider" type="button" class="secondary-button">Comprobar credenciales</button>
  <p id="settings-provider-status" class="form-message" role="status"></p>
</fieldset><fieldset class="provider-fields relay-fields"><legend>Relay privado de la sala</legend>
  <p id="relay-current" class="field-help"></p><p class="field-help">Aquí se configura el servidor que comparte emisiones entre espectadores, no el proveedor IPTV.</p>
  <label>URL HTTPS del relay<input id="settings-relay-url" type="url" placeholder="https://mi-relay.code.run" autocomplete="off"></label>
  <label>Clave privada del relay<input id="settings-relay-secret" type="text" class="room-secret-input" data-private-input autocomplete="off" data-lpignore="true" data-1p-ignore data-bwignore="true" spellcheck="false" autocapitalize="off" minlength="16" maxlength="256" placeholder="Clave secreta del servidor"></label>
  <button id="settings-verify-relay" type="button" class="secondary-button">Comprobar relay y clave</button>
  <p id="settings-relay-status" class="form-message" role="status"></p>
</fieldset><div><label id="limit-label" class="field-label">Conexiones simultáneas en la app</label><div class="category-field"><select id="room-limit" hidden tabindex="-1" aria-hidden="true"></select><button id="room-limit-trigger" type="button" role="combobox" class="select-trigger" aria-labelledby="limit-label room-limit-value" aria-haspopup="listbox" aria-expanded="false" aria-controls="room-limit-options"><span id="room-limit-value"></span>${morphSvg(ChevronDown, 'room-limit-chevron', 'h-4 w-4')}</button><div id="room-limit-options" class="select-menu" role="listbox" aria-label="Conexiones simultáneas" aria-hidden="true"></div></div><input id="custom-limit" type="number" min="1" max="10000" step="1" aria-label="Número de conexiones" class="hidden" /><p id="limit-description" class="field-help"></p></div><p class="form-message" id="settings-message" role="status"></p><button type="submit" class="primary-button">Guardar cambios</button></form><div class="settings-actions"><button id="revoke-room" class="secondary-button">Cerrar todos los accesos</button><button id="export-room" class="secondary-button">${iconSvg(Download, 'h-4 w-4')} Exportar copia</button><button id="delete-room" class="danger-button">Eliminar sala</button></div><div id="room-confirm" class="confirmation-box hidden"><p id="confirm-description"></p><div><button id="confirm-action" class="danger-button">Confirmar</button><button id="confirm-cancel" class="secondary-button">Cancelar</button></div></div></div>`;
  shell.append(modal);
  maskPrivateConfigurationInputs(modal);
  const $ = (query) => modal.querySelector(query);
  const dialog = createDialog(modal, opener, $('#settings-close'));
  const select = createCustomSelect($('#room-limit'), $('#room-limit-trigger'), $('#room-limit-options'), $('#room-limit-value'), $('#room-limit-chevron'), { portal: true, labelPrefix: 'Conexiones simultáneas' });
  const message = (text) => { $('#settings-message').textContent = text; };
  const providerInput = () => ({
    origin: $('#settings-provider-origin').value.trim(),
    username: $('#settings-provider-user').value.trim(),
    password: $('#settings-provider-pass').value,
  });
  const providerChanged = () => Object.values(providerInput()).some(Boolean);
  $('#settings-form').querySelectorAll('.provider-fields:not(.relay-fields) input').forEach((field) =>
    field.addEventListener('input', () => {
      $('#settings-form').dataset.providerVerified = '';
      $('#settings-provider-status').textContent = '';
    }));
  $('#settings-verify-provider').onclick = async () => {
    const button = $('#settings-verify-provider');
    button.disabled = true;
    $('#settings-provider-status').textContent = 'Comprobando conexión…';
    try {
      const result = await roomApi('verify-provider', { room: room.slug, data: { provider: providerInput() } });
      $('#settings-form').dataset.providerVerified = 'true';
      $('#settings-provider-status').textContent = 'Credenciales válidas (' + result.host + ').';
    } catch (error) {
      $('#settings-form').dataset.providerVerified = '';
      $('#settings-provider-status').textContent = error.message;
    } finally { button.disabled = false; }
  };
  const relayInput = () => ({
    url: $('#settings-relay-url').value.trim(),
    secret: $('#settings-relay-secret').value,
  });
  const relayChanged = () => Object.values(relayInput()).some(Boolean);
  $('#settings-form').querySelectorAll('.relay-fields input').forEach((field) =>
    field.addEventListener('input', () => {
      $('#settings-form').dataset.relayVerified = '';
      $('#settings-relay-status').textContent = '';
    }));
  $('#settings-verify-relay').onclick = async () => {
    const button = $('#settings-verify-relay');
    button.disabled = true;
    $('#settings-relay-status').textContent = 'Comprobando relay y clave…';
    try {
      const result = await roomApi('verify-relay', { room: room.slug, data: { relay: relayInput() } });
      $('#settings-form').dataset.relayVerified = 'true';
      $('#settings-relay-status').textContent = 'Relay verificado: ' + result.host;
    } catch (error) {
      $('#settings-form').dataset.relayVerified = '';
      $('#settings-relay-status').textContent = error.message;
    } finally { button.disabled = false; }
  };
  function refresh(next = room) {
    room = next; $('#settings-form').reset(); $('[name="title"]').value = room.title;
    $('#settings-form').dataset.relayVerified = '';
    $('#relay-current').textContent = room.relayConfigured
      ? 'Relay actual: ' + (room.relayHost || 'configurado') + '. Deja estos campos vacíos para mantenerlo.'
      : 'Sin relay configurado. Los canales HTTP no funcionarán hasta que añadas uno.';
    $('#settings-relay-status').textContent = '';
    $('#provider-current').textContent = room.providerConfigured
      ? 'Proveedor actual: ' + (room.providerHost || 'configurado') + '. Deja los campos vacíos para mantenerlo.'
      : 'Configura un proveedor para esta sala.';
    $('#settings-provider-status').textContent = '';
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
    try {
      const changedRelay = relayChanged();
      if (changedRelay && event.currentTarget.dataset.relayVerified !== 'true') throw Error('Comprueba el relay nuevo antes de guardarlo.');
      const changed = providerChanged();
      if (changed && event.currentTarget.dataset.providerVerified !== 'true') throw Error('Comprueba las nuevas credenciales antes de guardarlas.');
      const next = await roomApi('update', { room: room.slug, data: {
        ...Object.fromEntries(new FormData(event.currentTarget)),
        ...(changed ? { provider: providerInput() } : {}),
        ...(changedRelay ? { relay: relayInput() } : {}),
        limit: limitValue(), revision: room.revision,
      } });
      refresh(next); onUpdate(next); message(next.hasPlaylist ? 'Cambios guardados.' : 'Cambios guardados. Si has cambiado de proveedor, vuelve a subir la lista M3U de esa cuenta.');
    }
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
  refresh();
  return { refresh, destroy: () => select.destroy() };
}
