/* Inventory Tracker v8.6.0 - People & Access foundation
   Works alongside app-v859.js without changing stock logic.
   - Username or email sign-in.
   - Per-person Inventory and Energy app access/role.
   - Username-only accounts with one-time temporary password and forced password change.
   - Admin People & Access panel for the shared Inventory/Energy Supabase account directory.
   - Manager day-to-day User view (Admin already has the built-in switch).
   - Home/additional-site access structure ready for multi-site data scoping.
*/
(() => {
  'use strict';
  if(window.__INVENTORY_PEOPLE_ACCESS_V860)return;
  window.__INVENTORY_PEOPLE_ACCESS_V860=true;

  const cfg=window.APP_CONFIG||{};
  if(!window.supabase||!cfg.supabaseUrl||!cfg.anonKey)return;
  const client=window.supabase.createClient(cfg.supabaseUrl,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const slug=v=>clean(v).toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,50);
  const internalEmail=u=>`${slug(u)}@users.invalid`;
  const genPassword=()=>{const a=['River','Maple','Harbour','Copper','Oak','Stone','Glass','Blue'];return `${a[Math.floor(Math.random()*a.length)]}-${Math.floor(1000+Math.random()*9000)}-${a[Math.floor(Math.random()*a.length)]}!`;};
  let session=null,profile=null,moduleRows=[],sites=[],siteAccess=[],capRows=[];

  function notice(msg,type='error'){
    const root=document.getElementById('app');
    const existing=root?.querySelector('.pa-v860-notice');if(existing)existing.remove();
    const login=root?.querySelector('.login');
    if(login){const d=document.createElement('div');d.className=`notice ${type==='error'?'error':'success'} pa-v860-notice`;d.textContent=msg;login.insertBefore(d,login.querySelector('form')||null);return}
    alert(msg);
  }
  function normaliseLogin(v){const x=clean(v).toLowerCase();return x.includes('@')?x:internalEmail(x)}

  async function loadAccess(){
    const {data:{session:s}}=await client.auth.getSession();session=s;if(!s)return;
    const uid=s.user.id;
    const [p,a,ss,sa,c]=await Promise.all([
      client.from('profiles').select('*').eq('id',uid).maybeSingle(),
      client.from('app_module_access').select('*'),
      client.from('organisation_sites_v21137').select('*').order('name'),
      client.from('app_site_access_v21137').select('*'),
      client.from('app_user_capabilities_v21137').select('*')
    ]);
    if(!p.error)profile=p.data||null;if(!a.error)moduleRows=a.data||[];if(!ss.error)sites=ss.data||[];if(!sa.error)siteAccess=sa.data||[];if(!c.error)capRows=c.data||[];
  }
  const moduleFor=(uid,key)=>moduleRows.find(x=>x.user_id===uid&&x.module_key===key)||null;
  const isAdmin=()=>String(profile?.role||'')==='admin';
  const isManager=()=>String(profile?.role||'')==='manager';

  async function enforceInventoryAccess(){
    await loadAccess();if(!session)return;
    const a=moduleFor(session.user.id,'inventory');
    if(a&&a.enabled===false){
      await client.auth.signOut();
      const root=document.getElementById('app');if(root)root.innerHTML='<div class="login"><h1>Inventory Tracker</h1><div class="notice error"><strong>Inventory access is not enabled for this account.</strong><br>Ask an administrator if you need access.</div></div>';
      return false;
    }
    return true;
  }

  function decorateLogin(){
    const input=document.getElementById('loginEmail');if(!input)return;
    input.type='text';input.autocomplete='username';input.placeholder='Email or username';
    const prev=input.previousElementSibling;if(prev?.tagName==='LABEL')prev.textContent='Email or username';
  }
  async function loginCapture(e){
    if(e.target?.id!=='loginForm')return;
    e.preventDefault();e.stopImmediatePropagation();
    const ident=clean(document.getElementById('loginEmail')?.value),pw=document.getElementById('loginPassword')?.value||'';
    if(!ident||!pw)return notice('Enter your email/username and password.');
    const {error}=await client.auth.signInWithPassword({email:normaliseLogin(ident),password:pw});
    if(error)return notice(error.message);
    location.reload();
  }
  async function forgotCapture(e){
    const b=e.target.closest?.('#forgotBtn');if(!b)return;
    e.preventDefault();e.stopImmediatePropagation();
    const ident=clean(document.getElementById('loginEmail')?.value);
    if(!ident)return notice('Enter your email address or username first.');
    if(!ident.includes('@'))return notice('Username-only account: ask an Admin to reset your password. The old password cannot be viewed.');
    const {error}=await client.auth.resetPasswordForEmail(ident.toLowerCase(),{redirectTo:'https://grich295.github.io/inventory-tracker/'});
    notice(error?error.message:'Password reset email sent.',error?'error':'success');
  }

  const workKey=uid=>`inventoryManagerWorkingViewV860:${uid||'unknown'}`;
  function applyManagerWorkingView(){
    if(!session||!isManager())return;
    let user=false;try{user=localStorage.getItem(workKey(session.user.id))==='user'}catch(_){}
    const top=document.querySelector('.top-actions');if(top&&!document.getElementById('managerViewModeV860')){
      const b=document.createElement('button');b.id='managerViewModeV860';b.className='btn secondary';top.prepend(b);b.onclick=()=>{try{localStorage.setItem(workKey(session.user.id),user?'full':'user')}catch(_){};applyManagerWorkingView()};
    }
    const b=document.getElementById('managerViewModeV860');if(b)b.textContent=user?'Return to Manager':'Switch to User';
    const nav=document.querySelector('.nav');if(nav){for(const btn of nav.querySelectorAll('button[data-page]'))btn.style.display=user&&!['dashboard','scan','items','help'].includes(btn.dataset.page)?'none':''}
    let banner=document.getElementById('managerUserBannerV860');if(user&&!banner){banner=document.createElement('div');banner.id='managerUserBannerV860';banner.className='notice warn';banner.innerHTML='<strong>User view:</strong> day-to-day stock screens only. Your Manager permissions and audit identity are unchanged.';document.querySelector('.content')?.prepend(banner)}else if(!user)banner?.remove();
  }

  function modal(title,html){
    document.getElementById('paV860Modal')?.remove();
    const d=document.createElement('div');d.id='paV860Modal';d.className='modal-backdrop';d.innerHTML=`<section class="modal"><header><h2>${esc(title)}</h2><button class="close" data-pa-close>×</button></header>${html}</section>`;document.body.appendChild(d);
    d.addEventListener('click',e=>{if(e.target===d||e.target.closest?.('[data-pa-close]'))d.remove()});
  }
  function siteOptions(selected=''){return '<option value="">No home site yet</option>'+sites.filter(x=>x.active!==false).map(s=>`<option value="${esc(s.id)}" ${s.id===selected?'selected':''}>${esc(s.name)}</option>`).join('')}
  const roleOpts=(app,selected)=>{
    const roles=app==='energy'?[['viewer','Viewer / Reviewer'],['data_inputter','Data Inputter'],['user','User'],['manager','Manager'],['admin','Admin']]:[['viewer','Viewer'],['user','User'],['manager','Manager'],['admin','Admin']];
    return roles.map(([v,l])=>`<option value="${v}" ${selected===v?'selected':''}>${l}</option>`).join('');
  };

  async function peopleAccessPanel(){
    if(!isAdmin())return;
    const host=[...document.querySelectorAll('.card h2')].find(x=>x.textContent.trim()==='Users')?.closest('.card');if(!host)return;
    if(document.getElementById('peopleAccessV860'))return;
    const [profiles,access,sa,caps]=await Promise.all([
      client.from('profiles').select('*').order('display_name'),
      client.from('app_module_access').select('*'),
      client.from('app_site_access_v21137').select('*'),
      client.from('app_user_capabilities_v21137').select('*')
    ]);
    if(profiles.error||access.error)return;
    moduleRows=access.data||[];siteAccess=sa.data||[];capRows=caps.data||[];
    const rows=(profiles.data||[]).map(p=>{const inv=moduleFor(p.id,'inventory'),en=moduleFor(p.id,'energy');return `<div class="item-card compact"><div class="row-between"><div><strong>${esc(p.display_name||p.login_username||p.email||'User')}</strong><div class="meta">${p.email?`<span>${esc(p.email)}</span>`:''}${p.login_username?`<span>Username: ${esc(p.login_username)}</span>`:''}<span class="badge ${inv?.enabled===false?'':'good'}">Inventory ${inv?.enabled===false?'OFF':esc(inv?.role_override||'user')}</span><span class="badge ${en?.enabled?'good':''}">Energy ${en?.enabled?esc(en?.role_override||'user'):'OFF'}</span></div></div><button class="btn secondary small" data-pa-edit="${p.id}">Access</button></div></div>`}).join('');
    const wrap=document.createElement('div');wrap.id='peopleAccessV860';wrap.className='card';wrap.innerHTML=`<div class="row-between"><div><h2>People & App Access</h2><p class="muted">A person's main account and each app are separate. Turn on only the apps they need and choose a role for each one.</p></div><button class="btn" data-pa-create>Create user</button></div><div class="card-list">${rows}</div>`;
    host.parentElement.insertBefore(wrap,host);
  }

  async function showEdit(uid){
    const [pr]=await Promise.all([client.from('profiles').select('*').eq('id',uid).single()]);if(pr.error)return notice(pr.error.message);const p=pr.data,inv=moduleFor(uid,'inventory')||{},en=moduleFor(uid,'energy')||{};
    modal('People & App Access',`<div class="card compact"><strong>${esc(p.display_name||p.email||p.login_username||'User')}</strong><div class="muted">${p.login_username?`Username: ${esc(p.login_username)}`:esc(p.email||'')}</div></div><div class="form-grid"><label><input id="paInvEnabled" type="checkbox" ${inv.enabled!==false?'checked':''}> Inventory access</label><label>Inventory role<select id="paInvRole">${roleOpts('inventory',inv.role_override|| (p.role==='staff'?'user':p.role))}</select></label><label>Inventory home site<select id="paInvHome">${siteOptions(inv.home_site_id||'')}</select></label><label><input id="paEnergyEnabled" type="checkbox" ${en.enabled?'checked':''}> Energy access</label><label>Energy role<select id="paEnergyRole">${roleOpts('energy',en.role_override|| (p.role==='staff'?'user':p.role))}</select></label><label>Energy home site<select id="paEnergyHome">${siteOptions(en.home_site_id||'')}</select></label></div><div class="notice warn"><strong>Additional sites:</strong> the database structure is ready now. Actual stock/energy records will be site-filtered as each module completes its multi-site data migration.</div><div class="actions">${p.login_username?`<button class="btn secondary" data-pa-reset="${uid}">Reset username password</button>`:''}<button class="btn ghost" data-pa-close>Cancel</button><button class="btn" data-pa-save="${uid}">Save access</button></div>`);
  }
  async function saveEdit(uid,b){
    b.disabled=true;b.textContent='Saving…';
    for(const app of ['inventory','energy']){
      const cap=app==='inventory'?'Inv':'Energy',enabled=document.getElementById(`pa${cap}Enabled`)?.checked||false,role=document.getElementById(`pa${cap}Role`)?.value||'user',home=document.getElementById(`pa${cap}Home`)?.value||null,view=role==='viewer'?'viewer':role==='data_inputter'?'inputter':['admin','manager'].includes(role)?'full':'user';
      const {error}=await client.rpc('set_user_app_access_v21137',{p_user_id:uid,p_module_key:app,p_enabled:enabled,p_role:role,p_preferred_view:view,p_home_site_id:home});if(error){b.disabled=false;b.textContent='Save access';return notice(error.message)}
    }
    document.getElementById('paV860Modal')?.remove();document.getElementById('peopleAccessV860')?.remove();await loadAccess();peopleAccessPanel();
  }
  function showCreate(){
    const pw=genPassword();modal('Create user',`<div class="form-grid"><label>Name<input id="paName"></label><label>Email (optional)<input id="paEmail" type="email" placeholder="Leave blank for username-only account"></label><label>Username (optional)<input id="paUsername" placeholder="e.g. jsmith"></label><label>Temporary password<input id="paPassword" value="${esc(pw)}"><span class="muted">Required for username-only accounts; shown once and changed at first sign-in.</span></label><label>Main account level<select id="paPrimary"><option value="staff">User</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label><label><input id="paCreateInv" type="checkbox" checked> Inventory access</label><label>Inventory role<select id="paCreateInvRole">${roleOpts('inventory','user')}</select></label><label><input id="paCreateEnergy" type="checkbox"> Energy access</label><label>Energy role<select id="paCreateEnergyRole">${roleOpts('energy','viewer')}</select></label><label>Home site<select id="paCreateHome">${siteOptions(sites[0]?.id||'')}</select></label></div><div class="notice warn"><strong>No email?</strong> Give the person the username and temporary password. If forgotten, an Admin issues another temporary password. Existing passwords are never visible.</div><div class="actions"><button class="btn ghost" data-pa-close>Cancel</button><button class="btn" data-pa-create-confirm>Create user</button></div>`)
  }
  async function callManage(body){const {data,error}=await client.functions.invoke('manage-user-access-v21137',{body});if(error)throw error;return data||{}}
  async function createUser(b){
    const name=clean(document.getElementById('paName')?.value),email=clean(document.getElementById('paEmail')?.value).toLowerCase(),username=slug(document.getElementById('paUsername')?.value),password=document.getElementById('paPassword')?.value||'',primary=document.getElementById('paPrimary')?.value||'staff',home=document.getElementById('paCreateHome')?.value||null;
    if(!name)return notice('Name is required.');if(!email&&!username)return notice('Enter an email address or username.');if(!email&&password.length<10)return notice('Username-only accounts need a temporary password of at least 10 characters.');
    b.disabled=true;b.textContent='Creating…';
    try{
      const apps=[{app:'inventory',enabled:!!document.getElementById('paCreateInv')?.checked,role:document.getElementById('paCreateInvRole')?.value||'user',home_site_id:home},{app:'energy',enabled:!!document.getElementById('paCreateEnergy')?.checked,role:document.getElementById('paCreateEnergyRole')?.value||'viewer',home_site_id:home}];
      const out=await callManage({action:'create',display_name:name,email:email||null,username:username||null,temporary_password:password,primary_role:primary,apps,redirect_to:'https://grich295.github.io/inventory-tracker/'});
      document.getElementById('paV860Modal')?.remove();document.getElementById('peopleAccessV860')?.remove();await loadAccess();peopleAccessPanel();
      if(!email)modal('Username account created',`<div class="notice success"><strong>Copy these details now.</strong></div><p>Username: <strong>${esc(username)}</strong><br>Temporary password: <strong>${esc(password)}</strong></p><p class="muted">The user must change it at first sign-in. It cannot be displayed later.</p><div class="actions"><button class="btn" data-pa-close>Close</button></div>`);else notice(`Invitation sent to ${email}.`,'success');
    }catch(e){b.disabled=false;b.textContent='Create user';notice(e.message||String(e))}
  }
  async function resetPassword(uid){const pw=prompt('New temporary password (10+ characters):',genPassword());if(!pw)return;if(pw.length<10)return notice('Temporary password must be at least 10 characters.');try{await callManage({action:'reset_password',user_id:uid,temporary_password:pw});modal('Password reset',`<div class="notice success"><strong>Temporary password set.</strong></div><p>${esc(pw)}</p><p class="muted">Copy it now. The user must change it next sign-in.</p><div class="actions"><button class="btn" data-pa-close>Close</button></div>`)}catch(e){notice(e.message||String(e))}}

  function installEvents(){
    document.addEventListener('submit',loginCapture,true);
    document.addEventListener('click',e=>{
      forgotCapture(e);
      const create=e.target.closest?.('[data-pa-create]');if(create){e.preventDefault();showCreate();return}
      const edit=e.target.closest?.('[data-pa-edit]');if(edit){e.preventDefault();showEdit(edit.dataset.paEdit);return}
      const save=e.target.closest?.('[data-pa-save]');if(save){e.preventDefault();saveEdit(save.dataset.paSave,save);return}
      const cc=e.target.closest?.('[data-pa-create-confirm]');if(cc){e.preventDefault();createUser(cc);return}
      const rr=e.target.closest?.('[data-pa-reset]');if(rr){e.preventDefault();resetPassword(rr.dataset.paReset);return}
    },true);
    const obs=new MutationObserver(()=>{decorateLogin();applyManagerWorkingView();peopleAccessPanel()});obs.observe(document.body,{childList:true,subtree:true});
  }

  async function boot(){
    await enforceInventoryAccess();installEvents();decorateLogin();applyManagerWorkingView();setTimeout(peopleAccessPanel,250);
    client.auth.onAuthStateChange(async(_e,s)=>{session=s;if(s){await enforceInventoryAccess();applyManagerWorkingView();setTimeout(peopleAccessPanel,200)}});
  }
  boot().catch(e=>console.warn('People & Access v8.6.0',e));
})();
