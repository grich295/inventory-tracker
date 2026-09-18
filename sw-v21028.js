const SHELL_CACHE='safety-shell-v21043-safety-calendar';
const RUNTIME_CACHE='safety-runtime-v21043-safety-calendar';
const SHELL=['./','./index.html','./styles-v21019.css','./app-v21028.js','./hotfix-v21029-core.js','./hotfix-v21029-ui.js','./hotfix-v21029-exception.js','./hotfix-v21030-ptw.js','./hotfix-v21031-ptw-stability.js','./hotfix-v21032-checklists.js','./bulk-import-v21028.js','./demo-v2100.js','./config.js','./manifest.webmanifest'];
const RUNTIME=[
'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js',
'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'
];
self.addEventListener('install',e=>e.waitUntil(Promise.all([
  caches.open(SHELL_CACHE).then(c=>Promise.all(SHELL.map(x=>c.add(x).catch(()=>null)))),
  caches.open(RUNTIME_CACHE).then(c=>Promise.all(RUNTIME.map(x=>c.add(x).catch(()=>null))))
]).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>/^safety-(?:shell|runtime)-/.test(k)&&![SHELL_CACHE,RUNTIME_CACHE].includes(k)).map(k=>caches.delete(k)))),
  self.clients.claim()
])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.searchParams.has('offline-file'))return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(SHELL_CACHE).then(c=>c.put('./index.html',cp)).catch(()=>{});return r}).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{
    if(r&&(r.ok||r.type==='opaque')){
      const cp=r.clone();
      caches.open(u.origin===self.location.origin?SHELL_CACHE:RUNTIME_CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
    }
    return r;
  }).catch(async()=>{
    const exact=await caches.match(e.request);if(exact)return exact;
    if(u.origin===self.location.origin){
      const f=u.pathname.split('/').pop();
      const fallback=await caches.match('./'+f);if(fallback)return fallback;
    }
    return Response.error();
  }));
});
