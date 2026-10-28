import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { pinLiveTarget, proxyLiveStream } from '../relay/live-proxy.js';

const publicDns = async () => [{ address: '8.8.8.8', family: 4 }];

test('live redirect bridge rejects private destinations, embedded credentials and unsupported protocols', async () => {
  for (const value of ['http://127.0.0.1/video.ts', 'http://[::1]/video.ts', 'file:///etc/passwd',
    'http://user:secret@example.test/video.ts']) {
    await assert.rejects(pinLiveTarget(value), /red privada|no permitidos/);
  }
  await assert.rejects(pinLiveTarget('http://sample.test/video.ts',
    async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]), /red privada/);
});

test('live relay follows validated redirects with one HTTP GET at each hop', async () => {
  const requestedPaths = [];
  const upstream = createServer((request, response) => {
    requestedPaths.push(request.url);
    if (request.url === '/live/first.ts') { response.writeHead(302, { location: '/live/final.ts' }); response.end(); }
    else { response.writeHead(200, { 'content-type': 'video/mp2t' }); response.end('sample transport stream'); }
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let failed = false;
  const downstream = createServer((_request, response) => proxyLiveStream('http://sample.test/live/first.ts', response, {
    resolver: publicDns,
    httpTransport: (url, options, callback) => {
      const local = new URL('http://127.0.0.1:' + upstream.address().port + url.pathname);
      return httpRequest(local, { ...options, lookup: undefined }, callback);
    },
    onFailure: () => { failed = true; },
  }));
  downstream.listen(0, '127.0.0.1');
  await once(downstream, 'listening');
  try {
    const response = await fetch('http://127.0.0.1:' + downstream.address().port);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'sample transport stream');
    assert.deepEqual(requestedPaths, ['/live/first.ts', '/live/final.ts']);
    assert.equal(failed, false);
  } finally {
    await new Promise((resolve) => downstream.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('live relay blocks redirects to private IPs even when starting host was public', async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(302, { location: 'http://127.0.0.1:3333/secret' });
    response.end();
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const failures = [];
  const downstream = createServer((_request, response) => proxyLiveStream('http://sample.test/live/channel.ts', response, {
    resolver: publicDns,
    httpTransport: (url, options, callback) =>
      httpRequest('http://127.0.0.1:' + upstream.address().port + url.pathname,
        { ...options, lookup: undefined }, callback),
    onFailure: (reason) => failures.push(reason),
  }));
  downstream.listen(0, '127.0.0.1');
  await once(downstream, 'listening');
  try {
    const response = await fetch('http://127.0.0.1:' + downstream.address().port);
    assert.equal(response.status, 502);
    assert.match(failures[0], /redirección.*no es segura/i);
  } finally {
    await new Promise((resolve) => downstream.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('live relay reports upstream HTTP status without the Xtream account path', async () => {
  const upstream = createServer((_request, response) => { response.writeHead(403); response.end(); });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const failures = [];
  const downstream = createServer((_request, response) => proxyLiveStream(
    'http://sample.test/live/sample-user/private-secret/123.ts', response, {
      resolver: publicDns,
      httpTransport: (url, options, callback) =>
        httpRequest('http://127.0.0.1:' + upstream.address().port + url.pathname,
          { ...options, lookup: undefined }, callback),
      onFailure: (reason) => failures.push(reason),
    }));
  downstream.listen(0, '127.0.0.1');
  await once(downstream, 'listening');
  try {
    const response = await fetch('http://127.0.0.1:' + downstream.address().port);
    assert.equal(response.status, 502);
    assert.match(failures[0], /HTTP 403/);
    assert(!failures[0].includes('private-secret'));
  } finally {
    await new Promise((resolve) => downstream.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});
