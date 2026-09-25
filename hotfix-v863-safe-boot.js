/* Inventory Tracker v8.6.3 SAFE BOOT
   Emergency recovery layer.
   The v8.6.0 People/Access and v8.6.2 Multi-site frontend decorators are
   deliberately NOT loaded by index.html in this build.
   Their database schema/data changes remain in place.
   This file is passive: no MutationObserver, no auth interception, no reload loop.
*/
(() => {
  'use strict';
  if (window.__INVENTORY_SAFE_BOOT_V863) return;
  window.__INVENTORY_SAFE_BOOT_V863 = true;

  function markVersion(){
    document.querySelectorAll('.app-version-badge').forEach(el=>{
      if(el.textContent !== 'v8.6.3') el.textContent = 'v8.6.3';
    });
  }

  // The base app renders asynchronously. Update the visible label for a short,
  // finite period only; do not watch or rewrite the DOM continuously.
  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    markVersion();
    if(tries>=20)clearInterval(timer);
  },500);
  setTimeout(markVersion,0);

  // Remove any stale helper nodes left in the browser DOM by a previous hotfix
  // if the browser restored the page from memory/back-forward cache.
  for(const id of [
    'inventorySiteSwitcherV861','inventorySiteSwitcherV862',
    'inventorySiteFlashV861','inventorySiteFlashV862'
  ]){
    try{document.getElementById(id)?.remove()}catch(_e){}
  }

  window.addEventListener('pageshow',markVersion,{passive:true});
})();
