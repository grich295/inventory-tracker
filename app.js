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
    safetyDocs: [],
    safetyAcks: [],
    riskHistory: [],
    categories: [],
    itemSuppliers: [],
    purchaseOrders: [],
    backupRunning: false,
    backupStatus: '',
    orderTab: 'suggested',
    page: 'dashboard',
    search: '',
    categoryFilter: '',
    selectedItemId: null,
    scanner: null,
    chart: null,
    liveChannel: null,
    liveTimer: null,
    notice: null,
    passwordMode: false,
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
  const riskRating = i => String(i?.risk_rating || 'NONE').toUpperCase();
  const riskLabel = r => ({NONE:'None',GREEN:'Green · Low',AMBER:'Amber · Medium',RED:'Red · High'})[String(r||'NONE').toUpperCase()] || 'None';
  const riskClass = r => `risk-${String(r||'NONE').toLowerCase()}`;
  const riskIntervalDays = r => ({GREEN:365,AMBER:90,RED:30})[String(r||'NONE').toUpperCase()] || null;
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
  const itemTotal = itemId => S.balances.filter(b => b.item_id === itemId).reduce((a,b) => a + num(b.quantity), 0);
  const itemPositions = itemId => S.balances.filter(b => b.item_id === itemId && num(b.quantity) > 0).sort((a,b) => num(b.quantity)-num(a.quantity));
  const orderRemaining = o => Math.max(0, num(o.quantity_ordered) - num(o.quantity_received));
  const openOrdersForItem = itemId => S.purchaseOrders.filter(o=>o.item_id===itemId && ['OPEN','PART_RECEIVED'].includes(o.status));
  const itemOnOrder = itemId => openOrdersForItem(itemId).reduce((a,o)=>a+orderRemaining(o),0);
  const suppliersForItem = itemId => S.itemSuppliers.filter(s=>s.item_id===itemId).sort((a,b)=>num(a.supplier_slot)-num(b.supplier_slot));
  const preferredSupplier = itemId => suppliersForItem(itemId).find(s=>s.preferred) || suppliersForItem(itemId)[0] || null;
  const userName = id => id ? (byId(S.profiles,id)?.display_name || 'Unknown user') : 'Legacy import';
  const itemName = id => byId(S.items,id)?.name || 'Unknown item';
  const locName = id => locationLabel(byId(S.locations,id));
  const slug = v => String(v || '').trim().replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'file';
  const fileExt = f => (f.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g,'');

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

  async function loadData({transactions=true, docs=true}={}) {
    const [profiles, items, locations, balances, itemSuppliers, purchaseOrders, categories, safetyAcks, riskHistory] = await Promise.all([
      fetchAll('profiles','*','display_name',true),
      fetchAll('items','*','name',true),
      fetchAll('stock_locations','*','location_name',true),
      fetchAll('stock_balances','*'),
      fetchAll('item_suppliers','*','supplier_slot',true),
      fetchAll('purchase_orders','*','ordered_at',false),
      fetchAll('inventory_categories','*','sort_order',true),
      fetchAll('safety_acknowledgements','*','acknowledged_at',false),
      fetchAll('risk_rating_history','*','changed_at',false)
    ]);
    S.profiles = profiles; S.items = items; S.locations = locations; S.balances = balances;
    S.itemSuppliers = itemSuppliers; S.purchaseOrders = purchaseOrders; S.categories = categories;
    S.safetyAcks = safetyAcks; S.riskHistory = riskHistory;
    S.profile = byId(S.profiles, S.session?.user?.id) || S.profile;
    if (transactions) S.transactions = await fetchAll('transactions','*','occurred_at',false);
    if (docs) S.safetyDocs = await fetchAll('safety_documents','*','uploaded_at',false);
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
        if(S.page!=='scan' && !document.getElementById('modalBackdrop')) render();
      }catch(e){console.warn('Live refresh failed',e);}
    },350);
  }

  function startRealtime() {
    if(S.liveChannel||!S.session)return;
    let c=sb.channel('inventory-live');
    for(const table of ['stock_balances','transactions','items','stock_locations','safety_documents','profiles','item_suppliers','purchase_orders','inventory_categories','safety_acknowledgements','risk_rating_history']){
      c=c.on('postgres_changes',{event:'*',schema:'public',table},queueLiveRefresh);
    }
    S.liveChannel=c.subscribe();
  }

  async function bootstrap() {
    const { data: { session } } = await sb.auth.getSession();
    S.session = session;
    const hash = window.location.hash;
    const qs = window.location.search;
    S.passwordMode = hash.includes('type=recovery') || hash.includes('type=invite') || qs.includes('type=recovery') || qs.includes('type=invite');
    if (S.session) {
      try { await loadData(); startRealtime(); } catch (e) { setNotice(parseError(e),'error'); }
    }
    render();
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    S.session = session;
    if (event === 'PASSWORD_RECOVERY') S.passwordMode = true;
    if (session) {
      try { await loadData(); startRealtime(); } catch (e) { S.notice = {message:parseError(e),type:'error'}; }
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
      const { error } = await sb.auth.updateUser({password:a});
      if (error) { S.notice={message:parseError(error),type:'error'}; return renderPasswordUpdate(); }
      S.passwordMode=false; history.replaceState({},'',location.pathname); setNotice('Password updated.'); render();
    };
  }

  function shellHtml(content) {
    const nav = [
      ['dashboard','Dashboard'],['scan','Scan'],['items','Items'],['locations','Locations'],['orders','Orders'],['reports','Reports'],['history','History']
    ];
    if (S.profile?.role === 'admin') nav.push(['users','Users'],['backup','Backup']);
    return `<div class="shell">
      <div class="topbar"><div><div class="brand">Inventory Tracker</div><div class="userline">${esc(S.profile?.display_name || S.session.user.email)} · ${esc(S.profile?.role || 'staff')} · v6.3</div></div><button class="btn secondary" id="logoutBtn">Sign out</button></div>
      <div class="nav">${nav.map(([p,t])=>`<button data-page="${p}" class="${S.page===p?'active':''}">${t}</button>`).join('')}</div>
      <main class="content">${noticeHtml()}${content}</main>
    </div>`;
  }

  function bindShell() {
    document.getElementById('logoutBtn').onclick = () => sb.auth.signOut();
    document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { S.page=b.dataset.page; S.selectedItemId=null; render(); });
  }

  function pageHtml() {
    if (S.page==='scan') return scanHtml();
    if (S.page==='items') return itemsHtml();
    if (S.page==='locations') return locationsHtml();
    if (S.page==='orders') return ordersHtml();
    if (S.page==='reports') return reportsHtml();
    if (S.page==='history') return historyHtml();
    if (S.page==='users') return usersHtml();
    if (S.page==='backup') return backupHtml();
    return dashboardHtml();
  }

  function dashboardHtml() {
    const active = S.items.filter(i=>i.active);
    const totalUnits = S.balances.reduce((a,b)=>a+num(b.quantity),0);
    const low = active.filter(i => num(i.reorder_level)>0 && itemTotal(i.id)<=num(i.reorder_level));
    const mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0);
    const usedMonth = S.transactions.filter(t=>t.transaction_type==='USE' && new Date(t.occurred_at)>=mStart).reduce((a,t)=>a+num(t.quantity),0);
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
      ${canAdmin()&&backupDue()?`<div class="notice warn" style="margin-top:1rem"><strong>Admin backup due.</strong> ${lastBackupAt()?`Last backup: ${esc(fmtDate(lastBackupAt()))}.`:'No app backup has been recorded on this device yet.'} <button class="btn ghost" data-go="backup">Open Backup</button></div>`:''}
      ${low.length?`<div class="card"><h3>Low stock</h3><div class="item-list">${low.slice(0,8).map(itemRowHtml).join('')}</div></div>`:''}
      <div class="card" style="margin-top:1rem"><h3>Recent activity</h3>${transactionTable(recent)}</div>`;
  }

  function scanHtml() {
    return `<div class="scan-box">
      <div class="card"><h2>Scan Stock QR</h2><p class="muted">Point the rear camera at the QR code on the bin or item label. Hold the code steady inside the scan area.</p>
        <div id="reader" class="scanner live-scanner">
          <video id="qrVideo" playsinline muted autoplay></video>
          <canvas id="qrCanvas" class="hidden"></canvas>
          <div class="qr-guide" aria-hidden="true"></div>
        </div>
        <div id="scanStatus" class="notice">Starting rear camera…</div>
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
    return `<div class="item-row" data-item="${i.id}"><div><div class="item-title">${esc(i.name)}</div><div class="muted">${esc(i.item_code)}${i.category?' · '+esc(i.category):''}</div><div class="muted">${pos || 'No stock location set'}</div>${riskRating(i)!=='NONE'?`<span class="badge risk ${riskClass(riskRating(i))}">${esc(riskLabel(riskRating(i)))}</span> `:''}${i.is_chemical?'<span class="badge chemical">Chemical</span> ':''}${low?'<span class="badge low">Low stock</span> ':''}${onOrder>0?`<span class="badge order">On order ${qty(onOrder)}</span>`:''}</div><div class="qty">${qty(total)}</div></div>`;
  }

  function categoryNames() {
    const configured=S.categories.filter(c=>c.active).map(c=>c.name);
    const existing=S.items.map(i=>String(i.category||'').trim()).filter(Boolean);
    return [...new Set([...configured,...existing])].sort((a,b)=>a.localeCompare(b));
  }

  function filteredItems() {
    const q=S.search.toLowerCase().trim();
    return S.items.filter(i=>i.active).filter(i=>{
      if(S.categoryFilter && String(i.category||'')!==S.categoryFilter) return false;
      if(!q) return true;
      const positionText=itemPositions(i.id).map(b=>locationLabel(byId(S.locations,b.location_id))).join(' ');
      return [i.name,i.item_code,i.qr_value,i.category,positionText].join(' ').toLowerCase().includes(q);
    });
  }

  function itemsHtml() {
    const filtered=filteredItems();
    return `<div class="toolbar"><input id="itemSearch" value="${esc(S.search)}" placeholder="Search item, code, location or bin"><select id="categoryFilter"><option value="">All categories</option>${categoryNames().map(c=>`<option value="${esc(c)}" ${S.categoryFilter===c?'selected':''}>${esc(c)}</option>`).join('')}</select>${canManage()?'<button class="btn" id="addItemBtn">Add new item</button>':''}${canAdmin()?'<button class="btn ghost" id="manageCategoriesBtn">Categories</button>':''}</div>
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
      return `<div class="card"><div class="muted">Location</div><div class="item-title" style="margin:.2rem 0 .45rem">${esc(name)}</div><div class="stat">${qty(units)}</div><div class="muted">${items.size} item${items.size===1?'':'s'} · total units</div>${canManage()?`<div class="actions"><button class="btn ghost" data-rename-location="${esc(name)}">Rename</button><button class="btn danger" data-delete-location="${esc(name)}">Delete</button></div>`:''}</div>`;
    }).join('');
    return `<div class="toolbar">${canManage()?'<button class="btn" id="addLocationBtn">Add location</button>':''}</div>
      <div class="card"><h2>Locations</h2><p class="muted">Create the main places where stock is held. <strong>Bin Ref is not set up here.</strong> When you add, move or adjust an item, choose the Location and type its Bin Ref manually.</p></div>
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
        .filter(t=>t.transaction_type==='USE'&&t.item_id===i.id&&new Date(t.occurred_at)>=w.start&&new Date(t.occurred_at)<w.end)
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
    let list=S.transactions.filter(t=>t.transaction_type==='USE');
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

    const chemicals=S.items.filter(i=>i.active&&i.is_chemical);
    const chemicalRows=chemicals.map(i=>{
      const docs=S.safetyDocs.filter(d=>d.item_id===i.id&&d.active);
      const types=new Set(docs.map(d=>d.document_type));
      const reviews=docs.map(d=>d.review_date).filter(Boolean).sort();
      const kept=itemPositions(i.id).map(b=>locationLabel(byId(S.locations,b.location_id))).join(' · ')||'No stock';
      return `<tr data-item="${i.id}"><td>${esc(i.name)}</td><td>${qty(itemTotal(i.id))}</td><td>${esc(kept)}</td><td>${types.has('RISK_ASSESSMENT')?'✓':'—'}</td><td>${types.has('SSW')?'✓':'—'}</td><td>${types.has('SDS_MSDS')?'✓':'—'}</td><td>${types.has('COSHH')?'✓':'—'}</td><td>${esc(reviews[0]||'—')}</td></tr>`;
    }).join('');

    const safetyRated=S.items.filter(i=>i.active&&riskRating(i)!=='NONE');
    const safetyRows=safetyRated.map(i=>{
      const docs=activeSafetyDocs(i.id);
      const ackCount=S.safetyAcks.filter(a=>a.item_id===i.id).length;
      return `<tr data-item="${i.id}"><td>${esc(i.name)}</td><td><span class="badge risk ${riskClass(riskRating(i))}">${esc(riskLabel(riskRating(i)))}</span></td><td>${docs.length}</td><td>${ackCount}</td><td>${esc(fmtDate(i.risk_rating_updated_at))}</td></tr>`;
    }).join('');
    const recentAcks=S.safetyAcks.slice(0,100).map(a=>`<tr><td>${fmtDate(a.acknowledged_at)}</td><td>${esc(userName(a.user_id))}</td><td>${esc(itemName(a.item_id))}</td><td><span class="badge risk ${riskClass(a.risk_rating)}">${esc(riskLabel(a.risk_rating))}</span></td><td>${esc(a.acknowledgement_reason||'—')}</td></tr>`).join('');

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
    <div class="card" style="margin-top:1rem"><h3>Detailed usage</h3>${transactionTable(list)}</div>
    ${canAdmin()?`<div class="card" style="margin-top:1rem"><h3>Safety acknowledgement evidence</h3><p class="muted">Downloadable evidence of safety reminders acknowledged by users. This supports, but does not replace, main training and instruction.</p><div class="actions"><button class="btn secondary" id="exportSafetyCsv">Safety CSV</button><button class="btn" id="exportSafetyExcel">Safety Excel</button></div><div class="table-wrap" style="margin-top:.8rem"><table><thead><tr><th>Date/time</th><th>User</th><th>Item</th><th>Risk</th><th>Reason</th></tr></thead><tbody>${recentAcks||'<tr><td colspan="5">No acknowledgements recorded yet.</td></tr>'}</tbody></table></div></div><div class="card" style="margin-top:1rem"><h3>Risk-rated items</h3><div class="table-wrap"><table><thead><tr><th>Item</th><th>Risk</th><th>Safety docs</th><th>Acknowledgements</th><th>Rating last changed</th></tr></thead><tbody>${safetyRows||'<tr><td colspan="5">No items currently have a risk rating.</td></tr>'}</tbody></table></div></div>`:''}
    ${chemicals.length?`<div class="card" style="margin-top:1rem"><h3>Chemical register</h3><p class="muted">Current quantity, exact storage locations and whether key safety documents are on file.</p><div class="table-wrap"><table><thead><tr><th>Chemical</th><th>Stock</th><th>Where kept</th><th>Risk assessment</th><th>SSW</th><th>SDS/MSDS</th><th>COSHH</th><th>Next review</th></tr></thead><tbody>${chemicalRows}</tbody></table></div></div>`:''}`;
  }

  function historyHtml() {
    return `<div class="card"><h2>Full audit history</h2><p class="muted">Adds, uses, moves and adjustments are all recorded with the user and location.</p>${transactionTable(S.transactions)}</div>`;
  }

  function transactionTable(list) {
    const rows=list.slice(0,500).map(t=>`<tr><td>${fmtDate(t.occurred_at)}</td><td>${esc(itemName(t.item_id))}</td><td><span class="badge">${esc(t.transaction_type)}</span></td><td>${qty(t.quantity)}</td><td>${esc(userName(t.user_id))}</td><td>${esc(locName(t.from_location_id))}</td><td>${esc(locName(t.to_location_id))}</td><td>${esc(t.reason||t.notes||'—')}</td></tr>`).join('');
    return `<div class="table-wrap"><table><thead><tr><th>Date/time</th><th>Item</th><th>Action</th><th>Qty</th><th>User</th><th>From</th><th>To</th><th>Reason / note</th></tr></thead><tbody>${rows||'<tr><td colspan="8">No transactions yet.</td></tr>'}</tbody></table></div>${list.length>500?'<p class="muted">Showing the newest 500 rows.</p>':''}`;
  }

  function usersHtml() {
    if(S.profile?.role!=='admin') return '<div class="notice error">Admin access required.</div>';
    return `<div class="split"><div class="card"><h2>Users</h2><p class="muted">Each person has their own login, password and audit history.</p><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Change role</th></tr></thead><tbody>${S.profiles.map(p=>`<tr><td>${esc(p.display_name)}</td><td>${esc(p.role)}</td><td><select data-role-user="${p.id}" ${p.id===S.profile.id?'disabled':''}><option ${p.role==='staff'?'selected':''}>staff</option><option ${p.role==='manager'?'selected':''}>manager</option><option ${p.role==='admin'?'selected':''}>admin</option></select></td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h2>Invite user</h2><p class="muted">Uses the optional Supabase Edge Function included with this project. The invited person sets their own password.</p><form id="inviteForm"><label>Name</label><input id="inviteName" required><label>Email</label><input id="inviteEmail" type="email" required><label>Role</label><select id="inviteRole"><option>staff</option><option>manager</option><option>admin</option></select><div class="actions"><button class="btn" type="submit">Send invite</button></div></form></div></div>`;
  }


  function backupHtml() {
    if(!canAdmin()) return '<div class="notice error">Admin access required.</div>';
    const last=lastBackupAt();
    const status=S.backupStatus
      ? `<div class="notice ${S.backupRunning?'':'success'}">${esc(S.backupStatus)}</div>`
      : '';
    return `<div class="card">
      <h2>Admin backup</h2>
      <p class="muted">Creates a dated ZIP backup on this device. It includes the inventory database records and, by default, uploaded item photos and safety documents.</p>
      <div class="notice"><strong>Not included:</strong> user passwords, Supabase database password, publishable/secret keys, or authentication secrets.</div>
      <div class="grid cards" style="margin-top:1rem">
        <div class="card"><div class="muted">Last backup on this device</div><div>${last?esc(fmtDate(last)):'Never'}</div></div>
        <div class="card"><div class="muted">Reminder</div><div>${backupDue()?'Backup due':'Up to date'}</div></div>
      </div>
      <label class="ack-check" style="margin-top:1rem"><input id="backupFiles" type="checkbox" checked> Include item photos and safety-document files</label>
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
    'safety_documents',
    'safety_acknowledgements',
    'risk_rating_history'
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
      app_version:'6.3',
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
      const docs=JSON.parse(await dbFolder.file('safety_documents.json').async('string'));

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

      for(const doc of docs){
        const path=String(doc.storage_path||'').trim();
        const key=`safety-documents:${path}`;
        if(path && !seen.has(key)){
          seen.add(key);
          targets.push({bucket:'safety-documents',path,folder:'safety-documents'});
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
Uploaded item photos and safety documents are included when requested and accessible.

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
    if(S.page==='reports') bindReports();
    if(S.page==='users') bindUsers();
    if(S.page==='backup') bindBackup();
  }

  function bindScan() {
    const find=()=>findScanned(document.getElementById('scanText').value.trim());
    document.getElementById('scanFind').onclick=find;
    document.getElementById('scanText').onkeydown=e=>{if(e.key==='Enter') find();};
    document.getElementById('stopScan').onclick=stopScanner;

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
          let decoder=document.getElementById('photoQrDecoder');
          if(!decoder) {
            decoder=document.createElement('div');
            decoder.id='photoQrDecoder';
            decoder.className='hidden';
            document.body.appendChild(decoder);
          }
          S.scanner=new Html5Qrcode('photoQrDecoder', qrScannerOptions());
          const decoded=await S.scanner.scanFile(file,true);
          if(status) status.textContent='QR found.';
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
        status.textContent='Starting rear camera…';
      }

      const stream=await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{
          facingMode:{ideal:'environment'},
          width:{ideal:1920},
          height:{ideal:1080},
          focusMode:{ideal:'continuous'}
        }
      });

      S.cameraStream=stream;
      video.srcObject=stream;
      await video.play();

      if(status) {
        status.className='notice';
        status.textContent='Camera ready — hold the QR steady and bring it fairly close.';
      }

      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      let lastScan=0;
      let detector=null;

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

        if(ts-lastScan < 90) {
          S.scanFrame=requestAnimationFrame(scanFrame);
          return;
        }
        lastScan=ts;

        try {
          let decoded='';

          // Try the browser's native QR detector first when available.
          if(detector) {
            const found=await detector.detect(video);
            if(found?.length) decoded=String(found[0].rawValue||'').trim();
          }

          // Cross-browser fallback: read the centre of the video with jsQR.
          if(!decoded && window.jsQR) {
            const vw=video.videoWidth, vh=video.videoHeight;
            const crop=Math.floor(Math.min(vw,vh)*0.88);
            const sx=Math.floor((vw-crop)/2);
            const sy=Math.floor((vh-crop)/2);
            const out=Math.min(900,crop);

            canvas.width=out;
            canvas.height=out;
            ctx.drawImage(video,sx,sy,crop,crop,0,0,out,out);
            const image=ctx.getImageData(0,0,out,out);
            const code=jsQR(image.data,image.width,image.height,{
              inversionAttempts:'attemptBoth'
            });
            if(code?.data) decoded=String(code.data).trim();
          }

          if(decoded) {
            if(status) {
              status.className='notice success';
              status.textContent='QR found.';
            }
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
    const manage=document.getElementById('manageCategoriesBtn'); if(manage) manage.onclick=openCategoryManager;
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
          <div><label>Quantity ordered</label><input id="orderQty" type="number" min="0.001" step="0.001" value="${esc(suggested)}" required></div>
          <div><label>Supplier</label><select id="orderSupplier"><option value="">Manual supplier</option>${suppliers.map(s=>`<option value="${s.id}" ${preferred?.id===s.id?'selected':''}>Supplier ${s.supplier_slot}: ${esc(s.supplier_name)}</option>`).join('')}</select></div>
          <div><label>Supplier name</label><input id="orderSupplierName" value="${esc(preferred?.supplier_name||'')}" required></div>
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
        <label>Received now</label><input id="receiveQty" type="number" min="0.001" max="${esc(remaining)}" step="0.001" value="${esc(remaining)}" required>
        <label>Put into location</label><select id="receiveLocation" required>${locationNameOptions(activeLocations())}</select>
        <label>Bin Ref (optional)</label><input id="receiveBin" list="receiveBinList" placeholder="e.g. B12"><datalist id="receiveBinList"></datalist>
        <label>Notes (optional)</label><textarea id="receiveNotes" rows="2" placeholder="Short delivery, damaged box, etc."></textarea>
        <div class="notice">If fewer than ${qty(remaining)} arrive, type the amount actually received. The balance will stay visible as <strong>Back order / Still on order</strong>.</div>
        <div class="actions"><button class="btn good" type="submit">Confirm receipt</button></div>
      </form>`);
    bindBinRefSuggestions('receiveLocation','receiveBin','receiveBinList',activeLocations());
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
        <label>Total ordered quantity</label><input id="editOrderQty" type="number" min="${esc(o.quantity_received)}" step="0.001" value="${esc(o.quantity_ordered)}" required>
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
    const sc=document.getElementById('exportSafetyCsv'); if(sc) sc.onclick=exportSafetyCSV;
    const sx=document.getElementById('exportSafetyExcel'); if(sx) sx.onclick=exportSafetyExcel;
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
      vals.push(S.transactions.filter(t=>t.transaction_type==='USE'&&t.item_id===selected&&new Date(t.occurred_at).getFullYear()===y&&new Date(t.occurred_at).getMonth()===m).reduce((a,t)=>a+num(t.quantity),0));
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
    const rows=[['Date/time','Item','Quantity','User','Location','Reason','Legacy']];
    list.forEach(t=>rows.push([t.occurred_at,itemName(t.item_id),num(t.quantity),userName(t.user_id),locName(t.from_location_id),t.reason||t.notes||'',t.legacy_import?'Yes':'No']));
    return rows;
  }

  function activityExportRows() {
    const list=activityTransactions();
    const rows=[['Date/time','Item','Action','Quantity','User','From','To','Reason','Legacy']];
    list.forEach(t=>rows.push([t.occurred_at,itemName(t.item_id),t.transaction_type,num(t.quantity),userName(t.user_id),locName(t.from_location_id),locName(t.to_location_id),t.reason||t.notes||'',t.legacy_import?'Yes':'No']));
    return rows;
  }

  function exportUsageCSV() { downloadCSV(`inventory-usage-${todayISO()}.csv`,usageExportRows()); }
  function exportActivityCSV() { downloadCSV(`inventory-activity-${todayISO()}.csv`,activityExportRows()); }
  function exportUsageExcel() { exportWorkbook(`inventory-usage-${todayISO()}.xlsx`,[['Usage',usageExportRows()]]); }
  function exportActivityExcel() { exportWorkbook(`inventory-activity-${todayISO()}.xlsx`,[['Activity',activityExportRows()]]); }

  function safetyAckExportRows() {
    const rows=[['Date/time','User','Item','Risk rating','Reason for reminder','Documents acknowledged','Acknowledgement statement']];
    S.safetyAcks.forEach(a=>{
      const docs=Array.isArray(a.documents_snapshot)?a.documents_snapshot:[];
      const docText=docs.map(d=>`${d.type||''}: ${d.title||''}${d.version?` v${d.version}`:''}${d.revision_date?` (${d.revision_date})`:''}`).join(' | ');
      rows.push([a.acknowledged_at,userName(a.user_id),itemName(a.item_id),a.risk_rating||'NONE',a.acknowledgement_reason||'',docText,a.statement||'']);
    });
    return rows;
  }

  function riskHistoryExportRows() {
    const rows=[['Date/time','Item','Old rating','New rating','Changed by','Reason']];
    S.riskHistory.forEach(r=>rows.push([r.changed_at,itemName(r.item_id),r.old_rating||'NONE',r.new_rating||'NONE',userName(r.changed_by),r.reason||'']));
    return rows;
  }

  function exportSafetyCSV() { downloadCSV(`safety-acknowledgements-${todayISO()}.csv`,safetyAckExportRows()); }
  function exportSafetyExcel() { exportWorkbook(`safety-evidence-${todayISO()}.xlsx`,[['Acknowledgements',safetyAckExportRows()],['Risk Rating Changes',riskHistoryExportRows()]]); }

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
    document.querySelectorAll('[data-role-user]').forEach(sel=>sel.onchange=async()=>{
      const {error}=await sb.from('profiles').update({role:sel.value}).eq('id',sel.dataset.roleUser);
      if(error){setNotice(parseError(error),'error');render();return;} await loadData({transactions:false,docs:false});setNotice('User role updated.');render();
    });
    const f=document.getElementById('inviteForm'); if(f) f.onsubmit=async e=>{
      e.preventDefault();
      const body={display_name:document.getElementById('inviteName').value.trim(),email:document.getElementById('inviteEmail').value.trim(),role:document.getElementById('inviteRole').value};
      const {data,error}=await sb.functions.invoke('invite-user',{body});
      if(error || data?.error){setNotice(parseError(error||data.error),'error');render();return;}
      setNotice('Invitation sent. The user can choose their own password.'); await loadData({transactions:false,docs:false}); render();
    };
  }

  function activeSafetyDocs(itemId) {
    return S.safetyDocs.filter(d=>d.item_id===itemId&&d.active).sort((a,b)=>new Date(b.uploaded_at)-new Date(a.uploaded_at));
  }

  function latestSafetyAck(itemId, userId=S.profile?.id) {
    return S.safetyAcks.filter(a=>a.item_id===itemId&&a.user_id===userId).sort((a,b)=>new Date(b.acknowledged_at)-new Date(a.acknowledged_at))[0] || null;
  }

  function lastUserUse(itemId, userId=S.profile?.id) {
    return S.transactions.filter(t=>t.item_id===itemId&&t.user_id===userId&&t.transaction_type==='USE').sort((a,b)=>new Date(b.occurred_at)-new Date(a.occurred_at))[0] || null;
  }

  function safetyReminderStatus(item) {
    const rating=riskRating(item);
    const days=riskIntervalDays(rating);
    if(!days) return {due:false,reason:'No safety acknowledgement required',days:null};
    const ack=latestSafetyAck(item.id);
    if(!ack) return {due:true,reason:'First acknowledgement for this risk-rated item',days};
    const ackAt=new Date(ack.acknowledged_at);
    const changedAt=new Date(item.risk_rating_updated_at||item.updated_at||0);
    if(changedAt>ackAt) return {due:true,reason:'Risk rating changed since your last acknowledgement',days};
    const docs=activeSafetyDocs(item.id);
    const updatedDoc=docs.find(d=>new Date(d.uploaded_at)>ackAt);
    if(updatedDoc) return {due:true,reason:'Safety document added or updated since your last acknowledgement',days};
    const ageDays=(Date.now()-ackAt.getTime())/86400000;
    if(ageDays>=days) return {due:true,reason:`Periodic ${days}-day safety reminder`,days};
    const lastUse=lastUserUse(item.id);
    if(lastUse){
      const lastUseAt=new Date(lastUse.occurred_at);
      const gapDays=(Date.now()-lastUseAt.getTime())/86400000;
      if(gapDays>=days && ackAt<=lastUseAt) return {due:true,reason:`You have not recorded use of this item for ${days} days or more`,days};
    }
    return {due:false,reason:'Acknowledgement is current',days};
  }

  function safetyAckStatement() {
    return 'I acknowledge this safety reminder and understand that this product or task may have associated risks. I have reviewed the linked safety information available to me. If I am unsure about any risk, control measure or instruction, I will stop and ask my manager for clarification before proceeding.';
  }

  function requestStockAction(item,type) {
    if(type==='USE' && safetyReminderStatus(item).due) return openSafetyAcknowledgement(item,()=>openStockAction(item,type));
    return openStockAction(item,type);
  }

  function openSafetyAcknowledgement(item,onContinue) {
    const status=safetyReminderStatus(item);
    const docs=activeSafetyDocs(item.id);
    const statement=safetyAckStatement();
    showModal(`<header><div><h2>Safety reminder</h2><div class="muted">${esc(item.name)}</div></div><button class="close" data-close>×</button></header>
      <div class="safety-panel ${riskClass(riskRating(item))}"><div><span class="badge risk ${riskClass(riskRating(item))}">${esc(riskLabel(riskRating(item)))}</span></div><p><strong>This product or task has associated risks.</strong> Review the linked safety information before proceeding.</p><p class="muted">This is a reminder supporting your main training and instruction. Reason shown now: ${esc(status.reason)}.</p></div>
      <div class="card" style="margin-top:1rem"><h3>Linked safety documents</h3>${docs.length?docs.map(d=>`<div class="item-row"><div><strong>${esc(docTypeLabel(d.document_type))}</strong> · ${esc(d.title)}<div class="muted">Version ${esc(d.version||'—')} · Revision ${esc(d.revision_date||'—')}</div></div><button class="btn ghost" type="button" data-open-doc="${d.id}">Open</button></div>`).join(''):'<div class="notice">No safety documents are currently linked. Follow your main training/instructions and ask your manager if you are unsure.</div>'}</div>
      <form id="safetyAckForm"><label class="ack-check"><input id="safetyAckCheck" type="checkbox" required> ${esc(statement)}</label><div class="actions"><button class="btn warn" type="submit">Acknowledge & continue</button><button class="btn ghost" type="button" id="safetyAckCancel">Cancel</button></div></form>`);
    document.querySelectorAll('[data-open-doc]').forEach(b=>b.onclick=()=>openSafetyDocument(byId(S.safetyDocs,b.dataset.openDoc)));
    document.getElementById('safetyAckCancel').onclick=()=>openItem(item.id);
    document.getElementById('safetyAckForm').onsubmit=async e=>{
      e.preventDefault();
      const snapshot=docs.map(d=>({id:d.id,type:d.document_type,title:d.title,version:d.version||null,revision_date:d.revision_date||null,uploaded_at:d.uploaded_at}));
      const row={item_id:item.id,user_id:S.profile.id,risk_rating:riskRating(item),statement,acknowledgement_reason:status.reason,documents_snapshot:snapshot};
      const {error}=await sb.from('safety_acknowledgements').insert(row);
      if(error){setNotice(parseError(error),'error');render();return;}
      await loadData({transactions:false,docs:false});
      closeModal();
      onContinue();
    };
  }

  async function openItem(id) {
    const i=byId(S.items,id); if(!i) return;
    S.selectedItemId=id;
    const photoUrl=await signedUrl('item-photos',i.primary_photo_path,3600);
    const docs=activeSafetyDocs(id);
    const pos=itemPositions(id);
    const total=itemTotal(id);
    const onOrder=itemOnOrder(id);
    const suppliers=suppliersForItem(id);
    const itemOrders=openOrdersForItem(id);
    const safetyStatus=safetyReminderStatus(i);
    const locationTotals=new Map();
    for(const b of pos){const l=byId(S.locations,b.location_id);if(!l)continue;const key=l.location_name;locationTotals.set(key,(locationTotals.get(key)||0)+num(b.quantity));}
    const recent=S.transactions.filter(t=>t.item_id===id).slice(0,25);
    showModal(`<header><div><h2>${esc(i.name)}</h2><div class="muted">${esc(i.item_code)}</div></div><button class="close" data-close>×</button></header>
      <div class="split"><div>
        ${photoUrl?`<img class="photo zoomable" id="itemPhoto" src="${esc(photoUrl)}" alt="${esc(i.name)}" title="Tap to enlarge">`:''}
        <div class="grid cards" style="margin-top:1rem"><div class="card"><div class="muted">Overall stock</div><div class="stat">${qty(total)}</div></div><div class="card"><div class="muted">On order</div><div class="stat">${qty(onOrder)}</div></div><div class="card"><div class="muted">Reorder level</div><div class="stat">${qty(i.reorder_level)}</div></div></div>
        <h3>Totals by location</h3>${locationTotals.size?[...locationTotals.entries()].map(([name,q])=>`<div class="location-chip"><strong>${esc(name)}</strong> · ${qty(q)}</div>`).join(''):'<span class="muted">No stock assigned.</span>'}<h3>Exact stock positions</h3>${pos.length?pos.map(b=>{const l=byId(S.locations,b.location_id);return `<div class="location-chip"><strong>${esc(l?.location_name||'Unknown')}</strong> → ${esc(effectiveBinCode(l)?`Bin Ref ${effectiveBinCode(l)}`:'No bin ref')} · ${qty(b.quantity)}</div>`;}).join(''):'<div class="notice">No stock location currently has a positive quantity.</div>'}
      </div><div>
        <div class="card"><div><strong>QR value</strong><br>${esc(i.qr_value)}</div><div><strong>Category</strong><br>${esc(i.category||'—')}</div><div><strong>Unit cost</strong><br>${money(i.unit_cost)}</div><div style="margin-top:.7rem"><strong>Risk rating</strong><br><span class="badge risk ${riskClass(riskRating(i))}">${esc(riskLabel(riskRating(i)))}</span></div>${onOrder>0?`<div style="margin-top:.7rem"><span class="badge order">ON ORDER ${qty(onOrder)}</span></div>`:''}${i.is_chemical?'<div style="margin-top:.7rem"><span class="badge chemical">Chemical / hazardous item</span></div>':''}${safetyStatus.due&&riskRating(i)!=='NONE'?`<div class="notice risk-notice">Safety reminder due before next recorded use.</div>`:''}</div>
        <div class="actions quick-actions"><button class="btn good" data-stock-action="ADD">+ Add stock</button><button class="btn warn" data-stock-action="USE">− Use stock</button><button class="btn secondary" data-stock-action="ADJUST">Adjust count</button><button class="btn ghost" data-stock-action="MOVE">Move stock</button></div>
        <div class="actions"><button class="btn ghost" id="printQrBtn">Print QR</button>${canManage()?'<button class="btn ghost" id="editItemBtn">Edit item</button><button class="btn ghost" id="suppliersBtn">Suppliers 1–3</button><button class="btn" id="orderItemBtn">Order item</button>':''}</div>
      </div></div>
      <div class="card" style="margin-top:1rem"><h3>Suppliers & orders</h3>
        ${suppliers.length?suppliers.map(s=>`<div class="supplier-line"><strong>Supplier ${s.supplier_slot}: ${esc(s.supplier_name)}</strong>${s.preferred?' <span class="badge">Preferred</span>':''}<div class="muted">Ref ${esc(s.supplier_ref||'—')} · Pack ${qty(s.pack_size||1)} · Lead ${s.lead_time_days==null?'—':esc(s.lead_time_days)+' days'} · ${s.unit_price==null?'Price —':money(s.unit_price)}</div></div>`).join(''):'<p class="muted">No suppliers saved yet.</p>'}
        ${itemOrders.length?`<div style="margin-top:.7rem"><strong>Currently on order</strong>${itemOrders.map(o=>`<div class="muted">${qty(orderRemaining(o))} from ${esc(o.supplier_name)}${o.expected_date?` · expected ${fmtShortDate(o.expected_date)}`:''}</div>`).join('')}</div>`:''}
      </div>
      ${(docs.length||riskRating(i)!=='NONE'||canManage())?`<div class="card" style="margin-top:1rem"><h3>Safety documents</h3><div id="docList">${docs.length?docs.map(d=>`<div class="item-row"><div><strong>${esc(docTypeLabel(d.document_type))}</strong> · ${esc(d.title)}<div class="muted">Version ${esc(d.version||'—')} · Revision ${esc(d.revision_date||'—')} · Review ${esc(d.review_date||'—')}</div></div><button class="btn ghost" data-open-doc="${d.id}">Open</button></div>`).join(''):'<p class="muted">No safety documents uploaded yet.</p>'}</div>${canManage()?'<button class="btn" id="uploadDocBtn">Upload safety document</button>':''}</div>`:''}
      <div class="card" style="margin-top:1rem"><h3>Recent item history</h3>${transactionTable(recent)}</div>`);
    document.querySelectorAll('[data-stock-action]').forEach(b=>b.onclick=()=>requestStockAction(i,b.dataset.stockAction));
    document.getElementById('printQrBtn').onclick=()=>printQr(i);
    const photo=document.getElementById('itemPhoto'); if(photo) photo.onclick=()=>photo.classList.toggle('photo-large');
    const edit=document.getElementById('editItemBtn'); if(edit) edit.onclick=()=>openEditItem(i);
    const suppliersBtn=document.getElementById('suppliersBtn'); if(suppliersBtn) suppliersBtn.onclick=()=>openSupplierEditor(i);
    const orderItemBtn=document.getElementById('orderItemBtn'); if(orderItemBtn) orderItemBtn.onclick=()=>openCreateOrder(i.id);
    const up=document.getElementById('uploadDocBtn'); if(up) up.onclick=()=>openSafetyUpload(i);
    document.querySelectorAll('[data-open-doc]').forEach(b=>b.onclick=()=>openSafetyDocument(byId(S.safetyDocs,b.dataset.openDoc)));
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
    const refresh=()=>{
      let candidates=positionsForLocation(locSel.value,rows);
      if(itemId && positiveOnly){
        const positiveIds=new Set(itemPositions(itemId).map(b=>b.location_id));
        candidates=candidates.filter(l=>positiveIds.has(l.id));
      }
      const refs=[...new Set(candidates.map(effectiveBinCode).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
      list.innerHTML=refs.map(r=>`<option value="${esc(r)}"></option>`).join('');
      if(refs.length===1 && !input.value.trim()) input.value=refs[0];
    };
    locSel.onchange=()=>{input.value='';refresh();};
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

  function stockActionForm(item,type) {
    const pos=itemPositions(item.id);
    const positiveIds=new Set(pos.map(b=>b.location_id));
    const sourceRows=activeLocations().filter(l=>positiveIds.has(l.id));
    const allRows=activeLocations();
    const title={ADD:'Add stock',USE:'Use / remove stock',MOVE:'Move stock',ADJUST:'Adjust stock'}[type];
    const sourcePair=`<label>Location</label><select id="fromLocationName" required>${locationNameOptions(sourceRows)}</select><label>Bin Ref</label><input id="fromBinRef" list="fromBinList" placeholder="Type bin ref, e.g. B12"><datalist id="fromBinList"></datalist>`;
    const destinationPair=`<label>Location</label><select id="toLocationName" required>${locationNameOptions(allRows)}</select><label>Bin Ref (optional)</label><input id="toBinRef" list="toBinList" placeholder="Type bin ref, e.g. B12"><datalist id="toBinList"></datalist>`;
    const adjustPair=`<label>Location</label><select id="fromLocationName" required>${locationNameOptions(allRows)}</select><label>Bin Ref (optional)</label><input id="fromBinRef" list="fromBinList" placeholder="Type bin ref, e.g. B12"><datalist id="fromBinList"></datalist>`;
    return `<header><div><h2>${title}</h2><div class="muted">${esc(item.name)}</div></div><button class="close" data-close>×</button></header><form id="stockActionForm" data-type="${type}">
      ${type==='ADD'?`${destinationPair}<label>Quantity added</label><input id="actionQty" type="number" min="0.001" step="0.001" required>`:''}
      ${type==='USE'?`${sourcePair}<label>Quantity used / removed</label><input id="actionQty" type="number" min="0.001" step="0.001" required>`:''}
      ${type==='MOVE'?`<h3>Move from</h3>${sourcePair}<h3>Move to</h3>${destinationPair}<label>Quantity moved</label><input id="actionQty" type="number" min="0.001" step="0.001" required>`:''}
      ${type==='ADJUST'?`${adjustPair}<label>Correct quantity at this location / bin ref</label><input id="newQty" type="number" min="0" step="0.001" required><label>Reason</label><select id="reason" required><option value="Stock count correction">Stock count correction</option><option value="Damaged">Damaged</option><option value="Lost">Lost</option><option value="Found">Found</option><option value="Data correction">Data correction</option><option value="Other">Other</option></select>`:''}
      ${type!=='ADJUST'?`<label>Reason / reference (optional)</label><input id="reason" placeholder="Delivery, job, damaged, etc.">`:''}
      <label>Notes (optional)</label><textarea id="notes" rows="2"></textarea>
      <div class="actions"><button class="btn" type="submit">Confirm ${title.toLowerCase()}</button></div></form>`;
  }

  function openStockAction(item,type) {
    if((type==='USE'||type==='MOVE')&&!itemPositions(item.id).length){setNotice('There is no positive stock to remove or move.','error');closeModal();render();return;}
    if(!locationNames().length){setNotice('Add a location before recording stock.','error');closeModal();render();return;}
    showModal(stockActionForm(item,type));
    const pos=itemPositions(item.id);
    const positiveIds=new Set(pos.map(b=>b.location_id));
    const sourceRows=activeLocations().filter(l=>positiveIds.has(l.id));
    if(type==='USE'||type==='MOVE') bindBinRefSuggestions('fromLocationName','fromBinRef','fromBinList',sourceRows,item.id,true);
    if(type==='ADD'||type==='MOVE') bindBinRefSuggestions('toLocationName','toBinRef','toBinList',activeLocations());
    if(type==='ADJUST') bindBinRefSuggestions('fromLocationName','fromBinRef','fromBinList',activeLocations(),item.id,false);
    const form=document.getElementById('stockActionForm');
    form.onsubmit=async e=>{
      e.preventDefault();
      try{
        let from=null,to=null;
        if(type==='USE'||type==='MOVE'){
          const fromName=document.getElementById('fromLocationName').value;
          const fromRef=document.getElementById('fromBinRef').value;
          const p=sourcePosition(item.id,fromName,fromRef);
          if(!p){setNotice('No stock was found at that Location / Bin Ref. Check the bin reference and try again.','error');return;}
          from=p.id;
        }
        if(type==='ADD'||type==='MOVE'){
          const toName=document.getElementById('toLocationName').value;
          const toRef=document.getElementById('toBinRef').value;
          to=await ensurePosition(toName,toRef);
        }
        if(type==='ADJUST'){
          const fromName=document.getElementById('fromLocationName').value;
          const fromRef=document.getElementById('fromBinRef').value;
          from=await ensurePosition(fromName,fromRef);
        }
        if(type==='MOVE'&&from===to){setNotice('Choose a different destination Location / Bin Ref.','error');return;}
        const quantity=num(document.getElementById('actionQty')?.value), newQuantity=document.getElementById('newQty')?num(document.getElementById('newQty').value):null;
        const reason=document.getElementById('reason')?.value||null,notes=document.getElementById('notes')?.value||null;
        const {error}=await sb.rpc('apply_stock_transaction',{p_item_id:item.id,p_type:type,p_quantity:quantity,p_from_location_id:from,p_to_location_id:to,p_new_quantity:newQuantity,p_reason:reason,p_reference:null,p_notes:notes});
        if(error) throw error;
        await loadData(); closeModal(); setNotice(`${item.name}: ${type.toLowerCase()} recorded.`); render();
      }catch(err){setNotice(parseError(err),'error');}
    };
  }

  function openAddLocation() {
    showModal(`<header><h2>Add location</h2><button class="close" data-close>×</button></header><form id="locForm"><p class="muted">Add the main place where stock is kept. Bin Ref is typed on the item when stock is assigned.</p><label>Location name</label><input id="locName" placeholder="Workshop Store" required><label>Notes (optional)</label><textarea id="locNotes"></textarea><div class="actions"><button class="btn" type="submit">Save location</button></div></form>`);
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
      await loadData({transactions:false,docs:false});closeModal();setNotice('Location added.');render();
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
      await loadData({transactions:false,docs:false});closeModal();setNotice('Location deleted from the active list. History was preserved.');render();
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
          <div><label>Supplier name</label><input id="supplierName${slot}" value="${esc(s?.supplier_name||'')}" placeholder="Leave blank if unused"></div>
          <div><label>Supplier part/reference</label><input id="supplierRef${slot}" value="${esc(s?.supplier_ref||'')}"></div>
          <div><label>Price (£, optional)</label><input id="supplierPrice${slot}" type="number" min="0" step="0.01" value="${esc(s?.unit_price??'')}"></div>
          <div><label>Pack size</label><input id="supplierPack${slot}" type="number" min="0.001" step="0.001" value="${esc(s?.pack_size??1)}"></div>
          <div><label>Lead time (days)</label><input id="supplierLead${slot}" type="number" min="0" step="1" value="${esc(s?.lead_time_days??'')}"></div>
          <div><label>Notes</label><input id="supplierNotes${slot}" value="${esc(s?.notes||'')}"></div>
        </div>
      </div>`;
    };
    showModal(`<header><div><h2>Suppliers 1–3</h2><div class="muted">${esc(item.name)}</div></div><button class="close" data-close>×</button></header>
      <form id="supplierForm"><p class="muted">Save up to three suppliers for this item. The preferred supplier is shown first on Suggested Orders.</p>
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
        await loadData({transactions:false,docs:false});closeModal();setNotice('Suppliers updated.');render();
      }catch(err){setNotice(parseError(err),'error');}
    };
  }

  function itemFormHtml(i=null) {
    const categories=categoryNames();
    const currentCategory=String(i?.category||'');
    if(currentCategory && !categories.includes(currentCategory)) categories.push(currentCategory);
    categories.sort((a,b)=>a.localeCompare(b));
    const currentRisk=riskRating(i);
    return `<header><h2>${i?'Edit item':'Add new item'}</h2><button class="close" data-close>×</button></header><form id="itemForm"><div class="form-grid">
      <div><label>Item name</label><input id="newName" value="${esc(i?.name||'')}" required></div>
      <div><label>Item code</label><input id="newCode" value="${esc(i?.item_code||'')}" required></div>
      <div><label>QR value</label><input id="newQr" value="${esc(i?.qr_value||'')}" placeholder="Defaults to item code"><button class="btn ghost" id="generateQr" type="button" style="margin-top:.35rem">Generate code</button></div>
      <div><label>Category</label><select id="newCategory"><option value="">Uncategorised</option>${categories.map(c=>`<option value="${esc(c)}" ${currentCategory===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
      <div><label>Reorder level</label><input id="newReorder" type="number" step="0.001" min="0" value="${esc(i?.reorder_level??0)}"></div>
      <div><label>Unit cost (£, optional)</label><input id="newCost" type="number" step="0.01" min="0" value="${esc(i?.unit_cost??'')}"></div>
      <div class="full"><label><input id="newChemical" type="checkbox" style="width:auto" ${i?.is_chemical?'checked':''}> Chemical / hazardous item</label></div>
      ${canAdmin()?`<div><label>Risk rating</label><select id="newRiskRating"><option value="NONE" ${currentRisk==='NONE'?'selected':''}>None (default)</option><option value="GREEN" ${currentRisk==='GREEN'?'selected':''}>Green · Low risk</option><option value="AMBER" ${currentRisk==='AMBER'?'selected':''}>Amber · Medium risk</option><option value="RED" ${currentRisk==='RED'?'selected':''}>Red · High risk</option></select></div><div><label>Risk rating change reason (optional)</label><input id="riskChangeReason" placeholder="Why the rating changed"></div>`:`<div><label>Risk rating</label><div><span class="badge risk ${riskClass(currentRisk)}">${esc(riskLabel(currentRisk))}</span></div><div class="muted">Only an admin can change this.</div></div>`}
      <div class="full"><label>Item photo (optional)</label><input id="newPhoto" type="file" accept="image/*" capture="environment"></div>
      ${i?'':`<div><label>Opening stock (optional)</label><input id="openingQty" type="number" min="0" step="0.001" value="0"></div><div><label>Opening location</label><select id="openingLocationName"><option value="">None</option>${locationNames().map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></div><div><label>Opening Bin Ref (optional)</label><input id="openingBinRef" list="openingBinList" placeholder="e.g. B12"><datalist id="openingBinList"></datalist></div>`}
      </div><div class="actions"><button class="btn" type="submit">${i?'Save changes':'Create item'}</button></div></form>`;
  }

  function openAddItem() { showModal(itemFormHtml()); bindItemForm(null); }
  function openEditItem(i) { showModal(itemFormHtml(i)); bindItemForm(i); }

  function bindItemForm(existing) {
    const name=document.getElementById('newName'),code=document.getElementById('newCode'),qr=document.getElementById('newQr');
    const gen=document.getElementById('generateQr'); if(gen) gen.onclick=()=>{const v=`ITM-${Date.now().toString(36).toUpperCase().slice(-7)}`;qr.value=v;if(!code.value.trim())code.value=v;};
    if(!existing) {
      let codeTouched=false,qrTouched=false;
      code.oninput=()=>{codeTouched=true;if(!qrTouched)qr.value=code.value};qr.oninput=()=>qrTouched=true;name.oninput=()=>{if(!codeTouched){code.value=name.value;if(!qrTouched)qr.value=name.value;}};
      const openingLocation=document.getElementById('openingLocationName');
      if(openingLocation) bindBinRefSuggestions('openingLocationName','openingBinRef','openingBinList',activeLocations());
    }
    document.getElementById('itemForm').onsubmit=async e=>{
      e.preventDefault();
      const row={name:name.value.trim(),item_code:code.value.trim(),qr_value:(qr.value.trim()||code.value.trim()),category:document.getElementById('newCategory').value||null,reorder_level:num(document.getElementById('newReorder').value),unit_cost:document.getElementById('newCost').value===''?null:num(document.getElementById('newCost').value),is_chemical:document.getElementById('newChemical').checked};
      let itemId=existing?.id;
      if(existing){const {error}=await sb.from('items').update(row).eq('id',existing.id);if(error){setNotice(parseError(error),'error');closeModal();render();return;}}
      else {row.created_by=S.profile.id;const {data,error}=await sb.from('items').insert(row).select('id').single();if(error){setNotice(parseError(error),'error');closeModal();render();return;}itemId=data.id;}
      if(canAdmin()){
        const selectedRisk=document.getElementById('newRiskRating')?.value||'NONE';
        const oldRisk=existing?riskRating(existing):'NONE';
        if(selectedRisk!==oldRisk){
          const {error}=await sb.rpc('set_item_risk_rating',{p_item_id:itemId,p_rating:selectedRisk,p_reason:document.getElementById('riskChangeReason')?.value.trim()||null});
          if(error){setNotice(`Item saved, but risk rating update failed: ${parseError(error)}`,'error');}
        }
      }
      const photo=document.getElementById('newPhoto').files[0];
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
      await loadData({transactions:false,docs:false});openCategoryManager();
    });
    document.getElementById('addCategoryForm').onsubmit=async e=>{
      e.preventDefault();const name=document.getElementById('newCategoryName').value.trim();if(!name)return;
      const existing=S.categories.find(c=>c.name.toLowerCase()===name.toLowerCase());
      let error;
      if(existing)({error}=await sb.from('inventory_categories').update({active:true}).eq('id',existing.id));
      else ({error}=await sb.from('inventory_categories').insert({name,sort_order:100}));
      if(error){setNotice(parseError(error),'error');render();return;}
      await loadData({transactions:false,docs:false});openCategoryManager();
    };
  }

  async function compressImage(file) {
    if(!file.type.startsWith('image/') || file.size < 650000) return file;
    try {
      const img=await createImageBitmap(file); const max=1600; const scale=Math.min(1,max/Math.max(img.width,img.height));
      const canvas=document.createElement('canvas'); canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
      if(!blob) return file;
      return new File([blob],`${file.name.replace(/\.[^.]+$/,'')}.jpg`,{type:'image/jpeg'});
    } catch(_) { return file; }
  }

  async function uploadItemPhoto(itemId,file) {
    const upload=await compressImage(file);
    const path=`${itemId}/${Date.now()}-${slug(upload.name)}`;
    const {error}=await sb.storage.from('item-photos').upload(path,upload,{upsert:false,contentType:upload.type}); if(error)throw error;
    const {error:e2}=await sb.from('items').update({primary_photo_path:path,updated_at:new Date().toISOString()}).eq('id',itemId); if(e2)throw e2;
  }

  function docTypeLabel(v){return ({RISK_ASSESSMENT:'Risk Assessment',SSW:'SSW / Safe System of Work',SDS_MSDS:'SDS / MSDS',COSHH:'COSHH Assessment',MANUFACTURER:'Manufacturer Instructions',OTHER:'Other'})[v]||v;}

  function openSafetyUpload(item) {
    showModal(`<header><div><h2>Upload safety document</h2><div class="muted">${esc(item.name)}</div></div><button class="close" data-close>×</button></header><form id="docForm"><label>Document type</label><select id="docType"><option value="RISK_ASSESSMENT">Risk Assessment</option><option value="SSW">SSW / Safe System of Work</option><option value="SDS_MSDS">SDS / MSDS</option><option value="COSHH">COSHH Assessment</option><option value="MANUFACTURER">Manufacturer Instructions</option><option value="OTHER">Other</option></select><label>Title</label><input id="docTitle" required><div class="form-grid"><div><label>Version</label><input id="docVersion"></div><div><label>Revision date</label><input id="docRevision" type="date"></div><div><label>Review date</label><input id="docReview" type="date"></div><div><label>File</label><input id="docFile" type="file" accept=".pdf,.doc,.docx,image/*" required></div></div><div class="actions"><button class="btn" type="submit">Upload document</button></div></form>`);
    document.getElementById('docForm').onsubmit=async e=>{e.preventDefault();const f=document.getElementById('docFile').files[0];if(!f)return;const path=`${item.id}/${Date.now()}-${slug(f.name)}`;let {error}=await sb.storage.from('safety-documents').upload(path,f,{contentType:f.type});if(error){setNotice(parseError(error),'error');closeModal();render();return;}const row={item_id:item.id,document_type:document.getElementById('docType').value,title:document.getElementById('docTitle').value.trim(),version:document.getElementById('docVersion').value.trim()||null,revision_date:document.getElementById('docRevision').value||null,review_date:document.getElementById('docReview').value||null,storage_path:path,uploaded_by:S.profile.id};({error}=await sb.from('safety_documents').insert(row));if(error){setNotice(parseError(error),'error');closeModal();render();return;}await loadData({transactions:false,docs:true});closeModal();setNotice('Safety document uploaded.');render();};
  }

  async function openSafetyDocument(doc) {
    if(!doc)return;const url=await signedUrl('safety-documents',doc.storage_path,900);if(!url){setNotice('Could not open this document.','error');render();return;}window.open(url,'_blank','noopener');
  }

  async function signedUrl(bucket,path,seconds=900){if(!path)return null;const {data,error}=await sb.storage.from(bucket).createSignedUrl(path,seconds);return error?null:data?.signedUrl||null;}

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

  bootstrap();
})();
