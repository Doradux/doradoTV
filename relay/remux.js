import { spawn } from 'node:child_process';

// Transmux an MKV/AVI/MOV source to a fragmented MP4 as bytes arrive from the
// existing torrent. Video is STREAM-COPIED (no costly re-encoding); audio is
// converted to AAC. No second full-size file is written to Northflank's disk.
//
// Fragmented MP4 is progressive rather than randomly seekable. The player
// must not promise seeking until an index/seek strategy is implemented.
export function remuxVideo({ file, response, cors, ffmpeg = 'ffmpeg', spawnProcess = spawn,
  release = () => {}, startupMs = 40000, stallMs = 40000 }) {
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-threads', '1',
    '-protocol_whitelist', 'file,pipe,fd',
    '-probesize', '1048576', '-analyzeduration', '2500000',
    '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    '-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-b:a', '128k',
    '-max_muxing_queue_size', '256',
    '-movflags', '+empty_moov+frag_keyframe+default_base_moof',
    '-frag_duration', '2000000',
    '-f', 'mp4', 'pipe:1',
  ];
  const child = spawnProcess(ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let input, closed = false, started = false, timer = null;
  let diagnostic = '';
  const contentHeaders = {
    ...cors,
    'Content-Type': 'video/mp4',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    // No Accept-Ranges: a streaming, fragmented MP4 has no fixed byte index.
  };
  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    input?.destroy();
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    release();
  }
  function fail(code = 503) {
    if (closed) return;
    // No FFmpeg stderr returned to browser: it may contain internal metadata.
    if (diagnostic) console.warn('Torrent remux error:', diagnostic.slice(-250));
    if (!response.headersSent && !response.destroyed) {
      response.writeHead(code, {
        ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify({ error:
        'No se pudo preparar el contenedor de vídeo. Prueba otra fuente con H.264/H.265.' }));
    } else if (!response.destroyed) response.destroy();
    cleanup();
  }
  function arm(ms = stallMs) {
    clearTimeout(timer);
    timer = setTimeout(() => fail(503), ms);
    timer.unref?.();
  }
  response.once('close', cleanup);
  child.on('error', () => fail());
  child.stderr?.on('data', (data) => {
    diagnostic = (diagnostic + data.toString()).slice(-1500);
  });
  child.on('close', (code) => {
    if (closed) return;
    if (code !== 0 || !started) fail();
    else { response.end(); cleanup(); }
  });
  // Keep chunked response backpressure: stream stdout into HTTP response only
  // after FFmpeg has produced a valid MP4 header.
  child.stdout.once('data', (first) => {
    if (closed || response.destroyed) return;
    started = true;
    arm();
    response.writeHead(200, contentHeaders);
    response.write(first);
    child.stdout.on('data', () => arm());
    child.stdout.pipe(response);
  });
  arm(startupMs);
  try {
    input = file.stream();
    input.on('error', () => fail());
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') fail();
    });
    input.pipe(child.stdin);
  } catch { fail(); }
  return { close: cleanup };
}
