// Safe, user-facing diagnostics for HLS VOD. Never expose playlist URLs or
// tokenized fragment URLs supplied by an upstream addon or hls.js.
export function vodHlsErrorMessage(data) {
  const code = Number(data?.response?.code) || Number(data?.response?.status) || 0;
  const detail = String(data?.details || '');
  const network = data?.type === 'networkError';
  const media = data?.type === 'mediaError';
  if (code === 410 || code === 401 || code === 403)
    return 'La sesión de vídeo ha caducado o ha perdido autorización. Selecciona de nuevo la fuente.';
  if (code === 429)
    return 'El servidor ha limitado temporalmente las solicitudes. Espera antes de volver a intentar.';
  if (code === 503 || code === 504)
    return 'El relay de Ubuntu no pudo obtener o convertir a tiempo un segmento de la película. Comprueba los seeders o prueba otra fuente.';
  if (code >= 500)
    return 'El servidor no pudo preparar uno de los segmentos del vídeo (HTTP ' + code + ').';
  if (code >= 400)
    return 'El servidor ha rechazado un segmento del vídeo (HTTP ' + code + ').';
  if (media || /buffer(Append|Stalled)|fragParsing|bufferFull/i.test(detail))
    return 'El navegador no ha podido decodificar o insertar un segmento HLS. Prueba otra versión de la película.';
  if (network || /fragLoad|levelLoad|manifestLoad|Timeout/i.test(detail))
    return 'Se ha interrumpido la descarga de los segmentos HLS. Revisa la conexión con el relay o los seeders.';
  return 'La reproducción HLS se ha detenido. Prueba otra fuente y consulta los registros del relay.';
}

export function vodMediaErrorMessage(error, { kind, compatibleAudio, hlsError } = {}) {
  if (hlsError) return hlsError;
  const code = Number(error?.code);
  if (code === 3 || code === 4)
    return 'El navegador no admite el formato del vídeo recibido. Prueba otra versión compatible.';
  if (code === 2)
    return 'Se interrumpió la descarga del vídeo desde el relay. Comprueba el servidor o prueba otra fuente.';
  if (code === 1)
    return 'La reproducción se ha cancelado.';
  if (kind === 'torrent')
    return 'No se pudo continuar el streaming del torrent. Consulta los seeders y los errores HLS.';
  if (compatibleAudio)
    return 'La reproducción con audio compatible se ha interrumpido. Comprueba la conversión en Ubuntu.';
  return 'La reproducción se interrumpió. Si hay imagen pero no sonido, prueba Audio compatible.';
}
