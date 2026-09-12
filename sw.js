const SHELL_CACHE='inventory-shell-v846-admin-user-mode';
const RUNTIME_CACHE='inventory-runtime-v846-admin-user-mode';
const SHELL=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icon.svg','./config.js'];
const RUNTIME_ASSETS=[
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
];
self.addEventListener('install',e=>e.waitUntil(Promise.all([
  caches.open(SHELL_CACHE).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>null)))),
  caches.open(RUNTIME_CACHE).then(c=>Promise.all(RUNTIME_ASSETS.map(u=>c.add(u).catch(()=>null))))
]).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>![SHELL_CACHE,RUNTIME_CACHE].includes(k)).map(k=>caches.delete(k)))),
  self.clients.claim()
])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(SHELL_CACHE).then(c=>c.put('./index.html',copy));return r;}).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{
    if(r&&(r.ok||r.type==='opaque')){const copy=r.clone();caches.open(url.origin===self.location.origin?SHELL_CACHE:RUNTIME_CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}
    return r;
  }).catch(async()=>{
    const exact=await caches.match(e.request);if(exact)return exact;
    if(url.origin===self.location.origin){
      if(url.pathname.endsWith('/styles.css'))return (await caches.match('./styles.css'))||Response.error();
      if(url.pathname.endsWith('/app.js'))return (await caches.match('./app.js'))||Response.error();
      if(url.pathname.endsWith('/config.js'))return (await caches.match('./config.js'))||Response.error();
    }
    return Response.error();
  }));
});
