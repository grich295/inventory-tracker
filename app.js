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
    page: 'dashboard',
    search: '',
    selectedItemId: null,
    scanner: null,
    chart: null,
    liveChannel: null,
    liveTimer: null,
    notice: null,
    passwordMode: false,
    report: { period: 'month', item: '', user: '', location: '', from: '', to: '' }
  };

  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = v => Number(v || 0);
  const qty = v => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
  const money = v => v == null || v === '' ? '—' : `£${Number(v).toFixed(2)}`;
  const fmtDate = v => v ? new Date(v).toLocaleString() : '—';
  const fmtShortDate = v => v ? new Date(v).toLocaleDateString() : '—';
  const todayISO = () => new Date().toISOString().slice(0,10);
  const monthStartISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
  const byId = (arr, id) => arr.find(x => x.id === id);
  const canManage = () => ['admin','manager'].includes(S.profile?.role);
  const locationLabel = l => !l ? '—' : [l.location_name, l.area_name, l.bin_code ? `Bin ${l.bin_code}` : ''].filter(Boolean).join(' → ');
  const itemTotal = itemId => S.balances.filter(b => b.item_id === itemId).reduce((a,b) => a + num(b.quantity), 0);
  const itemPositions = itemId => S.balances.filter(b => b.item_id === itemId && num(b.quantity) > 0).sort((a,b) => num(b.quantity)-num(a.quantity));
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
    const [profiles, items, locations, balances] = await Promise.all([
      fetchAll('profiles','*','display_name',true),
      fetchAll('items','*','name',true),
      fetchAll('stock_locations','*','location_name',true),
      fetchAll('stock_balances','*')
    ]);
    S.profiles = profiles; S.items = items; S.locations = locations; S.balances = balances;
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
    for(const table of ['stock_balances','transactions','items','stock_locations','safety_documents','profiles']){
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
      ['dashboard','Dashboard'],['scan','Scan'],['items','Items'],['locations','Locations'],['reports','Reports'],['history','History']
    ];
    if (S.profile?.role === 'admin') nav.push(['users','Users']);
    return `<div class="shell">
      <div class="topbar"><div><div class="brand">Inventory Tracker</div><div class="userline">${esc(S.profile?.display_name || S.session.user.email)} · ${esc(S.profile?.role || 'staff')}</div></div><button class="btn secondary" id="logoutBtn">Sign out</button></div>
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
    if (S.page==='reports') return reportsHtml();
    if (S.page==='history') return historyHtml();
    if (S.page==='users') return usersHtml();
    return dashboardHtml();
  }

  function dashboardHtml() {
    const active = S.items.filter(i=>i.active);
    const totalUnits = S.balances.reduce((a,b)=>a+num(b.quantity),0);
    const low = active.filter(i => num(i.reorder_level)>0 && itemTotal(i.id)<=num(i.reorder_level));
    const mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0);
    const usedMonth = S.transactions.filter(t=>t.transaction_type==='USE' && new Date(t.occurred_at)>=mStart).reduce((a,t)=>a+num(t.quantity),0);
    const recent = S.transactions.slice(0,8);
    return `
      <div class="grid cards">
        <div class="card"><div class="muted">Active items</div><div class="stat">${active.length}</div></div>
        <div class="card"><div class="muted">Units in stock</div><div class="stat">${qty(totalUnits)}</div></div>
        <div class="card"><div class="muted">Low-stock items</div><div class="stat">${low.length}</div></div>
        <div class="card"><div class="muted">Used this month</div><div class="stat">${qty(usedMonth)}</div></div>
      </div>
      <div class="toolbar" style="margin-top:1rem"><button class="btn good" data-go="scan">Scan QR</button><button class="btn" data-go="items">Manual search</button>${canManage()?'<button class="btn secondary" id="dashAddItem">Add new item</button>':''}</div>
      ${low.length?`<div class="card"><h3>Low stock</h3><div class="item-list">${low.slice(0,8).map(itemRowHtml).join('')}</div></div>`:''}
      <div class="card" style="margin-top:1rem"><h3>Recent activity</h3>${transactionTable(recent)}</div>`;
  }

  function scanHtml() {
    return `<div class="scan-box">
      <div class="card"><h2>Scan item QR</h2><p class="muted">Scan an existing item code. The app will show every location/area/bin where it is kept.</p>
        <div id="reader" class="scanner"></div>
        <div class="actions"><button class="btn secondary" id="stopScan">Stop camera</button><button class="btn ghost" data-go="items">Manual search instead</button></div>
      </div>
      <div class="card" style="margin-top:1rem"><label>Or type/scan code</label><div class="toolbar"><input id="scanText" placeholder="Item or QR code"><button class="btn" id="scanFind">Find</button></div></div>
    </div>`;
  }

  function itemRowHtml(i) {
    const total=itemTotal(i.id); const low=num(i.reorder_level)>0 && total<=num(i.reorder_level);
    const pos=itemPositions(i.id).slice(0,3).map(b=>`${esc(locationLabel(byId(S.locations,b.location_id)))} (${qty(b.quantity)})`).join(' · ');
    return `<div class="item-row" data-item="${i.id}"><div><div class="item-title">${esc(i.name)}</div><div class="muted">${esc(i.item_code)}${i.category?' · '+esc(i.category):''}</div><div class="muted">${pos || 'No stock location set'}</div>${i.is_chemical?'<span class="badge chemical">Chemical</span> ':''}${low?'<span class="badge low">Low stock</span>':''}</div><div class="qty">${qty(total)}</div></div>`;
  }

  function itemsHtml() {
    const q=S.search.toLowerCase().trim();
    const filtered=S.items.filter(i=>i.active).filter(i=>{
      if(!q) return true;
      const positionText=itemPositions(i.id).map(b=>locationLabel(byId(S.locations,b.location_id))).join(' ');
      return [i.name,i.item_code,i.qr_value,i.category,positionText].join(' ').toLowerCase().includes(q);
    });
    return `<div class="toolbar"><input id="itemSearch" value="${esc(S.search)}" placeholder="Search item, code, category, location or bin">${canManage()?'<button class="btn" id="addItemBtn">Add new item</button>':''}</div>
      <div class="muted" style="margin-bottom:.6rem">${filtered.length} item${filtered.length===1?'':'s'}</div>
      <div class="item-list">${filtered.map(itemRowHtml).join('') || '<div class="card">No matching items.</div>'}</div>`;
  }

  function locationsHtml() {
    const positive=S.balances.filter(b=>num(b.quantity)>0);
    const locGroups=new Map(), areaGroups=new Map();
    for(const b of positive){
      const l=byId(S.locations,b.location_id); if(!l)continue;
      const lk=l.location_name;
      const ak=`${l.location_name}|||${l.area_name||'Unassigned'}`;
      if(!locGroups.has(lk))locGroups.set(lk,{units:0,items:new Set()});
      if(!areaGroups.has(ak))areaGroups.set(ak,{location:l.location_name,area:l.area_name||'Unassigned',units:0,items:new Set()});
      locGroups.get(lk).units+=num(b.quantity);locGroups.get(lk).items.add(b.item_id);
      areaGroups.get(ak).units+=num(b.quantity);areaGroups.get(ak).items.add(b.item_id);
    }
    const overall=positive.reduce((a,b)=>a+num(b.quantity),0);
    const locCards=[...locGroups.entries()].sort().map(([name,g])=>`<div class="card"><div class="muted">${esc(name)}</div><div class="stat">${qty(g.units)}</div><div class="muted">${g.items.size} item${g.items.size===1?'':'s'}</div></div>`).join('');
    const areaRows=[...areaGroups.values()].sort((a,b)=>(a.location+a.area).localeCompare(b.location+b.area)).map(g=>`<tr><td>${esc(g.location)}</td><td>${esc(g.area)}</td><td>${g.items.size}</td><td>${qty(g.units)}</td></tr>`).join('');
    const rows=S.locations.filter(l=>l.active).map(l=>{
      const units=S.balances.filter(b=>b.location_id===l.id).reduce((a,b)=>a+num(b.quantity),0);
      const itemCount=S.balances.filter(b=>b.location_id===l.id && num(b.quantity)>0).length;
      return `<tr><td>${esc(l.location_name)}</td><td>${esc(l.area_name||'—')}</td><td>${esc(l.bin_code||'—')}</td><td>${itemCount}</td><td>${qty(units)}</td></tr>`;
    }).join('');
    return `<div class="toolbar">${canManage()?'<button class="btn" id="addLocationBtn">Add location / bin</button>':''}</div>
      <div class="grid cards"><div class="card"><div class="muted">Overall stock</div><div class="stat">${qty(overall)}</div></div>${locCards}</div>
      <div class="card" style="margin-top:1rem"><h3>Totals by area</h3><div class="table-wrap"><table><thead><tr><th>Location</th><th>Area</th><th>Different items</th><th>Total units</th></tr></thead><tbody>${areaRows||'<tr><td colspan="4">No stock assigned yet.</td></tr>'}</tbody></table></div></div>
      <div class="card" style="margin-top:1rem"><h3>Exact bins</h3><div class="table-wrap"><table><thead><tr><th>Location</th><th>Area</th><th>Bin</th><th>Items</th><th>Total units</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No locations yet.</td></tr>'}</tbody></table></div></div>`;
  }

  function reportTransactions() {
    const r=S.report;
    let list=S.transactions.filter(t=>t.transaction_type==='USE');
    if(r.period==='month') { const from=new Date(monthStartISO()+'T00:00:00'); list=list.filter(t=>new Date(t.occurred_at)>=from); }
    if(r.period==='all') {}
    if(r.period==='custom') {
      if(r.from) { const from=new Date(r.from+'T00:00:00'); list=list.filter(t=>new Date(t.occurred_at)>=from); }
      if(r.to) { const to=new Date(r.to+'T23:59:59'); list=list.filter(t=>new Date(t.occurred_at)<=to); }
    }
    if(r.item) list=list.filter(t=>t.item_id===r.item);
    if(r.user) list=list.filter(t=>(t.user_id||'legacy')===r.user);
    if(r.location) list=list.filter(t=>t.from_location_id===r.location);
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
    if(r.location) list=list.filter(t=>t.from_location_id===r.location||t.to_location_id===r.location);
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

    return `<div class="card"><h2>Usage & activity reports</h2>
      <div class="form-grid">
        <div><label>Period</label><select id="reportPeriod"><option value="month" ${S.report.period==='month'?'selected':''}>This month</option><option value="all" ${S.report.period==='all'?'selected':''}>All time</option><option value="custom" ${S.report.period==='custom'?'selected':''}>Custom dates</option></select></div>
        <div><label>Item</label><select id="reportItem"><option value="">All items</option>${S.items.filter(i=>i.active).map(i=>`<option value="${i.id}" ${S.report.item===i.id?'selected':''}>${esc(i.name)}</option>`).join('')}</select></div>
        <div><label>User</label><select id="reportUser"><option value="">All users</option><option value="legacy" ${S.report.user==='legacy'?'selected':''}>Legacy import</option>${S.profiles.map(p=>`<option value="${p.id}" ${S.report.user===p.id?'selected':''}>${esc(p.display_name)}</option>`).join('')}</select></div>
        <div><label>Location / bin</label><select id="reportLocation"><option value="">All locations</option>${S.locations.map(l=>`<option value="${l.id}" ${S.report.location===l.id?'selected':''}>${esc(locationLabel(l))}</option>`).join('')}</select></div>
        <div class="customDates ${S.report.period==='custom'?'':'hidden'}"><label>From</label><input type="date" id="reportFrom" value="${esc(S.report.from)}"></div>
        <div class="customDates ${S.report.period==='custom'?'':'hidden'}"><label>To</label><input type="date" id="reportTo" value="${esc(S.report.to)}"></div>
      </div>
      <div class="actions"><button class="btn secondary" id="exportReport">Export usage CSV</button><button class="btn ghost" id="exportActivity">Export activity CSV</button></div>
    </div>
    <div class="grid cards" style="margin-top:1rem"><div class="card"><div class="muted">${esc(reportName)} usage</div><div class="stat">${qty(totalUsage)}</div></div><div class="card"><div class="muted">Usage transactions</div><div class="stat">${list.length}</div></div><div class="card"><div class="muted">Different items used</div><div class="stat">${summary.length}</div></div><div class="card"><div class="muted">All stock actions</div><div class="stat">${activity.length}</div></div></div>
    <div class="split" style="margin-top:1rem"><div class="card"><h3>Usage by item</h3><div class="table-wrap"><table><thead><tr><th>Item</th><th>Used</th></tr></thead><tbody>${summary.map(x=>`<tr data-item="${x.id}"><td>${esc(x.name)}</td><td>${qty(x.q)}</td></tr>`).join('')||'<tr><td colspan="2">No usage in this period.</td></tr>'}</tbody></table></div></div><div class="card"><h3>12-month usage trend</h3><p class="muted">Choose an item in the filter to analyse whether usage is increasing or decreasing.</p><canvas id="trendChart" height="250"></canvas></div></div>
    <div class="card" style="margin-top:1rem"><h3>Who added, used, moved or adjusted stock</h3><div class="table-wrap"><table><thead><tr><th>User</th><th>Added</th><th>Used</th><th>Moved</th><th>Adjusted</th><th>Actions</th></tr></thead><tbody>${activityRows||'<tr><td colspan="6">No activity in this period.</td></tr>'}</tbody></table></div></div>
    <div class="card" style="margin-top:1rem"><h3>Detailed usage</h3>${transactionTable(list)}</div>
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

  function bindPage() {
    document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{S.page=b.dataset.go; render();});
    document.querySelectorAll('[data-item]').forEach(el=>el.onclick=()=>openItem(el.dataset.item));
    if(S.page==='dashboard') {
      const b=document.getElementById('dashAddItem'); if(b) b.onclick=openAddItem;
    }
    if(S.page==='scan') bindScan();
    if(S.page==='items') bindItems();
    if(S.page==='locations') bindLocations();
    if(S.page==='reports') bindReports();
    if(S.page==='users') bindUsers();
  }

  function bindScan() {
    const find=()=>findScanned(document.getElementById('scanText').value.trim());
    document.getElementById('scanFind').onclick=find;
    document.getElementById('scanText').onkeydown=e=>{if(e.key==='Enter') find();};
    document.getElementById('stopScan').onclick=stopScanner;
    if(window.Html5Qrcode) {
      S.scanner=new Html5Qrcode('reader');
      S.scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:240,height:240}},decoded=>{stopScanner();findScanned(decoded);}).catch(e=>{
        const r=document.getElementById('reader'); if(r) r.innerHTML=`<div class="notice error">Camera could not start. You can still search manually. ${esc(parseError(e))}</div>`;
      });
    }
  }

  async function stopScanner() {
    if(S.scanner) { try { if(S.scanner.isScanning) await S.scanner.stop(); await S.scanner.clear(); } catch(_){} S.scanner=null; }
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
    inp.oninput=()=>{S.search=inp.value; clearTimeout(inp._t); inp._t=setTimeout(render,180);};
    const add=document.getElementById('addItemBtn'); if(add) add.onclick=openAddItem;
  }

  function bindLocations() {
    const b=document.getElementById('addLocationBtn'); if(b) b.onclick=openAddLocation;
  }

  function bindReports() {
    const ids=[['reportPeriod','period'],['reportItem','item'],['reportUser','user'],['reportLocation','location'],['reportFrom','from'],['reportTo','to']];
    ids.forEach(([id,key])=>{const el=document.getElementById(id); if(el) el.onchange=()=>{S.report[key]=el.value; render();};});
    document.getElementById('exportReport').onclick=exportUsageCSV;
    const ea=document.getElementById('exportActivity'); if(ea) ea.onclick=exportActivityCSV;
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

  function exportUsageCSV() {
    const list=reportTransactions();
    const rows=[['Date/time','Item','Quantity','User','Location','Reason','Legacy']];
    list.forEach(t=>rows.push([t.occurred_at,itemName(t.item_id),t.quantity,userName(t.user_id),locName(t.from_location_id),t.reason||t.notes||'',t.legacy_import?'Yes':'No']));
    const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`inventory-usage-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  function exportActivityCSV() {
    const list=activityTransactions();
    const rows=[['Date/time','Item','Action','Quantity','User','From','To','Reason','Legacy']];
    list.forEach(t=>rows.push([t.occurred_at,itemName(t.item_id),t.transaction_type,t.quantity,userName(t.user_id),locName(t.from_location_id),locName(t.to_location_id),t.reason||t.notes||'',t.legacy_import?'Yes':'No']));
    const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`inventory-activity-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(a.href);
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

  async function openItem(id) {
    const i=byId(S.items,id); if(!i) return;
    S.selectedItemId=id;
    const photoUrl=await signedUrl('item-photos',i.primary_photo_path,3600);
    const docs=S.safetyDocs.filter(d=>d.item_id===id&&d.active);
    const pos=itemPositions(id);
    const total=itemTotal(id);
    const areaTotals=new Map();
    for(const b of pos){const l=byId(S.locations,b.location_id);if(!l)continue;const key=[l.location_name,l.area_name||'Unassigned'].join(' → ');areaTotals.set(key,(areaTotals.get(key)||0)+num(b.quantity));}
    const recent=S.transactions.filter(t=>t.item_id===id).slice(0,25);
    showModal(`<header><div><h2>${esc(i.name)}</h2><div class="muted">${esc(i.item_code)}</div></div><button class="close" data-close>×</button></header>
      <div class="split"><div>
        ${photoUrl?`<img class="photo" src="${esc(photoUrl)}" alt="${esc(i.name)}">`:''}
        <div class="grid cards" style="margin-top:1rem"><div class="card"><div class="muted">Overall stock</div><div class="stat">${qty(total)}</div></div><div class="card"><div class="muted">Reorder level</div><div class="stat">${qty(i.reorder_level)}</div></div></div>
        <h3>Totals by area</h3>${areaTotals.size?[...areaTotals.entries()].map(([name,q])=>`<div class="location-chip"><strong>${esc(name)}</strong> · ${qty(q)}</div>`).join(''):'<span class="muted">No stock assigned.</span>'}<h3>Exact bins</h3>${pos.length?pos.map(b=>`<div class="location-chip"><strong>${esc(locationLabel(byId(S.locations,b.location_id)))}</strong> · ${qty(b.quantity)}</div>`).join(''):'<div class="notice">No stock location currently has a positive quantity.</div>'}
      </div><div>
        <div class="card"><div><strong>QR value</strong><br>${esc(i.qr_value)}</div><div><strong>Category</strong><br>${esc(i.category||'—')}</div><div><strong>Unit cost</strong><br>${money(i.unit_cost)}</div>${i.is_chemical?'<div style="margin-top:.7rem"><span class="badge chemical">Chemical / hazardous item</span></div>':''}</div>
        <div class="actions"><button class="btn good" data-stock-action="ADD">Add stock</button><button class="btn warn" data-stock-action="USE">Use / remove</button><button class="btn" data-stock-action="MOVE">Move stock</button><button class="btn secondary" data-stock-action="ADJUST">Adjust</button></div>
        <div class="actions"><button class="btn ghost" id="printQrBtn">Print QR</button>${canManage()?'<button class="btn ghost" id="editItemBtn">Edit item</button>':''}</div>
      </div></div>
      ${i.is_chemical?`<div class="card" style="margin-top:1rem"><h3>Safety documents</h3><div id="docList">${docs.length?docs.map(d=>`<div class="item-row"><div><strong>${esc(docTypeLabel(d.document_type))}</strong> · ${esc(d.title)}<div class="muted">Version ${esc(d.version||'—')} · Revision ${esc(d.revision_date||'—')} · Review ${esc(d.review_date||'—')}</div></div><button class="btn ghost" data-open-doc="${d.id}">Open</button></div>`).join(''):'<p class="muted">No safety documents uploaded yet.</p>'}</div>${canManage()?'<button class="btn" id="uploadDocBtn">Upload safety document</button>':''}</div>`:''}
      <div class="card" style="margin-top:1rem"><h3>Recent item history</h3>${transactionTable(recent)}</div>`);
    document.querySelectorAll('[data-stock-action]').forEach(b=>b.onclick=()=>openStockAction(i,b.dataset.stockAction));
    document.getElementById('printQrBtn').onclick=()=>printQr(i);
    const edit=document.getElementById('editItemBtn'); if(edit) edit.onclick=()=>openEditItem(i);
    const up=document.getElementById('uploadDocBtn'); if(up) up.onclick=()=>openSafetyUpload(i);
    document.querySelectorAll('[data-open-doc]').forEach(b=>b.onclick=()=>openSafetyDocument(byId(S.safetyDocs,b.dataset.openDoc)));
  }

  function stockActionForm(item,type) {
    const pos=itemPositions(item.id);
    const locOpts=S.locations.filter(l=>l.active).map(l=>`<option value="${l.id}">${esc(locationLabel(l))}</option>`).join('');
    const posOpts=pos.map(b=>`<option value="${b.location_id}">${esc(locationLabel(byId(S.locations,b.location_id)))} (${qty(b.quantity)} available)</option>`).join('');
    const title={ADD:'Add stock',USE:'Use / remove stock',MOVE:'Move stock',ADJUST:'Adjust stock'}[type];
    return `<header><div><h2>${title}</h2><div class="muted">${esc(item.name)}</div></div><button class="close" data-close>×</button></header><form id="stockActionForm" data-type="${type}">
      ${type==='ADD'?`<label>Destination location / area / bin</label><select id="toLoc" required>${locOpts}</select><label>Quantity added</label><input id="actionQty" type="number" min="0.001" step="0.001" required>`:''}
      ${type==='USE'?`<label>Use from</label><select id="fromLoc" required>${posOpts}</select><label>Quantity used / removed</label><input id="actionQty" type="number" min="0.001" step="0.001" required>`:''}
      ${type==='MOVE'?`<label>Move from</label><select id="fromLoc" required>${posOpts}</select><label>Move to</label><select id="toLoc" required>${locOpts}</select><label>Quantity moved</label><input id="actionQty" type="number" min="0.001" step="0.001" required>`:''}
      ${type==='ADJUST'?`<label>Location / bin</label><select id="fromLoc" required>${S.locations.filter(l=>l.active).map(l=>`<option value="${l.id}">${esc(locationLabel(l))}</option>`).join('')}</select><label>Correct quantity at this location</label><input id="newQty" type="number" min="0" step="0.001" required><label>Reason</label><select id="reason" required><option value="Stock count correction">Stock count correction</option><option value="Damaged">Damaged</option><option value="Lost">Lost</option><option value="Found">Found</option><option value="Data correction">Data correction</option><option value="Other">Other</option></select>`:''}
      ${type!=='ADJUST'?`<label>Reason / reference (optional)</label><input id="reason" placeholder="Delivery, job, damaged, etc.">`:''}
      <label>Notes (optional)</label><textarea id="notes" rows="2"></textarea>
      <div class="actions"><button class="btn" type="submit">Confirm ${title.toLowerCase()}</button></div></form>`;
  }

  function openStockAction(item,type) {
    if((type==='USE'||type==='MOVE')&&!itemPositions(item.id).length){setNotice('There is no positive stock to remove or move.','error');closeModal();render();return;}
    showModal(stockActionForm(item,type));
    const form=document.getElementById('stockActionForm');
    form.onsubmit=async e=>{
      e.preventDefault();
      const from=document.getElementById('fromLoc')?.value||null,to=document.getElementById('toLoc')?.value||null;
      const quantity=num(document.getElementById('actionQty')?.value), newQuantity=document.getElementById('newQty')?num(document.getElementById('newQty').value):null;
      const reason=document.getElementById('reason')?.value||null,notes=document.getElementById('notes')?.value||null;
      const {error}=await sb.rpc('apply_stock_transaction',{p_item_id:item.id,p_type:type,p_quantity:quantity,p_from_location_id:from,p_to_location_id:to,p_new_quantity:newQuantity,p_reason:reason,p_reference:null,p_notes:notes});
      if(error){setNotice(parseError(error),'error');closeModal();render();return;}
      await loadData(); closeModal(); setNotice(`${item.name}: ${type.toLowerCase()} recorded.`); render();
    };
  }

  function openAddLocation() {
    showModal(`<header><h2>Add location / area / bin</h2><button class="close" data-close>×</button></header><form id="locForm"><label>Location</label><input id="locName" placeholder="Workshop Store" required><label>Area (optional)</label><input id="areaName" placeholder="Electrical"><label>Bin number / code (optional)</label><input id="binCode" placeholder="B12"><label>Notes (optional)</label><textarea id="locNotes"></textarea><div class="actions"><button class="btn" type="submit">Save location</button></div></form>`);
    document.getElementById('locForm').onsubmit=async e=>{e.preventDefault(); const row={location_name:document.getElementById('locName').value.trim(),area_name:document.getElementById('areaName').value.trim(),bin_code:document.getElementById('binCode').value.trim(),notes:document.getElementById('locNotes').value.trim()||null}; const {error}=await sb.from('stock_locations').insert(row); if(error){setNotice(parseError(error),'error');closeModal();render();return;} await loadData({transactions:false,docs:false});closeModal();setNotice('Location/bin added.');render();};
  }

  function itemFormHtml(i=null) {
    return `<header><h2>${i?'Edit item':'Add new item'}</h2><button class="close" data-close>×</button></header><form id="itemForm"><div class="form-grid">
      <div><label>Item name</label><input id="newName" value="${esc(i?.name||'')}" required></div>
      <div><label>Item code</label><input id="newCode" value="${esc(i?.item_code||'')}" required></div>
      <div><label>QR value</label><input id="newQr" value="${esc(i?.qr_value||'')}" placeholder="Defaults to item code"><button class="btn ghost" id="generateQr" type="button" style="margin-top:.35rem">Generate code</button></div>
      <div><label>Category</label><input id="newCategory" value="${esc(i?.category||'')}"></div>
      <div><label>Reorder level</label><input id="newReorder" type="number" step="0.001" min="0" value="${esc(i?.reorder_level??0)}"></div>
      <div><label>Unit cost (£, optional)</label><input id="newCost" type="number" step="0.01" min="0" value="${esc(i?.unit_cost??'')}"></div>
      <div class="full"><label><input id="newChemical" type="checkbox" style="width:auto" ${i?.is_chemical?'checked':''}> Chemical / hazardous item (enable safety documents)</label></div>
      <div class="full"><label>Item photo (optional)</label><input id="newPhoto" type="file" accept="image/*" capture="environment"></div>
      ${i?'':`<div><label>Opening stock (optional)</label><input id="openingQty" type="number" min="0" step="0.001" value="0"></div><div><label>Opening location / bin</label><select id="openingLoc"><option value="">None</option>${S.locations.map(l=>`<option value="${l.id}">${esc(locationLabel(l))}</option>`).join('')}</select></div>`}
      </div><div class="actions"><button class="btn" type="submit">${i?'Save changes':'Create item'}</button></div></form>`;
  }

  function openAddItem() { showModal(itemFormHtml()); bindItemForm(null); }
  function openEditItem(i) { showModal(itemFormHtml(i)); bindItemForm(i); }

  function bindItemForm(existing) {
    const name=document.getElementById('newName'),code=document.getElementById('newCode'),qr=document.getElementById('newQr');
    const gen=document.getElementById('generateQr'); if(gen) gen.onclick=()=>{const v=`ITM-${Date.now().toString(36).toUpperCase().slice(-7)}`;qr.value=v;if(!code.value.trim())code.value=v;};
    if(!existing) { let codeTouched=false,qrTouched=false; code.oninput=()=>{codeTouched=true;if(!qrTouched)qr.value=code.value};qr.oninput=()=>qrTouched=true;name.oninput=()=>{if(!codeTouched){code.value=name.value;if(!qrTouched)qr.value=name.value;}}; }
    document.getElementById('itemForm').onsubmit=async e=>{
      e.preventDefault();
      const row={name:name.value.trim(),item_code:code.value.trim(),qr_value:(qr.value.trim()||code.value.trim()),category:document.getElementById('newCategory').value.trim()||null,reorder_level:num(document.getElementById('newReorder').value),unit_cost:document.getElementById('newCost').value===''?null:num(document.getElementById('newCost').value),is_chemical:document.getElementById('newChemical').checked};
      let itemId=existing?.id;
      if(existing){const {error}=await sb.from('items').update(row).eq('id',existing.id);if(error){setNotice(parseError(error),'error');closeModal();render();return;}}
      else {row.created_by=S.profile.id;const {data,error}=await sb.from('items').insert(row).select('id').single();if(error){setNotice(parseError(error),'error');closeModal();render();return;}itemId=data.id;}
      const photo=document.getElementById('newPhoto').files[0];
      if(photo){try{await uploadItemPhoto(itemId,photo);}catch(err){setNotice(`Item saved, but photo upload failed: ${parseError(err)}`,'error');}}
      if(!existing){const opening=num(document.getElementById('openingQty').value),loc=document.getElementById('openingLoc').value;if(opening>0&&loc){const {error}=await sb.rpc('apply_stock_transaction',{p_item_id:itemId,p_type:'ADD',p_quantity:opening,p_from_location_id:null,p_to_location_id:loc,p_new_quantity:null,p_reason:'Opening stock',p_reference:null,p_notes:null});if(error)setNotice(`Item created, but opening stock failed: ${parseError(error)}`,'error');}}
      await loadData();closeModal();if(!S.notice||S.notice.type!=='error')setNotice(existing?'Item updated.':'New item created.');render();
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

  bootstrap();
})();
