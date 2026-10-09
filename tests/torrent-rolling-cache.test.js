import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RollingChunkStore, HybridTorrentStore } from '../relay/rolling-chunk-store.js';

test('rolling cache stores more total data than disk budget while respecting a strict cap', async () => {
 const dir=mkdtempSync(join(tmpdir(),'rolling-cache-test-'));
 try {
  const size=16*1024, max=4*size, total=40*size;
  const store=new RollingChunkStore(size,{path:dir,length:total,maxBytes:max});
  const put=(i,buf)=>new Promise((r,j)=>store.put(i,buf,e=>e?j(e):r()));
  const get=(i,opts)=>new Promise((r,j)=>store.get(i,opts,(e,b)=>e?j(e):r(b)));
  for(let index=0;index<40;index++){
   const buf=Buffer.alloc(size,index);
   await put(index,buf);
   assert(store.totalBytes<=max,'on-disk accounting must stay capped');
   assert(store.highWaterBytes<=max,'rolling chunk storage exceeds bounded budget');
   const portion=await get(index,{offset:100,length:256});
   assert.deepEqual(portion,Buffer.alloc(256,index));
  }
  assert.equal(store.items.size,4);
  assert.equal(store.highWaterBytes,max);
  await assert.rejects(get(0),/evicted/);
  assert.deepEqual(await get(39),Buffer.alloc(size,39));
  await new Promise((r,j)=>store.destroy(e=>e?j(e):r()));
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('hybrid picks normal seekable disk storage for small torrents and bounded cache for large', async () => {
 const dir=mkdtempSync(join(tmpdir(),'hybrid-torrent-store-'));
 try{
  const small=new HybridTorrentStore(16384,{path:join(dir,'small'),length:40960,fullThreshold:100000,maxBytes:65536});
  const big=new HybridTorrentStore(16384,{path:join(dir,'big'),length:1048576,fullThreshold:100000,maxBytes:65536});
  assert.equal(small.rolling,false);
  assert.equal(big.rolling,true);
  await new Promise((r,j)=>small.destroy(e=>e?j(e):r()));
  await new Promise((r,j)=>big.destroy(e=>e?j(e):r()));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
