const CACHE='inventory-tracker-v8-7-1-clean-integrity';
const CORE=[
  './',
  './index.html',
  './app.js',
  './app-v859.js',
  './hotfix-v863-safe-boot.js',
  './hotfix-v865-master-login.js',
  './styles.css',
  './config.js',
  './version.json',
  './manifest.webmanifest'
];
const RUNTIME=[
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.all([...CORE,...RUNTIME].map(url=>cache.add(new Request(url,{cache:'reload'})).catch(()=>null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    // CacheStorage is shared by every PWA on grich295.github.io. Only remove
    // old Inventory Tracker caches; never delete Safety/Energy caches.
    await Promise.all(keys.filter(key=>key.startsWith('inventory-tracker-')&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

async function localFallback(request,url){
  const exact=await caches.match(request);
  if(exact)return exact;
  // index.html uses versioned ?v= query strings while install precaches the
  // canonical file. Ignore the query string when falling back offline.
  const name=url.pathname.split('/').pop();
  if(name){
    const base=await caches.match('./'+name);
    if(base)return base;
  }
  return null;
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(new Request(event.request,{cache:'no-store'}));
        if(response&&response.ok){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put('./index.html',copy)).catch(()=>{});
        }
        return response;
      }catch(_e){
        return (await caches.match('./index.html'))||Response.error();
      }
    })());
    return;
  }

  const sameOrigin=url.origin===self.location.origin;
  const critical=sameOrigin&&(url.pathname.endsWith('/config.js')||url.pathname.endsWith('/version.json'));

  event.respondWith((async()=>{
    try{
      const request=critical?new Request(event.request,{cache:'no-store'}):event.request;
      const response=await fetch(request);
      if(response&&(response.ok||response.type==='opaque')){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
      }
      return response;
    }catch(_e){
      if(sameOrigin){
        const fallback=await localFallback(event.request,url);
        if(fallback)return fallback;
      }else{
        const fallback=await caches.match(event.request);
        if(fallback)return fallback;
      }
      return Response.error();
    }
  })());
});
