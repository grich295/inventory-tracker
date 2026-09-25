const CACHE='inventory-tracker-v8-6-3-safe-boot';
const CORE=[
  './',
  './index.html',
  './app.js',
  './app-v859.js',
  './hotfix-v863-safe-boot.js',
  './styles.css',
  './config.js',
  './manifest.webmanifest'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>Promise.all(CORE.map(url=>cache.add(url).catch(()=>null))))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);

  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request,{cache:'no-store'})
        .then(response=>{
          if(response&&response.ok){
            const copy=response.clone();
            caches.open(CACHE).then(cache=>cache.put('./index.html',copy)).catch(()=>{});
          }
          return response;
        })
        .catch(()=>caches.match('./index.html'))
    );
    return;
  }

  // Network-first. If a JS/CSS request fails, use ONLY the exact cached file.
  // Never return index.html as JavaScript, which can leave the app on Loading.
  event.respondWith(
    fetch(event.request)
      .then(response=>{
        if(response&&(response.ok||response.type==='opaque')){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});
        }
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
