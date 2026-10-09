import test from 'node:test';
import assert from 'node:assert/strict';
import WebTorrent from 'webtorrent';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TorrentRelay } from '../relay/torrent-service.js';
import { createRelay } from '../relay/server.js';

test('large MKV fully streams over real TCP BitTorrent with disk cache far below video size', {timeout:50000}, async () => {
 const folder=mkdtempSync(join(tmpdir(),'dorado-rolling-e2e-'));
 const path=join(folder,'sample.mkv');
 let seeder=null,relay=null;
 try {
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',
   '-f','lavfi','-i','testsrc2=size=640x360:rate=30',
   '-t','14','-c:v','libx264','-preset','ultrafast','-crf','12',
   '-f','matroska',path],{timeout:18000});
  const movie=readFileSync(path);
  assert(movie.length>1200000,'Test movie must exceed tiny disk limit: '+movie.length);
  seeder=new WebTorrent({dht:false,tracker:false,lsd:false,maxConns:8,natUpnp:false});
  const seeded=await new Promise(resolve=>seeder.seed(movie,{name:'synthetic-large.mkv'},resolve));
  const streams=new TorrentRelay({directory:folder,createClient:async()=>WebTorrent,
   maxBytes:512*1024,rollingCacheBytes:128*1024,maxStreamBytes:64*1024*1024,
   blockPrivatePeers:false,metadataTimeout:12000});
  relay=createRelay({directory:folder,secret:'only-for-test',appOrigin:'http://127.0.0.1:5199',torrentFactory:streams});
  await new Promise(resolve=>relay.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+relay.server.address().port;
  const headers={'Authorization':'Bearer only-for-test','Content-Type':'application/json'};
  const post=async(endpoint,body)=>{
   const response=await fetch(base+endpoint,{method:'POST',headers,body:JSON.stringify(body)});
   if(response.status!==200)throw Error('POST '+endpoint+' '+response.status+' '+await response.text());
   return response.json();
  };
  const {session_id:id}=await post('/torrent/start',{info_hash:seeded.infoHash,file_idx:0,user_id:'viewer'});
  const torrent=streams.swarms.get(seeded.infoHash).torrent;
  if(!torrent.infoHash)await new Promise(resolve=>torrent.once('infoHash',resolve));
  torrent.addPeer('127.0.0.1:'+seeder.torrentPort);
  let status;
  for(let i=0;i<100;i++){
   status=await post('/torrent/status',{session_id:id,user_id:'viewer'});
   if(status.state==='ready')break;
   await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(status.state,'ready');
  const store=torrent.store.store.inner;
  assert.equal(torrent.store.store.rolling,true,'the full torrent is larger than normal disk budget');
  assert.equal(status.mode,'remux');
  const other=await post('/torrent/start',{info_hash:seeded.infoHash,file_idx:0,user_id:'viewer2'});
  const secondStatus=await fetch(base+'/torrent/status',{method:'POST',headers,
    body:JSON.stringify({session_id:other.session_id,user_id:'viewer2'})});
  assert.equal(secondStatus.status,409,'Large rolling streams must not truncate for late viewers');
  await post('/torrent/stop',{session_id:other.session_id,user_id:'viewer2'});
  const response=await fetch(status.playback_url,{headers:{origin:'http://127.0.0.1:5199'},signal:AbortSignal.timeout(35000)});
  assert.equal(response.status,200);
  const chunks=[];
  for await (const chunk of response.body) chunks.push(chunk);
  const output=Buffer.concat(chunks);
  assert(output.length>1000000,'The entire long test must remux');
  assert(output.includes(Buffer.from('moof')));
  assert(store.highWaterBytes<=streams.rollingCacheBytes,'Disk cache must not grow unbounded');
  console.log('TEST_FILM_BYTES',movie.length,'MP4_BYTES',output.length,'CACHE_HIGH_WATER_BYTES',store.highWaterBytes);
  await post('/torrent/stop',{session_id:id,user_id:'viewer'});
  assert.equal(streams.swarms.size,0,'Consumed rolling swarms must be reset for future replay');
  const replay=await post('/torrent/start',{info_hash:seeded.infoHash,file_idx:0,user_id:'viewer'});
  assert(replay.session_id!==id,'New playback must get a fresh swarm and viewer token');
  await post('/torrent/stop',{session_id:replay.session_id,user_id:'viewer'});
 }finally{
  if(relay){relay.stop();await new Promise(r=>relay.server.close(r))}
  if(seeder)await new Promise(r=>seeder.destroy(r));
  rmSync(folder,{recursive:true,force:true});
 }
});
