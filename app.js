/* Inventory Tracker - static PWA frontend for Supabase */
(() => {
  'use strict';

  const app = document.getElementById('app');
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.supabaseUrl && cfg.anonKey && !cfg.supabaseUrl.includes('YOUR_PROJECT') && !cfg.anonKey.includes('YOUR_SUPABASE');

  if (!configured || !window.supabase) {
    app.innerHTML = `
      <div class="setup card">
        <h1>Inventory Tracker</h1>
        <p class="muted">The app is built. Connect it to Supabase to start using shared multi-user inventory.</p>
        <ol>
          <li>Create a free Supabase project.</li>
          <li>Run <code>supabase/schema.sql</code> in the Supabase SQL Editor.</li>
          <li>Copy <code>config.example.js</code> to <code>config.js</code> and paste your Project URL and anon key.</li>
          <li>Optionally run <code>supabase/seed_instock.sql</code> to import the supplied InStock history.</li>
          <li>Serve this folder over HTTPS (Cloudflare Pages, Netlify, GitHub Pages, or similar).</li>
        </ol>
        <p>See <strong>README.md</strong> for the complete setup, user-invite and password-reset instructions.</p>
      </div>`;
    return;
  }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const S = {
    session: null,
    profile: null,
    profiles: [],
    items: [],
    locations: [],
    balances: [],
    transactions: [],
    categories: [],
    itemSuppliers: [],
    purchaseOrders: [],
    userPrefs: [],
    stocktakeSettings: null,
    stocktakeTasks: [],
    stocktakeItems: [],
    backupRunning: false,
    backupStatus: '',
    orderTab: 'suggested',
    page: 'dashboard',
    search: '',
    categoryFilter: '',
    selectedItemId: null,
    showArchived: false,
    legacyItemFilter: '',
    legacyFrom: '',
    legacyTo: '',
    scanner: null,
    cameraStream: null,
    cameraTrack: null,
    scanFrame: null,
    smallQrMode: false,
    torchOn: false,
    cameraBaseZoom: null,
    cameraCaps: null,
    cameraZoom: null,
    chart: null,
    liveChannel: null,
    liveTimer: null,
    notice: null,
    passwordMode: false,
    offline: !navigator.onLine,
    offlineSnapshotAt: null,
    syncingOffline: false,
    offlineSyncError: null,
    report: { period: 'month', item: '', user: '', location: '', bin: '', from: '', to: '' }
  };

  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = v => Number(v || 0);
  const qty = v => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const money = v => v == null || v === '' ? '—' : `£${Number(v).toFixed(2)}`;
  const fmtDate = v => v ? new Date(v).toLocaleString() : '—';
  const fmtShortDate = v => v ? new Date(v).toLocaleDateString() : '—';
  const todayISO = () => new Date().toISOString().slice(0,10);
  const backupStorageKey = 'inventoryTrackerLastBackupAt';
  const lastBackupAt = () => localStorage.getItem(backupStorageKey) || '';
  const backupDue = () => {
    const v=lastBackupAt();
    if(!v) return true;
    const age=Date.now()-new Date(v).getTime();
    return !Number.isFinite(age) || age >= 7*24*60*60*1000;
  };
  const monthStartISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
  const byId = (arr, id) => arr.find(x => x.id === id);
  const canManage = () => ['admin','manager'].includes(S.profile?.role);
  const canAdmin = () => S.profile?.role === 'admin';
  const roleLabel = r => ({admin:'Admin',manager:'Manager',staff:'User'})[String(r||'staff')] || 'User';
  const countsAsUsage = t => t?.transaction_type==='USE' && !t?.exclude_from_usage && (!t?.legacy_import || !t?.legacy_classification || t.legacy_classification==='USE');
  const itemPref = itemId => S.userPrefs.find(x=>x.item_id===itemId&&x.user_id===S.profile?.id) || null;
  // Database rows still represent exact stock positions, but users only manage
  // Locations. Bin Ref is free text entered when assigning/moving stock. Older
  // area_name/bin_code values remain readable so existing stock is preserved.
  const effectiveBinCode = l => {
    if(!l) return '';
    const area=String(l.area_name||'').trim();
    const bin=String(l.bin_code||'').trim();
    if(area && bin) return `${area} / ${bin}`;
    return bin || area || '';
  };
  const binLabel = l => { const b=effectiveBinCode(l); return b ? `Bin Ref ${b}` : 'No bin ref'; };
  const locationLabel = l => !l ? '—' : `${l.location_name}${effectiveBinCode(l) ? ` → ${effectiveBinCode(l)}` : ''}`;
  const activeLocations = () => S.locations.filter(l=>l.active);
  const locationNames = (rows=activeLocations()) => [...new Set(rows.map(l=>String(l.location_name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const positionsForLocation = (name, rows=activeLocations()) => rows.filter(l=>l.location_name===name).sort((a,b)=>effectiveBinCode(a).localeCompare(effectiveBinCode(b)));
  const locationNameForId = id => byId(S.locations,id)?.location_name || '';
  const binRefForId = id => effectiveBinCode(byId(S.locations,id));
  const normalizeBin = v => String(v||'').trim();
  const controlledBinPresetRefs = locationName => {
    const key=String(locationName||'').trim().toLowerCase();
    if(key==='workshop main store') return Array.from({length:50},(_,i)=>`Bin ${i+1}`);
    if(key==='workbench cupboard') return Array.from({length:15},(_,i)=>`C${i+1}`);
    return null;
  };
  const controlledBinSummary = locationName => {
    const key=String(locationName||'').trim().toLowerCase();
    if(key==='workshop main store') return 'Controlled bins: Bin 1–Bin 50';
    if(key==='workbench cupboard') return 'Controlled bins: C1–C15';
    return '';
  };
  const naturalBinSort = (a,b) => String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  const itemDefaultPosition = item => {
    if(!item?.default_location_id) return null;
    return byId(S.locations,item.default_location_id) || null;
  };
  const itemDefaultLabel = item => {
    const p=itemDefaultPosition(item);
    return p ? locationLabel(p) : 'Not set';
  };
  function applyItemDefaultDestination(item, locationSelectId, binInputId) {
    const p=itemDefaultPosition(item);
    if(!p || !p.active) return false;
    const loc=document.getElementById(locationSelectId), bin=document.getElementById(binInputId);
    if(!loc || !bin) return false;
    const hasOption=[...loc.options].some(o=>o.value===p.location_name);
    if(!hasOption) return false;
    loc.value=p.location_name;
    // Trigger suggestion refresh first, then restore the exact default bin.
    loc.dispatchEvent(new Event('change',{bubbles:true}));
    setTimeout(()=>{bin.value=effectiveBinCode(p)||'';bin.dispatchEvent(new Event('input',{bubbles:true}));},0);
    return true;
  }
  const itemTotal = itemId => S.balances.filter(b => b.item_id === itemId).reduce((a,b) => a + num(b.quantity), 0);
  const itemPositions = itemId => S.balances.filter(b => b.item_id === itemId && num(b.quantity) > 0).sort((a,b) => num(b.quantity)-num(a.quantity));
  const orderRemaining = o => Math.max(0, num(o.quantity_ordered) - num(o.quantity_received));
  const openOrdersForItem = itemId => S.purchaseOrders.filter(o=>o.item_id===itemId && ['OPEN','PART_RECEIVED'].includes(o.status));
  const itemOnOrder = itemId => openOrdersForItem(itemId).reduce((a,o)=>a+orderRemaining(o),0);
  const suppliersForItem = itemId => S.itemSuppliers.filter(s=>s.item_id===itemId).sort((a,b)=>num(a.supplier_slot)-num(b.supplier_slot));
  const preferredSupplier = itemId => suppliersForItem(itemId).find(s=>s.preferred) || suppliersForItem(itemId)[0] || null;
  const globalSupplierNames = () => [...new Set([...S.itemSuppliers.map(s=>s.supplier_name),...S.purchaseOrders.map(o=>o.supplier_name)].map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const userName = id => id ? (byId(S.profiles,id)?.display_name || 'Unknown user') : 'Legacy import';
  const itemName = id => byId(S.items,id)?.name || 'Unknown item';
  const locName = id => locationLabel(byId(S.locations,id));
  const slug = v => String(v || '').trim().replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'file';
  const fileExt = f => (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g,'');


  const offlineSnapshotKey = 'inventoryTrackerOfflineSnapshotV1';
  const offlineQueueKey = 'inventoryTrackerOfflineQueueV1';
  const clientRef = id => `CLIENT:${id}`;
  const makeClientId = () => (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const isNetworkError = e => {
    const m=String(e?.message||e||'').toLowerCase();
    return !navigator.onLine || e?.name==='AbortError' || m.includes('failed to fetch') || m.includes('network') || m.includes('load failed') || m.includes('fetch');
  };
  function allOfflineQueue(){
    try{const v=JSON.parse(localStorage.getItem(offlineQueueKey)||'[]');return Array.isArray(v)?v:[];}catch(_){return [];}
  }
  function saveOfflineQueue(rows){localStorage.setItem(offlineQueueKey,JSON.stringify(rows));}
  function currentOfflineQueue(){const uid=S.session?.user?.id;return uid?allOfflineQueue().filter(x=>x.user_id===uid):[];}
  function pendingOfflineCount(){return currentOfflineQueue().length;}
  function saveOfflineSnapshot(){
    if(!S.session?.user?.id||!S.profile)return;
    const payload={
      saved_at:new Date().toISOString(),user_id:S.session.user.id,profile:S.profile,
      profiles:S.profiles,items:S.items,locations:S.locations,balances:S.balances,transactions:S.transactions,
      categories:S.categories,itemSuppliers:S.itemSuppliers,purchaseOrders:S.purchaseOrders,userPrefs:S.userPrefs,
      stocktakeSettings:S.stocktakeSettings,stocktakeTasks:S.stocktakeTasks,stocktakeItems:S.stocktakeItems
    };
    try{localStorage.setItem(offlineSnapshotKey,JSON.stringify(payload));S.offlineSnapshotAt=payload.saved_at;}
    catch(e){
      try{payload.transactions=S.transactions.slice(0,500);localStorage.setItem(offlineSnapshotKey,JSON.stringify(payload));S.offlineSnapshotAt=payload.saved_at;}catch(_){}
    }
  }
  function restoreOfflineSnapshot(){
    try{
      const p=JSON.parse(localStorage.getItem(offlineSnapshotKey)||'null');
      if(!p||p.user_id!==S.session?.user?.id)return false;
      S.profile=p.profile||null;S.profiles=p.profiles||[];S.items=p.items||[];S.locations=p.locations||[];S.balances=p.balances||[];S.transactions=p.transactions||[];
      S.categories=p.categories||[];S.itemSuppliers=p.itemSuppliers||[];S.purchaseOrders=p.purchaseOrders||[];S.userPrefs=p.userPrefs||[];
      S.stocktakeSettings=p.stocktakeSettings||null;S.stocktakeTasks=p.stocktakeTasks||[];S.stocktakeItems=p.stocktakeItems||[];S.offlineSnapshotAt=p.saved_at||null;
      return !!S.profile;
    }catch(_){return false;}
  }
  function offlineStatusHtml(){
    const n=pendingOfflineCount();
    if(!S.offline&&!n)return '';
    const when=S.offlineSnapshotAt?` Last saved ${esc(fmtDate(S.offlineSnapshotAt))}.`:'';
    if(S.offline)return `<div class="offline-banner"><strong>Offline mode.</strong> Using the last saved stock data.${when} Scan/search and Add, Use, Move and Adjust will be queued. Counts may be stale until the connection returns.${n?` <strong>${n} action${n===1?'':'s'} pending sync.</strong>`:''}<div class="actions"><button class="btn ghost small" id="reviewOfflineBtn">Pending actions</button></div></div>`;
    return `<div class="offline-banner syncing"><strong>${n} stock action${n===1?'':'s'} waiting to sync.</strong>${S.offlineSyncError?` ${esc(S.offlineSyncError)}`:''}<div class="actions"><button class="btn small" id="syncOfflineBtn" ${S.syncingOffline?'disabled':''}>${S.syncingOffline?'Syncing…':'Sync now'}</button><button class="btn ghost small" id="reviewOfflineBtn">Review</button></div></div>`;
  }
  function localPosition(locationName,binRef){
    let p=findPosition(locationName,binRef);if(p)return p;
    p={id:`offline-pos:${makeClientId()}`,location_name:locationName,area_name:'',bin_code:normalizeBin(binRef),active:true,notes:'Pending offline stock position',_offline:true};
    S.locations.push(p);return p;
  }
  function localBalance(itemId,locationId){
    let b=S.balances.find(x=>x.item_id===itemId&&x.location_id===locationId);
    if(!b){b={id:`offline-bal:${makeClientId()}`,item_id:itemId,location_id:locationId,quantity:0,updated_at:new Date().toISOString(),_offline:true};S.balances.push(b);}
    return b;
  }
  function applyLocalStockOperation(op){
    const now=op.created_at||new Date().toISOString();
    let fromPos=null,toPos=null,old=0;
    if(op.from_location_name){fromPos=localPosition(op.from_location_name,op.from_bin_ref||'');op.from_local_id=fromPos.id;}
    if(op.to_location_name){toPos=localPosition(op.to_location_name,op.to_bin_ref||'');op.to_local_id=toPos.id;}
    if(op.type==='ADD'){
      const b=localBalance(op.item_id,toPos.id);old=num(b.quantity);b.quantity=old+num(op.quantity);b.updated_at=now;
    }else if(op.type==='USE'){
      const b=localBalance(op.item_id,fromPos.id);old=num(b.quantity);b.quantity=Math.max(0,old-num(op.quantity));b.updated_at=now;
    }else if(op.type==='MOVE'){
      const f=localBalance(op.item_id,fromPos.id),t=localBalance(op.item_id,toPos.id);old=num(f.quantity);f.quantity=Math.max(0,old-num(op.quantity));t.quantity=num(t.quantity)+num(op.quantity);f.updated_at=t.updated_at=now;
    }else if(op.type==='ADJUST'){
      const b=localBalance(op.item_id,fromPos.id);old=num(b.quantity);op.previous_quantity=old;b.quantity=num(op.new_quantity);b.updated_at=now;
    }
    const existing=S.transactions.find(t=>t.reference===clientRef(op.id));
    if(!existing){
      S.transactions.unshift({id:`offline-tx:${op.id}`,item_id:op.item_id,transaction_type:op.type,quantity:op.type==='ADJUST'?Math.abs(num(op.new_quantity)-old):num(op.quantity),from_location_id:fromPos?.id||null,to_location_id:toPos?.id||null,new_quantity:op.new_quantity??null,reason:op.reason||null,reference:clientRef(op.id),notes:[op.notes,'Pending offline sync'].filter(Boolean).join(' · '),user_id:op.user_id,occurred_at:now,_offline_pending:true});
    }
  }
  function queueStockOperation(op){
    const rows=allOfflineQueue();
    if(!rows.some(x=>x.id===op.id)){applyLocalStockOperation(op);rows.push(op);saveOfflineQueue(rows);saveOfflineSnapshot();}
    S.offline=true;
  }
  async function resolveServerPosition(name,binRef){
    const {data,error}=await sb.rpc('get_or_create_stock_position',{p_location_name:name,p_bin_ref:normalizeBin(binRef)});if(error)throw error;return data;
  }
  async function sendClientStockOperation(op){
    let from=null,to=null;
    if(op.from_location_name)from=await resolveServerPosition(op.from_location_name,op.from_bin_ref||'');
    if(op.to_location_name)to=await resolveServerPosition(op.to_location_name,op.to_bin_ref||'');
    if(op.type==='MOVE'&&from===to)throw new Error('Choose a different destination Location / Bin Ref.');
    const {error}=await sb.rpc('apply_client_stock_transaction',{p_item_id:op.item_id,p_type:op.type,p_quantity:num(op.quantity),p_from_location_id:from,p_to_location_id:to,p_new_quantity:op.new_quantity==null?null:num(op.new_quantity),p_reason:op.reason||null,p_client_reference:clientRef(op.id),p_notes:op.notes||null});
    if(error)throw error;
  }
  async function syncOfflineQueue(){
    if(S.syncingOffline||!navigator.onLine||!S.session)return;
    const uid=S.session.user.id;let rows=allOfflineQueue(),mine=rows.filter(x=>x.user_id===uid);if(!mine.length){S.offline=false;S.offlineSyncError=null;return;}
    S.syncingOffline=true;S.offline=false;S.offlineSyncError=null;render();
    let synced=0;
    for(const op of mine){
      try{
        await sendClientStockOperation(op);rows=rows.filter(x=>x.id!==op.id);saveOfflineQueue(rows);synced++;
      }catch(e){
        if(isNetworkError(e)){S.offline=true;S.offlineSyncError='Connection was lost during sync.';break;}
        op.last_error=parseError(e);rows=rows.map(x=>x.id===op.id?op:x);saveOfflineQueue(rows);S.offlineSyncError=`Sync stopped: ${parseError(e)}`;break;
      }
    }
    try{if(navigator.onLine){await loadData();S.offline=false;startRealtime();}}catch(e){if(restoreOfflineSnapshot())S.offline=true;}
    S.syncingOffline=false;
    if(synced&&!S.offlineSyncError)setNotice(`${synced} offline stock action${synced===1?'':'s'} synced.`);
    render();
  }
  function showOfflineQueue(){
    const rows=currentOfflineQueue();
    showModal(`<header><div><h2>Pending offline stock actions</h2><div class="muted">These are kept on this device until they are accepted by Supabase.</div></div><button class="close" data-close>×</button></header>${rows.length?`<div class="item-list">${rows.map(op=>`<div class="item-row"><div><strong>${esc(itemName(op.item_id))}</strong><div class="muted">${esc(op.type)} · ${op.type==='ADJUST'?`new count ${qty(op.new_quantity)}`:qty(op.quantity)} · ${esc(op.from_location_name||op.to_location_name||'')}</div>${op.last_error?`<div class="notice error compact">${esc(op.last_error)}</div>`:''}</div><span class="badge warn">Pending</span></div>`).join('')}</div>`:'<div class="notice success">No pending stock actions.</div>'}<div class="actions">${navigator.onLine&&rows.length?'<button class="btn" id="modalSyncOffline">Sync now</button>':''}<button class="btn ghost" data-close>Close</button></div>`);
    const b=document.getElementById('modalSyncOffline');if(b)b.onclick=()=>{closeModal();syncOfflineQueue();};
  }

  function setNotice(message, type='success') {
    S.notice = { message, type };
    setTimeout(() => { if (S.notice?.message === message) { S.notice = null; render(); } }, 4500);
  }

  function noticeHtml() {
    if (!S.notice) return '';
    return `<div class="notice ${S.notice.type === 'error' ? 'error' : 'success'}">${esc(S.notice.message)}</div>`;
  }

  function parseError(e) {
    return e?.message || e?.error_description || String(e || 'Something went wrong');
  }

  async function fetchAll(table, select='*', orderCol=null, ascending=true) {
    let out = [], from = 0;
    while (true) {
      let q = sb.from(table).select(select).range(from, from + 999);
      if (orderCol) q = q.order(orderCol, { ascending });
      const { data, error } = await q;
      if (error) throw error;
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    return out;
  }

  async function loadData({transactions=true}={}) {
    const [profiles,items,locations,balances,itemSuppliers,purchaseOrders,categories,userPrefs,stocktakeSettingsRows,stocktakeTasks,stocktakeItems] = await Promise.all([
      fetchAll('profiles','*','display_name',true),
      fetchAll('items','*','name',true),
      fetchAll('stock_locations','*','location_name',true),
      fetchAll('stock_balances','*'),
      fetchAll('item_suppliers','*','supplier_slot',true),
      fetchAll('purchase_orders','*','ordered_at',false),
      fetchAll('inventory_categories','*','sort_order',true),
      fetchAll('user_item_preferences','*','last_viewed_at',false),
      fetchAll('stocktake_settings','*'),
      fetchAll('stocktake_tasks','*','created_at',false),
      fetchAll('stocktake_task_items','*')
    ]);
    S.profiles=profiles; S.items=items; S.locations=locations; S.balances=balances;
    S.itemSuppliers=itemSuppliers; S.purchaseOrders=purchaseOrders; S.categories=categories; S.userPrefs=userPrefs;
    S.stocktakeSettings=stocktakeSettingsRows[0]||null; S.stocktakeTasks=stocktakeTasks; S.stocktakeItems=stocktakeItems;
    S.profile=byId(S.profiles,S.session?.user?.id)||S.profile;
    if(transactions) S.transactions=await fetchAll('transactions','*','occurred_at',false);
    S.offline=false; S.offlineSyncError=null; saveOfflineSnapshot();
  }


  async function stopRealtime() {
    if(S.liveTimer){clearTimeout(S.liveTimer);S.liveTimer=null;}
    if(S.liveChannel){try{await sb.removeChannel(S.liveChannel);}catch(_){}S.liveChannel=null;}
  }

  function queueLiveRefresh() {
    clearTimeout(S.liveTimer);
    S.liveTimer=setTimeout(async()=>{
      if(!S.session)return;
      try{
        await loadData();
        if(S.profile?.active===false){await sb.auth.signOut();return;}
        if(S.page!=='scan' && !document.getElementById('modalBackdrop')) render();
      }catch(e){console.warn('Live refresh failed',e);}
    },350);
  }

  function startRealtime() {
    if(S.liveChannel||!S.session||S.offline||!navigator.onLine)return;
    let c=sb.channel('inventory-live');
    for(const table of ['stock_balances','transactions','items','stock_locations','profiles','item_suppliers','purchase_orders','inventory_categories','user_item_preferences','stocktake_tasks','stocktake_task_items']){
      c=c.on('postgres_changes',{event:'*',schema:'public',table},queueLiveRefresh);
    }
    S.liveChannel=c.subscribe();
  }

  async function bootstrap() {
    const { data: { session } } = await sb.auth.getSession();
    S.session = session;
    const hash = window.location.hash;
    const qs = window.location.search;
    S.passwordMode = hash.includes('type=recovery') || hash.includes('type=invite') || qs.includes('type=recovery') || qs.includes('type=invite') || session?.user?.user_metadata?.must_set_password === true;
    if (S.session) {
      try {
        await loadData();
        if(S.profile?.active===false){ await sb.auth.signOut(); return; }
        try{ await sb.rpc('ensure_stocktake_task',{p_force:false}); await loadData({transactions:false}); }catch(_){}
        startRealtime();
        if(pendingOfflineCount())setTimeout(syncOfflineQueue,250);
      } catch (e) {
        if(restoreOfflineSnapshot()){
          S.offline=true;S.offlineSyncError=null;
          setNotice(`Offline mode: showing saved inventory from ${fmtDate(S.offlineSnapshotAt)}.`, 'success');
        }else setNotice(navigator.onLine?parseError(e):'No connection and no saved offline inventory is available on this device.','error');
      }
    }
    render();
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    S.session = session;
    if (event === 'PASSWORD_RECOVERY' || session?.user?.user_metadata?.must_set_password === true) S.passwordMode = true;
    if (session) {
      try {
        await loadData();
        if(S.profile?.active===false){ await sb.auth.signOut(); return; }
        try{ await sb.rpc('ensure_stocktake_task',{p_force:false}); await loadData({transactions:false}); }catch(_){}
        startRealtime();
        if(pendingOfflineCount())setTimeout(syncOfflineQueue,250);
      } catch (e) {
        if(restoreOfflineSnapshot()){S.offline=true;S.notice={message:`Offline mode: showing saved inventory from ${fmtDate(S.offlineSnapshotAt)}.`,type:'success'};}
        else S.notice = {message:parseError(e),type:'error'};
      }
    } else {
      stopRealtime();
      S.profile = null; S.profiles=[]; S.items=[]; S.locations=[]; S.balances=[]; S.transactions=[];
    }
    render();
  });

  function render() {
    stopScanner();
    if (!S.session) return renderLogin();
    if (S.passwordMode) return renderPasswordUpdate();
    app.innerHTML = shellHtml(pageHtml());
    bindShell();
    bindPage();
  }

  function renderLogin() {
    app.innerHTML = `
      <div class="login">
        <h1>Inventory Tracker</h1>
        <p class="muted">Sign in to scan, find and update stock.</p>
        ${!navigator.onLine?'<div class="notice warn">No connection. Offline mode is available only if this device still has a previously signed-in session and saved inventory data.</div>':''}
        ${noticeHtml()}
        <form id="loginForm">
          <label>Email</label><input id="loginEmail" type="email" autocomplete="email" required>
          <label>Password</label><input id="loginPassword" type="password" autocomplete="current-password" required>
          <div class="actions"><button class="btn" type="submit">Sign in</button><button class="btn ghost" id="forgotBtn" type="button">Forgot password</button></div>
        </form>
      </div>`;
    document.getElementById('loginForm').onsubmit = async e => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const { error } = await sb.auth.signInWithPassword({email,password});
      if (error) { S.notice={message:parseError(error),type:'error'}; renderLogin(); }
    };
    document.getElementById('forgotBtn').onclick = async () => {
      const email = document.getElementById('loginEmail').value.trim();
      if (!email) { S.notice={message:'Enter your email address first.',type:'error'}; return renderLogin(); }
      const redirectTo = `${location.origin}${location.pathname}`;
      const { error } = await sb.auth.resetPasswordForEmail(email,{redirectTo});
      S.notice = error ? {message:parseError(error),type:'error'} : {message:'Password reset email sent.',type:'success'};
      renderLogin();
    };
  }

  function renderPasswordUpdate() {
    app.innerHTML = `
      <div class="login">
        <h1>Set your password</h1>
        <p class="muted">Choose a new password for your Inventory Tracker account.</p>
        ${noticeHtml()}
        <form id="pwForm">
          <label>New password</label><input id="pw1" type="password" minlength="8" autocomplete="new-password" required>
          <label>Repeat password</label><input id="pw2" type="password" minlength="8" autocomplete="new-password" required>
          <div class="actions"><button class="btn" type="submit">Save password</button></div>
        </form>
      </div>`;
    document.getElementById('pwForm').onsubmit = async e => {
      e.preventDefault();
      const a=document.getElementById('pw1').value,b=document.getElementById('pw2').value;
      if (a!==b) { S.notice={message:'Passwords do not match.',type:'error'}; return renderPasswordUpdate(); }
      const currentMeta = S.session?.user?.user_metadata || {};
      const { error } = await sb.auth.updateUser({
        password:a,
        data:{...currentMeta,must_set_password:false,password_set_at:new Date().toISOString()}
      });
      if (error) { S.notice={message:parseError(error),type:'error'}; return renderPasswordUpdate(); }
      const { data:{ session } } = await sb.auth.getSession();
      S.session=session;
      S.passwordMode=false; history.replaceState({},'',location.pathname); setNotice('Password set. You can now use Inventory Tracker.'); render();
    };
  }

  function shellHtml(content) {
    const nav = [
      ['dashboard','Dashboard'],['scan','Scan'],['items','Items'],['locations','Locations'],['orders','Orders'],['stocktake','Stocktake'],['reports','Reports'],['history','History'],['help','Help']
    ];
    if (S.profile?.role === 'admin') nav.push(['users','Users'],['legacy','Legacy'],['backup','Backup']);
    return `<div class="shell">
      <div class="topbar"><div><div class="brand">Inventory Tracker</div><div class="userline">${esc(S.profile?.display_name || S.session.user.email)} · ${esc(roleLabel(S.profile?.role))} · v7.9</div></div><button class="btn secondary" id="logoutBtn">Sign out</button></div>
      <div class="nav">${nav.map(([p,t])=>`<button data-page="${p}" class="${S.page===p?'active':''}">${t}</button>`).join('')}</div>
      <main class="content">${noticeHtml()}${offlineStatusHtml()}${content}</main>
    </div>`;
  }

  function bindShell() {
    document.getElementById('logoutBtn').onclick = () => sb.auth.signOut();
    document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { S.page=b.dataset.page; S.selectedItemId=null; render(); });
    const sync=document.getElementById('syncOfflineBtn');if(sync)sync.onclick=()=>syncOfflineQueue();
    const review=document.getElementById('reviewOfflineBtn');if(review)review.onclick=()=>showOfflineQueue();
  }

  function pageHtml() {
    if (S.page==='scan') return scanHtml();
    if (S.page==='items') return itemsHtml();
    if (S.page==='locations') return locationsHtml();
    if (S.page==='orders') return ordersHtml();
    if (S.page==='stocktake') return stocktakeHtml();
    if (S.page==='reports') return reportsHtml();
    if (S.page==='history') return historyHtml();
    if (S.page==='help') return helpHtml();
    if (S.page==='users') return usersHtml();
    if (S.page==='legacy') return legacyReviewHtml();
    if (S.page==='backup') return backupHtml();
    return dashboardHtml();
  }


  function helpHtml() {
    const role=String(S.profile?.role||'staff');
    const roleName=esc(roleLabel(role));

    const common=`
      <div class="card help-role-banner">
        <h2>Help</h2>
        <p><strong>Your role: ${roleName}</strong></p>
        <p class="muted">Use your own login so stock actions and audit history are recorded against the correct person.</p>
      </div>

      <h2 class="help-heading">Everyday use</h2>
      <div class="help-grid">
        <div class="card help-card">
          <h3>Find an item</h3>
          <ul>
            <li>Use <strong>Scan</strong> to scan the QR label on the bin/item.</li>
            <li>Or open <strong>Items</strong> and search by item name, item code, category, location or Bin Ref.</li>
            <li>Favourites, recent items and frequently used items make repeat jobs quicker.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Add / Use / Move / Adjust</h3>
          <ul>
            <li><strong>Add:</strong> stock has physically arrived or been added.</li>
            <li><strong>Use:</strong> stock has been consumed/used. This counts towards usage reports and Suggested Orders.</li>
            <li><strong>Move:</strong> transfer stock between locations/bins. Overall stock does not change and it is not usage.</li>
            <li><strong>Adjust:</strong> correct a stock-count error. Adjustments do not count as usage.</li>
          </ul>
          <div class="help-warning"><strong>Important:</strong> if stock is missing because it was actually used but somebody forgot to record it, record it as <strong>Use</strong>, not Adjust. This keeps usage and Suggested Orders accurate.</div>
        </div>

        <div class="card help-card">
          <h3>Locations and bins</h3>
          <ul>
            <li>Select the main <strong>Location</strong>, then the Bin Ref.</li>
            <li><strong>Workshop main store:</strong> controlled dropdown Bin 1–Bin 50.</li>
            <li><strong>Workbench cupboard:</strong> controlled dropdown C1–C15.</li>
            <li>Other locations can still use a manual Bin Ref where needed.</li>
            <li><strong>No bin / Unallocated</strong> is available where appropriate.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Default storage</h3>
          <ul>
            <li>An item can have a Default Location and Bin Ref.</li>
            <li>Add Stock, Move destination and Receive Delivery use that default automatically.</li>
            <li>You can override the destination for an individual transaction.</li>
            <li>Changing an item's default does not move existing stock.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Offline mode</h3>
          <ul>
            <li>After a successful online login/load, saved stock data can be used when the connection drops.</li>
            <li>Scan/search and Add, Use, Move and Adjust can be queued offline.</li>
            <li>Queued actions sync automatically when the connection returns.</li>
            <li>Check the offline banner for pending actions or sync errors.</li>
          </ul>
          <div class="help-tip">Stock shown offline may be older than the live database until the device reconnects and syncs.</div>
        </div>

        <div class="card help-card">
          <h3>Stocktake</h3>
          <ul>
            <li>Open <strong>Stocktake</strong> when a task is assigned to you.</li>
            <li>Count the physical stock in each listed Location/Bin.</li>
            <li>Enter the actual count, not the expected count.</li>
            <li>Completing the task creates audited stock corrections for differences.</li>
          </ul>
        </div>
      </div>

      <h2 class="help-heading">User guide</h2>
      <div class="help-grid">
        <div class="card help-card">
          <h3>What a User can do</h3>
          <ul>
            <li>Scan and search stock.</li>
            <li>View quantities and stock positions.</li>
            <li>Add, Use, Move and Adjust stock.</li>
            <li>Receive deliveries against open orders.</li>
            <li>Complete assigned stocktakes.</li>
            <li>View Orders, Reports and History.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Receiving an order</h3>
          <ul>
            <li>Open <strong>Orders → On Order</strong>.</li>
            <li>Open the relevant order and receive the quantity actually delivered.</li>
            <li>Choose/check the destination location and bin.</li>
            <li>Part deliveries remain open for the outstanding balance.</li>
          </ul>
        </div>
      </div>`;

    const manager=`
      <h2 class="help-heading">Manager guide</h2>
      <div class="help-grid">
        <div class="card help-card">
          <h3>Items</h3>
          <ul>
            <li>Create and edit inventory items.</li>
            <li>Set category, reorder level, default storage and suppliers.</li>
            <li>Add/change item photos. Photos are cropped then resized/compressed before storage.</li>
            <li>Archive items rather than losing useful history.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Locations</h3>
          <ul>
            <li>Add, rename and remove stock locations where permitted.</li>
            <li>Controlled bins are currently Workshop main store Bin 1–50 and Workbench cupboard C1–C15.</li>
            <li>Ask for an app update if more controlled/default bins are required.</li>
          </ul>
          <div class="help-tip">Renaming locations is preferable to creating duplicates where the physical location is the same.</div>
        </div>

        <div class="card help-card">
          <h3>Orders and suppliers</h3>
          <ul>
            <li>Suggested Orders use actual <strong>Use</strong> transactions from the previous 3 completed months.</li>
            <li>Current stock and stock already On Order are subtracted.</li>
            <li>Managers/Admins can create, edit and close purchase orders.</li>
            <li>Use supplier details against each item so ordering is quicker and consistent.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Reports and audit history</h3>
          <ul>
            <li><strong>Reports</strong> shows usage and activity by item, user, location, bin and date range.</li>
            <li><strong>History</strong> records Add, Use, Move and Adjust actions with user/location details.</li>
            <li>Use reports to check unusual usage and help plan orders.</li>
          </ul>
        </div>
      </div>`;

    const admin=`
      <h2 class="help-heading">Admin guide</h2>
      <div class="help-grid">
        <div class="card help-card">
          <h3>Users and roles</h3>
          <ul>
            <li>Open <strong>Users</strong> to invite people and set User, Manager or Admin roles.</li>
            <li>Change a registered email without losing the user's password, role or stock history.</li>
            <li>Disable users rather than deleting them so audit history is retained.</li>
            <li>Re-enable an account if the person needs access again later.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Backups</h3>
          <ul>
            <li>Open <strong>Backup → Back up now</strong>.</li>
            <li>The ZIP contains inventory database records and can include item photos.</li>
            <li>It does not contain passwords or Supabase secrets.</li>
            <li>A weekly backup is a sensible default and a fresh backup should be taken before major database/app changes.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Stocktake administration</h3>
          <ul>
            <li>Admins can enable/disable automatic stocktakes.</li>
            <li>Set the interval, number of items per task and due period.</li>
            <li>Create the next stocktake immediately when needed.</li>
            <li>Reassign open stocktake tasks to another active user.</li>
          </ul>
        </div>

        <div class="card help-card">
          <h3>Legacy review</h3>
          <ul>
            <li>Use <strong>Legacy</strong> to review imported historical transactions.</li>
            <li>Classify/exclude old records where needed so historical imports do not distort real usage and Suggested Orders.</li>
            <li>Do not change legacy classifications simply to make reports look better; use the best available evidence.</li>
          </ul>
        </div>
      </div>`;

    return common + (canManage()?manager:'') + (canAdmin()?admin:'');
  }

  function dashboardHtml() {
    const active = S.items.filter(i=>i.active);
    const totalUnits = S.balances.reduce((a,b)=>a+num(b.quantity),0);
    const low = active.filter(i => num(i.reorder_level)>0 && itemTotal(i.id)<=num(i.reorder_level));
    const mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0);
    const usedMonth = S.transactions.filter(t=>countsAsUsage(t) && new Date(t.occurred_at)>=mStart).reduce((a,t)=>a+num(t.quantity),0);
    const onOrderUnits = S.purchaseOrders.filter(o=>['OPEN','PART_RECEIVED'].includes(o.status)).reduce((a,o)=>a+orderRemaining(o),0);
    const recent = S.transactions.slice(0,8);
    return `
      <div class="grid cards">
        <div class="card"><div class="muted">Active items</div><div class="stat">${active.length}</div></div>
        <div class="card"><div class="muted">Units in stock</div><div class="stat">${qty(totalUnits)}</div></div>
        <div class="card"><div class="muted">Low-stock items</div><div class="stat">${low.length}</div></div>
        <div class="card" data-go="orders"><div class="muted">Units on order</div><div class="stat">${qty(onOrderUnits)}</div></div>
        <div class="card"><div class="muted">Used this month</div><div class="stat">${qty(usedMonth)}</div></div>
      </div>
      <div class="toolbar" style="margin-top:1rem"><button class="btn good" data-go="scan">Scan Stock QR</button><button class="btn" data-go="items">Manual search</button>${canManage()?'<button class="btn secondary" id="dashAddItem">Add new item</button>':''}</div>
      ${S.offline?`<div class="notice warn"><strong>Offline stock mode:</strong> QR/manual search and stock Add, Use, Move and Adjust are available. Orders, user/admin changes, stocktake submission and other database changes need a connection. Any queued stock changes are checked against the live database when syncing.</div>`:''}
      ${assignedOpenStocktake()?`<div class="notice warn" style="margin-top:1rem"><strong>Stocktake ${assignedOpenStocktake().status==='OVERDUE'?'overdue':'due'}.</strong> About ${stocktakeItemsFor(assignedOpenStocktake().id).length} items have been assigned to you. <button class="btn ghost" data-go="stocktake">Open Stocktake</button></div>`:''}
      ${dashboardPersonalHtml()}
      ${canAdmin()&&backupDue()?`<div class="notice warn" style="margin-top:1rem"><strong>Admin backup due.</strong> ${lastBackupAt()?`Last backup: ${esc(fmtDate(lastBackupAt()))}.`:'No app backup has been recorded on this device yet.'} <button class="btn ghost" data-go="backup">Open Backup</button></div>`:''}
      ${low.length?`<div class="card"><h3>Low stock</h3><div class="item-list">${low.slice(0,8).map(itemRowHtml).join('')}</div></div>`:''}
      <div class="card" style="margin-top:1rem"><h3>Recent activity</h3>${transactionTable(recent)}</div>`;
  }

  function scanHtml() {
    return `<div class="scan-box">
      <div class="card"><h2>Scan Stock QR</h2><p class="muted">Point the rear camera at the QR code on the bin or item label. For small labels, use <strong>Small QR Auto</strong> and keep the code near the centre guide.</p>
        <div id="reader" class="scanner live-scanner">
          <video id="qrVideo" playsinline muted autoplay></video>
          <canvas id="qrCanvas" class="hidden"></canvas>
          <div class="qr-guide" aria-hidden="true"></div>
          <div id="scanModeBadge" class="scan-mode-badge">Normal scan</div>
        </div>
        <div id="scanStatus" class="notice">Starting rear camera…</div>
        <div class="camera-tools">
          <button class="btn ghost" id="smallQrBtn" type="button" aria-pressed="false">Small QR Auto</button>
          <button class="btn ghost hidden" id="refocusBtn" type="button">Refocus</button>
          <button class="btn ghost hidden" id="torchBtn" type="button" aria-pressed="false">Torch</button>
        </div>
        <div id="zoomWrap" class="camera-zoom hidden">
          <label for="zoomSlider">Camera zoom <strong id="zoomValue">1.0×</strong></label>
          <input id="zoomSlider" type="range" min="1" max="4" step="0.1" value="1">
        </div>
        <div class="actions">
          <button class="btn secondary" id="stopScan">Stop camera</button>
          <button class="btn ghost" id="scanPhotoBtn">Scan QR from photo</button>
          <input id="scanPhotoInput" class="hidden" type="file" accept="image/*" capture="environment">
          <button class="btn ghost" data-go="items">Manual search instead</button>
        </div>
      </div>
      <div class="card" style="margin-top:1rem"><label>Or type/scan code</label><div class="toolbar"><input id="scanText" placeholder="Item or stock QR code"><button class="btn" id="scanFind">Find</button></div></div>
    </div>`;
  }

  function itemRowHtml(i) {
    const total=itemTotal(i.id); const low=num(i.reorder_level)>0 && total<=num(i.reorder_level); const onOrder=itemOnOrder(i.id);
    const pos=itemPositions(i.id).slice(0,3).map(b=>`${esc(locationLabel(byId(S.locations,b.location_id)))} (${qty(b.quantity)})`).join(' · ');
    return `<div class="item-row inventory-item-row ${i.active?'':'archived-row'}" data-item="${i.id}">${i.primary_photo_path?`<img class="item-thumb" data-photo-path="${esc(i.primary_photo_path)}" alt="">`:`<div class="item-thumb placeholder">📦</div>`}<div class="item-main"><div class="item-title">${esc(i.name)}${i.active?'':' <span class="badge muted">Archived</span>'}</div><div class="muted">${esc(i.item_code)}${i.category?' · '+esc(i.category):''}</div><div class="muted">${pos || 'No stock location set'}</div>${low&&i.active?'<span class="badge low">Low stock</span> ':''}${onOrder>0?`<span class="badge order">On order ${qty(onOrder)}</span>`:''}</div><div class="qty">${qty(total)}</div></div>`;
  }


  function categoryNames() {
    const configured=S.categories.filter(c=>c.active).map(c=>c.name);
    const existing=S.items.map(i=>String(i.category||'').trim()).filter(Boolean);
    return [...new Set([...configured,...existing])].sort((a,b)=>a.localeCompare(b));
  }

  function filteredItems() {
    const q=S.search.toLowerCase().trim();
    return S.items.filter(i=>S.showArchived?!i.active:i.active).filter(i=>{
      if(S.categoryFilter && String(i.category||'')!==S.categoryFilter) return false;
      if(!q) return true;
      const positionText=itemPositions(i.id).map(b=>locationLabel(byId(S.locations,b.location_id))).join(' ');
      return [i.name,i.item_code,i.qr_value,i.category,positionText].join(' ').toLowerCase().includes(q);
    });
  }

  function itemsHtml() {
    const filtered=filteredItems();
    return `<div class="toolbar"><input id="itemSearch" value="${esc(S.search)}" placeholder="Search item, code, location or bin"><select id="categoryFilter"><option value="">All categories</option>${categoryNames().map(c=>`<option value="${esc(c)}" ${S.categoryFilter===c?'selected':''}>${esc(c)}</option>`).join('')}</select>${canManage()?'<button class="btn" id="addItemBtn">Add new item</button>':''}${canAdmin()?`<button class="btn ghost" id="toggleArchivedBtn">${S.showArchived?'Active items':'Archived items'}</button><button class="btn ghost" id="manageCategoriesBtn">Categories</button>`:''}</div>
      <div id="itemCount" class="muted" style="margin-bottom:.6rem">${filtered.length} item${filtered.length===1?'':'s'}</div>
      <div id="itemList" class="item-list">${filtered.map(itemRowHtml).join('') || '<div class="card">No matching items.</div>'}</div>`;
  }

  function refreshItemSearchResults() {
    const filtered=filteredItems();
    const count=document.getElementById('itemCount'), list=document.getElementById('itemList');
    if(count) count.textContent=`${filtered.length} item${filtered.length===1?'':'s'}`;
    if(list) {
      list.innerHTML=filtered.map(itemRowHtml).join('') || '<div class="card">No matching items.</div>';
      list.querySelectorAll('[data-item]').forEach(el=>el.onclick=()=>openItem(el.dataset.item));
      hydrateItemThumbnails(list);
    }
  }

  function locationsHtml() {
    const positive=S.balances.filter(b=>num(b.quantity)>0);
    const names=locationNames();
    const overall=positive.reduce((a,b)=>a+num(b.quantity),0);
    const locCards=names.map(name=>{
      const ids=new Set(positionsForLocation(name).map(l=>l.id));
      const balances=positive.filter(b=>ids.has(b.location_id));
      const units=balances.reduce((a,b)=>a+num(b.quantity),0);
      const items=new Set(balances.map(b=>b.item_id));
      const controlled=controlledBinSummary(name);
      return `<div class="card"><div class="muted">Location</div><div class="item-title" style="margin:.2rem 0 .45rem">${esc(name)}</div><div class="stat">${qty(units)}</div><div class="muted">${items.size} item${items.size===1?'':'s'} · total units</div>${controlled?`<div class="badge good" style="margin-top:.55rem">${esc(controlled)}</div>`:''}${canManage()?`<div class="actions"><button class="btn ghost" data-rename-location="${esc(name)}">Rename</button><button class="btn danger" data-delete-location="${esc(name)}">Delete</button></div>`:''}</div>`;
    }).join('');
    return `<div class="toolbar">${canManage()?'<button class="btn" id="addLocationBtn">Add location</button>':''}</div>
      <div class="card"><h2>Locations</h2><p class="muted">Workshop main store and Workbench cupboard now use controlled bin dropdowns. Other locations keep the flexible manual Bin Ref option.</p><div class="meta"><span>Workshop main store: Bin 1–Bin 50</span><span>Workbench cupboard: C1–C15</span></div></div>
      <div class="grid cards" style="margin-top:1rem"><div class="card"><div class="muted">Overall stock</div><div class="stat">${qty(overall)}</div></div>${locCards||'<div class="card">No active locations yet.</div>'}</div>`;
  }

  function completedMonthWindows(count=3) {
    const now=new Date();
    const out=[];
    for(let back=count;back>=1;back--){
      const start=new Date(now.getFullYear(),now.getMonth()-back,1);
      const end=new Date(now.getFullYear(),now.getMonth()-back+1,1);
      out.push({
        start,end,
        label:start.toLocaleDateString(undefined,{month:'short',year:'numeric'})
      });
    }
    return out;
  }

  function suggestedOrderRows() {
    const months=completedMonthWindows(3);
    return S.items.filter(i=>i.active).map(i=>{
      const monthly=months.map(w=>S.transactions
        .filter(t=>countsAsUsage(t)&&t.item_id===i.id&&new Date(t.occurred_at)>=w.start&&new Date(t.occurred_at)<w.end)
        .reduce((a,t)=>a+num(t.quantity),0));
      const used3=monthly.reduce((a,v)=>a+v,0);
      const avg=used3/3;
      const current=itemTotal(i.id);
      const onOrder=itemOnOrder(i.id);
      const suggested=Math.max(0,Math.ceil(Math.max(0,avg-current-onOrder)-1e-9));
      const coverage=avg>0?(current+onOrder)/avg:null;
      return {item:i,monthly,used3,avg,current,onOrder,suggested,coverage,supplier:preferredSupplier(i.id)};
    }).sort((a,b)=>b.suggested-a.suggested||b.avg-a.avg||a.item.name.localeCompare(b.item.name));
  }

  function orderStatusLabel(v) {
    return ({OPEN:'On order',PART_RECEIVED:'Part received',COMPLETED:'Completed',CANCELLED:'Cancelled'})[v] || v;
  }

  function purchaseOrderCard(o) {
    const item=byId(S.items,o.item_id);
    const remaining=orderRemaining(o);
    const received=num(o.quantity_received);
    const statusClass=o.status==='PART_RECEIVED'?'warn':o.status==='COMPLETED'?'good':o.status==='CANCELLED'?'muted':'order';
    const expected=o.expected_date?fmtShortDate(o.expected_date):'—';
    return `<div class="card order-card">
      <div class="order-card-head"><div><div class="item-title">${esc(item?.name||'Unknown item')}</div><div class="muted">${esc(o.supplier_name||'Supplier not set')}${o.supplier_ref?` · Ref ${esc(o.supplier_ref)}`:''}</div></div><span class="badge ${statusClass}">${esc(orderStatusLabel(o.status))}</span></div>
      <div class="order-metrics">
        <div><span>Ordered</span><strong>${qty(o.quantity_ordered)}</strong></div>
        <div><span>Received</span><strong>${qty(received)}</strong></div>
        <div><span>Still on order</span><strong>${qty(remaining)}</strong></div>
      </div>
      <div class="muted">Order ref: ${esc(o.order_reference||'—')} · Ordered ${fmtShortDate(o.ordered_at)} · Expected ${expected}</div>
      ${o.notes?`<div class="muted" style="margin-top:.35rem">${esc(o.notes)}</div>`:''}
      <div class="actions">
        ${['OPEN','PART_RECEIVED'].includes(o.status)?`<button class="btn good" data-receive-order="${o.id}">Receive delivery</button>`:''}
        ${canManage()&&['OPEN','PART_RECEIVED'].includes(o.status)?`<button class="btn ghost" data-edit-order="${o.id}">Edit order</button><button class="btn danger" data-cancel-order="${o.id}">Close / cancel</button>`:''}
        <button class="btn ghost" data-item="${o.item_id}">Open item</button>
      </div>
    </div>`;
  }

  function ordersHtml() {
    const months=completedMonthWindows(3);
    const all=suggestedOrderRows();
    const needs=all.filter(r=>r.suggested>0);
    const totalSuggested=needs.reduce((a,r)=>a+r.suggested,0);
    const outstanding=S.purchaseOrders.filter(o=>['OPEN','PART_RECEIVED'].includes(o.status));
    const outstandingUnits=outstanding.reduce((a,o)=>a+orderRemaining(o),0);
    const history=S.purchaseOrders.filter(o=>['COMPLETED','CANCELLED'].includes(o.status));

    const tabs=`<div class="order-tabs">
      <button class="${S.orderTab==='suggested'?'active':''}" data-order-tab="suggested">Suggested</button>
      <button class="${S.orderTab==='open'?'active':''}" data-order-tab="open">On Order <span class="count">${outstanding.length}</span></button>
      <button class="${S.orderTab==='history'?'active':''}" data-order-tab="history">History</button>
    </div>`;

    if(S.orderTab==='open') {
      return `<div class="card"><h2>Orders</h2><p class="muted">Everyone can see what has been ordered. Any active user can receive a delivery; only admins/managers can create, edit or close orders.</p>${tabs}</div>
        <div class="grid cards" style="margin-top:1rem"><div class="card"><div class="muted">Open orders</div><div class="stat">${outstanding.length}</div></div><div class="card"><div class="muted">Units still on order</div><div class="stat">${qty(outstandingUnits)}</div></div></div>
        <div class="order-list" style="margin-top:1rem">${outstanding.map(purchaseOrderCard).join('')||'<div class="card">Nothing is currently on order.</div>'}</div>`;
    }

    if(S.orderTab==='history') {
      const rows=history.map(o=>`<tr><td>${fmtShortDate(o.ordered_at)}</td><td>${esc(itemName(o.item_id))}</td><td>${esc(o.supplier_name||'—')}</td><td>${qty(o.quantity_ordered)}</td><td>${qty(o.quantity_received)}</td><td>${esc(orderStatusLabel(o.status))}</td><td>${esc(o.order_reference||'—')}</td></tr>`).join('');
      return `<div class="card"><h2>Orders</h2>${tabs}</div>
        <div class="card" style="margin-top:1rem"><h3>Completed / closed orders</h3><div class="table-wrap"><table><thead><tr><th>Ordered</th><th>Item</th><th>Supplier</th><th>Ordered qty</th><th>Received qty</th><th>Status</th><th>Order ref</th></tr></thead><tbody>${rows||'<tr><td colspan="7">No completed or cancelled orders yet.</td></tr>'}</tbody></table></div></div>`;
    }

    const rows=all.map(r=>`<tr class="${r.suggested>0?'order-needed':'order-ok'}">
      <td data-item="${r.item.id}">${esc(r.item.name)}</td>
      <td>${qty(r.monthly[0])}</td><td>${qty(r.monthly[1])}</td><td>${qty(r.monthly[2])}</td>
      <td>${qty(r.avg)}</td><td>${qty(r.current)}</td><td>${r.onOrder>0?`<strong>${qty(r.onOrder)}</strong>`:'—'}</td>
      <td><strong>${r.suggested>0?qty(r.suggested):'—'}</strong></td>
      <td>${esc(r.supplier?.supplier_name||'—')}</td>
      <td>${canManage()&&r.suggested>0?`<button class="btn small" data-create-order="${r.item.id}">Add to order</button>`:'—'}</td>
    </tr>`).join('');

    return `<div class="card"><h2>Orders</h2>
      <p class="muted">Suggested quantities use actual <strong>USE</strong> transactions from the previous 3 completed months. Existing stock and anything already <strong>On Order</strong> are subtracted so the same item is not ordered twice.</p>
      ${tabs}
      <div class="actions"><button class="btn secondary" id="exportOrdersCsv">Download CSV</button><button class="btn" id="exportOrdersExcel">Download Excel</button></div>
    </div>
    <div class="grid cards" style="margin-top:1rem"><div class="card"><div class="muted">Items needing order</div><div class="stat">${needs.length}</div></div><div class="card"><div class="muted">Suggested units</div><div class="stat">${qty(totalSuggested)}</div></div><div class="card"><div class="muted">Already on order</div><div class="stat">${qty(outstandingUnits)}</div></div><div class="card"><div class="muted">Usage period</div><div style="font-weight:800;margin-top:.45rem">${esc(months.map(m=>m.label).join(' · '))}</div></div></div>
    <div class="card" style="margin-top:1rem"><h3>Suggested orders</h3><p class="muted">Tap an item to open it. Admins/managers can turn a suggestion into an open order.</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>${esc(months[0].label)}</th><th>${esc(months[1].label)}</th><th>${esc(months[2].label)}</th><th>Avg / month</th><th>In stock</th><th>On order</th><th>Suggested</th><th>Supplier</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="10">No active items.</td></tr>'}</tbody></table></div></div>`;
  }

  function reportTransactions() {
    const r=S.report;
    let list=S.transactions.filter(countsAsUsage);
    if(r.period==='month') { const from=new Date(monthStartISO()+'T00:00:00'); list=list.filter(t=>new Date(t.occurred_at)>=from); }
    if(r.period==='custom') {
      if(r.from) { const from=new Date(r.from+'T00:00:00'); list=list.filter(t=>new Date(t.occurred_at)>=from); }
      if(r.to) { const to=new Date(r.to+'T23:59:59'); list=list.filter(t=>new Date(t.occurred_at)<=to); }
    }
    if(r.item) list=list.filter(t=>t.item_id===r.item);
    if(r.user) list=list.filter(t=>(t.user_id||'legacy')===r.user);
    if(r.location) list=list.filter(t=>locationNameForId(t.from_location_id)===r.location);
    if(r.bin) list=list.filter(t=>binRefForId(t.from_location_id).toLowerCase()===r.bin.trim().toLowerCase());
    return list;
  }

  function activityTransactions() {
    const r=S.report;
    let list=[...S.transactions];
    if(r.period==='month') { const from=new Date(monthStartISO()+'T00:00:00'); list=list.filter(t=>new Date(t.occurred_at)>=from); }
    if(r.period==='custom') {
      if(r.from) { const from=new Date(r.from+'T00:00:00'); list=list.filter(t=>new Date(t.occurred_at)>=from); }
      if(r.to) { const to=new Date(r.to+'T23:59:59'); list=list.filter(t=>new Date(t.occurred_at)<=to); }
    }
    if(r.item) list=list.filter(t=>t.item_id===r.item);
    if(r.user) list=list.filter(t=>(t.user_id||'legacy')===r.user);
    if(r.location) list=list.filter(t=>[t.from_location_id,t.to_location_id].some(id=>locationNameForId(id)===r.location));
    if(r.bin) list=list.filter(t=>[t.from_location_id,t.to_location_id].some(id=>binRefForId(id).toLowerCase()===r.bin.trim().toLowerCase()));
    return list;
  }

  function reportsHtml() {
    const list=reportTransactions();
    const activity=activityTransactions();
    const totals=new Map();
    list.forEach(t=>totals.set(t.item_id,(totals.get(t.item_id)||0)+num(t.quantity)));
    const summary=[...totals.entries()].map(([id,q])=>({id,q,name:itemName(id)})).sort((a,b)=>b.q-a.q);
    const totalUsage=list.reduce((a,t)=>a+num(t.quantity),0);
    const reportName=S.report.period==='month'?'This month':S.report.period==='all'?'All time':'Custom dates';

    const userActivity=new Map();
    for(const t of activity){
      const key=t.user_id||'legacy';
      if(!userActivity.has(key))userActivity.set(key,{ADD:0,USE:0,MOVE:0,ADJUST:0,count:0});
      const g=userActivity.get(key);g[t.transaction_type]=(g[t.transaction_type]||0)+num(t.quantity);g.count++;
    }
    const activityRows=[...userActivity.entries()].map(([id,g])=>`<tr><td>${esc(id==='legacy'?'Legacy import':userName(id))}</td><td>${qty(g.ADD)}</td><td>${qty(g.USE)}</td><td>${qty(g.MOVE)}</td><td>${qty(g.ADJUST)}</td><td>${g.count}</td></tr>`).join('');

    return `<div class="card"><h2>Usage & activity reports</h2>
      <div class="form-grid">
        <div><label>Period</label><select id="reportPeriod"><option value="month" ${S.report.period==='month'?'selected':''}>This month</option><option value="all" ${S.report.period==='all'?'selected':''}>All time</option><option value="custom" ${S.report.period==='custom'?'selected':''}>Custom dates</option></select></div>
        <div><label>Item</label><select id="reportItem"><option value="">All items</option>${S.items.filter(i=>i.active).map(i=>`<option value="${i.id}" ${S.report.item===i.id?'selected':''}>${esc(i.name)}</option>`).join('')}</select></div>
        <div><label>User</label><select id="reportUser"><option value="">All users</option><option value="legacy" ${S.report.user==='legacy'?'selected':''}>Legacy import</option>${S.profiles.map(p=>`<option value="${p.id}" ${S.report.user===p.id?'selected':''}>${esc(p.display_name)}</option>`).join('')}</select></div>
        <div><label>Location</label><select id="reportLocation"><option value="">All locations</option>${locationNames().map(name=>`<option value="${esc(name)}" ${S.report.location===name?'selected':''}>${esc(name)}</option>`).join('')}</select></div>
        <div><label>Bin Ref (optional)</label><input id="reportBin" value="${esc(S.report.bin)}" placeholder="e.g. B12"></div>
        <div class="customDates ${S.report.period==='custom'?'':'hidden'}"><label>From</label><input type="date" id="reportFrom" value="${esc(S.report.from)}"></div>
        <div class="customDates ${S.report.period==='custom'?'':'hidden'}"><label>To</label><input type="date" id="reportTo" value="${esc(S.report.to)}"></div>
      </div>
      <div class="actions"><button class="btn secondary" id="exportReport">Usage CSV</button><button class="btn" id="exportReportExcel">Usage Excel</button><button class="btn ghost" id="exportActivity">Activity CSV</button><button class="btn ghost" id="exportActivityExcel">Activity Excel</button></div>
    </div>
    <div class="grid cards" style="margin-top:1rem"><div class="card"><div class="muted">${esc(reportName)} usage</div><div class="stat">${qty(totalUsage)}</div></div><div class="card"><div class="muted">Usage transactions</div><div class="stat">${list.length}</div></div><div class="card"><div class="muted">Different items used</div><div class="stat">${summary.length}</div></div><div class="card"><div class="muted">All stock actions</div><div class="stat">${activity.length}</div></div></div>
    <div class="split" style="margin-top:1rem"><div class="card"><h3>Usage by item</h3><div class="table-wrap"><table><thead><tr><th>Item</th><th>Used</th></tr></thead><tbody>${summary.map(x=>`<tr data-item="${x.id}"><td>${esc(x.name)}</td><td>${qty(x.q)}</td></tr>`).join('')||'<tr><td colspan="2">No usage in this period.</td></tr>'}</tbody></table></div></div><div class="card"><h3>12-month usage trend</h3><p class="muted">Choose an item in the filter to analyse whether usage is increasing or decreasing.</p><canvas id="trendChart" height="250"></canvas></div></div>
    <div class="card" style="margin-top:1rem"><h3>Who added, used, moved or adjusted stock</h3><div class="table-wrap"><table><thead><tr><th>User</th><th>Added</th><th>Used</th><th>Moved</th><th>Adjusted</th><th>Actions</th></tr></thead><tbody>${activityRows||'<tr><td colspan="6">No activity in this period.</td></tr>'}</tbody></table></div></div>
    <div class="card" style="margin-top:1rem"><h3>Detailed usage</h3>${transactionTable(list)}</div>`;
  }

  function historyHtml() {
    return `<div class="card"><h2>Full audit history</h2><p class="muted">Adds, uses, moves and adjustments are all recorded with the user and location.</p>${transactionTable(S.transactions)}</div>`;
  }

  function transactionTable(list) {
    const rows=list.slice(0,500).map(t=>`<tr><td>${fmtDate(t.occurred_at)}</td><td>${esc(itemName(t.item_id))}</td><td><span class="badge">${esc(t.transaction_type)}</span></td><td>${qty(t.quantity)}</td><td>${esc(userName(t.user_id))}</td><td>${esc(locName(t.from_location_id))}</td><td>${esc(locName(t.to_location_id))}</td><td>${esc(t.reason||t.notes||'—')}</td></tr>`).join('');
    return `<div class="table-wrap"><table><thead><tr><th>Date/time</th><th>Item</th><th>Action</th><th>Qty</th><th>User</th><th>From</th><th>To</th><th>Reason / note</th></tr></thead><tbody>${rows||'<tr><td colspan="8">No transactions yet.</td></tr>'}</tbody></table></div>${list.length>500?'<p class="muted">Showing the newest 500 rows.</p>':''}`;
  }

  function usersHtml() {
    if(!canAdmin()) return '<div class="notice error">Admin access required.</div>';
    const rows=S.profiles.map(p=>{
      const access=p.id===S.profile.id
        ? ''
        : p.active===false
          ? `<button class="btn good small" data-user-enable="${p.id}">Re-enable</button>`
          : `<button class="btn danger small" data-user-disable="${p.id}">Disable</button>`;
      return `<tr><td>${esc(p.display_name)}<div class="muted">${esc(p.email||'')}</div></td><td>${esc(roleLabel(p.role))}</td><td>${p.active===false?'<span class="badge muted">Disabled</span>':'<span class="badge good">Active</span>'}</td><td><select data-role-user="${p.id}" ${p.id===S.profile.id?'disabled':''}><option value="staff" ${p.role==='staff'?'selected':''}>User</option><option value="manager" ${p.role==='manager'?'selected':''}>Manager</option><option value="admin" ${p.role==='admin'?'selected':''}>Admin</option></select></td><td><div class="actions user-actions">${access}<button class="btn ghost small" data-user-email="${p.id}">Change email</button></div></td></tr>`;
    }).join('');
    return `<div class="split"><div class="card"><h2>Users</h2><p class="muted">Correct a registered email without deleting the account. Password, role and stock history are preserved. Disable users instead of deleting them when they leave.</p><div class="table-wrap"><table><thead><tr><th>Name / email</th><th>Role</th><th>Status</th><th>Change role</th><th>Account</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="card"><h2>Invite user</h2><p class="muted">The invited person receives an email and must set their own password before entering the tracker. The v7.4.1 invite-user Edge Function must be deployed in Supabase.</p><form id="inviteForm"><label>Name</label><input id="inviteName" required><label>Email</label><input id="inviteEmail" type="email" required><label>Role</label><select id="inviteRole"><option value="staff">User</option><option value="manager">Manager</option><option value="admin">Admin</option></select><div class="actions"><button class="btn" type="submit">Send invite</button></div></form></div></div>`;
  }


  async function hydrateItemThumbnails(root=document) {
    if(S.offline||!navigator.onLine)return;
    const imgs=[...root.querySelectorAll?.('img.item-thumb[data-photo-path]')||[]].filter(x=>!x.getAttribute('src'));
    if(!imgs.length) return;
    const paths=[...new Set(imgs.map(x=>x.dataset.photoPath).filter(Boolean))];
    try{
      const {data,error}=await sb.storage.from('item-photos').createSignedUrls(paths,900);
      if(error) return;
      const map=new Map((data||[]).map(x=>[x.path,x.signedUrl]));
      imgs.forEach(img=>{const u=map.get(img.dataset.photoPath);if(u)img.src=u;});
    }catch(_){}
  }

  async function touchRecentItem(itemId) {
    if(!S.profile?.id) return;
    const now=new Date().toISOString();
    const current=itemPref(itemId);
    let error;
    if(current){
      ({error}=await sb.from('user_item_preferences').update({last_viewed_at:now,view_count:num(current.view_count)+1}).eq('user_id',S.profile.id).eq('item_id',itemId));
      current.last_viewed_at=now; current.view_count=num(current.view_count)+1;
    }else{
      const row={user_id:S.profile.id,item_id:itemId,favourite:false,last_viewed_at:now,view_count:1};
      ({error}=await sb.from('user_item_preferences').insert(row));
      if(!error)S.userPrefs.push(row);
    }
    if(error) console.warn('Recent item update failed',error);
  }

  async function toggleFavourite(itemId) {
    const current=itemPref(itemId);
    const value=!current?.favourite;
    const now=new Date().toISOString();
    let error;
    if(current){({error}=await sb.from('user_item_preferences').update({favourite:value,last_viewed_at:now}).eq('user_id',S.profile.id).eq('item_id',itemId));}
    else {({error}=await sb.from('user_item_preferences').insert({user_id:S.profile.id,item_id:itemId,favourite:value,last_viewed_at:now,view_count:1}));}
    if(error){setNotice(parseError(error),'error');render();return;}
    await loadData({transactions:false});
    openItem(itemId);
  }

  function companyPopularItems(limit=6) {
    const totals=new Map();
    S.transactions.filter(countsAsUsage).forEach(t=>totals.set(t.item_id,(totals.get(t.item_id)||0)+num(t.quantity)));
    return [...totals.entries()].map(([id,q])=>({item:byId(S.items,id),q})).filter(x=>x.item?.active).sort((a,b)=>b.q-a.q).slice(0,limit);
  }

  function dashboardPersonalHtml() {
    if(!S.profile) return '';
    const fav=S.userPrefs.filter(x=>x.user_id===S.profile.id&&x.favourite).map(x=>byId(S.items,x.item_id)).filter(i=>i?.active).slice(0,6);
    const recent=S.userPrefs.filter(x=>x.user_id===S.profile.id&&x.last_viewed_at).sort((a,b)=>new Date(b.last_viewed_at)-new Date(a.last_viewed_at)).map(x=>byId(S.items,x.item_id)).filter(i=>i?.active&&!fav.some(f=>f.id===i.id)).slice(0,6);
    const popular=companyPopularItems(6);
    const cards=(items,metric='')=>items.length?`<div class="quick-grid">${items.map(x=>{const i=x.item||x;return `<button class="quick-item" data-item="${i.id}">${i.primary_photo_path?`<img class="item-thumb" data-photo-path="${esc(i.primary_photo_path)}" alt="">`:''}<span><strong>${esc(i.name)}</strong><small>${metric&&x.q!=null?`${qty(x.q)} used overall · `:''}${qty(itemTotal(i.id))} in stock</small></span></button>`;}).join('')}</div>`:'<p class="muted">Nothing here yet.</p>';
    return `<div class="personal-grid" style="margin-top:1rem"><div class="card"><h3>My Favourites</h3>${cards(fav)}</div><div class="card"><h3>My Recent Items</h3>${cards(recent)}</div><div class="card"><h3>Company Popular</h3>${cards(popular,'used')}</div></div>`;
  }

  async function archiveItem(item) {
    if(!canAdmin())return;
    const stock=itemTotal(item.id);
    const reason=prompt(`Archive ${item.name}?${stock>0?` WARNING: ${qty(stock)} units are still in stock.`:''}\n\nOptional reason:`, 'No longer stocked');
    if(reason===null)return;
    const {error}=await sb.from('items').update({active:false,archived_at:new Date().toISOString(),archived_by:S.profile.id,archive_reason:reason||null,updated_at:new Date().toISOString()}).eq('id',item.id);
    if(error){setNotice(parseError(error),'error');render();return;}
    await loadData();closeModal();setNotice('Item archived. History has been kept.');render();
  }

  async function restoreItem(item) {
    if(!canAdmin())return;
    const {error}=await sb.from('items').update({active:true,archived_at:null,archived_by:null,archive_reason:null,updated_at:new Date().toISOString()}).eq('id',item.id);
    if(error){setNotice(parseError(error),'error');render();return;}
    await loadData();closeModal();setNotice('Item restored.');render();
  }

  function assignedOpenStocktake() {
    return S.stocktakeTasks.find(t=>t.assigned_user_id===S.profile?.id&&['OPEN','OVERDUE'].includes(t.status)) || null;
  }
  function stocktakeItemsFor(taskId){return S.stocktakeItems.filter(x=>x.task_id===taskId);}

  function stocktakeHtml() {
    const task=assignedOpenStocktake();
    const myHistory=S.stocktakeTasks.filter(t=>t.assigned_user_id===S.profile?.id&&t.status==='COMPLETED').slice(0,10);
    const taskBlock=task?`<div class="card"><h2>${task.status==='OVERDUE'?'Overdue':'Assigned'} stocktake</h2><p class="muted">Due ${fmtDate(task.due_at)}. Count the actual quantity in each location/bin. Differences create audited stock adjustments when you complete the task.</p><div class="table-wrap"><table><thead><tr><th>Item</th><th>Location / Bin</th><th>Expected</th><th>Counted</th></tr></thead><tbody>${stocktakeItemsFor(task.id).map(x=>`<tr><td>${esc(itemName(x.item_id))}</td><td>${esc(locName(x.location_id))}</td><td>${qty(x.expected_quantity)}</td><td><input class="stocktake-count" data-stocktake-item="${x.id}" type="number" inputmode="decimal" min="0" step="0.01" value="${x.counted_quantity??''}" placeholder="Count"></td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="btn good" id="completeStocktake">Complete stocktake</button></div></div>`:`<div class="card"><h2>Stocktake</h2><p>No stocktake is currently assigned to you.</p><p class="muted">The tracker creates the next random task automatically when the configured interval is due.</p></div>`;
    const admin=canAdmin()?`<div class="card" style="margin-top:1rem"><h3>Admin stocktake settings</h3><form id="stocktakeSettingsForm" class="form-grid"><div><label>Enabled</label><select id="stocktakeEnabled"><option value="true" ${S.stocktakeSettings?.enabled!==false?'selected':''}>Yes</option><option value="false" ${S.stocktakeSettings?.enabled===false?'selected':''}>No</option></select></div><div><label>Interval (days)</label><input id="stocktakeInterval" type="number" min="1" max="365" value="${S.stocktakeSettings?.interval_days||14}"></div><div><label>Items per task</label><input id="stocktakeCount" type="number" min="1" max="100" value="${S.stocktakeSettings?.item_count||12}"></div><div><label>Due within (days)</label><input id="stocktakeDueDays" type="number" min="1" max="60" value="${S.stocktakeSettings?.due_days||7}"></div><div class="full"><div class="muted">Next automatic task: ${fmtDate(S.stocktakeSettings?.next_task_at)}</div><div class="actions"><button class="btn" type="submit">Save stocktake settings</button><button class="btn ghost" type="button" id="generateStocktakeNow">Create next stocktake now</button></div></div></form><h3>Open / overdue tasks</h3>${S.stocktakeTasks.filter(t=>['OPEN','OVERDUE'].includes(t.status)).map(t=>`<div class="item-row"><div><strong>${esc(userName(t.assigned_user_id))}</strong><div class="muted">${stocktakeItemsFor(t.id).length} items · due ${fmtShortDate(t.due_at)} · ${esc(t.status)}</div></div><div><select data-reassign-task="${t.id}">${S.profiles.filter(p=>p.active!==false).map(p=>`<option value="${p.id}" ${p.id===t.assigned_user_id?'selected':''}>${esc(p.display_name)}</option>`).join('')}</select></div></div>`).join('')||'<p class="muted">No open tasks.</p>'}</div>`:'';
    return `${taskBlock}<div class="card" style="margin-top:1rem"><h3>My completed stocktakes</h3>${myHistory.length?myHistory.map(t=>`<div class="muted">${fmtDate(t.completed_at)} · ${stocktakeItemsFor(t.id).length} items</div>`).join(''):'<p class="muted">No completed stocktakes yet.</p>'}</div>${admin}`;
  }

  function bindStocktake() {
    const complete=document.getElementById('completeStocktake');
    if(complete) complete.onclick=async()=>{
      const task=assignedOpenStocktake(); if(!task)return;
      const rows=stocktakeItemsFor(task.id);
      const values=new Map([...document.querySelectorAll('[data-stocktake-item]')].map(x=>[x.dataset.stocktakeItem,x.value]));
      if(rows.some(r=>values.get(r.id)==='')){setNotice('Enter a counted quantity for every stocktake item.','error');render();return;}
      complete.disabled=true;
      try{
        for(const row of rows){
          const counted=num(values.get(row.id));
          const current=num(S.balances.find(b=>b.item_id===row.item_id&&b.location_id===row.location_id)?.quantity);
          let txId=null;
          if(Math.abs(counted-current)>1e-9){
            const {data,error}=await sb.rpc('apply_stock_transaction',{p_item_id:row.item_id,p_type:'ADJUST',p_quantity:0,p_from_location_id:row.location_id,p_to_location_id:null,p_new_quantity:counted,p_reason:'Stocktake correction',p_reference:task.id,p_notes:'Random scheduled stocktake'});
            if(error)throw error; txId=data;
          }
          const {error}=await sb.from('stocktake_task_items').update({counted_quantity:counted,discrepancy:counted-num(row.expected_quantity),adjusted_transaction_id:txId,completed_at:new Date().toISOString()}).eq('id',row.id);
          if(error)throw error;
        }
        const {error}=await sb.from('stocktake_tasks').update({status:'COMPLETED',completed_at:new Date().toISOString(),completed_by:S.profile.id}).eq('id',task.id);
        if(error)throw error;
        await loadData();setNotice('Stocktake completed. Any differences were recorded as audited adjustments.');render();
      }catch(e){setNotice(parseError(e),'error');render();}
    };
    document.querySelectorAll('[data-reassign-task]').forEach(sel=>sel.onchange=async()=>{
      const {error}=await sb.from('stocktake_tasks').update({assigned_user_id:sel.value}).eq('id',sel.dataset.reassignTask);
      if(error){setNotice(parseError(error),'error');render();return;}await loadData({transactions:false});setNotice('Stocktake reassigned.');render();
    });
    const settings=document.getElementById('stocktakeSettingsForm'); if(settings)settings.onsubmit=async e=>{
      e.preventDefault();const row={enabled:document.getElementById('stocktakeEnabled').value==='true',interval_days:Math.round(num(document.getElementById('stocktakeInterval').value)),item_count:Math.round(num(document.getElementById('stocktakeCount').value)),due_days:Math.round(num(document.getElementById('stocktakeDueDays').value)),updated_at:new Date().toISOString()};
      const {error}=await sb.from('stocktake_settings').update(row).eq('singleton',true);if(error){setNotice(parseError(error),'error');render();return;}await loadData({transactions:false});setNotice('Stocktake settings saved.');render();
    };
    const generate=document.getElementById('generateStocktakeNow'); if(generate)generate.onclick=async()=>{
      try{let {error}=await sb.from('stocktake_settings').update({next_task_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('singleton',true);if(error)throw error;({error}=await sb.rpc('ensure_stocktake_task',{p_force:true}));if(error)throw error;await loadData({transactions:false});setNotice('Stocktake task created if no other task is open.');render();}catch(e){setNotice(parseError(e),'error');render();}
    };
  }

  function legacyFilteredRows() {
    let rows=S.transactions.filter(t=>t.legacy_import);
    if(S.legacyItemFilter)rows=rows.filter(t=>t.item_id===S.legacyItemFilter);
    if(S.legacyFrom)rows=rows.filter(t=>new Date(t.occurred_at)>=new Date(S.legacyFrom+'T00:00:00'));
    if(S.legacyTo)rows=rows.filter(t=>new Date(t.occurred_at)<=new Date(S.legacyTo+'T23:59:59'));
    return rows;
  }

  function legacyReviewHtml() {
    if(!canAdmin())return '<div class="notice error">Admin access required.</div>';
    const rows=legacyFilteredRows();
    const included=rows.filter(countsAsUsage).reduce((a,t)=>a+num(t.quantity),0);
    return `<div class="card"><h2>Legacy Review</h2><p class="muted">Reclassify old InStock decreases without changing the historic stock balances. Only records classified as <strong>Use</strong> count toward usage trends and Suggested Orders.</p><div class="form-grid"><div><label>Item</label><select id="legacyItem"><option value="">All legacy items</option>${S.items.map(i=>`<option value="${i.id}" ${S.legacyItemFilter===i.id?'selected':''}>${esc(i.name)}</option>`).join('')}</select></div><div><label>From</label><input id="legacyFrom" type="date" value="${esc(S.legacyFrom)}"></div><div><label>To</label><input id="legacyTo" type="date" value="${esc(S.legacyTo)}"></div></div><div class="notice">Filtered records: ${rows.length} · Currently counted as usage: ${qty(included)}</div><div class="toolbar"><select id="legacyClassification"><option value="USE">Use / consumption</option><option value="ADJUSTMENT">Stock adjustment</option><option value="DAMAGE_LOSS">Damage / loss</option><option value="TRANSFER">Transfer / move</option><option value="EXCLUDE">Exclude from usage</option></select><button class="btn" id="applyLegacyReview">Apply to selected</button></div></div><div class="card" style="margin-top:1rem"><div class="table-wrap"><table><thead><tr><th><input id="legacySelectAll" type="checkbox"></th><th>Date</th><th>Item</th><th>Qty</th><th>Current treatment</th><th>Reviewed by</th></tr></thead><tbody>${rows.slice(0,300).map(t=>`<tr><td><input type="checkbox" data-legacy-row="${t.id}"></td><td>${fmtDate(t.occurred_at)}</td><td>${esc(itemName(t.item_id))}</td><td>${qty(t.quantity)}</td><td>${esc(t.legacy_classification||'Use (unreviewed)')}${t.exclude_from_usage?' · Excluded':''}</td><td>${t.legacy_reviewed_by?esc(userName(t.legacy_reviewed_by)):'—'}</td></tr>`).join('')||'<tr><td colspan="6">No matching legacy records.</td></tr>'}</tbody></table></div>${rows.length>300?'<p class="muted">Showing newest 300 filtered records. Narrow the filters to review older records.</p>':''}</div>`;
  }

  function bindLegacyReview() {
    const item=document.getElementById('legacyItem'); if(item)item.onchange=()=>{S.legacyItemFilter=item.value;render();};
    const from=document.getElementById('legacyFrom'); if(from)from.onchange=()=>{S.legacyFrom=from.value;render();};
    const to=document.getElementById('legacyTo'); if(to)to.onchange=()=>{S.legacyTo=to.value;render();};
    const all=document.getElementById('legacySelectAll'); if(all)all.onchange=()=>document.querySelectorAll('[data-legacy-row]').forEach(x=>x.checked=all.checked);
    const apply=document.getElementById('applyLegacyReview'); if(apply)apply.onclick=async()=>{
      const ids=[...document.querySelectorAll('[data-legacy-row]:checked')].map(x=>x.dataset.legacyRow);if(!ids.length){setNotice('Select at least one legacy record.','error');render();return;}
      const classification=document.getElementById('legacyClassification').value;
      const {data,error}=await sb.rpc('review_legacy_transactions',{p_ids:ids,p_classification:classification});
      if(error){setNotice(parseError(error),'error');render();return;}await loadData();setNotice(`${data||ids.length} legacy record(s) reviewed.`);render();
    };
  }








  function backupHtml() {
    if(!canAdmin()) return '<div class="notice error">Admin access required.</div>';
    const last=lastBackupAt();
    const status=S.backupStatus
      ? `<div class="notice ${S.backupRunning?'':'success'}">${esc(S.backupStatus)}</div>`
      : '';
    return `<div class="card">
      <h2>Admin backup</h2>
      <p class="muted">Creates a dated ZIP backup on this device. It includes the inventory database records and, by default, uploaded item photos.</p>
      <div class="notice"><strong>Not included:</strong> user passwords, Supabase database password, publishable/secret keys, or authentication secrets.</div>
      <div class="grid cards" style="margin-top:1rem">
        <div class="card"><div class="muted">Last backup on this device</div><div>${last?esc(fmtDate(last)):'Never'}</div></div>
        <div class="card"><div class="muted">Reminder</div><div>${backupDue()?'Backup due':'Up to date'}</div></div>
      </div>
      <label class="ack-check" style="margin-top:1rem"><input id="backupFiles" type="checkbox" checked> Include item photos</label>
      <div class="actions">
        <button class="btn good" id="backupNow" ${S.backupRunning?'disabled':''}>${S.backupRunning?'Creating backup…':'Back up now'}</button>
      </div>
      ${status}
      <p class="muted">Weekly is a sensible default for this tracker. The reminder is stored on the device that creates the backup.</p>
    </div>`;
  }

  const backupTables = [
    'items',
    'stock_locations',
    'stock_balances',
    'transactions',
    'profiles',
    'inventory_categories',
    'item_suppliers',
    'purchase_orders',
    'user_item_preferences',
    'stocktake_settings',
    'stocktake_tasks',
    'stocktake_task_items'
  ];

  function csvFromObjects(rows) {
    if(!rows?.length) return '\ufeff';
    const keys=[...new Set(rows.flatMap(r=>Object.keys(r||{})))];
    const quote=v=>{
      if(v===null||v===undefined) return '""';
      const x=typeof v==='object' ? JSON.stringify(v) : String(v);
      return `"${x.replace(/"/g,'""')}"`;
    };
    return '\ufeff'+[
      keys.map(quote).join(','),
      ...rows.map(r=>keys.map(k=>quote(r?.[k])).join(','))
    ].join('\n');
  }

  async function downloadStorageFile(bucket,path) {
    if(!path) return null;
    const {data,error}=await sb.storage.from(bucket).download(path);
    if(error) throw error;
    return data;
  }

  async function createAdminBackup(includeFiles=true) {
    if(!canAdmin()) throw new Error('Admin access required');
    if(!window.JSZip) throw new Error('Backup ZIP library did not load. Refresh while online and try again.');

    const zip=new JSZip();
    const dbFolder=zip.folder('database');
    const fileFolder=zip.folder('files');
    const manifest={
      backup_format:'inventory-tracker-backup-v1',
      created_at:new Date().toISOString(),
      created_by:{id:S.profile?.id||null,name:S.profile?.display_name||null,role:S.profile?.role||null},
      app_version:'7.3',
      project_url:cfg.supabaseUrl,
      tables:{},
      uploaded_files:{requested:!!includeFiles,downloaded:0,failed:[]}
    };

    for(let i=0;i<backupTables.length;i++){
      const table=backupTables[i];
      S.backupStatus=`Backing up database ${i+1}/${backupTables.length}: ${table}`;
      render();
      const rows=await fetchAll(table,'*');
      manifest.tables[table]=rows.length;
      dbFolder.file(`${table}.json`,JSON.stringify(rows,null,2));
      dbFolder.file(`${table}.csv`,csvFromObjects(rows));
    }

    if(includeFiles){
      const items=JSON.parse(await dbFolder.file('items.json').async('string'));
      const targets=[];
      const seen=new Set();

      for(const item of items){
        const path=String(item.primary_photo_path||'').trim();
        const key=`item-photos:${path}`;
        if(path && !seen.has(key)){
          seen.add(key);
          targets.push({bucket:'item-photos',path,folder:'item-photos'});
        }
      }

      for(let i=0;i<targets.length;i++){
        const t=targets[i];
        S.backupStatus=`Downloading uploaded files ${i+1}/${targets.length}`;
        render();
        try{
          const blob=await downloadStorageFile(t.bucket,t.path);
          fileFolder.folder(t.folder).file(t.path,blob);
          manifest.uploaded_files.downloaded++;
        }catch(e){
          manifest.uploaded_files.failed.push({
            bucket:t.bucket,
            path:t.path,
            error:parseError(e)
          });
        }
      }
    }

    zip.file('manifest.json',JSON.stringify(manifest,null,2));
    zip.file('README.txt',
`Inventory Tracker backup

Created: ${manifest.created_at}
Created by: ${manifest.created_by.name||'Unknown admin'}

This ZIP contains database exports in both JSON and CSV format.
Uploaded item photos are included when requested and accessible.

This backup does NOT contain passwords, Supabase secret keys, or database credentials.

Keep this file somewhere secure.
`);

    S.backupStatus='Creating ZIP file…';
    render();
    const blob=await zip.generateAsync({
      type:'blob',
      compression:'DEFLATE',
      compressionOptions:{level:6}
    });

    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const filename=`Inventory-Backup-${stamp}.zip`;
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);

    localStorage.setItem(backupStorageKey,new Date().toISOString());
    return {filename,manifest};
  }

  function bindBackup() {
    const btn=document.getElementById('backupNow');
    if(!btn) return;
    btn.onclick=async()=>{
      if(S.backupRunning) return;
      const includeFiles=document.getElementById('backupFiles')?.checked !== false;
      S.backupRunning=true;
      S.backupStatus='Starting backup…';
      render();
      try{
        const result=await createAdminBackup(includeFiles);
        S.backupStatus=`Backup downloaded: ${result.filename}${result.manifest.uploaded_files.failed.length?` · ${result.manifest.uploaded_files.failed.length} uploaded file(s) could not be downloaded and are listed in the manifest.`:''}`;
      }catch(e){
        S.backupStatus='';
        setNotice(`Backup failed: ${parseError(e)}`,'error');
      }finally{
        S.backupRunning=false;
        render();
      }
    };
  }

  function bindPage() {
    document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{S.page=b.dataset.go; render();});
    document.querySelectorAll('[data-item]').forEach(el=>el.onclick=()=>openItem(el.dataset.item));
    if(S.page==='dashboard') {
      const b=document.getElementById('dashAddItem'); if(b) b.onclick=openAddItem;
    }
    if(S.page==='scan') bindScan();
    if(S.page==='items') bindItems();
    if(S.page==='locations') bindLocations();
    if(S.page==='orders') bindOrders();
    if(S.page==='stocktake') bindStocktake();
    if(S.page==='reports') bindReports();
    if(S.page==='users') bindUsers();
    if(S.page==='legacy') bindLegacyReview();
    if(S.page==='backup') bindBackup();
    hydrateItemThumbnails(document);
  }

  function bindScan() {
    const find=()=>findScanned(document.getElementById('scanText').value.trim());
    document.getElementById('scanFind').onclick=find;
    document.getElementById('scanText').onkeydown=e=>{if(e.key==='Enter') find();};
    document.getElementById('stopScan').onclick=stopScanner;

    const smallBtn=document.getElementById('smallQrBtn');
    if(smallBtn) smallBtn.onclick=toggleSmallQrMode;
    const torchBtn=document.getElementById('torchBtn');
    if(torchBtn) torchBtn.onclick=toggleTorch;
    const refocusBtn=document.getElementById('refocusBtn');
    if(refocusBtn) refocusBtn.onclick=refocusCamera;
    const zoomSlider=document.getElementById('zoomSlider');
    if(zoomSlider) zoomSlider.oninput=()=>setCameraZoom(Number(zoomSlider.value));

    const photoBtn=document.getElementById('scanPhotoBtn');
    const photoInput=document.getElementById('scanPhotoInput');
    if(photoBtn && photoInput) {
      photoBtn.onclick=()=>photoInput.click();
      photoInput.onchange=async()=>{
        const file=photoInput.files && photoInput.files[0];
        if(!file || !window.Html5Qrcode) return;
        const status=document.getElementById('scanStatus');
        try {
          if(status) status.textContent='Reading QR from photo…';
          await stopScanner();
          let decoded=await decodeQrFromPhoto(file);
          if(!decoded && window.Html5Qrcode) {
            let decoder=document.getElementById('photoQrDecoder');
            if(!decoder) {
              decoder=document.createElement('div');
              decoder.id='photoQrDecoder';
              decoder.className='hidden';
              document.body.appendChild(decoder);
            }
            S.scanner=new Html5Qrcode('photoQrDecoder', qrScannerOptions());
            decoded=await S.scanner.scanFile(file,true);
          }
          if(!decoded) throw new Error('No QR found');
          if(status) { status.className='notice success'; status.textContent='QR found.'; }
          signalScanSuccess();
          findScanned(decoded);
        } catch(e) {
          if(status) {
            status.className='notice error';
            status.textContent='No QR code found in that photo. Try moving closer and keeping the code sharp.';
          }
        } finally {
          photoInput.value='';
        }
      };
    }

    startQrScanner();
  }

  function qrScannerOptions() {
    const opts={verbose:false};
    if(window.Html5QrcodeSupportedFormats) opts.formatsToSupport=[Html5QrcodeSupportedFormats.QR_CODE];
    return opts;
  }

  function clamp(v,min,max) {
    return Math.min(max,Math.max(min,v));
  }

  function updateCameraControls() {
    const smallBtn=document.getElementById('smallQrBtn');
    const torchBtn=document.getElementById('torchBtn');
    const refocusBtn=document.getElementById('refocusBtn');
    const reader=document.getElementById('reader');
    const badge=document.getElementById('scanModeBadge');
    const zoomWrap=document.getElementById('zoomWrap');
    const zoomSlider=document.getElementById('zoomSlider');
    const zoomValue=document.getElementById('zoomValue');
    if(smallBtn) {
      smallBtn.setAttribute('aria-pressed',S.smallQrMode?'true':'false');
      smallBtn.textContent=S.smallQrMode?'Small QR Auto: ON':'Small QR Auto';
      smallBtn.classList.toggle('active-tool',S.smallQrMode);
    }
    if(reader) reader.classList.toggle('small-qr-mode',S.smallQrMode);
    if(badge) badge.textContent=S.smallQrMode?'Small QR enhanced scan':'Normal scan';
    const hasTorch=!!S.cameraCaps?.torch;
    if(torchBtn) {
      torchBtn.classList.toggle('hidden',!hasTorch);
      torchBtn.setAttribute('aria-pressed',S.torchOn?'true':'false');
      torchBtn.textContent=S.torchOn?'Torch: ON':'Torch';
      torchBtn.classList.toggle('active-tool',S.torchOn);
    }
    const focusModes=S.cameraCaps?.focusMode;
    const canRefocus=Array.isArray(focusModes)&&focusModes.some(x=>['continuous','single-shot','manual'].includes(x));
    if(refocusBtn) refocusBtn.classList.toggle('hidden',!canRefocus);
    const z=S.cameraCaps?.zoom;
    const hasZoom=z&&typeof z.min==='number'&&typeof z.max==='number'&&z.max>z.min;
    if(zoomWrap) zoomWrap.classList.toggle('hidden',!hasZoom);
    if(hasZoom&&zoomSlider) {
      zoomSlider.min=String(z.min);zoomSlider.max=String(z.max);zoomSlider.step=String(z.step||0.1);
      const current=Number(S.cameraZoom??S.cameraBaseZoom??z.min);
      zoomSlider.value=String(clamp(current,z.min,z.max));
      if(zoomValue) zoomValue.textContent=`${Number(zoomSlider.value).toFixed(1)}×`;
    }
  }

  async function configureCameraTrack(track) {
    S.cameraTrack=track;
    S.cameraCaps=track?.getCapabilities ? track.getCapabilities() : {};
    const settings=track?.getSettings ? track.getSettings() : {};
    S.cameraBaseZoom=typeof settings.zoom==='number' ? settings.zoom : (typeof S.cameraCaps?.zoom?.min==='number' ? S.cameraCaps.zoom.min : null);
    S.cameraZoom=S.cameraBaseZoom;
    try {
      const focusModes=S.cameraCaps?.focusMode;
      if(Array.isArray(focusModes) && focusModes.includes('continuous')) {
        await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
      }
    } catch(_) {}
    updateCameraControls();
  }

  async function setCameraZoom(value) {
    const track=S.cameraTrack, caps=S.cameraCaps?.zoom;
    if(!track||!caps||typeof caps.min!=='number'||typeof caps.max!=='number')return;
    const target=clamp(Number(value),caps.min,caps.max);
    try{
      await track.applyConstraints({advanced:[{zoom:target}]});
      S.cameraZoom=target;
      const zoomValue=document.getElementById('zoomValue');if(zoomValue)zoomValue.textContent=`${target.toFixed(1)}×`;
      const slider=document.getElementById('zoomSlider');if(slider&&Math.abs(Number(slider.value)-target)>.01)slider.value=String(target);
    }catch(_){}
  }

  async function toggleSmallQrMode() {
    S.smallQrMode=!S.smallQrMode;
    const caps=S.cameraCaps?.zoom;
    if(caps&&typeof caps.min==='number'&&typeof caps.max==='number') {
      const target=S.smallQrMode
        ? clamp(Math.max(2.5,caps.min+(caps.max-caps.min)*0.24),caps.min,caps.max)
        : clamp(S.cameraBaseZoom??caps.min,caps.min,caps.max);
      await setCameraZoom(target);
    }
    updateCameraControls();
    const status=document.getElementById('scanStatus');
    if(status&&S.cameraStream){
      status.className='notice';
      status.textContent=S.smallQrMode
        ? 'Small QR enhanced scan — centre the label, hold about 15–25 cm away and tap Refocus if needed.'
        : 'Normal scan mode — hold the QR steady inside the guide.';
    }
  }

  async function refocusCamera() {
    const track=S.cameraTrack,modes=S.cameraCaps?.focusMode;
    if(!track||!Array.isArray(modes))return;
    const status=document.getElementById('scanStatus');
    try{
      if(modes.includes('single-shot')) {
        await track.applyConstraints({advanced:[{focusMode:'single-shot'}]});
        setTimeout(()=>{try{if(S.cameraTrack&&modes.includes('continuous'))S.cameraTrack.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch(_){}},700);
      } else if(modes.includes('continuous')) {
        await track.applyConstraints({advanced:[{focusMode:'continuous'}]});
      }
      if(status){status.className='notice';status.textContent='Refocusing camera — hold the QR still for a moment.';}
    }catch(_){if(status){status.className='notice warn';status.textContent='Manual refocus is not available on this camera.';}}
  }

  async function toggleTorch() {
    if(!S.cameraTrack || !S.cameraCaps?.torch) return;
    const next=!S.torchOn;
    try {
      await S.cameraTrack.applyConstraints({advanced:[{torch:next}]});
      S.torchOn=next;
      updateCameraControls();
    } catch(_) {
      const status=document.getElementById('scanStatus');
      if(status) {
        status.className='notice warn';
        status.textContent='Torch control is not available on this camera.';
      }
    }
  }

  function signalScanSuccess() {
    try { if(navigator.vibrate) navigator.vibrate(100); } catch(_) {}
    try {
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return;
      const ac=new AC();
      const osc=ac.createOscillator();
      const gain=ac.createGain();
      osc.frequency.value=880;
      gain.gain.setValueAtTime(0.045,ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.08);
      osc.connect(gain); gain.connect(ac.destination);
      osc.start(); osc.stop(ac.currentTime+0.08);
      setTimeout(()=>{try{ac.close();}catch(_){}},180);
    } catch(_) {}
  }

  function drawScanRegion(ctx,canvas,video,region) {
    const vw=video.videoWidth,vh=video.videoHeight;
    ctx.imageSmoothingEnabled=false;
    if(region==='full') {
      const maxDim=1500,ratio=Math.min(1,maxDim/Math.max(vw,vh));
      const outW=Math.max(1,Math.round(vw*ratio)),outH=Math.max(1,Math.round(vh*ratio));
      canvas.width=outW;canvas.height=outH;ctx.imageSmoothingEnabled=false;
      ctx.drawImage(video,0,0,vw,vh,0,0,outW,outH);return;
    }
    const scale=Number(region)||0.7;
    const crop=Math.max(160,Math.floor(Math.min(vw,vh)*scale));
    const sx=Math.floor((vw-crop)/2),sy=Math.floor((vh-crop)/2);
    const out=Math.min(1700,Math.max(crop,S.smallQrMode?900:crop));
    canvas.width=out;canvas.height=out;ctx.imageSmoothingEnabled=false;
    ctx.drawImage(video,sx,sy,crop,crop,0,0,out,out);
  }

  async function nativeDetectQr(detector,video,smallMode,cycle) {
    if(!detector)return '';
    try{
      const found=await detector.detect(video);if(found?.length)return String(found[0].rawValue||'').trim();
      if(!smallMode||cycle%2)return '';
      const vw=video.videoWidth,vh=video.videoHeight,crop=Math.floor(Math.min(vw,vh)*0.48);
      const sx=Math.floor((vw-crop)/2),sy=Math.floor((vh-crop)/2);
      const bitmap=await createImageBitmap(video,sx,sy,crop,crop);
      try{const close=await detector.detect(bitmap);if(close?.length)return String(close[0].rawValue||'').trim();}finally{bitmap.close?.();}
    }catch(_){}
    return '';
  }

  async function decodeQrFromPhoto(file) {
    let bitmap;
    try{bitmap=await createImageBitmap(file);}catch(_){return '';}
    try{
      if('BarcodeDetector' in window){
        try{const formats=await BarcodeDetector.getSupportedFormats();if(formats.includes('qr_code')){const detector=new BarcodeDetector({formats:['qr_code']});const found=await detector.detect(bitmap);if(found?.length)return String(found[0].rawValue||'').trim();}}catch(_){}
      }
      if(!window.jsQR)return '';
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
      const regions=['full',0.86,0.68,0.50,0.36];
      for(const region of regions){
        const w=bitmap.width,h=bitmap.height;
        let sx=0,sy=0,sw=w,sh=h;
        if(region!=='full'){const crop=Math.floor(Math.min(w,h)*Number(region));sx=Math.floor((w-crop)/2);sy=Math.floor((h-crop)/2);sw=sh=crop;}
        const max=1800,ratio=Math.min(1,max/Math.max(sw,sh));
        const ow=Math.max(1,Math.round(sw*ratio)),oh=Math.max(1,Math.round(sh*ratio));
        canvas.width=ow;canvas.height=oh;ctx.imageSmoothingEnabled=false;ctx.drawImage(bitmap,sx,sy,sw,sh,0,0,ow,oh);
        const image=ctx.getImageData(0,0,ow,oh),code=jsQR(image.data,ow,oh,{inversionAttempts:'attemptBoth'});
        if(code?.data)return String(code.data).trim();
      }
    }catch(_){}finally{bitmap?.close?.();}
    return '';
  }

  async function startQrScanner() {
    const status=document.getElementById('scanStatus');
    const video=document.getElementById('qrVideo');
    const canvas=document.getElementById('qrCanvas');

    if(!video || !canvas || !navigator.mediaDevices?.getUserMedia) {
      if(status) {
        status.className='notice error';
        status.textContent='Live camera scanning is not supported here. Use Scan QR from photo instead.';
      }
      return;
    }

    try {
      if(status) {
        status.className='notice';
        status.textContent='Starting high-resolution rear camera…';
      }

      S.smallQrMode=false;
      S.torchOn=false;
      S.cameraCaps=null;
      const stream=await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{
          facingMode:{ideal:'environment'},
          width:{ideal:3840},
          height:{ideal:2160},
          frameRate:{ideal:30}
        }
      });

      S.cameraStream=stream;
      const track=stream.getVideoTracks()[0] || null;
      await configureCameraTrack(track);
      video.srcObject=stream;
      await video.play();

      const actual=track?.getSettings ? track.getSettings() : {};
      if(status) {
        status.className='notice';
        status.textContent=`Camera ready${actual.width&&actual.height?` · ${actual.width}×${actual.height}`:''} — centre the QR and hold steady.`;
      }

      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      let lastScan=0;
      let detector=null;
      let regionIndex=0;
      let scanCycle=0;

      if('BarcodeDetector' in window) {
        try {
          const formats=await BarcodeDetector.getSupportedFormats();
          if(formats.includes('qr_code')) detector=new BarcodeDetector({formats:['qr_code']});
        } catch(_) {}
      }

      const scanFrame=async(ts)=>{
        if(!S.cameraStream || !video.videoWidth || !video.videoHeight) {
          S.scanFrame=requestAnimationFrame(scanFrame);
          return;
        }

        if(ts-lastScan < 105) {
          S.scanFrame=requestAnimationFrame(scanFrame);
          return;
        }
        lastScan=ts;

        try {
          let decoded='';

          scanCycle++;
          // Native detector checks the full frame and, in small-label mode, a centre crop too.
          if(detector) decoded=await nativeDetectQr(detector,video,S.smallQrMode,scanCycle);

          // jsQR checks more than one centre crop per cycle in small-label mode.
          if(!decoded && window.jsQR) {
            const regions=S.smallQrMode?[0.58,0.44,0.32,0.72,'full']:['full',0.84,0.66,0.50];
            const attempts=S.smallQrMode?2:1;
            for(let n=0;n<attempts&&!decoded;n++){
              const region=regions[regionIndex%regions.length];regionIndex++;
              drawScanRegion(ctx,canvas,video,region);
              const image=ctx.getImageData(0,0,canvas.width,canvas.height);
              const code=jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'});
              if(code?.data)decoded=String(code.data).trim();
            }
          }

          if(decoded) {
            if(status) {
              status.className='notice success';
              status.textContent='QR found.';
            }
            signalScanSuccess();
            await stopScanner();
            findScanned(decoded);
            return;
          }
        } catch(_) {}

        if(S.cameraStream) S.scanFrame=requestAnimationFrame(scanFrame);
      };

      S.scanFrame=requestAnimationFrame(scanFrame);

    } catch(e) {
      if(status) {
        status.className='notice error';
        status.textContent='Camera could not start. Use Scan QR from photo or manual search.';
      }
    }
  }

  async function stopScanner() {
    if(S.scanFrame) {
      cancelAnimationFrame(S.scanFrame);
      S.scanFrame=null;
    }

    if(S.cameraStream) {
      try { S.cameraStream.getTracks().forEach(t=>t.stop()); } catch(_) {}
      S.cameraStream=null;
    }
    S.cameraTrack=null;
    S.cameraCaps=null;
    S.cameraBaseZoom=null;
    S.cameraZoom=null;
    S.torchOn=false;

    const video=document.getElementById('qrVideo');
    if(video) {
      try { video.pause(); video.srcObject=null; } catch(_) {}
    }

    if(S.scanner) {
      try {
        if(S.scanner.isScanning) await S.scanner.stop();
        await S.scanner.clear();
      } catch(_) {}
      S.scanner=null;
    }
  }

  function findScanned(value) {
    if(!value) return;
    const v=value.trim().toLowerCase();
    const exact=S.items.find(i=>i.active && [i.qr_value,i.item_code,i.name].some(x=>String(x||'').trim().toLowerCase()===v));
    if(exact) return openItem(exact.id);
    S.search=value; S.page='items'; setNotice('No exact QR match. Showing manual search results.','error'); render();
  }

  function bindItems() {
    const inp=document.getElementById('itemSearch');
    inp.oninput=()=>{S.search=inp.value; clearTimeout(inp._t); inp._t=setTimeout(refreshItemSearchResults,120);};
    const cat=document.getElementById('categoryFilter'); if(cat) cat.onchange=()=>{S.categoryFilter=cat.value;refreshItemSearchResults();};
    const add=document.getElementById('addItemBtn'); if(add) add.onclick=openAddItem;
    const archived=document.getElementById('toggleArchivedBtn'); if(archived) archived.onclick=()=>{S.showArchived=!S.showArchived;S.search='';render();};
    const manage=document.getElementById('manageCategoriesBtn'); if(manage) manage.onclick=openCategoryManager;
    hydrateItemThumbnails(document);
  }

  function bindLocations() {
    const b=document.getElementById('addLocationBtn'); if(b) b.onclick=openAddLocation;
    document.querySelectorAll('[data-rename-location]').forEach(btn=>btn.onclick=()=>openRenameLocation(btn.dataset.renameLocation));
    document.querySelectorAll('[data-delete-location]').forEach(btn=>btn.onclick=()=>openDeleteLocation(btn.dataset.deleteLocation));
  }

  function bindOrders() {
    const csv=document.getElementById('exportOrdersCsv'); if(csv) csv.onclick=exportOrdersCSV;
    const xls=document.getElementById('exportOrdersExcel'); if(xls) xls.onclick=exportOrdersExcel;
    document.querySelectorAll('[data-order-tab]').forEach(b=>b.onclick=()=>{S.orderTab=b.dataset.orderTab;render();});
    document.querySelectorAll('[data-create-order]').forEach(b=>b.onclick=e=>{e.stopPropagation();openCreateOrder(b.dataset.createOrder);});
    document.querySelectorAll('[data-receive-order]').forEach(b=>b.onclick=e=>{e.stopPropagation();openReceiveOrder(b.dataset.receiveOrder);});
    document.querySelectorAll('[data-edit-order]').forEach(b=>b.onclick=e=>{e.stopPropagation();openEditOrder(b.dataset.editOrder);});
    document.querySelectorAll('[data-cancel-order]').forEach(b=>b.onclick=e=>{e.stopPropagation();openCancelOrder(b.dataset.cancelOrder);});
  }


  function openCreateOrder(itemId) {
    if(!canManage()){setNotice('Admin or manager access required to create orders.','error');render();return;}
    const item=byId(S.items,itemId); if(!item)return;
    const forecast=suggestedOrderRows().find(r=>r.item.id===itemId);
    const suppliers=suppliersForItem(itemId);
    const preferred=preferredSupplier(itemId);
    const suggested=forecast?.suggested||1;
    showModal(`<header><div><h2>Add to order</h2><div class="muted">${esc(item.name)}</div></div><button class="close" data-close>×</button></header>
      <form id="createOrderForm">
        <div class="form-grid">
          <div><label>Quantity ordered</label><input id="orderQty" type="number" inputmode="decimal" min="0.01" step="0.01" value="${esc(suggested)}" required></div>
          <div><label>Supplier</label><select id="orderSupplier"><option value="">Manual supplier</option>${suppliers.map(s=>`<option value="${s.id}" ${preferred?.id===s.id?'selected':''}>Supplier ${s.supplier_slot}: ${esc(s.supplier_name)}</option>`).join('')}</select></div>
          <div><label>Supplier name</label><input id="orderSupplierName" list="globalSupplierNames" value="${esc(preferred?.supplier_name||'')}" required><datalist id="globalSupplierNames">${globalSupplierNames().map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist></div>
          <div><label>Supplier part ref</label><input id="orderSupplierRef" value="${esc(preferred?.supplier_ref||'')}"></div>
          <div><label>Order / PO reference</label><input id="orderRef" placeholder="e.g. PO-1024"></div>
          <div><label>Expected delivery date</label><input id="orderExpected" type="date"></div>
          <div class="full"><label>Notes (optional)</label><textarea id="orderNotes" rows="2"></textarea></div>
        </div>
        <div class="notice">Current stock: <strong>${qty(itemTotal(itemId))}</strong> · Already on order: <strong>${qty(itemOnOrder(itemId))}</strong> · Suggested now: <strong>${qty(suggested)}</strong></div>
        <div class="actions"><button class="btn" type="submit">Mark as ordered</button></div>
      </form>`);
    const sel=document.getElementById('orderSupplier');
    const name=document.getElementById('orderSupplierName');
    const ref=document.getElementById('orderSupplierRef');
    sel.onchange=()=>{
      const s=byId(S.itemSuppliers,sel.value);
      name.value=s?.supplier_name||'';
      ref.value=s?.supplier_ref||'';
      const exp=document.getElementById('orderExpected');
      if(s?.lead_time_days!=null && !exp.value){
        const d=new Date();d.setDate(d.getDate()+num(s.lead_time_days));exp.value=d.toISOString().slice(0,10);
      }
    };
    if(preferred?.lead_time_days!=null){
      const d=new Date();d.setDate(d.getDate()+num(preferred.lead_time_days));
      document.getElementById('orderExpected').value=d.toISOString().slice(0,10);
    }
    document.getElementById('createOrderForm').onsubmit=async e=>{
      e.preventDefault();
      const supplier=byId(S.itemSuppliers,sel.value);
      const row={
        item_id:itemId,
        supplier_id:supplier?.id||null,
        supplier_name:name.value.trim(),
        supplier_ref:ref.value.trim()||null,
        quantity_ordered:num(document.getElementById('orderQty').value),
        quantity_received:0,
        order_reference:document.getElementById('orderRef').value.trim()||null,
        expected_date:document.getElementById('orderExpected').value||null,
        ordered_by:S.profile.id,
        notes:document.getElementById('orderNotes').value.trim()||null,
        status:'OPEN'
      };
      const {error}=await sb.from('purchase_orders').insert(row);
      if(error){setNotice(parseError(error),'error');return;}
      await loadData();closeModal();S.orderTab='open';setNotice(`${item.name}: marked as on order.`);render();
    };
  }

  function openReceiveOrder(orderId) {
    const order=byId(S.purchaseOrders,orderId); if(!order)return;
    const item=byId(S.items,order.item_id); const remaining=orderRemaining(order);
    if(remaining<=0){setNotice('This order has already been fully received.','error');render();return;}
    if(!locationNames().length){setNotice('Add a location before receiving stock.','error');render();return;}
    showModal(`<header><div><h2>Receive delivery</h2><div class="muted">${esc(item?.name||'Item')}</div></div><button class="close" data-close>×</button></header>
      <form id="receiveOrderForm">
        <div class="order-metrics">
          <div><span>Ordered</span><strong>${qty(order.quantity_ordered)}</strong></div>
          <div><span>Already received</span><strong>${qty(order.quantity_received)}</strong></div>
          <div><span>Still on order</span><strong>${qty(remaining)}</strong></div>
        </div>
        <label>Received now</label><input id="receiveQty" type="number" inputmode="decimal" min="0.01" max="${esc(remaining)}" step="0.01" value="${esc(remaining)}" required>
        <label>Put into location</label><select id="receiveLocation" required>${locationNameOptions(activeLocations())}</select>
        <label>Bin Ref (optional)</label><input id="receiveBin" list="receiveBinList" placeholder="e.g. B12"><datalist id="receiveBinList"></datalist>
        ${item?.default_location_id?`<div class="muted">Default storage: <strong>${esc(itemDefaultLabel(item))}</strong> · change it above if this delivery belongs somewhere else.</div>`:''}
        <label>Notes (optional)</label><textarea id="receiveNotes" rows="2" placeholder="Short delivery, damaged box, etc."></textarea>
        <div class="notice">If fewer than ${qty(remaining)} arrive, type the amount actually received. The balance will stay visible as <strong>Back order / Still on order</strong>.</div>
        <div class="actions"><button class="btn good" type="submit">Confirm receipt</button></div>
      </form>`);
    bindBinRefSuggestions('receiveLocation','receiveBin','receiveBinList',activeLocations());
    if(item) applyItemDefaultDestination(item,'receiveLocation','receiveBin');
    document.getElementById('receiveOrderForm').onsubmit=async e=>{
      e.preventDefault();
      try{
        const amount=num(document.getElementById('receiveQty').value);
        if(amount<=0||amount>remaining){setNotice(`Enter an amount between 0 and ${qty(remaining)}.`, 'error');return;}
        const locationId=await ensurePosition(document.getElementById('receiveLocation').value,document.getElementById('receiveBin').value);
        const {error}=await sb.rpc('receive_purchase_order',{
          p_order_id:orderId,
          p_quantity:amount,
          p_to_location_id:locationId,
          p_notes:document.getElementById('receiveNotes').value.trim()||null
        });
        if(error)throw error;
        await loadData();closeModal();
        const updated=byId(S.purchaseOrders,orderId);
        setNotice(updated&&orderRemaining(updated)>0?`${item.name}: ${qty(amount)} received. ${qty(orderRemaining(updated))} still on order.`:`${item.name}: delivery completed.`);
        render();
      }catch(err){setNotice(parseError(err),'error');}
    };
  }

  function openEditOrder(orderId) {
    if(!canManage())return;
    const o=byId(S.purchaseOrders,orderId); if(!o)return;
    showModal(`<header><div><h2>Edit order</h2><div class="muted">${esc(itemName(o.item_id))}</div></div><button class="close" data-close>×</button></header>
      <form id="editOrderForm">
        <label>Total ordered quantity</label><input id="editOrderQty" type="number" inputmode="decimal" min="${esc(o.quantity_received)}" step="0.01" value="${esc(o.quantity_ordered)}" required>
        <label>Order / PO reference</label><input id="editOrderRef" value="${esc(o.order_reference||'')}">
        <label>Expected delivery date</label><input id="editOrderExpected" type="date" value="${esc(o.expected_date||'')}">
        <label>Notes</label><textarea id="editOrderNotes" rows="2">${esc(o.notes||'')}</textarea>
        <div class="notice">Already received: <strong>${qty(o.quantity_received)}</strong>. Ordered quantity cannot be reduced below what has already arrived.</div>
        <div class="actions"><button class="btn" type="submit">Save order</button></div>
      </form>`);
    document.getElementById('editOrderForm').onsubmit=async e=>{
      e.preventDefault();
      const ordered=num(document.getElementById('editOrderQty').value);
      const received=num(o.quantity_received);
      if(ordered<received){setNotice('Ordered quantity cannot be lower than the amount already received.','error');return;}
      const status=ordered===received?'COMPLETED':received>0?'PART_RECEIVED':'OPEN';
      const {error}=await sb.from('purchase_orders').update({
        quantity_ordered:ordered,
        order_reference:document.getElementById('editOrderRef').value.trim()||null,
        expected_date:document.getElementById('editOrderExpected').value||null,
        notes:document.getElementById('editOrderNotes').value.trim()||null,
        status,
        updated_at:new Date().toISOString()
      }).eq('id',orderId);
      if(error){setNotice(parseError(error),'error');return;}
      await loadData();closeModal();setNotice('Order updated.');render();
    };
  }

  function openCancelOrder(orderId) {
    if(!canManage())return;
    const o=byId(S.purchaseOrders,orderId); if(!o)return;
    showModal(`<header><h2>Close / cancel order</h2><button class="close" data-close>×</button></header>
      <p>Close the remaining <strong>${qty(orderRemaining(o))}</strong> for <strong>${esc(itemName(o.item_id))}</strong>?</p>
      <p class="muted">Any quantity already received stays in stock. The outstanding balance will no longer count as On Order.</p>
      <label>Reason (optional)</label><textarea id="cancelOrderReason" rows="2"></textarea>
      <div class="actions"><button class="btn danger" id="confirmCancelOrder">Close order</button><button class="btn ghost" data-close>Keep open</button></div>`);
    document.getElementById('confirmCancelOrder').onclick=async()=>{
      const reason=document.getElementById('cancelOrderReason').value.trim();
      const notes=[o.notes,reason?`Closed: ${reason}`:'Closed by admin'].filter(Boolean).join(' · ');
      const {error}=await sb.from('purchase_orders').update({status:'CANCELLED',cancelled_at:new Date().toISOString(),cancelled_by:S.profile.id,notes,updated_at:new Date().toISOString()}).eq('id',orderId);
      if(error){setNotice(parseError(error),'error');return;}
      await loadData();closeModal();setNotice('Order closed.');render();
    };
  }

  function bindReports() {
    const ids=[['reportPeriod','period'],['reportItem','item'],['reportUser','user'],['reportFrom','from'],['reportTo','to']];
    ids.forEach(([id,key])=>{const el=document.getElementById(id); if(el) el.onchange=()=>{S.report[key]=el.value; render();};});
    const rl=document.getElementById('reportLocation'); if(rl) rl.onchange=()=>{S.report.location=rl.value;S.report.bin='';render();};
    const rb=document.getElementById('reportBin'); if(rb){rb.onchange=()=>{S.report.bin=rb.value.trim();render();};rb.onkeydown=e=>{if(e.key==='Enter'){S.report.bin=rb.value.trim();render();}};}
    document.getElementById('exportReport').onclick=exportUsageCSV;
    const ux=document.getElementById('exportReportExcel'); if(ux) ux.onclick=exportUsageExcel;
    const ea=document.getElementById('exportActivity'); if(ea) ea.onclick=exportActivityCSV;
    const ax=document.getElementById('exportActivityExcel'); if(ax) ax.onclick=exportActivityExcel;
    drawTrendChart();
  }

  function drawTrendChart() {
    const canvas=document.getElementById('trendChart'); if(!canvas || !window.Chart) return;
    const selected=S.report.item || (reportTransactions()[0]?.item_id || '');
    if(!selected) return;
    const now=new Date(); const labels=[], vals=[];
    for(let k=11;k>=0;k--) {
      const d=new Date(now.getFullYear(),now.getMonth()-k,1); const y=d.getFullYear(),m=d.getMonth();
      labels.push(d.toLocaleDateString(undefined,{month:'short',year:'2-digit'}));
      vals.push(S.transactions.filter(t=>countsAsUsage(t)&&t.item_id===selected&&new Date(t.occurred_at).getFullYear()===y&&new Date(t.occurred_at).getMonth()===m).reduce((a,t)=>a+num(t.quantity),0));
    }
    if(S.chart) { try{S.chart.destroy();}catch(_){} }
    S.chart=new Chart(canvas,{type:'line',data:{labels,datasets:[{label:`Monthly usage · ${itemName(selected)}`,data:vals,tension:.25}]},options:{responsive:true,plugins:{legend:{display:true}},scales:{y:{beginAtZero:true}}}});
  }

  function downloadCSV(filename, rows) {
    const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function exportWorkbook(filename, sheets) {
    if(!window.XLSX){setNotice('Excel export library did not load. Use CSV or refresh while online.','error');render();return;}
    const wb=XLSX.utils.book_new();
    for(const [name,rows] of sheets){
      const ws=XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));
    }
    XLSX.writeFile(wb,filename);
  }

  function usageExportRows() {
    const list=reportTransactions();
    const rows=[['Date/time','Item','Quantity','User','Location','Reason','Legacy','Legacy classification','Excluded from usage']];
    list.forEach(t=>rows.push([t.occurred_at,itemName(t.item_id),num(t.quantity),userName(t.user_id),locName(t.from_location_id),t.reason||t.notes||'',t.legacy_import?'Yes':'No',t.legacy_classification||'',t.exclude_from_usage?'Yes':'No']));
    return rows;
  }

  function activityExportRows() {
    const list=activityTransactions();
    const rows=[['Date/time','Item','Action','Quantity','User','From','To','Reason','Legacy','Legacy classification','Excluded from usage']];
    list.forEach(t=>rows.push([t.occurred_at,itemName(t.item_id),t.transaction_type,num(t.quantity),userName(t.user_id),locName(t.from_location_id),locName(t.to_location_id),t.reason||t.notes||'',t.legacy_import?'Yes':'No',t.legacy_classification||'',t.exclude_from_usage?'Yes':'No']));
    return rows;
  }

  function exportUsageCSV() { downloadCSV(`inventory-usage-${todayISO()}.csv`,usageExportRows()); }
  function exportActivityCSV() { downloadCSV(`inventory-activity-${todayISO()}.csv`,activityExportRows()); }
  function exportUsageExcel() { exportWorkbook(`inventory-usage-${todayISO()}.xlsx`,[['Usage',usageExportRows()]]); }
  function exportActivityExcel() { exportWorkbook(`inventory-activity-${todayISO()}.xlsx`,[['Activity',activityExportRows()]]); }




  function orderExportRows(includeZero=false) {
    const months=completedMonthWindows(3);
    const list=suggestedOrderRows().filter(r=>includeZero||r.suggested>0);
    const rows=[['Item','Item code',months[0].label,months[1].label,months[2].label,'3-month usage','Average monthly usage','Current overall stock','On order','Suggested order','Preferred supplier','Supplier ref']];
    list.forEach(r=>rows.push([r.item.name,r.item.item_code,r.monthly[0],r.monthly[1],r.monthly[2],r.used3,Number(r.avg.toFixed(3)),r.current,r.onOrder,r.suggested,r.supplier?.supplier_name||'',r.supplier?.supplier_ref||'']));
    return rows;
  }

  function exportOrdersCSV() {
    downloadCSV(`suggested-orders-${todayISO()}.csv`,orderExportRows(false));
  }

  function exportOrdersExcel() {
    const orderRows=orderExportRows(false);
    const allRows=orderExportRows(true);
    exportWorkbook(`suggested-orders-${todayISO()}.xlsx`,[['Suggested Orders',orderRows],['All Items Forecast',allRows]]);
  }

  function bindUsers() {
    const invoke=async body=>{
      const {data,error}=await sb.functions.invoke('invite-user',{body});
      if(error||data?.error) throw new Error(parseError(error||data?.error));
      return data;
    };
    document.querySelectorAll('[data-role-user]').forEach(sel=>sel.onchange=async()=>{
      try{ await invoke({action:'set_role',user_id:sel.dataset.roleUser,role:sel.value}); await loadData({transactions:false});setNotice('User role updated.');render(); }
      catch(e){setNotice(parseError(e),'error');await loadData({transactions:false});render();}
    });
    document.querySelectorAll('[data-user-disable]').forEach(b=>b.onclick=async()=>{
      if(!confirm('Disable this user? They will no longer be able to sign in, but all history will be kept.'))return;
      try{await invoke({action:'disable',user_id:b.dataset.userDisable});await loadData({transactions:false});setNotice('User disabled.');render();}catch(e){setNotice(parseError(e),'error');render();}
    });
    document.querySelectorAll('[data-user-enable]').forEach(b=>b.onclick=async()=>{
      try{await invoke({action:'enable',user_id:b.dataset.userEnable});await loadData({transactions:false});setNotice('User re-enabled.');render();}catch(e){setNotice(parseError(e),'error');render();}
    });
    document.querySelectorAll('[data-user-email]').forEach(b=>b.onclick=async()=>{
      const p=byId(S.profiles,b.dataset.userEmail); if(!p)return;
      const entered=prompt(`Enter the corrected email address for ${p.display_name}:`,p.email||'');
      if(entered===null)return;
      const email=String(entered).trim().toLowerCase();
      if(!email){setNotice('Email address cannot be blank.','error');render();return;}
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setNotice('Enter a valid email address.','error');render();return;}
      if(email===String(p.email||'').trim().toLowerCase()){setNotice('That is already the registered email address.');render();return;}
      if(!confirm(`Change ${p.display_name}'s registered email from\n${p.email||'—'}\nto\n${email}?\n\nTheir password, role and stock history will stay the same.`))return;
      try{
        await invoke({action:'change_email',user_id:p.id,email});
        await loadData({transactions:false});
        setNotice(`Email changed to ${email}. The user should use this address the next time they sign in.`);
        render();
      }catch(e){setNotice(`Email change failed: ${parseError(e)}`,'error');render();}
    });
    const f=document.getElementById('inviteForm'); if(f) f.onsubmit=async e=>{
      e.preventDefault();
      const body={action:'invite',display_name:document.getElementById('inviteName').value.trim(),email:document.getElementById('inviteEmail').value.trim(),role:document.getElementById('inviteRole').value,redirect_to:location.origin+location.pathname};
      try{await invoke(body);setNotice('Invitation sent. The user must set their password before entering the tracker.');await loadData({transactions:false});render();}
      catch(e){setNotice(`Invite failed: ${parseError(e)}. If this is the first invite, deploy the included invite-user Edge Function from your laptop.`, 'error');render();}
    };
  }









  function requestStockAction(item,type) { return openStockAction(item,type); }



  async function openItem(id) {
    const i=byId(S.items,id); if(!i) return;
    S.selectedItemId=id;
    touchRecentItem(id).catch(()=>{});
    const photoUrl=await signedUrl('item-photos',i.primary_photo_path,3600);
    const pos=itemPositions(id), total=itemTotal(id), onOrder=itemOnOrder(id);
    const suppliers=suppliersForItem(id), itemOrders=openOrdersForItem(id), pref=itemPref(id);
    const locationTotals=new Map();
    for(const b of pos){const l=byId(S.locations,b.location_id);if(!l)continue;const key=l.location_name;locationTotals.set(key,(locationTotals.get(key)||0)+num(b.quantity));}
    const recent=S.transactions.filter(t=>t.item_id===id).slice(0,25);
    showModal(`<header><div><h2>${esc(i.name)}</h2><div class="muted">${esc(i.item_code)} ${i.active?'':'· Archived'}</div></div><button class="close" data-close>×</button></header>
      <div class="split"><div>
        ${photoUrl?`<img class="photo zoomable" id="itemPhoto" src="${esc(photoUrl)}" alt="${esc(i.name)}" title="Tap to enlarge">`:''}
        <div class="grid cards" style="margin-top:1rem"><div class="card"><div class="muted">Overall stock</div><div class="stat">${qty(total)}</div></div><div class="card"><div class="muted">On order</div><div class="stat">${qty(onOrder)}</div></div><div class="card"><div class="muted">Reorder level</div><div class="stat">${qty(i.reorder_level)}</div></div></div>
        <h3>Totals by location</h3>${locationTotals.size?[...locationTotals.entries()].map(([name,q])=>`<div class="location-chip"><strong>${esc(name)}</strong> · ${qty(q)}</div>`).join(''):'<span class="muted">No stock assigned.</span>'}
        <h3>Exact stock positions</h3>${pos.length?pos.map(b=>{const l=byId(S.locations,b.location_id);return `<div class="location-chip"><strong>${esc(l?.location_name||'Unknown')}</strong> → ${esc(effectiveBinCode(l)?`Bin Ref ${effectiveBinCode(l)}`:'No bin ref')} · ${qty(b.quantity)}</div>`;}).join(''):'<div class="notice">No stock location currently has a positive quantity.</div>'}
      </div><div>
        <div class="card"><div><strong>QR value</strong><br>${esc(i.qr_value)}</div><div><strong>Category</strong><br>${esc(i.category||'—')}</div><div><strong>Default storage</strong><br>${esc(itemDefaultLabel(i))}</div><div><strong>Unit cost</strong><br>${money(i.unit_cost)}</div>${onOrder>0?`<div style="margin-top:.7rem"><span class="badge order">ON ORDER ${qty(onOrder)}</span></div>`:''}</div>
        ${i.active?`<div class="actions quick-actions"><button class="btn good" data-stock-action="ADD">+ Add stock</button><button class="btn warn" data-stock-action="USE">− Use stock</button><button class="btn secondary" data-stock-action="ADJUST">Adjust count</button><button class="btn ghost" data-stock-action="MOVE">Move stock</button></div>`:'<div class="notice">This item is archived. Restore it before recording new stock actions.</div>'}
        <div class="actions"><button class="btn ${pref?.favourite?'warn':'ghost'}" id="favouriteBtn">${pref?.favourite?'★ Favourite':'☆ Add favourite'}</button><button class="btn ghost" id="printQrBtn">Print QR</button>${canManage()&&i.active?'<button class="btn ghost" id="editItemBtn">Edit item</button><button class="btn ghost" id="suppliersBtn">Suppliers 1–3</button><button class="btn" id="orderItemBtn">Order item</button>':''}${canAdmin()?i.active?'<button class="btn danger" id="archiveItemBtn">Archive item</button>':'<button class="btn good" id="restoreItemBtn">Restore item</button>':''}</div>
      </div></div>
      <div class="card" style="margin-top:1rem"><h3>Suppliers & orders</h3>
        ${suppliers.length?suppliers.map(s=>`<div class="supplier-line"><strong>Supplier ${s.supplier_slot}: ${esc(s.supplier_name)}</strong>${s.preferred?' <span class="badge">Preferred</span>':''}<div class="muted">Ref ${esc(s.supplier_ref||'—')} · Pack ${qty(s.pack_size||1)} · Lead ${s.lead_time_days==null?'—':esc(s.lead_time_days)+' days'} · ${s.unit_price==null?'Price —':money(s.unit_price)}</div></div>`).join(''):'<p class="muted">No suppliers saved yet.</p>'}
        ${itemOrders.length?`<div style="margin-top:.7rem"><strong>Currently on order</strong>${itemOrders.map(o=>`<div class="muted">${qty(orderRemaining(o))} from ${esc(o.supplier_name)}${o.expected_date?` · expected ${fmtShortDate(o.expected_date)}`:''}</div>`).join('')}</div>`:''}
      </div>
      <div class="card" style="margin-top:1rem"><h3>Recent item history</h3>${transactionTable(recent)}</div>`);
    document.querySelectorAll('[data-stock-action]').forEach(b=>b.onclick=()=>requestStockAction(i,b.dataset.stockAction));
    document.getElementById('printQrBtn').onclick=()=>printQr(i);
    document.getElementById('favouriteBtn').onclick=()=>toggleFavourite(i.id);
    const photo=document.getElementById('itemPhoto'); if(photo) photo.onclick=()=>photo.classList.toggle('photo-large');
    const edit=document.getElementById('editItemBtn'); if(edit) edit.onclick=()=>openEditItem(i);
    const suppliersBtn=document.getElementById('suppliersBtn'); if(suppliersBtn) suppliersBtn.onclick=()=>openSupplierEditor(i);
    const orderItemBtn=document.getElementById('orderItemBtn'); if(orderItemBtn) orderItemBtn.onclick=()=>openCreateOrder(i.id);
    const archive=document.getElementById('archiveItemBtn'); if(archive) archive.onclick=()=>archiveItem(i);
    const restore=document.getElementById('restoreItemBtn'); if(restore) restore.onclick=()=>restoreItem(i);
  }


  function locationNameOptions(rows=activeLocations(), includeNone=false) {
    const opts=locationNames(rows).map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    return `${includeNone?'<option value="">None</option>':''}${opts}`;
  }

  function binSuggestionsForLocation(name, rows=activeLocations()) {
    return [...new Set(positionsForLocation(name,rows).map(effectiveBinCode).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  }

  function bindBinRefSuggestions(locationSelectId, inputId, datalistId, rows=activeLocations(), itemId=null, positiveOnly=false) {
    const locSel=document.getElementById(locationSelectId), input=document.getElementById(inputId), list=document.getElementById(datalistId);
    if(!locSel||!input||!list)return;

    let preset=document.getElementById(`${inputId}Preset`);
    if(!preset){
      preset=document.createElement('select');
      preset.id=`${inputId}Preset`;
      preset.className='controlled-bin-select';
      preset.hidden=true;
      input.parentNode.insertBefore(preset,input);
    }

    const syncPresetFromInput=()=>{
      if(preset.hidden)return;
      const v=normalizeBin(input.value);
      const has=[...preset.options].some(o=>o.value===v);
      if(has){
        preset.value=v;
        input.hidden=true;
      } else if(v){
        preset.value='__OTHER__';
        input.hidden=false;
      }
    };

    const refresh=()=>{
      let candidates=positionsForLocation(locSel.value,rows);
      if(itemId && positiveOnly){
        const positiveIds=new Set(itemPositions(itemId).map(b=>b.location_id));
        candidates=candidates.filter(l=>positiveIds.has(l.id));
      }

      const actualRefs=[...new Set(candidates.map(effectiveBinCode).filter(Boolean))].sort(naturalBinSort);
      const controlled=controlledBinPresetRefs(locSel.value);

      if(controlled){
        let refs;
        if(positiveOnly){
          // For Use / Move source, only show bins that actually contain stock.
          refs=actualRefs;
        } else {
          // For destination/default selection show all preset bins, plus any older non-standard bin refs already in use.
          refs=[...new Set([...controlled,...actualRefs])].sort(naturalBinSort);
        }

        const current=normalizeBin(input.value);
        preset.innerHTML=
          `<option value="">No bin / Unallocated</option>`+
          refs.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')+
          (!positiveOnly?'<option value="__OTHER__">Other / manual entry</option>':'');

        preset.hidden=false;
        list.innerHTML='';

        if(current && refs.includes(current)){
          preset.value=current;
          input.hidden=true;
        } else if(current && !positiveOnly){
          preset.value='__OTHER__';
          input.hidden=false;
        } else {
          preset.value='';
          input.value='';
          input.hidden=true;
        }

        preset.onchange=()=>{
          if(preset.value==='__OTHER__'){
            input.value='';
            input.hidden=false;
            input.focus();
            input.dispatchEvent(new Event('input',{bubbles:true}));
            return;
          }
          input.hidden=true;
          input.value=preset.value;
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
        };
      } else {
        preset.hidden=true;
        input.hidden=false;
        const refs=actualRefs;
        list.innerHTML=refs.map(r=>`<option value="${esc(r)}"></option>`).join('');
        if(refs.length===1 && !input.value.trim()) input.value=refs[0];
      }
    };

    locSel.onchange=()=>{
      input.value='';
      refresh();
      input.dispatchEvent(new Event('input',{bubbles:true}));
    };
    input.addEventListener('input',syncPresetFromInput);
    refresh();
  }

  function findPosition(locationName, binRef, rows=S.locations) {
    const ref=normalizeBin(binRef).toLowerCase();
    const candidates=rows.filter(l=>l.active && l.location_name===locationName);
    return candidates.find(l=>effectiveBinCode(l).trim().toLowerCase()===ref) || null;
  }

  async function ensurePosition(locationName, binRef) {
    const existing=findPosition(locationName,binRef);
    if(existing) return existing.id;
    const {data,error}=await sb.rpc('get_or_create_stock_position',{p_location_name:locationName,p_bin_ref:normalizeBin(binRef)});
    if(error) throw error;
    return data;
  }

  function sourcePosition(itemId, locationName, binRef) {
    const p=findPosition(locationName,binRef);
    if(!p) return null;
    const b=S.balances.find(x=>x.item_id===itemId&&x.location_id===p.id);
    return b&&num(b.quantity)>0?p:null;
  }

  function sourceAvailable(itemId, locationName, binRef) {
    const p=sourcePosition(itemId,locationName,binRef);
    if(!p) return 0;
    return num(S.balances.find(x=>x.item_id===itemId&&x.location_id===p.id)?.quantity);
  }

  function stockActionForm(item,type) {
    const pos=itemPositions(item.id);
    const positiveIds=new Set(pos.map(b=>b.location_id));
    const sourceRows=activeLocations().filter(l=>positiveIds.has(l.id));
    const allRows=activeLocations();
    const title={ADD:'Add stock',USE:'Use / remove stock',MOVE:'Move stock',ADJUST:'Adjust stock'}[type];
    const sourcePair=`<label>Location</label><select id="fromLocationName" required>${locationNameOptions(sourceRows)}</select><label>Bin Ref</label><input id="fromBinRef" list="fromBinList" placeholder="Type bin ref, e.g. B12"><datalist id="fromBinList"></datalist><div id="sourceAvailability" class="notice compact">Select the source bin to see available stock.</div>`;
    const destinationPair=`<label>Location</label><select id="toLocationName" required>${locationNameOptions(allRows)}</select><label>Bin Ref (optional)</label><input id="toBinRef" list="toBinList" placeholder="Type bin ref, e.g. B12"><datalist id="toBinList"></datalist>${item.default_location_id?`<div class="muted">Default storage: <strong>${esc(itemDefaultLabel(item))}</strong> · change it here if this stock is going elsewhere.</div>`:''}`;
    const adjustPair=`<label>Location</label><select id="fromLocationName" required>${locationNameOptions(allRows)}</select><label>Bin Ref (optional)</label><input id="fromBinRef" list="fromBinList" placeholder="Type bin ref, e.g. B12"><datalist id="fromBinList"></datalist>`;
    return `<header><div><h2>${title}</h2><div class="muted">${esc(item.name)}</div></div><button class="close" data-close>×</button></header><form id="stockActionForm" data-type="${type}">
      ${type==='ADD'?`${destinationPair}<label>Quantity added</label><input id="actionQty" type="number" inputmode="decimal" min="0.01" step="0.01" required>`:''}
      ${type==='USE'?`${sourcePair}<label>Quantity used / removed</label><input id="actionQty" type="number" inputmode="decimal" min="0.01" step="0.01" required>`:''}
      ${type==='MOVE'?`<h3>Move from</h3>${sourcePair}<h3>Move to</h3>${destinationPair}<label class="ack-check"><input id="moveAllCheck" type="checkbox"> Move all stock from this bin</label><label>Quantity moved</label><input id="actionQty" type="number" inputmode="decimal" min="0.01" step="0.01" required><div id="movePreview" class="muted"></div>`:''}
      ${type==='ADJUST'?`${adjustPair}<label>Correct quantity at this location / bin ref</label><input id="newQty" type="number" inputmode="decimal" min="0" step="0.01" required><label>Reason</label><select id="reason" required><option value="Stock count correction">Stock count correction</option><option value="Damaged">Damaged</option><option value="Lost">Lost</option><option value="Found">Found</option><option value="Data correction">Data correction</option><option value="Other">Other</option></select>`:''}
      ${type!=='ADJUST'?`<label>Reason / reference (optional)</label><input id="reason" placeholder="Delivery, job, damaged, etc.">`:''}
      <label>Notes (optional)</label><textarea id="notes" rows="2"></textarea>
      <div id="stockActionMessage" class="notice compact" hidden></div>
      <div class="actions"><button class="btn" id="confirmStockActionBtn" type="submit">Confirm ${title.toLowerCase()}</button></div></form>`;
  }

  function openStockAction(item,type) {
    if((type==='USE'||type==='MOVE')&&!itemPositions(item.id).length){setNotice('There is no positive stock to remove or move.','error');closeModal();render();return;}
    if(!locationNames().length){setNotice('Add a location before recording stock.','error');closeModal();render();return;}
    showModal(stockActionForm(item,type));
    const pos=itemPositions(item.id);
    const positiveIds=new Set(pos.map(b=>b.location_id));
    const sourceRows=activeLocations().filter(l=>positiveIds.has(l.id));
    if(type==='USE'||type==='MOVE') bindBinRefSuggestions('fromLocationName','fromBinRef','fromBinList',sourceRows,item.id,true);
    if(type==='ADD'||type==='MOVE') {
      bindBinRefSuggestions('toLocationName','toBinRef','toBinList',activeLocations());
      applyItemDefaultDestination(item,'toLocationName','toBinRef');
    }
    if(type==='ADJUST') bindBinRefSuggestions('fromLocationName','fromBinRef','fromBinList',activeLocations(),item.id,false);
    if(type==='USE'||type==='MOVE'){
      const loc=document.getElementById('fromLocationName'), bin=document.getElementById('fromBinRef'), amount=document.getElementById('actionQty');
      const all=document.getElementById('moveAllCheck'), preview=document.getElementById('movePreview'), availableEl=document.getElementById('sourceAvailability');
      const update=()=>{
        const available=sourceAvailable(item.id,loc.value,bin.value);
        if(availableEl) availableEl.innerHTML=`<strong>Available here: ${qty(available)}</strong>`;
        if(amount){ amount.max=available>0?String(available):''; if(all?.checked) amount.value=available||''; }
        if(preview){ const moving=num(amount?.value); preview.textContent=available>0&&moving>0?`${qty(available)} available → move ${qty(moving)} → ${qty(Math.max(0,available-moving))} remaining`:''; }
      };
      loc.addEventListener('change',()=>setTimeout(update,0)); bin.addEventListener('input',update); amount?.addEventListener('input',update);
      if(all) all.onchange=()=>{amount.disabled=all.checked;update();};
      setTimeout(update,0);
    }
    const form=document.getElementById('stockActionForm');
    const submitBtn=document.getElementById('confirmStockActionBtn');
    const formMessage=document.getElementById('stockActionMessage');
    const showFormMessage=(message,type='error')=>{
      if(!formMessage)return;
      formMessage.hidden=false;
      formMessage.className=`notice compact ${type==='error'?'error':'success'}`;
      formMessage.textContent=message;
    };
    const actionTitle={ADD:'add stock',USE:'use / remove stock',MOVE:'move stock',ADJUST:'adjust stock'}[type]||'stock action';
    const setBusy=busy=>{
      if(!submitBtn)return;
      submitBtn.disabled=busy;
      submitBtn.textContent=busy?'Saving…':`Confirm ${actionTitle}`;
    };
    form.onsubmit=async e=>{
      e.preventDefault();
      if(formMessage){formMessage.hidden=true;formMessage.textContent='';}
      setBusy(true);
      let op=null;
      try{
        let fromName=null,fromRef='',toName=null,toRef='';
        if(type==='USE'||type==='MOVE'){
          fromName=document.getElementById('fromLocationName').value;
          fromRef=document.getElementById('fromBinRef').value;
          const p=sourcePosition(item.id,fromName,fromRef);
          if(!p){showFormMessage('No stock was found at that Location / Bin Ref. Check the bin reference and try again.');return;}
          const available=sourceAvailable(item.id,fromName,fromRef);
          const qEl=document.getElementById('actionQty');
          if(type==='MOVE'&&document.getElementById('moveAllCheck')?.checked) qEl.value=String(available);
          const requested=num(qEl?.value);
          if(requested<=0){showFormMessage('Enter a quantity greater than zero.');return;}
          if(requested>available){showFormMessage(`Only ${qty(available)} is available at that source.`);return;}
        }
        if(type==='ADD'||type==='MOVE'){
          toName=document.getElementById('toLocationName').value;
          toRef=document.getElementById('toBinRef').value;
        }
        if(type==='ADJUST'){
          fromName=document.getElementById('fromLocationName').value;
          fromRef=document.getElementById('fromBinRef').value;
        }
        if(type==='MOVE'&&fromName===toName&&normalizeBin(fromRef).toLowerCase()===normalizeBin(toRef).toLowerCase()){
          showFormMessage('Choose a different destination Location / Bin Ref.');return;
        }

        const quantity=num(document.getElementById('actionQty')?.value);
        const newQuantity=document.getElementById('newQty')?num(document.getElementById('newQty').value):null;
        if(type==='ADD'&&quantity<=0){showFormMessage('Enter a quantity greater than zero.');return;}
        if(type==='ADJUST'&&(newQuantity===null||newQuantity<0)){showFormMessage('Enter the correct stock quantity.');return;}

        const reason=document.getElementById('reason')?.value||null;
        const notes=document.getElementById('notes')?.value||null;
        op={id:makeClientId(),user_id:S.profile.id,item_id:item.id,type,quantity,from_location_name:fromName,from_bin_ref:normalizeBin(fromRef),to_location_name:toName,to_bin_ref:normalizeBin(toRef),new_quantity:newQuantity,reason,notes,created_at:new Date().toISOString()};

        if(S.offline||!navigator.onLine){
          queueStockOperation(op);
          closeModal();
          setNotice(`${item.name}: ${type.toLowerCase()} saved offline and will sync automatically.`);
          render();
          return;
        }

        try{
          await sendClientStockOperation(op);
          await loadData();
          closeModal();
          setNotice(`${item.name}: ${type.toLowerCase()} recorded.`);
          render();
        }catch(err){
          if(isNetworkError(err)){
            queueStockOperation(op);
            closeModal();
            setNotice(`${item.name}: connection lost — action saved offline for automatic sync.`);
            render();
            return;
          }
          showFormMessage(parseError(err));
        }
      }catch(err){
        showFormMessage(parseError(err));
      }finally{
        if(document.body.contains(form))setBusy(false);
      }
    };
  }

  function openAddLocation() {
    showModal(`<header><h2>Add location</h2><button class="close" data-close>×</button></header><form id="locForm"><p class="muted">Add the main place where stock is kept. Workshop main store and Workbench cupboard use controlled bin lists; other locations allow manual Bin Ref entry.</p><label>Location name</label><input id="locName" placeholder="Workshop Store" required><label>Notes (optional)</label><textarea id="locNotes"></textarea><div class="actions"><button class="btn" type="submit">Save location</button></div></form>`);
    document.getElementById('locForm').onsubmit=async e=>{
      e.preventDefault();
      const name=document.getElementById('locName').value.trim();
      if(!name)return;
      if(locationNames().some(x=>x.toLowerCase()===name.toLowerCase())){setNotice('That location already exists.','error');return;}
      const inactiveRoot=S.locations.find(l=>!l.active&&!effectiveBinCode(l)&&l.location_name.toLowerCase()===name.toLowerCase());
      let error;
      if(inactiveRoot) ({error}=await sb.from('stock_locations').update({active:true,notes:document.getElementById('locNotes').value.trim()||inactiveRoot.notes||null}).eq('id',inactiveRoot.id));
      else ({error}=await sb.from('stock_locations').insert({location_name:name,area_name:'',bin_code:'',notes:document.getElementById('locNotes').value.trim()||null}));
      if(error){setNotice(parseError(error),'error');return;}
      await loadData({transactions:false});closeModal();setNotice('Location added.');render();
    };
  }

  function openRenameLocation(oldName) {
    showModal(`<header><h2>Rename location</h2><button class="close" data-close>×</button></header><form id="renameLocationForm"><p class="muted">All stock positions at this location will use the new name. Quantities and transaction links are preserved.</p><label>Location name</label><input id="renameLocationName" value="${esc(oldName)}" required><div class="actions"><button class="btn" type="submit">Save new name</button></div></form>`);
    document.getElementById('renameLocationForm').onsubmit=async e=>{
      e.preventDefault();
      const name=document.getElementById('renameLocationName').value.trim();
      if(!name)return;
      if(name.toLowerCase()!==oldName.toLowerCase()&&locationNames().some(x=>x.toLowerCase()===name.toLowerCase())){setNotice('Another location already uses that name.','error');return;}
      const {error}=await sb.from('stock_locations').update({location_name:name}).eq('location_name',oldName);
      if(error){setNotice(parseError(error),'error');return;}
      await loadData();closeModal();setNotice('Location renamed.');render();
    };
  }

  function openDeleteLocation(name) {
    const ids=new Set(S.locations.filter(l=>l.active&&l.location_name===name).map(l=>l.id));
    const stock=S.balances.filter(b=>ids.has(b.location_id)).reduce((a,b)=>a+num(b.quantity),0);
    if(stock>0){setNotice(`Cannot delete ${name}: ${qty(stock)} units are still held there. Move or use the stock first.`,'error');render();return;}
    showModal(`<header><h2>Delete location</h2><button class="close" data-close>×</button></header><p>Delete <strong>${esc(name)}</strong> from the active location list?</p><p class="muted">Old transaction history is kept. This only removes the location from future stock selection.</p><div class="actions"><button class="btn danger" id="confirmDeleteLocation">Delete location</button><button class="btn ghost" data-close>Cancel</button></div>`);
    document.getElementById('confirmDeleteLocation').onclick=async()=>{
      const {error}=await sb.from('stock_locations').update({active:false}).eq('location_name',name);
      if(error){setNotice(parseError(error),'error');return;}
      await loadData({transactions:false});closeModal();setNotice('Location deleted from the active list. History was preserved.');render();
    };
  }


  function openSupplierEditor(item) {
    if(!canManage())return;
    const existing=suppliersForItem(item.id);
    const preferred=existing.find(s=>s.preferred)?.supplier_slot || existing[0]?.supplier_slot || 1;
    const section=slot=>{
      const s=existing.find(x=>num(x.supplier_slot)===slot);
      return `<div class="supplier-editor card">
        <div class="supplier-editor-title"><h3>Supplier ${slot}</h3><label class="preferred-radio"><input type="radio" name="preferredSupplier" value="${slot}" ${preferred===slot?'checked':''}> Preferred</label></div>
        <div class="form-grid">
          <div><label>Supplier name</label><input id="supplierName${slot}" list="supplierNamesList" value="${esc(s?.supplier_name||'')}" placeholder="Start typing or add a new supplier"></div>
          <div><label>Supplier part/reference</label><input id="supplierRef${slot}" value="${esc(s?.supplier_ref||'')}"></div>
          <div><label>Price (£, optional)</label><input id="supplierPrice${slot}" type="number" min="0" step="0.01" value="${esc(s?.unit_price??'')}"></div>
          <div><label>Pack size</label><input id="supplierPack${slot}" type="number" inputmode="decimal" min="0.01" step="0.01" value="${esc(s?.pack_size??1)}"></div>
          <div><label>Lead time (days)</label><input id="supplierLead${slot}" type="number" min="0" step="1" value="${esc(s?.lead_time_days??'')}"></div>
          <div><label>Notes</label><input id="supplierNotes${slot}" value="${esc(s?.notes||'')}"></div>
        </div>
      </div>`;
    };
    showModal(`<header><div><h2>Suppliers 1–3</h2><div class="muted">${esc(item.name)}</div></div><button class="close" data-close>×</button></header>
      <form id="supplierForm"><p class="muted">Save up to three suppliers for this item. Start typing to reuse a supplier already saved elsewhere; new names automatically become suggestions next time.</p>
      <datalist id="supplierNamesList">${globalSupplierNames().map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist>
      ${section(1)}${section(2)}${section(3)}
      <div class="actions"><button class="btn" type="submit">Save suppliers</button></div></form>`);
    document.getElementById('supplierForm').onsubmit=async e=>{
      e.preventDefault();
      const pref=num(document.querySelector('input[name="preferredSupplier"]:checked')?.value||1);
      try{
        for(let slot=1;slot<=3;slot++){
          const name=document.getElementById(`supplierName${slot}`).value.trim();
          const old=existing.find(x=>num(x.supplier_slot)===slot);
          if(!name){
            if(old){const {error}=await sb.from('item_suppliers').delete().eq('id',old.id);if(error)throw error;}
            continue;
          }
          const row={
            item_id:item.id,
            supplier_slot:slot,
            supplier_name:name,
            supplier_ref:document.getElementById(`supplierRef${slot}`).value.trim()||null,
            unit_price:document.getElementById(`supplierPrice${slot}`).value===''?null:num(document.getElementById(`supplierPrice${slot}`).value),
            pack_size:num(document.getElementById(`supplierPack${slot}`).value)||1,
            lead_time_days:document.getElementById(`supplierLead${slot}`).value===''?null:Math.round(num(document.getElementById(`supplierLead${slot}`).value)),
            notes:document.getElementById(`supplierNotes${slot}`).value.trim()||null,
            preferred:slot===pref,
            updated_at:new Date().toISOString()
          };
          const {error}=await sb.from('item_suppliers').upsert(row,{onConflict:'item_id,supplier_slot'});
          if(error)throw error;
        }
        await loadData({transactions:false});closeModal();setNotice('Suppliers updated.');render();
      }catch(err){setNotice(parseError(err),'error');}
    };
  }

  function itemFormHtml(i=null) {
    const categories=categoryNames();
    const currentCategory=String(i?.category||'');
    if(currentCategory && !categories.includes(currentCategory)) categories.push(currentCategory);
    categories.sort((a,b)=>a.localeCompare(b));
    return `<header><h2>${i?'Edit item':'Add new item'}</h2><button class="close" data-close>×</button></header><form id="itemForm"><div class="form-grid">
      <div><label>Item name</label><input id="newName" value="${esc(i?.name||'')}" required></div>
      <div><label>Item code</label><input id="newCode" value="${esc(i?.item_code||'')}" required></div>
      <div><label>QR value</label><input id="newQr" value="${esc(i?.qr_value||'')}" placeholder="Defaults to item code"><button class="btn ghost" id="generateQr" type="button" style="margin-top:.35rem">Generate code</button></div>
      <div><label>Category</label><select id="newCategory"><option value="">Uncategorised</option>${categories.map(c=>`<option value="${esc(c)}" ${currentCategory===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
      <div><label>Reorder level</label><input id="newReorder" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(i?.reorder_level??0)}"></div>
      <div><label>Unit cost (£, optional)</label><input id="newCost" type="number" step="0.01" min="0" value="${esc(i?.unit_cost??'')}"></div>
      <div><label>Default stock location</label><select id="defaultLocationName"><option value="">Not set</option>${locationNames().map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></div>
      <div><label>Default Bin Ref</label><input id="defaultBinRef" list="defaultBinList" placeholder="e.g. B12"><datalist id="defaultBinList"></datalist><div class="muted">Used automatically for Add Stock, Move destination and Receive Delivery. Controlled locations use the preset bin dropdown; you can still change it each time.</div></div>
      <div class="full"><label>Item photo (optional)</label><input id="newPhoto" type="file" accept="image/*" capture="environment"><div id="photoEditStatus" class="muted photo-edit-status">Take/select a photo, then crop/rotate it before saving. The saved copy is automatically resized and compressed to reduce storage and mobile data.</div></div>
      ${i?'':`<div><label>Opening stock (optional)</label><input id="openingQty" type="number" inputmode="decimal" min="0" step="0.01" value="0"></div><div><label>Opening location</label><select id="openingLocationName"><option value="">None</option>${locationNames().map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></div><div><label>Opening Bin Ref (optional)</label><input id="openingBinRef" list="openingBinList" placeholder="e.g. B12"><datalist id="openingBinList"></datalist></div>`}
      </div><div class="actions"><button class="btn" type="submit">${i?'Save changes':'Create item'}</button></div></form>`;
  }


  function openAddItem() { showModal(itemFormHtml()); bindItemForm(null); }
  function openEditItem(i) { showModal(itemFormHtml(i)); bindItemForm(i); }

  function bindItemForm(existing) {
    const name=document.getElementById('newName'),code=document.getElementById('newCode'),qr=document.getElementById('newQr');
    const defaultLocation=document.getElementById('defaultLocationName'),defaultBin=document.getElementById('defaultBinRef');
    let editedPhoto=null;
    const photoInput=document.getElementById('newPhoto'),photoStatus=document.getElementById('photoEditStatus');
    if(photoInput) photoInput.onchange=async()=>{
      const file=photoInput.files?.[0];editedPhoto=null;if(!file)return;
      if(photoStatus)photoStatus.textContent='Opening photo editor…';
      try{
        const edited=await editItemPhoto(file);
        if(edited){editedPhoto=edited;if(photoStatus)photoStatus.textContent=`Photo ready · ${Math.round(edited.size/1024)} KB · resized/compressed before upload.`;}
        else {photoInput.value='';if(photoStatus)photoStatus.textContent='Photo cancelled — no new photo will be uploaded.';}
      }catch(err){photoInput.value='';if(photoStatus)photoStatus.textContent='Photo could not be edited. Choose or take another photo.';}
    };
    const gen=document.getElementById('generateQr'); if(gen) gen.onclick=()=>{const v=`ITM-${Date.now().toString(36).toUpperCase().slice(-7)}`;qr.value=v;if(!code.value.trim())code.value=v;};
    bindBinRefSuggestions('defaultLocationName','defaultBinRef','defaultBinList',activeLocations());
    if(existing){
      const p=itemDefaultPosition(existing);
      if(p){
        defaultLocation.value=p.location_name;
        defaultLocation.dispatchEvent(new Event('change',{bubbles:true}));
        setTimeout(()=>{defaultBin.value=effectiveBinCode(p)||'';},0);
      }
    }
    if(!existing) {
      let codeTouched=false,qrTouched=false;
      code.oninput=()=>{codeTouched=true;if(!qrTouched)qr.value=code.value};qr.oninput=()=>qrTouched=true;name.oninput=()=>{if(!codeTouched){code.value=name.value;if(!qrTouched)qr.value=name.value;}};
      const openingLocation=document.getElementById('openingLocationName');
      if(openingLocation) bindBinRefSuggestions('openingLocationName','openingBinRef','openingBinList',activeLocations());
    }
    document.getElementById('itemForm').onsubmit=async e=>{
      e.preventDefault();
      let defaultLocationId=null;
      try{
        const defaultName=defaultLocation?.value||'';
        const defaultRef=defaultBin?.value||'';
        if(defaultName) defaultLocationId=await ensurePosition(defaultName,defaultRef);
      }catch(err){
        setNotice(`Could not save the default stock location: ${parseError(err)}`,'error');
        return;
      }
      const row={name:name.value.trim(),item_code:code.value.trim(),qr_value:(qr.value.trim()||code.value.trim()),category:document.getElementById('newCategory').value||null,reorder_level:num(document.getElementById('newReorder').value),unit_cost:document.getElementById('newCost').value===''?null:num(document.getElementById('newCost').value),default_location_id:defaultLocationId};
      let itemId=existing?.id;
      if(existing){const {error}=await sb.from('items').update(row).eq('id',existing.id);if(error){setNotice(parseError(error),'error');closeModal();render();return;}}
      else {row.created_by=S.profile.id;const {data,error}=await sb.from('items').insert(row).select('id').single();if(error){setNotice(parseError(error),'error');closeModal();render();return;}itemId=data.id;}
      const photo=editedPhoto;
      if(photo){try{await uploadItemPhoto(itemId,photo);}catch(err){setNotice(`Item saved, but photo upload failed: ${parseError(err)}`,'error');}}
      if(!existing){
        const opening=num(document.getElementById('openingQty').value),locationName=document.getElementById('openingLocationName').value,binRef=document.getElementById('openingBinRef').value;
        if(opening>0&&!locationName){setNotice('Item created, but opening stock was not added because no location was selected.','error');}
        else if(opening>0){try{const loc=await ensurePosition(locationName,binRef);const {error}=await sb.rpc('apply_stock_transaction',{p_item_id:itemId,p_type:'ADD',p_quantity:opening,p_from_location_id:null,p_to_location_id:loc,p_new_quantity:null,p_reason:'Opening stock',p_reference:null,p_notes:null});if(error)throw error;}catch(err){setNotice(`Item created, but opening stock failed: ${parseError(err)}`,'error');}}
      }
      await loadData();closeModal();if(!S.notice||S.notice.type!=='error')setNotice(existing?'Item updated.':'New item created.');render();
    };
  }

  function openCategoryManager() {
    if(!canAdmin())return;
    const active=S.categories.filter(c=>c.active);
    showModal(`<header><h2>Categories</h2><button class="close" data-close>×</button></header><p class="muted">Categories appear in the item form and as a filter on manual search.</p><div class="item-list">${active.map(c=>`<div class="item-row"><div><strong>${esc(c.name)}</strong></div><button class="btn danger" data-hide-category="${c.id}">Hide</button></div>`).join('')||'<div class="notice">No categories configured.</div>'}</div><form id="addCategoryForm" style="margin-top:1rem"><label>Add category</label><div class="toolbar"><input id="newCategoryName" placeholder="e.g. PPE" required><button class="btn" type="submit">Add</button></div></form>`);
    document.querySelectorAll('[data-hide-category]').forEach(b=>b.onclick=async()=>{
      const {error}=await sb.from('inventory_categories').update({active:false}).eq('id',b.dataset.hideCategory);
      if(error){setNotice(parseError(error),'error');render();return;}
      await loadData({transactions:false});openCategoryManager();
    });
    document.getElementById('addCategoryForm').onsubmit=async e=>{
      e.preventDefault();const name=document.getElementById('newCategoryName').value.trim();if(!name)return;
      const existing=S.categories.find(c=>c.name.toLowerCase()===name.toLowerCase());
      let error;
      if(existing)({error}=await sb.from('inventory_categories').update({active:true}).eq('id',existing.id));
      else ({error}=await sb.from('inventory_categories').insert({name,sort_order:100}));
      if(error){setNotice(parseError(error),'error');render();return;}
      await loadData({transactions:false});openCategoryManager();
    };
  }

  async function canvasJpegFile(canvas,name,targetBytes=360000) {
    let quality=0.82,blob=null;
    for(let n=0;n<5;n++){
      blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(!blob||blob.size<=targetBytes||quality<=0.58)break;
      quality-=0.07;
    }
    if(!blob)throw new Error('Could not process photo');
    return new File([blob],`${String(name||'item-photo').replace(/\.[^.]+$/,'')}.jpg`,{type:'image/jpeg',lastModified:Date.now()});
  }

  async function editItemPhoto(file) {
    if(!file?.type?.startsWith('image/'))throw new Error('Choose an image file');
    const bitmap=await createImageBitmap(file);
    return await new Promise(resolve=>{
      const back=document.createElement('div');back.className='photo-editor-backdrop';
      back.innerHTML=`<div class="photo-editor"><header><div><h2>Crop item photo</h2><p class="muted">Drag to position · use zoom to crop · rotate if needed.</p></div><button class="close" id="photoCancelTop" type="button">×</button></header><div class="photo-editor-stage"><canvas id="photoEditCanvas"></canvas><div class="photo-crop-guide"></div></div><div class="photo-editor-controls"><label>Crop shape<select id="photoRatio"><option value="original">Original shape</option><option value="1">Square</option><option value="1.333333">Landscape 4:3</option><option value="0.75">Portrait 3:4</option></select></label><label>Zoom <strong id="photoZoomValue">1.0×</strong><input id="photoZoom" type="range" min="1" max="3" step="0.05" value="1"></label></div><div class="actions"><button class="btn ghost" id="photoRotate" type="button">Rotate 90°</button><button class="btn ghost" id="photoReset" type="button">Reset</button><button class="btn secondary" id="photoRetake" type="button">Cancel / retake</button><button class="btn" id="photoUse" type="button">Use cropped photo</button></div><p class="muted photo-size-note">Saved photo will be limited to 1280 px on the longest edge and compressed for low data/storage use.</p></div>`;
      document.body.appendChild(back);
      const canvas=back.querySelector('#photoEditCanvas'),ctx=canvas.getContext('2d');
      const ratioSel=back.querySelector('#photoRatio'),zoomEl=back.querySelector('#photoZoom'),zoomValue=back.querySelector('#photoZoomValue');
      let rotation=0,zoom=1,offX=0,offY=0,drag=false,lastX=0,lastY=0;
      const sourceRatio=bitmap.width/bitmap.height;
      function rotatedSize(){return rotation%180===0?[bitmap.width,bitmap.height]:[bitmap.height,bitmap.width]}
      function cropRatio(){return ratioSel.value==='original'?(rotation%180===0?sourceRatio:1/sourceRatio):Number(ratioSel.value)}
      function setCanvasSize(){const r=cropRatio(),maxW=Math.min(720,Math.max(320,window.innerWidth-44)),maxH=Math.min(520,Math.max(280,window.innerHeight*0.52));let w=maxW,h=w/r;if(h>maxH){h=maxH;w=h*r}canvas.width=Math.max(240,Math.round(w));canvas.height=Math.max(240,Math.round(h));draw()}
      function clampOffsets(){const [rw,rh]=rotatedSize(),base=Math.max(canvas.width/rw,canvas.height/rh),sc=base*zoom;const dw=rw*sc,dh=rh*sc;offX=clamp(offX,-Math.max(0,(dw-canvas.width)/2),Math.max(0,(dw-canvas.width)/2));offY=clamp(offY,-Math.max(0,(dh-canvas.height)/2),Math.max(0,(dh-canvas.height)/2))}
      function draw(){clampOffsets();const [rw,rh]=rotatedSize(),base=Math.max(canvas.width/rw,canvas.height/rh),sc=base*zoom;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(canvas.width/2+offX,canvas.height/2+offY);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(bitmap,-bitmap.width*sc/2,-bitmap.height*sc/2,bitmap.width*sc,bitmap.height*sc);ctx.restore()}
      function finish(value){bitmap.close?.();back.remove();resolve(value)}
      canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture?.(e.pointerId)});
      canvas.addEventListener('pointermove',e=>{if(!drag)return;offX+=e.clientX-lastX;offY+=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;draw()});
      canvas.addEventListener('pointerup',()=>drag=false);canvas.addEventListener('pointercancel',()=>drag=false);
      zoomEl.oninput=()=>{zoom=Number(zoomEl.value);zoomValue.textContent=`${zoom.toFixed(1)}×`;draw()};
      ratioSel.onchange=()=>{offX=offY=0;setCanvasSize()};
      back.querySelector('#photoRotate').onclick=()=>{rotation=(rotation+90)%360;offX=offY=0;setCanvasSize()};
      back.querySelector('#photoReset').onclick=()=>{rotation=0;zoom=1;offX=offY=0;zoomEl.value='1';zoomValue.textContent='1.0×';ratioSel.value='original';setCanvasSize()};
      back.querySelector('#photoCancelTop').onclick=()=>finish(null);back.querySelector('#photoRetake').onclick=()=>finish(null);
      back.querySelector('#photoUse').onclick=async()=>{
        const ratio=canvas.width/canvas.height,max=1280;let ow,oh;if(ratio>=1){ow=max;oh=Math.round(max/ratio)}else{oh=max;ow=Math.round(max*ratio)}
        const out=document.createElement('canvas');out.width=ow;out.height=oh;const ox=out.getContext('2d');
        const [rw,rh]=rotatedSize(),base=Math.max(canvas.width/rw,canvas.height/rh),displayScale=base*zoom,outputScale=ow/canvas.width;
        ox.save();ox.translate(ow/2+offX*outputScale,oh/2+offY*outputScale);ox.rotate(rotation*Math.PI/180);const sc=displayScale*outputScale;ox.drawImage(bitmap,-bitmap.width*sc/2,-bitmap.height*sc/2,bitmap.width*sc,bitmap.height*sc);ox.restore();
        try{const f=await canvasJpegFile(out,file.name,360000);finish(f)}catch(_){finish(null)}
      };
      setCanvasSize();
    });
  }

  async function compressImage(file) {
    if(!file?.type?.startsWith('image/'))return file;
    try{
      const img=await createImageBitmap(file),max=1280,scale=Math.min(1,max/Math.max(img.width,img.height));
      if(scale===1&&file.type==='image/jpeg'&&file.size<=360000){img.close?.();return file}
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);img.close?.();
      return await canvasJpegFile(canvas,file.name,360000);
    }catch(_){return file}
  }

  async function uploadItemPhoto(itemId,file) {
    const upload=await compressImage(file);
    const path=`${itemId}/${Date.now()}-${slug(upload.name)}`;
    const {error}=await sb.storage.from('item-photos').upload(path,upload,{upsert:false,contentType:upload.type}); if(error)throw error;
    const {error:e2}=await sb.from('items').update({primary_photo_path:path,updated_at:new Date().toISOString()}).eq('id',itemId); if(e2)throw e2;
  }







  async function signedUrl(bucket,path,seconds=900){if(!path||S.offline||!navigator.onLine)return null;const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,seconds);return error?null:data?.signedUrl||null;}

  function printQr(item) {
    showModal(`<header><h2>QR label</h2><button class="close" data-close>×</button></header><div class="print-target" style="text-align:center"><h3>${esc(item.name)}</h3><div id="qrBox" class="qrprint"></div><div>${esc(item.qr_value)}</div><div class="no-print actions"><button class="btn" id="doPrint">Print</button></div></div>`);
    const box=document.getElementById('qrBox');if(window.QRCode)new QRCode(box,{text:item.qr_value,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});document.getElementById('doPrint').onclick=()=>window.print();
  }

  function showModal(html) {
    let old=document.getElementById('modalBackdrop'); if(old)old.remove();
    const div=document.createElement('div');div.id='modalBackdrop';div.className='modal-backdrop';div.innerHTML=`<div class="modal">${html}</div>`;document.body.appendChild(div);div.onclick=e=>{if(e.target===div||e.target.closest('[data-close]'))closeModal();};
  }
  function closeModal(){document.getElementById('modalBackdrop')?.remove();}

  if ('serviceWorker' in navigator) {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }

  window.addEventListener('offline',()=>{
    if(!S.session)return;
    S.offline=true;stopRealtime();saveOfflineSnapshot();setNotice('Connection lost. Offline stock mode is active.');render();
  });
  window.addEventListener('online',()=>{
    if(!S.session)return;
    S.offline=false;setNotice('Connection restored. Checking pending offline stock actions…');render();setTimeout(syncOfflineQueue,200);
  });

  bootstrap();
})();
