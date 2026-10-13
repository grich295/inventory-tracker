const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),{webcrypto}=require('crypto');
const code=fs.readFileSync(require('path').join(__dirname,'../app.js'),'utf8');
let uploads=[],manager=true,files=[];const ctx={S:{session:{user:{id:'owner'}}},canManage:()=>manager,compressImage:async()=>new Blob(['compressed'],{type:'image/jpeg'}),crypto:webcrypto,Uint8Array,Array,Error,photoReferenceCache:new Map(),photoSearchCache:new Map([['old',1]]),sb:{storage:{from(){return {list:async()=>({data:files}),upload:async(path,blob,opts)=>{uploads.push({path,blob,opts});return {} }}}}}};
vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('  async function photoReferencePaths('),code.indexOf('  let photoSearchCache='))+';this.save=savePhotoReference;this.paths=photoReferencePaths;',ctx);
(async()=>{const item={id:'item',primary_photo_path:'item/main.jpg'};await ctx.save(item,{},'owner');assert.equal(uploads.length,1);assert.match(uploads[0].path,/^item\/references\/[a-f0-9]{64}\.jpg$/);assert.equal(uploads[0].opts.upsert,false);assert.equal(item.primary_photo_path,'item/main.jpg');assert.equal(ctx.photoSearchCache.size,0);
files=[{id:'saved',name:uploads[0].path.split('/').pop()}];await ctx.save(item,{},'owner');assert.equal(uploads.length,1,'duplicate not uploaded');assert.equal((await ctx.paths(item)).length,2);
manager=false;await assert.rejects(ctx.save(item,{},'owner'),/manager/);manager=true;await assert.rejects(ctx.save(item,{},'other'),/manager/);
files=Array.from({length:2},(_,i)=>({id:String(i),name:i+'.jpg'}));await assert.rejects(ctx.save(item,{},'owner'),/two/);assert.equal(uploads.length,1);
files=[];await ctx.save(item,{},'owner',.85);assert.equal(uploads.length,1,'high confidence never uploads');
console.log('Confirmed photo compression, extra paths, duplicate protection, account/role guard and reference limit passed');})().catch(e=>{console.error(e);process.exitCode=1});

