/* Inventory Tracker v8.6.5 - shared email/username login.
   Inventory is the master authentication project. This patch adds username login
   without changing stock/data loading.
*/
(() => {
  'use strict';
  if(window.__INVENTORY_MASTER_LOGIN_V865)return;
  window.__INVENTORY_MASTER_LOGIN_V865=true;

  const MASTER_LOGIN='https://zgmcxgumdsssngfgtmth.supabase.co/functions/v1/master-login-v21151';
  const MASTER_KEY='sb_publishable_wRTwr1ZohznS-VLUjoSz2w_Nbv4qiZj';
  const cfg=window.APP_CONFIG||{};
  if(!window.supabase||!cfg.supabaseUrl||!cfg.anonKey)return;

  const authClient=window.supabase.createClient(cfg.supabaseUrl,cfg.anonKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });

  function decorate(){
    const input=document.getElementById('loginEmail');
    if(input){
      input.type='text';
      input.autocomplete='username';
      input.placeholder='Email or username';
      const label=input.previousElementSibling;
      if(label?.tagName==='LABEL')label.textContent='Email or username';
    }
  }

  async function login(identifier,password){
    const res=await fetch(MASTER_LOGIN,{
      method:'POST',
      headers:{'content-type':'application/json','apikey':MASTER_KEY},
      body:JSON.stringify({identifier,password})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data?.access_token||!data?.refresh_token)throw new Error(data?.error||'Sign-in failed.');
    const {error}=await authClient.auth.setSession({
      access_token:data.access_token,
      refresh_token:data.refresh_token
    });
    if(error)throw error;
  }

  window.addEventListener('submit',async e=>{
    if(e.target?.id!=='loginForm')return;
    e.preventDefault();e.stopImmediatePropagation();
    const identifier=(document.getElementById('loginEmail')?.value||'').trim();
    const password=document.getElementById('loginPassword')?.value||'';
    if(!identifier||!password)return;
    const submit=e.target.querySelector('button[type="submit"]');
    const old=submit?.textContent;
    if(submit){submit.disabled=true;submit.textContent='Signing in…'}
    try{
      await login(identifier,password);
      location.reload();
    }catch(err){
      alert(err?.message||'Sign-in failed.');
      if(submit){submit.disabled=false;submit.textContent=old||'Sign in'}
    }
  },true);

  window.addEventListener('click',e=>{
    if(e.target?.id!=='forgotBtn')return;
    const identifier=(document.getElementById('loginEmail')?.value||'').trim();
    if(identifier && !identifier.includes('@')){
      e.preventDefault();e.stopImmediatePropagation();
      alert('Username-only account: ask an Admin to reset your shared password. The reset applies to Inventory, Energy and Safety.');
    }
  },true);

  document.addEventListener('focusin',e=>{if(e.target?.id==='loginEmail')decorate()},true);
  [100,350,900,1800].forEach(ms=>setTimeout(decorate,ms));
})();
