const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(fetch){const c={fetch,Blob,FormData,AbortSignal,AbortController,Uint8Array,URL,Response,setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../shared/video-upload.js'),'utf8'),c);return c.ClipVideoUpload;}
test('reject unsupported source, HTML, empty, truncated and oversized video',async()=>{
 const url='https://video.twimg.com/video.mp4';
 for(const [body,headers] of [['<html>error</html>',{}],['',{}],[new Uint8Array(32),{'content-length':'99'}],[new Uint8Array(32),{'content-length':String(30*1024*1024+1)}]]){
  const u=setup(async()=>new Response(body,{headers}));await assert.rejects(u.download(url,async()=>{}));
 }
 const u=setup(()=>{throw Error('must not fetch')});assert.equal(u.allowed('https://elsewhere.test/watch?id=1'),true);assert.equal(u.allowed('http://example.test/video'),true);assert.equal(u.allowed('blob:https://example.test/id'),false);assert.equal(u.allowed('https://example.test/a.m3u8'),false);
 await assert.rejects(u.upload('t','b',new Blob([new Uint8Array(30*1024*1024+1)]),async()=>{}),/30MB/);

});
test('large videos use negotiated blocks in order and finish only after all parts',async()=>{
 const bytes=21*1024*1024+3, seen=[];const blob=new Blob([new Uint8Array(bytes)]);
 const u=setup(async(url,o)=>{
  const method=url.split('/').pop();seen.push(method);
  if(method==='upload_prepare'){const b=JSON.parse(o.body);assert.equal(b.parent_type,'bitable_file');assert.equal(b.size,bytes);return Response.json({code:0,data:{upload_id:'up',block_size:4*1024*1024,block_num:6}});}
  if(method==='upload_part'){const seq=Number(o.body.get('seq'));assert.equal(seq,seen.length-2);assert.equal(Number(o.body.get('size')),o.body.get('file').size);return Response.json({code:0});}
  assert.deepEqual(JSON.parse(o.body),{upload_id:'up',block_num:6});return Response.json({code:0,data:{file_token:'video'}});
 });
 assert.equal(await u.upload('token','base',blob,async()=>{}),'video');assert.equal(seen.filter(x=>x==='upload_part').length,6);
});
test('failed part never finalizes upload',async()=>{
 const seen=[];const u=setup(async(url)=>{seen.push(url);return Response.json(url.endsWith('upload_prepare')?{code:0,data:{upload_id:'up',block_size:4*1024*1024,block_num:6}}:{code:500,msg:'failed'});});
 await assert.rejects(u.upload('t','b',new Blob([new Uint8Array(21*1024*1024)]),async()=>{}),/failed/);assert(!seen.some(u=>u.endsWith('upload_finish')));
});
