import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createRelay } from '../relay/server.js';
import { hlsVodPlaylist, mediaRange } from '../relay/vod-hls.js';

test('VOD HLS playlist supports arbitrary seek positions', () => {
  const playlist = hlsVodPlaylist(19.1, 'secret');
  assert.match(playlist, /#EXT-X-PLAYLIST-TYPE:VOD/);
  assert.match(playlist, /#EXTINF:3\.100/);
  assert.match(playlist, /segment_2\.ts\?token=secret/);
  assert(!playlist.includes('segment_3.ts'));
  assert.deepEqual(mediaRange('bytes=10-20',100),{start:10,end:20,partial:true});
  assert.deepEqual(mediaRange('bytes=-5',100),{start:95,end:99,partial:true});
  assert.equal(mediaRange('bytes=150-',100),null);
});

test('two viewers independently seek and share converted AC3-to-AAC VOD segments',
  { timeout: 90000 }, async (t) => {
    const directory=mkdtempSync(join(tmpdir(),'doradotv-vod-hls-'));
    let relay;
    try {
      const input=join(directory,'sample.mkv');
      try {
        execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
          '-f','lavfi','-i','testsrc=size=192x108:rate=20',
          '-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
          '-t','18','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
          '-c:a','ac3','-b:a','128k',input],{timeout:30000});
      } catch(e) {
        if(e.code==='ENOENT') return t.skip('FFmpeg not installed');
        throw e;
      }
      const media=readFileSync(input);
      let opens=0,encoded=0;
      relay=createRelay({directory,secret:'hls-test-secret',appOrigin:'http://127.0.0.1:5199'});
      const nativeExec=relay.vod.exec.bind(relay.vod);
      relay.vod.exec=(bin,args,timeout)=>{
        if(bin==='ffprobe')return Promise.resolve({stdout:JSON.stringify({
          format:{duration:'18.0'},streams:[{codec_type:'video',codec_name:'h264'},
          {codec_type:'audio',codec_name:'ac3'}]})});
        if(bin==='ffmpeg')encoded++;
        return nativeExec(bin,args,timeout);
      };
      relay.vod.opener=async(_url,{range}={})=>{
        opens++;
        let start=0,end=media.length-1;
        if(range) {
          const m=/^bytes=(\d+)-(\d*)$/.exec(range);
          assert.ok(m, 'Valid byte-range request');
          start=Number(m[1]); end=m[2]?Math.min(media.length-1,Number(m[2])):end;
        }
        if(start>=media.length) throw Error('Out of bounds');
        const slice=media.subarray(start,end+1);
        return {status:range?206:200,length:slice.length,
          contentRange:range?('bytes '+start+'-'+end+'/'+media.length):null,
          stream:Readable.from([slice]),close(){}};
      };
      await new Promise(r=>relay.server.listen(0,'127.0.0.1',r));
      const base='http://127.0.0.1:'+relay.server.address().port;
      const auth={Authorization:'Bearer hls-test-secret','Content-Type':'application/json'};
      const post=async(route,data)=>{
        const res=await fetch(base+route,{method:'POST',headers:auth,body:JSON.stringify(data)});
        assert.equal(res.status,200,await res.clone().text());
        return res.json();
      };
      const source='https://cdn.example.org/film.mkv?token=example';
      const a=await post('/vod/start',{url:source,user_id:'viewer1'});
      const b=await post('/vod/start',{url:source,user_id:'viewer2'});
      assert.notEqual(a.session_id,b.session_id);
      assert.equal(relay.vod.sources.size,1);
      let sa,sb;
      for(let i=0;i<50;i++){
        sa=await post('/vod/status',{session_id:a.session_id,user_id:'viewer1'});
        sb=await post('/vod/status',{session_id:b.session_id,user_id:'viewer2'});
        if(sa.state==='ready' && sb.state==='ready')break;
        await new Promise(r=>setTimeout(r,35));
      }
      assert.equal(sa.state,'ready',JSON.stringify(sa));
      assert.equal(sb.state,'ready',JSON.stringify(sb));
      assert.notEqual(sa.playlist_url,sb.playlist_url);
      const origin={Origin:'http://127.0.0.1:5199'};
      const playlist=await fetch(sa.playlist_url,{headers:origin});
      assert.equal(playlist.status,200);
      assert.match(await playlist.text(),/#EXT-X-ENDLIST/);
      const first=sa.playlist_url.replace('index.m3u8','segment_0.ts');
      const late=sb.playlist_url.replace('index.m3u8','segment_2.ts');
      const [res0,res2]=await Promise.all([fetch(first,{headers:origin}),fetch(late,{headers:origin})]);
      assert.equal(res0.status,200);
      assert.equal(res2.status,200);
      const seg0=Buffer.from(await res0.arrayBuffer());
      const seg2=Buffer.from(await res2.arrayBuffer());
      assert(seg0.length>1000 && seg2.length>1000);
      assert.equal(seg0[0],0x47);
      assert.equal(seg2[0],0x47);
      writeFileSync(join(directory, 'converted.ts'), seg0);
      const decode = execFileSync('ffmpeg', ['-hide_banner','-i',join(directory,'converted.ts'),
        '-f','null','-'], { encoding: 'utf8', timeout: 20000, stdio: ['ignore','pipe','pipe'] });
      assert.equal(typeof decode, 'string');
      assert.equal(encoded,2);
      const same=sb.playlist_url.replace('index.m3u8','segment_0.ts');
      const resSame=await fetch(same,{headers:origin});
      assert.equal(resSame.status,200);
      assert.deepEqual(Buffer.from(await resSame.arrayBuffer()),seg0);
      assert.equal(encoded,2,'Segment conversion shared');
      await post('/vod/stop',{session_id:a.session_id,user_id:'viewer1'});
      assert.equal((await fetch(first,{headers:origin})).status,503);
      assert.equal((await fetch(late,{headers:origin})).status,200);
      assert(opens>=2);
    } finally {
      if(relay){relay.stop();await new Promise(r=>relay.server.close(r));}
      rmSync(directory,{recursive:true,force:true});
    }
  });

test('on-demand VOD reads a real torrent using seekable WebTorrent pieces', { timeout: 60000 }, async (t) => {
  const { default: WebTorrent } = await import('webtorrent');
  const { TorrentRelay } = await import('../relay/torrent-service.js');
  const directory=mkdtempSync(join(tmpdir(),'doradotv-vod-torrent-'));
  let seeder,relay;
  try {
    const file=join(directory,'movie.mkv');
    try {
      execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
        '-f','lavfi','-i','testsrc=size=160x90:rate=20',
        '-f','lavfi','-i','sine=frequency=500',
        '-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
        '-c:a','ac3','-b:a','96k',file],{timeout:22000});
    } catch(e) {
      if(e.code==='ENOENT')return t.skip('FFmpeg not installed');
      throw e;
    }
    seeder=new WebTorrent({dht:false,lsd:false,tracker:false,natUpnp:false,maxConns:6});
    const seeded=await new Promise(resolve=>seeder.seed(readFileSync(file),{name:'movie.mkv'},resolve));
    const torrents=new TorrentRelay({directory,createClient:async()=>WebTorrent,
      blockPrivatePeers:false,maxBytes:4*1024*1024,metadataTimeout:16000});
    relay=createRelay({directory,secret:'torrent-hls-test',appOrigin:'http://127.0.0.1:5199',
      torrentFactory:torrents});
    const exec=relay.vod.exec.bind(relay.vod);
    relay.vod.exec=(bin,args,timeout)=>bin==='ffprobe'
      ? Promise.resolve({stdout:JSON.stringify({format:{duration:'12.0'},
          streams:[{codec_type:'video',codec_name:'h264'},{codec_type:'audio',codec_name:'ac3'}]})})
      : exec(bin,args,timeout);
    await new Promise(resolve=>relay.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+relay.server.address().port;
    const auth={'Authorization':'Bearer torrent-hls-test','Content-Type':'application/json'};
    const post=async(route,data)=>{
      const res=await fetch(base+route,{method:'POST',headers:auth,body:JSON.stringify(data)});
      assert.equal(res.status,200,await res.clone().text());return res.json();
    };
    const a=await post('/vod/start',{info_hash:seeded.infoHash,file_idx:0,user_id:'alice'});
    const b=await post('/vod/start',{info_hash:seeded.infoHash,file_idx:0,user_id:'bob'});
    let swarm;
    for(let i=0;i<40;i++){
      swarm=torrents.swarms.get(seeded.infoHash);
      if(swarm?.torrent?.infoHash)break;
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    assert.ok(swarm?.torrent);
    swarm.torrent.addPeer('127.0.0.1:'+seeder.torrentPort);
    let status;
    for(let i=0;i<100;i++){
      status=await post('/vod/status',{session_id:b.session_id,user_id:'bob'});
      if(status.state==='ready')break;
      if(status.state==='failed')break;
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    assert.equal(status.state,'ready',JSON.stringify(status));
    assert.equal(torrents.swarms.size,1);
    const segment=status.playlist_url.replace('index.m3u8','segment_1.ts');
    const res=await fetch(segment,{headers:{Origin:'http://127.0.0.1:5199'},
      signal:AbortSignal.timeout(27000)});
    assert.equal(res.status,200);
    const bytes=Buffer.from(await res.arrayBuffer());
    assert(bytes.length>2000);
    assert.equal(bytes[0],0x47);
    await post('/vod/stop',{session_id:a.session_id,user_id:'alice'});
    assert.equal((await fetch(segment,{headers:{Origin:'http://127.0.0.1:5199'}})).status,200);
  } finally {
    if(relay){relay.stop();await new Promise(resolve=>relay.server.close(resolve));}
    if(seeder)await new Promise(resolve=>seeder.destroy(resolve));
    rmSync(directory,{recursive:true,force:true});
  }
});
