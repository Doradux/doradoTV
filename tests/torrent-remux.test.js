import assert from 'node:assert/strict';
import test from 'node:test';
import WebTorrent from 'webtorrent';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from '../relay/server.js';
import { TorrentRelay } from '../relay/torrent-service.js';

test('MKV torrent is remuxed by FFmpeg over the real BitTorrent TCP relay without duplicating video', { timeout: 40000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorado-mkv-stream-test-'));
  let seeder, relay;
  try {
    const source = join(directory,'sample.mkv');
    try {
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f','lavfi','-i','testsrc=size=320x180:rate=25',
        '-f','lavfi','-i','sine=frequency=500:sample_rate=44100',
        '-t','2', '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
        '-c:a','aac','-b:a','64k', '-f','matroska',source,
      ],{timeout:18000});
    } catch (error) {
      if (error.code === 'ENOENT') return t.skip('FFmpeg is not available on this test host.');
      throw error;
    }
    const original = readFileSync(source);
    seeder = new WebTorrent({dht:false,lsd:false,tracker:false,natUpnp:false,maxConns:6});
    const seeded = await new Promise(resolve=>seeder.seed(original, {name:'sample-mkv.mkv'},resolve));
    const torrents = new TorrentRelay({directory,createClient:async()=>WebTorrent,
      maxBytes:300000,metadataTimeout:14000,blockPrivatePeers:false});
    relay=createRelay({directory,secret:'test-key-for-remux',appOrigin:'http://127.0.0.1:5199',torrentFactory:torrents});
    await new Promise(resolve=>relay.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+relay.server.address().port;
    const auth={'Authorization':'Bearer test-key-for-remux','Content-Type':'application/json'};
    const post=async(url,payload)=> {
      const res=await fetch(base+url,{method:'POST',headers:auth,body:JSON.stringify(payload)});
      if(res.status!==200)throw Error('POST '+url+' failed: '+res.status+' '+await res.text()); return res.json();
    };
    const { session_id:id }=await post('/torrent/start',{info_hash:seeded.infoHash,user_id:'owner',file_idx:0});
    const swarm=torrents.swarms.get(seeded.infoHash);
    if (!swarm.torrent.infoHash) await new Promise(resolve=>swarm.torrent.once('infoHash',resolve));
    swarm.torrent.addPeer('127.0.0.1:'+seeder.torrentPort);
    let status=null;
    for(let i=0;i<90;i++){
      status=await post('/torrent/status',{session_id:id,user_id:'owner'});
      if(status.state==='ready')break;
      await new Promise(r=>setTimeout(r,120));
    }
    assert.equal(status.state,'ready');
    assert.equal(status.mode,'remux');
    assert.match(status.playback_url, /\/remux\?token=/);
    const origin='http://127.0.0.1:5199';
    const invalid=await fetch(status.playback_url.replace(/token=[^&]+/,'token=bad'),{headers:{origin}});
    assert.equal(invalid.status,410);
    const wrongOrigin=await fetch(status.playback_url,{headers:{origin:'https://malicious.example'}});
    assert.equal(wrongOrigin.status,403);
    const head=await fetch(status.playback_url,{headers:{origin},method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(head.headers.get('content-type'),'video/mp4');
    const playback=await fetch(status.playback_url,{headers:{origin,range:'bytes=0-'},signal:AbortSignal.timeout(27000)});
    assert.equal(playback.status,200);
    assert.equal(playback.headers.get('content-type'),'video/mp4');
    assert.equal(playback.headers.get('accept-ranges'),null);
    const converted=Buffer.from(await playback.arrayBuffer());
    assert(converted.length>1000,'FFmpeg has produced actual video bytes');
    assert.equal(converted.subarray(4,8).toString(),'ftyp');
    assert(converted.includes(Buffer.from('moof')),'The file contains fragmented MP4 sections');
    const mp4=join(directory,'remux.mp4');
    writeFileSync(mp4,converted);
    // Validate that FFmpeg can actually decode the remuxed container.
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',mp4,
      '-map','0:v:0','-f','null','-'],{timeout:15000});
    assert.equal(torrents.activeRemux,0,'Temporary encoder slots are released');
    await post('/torrent/stop',{session_id:id,user_id:'owner'});
    assert.equal((await fetch(status.playback_url,{headers:{origin}})).status,410);
  } finally {
    if (relay) {relay.stop();await new Promise(resolve=>relay.server.close(resolve));}
    if (seeder) await new Promise(resolve=>seeder.destroy(resolve));
    rmSync(directory,{recursive:true,force:true});
  }
});


test('concurrent remux conversions are bounded and slots can be reused', () => {
  const tmp=mkdtempSync(join(tmpdir(),'dorado-remux-limit-'));
  try {
    const rt=new TorrentRelay({directory:tmp,createClient:async()=>WebTorrent});
    const one=rt.acquireRemux();
    const two=rt.acquireRemux();
    assert.equal(rt.activeRemux,2);
    assert.throws(()=>rt.acquireRemux(), {status:429});
    one();
    one();
    assert.equal(rt.activeRemux,1);
    const three=rt.acquireRemux();
    assert.equal(rt.activeRemux,2);
    two();three();
    assert.equal(rt.activeRemux,0);
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});

test('room relay client authorizes remux media URLs from its own HTTPS origin', async () => {
  const {createRelayClient}=await import('../netlify/lib/room-relay.js');
  const base='https://room-relay.example.org';
  const id='11111111-2222-3333-4444-555555555555';
  const client=createRelayClient({url:base,secret:'secret-for-room-relay'}, async(url,options) => {
    assert.equal(url.href,base+'/torrent/status');
    assert.equal(options.headers.Authorization,'Bearer secret-for-room-relay');
    return Response.json({state:'ready',playback_url:base+'/torrent-media/'+id+'/remux?token=private',peers:3});
  });
  assert.deepEqual(await client.torrentStatus(id,'room-user'), {
    state:'ready',url:base+'/torrent-media/'+id+'/remux?token=private',
    peers:3,remux:true,
  });
});
