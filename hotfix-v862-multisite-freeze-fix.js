/* Inventory Tracker v8.6.2 CLEAN - Multi-site freeze fix
   Database migration is already applied.
   - Existing Inventory records are assigned to Main Hotel.
   - Current site is enforced server-side by RLS.
   - New sites start with defaults only: categories/settings; no items, stock, locations, orders or history.
   - Admins automatically see new sites; other people require explicit site access.
   - Existing Backup page remains available and is now naturally current-site scoped by RLS.
*/
(() => {
  'use strict';
  if(window.__INVENTORY_MULTISITE_V862)return;
  window.__INVENTORY_MULTISITE_V862=true;

  const cfg=window.APP_CONFIG||{};
  if(!window.supabase||!cfg.supabaseUrl||!cfg.anonKey)return;
  const sb=window.supabase.createClient(cfg.supabaseUrl,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();

  let session=null,profile=null,access=null,sites=[],mySiteAccess=[],allSiteAccess=[],statusRows=[],currentSiteId=null;
  let decorateQueued=false,loaded=false;

  const role=()=>String(access?.role_override||(profile?.role==='staff'?'user':profile?.role)||'user').toLowerCase();
  const isAdmin=()=>role()==='admin';
  const allowedSites=()=>isAdmin()?sites.filter(s=>s.active!==false):sites.filter(s=>s.active!==false&&mySiteAccess.some(a=>a.site_id===s.id&&a.enabled!==false));
  const siteName=id=>sites.find(s=>s.id===id)?.name||'Site';
  const statusFor=(id,module='inventory')=>statusRows.find(x=>x.site_id===id&&x.module_key===module)||null;

  function flash(msg,type='success'){
    let d=document.getElementById('inventorySiteFlashV862');
    if(!d){d=document.createElement('div');d.id='inventorySiteFlashV862';Object.assign(d.style,{position:'fixed',left:'16px',right:'16px',bottom:'16px',zIndex:'99999',padding:'12px 14px',borderRadius:'10px',boxShadow:'0 6px 24px rgba(0,0,0,.18)'});document.body.appendChild(d)}
    d.style.background=type==='error'?'#fee2e2':'#ecfdf5';d.style.border=`1px solid ${type==='error'?'#ef4444':'#10b981'}`;d.textContent=msg;
    setTimeout(()=>d.remove(),5000);
  }

  async function loadState(){
    const {data:{session:s}}=await sb.auth.getSession();session=s;
    if(!s){loaded=true;return}
    const uid=s.user.id;
    const [p,a,os,sa,st,cur]=await Promise.all([
      sb.from('profiles').select('*').eq('id',uid).maybeSingle(),
      sb.from('app_module_access').select('*').eq('user_id',uid).eq('module_key','inventory').maybeSingle(),
      sb.from('organisation_sites_v21137').select('*').order('name'),
      sb.from('app_site_access_v21137').select('*').eq('user_id',uid).eq('module_key','inventory'),
      sb.from('site_module_status_v21138').select('*'),
      sb.rpc('current_app_site_v21138',{p_module_key:'inventory'})
    ]);
    profile=p.data||null;access=a.data||null;sites=os.data||[];mySiteAccess=sa.data||[];statusRows=st.data||[];currentSiteId=cur.data||access?.home_site_id||null;
    if(isAdmin()){
      const asa=await sb.from('app_site_access_v21137').select('*');
      if(!asa.error)allSiteAccess=asa.data||[];
    }
    loaded=true;
  }

  async function switchSite(siteId){
    if(!siteId||siteId===currentSiteId)return;
    const {error}=await sb.rpc('set_current_app_site_v21138',{p_module_key:'inventory',p_site_id:siteId});
    if(error)return flash(error.message,'error');
    location.reload();
  }

  function decorateVersion(){
    document.querySelectorAll('.app-version-badge').forEach(x=>{
      if(x.textContent!=='v8.6.2')x.textContent='v8.6.2';
    });
  }

  function decorateSwitcher(){
    if(!session||!loaded)return;
    const top=document.querySelector('.top-actions');if(!top)return;
    let wrap=document.getElementById('inventorySiteSwitcherV862');
    if(!wrap){
      wrap=document.createElement('div');
      wrap.id='inventorySiteSwitcherV862';
      wrap.style.display='flex';wrap.style.gap='.4rem';wrap.style.alignItems='center';
      top.prepend(wrap);
    }
    const rows=allowedSites();
    const signature=[currentSiteId,...rows.map(s=>`${s.id}:${s.name}`)].join('|');
    if(wrap.dataset.signature!==signature){
      wrap.dataset.signature=signature;
      wrap.innerHTML=`<label style="display:flex;align-items:center;gap:.35rem;margin:0"><span style="font-size:.78rem;opacity:.78">Site</span><select id="inventorySiteSelectV862" style="max-width:190px">${rows.map(s=>`<option value="${esc(s.id)}" ${s.id===currentSiteId?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`;
    }
    const sel=document.getElementById('inventorySiteSelectV862');
    if(sel&&!sel.dataset.boundV862){
      sel.dataset.boundV862='1';
      sel.addEventListener('change',()=>switchSite(sel.value));
    }
  }

  function siteCardHtml(){
    return `<div class="card" id="inventorySitesV862">
      <div class="row-between"><div><h2>Sites</h2><p class="muted">New sites start clean. Inventory gets only default settings/categories; Energy gets a blank site shell. No stock, history, invoices, readings or other operational records are copied.</p></div><button class="btn" type="button" data-v862-create-site>New site</button></div>
      <div class="card-list">${sites.filter(s=>s.active!==false).map(s=>{
        const inv=statusFor(s.id,'inventory'),en=statusFor(s.id,'energy'),current=s.id===currentSiteId;
        return `<div class="item-card compact"><div class="row-between"><div><strong>${esc(s.name)}</strong><div class="meta"><span class="badge ${current?'good':''}">${current?'CURRENT':'Site'}</span><span>Inventory: ${esc(inv?.status||'READY')}</span><span>Energy: ${esc(en?.status||'READY')}</span></div><small>${esc(inv?.note||'')}</small></div>${s.id!==currentSiteId?`<button class="btn secondary small" type="button" data-v862-open-site="${esc(s.id)}">Open Inventory</button>`:''}</div></div>`;
      }).join('')}</div>
      <div class="notice warn"><strong>Access rule:</strong> Admins get a newly-created site automatically. Managers, Users and Viewers must be explicitly given that site in People & App Access.</div>
    </div>`;
  }

  function decorateSitesAdmin(){
    if(!isAdmin())return;
    const people=document.getElementById('peopleAccessV860');
    const usersHeading=[...document.querySelectorAll('.card h2')].find(x=>clean(x.textContent)==='Users')?.closest('.card');
    const anchor=people||usersHeading;if(!anchor||document.getElementById('inventorySitesV862'))return;
    anchor.insertAdjacentHTML('beforebegin',siteCardHtml());
  }

  function decorateBackup(){
    const h=[...document.querySelectorAll('h1,h2,h3')].find(x=>clean(x.textContent).toLowerCase()==='backup');
    const card=h?.closest('.card');if(!card||card.querySelector('.site-backup-note-v862'))return;
    const d=document.createElement('div');d.className='notice success site-backup-note-v862';
    d.innerHTML=`<strong>Current-site backup:</strong> this backup is now isolated to <b>${esc(siteName(currentSiteId))}</b>. Other sites are not mixed into it.`;
    h.insertAdjacentElement('afterend',d);
  }

  async function createSite(){
    const name=clean(prompt('New site name:',''));if(!name)return;
    if(!confirm(`Create "${name}" as a clean new site?\n\nNo existing stock, history, Energy data or operational records will be copied.`))return;
    const {data,error}=await sb.rpc('create_clean_site_v21138',{p_name:name,p_timezone:'Europe/London'});
    if(error)return flash(error.message,'error');
    await loadState();
    document.getElementById('inventorySitesV862')?.remove();
    decorateSitesAdmin();decorateSwitcher();
    flash(`${name} created with clean Inventory defaults and a blank Energy setup.`);
  }

  function decorateAccessModal(){
    if(!isAdmin())return;
    const m=document.getElementById('paV860Modal');if(!m||m.dataset.v862Sites==='1')return;
    const save=m.querySelector('[data-pa-save]');if(!save)return;
    const uid=save.dataset.paSave;m.dataset.v862Sites='1';
    const invHome=m.querySelector('#paInvHome')?.value||'',energyHome=m.querySelector('#paEnergyHome')?.value||'';
    const checks=(module,home)=>sites.filter(s=>s.active!==false).map(s=>{
      const row=allSiteAccess.find(a=>a.user_id===uid&&a.module_key===module&&a.site_id===s.id&&a.enabled!==false);
      const checked=row||s.id===home;
      return `<label style="display:flex;gap:.45rem;align-items:center"><input class="v862-extra-site" data-module="${module}" value="${esc(s.id)}" type="checkbox" ${checked?'checked':''} ${s.id===home?'disabled':''}>${esc(s.name)}${s.id===home?' · Home':''}</label>`;
    }).join('');
    const section=document.createElement('div');section.className='card';section.innerHTML=`<h3>Additional sites</h3><p class="muted">Home Site stays the default. Tick only the extra sites this person actually needs.</p><div class="form-grid"><div><strong>Inventory</strong>${checks('inventory',invHome)}</div><div><strong>Energy</strong>${checks('energy',energyHome)}</div></div>`;
    const actions=m.querySelector('.actions');actions?.insertAdjacentElement('beforebegin',section);

    save.addEventListener('click',()=>{
      const snapshot={
        uid,
        invHome:m.querySelector('#paInvHome')?.value||null,
        enHome:m.querySelector('#paEnergyHome')?.value||null,
        invRole:m.querySelector('#paInvRole')?.value||'user',
        enRole:m.querySelector('#paEnergyRole')?.value||'viewer',
        selected:[...m.querySelectorAll('.v862-extra-site:checked')].map(x=>({module:x.dataset.module,site:x.value}))
      };
      setTimeout(async()=>{
        if(document.getElementById('paV860Modal'))return; // base save did not finish successfully
        try{
          for(const module of ['inventory','energy']){
            const home=module==='inventory'?snapshot.invHome:snapshot.enHome;
            const r=module==='inventory'?snapshot.invRole:snapshot.enRole;
            for(const s of sites.filter(x=>x.active!==false)){
              const extra=snapshot.selected.some(x=>x.module===module&&x.site===s.id);
              const enabled=s.id===home||extra;
              const {error}=await sb.rpc('set_user_site_access_v21137',{
                p_user_id:snapshot.uid,p_module_key:module,p_site_id:s.id,p_enabled:enabled,p_role_override:r,p_is_home:s.id===home
              });
              if(error)throw error;
            }
          }
          flash('Additional site access saved.');
          await loadState();
        }catch(e){flash(e.message||String(e),'error')}
      },650);
    },{once:true});
  }

  function decorate(){
    decorateQueued=false;
    decorateVersion();decorateSwitcher();decorateSitesAdmin();decorateBackup();decorateAccessModal();
  }
  function queueDecorate(){if(decorateQueued)return;decorateQueued=true;setTimeout(decorate,120)}

  document.addEventListener('click',e=>{
    const n=e.target.closest?.('[data-v862-create-site]');if(n){e.preventDefault();createSite();return}
    const o=e.target.closest?.('[data-v862-open-site]');if(o){e.preventDefault();switchSite(o.dataset.v862OpenSite);return}
    queueDecorate();
  },true);

  (async()=>{
    await loadState();
    queueDecorate();
    const obs=new MutationObserver(queueDecorate);obs.observe(document.body,{childList:true,subtree:true});
    sb.auth.onAuthStateChange(async(_e,s)=>{session=s;if(s){await loadState();queueDecorate()}});
  })().catch(e=>console.warn('Inventory multi-site v8.6.2',e));
})();
