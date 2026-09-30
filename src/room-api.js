export async function roomApi(action, { data, room, keepalive = false } = {}) {
  const query = new URLSearchParams({ action, ...(room ? { room } : {}) });
  const response = await fetch(`/.netlify/functions/rooms?${query}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', keepalive,
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, ...(room ? { room } : {}) }) }),
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || 'No se pudo completar la operación.'); Object.assign(error, result, { status: response.status }); throw error; }
  return result;
}
export function navigateRoom(slug) {
  const url = new URL(location.href); url.search = slug ? new URLSearchParams({ room: slug }).toString() : ''; url.hash = ''; location.assign(url);
}
