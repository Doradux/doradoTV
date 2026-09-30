export async function roomApi(action, { data, room, keepalive = false } = {}) {
  const query = new URLSearchParams({ action, ...(room ? { room } : {}) });
  const response = await fetch(`/.netlify/functions/rooms?${query}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', keepalive,
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, ...(room ? { room } : {}) }) }),
  });
  const body = await response.text();
  let result = null;
  if (body) {
    try { result = JSON.parse(body); }
    catch { result = null; }
  }
  if (!response.ok) {
    const fallback = response.status === 413
      ? 'El archivo o la solicitud son demasiado grandes para el servidor.'
      : `El servidor no pudo completar la operación (${response.status}).`;
    const error = new Error(result?.error || fallback);
    Object.assign(error, result || {}, { status: response.status });
    throw error;
  }
  if (result === null) throw new Error('El servidor devolvió una respuesta vacía. Vuelve a intentarlo.');
  return result;
}
export function navigateRoom(slug) {
  const url = new URL(location.href); url.search = slug ? new URLSearchParams({ room: slug }).toString() : ''; url.hash = ''; location.assign(url);
}
