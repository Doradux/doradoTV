import { roomApi } from './room-api.js';

let library;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!library) library = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timeout); script.remove(); library = null; reject(new Error('No se pudo cargar Google. Comprueba tu conexión y vuelve a intentarlo.')); };
    const timeout = setTimeout(fail, 12000);
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => { if (!window.google?.accounts?.id) { fail(); return; } clearTimeout(timeout); resolve(window.google.accounts.id); };
    script.onerror = fail; document.head.append(script);
  });
  return library;
}

export async function renderGoogleSignIn(container, clientId, { onSuccess, onError, onPending }) {
  container.inert = false;
  container.innerHTML = `
    <button type="button" class="google-custom-btn" id="google-auth-action" aria-label="Continuar con Google">
      <div class="google-cloud-bg" aria-hidden="true"></div>
      <div class="google-glass-overlay" aria-hidden="true"></div>
      <div class="google-btn-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.33 24 12 24z"/>
          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.15 0 9.99 0 12s.45 3.85 1.24 5.42l4.04-3.15z"/>
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
        </svg>
      </div>
      <span class="google-btn-text">Continuar con Google</span>
    </button>
  `;

  try {
    await loadGoogle();
    if (!container.isConnected) return;
    let submitting = false;

    if (window.google?.accounts?.oauth2?.initTokenClient) {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        callback: async (tokenResponse) => {
          if (!container.isConnected) return;
          if (tokenResponse.error) {
            submitting = false;
            container.inert = false;
            if (tokenResponse.error !== 'popup_closed_by_user') {
              onError(new Error('Acceso cancelado o rechazado por Google.'));
            }
            return;
          }
          onPending();
          try {
            const result = await roomApi('google-login', { data: { accessToken: tokenResponse.access_token } });
            if (container.isConnected) onSuccess(result.account);
          } catch (error) {
            submitting = false;
            container.inert = false;
            if (container.isConnected) onError(error);
          }
        },
      });

      const btn = container.querySelector('#google-auth-action');
      if (btn) {
        btn.onclick = () => {
          if (submitting) return;
          client.requestAccessToken({ prompt: '' });
        };
      }
      return;
    }

    // Fallback: Credential manager flow
    const { nonce } = await roomApi('google-start', { data: {} });
    if (!container.isConnected) return;
    window.google.accounts.id.initialize({
      client_id: clientId, nonce, auto_select: false, ux_mode: 'popup',
      callback: async ({ credential }) => {
        if (!container.isConnected || submitting) return;
        submitting = true; container.inert = true; onPending();
        try {
          const result = await roomApi('google-login', { data: { credential } });
          if (container.isConnected) onSuccess(result.account);
        } catch (error) {
          if (container.isConnected) onError(error);
        }
      },
    });
    const btn = container.querySelector('#google-auth-action');
    if (btn) {
      btn.onclick = () => {
        window.google.accounts.id.prompt();
      };
    }
  } catch (error) {
    if (container.isConnected) onError(error);
  }
}
