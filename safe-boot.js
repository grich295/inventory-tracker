/* Inventory Tracker v8.7.1 SAFE BOOT
   Passive recovery/version layer: no MutationObserver, auth interception or reload loop.
   Older frontend decorators were removed from the current branch; database migrations remain.
*/
(() => {
  'use strict';
  if (window.__INVENTORY_SAFE_BOOT_V863) return;
  window.__INVENTORY_SAFE_BOOT_V863 = true;

  function markVersion(){
    const version=window.INVENTORY_BUILD_VERSION||'8.7.1';
    document.querySelectorAll('.app-version-badge').forEach(el=>{
      if(el.textContent !== 'v'+version) el.textContent = 'v'+version;
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
