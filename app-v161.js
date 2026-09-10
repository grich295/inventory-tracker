/* Safety Tracker v1.2 Final */
const CFG = window.SAFETY_TRACKER_CONFIG || {};
const configured = CFG.supabaseUrl && CFG.supabaseKey && !CFG.supabaseUrl.includes('PASTE_') && !CFG.supabaseKey.includes('PASTE_');
const sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;

const state = { user:null, profile:null, people:[], documents:[], versions:[], docAssignments:[], docSignoffs:[], docConfirmations:[], documentLinks:[], documentReviews:[], training:[], trainingAssignments:[], trainingSignoffs:[], trainingConfirmations:[], trainingFiles:[] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fmtDate = d => d ? new Date(d + (String(d).length===10?'T00:00:00':'' )).toLocaleDateString('en-GB') : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-GB') : '—';
const todayISO = () => new Date().toISOString().slice(0,10);
const daysFromNow = n => { const d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const isManager = () => ['admin','manager'].includes(state.profile?.role);
const isAdmin = () => state.profile?.role === 'admin';

const deliveryText = m => m==='INSTRUCTOR_LED' ? 'Instructor-led' : 'Self-training';
function defaultDocDelivery(type){ return type==='SSW' ? 'INSTRUCTOR_LED' : 'SELF_TRAINING'; }
function defaultTrainingDelivery(type){ return ['TOOLBOX_TALK','INDUCTION'].includes(type) ? 'INSTRUCTOR_LED' : 'SELF_TRAINING'; }
function docEvents(assignment){return state.docConfirmations.filter(c=>c.assignment_id===assignment.id).sort((a,b)=>new Date(b.confirmed_at)-new Date(a.confirmed_at))}
function trainingEvents(assignment){return state.trainingConfirmations.filter(c=>c.assignment_id===assignment.id).sort((a,b)=>new Date(b.confirmed_at)-new Date(a.confirmed_at))}
function latestDocEvent(assignment){return docEvents(assignment)[0]}
function latestTrainingEvent(assignment){return trainingEvents(assignment)[0]}
function latestDocConfirmation(assignment){return docEvents(assignment).find(c=>(c.attendance_status||'ATTENDED')==='ATTENDED')}
function latestTrainingConfirmation(assignment){return trainingEvents(assignment).find(c=>(c.attendance_status||'ATTENDED')==='ATTENDED')}
function freshConfirmation(confirmation,signoff){return !!confirmation&&(!signoff||new Date(confirmation.confirmed_at)>new Date(signoff.signed_at))}

function effectiveDocumentMethod(d,a,v=null){
  const version=v||(a?state.versions.find(x=>x.id===a.document_version_id):currentVersion(d?.id));
  return a?.delivery_method_override||version?.delivery_method||d?.delivery_method||defaultDocDelivery(d?.doc_type);
}
function effectiveTrainingMethod(t,a){return a?.delivery_method_override||t?.delivery_method||defaultTrainingDelivery(t?.session_type)}
function methodOverrideNote(a){
  if(a?.delivery_method_override==='INSTRUCTOR_LED') return 'Assignee requested instructor-led support';
  return '';
}
function setupSignaturePad(canvasId,clearButtonId){
  const canvas=$(canvasId);if(!canvas)return;
  const statusId=canvasId.replace('SignaturePad','SignatureStatus');
  const status=$(statusId);

  canvas.style.touchAction='none';
  canvas.style.userSelect='none';
  canvas.style.webkitUserSelect='none';
  canvas.style.backgroundColor='#ffffff';
  canvas.style.colorScheme='light';

  const rect=canvas.getBoundingClientRect();
  const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,3));
  canvas.width=Math.max(1,Math.round(rect.width*dpr));
  canvas.height=Math.max(1,Math.round(rect.height*dpr));

  const ctx=canvas.getContext('2d');

  const resetSurface=()=>{
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.restore();
    canvas.dataset.hasInk='';
    if(status){
      status.textContent='Signature not yet captured';
      status.classList.remove('signature-ok');
    }
  };

  resetSurface();

  ctx.lineWidth=2.6*dpr;
  ctx.lineCap='round';
  ctx.lineJoin='round';
  ctx.strokeStyle='#111111';

  let drawing=false,last=null,activePointer=null;

  const localPoint=(clientX,clientY)=>{
    const r=canvas.getBoundingClientRect();
    return {
      x:(clientX-r.left)*(canvas.width/r.width),
      y:(clientY-r.top)*(canvas.height/r.height)
    };
  };

  const markCaptured=()=>{
    canvas.dataset.hasInk='1';
    if(status){
      status.textContent='✓ Signature captured';
      status.classList.add('signature-ok');
    }
  };

  const begin=(clientX,clientY)=>{
    drawing=true;
    last=localPoint(clientX,clientY);
    // Draw a tiny dot so even a tap is registered.
    ctx.beginPath();
    ctx.arc(last.x,last.y,Math.max(1.2*dpr,2),0,Math.PI*2);
    ctx.fillStyle='#111111';
    ctx.fill();
    markCaptured();
  };

  const draw=(clientX,clientY)=>{
    if(!drawing||!last)return;
    const p=localPoint(clientX,clientY);
    ctx.beginPath();
    ctx.moveTo(last.x,last.y);
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
    last=p;
    markCaptured();
  };

  const finish=()=>{
    drawing=false;
    last=null;
    activePointer=null;
  };

  if(window.PointerEvent){
    canvas.addEventListener('pointerdown',e=>{
      e.preventDefault();
      activePointer=e.pointerId;
      try{canvas.setPointerCapture(e.pointerId)}catch(_){}
      begin(e.clientX,e.clientY);
    });
    canvas.addEventListener('pointermove',e=>{
      if(!drawing||e.pointerId!==activePointer)return;
      e.preventDefault();
      draw(e.clientX,e.clientY);
    });
    canvas.addEventListener('pointerup',e=>{
      if(e.pointerId!==activePointer)return;
      e.preventDefault();
      try{canvas.releasePointerCapture(e.pointerId)}catch(_){}
      finish();
    });
    canvas.addEventListener('pointercancel',finish);
  }else{
    canvas.addEventListener('touchstart',e=>{
      if(!e.touches.length)return;
      e.preventDefault();
      const t=e.touches[0];
      begin(t.clientX,t.clientY);
    },{passive:false});
    canvas.addEventListener('touchmove',e=>{
      if(!drawing||!e.touches.length)return;
      e.preventDefault();
      const t=e.touches[0];
      draw(t.clientX,t.clientY);
    },{passive:false});
    canvas.addEventListener('touchend',e=>{e.preventDefault();finish();},{passive:false});
    canvas.addEventListener('touchcancel',finish,{passive:false});
    canvas.addEventListener('mousedown',e=>{e.preventDefault();begin(e.clientX,e.clientY)});
    canvas.addEventListener('mousemove',e=>{if(drawing)draw(e.clientX,e.clientY)});
    window.addEventListener('mouseup',finish);
  }

  if($(clearButtonId)){
    $(clearButtonId).onclick=resetSurface;
  }
}
function signatureData(canvasId){
  const canvas=$(canvasId);
  if(!canvas||canvas.dataset.hasInk!=='1')return null;
  const out=document.createElement('canvas');
  out.width=520;out.height=156;
  const c=out.getContext('2d');
  c.fillStyle='#ffffff';
  c.fillRect(0,0,out.width,out.height);
  c.drawImage(canvas,0,0,out.width,out.height);
  return out.toDataURL('image/png');
}
function signatureBlock(prefix){
  const name=esc(state.profile?.display_name||state.user?.email||'');
  return `<div class="full signature-wrap"><label>Digital signature name<input id="${prefix}SignatureName" value="${name}"></label><div><div class="signature-label">Sign below with your finger or mouse</div><canvas id="${prefix}SignaturePad" class="signature-pad" width="700" height="210" aria-label="Digital signature pad"></canvas><div id="${prefix}SignatureStatus" class="signature-status">Signature not yet captured</div></div><div class="row">${btn('Clear signature','ghost',`id="${prefix}ClearSignature"`)}</div><div class="signature-note">Draw your signature in the white box. When it is recognised, you will see “✓ Signature captured”.</div></div>`;
}
function docTypeLabel(type){
  return ({RISK_ASSESSMENT:'Risk Assessment',COSHH:'COSHH',SSW:'Safe System of Work',SDS:'SDS / MSDS',POLICY:'Policy',PROCEDURE:'Procedure',OTHER:'Other'})[type]||String(type||'');
}
function inferLinkType(a,b){
  if(a?.doc_type==='SDS'&&b?.doc_type==='COSHH')return {source:a,target:b,type:'SDS_TO_COSHH'};
  if(a?.doc_type==='COSHH'&&b?.doc_type==='SDS')return {source:b,target:a,type:'SDS_TO_COSHH'};
  if(a?.doc_type==='COSHH'&&b?.doc_type==='SSW')return {source:a,target:b,type:'COSHH_TO_SSW'};
  if(a?.doc_type==='SSW'&&b?.doc_type==='COSHH')return {source:b,target:a,type:'COSHH_TO_SSW'};
  if(a?.doc_type==='RISK_ASSESSMENT'&&b?.doc_type==='SSW')return {source:a,target:b,type:'RA_TO_SSW'};
  if(a?.doc_type==='SSW'&&b?.doc_type==='RISK_ASSESSMENT')return {source:b,target:a,type:'RA_TO_SSW'};
  return {source:a,target:b,type:'RELATED'};
}
function linkTypeLabel(type){
  return ({SDS_TO_COSHH:'SDS/MSDS -> COSHH',COSHH_TO_SSW:'COSHH -> SSW',RA_TO_SSW:'RA -> SSW',RELATED:'Related document'})[type]||type;
}
function linksForDocument(docId){return state.documentLinks.filter(l=>l.source_document_id===docId||l.target_document_id===docId)}
function otherDocForLink(link,docId){const id=link.source_document_id===docId?link.target_document_id:link.source_document_id;return state.documents.find(d=>d.id===id)}
function relatedDocumentButtons(docId){
  const links=linksForDocument(docId),seen=new Set(),parts=[];
  for(const l of links){const d=otherDocForLink(l,docId);if(!d||seen.has(d.id))continue;seen.add(d.id);const v=currentVersion(d.id);if(v)parts.push(btn(`${docTypeLabel(d.doc_type)}: ${d.title}`,'ghost',`data-open-doc="${v.id}"`))}
  return parts.join('');
}


function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.hidden=true,3500)}
function showAuthMessage(msg){$('authMessage').textContent=msg;$('authMessage').hidden=false}
function openModal(title, html){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modal').showModal()}
function closeModal(){$('modal').close()}
function btn(label, cls='secondary', attrs=''){return `<button type="button" class="${cls}" ${attrs}>${esc(label)}</button>`}
function renewalText(value,unit){if(!value||!unit)return 'One-off';return `Every ${value} ${unit.toLowerCase()}`}
function addRenewal(date,value,unit){if(!date||!value||!unit)return null;const d=new Date(date);if(unit==='DAYS')d.setDate(d.getDate()+Number(value));if(unit==='MONTHS')d.setMonth(d.getMonth()+Number(value));if(unit==='YEARS')d.setFullYear(d.getFullYear()+Number(value));return d.toISOString();}
function statusFromDue(due, complete){if(complete && !due)return 'complete';if(!due)return complete?'complete':'due';const now=new Date();const dd=new Date(due);if(dd<now)return 'overdue';return complete?'complete':'due'}

async function init(){
  if(!configured){showAuthMessage('Open config.js and add the separate Safety Tracker Supabase URL and publishable key first.');return;}
  $('loginForm').addEventListener('submit', login);
  $('forgotPasswordBtn').addEventListener('click', forgotPassword);
  $('signOutBtn').addEventListener('click', ()=>sb.auth.signOut());
  $('mainNav').addEventListener('click', e=>{const b=e.target.closest('button[data-view]');if(b)showView(b.dataset.view)});
  $('newDocumentBtn').addEventListener('click', showNewDocument);
  $('newTrainingBtn').addEventListener('click', showNewTraining);
  $('inviteUserBtn').addEventListener('click', showInviteUser);
  $('backupBtn').addEventListener('click', downloadBackup);
  $('fullBackupBtn').addEventListener('click', downloadFullBackup);
  $('fullEvidencePdfBtn').addEventListener('click', downloadEvidencePDF);
  $('completePasswordSetupBtn').addEventListener('click', completeMandatoryPasswordSetup);
  ['documentSearch','documentTypeFilter','documentStatusFilter'].forEach(id=>$(id).addEventListener('input',renderDocuments));
  ['trainingSearch','trainingTypeFilter'].forEach(id=>$(id).addEventListener('input',renderTraining));
  ['compliancePersonFilter','complianceKindFilter','complianceStatusFilter'].forEach(id=>$(id).addEventListener('input',renderCompliance));
  ['instructorPersonFilter','instructorKindFilter','instructorStatusFilter'].forEach(id=>$(id)?.addEventListener('input',renderInstructor));
  $('openGroupAttendanceBtn')?.addEventListener('click',()=>{
    const id=$('groupTrainingSelect')?.value;
    if(!id)return toast('Select a training session first.');
    showInstructorGroupAttendance(id);
  });
  document.querySelectorAll('[data-report]').forEach(b=>b.addEventListener('click',()=>downloadReport(b.dataset.report)));
  document.body.addEventListener('click', globalClick);

  const {data:{session}}=await sb.auth.getSession();
  if(session) await enterApp(session.user); else showLogin();
  sb.auth.onAuthStateChange(async (event,session)=>{
    if(event==='PASSWORD_RECOVERY' && session){showPasswordReset();return;}
    if(session && (!state.user || state.user.id!==session.user.id)) await enterApp(session.user);
    if(!session){state.user=null;state.profile=null;showLogin()}
  });
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

async function login(e){e.preventDefault();$('authMessage').hidden=true;const {error}=await sb.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});if(error)showAuthMessage(error.message)}
async function forgotPassword(){
  const email=$('loginEmail').value.trim().toLowerCase();
  if(!email)return showAuthMessage('Enter your email address first.');
  const b=$('forgotPasswordBtn'),old=b?.textContent||'Forgot password?';
  if(b){b.disabled=true;b.textContent='Sending…';}
  try{
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    showAuthMessage(error?`Password reset failed: ${error.message}`:'Password reset request sent. Check Inbox and Junk/Spam. Supabase may rate-limit auth emails.');
  }catch(e){
    showAuthMessage(`Password reset failed: ${e?.message||e}`);
  }finally{
    if(b){b.disabled=false;b.textContent=old;}
  }
}
function showPasswordReset(){openModal('Set new password',`<div class="stack"><label>New password<input id="newPassword" type="password" minlength="8"></label><div class="actions">${btn('Save password','primary','id="saveNewPassword"')}</div></div>`)}

function showMandatoryPasswordSetup(user){
  state.user=user;state.profile=null;$('appView').hidden=true;$('authView').hidden=false;
  $('loginForm').hidden=true;$('forgotPasswordBtn').hidden=true;$('passwordSetupArea').hidden=false;
  $('authMessage').hidden=true;
}
async function completeMandatoryPasswordSetup(){
  const p=$('invitePassword').value,c=$('invitePasswordConfirm').value;
  if(!p||p.length<8)return showAuthMessage('Password must be at least 8 characters.');
  if(p!==c)return showAuthMessage('Passwords do not match.');
  const current=state.user?.user_metadata||{};
  const {error}=await sb.auth.updateUser({password:p,data:{...current,must_set_password:false,password_set_at:new Date().toISOString()}});
  if(error)return showAuthMessage(error.message);
  $('passwordSetupArea').hidden=true;$('loginForm').hidden=false;$('forgotPasswordBtn').hidden=false;
  const {data:{user}}=await sb.auth.getUser();if(user)await enterApp(user);
}
async function enterApp(user){
  state.user=user;
  if(user?.user_metadata?.must_set_password===true){showMandatoryPasswordSetup(user);return;}
  const {data,error}=await sb.from('profiles').select('*').eq('id',user.id).single();
  if(error||!data){showAuthMessage('Profile not found. Ask an administrator to check the Safety Tracker profile.');await sb.auth.signOut();return;}
  if(data.active===false){showAuthMessage('This Safety Tracker account is disabled.');await sb.auth.signOut();return;}
  state.profile=data;await loadAll();$('authView').hidden=true;$('appView').hidden=false;
  $('currentUserName').textContent=data.display_name||user.email;$('currentUserRole').textContent=data.role;
  document.querySelectorAll('.manager-only').forEach(el=>el.style.display=isManager()?'':'none');
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=isAdmin()?'':'none');
  showView('mySafety');
}
function showLogin(){$('appView').hidden=true;$('authView').hidden=false;$('loginForm').hidden=false;$('forgotPasswordBtn').hidden=false;$('passwordSetupArea').hidden=true}
function showView(name){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view'));document.querySelectorAll('#mainNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));$(name+'View').classList.add('active-view');if(name==='mySafety')renderMySafety();if(name==='documents')renderDocuments();if(name==='training')renderTraining();if(name==='people')renderPeople();if(name==='compliance')renderCompliance();if(name==='instructor')renderInstructor();if(name==='reports')renderReports();if(name==='help')renderHelp();}

async function loadAll(){
  const tables=['profiles','documents','document_versions','document_assignments','document_signoffs','document_delivery_confirmations','document_links','document_reviews','training_sessions','training_assignments','training_signoffs','training_delivery_confirmations','training_files'];
  const results=await Promise.all(tables.map(t=>sb.from(t).select('*')));
  const map=['people','documents','versions','docAssignments','docSignoffs','docConfirmations','documentLinks','documentReviews','training','trainingAssignments','trainingSignoffs','trainingConfirmations','trainingFiles'];
  results.forEach((r,i)=>{if(r.error)console.warn(tables[i],r.error);state[map[i]]=r.data||[]});
  state.people.sort((a,b)=>(a.display_name||'').localeCompare(b.display_name||''));
  populateFilters();
}
function populateFilters(){
  const types=[...new Set(state.documents.map(d=>d.doc_type))].sort();
  $('documentTypeFilter').innerHTML='<option value="">All types</option>'+types.map(t=>`<option>${esc(t)}</option>`).join('');
  if($('compliancePersonFilter')) $('compliancePersonFilter').innerHTML='<option value="">All people</option>'+state.people.filter(p=>p.active!==false).map(p=>`<option value="${p.id}">${esc(p.display_name||p.email)}</option>`).join('');if($('instructorPersonFilter')) $('instructorPersonFilter').innerHTML='<option value="">All people</option>'+state.people.filter(p=>p.active!==false).map(p=>`<option value="${p.id}">${esc(p.display_name||p.email)}</option>`).join('');
  if($('groupTrainingSelect')){
    const sessions=state.training
      .filter(t=>t.status!=='ARCHIVED')
      .filter(t=>state.trainingAssignments.some(a=>a.training_session_id===t.id&&a.active!==false&&effectiveTrainingMethod(t,a)==='INSTRUCTOR_LED'))
      .sort((a,b)=>a.name.localeCompare(b.name));
    $('groupTrainingSelect').innerHTML='<option value="">Select training</option>'+sessions.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  }
}
function personName(id){return state.people.find(p=>p.id===id)?.display_name||'Unknown user'}
function currentVersion(docId){return state.versions.find(v=>v.document_id===docId&&v.status==='CURRENT')||state.versions.filter(v=>v.document_id===docId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]}
function latestDocSignoff(assignment){return state.docSignoffs.filter(s=>s.assignment_id===assignment.id).sort((a,b)=>new Date(b.signed_at)-new Date(a.signed_at))[0]}
function latestTrainingSignoff(assignment){return state.trainingSignoffs.filter(s=>s.training_assignment_id===assignment.id).sort((a,b)=>new Date(b.signed_at)-new Date(a.signed_at))[0]}
function assignmentDue(a,signoff){if(!signoff)return a.due_date?new Date(a.due_date+'T23:59:59').toISOString():new Date().toISOString();return addRenewal(signoff.signed_at,a.renewal_value,a.renewal_unit)}
function documentAssignmentDue(a,signoff){
  if(!signoff) return assignmentDue(a,signoff);
  const c=docEvents(a).find(x=>(x.attendance_status||'ATTENDED')==='ATTENDED'&&new Date(x.confirmed_at)<=new Date(signoff.signed_at));
  const base=c?.delivery_date||signoff.signed_at;
  return addRenewal(base,a.renewal_value,a.renewal_unit);
}
function trainingAssignmentDue(a,signoff){
  if(!signoff) return assignmentDue(a,signoff);
  const c=trainingEvents(a).find(x=>(x.attendance_status||'ATTENDED')==='ATTENDED'&&new Date(x.confirmed_at)<=new Date(signoff.signed_at));
  const base=c?.delivery_date||signoff.signed_at;
  return addRenewal(base,a.renewal_value,a.renewal_unit);
}
function withinDays(date,days){if(!date)return false;const now=new Date(),d=new Date(date),limit=new Date();limit.setDate(limit.getDate()+days);return d>=now&&d<=limit}
function reviewAlertCounts(){const dates=[];state.versions.filter(v=>v.status==='CURRENT'&&v.review_date).forEach(v=>dates.push(v.review_date));state.training.filter(t=>t.status==='ACTIVE'&&t.review_date).forEach(t=>dates.push(t.review_date));return {overdue:dates.filter(d=>d<todayISO()).length,dueSoon:dates.filter(d=>d>=todayISO()&&d<=daysFromNow(30)).length}}
function renderMySafety(){
  const myDocs=state.docAssignments.filter(a=>a.user_id===state.user.id&&a.active!==false);
  const myTrain=state.trainingAssignments.filter(a=>a.user_id===state.user.id&&a.active!==false);
  const actions=[];const completed=[];
  myDocs.forEach(a=>{const v=state.versions.find(x=>x.id===a.document_version_id);const d=v&&state.documents.find(x=>x.id===v.document_id);if(!d||!v)return;const s=latestDocSignoff(a);const due=documentAssignmentDue(a,s);const needs=!s||(a.renewal_value&&new Date(due)<=new Date());const item={kind:'document',a,d,v,s,due};(needs?actions:completed).push(item)});
  myTrain.forEach(a=>{const t=state.training.find(x=>x.id===a.training_session_id);if(!t)return;const s=latestTrainingSignoff(a);const due=trainingAssignmentDue(a,s);const needs=!s||(a.renewal_value&&new Date(due)<=new Date());const item={kind:'training',a,t,s,due};(needs?actions:completed).push(item)});
  const overdue=actions.filter(x=>x.due&&new Date(x.due)<new Date()).length;
  const dueSoon=completed.filter(x=>x.due&&withinDays(x.due,30)).length;
  $('myStats').innerHTML=stat(actions.length,'Actions required')+stat(overdue,'Overdue')+stat(dueSoon,'Due within 30 days')+stat(completed.length,'Current')+stat(myDocs.length+myTrain.length,'Assigned');
  $('myActions').innerHTML=actions.length?actions.map(renderMyAction).join(''):'<div class="empty">Nothing outstanding.</div>';
  $('myCompleted').innerHTML=completed.length?completed.map(renderMyAction).join(''):'<div class="empty">No completed records yet.</div>';
}

function showRequestDocumentInstructor(id){
  const a=state.docAssignments.find(x=>x.id===id),v=state.versions.find(x=>x.id===a.document_version_id),d=state.documents.find(x=>x.id===v.document_id);
  openModal('Request instructor-led support',`<p><strong>${esc(d.title)}</strong></p><div class="request-note">This changes only <strong>your own assignment</strong> to instructor-led. You will then be unable to sign off until an instructor/manager confirms that training has been delivered.</div><label>Reason / question (optional)<textarea id="requestInstructorReason" placeholder="e.g. I would like someone to go through this with me"></textarea></label><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Request instructor-led','primary',`data-save-request-doc-instructor="${id}"`)}</div>`);
}
async function saveRequestDocumentInstructor(id){
  const {error}=await sb.rpc('request_document_instructor_led',{p_assignment_id:id,p_reason:$('requestInstructorReason').value.trim()||null});
  if(error)return toast(error.message);closeModal();await refresh('Your assignment is now instructor-led and is awaiting instructor confirmation.');
}
function showRequestTrainingInstructor(id){
  const a=state.trainingAssignments.find(x=>x.id===id),t=state.training.find(x=>x.id===a.training_session_id);
  openModal('Request instructor-led support',`<p><strong>${esc(t.name)}</strong></p><div class="request-note">This changes only <strong>your own assignment</strong> to instructor-led. You will then be unable to sign off until an instructor/manager confirms that training has been delivered.</div><label>Reason / question (optional)<textarea id="requestInstructorReason" placeholder="e.g. I would like practical guidance before signing"></textarea></label><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Request instructor-led','primary',`data-save-request-training-instructor="${id}"`)}</div>`);
}
async function saveRequestTrainingInstructor(id){
  const {error}=await sb.rpc('request_training_instructor_led',{p_assignment_id:id,p_reason:$('requestInstructorReason').value.trim()||null});
  if(error)return toast(error.message);closeModal();await refresh('Your assignment is now instructor-led and is awaiting instructor confirmation.');
}

function stat(n,label){return `<div class="stat"><strong>${n}</strong><span>${esc(label)}</span></div>`}
function renderMyAction(x){
  const overdue=x.due&&new Date(x.due)<new Date();
  if(x.kind==='document'){
    const method=effectiveDocumentMethod(x.d,x.a),c=latestDocConfirmation(x.a),event=latestDocEvent(x.a),ready=freshConfirmation(c,x.s),needs=!x.s||overdue;
    const absent=method==='INSTRUCTOR_LED'&&event&&(event.attendance_status==='ABSENT')&&!ready;
    const status=x.s&&!overdue?'Current':overdue?'Overdue':method==='INSTRUCTOR_LED'?(ready?'Ready to sign off':absent?'Absent / awaiting training':'Awaiting instructor'):'Sign-off required';
    const creatorException=needs&&method==='INSTRUCTOR_LED'&&!ready&&isManager()&&x.a.user_id===state.user.id&&x.d.created_by===state.user.id;
    const requestInstructor=needs&&method==='SELF_TRAINING'?btn('Request instructor-led support','secondary',`data-request-doc-instructor="${x.a.id}"`):'';
    return `<div class="item-card"><div class="row-between"><div><h3>${esc(x.d.title)}</h3><div class="meta"><span>${esc(x.d.doc_type)}</span><span>${esc(x.d.reference||'No reference')}</span><span>Version ${esc(x.v.version_label)}</span><span>${deliveryText(method)}</span></div></div><span class="badge ${overdue?'overdue':x.s&&!overdue?'complete':'due'}">${status}</span></div><div class="meta"><span>Due: ${x.due?fmtDate(x.due):'One-off complete'}</span><span>${renewalText(x.a.renewal_value,x.a.renewal_unit)}</span>${c?.delivery_date?`<span>Training date ${fmtDate(c.delivery_date)}</span>`:''}${methodOverrideNote(x.a)?`<span>${esc(methodOverrideNote(x.a))}</span>`:''}</div><div class="row">${btn('View file','secondary',`data-open-doc="${x.v.id}"`)}${needs&&(method!=='INSTRUCTOR_LED'||ready)?btn('Acknowledge','primary',`data-sign-doc="${x.a.id}"`):''}${requestInstructor}${creatorException?btn('Sign off as exception','secondary',`data-doc-exception="${x.a.id}"`):''}${relatedDocumentButtons(x.d.id)}</div></div>`;
  }
  const method=effectiveTrainingMethod(x.t,x.a),c=latestTrainingConfirmation(x.a),event=latestTrainingEvent(x.a),ready=freshConfirmation(c,x.s),needs=!x.s||overdue;
  const absent=method==='INSTRUCTOR_LED'&&event&&(event.attendance_status==='ABSENT')&&!ready;
  const status=x.s&&!overdue?'Current':overdue?'Overdue':method==='INSTRUCTOR_LED'?(ready?'Ready to sign off':absent?'Absent / awaiting training':'Awaiting instructor'):'Sign-off required';
  const creatorException=needs&&method==='INSTRUCTOR_LED'&&!ready&&isManager()&&x.a.user_id===state.user.id&&x.t.created_by===state.user.id;
  const requestInstructor=needs&&method==='SELF_TRAINING'?btn('Request instructor-led support','secondary',`data-request-training-instructor="${x.a.id}"`):'';
  return `<div class="item-card"><div class="row-between"><div><h3>${esc(x.t.name)}</h3><div class="meta"><span>${esc(x.t.session_type.replaceAll('_',' '))}</span><span>${deliveryText(method)}</span><span>Trainer: ${esc(x.t.trainer_name||'—')}</span></div></div><span class="badge ${overdue?'overdue':x.s&&!overdue?'complete':'due'}">${status}</span></div><div class="meta"><span>Due: ${x.due?fmtDate(x.due):'One-off complete'}</span><span>${renewalText(x.a.renewal_value,x.a.renewal_unit)}</span>${c?.delivery_date?`<span>Training date ${fmtDate(c.delivery_date)}</span>`:''}${methodOverrideNote(x.a)?`<span>${esc(methodOverrideNote(x.a))}</span>`:''}</div><div class="row">${btn('View training','secondary',`data-view-training="${x.t.id}"`)}${needs&&(method!=='INSTRUCTOR_LED'||ready)?btn('Sign off','primary',`data-sign-training="${x.a.id}"`):''}${requestInstructor}${creatorException?btn('Sign off as exception','secondary',`data-training-exception="${x.a.id}"`):''}</div></div>`;
}
function renderDocuments(){
  const q=$('documentSearch').value.toLowerCase(),type=$('documentTypeFilter').value,status=$('documentStatusFilter').value;
  let docs=state.documents.filter(d=>(!q||`${d.title} ${d.reference||''}`.toLowerCase().includes(q))&&(!type||d.doc_type===type)&&(!status||d.status===status));
  docs.sort((a,b)=>a.title.localeCompare(b.title));
  $('documentsList').innerHTML=docs.length?docs.map(d=>{
    const v=currentVersion(d.id),assigns=state.docAssignments.filter(a=>a.document_version_id===v?.id&&a.active!==false),reviewOverdue=v?.review_date&&v.review_date<todayISO(),links=linksForDocument(d.id);
    return `<div class="item-card"><div class="row-between"><div><h3>${esc(d.title)}</h3><div class="meta"><span class="badge">${esc(docTypeLabel(d.doc_type))}</span><span>${esc(d.reference||'No reference')}</span>${v?`<span>Version ${esc(v.version_label)}</span>`:''}${reviewOverdue?'<span class="badge overdue">Review overdue</span>':''}${d.review_required?'<span class="badge overdue">Linked document changed - review required</span>':''}</div></div><span class="badge">${esc(d.status)}</span></div><div class="meta"><span>Review: ${fmtDate(v?.review_date)}</span><span>${assigns.length} assigned</span><span>${deliveryText(effectiveDocumentMethod(d,null,v))}</span><span>${renewalText(d.default_renewal_value,d.default_renewal_unit)}</span><span>${links.length} linked</span></div><div class="row">${v?btn('View file','secondary',`data-open-doc="${v.id}"`):''}${btn('Links','ghost',`data-doc-links="${d.id}"`)}${isManager()?((d.doc_type==='SDS'?'':btn('Assign','secondary',`data-assign-doc="${d.id}"`))+btn('New version','secondary',`data-new-version="${d.id}"`)+((d.doc_type!=='SDS'&&(reviewOverdue||d.review_required))?btn('Review','primary',`data-record-doc-review="${d.id}"`):'')+btn('Details','ghost',`data-doc-details="${d.id}"`)):btn('Details','ghost',`data-doc-details="${d.id}"`)}</div></div>`;
  }).join(''):'<div class="empty">No documents found.</div>';
}
function showNewDocument(){
  openModal('New document',`<div class="form-grid"><label>Title<input id="docTitle"></label><label>Reference<input id="docRef" placeholder="e.g. RA-014"></label><label>Type<select id="docType"><option value="RISK_ASSESSMENT">Risk Assessment</option><option value="COSHH">COSHH Assessment</option><option value="SDS">SDS / MSDS</option><option value="SSW">Safe System of Work (SSW)</option><option value="POLICY">Policy</option><option value="PROCEDURE">Procedure</option><option value="OTHER">Other</option></select></label><label>Delivery method<select id="docDelivery"><option value="SELF_TRAINING">Self-training</option><option value="INSTRUCTOR_LED">Instructor-led</option></select></label><div class="full hint-box"><strong>Choose for each item:</strong> Risk Assessments and COSHH default to self-training. SSW defaults to instructor-led. SDS/MSDS can be stored and linked without assigning it for sign-off.</div><label>Version<input id="docVersion" value="1"></label><label>Issue date<input id="docIssue" type="date" value="${todayISO()}"></label><label>Review date<input id="docReview" type="date"></label><label>Default sign-off frequency<select id="docRenewalPreset"><option value="">One-off only</option><option value="3|MONTHS">Every 3 months</option><option value="6|MONTHS">Every 6 months</option><option value="12|MONTHS">Every 12 months</option><option value="24|MONTHS">Every 24 months</option><option value="CUSTOM">Custom</option></select></label><label>Re-sign on new version<select id="docResign"><option value="true">Yes</option><option value="false">No</option></select></label><div id="docCustomRenewal" class="full" hidden><div class="form-grid"><label>Every<input id="docRenewalValue" type="number" min="1"></label><label>Unit<select id="docRenewalUnit"><option>DAYS</option><option>MONTHS</option><option>YEARS</option></select></label></div></div><label class="full">Upload finished file<input id="docFile" type="file"></label><label class="full">Notes<textarea id="docNotes"></textarea></label><div id="docCreateStatus" class="full muted" aria-live="polite"></div></div><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Create document','primary','id="createDocumentBtn" data-create-document')}</div>`);
  const syncDelivery=()=>{$('docDelivery').value=defaultDocDelivery($('docType').value)};
  $('docType').addEventListener('change',syncDelivery);syncDelivery();
  $('docRenewalPreset').addEventListener('change',()=>{$('docCustomRenewal').hidden=$('docRenewalPreset').value!=='CUSTOM'});
}
function renewalFromPreset(prefix){const p=$(prefix+'RenewalPreset').value;if(!p)return {value:null,unit:null};if(p==='CUSTOM')return {value:Number($(prefix+'RenewalValue').value)||null,unit:$(prefix+'RenewalUnit').value};const [v,u]=p.split('|');return {value:Number(v),unit:u};}
async function createDocumentRecord(){
  const saveBtn=$('createDocumentBtn');
  const status=$('docCreateStatus');
  const setStatus=msg=>{if(status)status.textContent=msg;};

  if(saveBtn?.dataset.busy==='1')return;

  try{
    const title=$('docTitle')?.value.trim();
    const file=$('docFile')?.files?.[0];

    if(!title){
      setStatus('Enter a document title.');
      toast('Enter a document title.');
      $('docTitle')?.focus();
      return;
    }
    if(!file){
      setStatus('Choose the finished document file first.');
      toast('Choose the finished document file first.');
      return;
    }

    if(saveBtn){
      saveBtn.dataset.busy='1';
      saveBtn.disabled=true;
      saveBtn.textContent='Creating…';
    }

    setStatus('Creating document record…');
    const r=renewalFromPreset('doc');
    const {data:doc,error}=await sb.from('documents').insert({
      title,
      reference:$('docRef').value.trim()||null,
      doc_type:$('docType').value,
      delivery_method:$('docDelivery').value,
      status:'ACTIVE',
      default_renewal_value:r.value,
      default_renewal_unit:r.unit,
      resign_on_new_version:$('docResign').value==='true',
      created_by:state.user.id
    }).select().single();
    if(error)throw error;

    setStatus('Uploading document file…');
    const path=`documents/${doc.id}/${crypto.randomUUID()}-${file.name}`;
    const up=await sb.storage.from('safety-files').upload(path,file);
    if(up.error){
      await sb.from('documents').delete().eq('id',doc.id);
      throw up.error;
    }

    setStatus('Saving document version…');
    const {error:ve}=await sb.from('document_versions').insert({
      document_id:doc.id,
      version_label:$('docVersion').value.trim()||'1',
      issue_date:$('docIssue').value||null,
      review_date:$('docReview').value||null,
      delivery_method:$('docDelivery').value,
      storage_path:path,
      file_name:file.name,
      notes:$('docNotes').value.trim()||null,
      status:'CURRENT',
      created_by:state.user.id
    });

    if(ve){
      await sb.storage.from('safety-files').remove([path]);
      await sb.from('documents').delete().eq('id',doc.id);
      throw ve;
    }

    setStatus('Document created.');
    closeModal();
    await refresh('Document created.');
  }catch(err){
    console.error('Create document failed',err);
    const msg=err?.message||'Could not create document.';
    setStatus(`Error: ${msg}`);
    toast(msg);
    if(saveBtn){
      saveBtn.dataset.busy='0';
      saveBtn.disabled=false;
      saveBtn.textContent='Create document';
    }
  }
}
async function showAssignDocument(docId){
  const d=state.documents.find(x=>x.id===docId),v=currentVersion(docId);if(!d||!v)return;
  if(d.doc_type==='SDS')return toast('SDS/MSDS is reference-only and does not require employee sign-off.');
  const current=state.docAssignments.filter(a=>a.document_version_id===v.id&&a.active!==false).map(a=>a.user_id);
  const opts=state.people.filter(p=>p.active!==false).map(p=>`<label class="check-row"><input type="checkbox" class="assign-person" value="${p.id}" ${current.includes(p.id)?'checked':''}>${esc(p.display_name||p.email)}</label>`).join('');
  const existingDue=state.docAssignments.find(a=>a.document_version_id===v.id&&a.active!==false)?.due_date||daysFromNow(14);
  openModal('Assign document',`<p><strong>${esc(d.title)}</strong> · Version ${esc(v.version_label)} · ${deliveryText(effectiveDocumentMethod(d,null,v))}</p><div class="form-grid"><label>Due date<input id="assignDocDue" type="date" value="${existingDue||''}"></label><label>Sign-off frequency<select id="assignDocRenewalPreset"><option value="DEFAULT">Use document default</option><option value="">One-off only</option><option value="3|MONTHS">Every 3 months</option><option value="6|MONTHS">Every 6 months</option><option value="12|MONTHS">Every 12 months</option><option value="24|MONTHS">Every 24 months</option><option value="CUSTOM">Custom</option></select></label><div id="assignDocCustomRenewal" class="full" hidden><div class="form-grid"><label>Every<input id="assignDocRenewalValue" type="number" min="1"></label><label>Unit<select id="assignDocRenewalUnit"><option>DAYS</option><option>MONTHS</option><option>YEARS</option></select></label></div></div><div class="full"><p class="muted"><strong>Untick a person and Save assignments to remove their active assignment.</strong> Previous completed acknowledgements/sign-off history is retained.</p><label class="check-row"><input id="assignDocAll" type="checkbox"> Select all active users</label><strong>People</strong><div class="checkbox-list">${opts}</div></div></div><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Save assignments','primary',`data-save-doc-assignment="${docId}"`)}</div>`);
  $('assignDocRenewalPreset').addEventListener('change',()=>{$('assignDocCustomRenewal').hidden=$('assignDocRenewalPreset').value!=='CUSTOM'});
  $('assignDocAll').addEventListener('change',e=>document.querySelectorAll('.assign-person').forEach(x=>x.checked=e.target.checked));
}
async function saveDocAssignments(docId){
  const d=state.documents.find(x=>x.id===docId),v=currentVersion(docId);if(!d||!v)return;
  if(d.doc_type==='SDS')return toast('SDS/MSDS is reference-only and cannot be assigned for sign-off.');
  const selected=[...document.querySelectorAll('.assign-person:checked')].map(x=>x.value);
  const selectedSet=new Set(selected);

  let rv=d.default_renewal_value,ru=d.default_renewal_unit;
  const p=$('assignDocRenewalPreset').value;
  if(p===''){
    rv=null;ru=null;
  }else if(p==='CUSTOM'){
    rv=Number($('assignDocRenewalValue').value)||null;
    ru=$('assignDocRenewalUnit').value;
  }else if(p!=='DEFAULT'){
    [rv,ru]=p.split('|');
    rv=Number(rv);
  }

  const due=$('assignDocDue').value||null;

  // Remove anyone who was previously assigned to this version but is now unticked.
  // Keep the row/history by marking the assignment inactive.
  const currentlyActive=state.docAssignments.filter(a=>a.document_version_id===v.id&&a.active!==false);
  for(const a of currentlyActive){
    if(!selectedSet.has(a.user_id)){
      const {error}=await sb.from('document_assignments')
        .update({active:false})
        .eq('id',a.id);
      if(error)return toast(error.message);
    }
  }

  // Add, reactivate, or update the people who remain selected.
  for(const uid of selected){
    const existing=state.docAssignments.find(a=>a.document_version_id===v.id&&a.user_id===uid);
    if(existing){
      const {error}=await sb.from('document_assignments')
        .update({
          due_date:due,
          renewal_value:rv,
          renewal_unit:ru,
          active:true
        })
        .eq('id',existing.id);
      if(error)return toast(error.message);
    }else{
      const {error}=await sb.from('document_assignments').insert({
        document_version_id:v.id,
        user_id:uid,
        due_date:due,
        renewal_value:rv,
        renewal_unit:ru,
        assigned_by:state.user.id,
        active:true
      });
      if(error)return toast(error.message);
    }
  }

  closeModal();
  await refresh('Document assignments updated.');
}
async function showNewVersion(docId){
  const d=state.documents.find(x=>x.id===docId),old=currentVersion(docId);
  const currentMethod=effectiveDocumentMethod(d,null,old);
  openModal('Upload new version',`<p><strong>${esc(d.title)}</strong> · Current version ${esc(old?.version_label||'—')}</p><div class="form-grid"><label>New version<input id="newVerLabel"></label><label>Issue date<input id="newVerIssue" type="date" value="${todayISO()}"></label><label>Review date<input id="newVerReview" type="date"></label><label>Delivery method for new version<select id="newVerDelivery"><option value="KEEP" selected>Keep current — ${deliveryText(currentMethod)}</option><option value="SELF_TRAINING">Self-training</option><option value="INSTRUCTOR_LED">Instructor-led</option></select></label><div class="full hint-box"><strong>This applies to the new version only.</strong> Existing completed/superseded versions keep their recorded delivery method. A user assigned self-training can still individually request instructor-led support.</div><label>Require fresh sign-off?<select id="newVerReassign"><option value="true" ${d.resign_on_new_version?'selected':''}>Yes — reassign everyone on current version</option><option value="false" ${!d.resign_on_new_version?'selected':''}>No — do not reassign</option></select></label><label>New sign-off due date<input id="newVerDue" type="date" value="${daysFromNow(14)}"></label><label class="full">Upload file<input id="newVerFile" type="file"></label><label class="full">Notes<textarea id="newVerNotes"></textarea></label></div><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Publish version','primary',`data-publish-version="${docId}"`)}</div>`);
}
async function publishVersion(docId){
  const file=$('newVerFile').files[0];if(!$('newVerLabel').value.trim()||!file)return toast('Version and file are required.');
  const d=state.documents.find(x=>x.id===docId),old=currentVersion(docId),reassign=$('newVerReassign').value==='true';
  const oldMethod=effectiveDocumentMethod(d,null,old);
  const selected=$('newVerDelivery').value;
  const newMethod=selected==='KEEP'?oldMethod:selected;

  const path=`documents/${docId}/${crypto.randomUUID()}-${file.name}`;
  const up=await sb.storage.from('safety-files').upload(path,file);if(up.error)return toast(up.error.message);

  if(old){
    const {error:oldErr}=await sb.from('document_versions').update({status:'SUPERSEDED'}).eq('id',old.id);
    if(oldErr)return toast(oldErr.message);
  }

  const {data:nv,error}=await sb.from('document_versions').insert({
    document_id:docId,
    version_label:$('newVerLabel').value.trim(),
    issue_date:$('newVerIssue').value||null,
    review_date:$('newVerReview').value||null,
    delivery_method:newMethod,
    storage_path:path,
    file_name:file.name,
    notes:$('newVerNotes').value.trim()||null,
    status:'CURRENT',
    created_by:state.user.id
  }).select().single();
  if(error)return toast(error.message);

  // Keep documents.delivery_method as the current/default method for compatibility
  // while historical versions retain their own recorded method.
  const {error:docErr}=await sb.from('documents').update({delivery_method:newMethod}).eq('id',docId);
  if(docErr)return toast(docErr.message);

  if(reassign&&old){
    const oldAssign=state.docAssignments.filter(a=>a.document_version_id===old.id&&a.active!==false);
    for(const a of oldAssign){
      const payload={
        document_version_id:nv.id,
        user_id:a.user_id,
        due_date:$('newVerDue').value||daysFromNow(14),
        renewal_value:a.renewal_value,
        renewal_unit:a.renewal_unit,
        assigned_by:state.user.id,
        active:true
      };
      const {error:assignErr}=await sb.from('document_assignments').insert(payload);
      if(assignErr)return toast(assignErr.message);
    }
  }

  closeModal();
  await refresh(`${reassign?'New version published and current users reassigned.':'New version published.'} Delivery method: ${deliveryText(newMethod)}.`);
}

function reviewOutcomeLabel(v){
  return v==='NO_CHANGE'?'Reviewed - no change required':
    v==='NEW_VERSION_REQUIRED'?'Changes required - new version needed':
    v==='OTHER_ACTION'?'Further action required':v||'';
}
function reviewsForVersion(versionId){
  return state.documentReviews
    .filter(r=>r.document_version_id===versionId)
    .sort((a,b)=>new Date(b.reviewed_at)-new Date(a.reviewed_at));
}
function reviewsForDocument(docId){
  const ids=new Set(state.versions.filter(v=>v.document_id===docId).map(v=>v.id));
  return state.documentReviews
    .filter(r=>ids.has(r.document_version_id))
    .sort((a,b)=>new Date(b.reviewed_at)-new Date(a.reviewed_at));
}
function reviewSignatureSrc(r){
  const v=String(r?.signature_data||'');
  return v.startsWith('data:image/png;base64,')?v:'';
}
function showDocumentReview(docId){
  const d=state.documents.find(x=>x.id===docId),v=currentVersion(docId);
  if(d?.doc_type==='SDS')return toast('SDS/MSDS is reference-only. Upload a new manufacturer revision when it changes; no review signature is required.');
  if(!d||!v)return toast('Current document version not found.');
  if(!isManager())return toast('Manager or Admin access required.');

  openModal('Record signed document review',`
    <p><strong>${esc(d.title)}</strong> · ${esc(d.reference||'No reference')} · Version ${esc(v.version_label)}</p>
    <div class="hint-box"><strong>Reviewer:</strong> ${esc(personName(state.user.id))}<br><strong>Review timestamp:</strong> recorded automatically when you save.</div>
    ${d.review_required?`<div class="message"><strong>Current review reason:</strong> ${esc(d.review_reason||'Review required.')}</div>`:''}
    <div class="form-grid">
      <label>Review outcome
        <select id="docReviewOutcome">
          <option value="NO_CHANGE">Reviewed - no change required</option>
          <option value="NEW_VERSION_REQUIRED">Changes required - new version needed</option>
          <option value="OTHER_ACTION">Further action required</option>
        </select>
      </label>
      <label id="docNextReviewWrap">Next review date
        <input id="docNextReviewDate" type="date">
      </label>
      <label class="full">Review note (optional unless further action is selected)
        <textarea id="docReviewNote" placeholder="What was checked, changes considered, action required, etc."></textarea>
      </label>
    </div>
    <p>I confirm I have reviewed this document version and that the recorded review outcome is accurate.</p>
    ${signatureBlock('review')}
    <label class="check-row"><input id="docReviewAck" type="checkbox"> I confirm this review outcome and digital signature.</label>
    <div class="actions">
      ${btn('Cancel','ghost','data-close-modal')}
      ${btn('Save signed review','primary',`data-save-doc-review="${docId}"`)}
    </div>
  `);

  const sync=()=>{
    const noChange=$('docReviewOutcome').value==='NO_CHANGE';
    $('docNextReviewWrap').hidden=!noChange;
    $('docNextReviewDate').required=noChange;
  };
  $('docReviewOutcome').addEventListener('change',sync);sync();
  setupSignaturePad('reviewSignaturePad','reviewClearSignature');
}

async function saveDocumentReview(docId){
  if(!$('docReviewAck')?.checked)return toast('Tick the review confirmation first.');
  const d=state.documents.find(x=>x.id===docId),v=currentVersion(docId);
  if(!d||!v)return toast('Current document version not found.');

  const outcome=$('docReviewOutcome').value;
  const note=$('docReviewNote').value.trim();
  const nextDate=$('docNextReviewDate').value||null;
  const sig=signatureData('reviewSignaturePad');
  const sigName=$('reviewSignatureName').value.trim();

  if(!sig)return toast('Please sign in the digital signature box.');
  if(!sigName)return toast('Enter the signature name.');
  if(outcome==='NO_CHANGE'&&!nextDate)return toast('Choose the next review date.');
  if(outcome==='OTHER_ACTION'&&!note)return toast('Add a note explaining the further action required.');

  const {error}=await sb.rpc('record_document_review',{
    p_document_version_id:v.id,
    p_outcome:outcome,
    p_review_note:note||null,
    p_next_review_date:nextDate,
    p_signature_data:sig,
    p_signature_name:sigName
  });

  if(error)return toast(error.message);
  closeModal();
  await refresh(outcome==='NO_CHANGE'?'Signed review recorded and next review date updated.':'Signed review recorded. Document remains flagged for action.');
}

function showDocumentReviewEvidence(reviewId){
  const r=state.documentReviews.find(x=>x.id===reviewId);
  if(!r)return toast('Review record not found.');
  const src=reviewSignatureSrc(r);
  openModal('Signed document review',`
    <div class="stack">
      <div>
        <strong>${esc(r.title_snapshot)}</strong>
        <div class="meta">
          <span>${esc(r.reference_snapshot||'No reference')}</span>
          <span>Version ${esc(r.version_snapshot)}</span>
        </div>
      </div>
      <div class="item-card compact">
        <div class="meta">
          <span>Reviewed by ${esc(personName(r.reviewer_id))}</span>
          <span>${fmtDateTime(r.reviewed_at)}</span>
          <span>${esc(reviewOutcomeLabel(r.outcome))}</span>
          ${r.next_review_date?`<span>Next review ${fmtDate(r.next_review_date)}</span>`:''}
        </div>
        ${r.review_note?`<p>${esc(r.review_note)}</p>`:''}
        <p class="muted">${esc(r.statement_snapshot||'')}</p>
        <div><strong>Signature name:</strong> ${esc(r.signature_name||'')}</div>
        ${src?`<div class="review-signature-evidence"><img src="${src}" alt="Reviewer digital signature"></div>`:'<div class="message">Signature data is not available.</div>'}
      </div>
    </div>
  `);
}

function showDocDetails(docId){
  const d=state.documents.find(x=>x.id===docId),
        vs=state.versions.filter(v=>v.document_id===docId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)),
        links=linksForDocument(docId),
        reviews=reviewsForDocument(docId),
        current=currentVersion(docId),isSds=d.doc_type==='SDS';

  openModal('Document details',`
    <div class="stack">
      <div>
        <strong>${esc(d.title)}</strong>
        <div class="meta"><span>${esc(docTypeLabel(d.doc_type))}</span><span>${esc(d.reference||'No reference')}</span>${!isSds?`<span>${deliveryText(effectiveDocumentMethod(d,null,current))}</span>`:''}</div>
      </div>
      ${isSds?`<div class="hint-box"><strong>Reference-only SDS/MSDS.</strong> No employee assignment, acknowledgement or signed document review is required. Keep the current manufacturer revision here. A new SDS version can flag linked COSHH assessments for review.</div>`:''}
      ${!isSds&&d.review_required?`<div class="message"><strong>Review/action required:</strong> ${esc(d.review_reason||'A linked upstream document has changed.')}${isManager()?`<div class="row">${btn('Record signed review','primary',`data-record-doc-review="${d.id}"`)}</div>`:''}</div>`:''}
      ${!isSds&&isManager()&&!d.review_required?`<div class="row">${btn('Record document review','secondary',`data-record-doc-review="${d.id}"`)}</div>`:''}
      <div><strong>Linked documents</strong><div class="card-list">${links.length?links.map(l=>{const other=otherDocForLink(l,docId),v=other&&currentVersion(other.id);return `<div class="item-card compact"><div class="row-between"><span>${esc(other?.title||'Unknown document')}</span><span class="badge">${esc(linkTypeLabel(l.link_type))}</span></div><div class="row">${v?btn('View','secondary',`data-open-doc="${v.id}"`):''}${isManager()?btn('Remove link','danger',`data-remove-doc-link="${l.id}"`):''}</div></div>`}).join(''):'<span class="muted">No linked documents.</span>'}</div>${isManager()?`<div class="row">${btn('Add / manage links','secondary',`data-doc-links="${d.id}"`)}</div>`:''}</div>
      <div><strong>Version history / upload evidence</strong><div class="card-list">${vs.map(v=>`<div class="item-card"><div class="row-between"><strong>Version ${esc(v.version_label)}</strong><span class="badge">${esc(v.status)}</span></div><div class="meta"><span>Issued ${fmtDate(v.issue_date)}</span>${!isSds?`<span>Review ${fmtDate(v.review_date)}</span>`:''}<span>${esc(v.file_name)}</span><span>Uploaded by ${esc(personName(v.created_by))}</span><span>Uploaded ${fmtDateTime(v.created_at)}</span></div><div>${btn('View','secondary',`data-open-doc="${v.id}"`)}</div></div>`).join('')}</div></div>
      ${!isSds?`<div><strong>Signed review history</strong><div class="card-list">${reviews.length?reviews.map(r=>`<div class="item-card compact"><div class="row-between"><div><strong>Version ${esc(r.version_snapshot)}</strong><div class="meta"><span>${esc(reviewOutcomeLabel(r.outcome))}</span><span>Reviewed by ${esc(personName(r.reviewer_id))}</span><span>${fmtDateTime(r.reviewed_at)}</span>${r.next_review_date?`<span>Next review ${fmtDate(r.next_review_date)}</span>`:''}</div></div><span class="badge complete">Signed</span></div>${r.review_note?`<p class="muted">${esc(r.review_note)}</p>`:''}<div class="row">${btn('View signed review','secondary',`data-view-doc-review="${r.id}"`)}</div></div>`).join(''):'<span class="muted">No signed review records yet.</span>'}</div></div>`:''}
      ${isManager()?`<div class="actions">${btn(d.status==='ARCHIVED'?'Restore':'Archive',d.status==='ARCHIVED'?'secondary':'danger',`data-toggle-doc="${d.id}"`)}</div>`:''}
    </div>`);
}
async function toggleDocument(id){const d=state.documents.find(x=>x.id===id);await sb.from('documents').update({status:d.status==='ARCHIVED'?'ACTIVE':'ARCHIVED'}).eq('id',id);closeModal();await refresh('Document updated.');}
async function openDocument(versionId){const v=state.versions.find(x=>x.id===versionId);if(!v)return;const {data,error}=await sb.storage.from('safety-files').createSignedUrl(v.storage_path,120);if(error)return toast(error.message);window.open(data.signedUrl,'_blank','noopener');}
async function signDocument(assignmentId){
  const a=state.docAssignments.find(x=>x.id===assignmentId),v=state.versions.find(x=>x.id===a.document_version_id),d=state.documents.find(x=>x.id===v.document_id),prev=latestDocSignoff(a),method=effectiveDocumentMethod(d,a,v);
  if(method==='INSTRUCTOR_LED'&&!freshConfirmation(latestDocConfirmation(a),prev))return toast('Instructor confirmation is required before you can sign off.');
  openModal('Acknowledge document',`<p><strong>${esc(d.title)}</strong> · ${esc(d.reference||'')} · Version ${esc(v.version_label)}</p><p>I confirm I have read the assigned document and understand that I should ask my manager if anything is unclear.</p>${signatureBlock('doc')}<label class="check-row"><input id="docAckCheck" type="checkbox"> I confirm this acknowledgement and digital signature.</label><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Acknowledge','primary',`data-confirm-sign-doc="${assignmentId}"`)}</div>`);
  setupSignaturePad('docSignaturePad','docClearSignature');
}
async function confirmSignDocument(id){
  if(!$('docAckCheck').checked)return toast('Tick the confirmation first.');
  const sig=signatureData('docSignaturePad'),sigName=$('docSignatureName').value.trim();
  if(!sig)return toast('Please sign in the digital signature box.');
  if(!sigName)return toast('Enter the signature name.');
  const a=state.docAssignments.find(x=>x.id===id),v=state.versions.find(x=>x.id===a.document_version_id),d=state.documents.find(x=>x.id===v.document_id);
  const statement='I confirm I have read the assigned document and understand that I should ask my manager if anything is unclear.';
  const {error}=await sb.from('document_signoffs').insert({assignment_id:a.id,document_version_id:v.id,user_id:state.user.id,statement_snapshot:statement,title_snapshot:d.title,reference_snapshot:d.reference,version_snapshot:v.version_label,signature_data:sig,signature_name:sigName});
  if(error)return toast(error.message);closeModal();await refresh('Acknowledgement and digital signature recorded.');
}
function showDocumentLinks(docId){
  const d=state.documents.find(x=>x.id===docId),links=linksForDocument(docId),available=state.documents.filter(x=>x.id!==docId&&x.status!=='ARCHIVED').sort((a,b)=>a.title.localeCompare(b.title));
  openModal('Linked documents',`<div class="stack"><p><strong>${esc(d.title)}</strong> · ${esc(docTypeLabel(d.doc_type))}</p><div><strong>Current links</strong><div class="card-list">${links.length?links.map(l=>{const other=otherDocForLink(l,docId);return `<div class="item-card compact"><div class="row-between"><span>${esc(other?.title||'Unknown')}</span><span class="badge">${esc(linkTypeLabel(l.link_type))}</span></div>${isManager()?`<div class="row">${btn('Remove','danger',`data-remove-doc-link="${l.id}"`)}</div>`:''}</div>`}).join(''):'<span class="muted">No links yet.</span>'}</div></div>${isManager()?`<div class="section-card"><strong>Add link</strong><label>Related document<select id="relatedDocumentId"><option value="">Choose document</option>${available.map(x=>`<option value="${x.id}">${esc(docTypeLabel(x.doc_type))} · ${esc(x.reference||'')} · ${esc(x.title)}</option>`).join('')}</select></label><p class="muted">The relationship is detected automatically: SDS/MSDS -> COSHH, COSHH -> SSW, RA -> SSW, or Related document.</p><div class="row">${btn('Add link','primary',`data-add-doc-link="${docId}"`)}</div></div>`:''}</div>`);
}
async function addDocumentLink(docId){
  const otherId=$('relatedDocumentId')?.value;if(!otherId)return toast('Choose a document to link.');
  const a=state.documents.find(x=>x.id===docId),b=state.documents.find(x=>x.id===otherId),rel=inferLinkType(a,b);
  const {error}=await sb.from('document_links').insert({source_document_id:rel.source.id,target_document_id:rel.target.id,link_type:rel.type,created_by:state.user.id});
  if(error){if(String(error.message).toLowerCase().includes('duplicate'))return toast('These documents are already linked.');return toast(error.message)}
  closeModal();await refresh('Documents linked.');
}
async function removeDocumentLink(linkId){
  if(!confirm('Remove this document link? The documents and their previous sign-offs will not be deleted.'))return;
  const {error}=await sb.from('document_links').delete().eq('id',linkId);if(error)return toast(error.message);
  closeModal();await refresh('Document link removed.');
}
async function clearDocumentReviewFlag(docId){
  const {error}=await sb.from('documents').update({review_required:false,review_reason:null,review_flagged_at:null,review_flagged_by_document_id:null}).eq('id',docId);
  if(error)return toast(error.message);closeModal();await refresh('Review flag cleared.');
}

function renderTraining(){const q=$('trainingSearch').value.toLowerCase(),type=$('trainingTypeFilter').value;let rows=state.training.filter(t=>(!q||`${t.name} ${t.description||''}`.toLowerCase().includes(q))&&(!type||t.session_type===type)&&t.status!=='ARCHIVED');rows.sort((a,b)=>new Date(b.delivered_date||b.created_at)-new Date(a.delivered_date||a.created_at));$('trainingList').innerHTML=rows.length?rows.map(t=>{const assigns=state.trainingAssignments.filter(a=>a.training_session_id===t.id&&a.active!==false);const signs=state.trainingSignoffs.filter(s=>assigns.some(a=>a.id===s.training_assignment_id));const done=new Set(signs.map(s=>s.user_id)).size;const reviewOverdue=t.review_date&&t.review_date<todayISO();return `<div class="item-card"><div class="row-between"><div><h3>${esc(t.name)}</h3><div class="meta"><span class="badge">${esc(t.session_type.replaceAll('_',' '))}</span><span>${fmtDate(t.delivered_date)}</span><span>Trainer: ${esc(t.trainer_name||'—')}</span>${reviewOverdue?'<span class="badge overdue">Review overdue</span>':''}</div></div><span class="badge">${done}/${assigns.length} signed</span></div><div class="meta"><span>${deliveryText(t.delivery_method||defaultTrainingDelivery(t.session_type))}</span><span>${renewalText(t.renewal_value,t.renewal_unit)}</span><span>Review: ${fmtDate(t.review_date)}</span></div><div class="row">${btn('View','secondary',`data-view-training="${t.id}"`)}${isManager()?btn('Assign','secondary',`data-assign-training="${t.id}"`)+btn('Archive','ghost',`data-archive-training="${t.id}"`):''}</div></div>`}).join(''):'<div class="empty">No training sessions found.</div>'}
function showNewTraining(){
  openModal('New training session',`<div class="form-grid"><label>Training name<input id="trainName"></label><label>Type<select id="trainType"><option value="AD_HOC">Ad-hoc training</option><option value="TOOLBOX_TALK">Toolbox Talk</option><option value="INDUCTION">Induction</option><option value="REFRESHER">Refresher</option><option value="OTHER">Other</option></select></label><label>Delivery method<select id="trainDelivery"><option value="SELF_TRAINING">Self-training</option><option value="INSTRUCTOR_LED">Instructor-led</option></select></label><label>Default completion due date<input id="trainDefaultDue" type="date" value="${daysFromNow(14)}"></label><label>Date delivered<input id="trainDate" type="date" value="${todayISO()}"></label><label>Trainer / presenter<input id="trainTrainer" value="${esc(state.profile.display_name||'')}"></label><label>Review date<input id="trainReview" type="date"></label><label>Sign-off / refresher frequency<select id="trainRenewalPreset"><option value="">One-off only</option><option value="3|MONTHS">Every 3 months</option><option value="6|MONTHS">Every 6 months</option><option value="12|MONTHS">Every 12 months</option><option value="24|MONTHS">Every 24 months</option><option value="CUSTOM">Custom</option></select></label><div id="trainCustomRenewal" class="full" hidden><div class="form-grid"><label>Every<input id="trainRenewalValue" type="number" min="1"></label><label>Unit<select id="trainRenewalUnit"><option>DAYS</option><option>MONTHS</option><option>YEARS</option></select></label></div></div><label class="full">Details<textarea id="trainDesc"></textarea></label><label class="full">Upload supporting files<input id="trainFiles" type="file" multiple></label></div><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Create training','primary','id="saveTraining"')}</div>`);
  const syncDelivery=()=>{$('trainDelivery').value=defaultTrainingDelivery($('trainType').value)};
  $('trainType').addEventListener('change',syncDelivery);syncDelivery();
  $('trainRenewalPreset').addEventListener('change',()=>{$('trainCustomRenewal').hidden=$('trainRenewalPreset').value!=='CUSTOM'});
}
async function saveTraining(){if(!$('trainName').value.trim())return toast('Training name is required.');const r=renewalFromPreset('train');const {data:t,error}=await sb.from('training_sessions').insert({name:$('trainName').value.trim(),session_type:$('trainType').value,delivery_method:$('trainDelivery').value,description:$('trainDesc').value.trim()||null,delivered_date:$('trainDate').value||null,trainer_name:$('trainTrainer').value.trim()||null,trainer_user_id:state.user.id,review_date:$('trainReview').value||null,default_due_date:$('trainDefaultDue').value||null,renewal_value:r.value,renewal_unit:r.unit,status:'ACTIVE',created_by:state.user.id}).select().single();if(error)return toast(error.message);for(const file of $('trainFiles').files){const path=`training/${t.id}/${crypto.randomUUID()}-${file.name}`;const up=await sb.storage.from('safety-files').upload(path,file);if(!up.error)await sb.from('training_files').insert({training_session_id:t.id,file_name:file.name,storage_path:path,uploaded_by:state.user.id})}closeModal();await refresh('Training created.');}
function showTrainingDetails(id){
  const t=state.training.find(x=>x.id===id),files=state.trainingFiles.filter(f=>f.training_session_id===id),assigns=state.trainingAssignments.filter(a=>a.training_session_id===id&&a.active!==false),baseMethod=t.delivery_method||defaultTrainingDelivery(t.session_type);
  const refs=[...new Set(String(t.description||'').match(/\b(?:RA|COSHH|SSW|PROC)-\d{3}\b/gi)||[])].map(x=>x.toUpperCase());
  const relatedDocs=refs.map(ref=>state.documents.find(d=>String(d.reference||'').toUpperCase()===ref)).filter(Boolean);
  openModal('Training details',`<div class="stack"><div><strong>${esc(t.name)}</strong><div class="meta"><span>${esc(t.session_type.replaceAll('_',' '))}</span><span>Default: ${deliveryText(baseMethod)}</span><span>Trainer ${esc(t.trainer_name||'—')}</span><span>Default due ${fmtDate(t.default_due_date)}</span><span>${renewalText(t.renewal_value,t.renewal_unit)}</span></div></div>${t.description?`<p>${esc(t.description)}</p>`:''}${refs.length?`<div><strong>Relevant documents</strong><div class="row">${relatedDocs.length?relatedDocs.map(d=>{const v=currentVersion(d.id);return v?btn(`${d.reference} · ${d.title}`,'secondary',`data-open-doc="${v.id}"`):''}).join(''):'<span class="muted">Referenced documents are not in the tracker yet.</span>'}</div></div>`:''}<div><strong>Files</strong><div class="row">${files.length?files.map(f=>btn(f.file_name,'secondary',`data-open-training-file="${f.id}"`)).join(''):'<span class="muted">No supporting files.</span>'}</div></div>${isManager()?`<div><strong>Attendance / sign-off</strong><p class="muted">People who request instructor-led support are handled individually even if the training default is self-training.</p><div class="card-list">${assigns.length?assigns.map(a=>{const method=effectiveTrainingMethod(t,a),s=latestTrainingSignoff(a),c=latestTrainingConfirmation(a),event=latestTrainingEvent(a),ready=freshConfirmation(c,s),due=trainingAssignmentDue(a,s),done=!!s&&!(a.renewal_value&&new Date(due)<=new Date());let label=done?'Completed':method==='INSTRUCTOR_LED'?(ready?'Ready for trainee sign-off':event?.attendance_status==='ABSENT'?'Absent / not attended':'Awaiting instructor confirmation'):'Outstanding self-training';return `<div class="item-card compact"><div class="row-between"><label class="check-row">${method==='INSTRUCTOR_LED'&&!done?`<input type="checkbox" class="attendance-person" value="${a.id}">`:''}<span>${esc(personName(a.user_id))}</span></label><span class="badge ${done?'complete':'due'}">${label}</span></div><div class="meta"><span>${deliveryText(method)}</span><span>Due ${fmtDate(a.due_date)}</span>${methodOverrideNote(a)?`<span>${esc(methodOverrideNote(a))}</span>`:''}${event?.delivery_date?`<span>Last attendance date ${fmtDate(event.delivery_date)}</span>`:''}${s?`<span>Signed ${fmtDateTime(s.signed_at)}</span>`:''}</div></div>`}).join(''):'<span class="muted">No one assigned.</span>'}</div>${assigns.some(a=>effectiveTrainingMethod(t,a)==='INSTRUCTOR_LED')?`<div class="actions">${btn('Record selected attendance','primary',`data-bulk-training-attendance="${id}"`)}</div>`:''}</div>`:''}</div>`);
}
async function openTrainingFile(id){const f=state.trainingFiles.find(x=>x.id===id);if(!f)return;const {data,error}=await sb.storage.from('safety-files').createSignedUrl(f.storage_path,120);if(error)return toast(error.message);window.open(data.signedUrl,'_blank','noopener');}
function showAssignTraining(id){
  const t=state.training.find(x=>x.id===id),current=state.trainingAssignments.filter(a=>a.training_session_id===id&&a.active!==false).map(a=>a.user_id);
  const opts=state.people.filter(p=>p.active!==false).map(p=>`<label class="check-row"><input type="checkbox" class="train-person" value="${p.id}" ${current.includes(p.id)?'checked':''}>${esc(p.display_name||p.email)}</label>`).join('');
  const currentDue=state.trainingAssignments.find(a=>a.training_session_id===id&&a.active!==false)?.due_date||t.default_due_date||daysFromNow(14);
  openModal('Assign training',`<p><strong>${esc(t.name)}</strong></p><div class="form-grid"><label>Complete by<input id="trainAssignDue" type="date" value="${currentDue||''}"></label><div class="full"><p class="muted">This is the deadline for initial completion. Refresher/renewal dates are calculated separately after completion.</p><p class="muted"><strong>Untick a person and Save assignments to remove their active assignment.</strong> Previous completed training/sign-off history is retained.</p><label class="check-row"><input id="trainAssignAll" type="checkbox"> Select all active users</label><strong>People</strong><div class="checkbox-list">${opts}</div></div></div><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Save assignments','primary',`data-save-training-assignment="${id}"`)}</div>`);
  $('trainAssignAll').addEventListener('change',e=>document.querySelectorAll('.train-person').forEach(x=>x.checked=e.target.checked));
}
async function saveTrainingAssignments(id){
  const t=state.training.find(x=>x.id===id);
  const selected=[...document.querySelectorAll('.train-person:checked')].map(x=>x.value);
  const selectedSet=new Set(selected);
  const due=$('trainAssignDue').value||null;

  // Unchecking an existing assignee now removes them from the active assignment
  // without deleting their historical attendance/sign-off evidence.
  const currentlyActive=state.trainingAssignments.filter(a=>a.training_session_id===id&&a.active!==false);
  for(const a of currentlyActive){
    if(!selectedSet.has(a.user_id)){
      const {error}=await sb.from('training_assignments').update({active:false}).eq('id',a.id);
      if(error)return toast(error.message);
    }
  }

  // Add new assignees or reactivate a previously removed assignment.
  for(const uid of selected){
    const existing=state.trainingAssignments.find(a=>a.training_session_id===id&&a.user_id===uid);
    if(existing){
      const {error}=await sb.from('training_assignments')
        .update({due_date:due,active:true})
        .eq('id',existing.id);
      if(error)return toast(error.message);
    }else{
      const {error}=await sb.from('training_assignments').insert({
        training_session_id:id,
        user_id:uid,
        due_date:due,
        renewal_value:t.renewal_value,
        renewal_unit:t.renewal_unit,
        assigned_by:state.user.id,
        active:true
      });
      if(error)return toast(error.message);
    }
  }

  closeModal();
  await refresh('Training assignments updated.');
}

function showInstructorGroupAttendance(trainingId){
  const t=state.training.find(x=>x.id===trainingId);if(!t)return;
  const assigns=state.trainingAssignments
    .filter(a=>a.training_session_id===trainingId&&a.active!==false)
    .filter(a=>effectiveTrainingMethod(t,a)==='INSTRUCTOR_LED');

  if(!assigns.length)return toast('No active instructor-led assignees for this training.');

  const rows=assigns.map(a=>{
    const s=latestTrainingSignoff(a);
    const c=latestTrainingConfirmation(a);
    const event=latestTrainingEvent(a);
    const due=trainingAssignmentDue(a,s);
    const ready=freshConfirmation(c,s);
    const needs=!s||(a.renewal_value&&new Date(due)<=new Date());

    let label='Outstanding';
    if(!needs) label='Completed';
    else if(ready) label='Attendance already confirmed — waiting for trainee signature';
    else if(event?.attendance_status==='ABSENT') label='Previously marked absent';
    else label='Awaiting instructor confirmation';

    const selectable=needs&&!ready;

    return `<label class="check-row group-attendee-row">
      ${selectable?`<input type="checkbox" class="group-attendee" value="${a.id}">`:'<span style="width:18px"></span>'}
      <span style="flex:1">
        <strong>${esc(personName(a.user_id))}</strong>
        <span class="muted" style="display:block">${esc(label)}${due?` · Due ${fmtDate(due)}`:''}</span>
      </span>
    </label>`;
  }).join('');

  openModal('Group training attendance',`
    <p><strong>${esc(t.name)}</strong></p>
    <p class="muted">Tick only the people who attended this session. Anyone left unticked remains unchanged.</p>
    <div class="row">
      ${btn('Select all eligible','ghost','id="selectAllGroupAttendees"')}
      ${btn('Clear selection','ghost','id="clearGroupAttendees"')}
    </div>
    <div class="checkbox-list">${rows}</div>
    <div class="form-grid" style="margin-top:12px">
      <label>Training date<input id="groupTrainingDate" type="date" value="${todayISO()}"></label>
      <label>Status<select id="groupTrainingStatus"><option value="ATTENDED">Attended / training delivered</option><option value="ABSENT">Absent / not attended</option></select></label>
      <label class="full">Instructor note (optional)<textarea id="groupTrainingNote"></textarea></label>
    </div>
    <div class="actions">
      ${btn('Cancel','ghost','data-close-modal')}
      ${btn('Save selected attendees','primary',`data-save-group-training="${trainingId}"`)}
    </div>
  `);

  $('selectAllGroupAttendees')?.addEventListener('click',()=>document.querySelectorAll('.group-attendee').forEach(x=>x.checked=true));
  $('clearGroupAttendees')?.addEventListener('click',()=>document.querySelectorAll('.group-attendee').forEach(x=>x.checked=false));
}

async function saveInstructorGroupAttendance(trainingId){
  const ids=[...document.querySelectorAll('.group-attendee:checked')].map(x=>x.value);
  if(!ids.length)return toast('Tick at least one attendee.');

  const delivery_date=$('groupTrainingDate').value||todayISO();
  const attendance_status=$('groupTrainingStatus').value;
  const reason=$('groupTrainingNote').value.trim()||null;

  for(const id of ids){
    const a=state.trainingAssignments.find(x=>x.id===id);
    if(!a)continue;
    const {error}=await sb.from('training_delivery_confirmations').insert({
      assignment_id:id,
      user_id:a.user_id,
      confirmed_by:state.user.id,
      confirmation_type:'INSTRUCTOR',
      reason,
      delivery_date,
      attendance_status
    });
    if(error)return toast(error.message);
  }

  closeModal();
  await refresh(attendance_status==='ATTENDED'
    ? `${ids.length} attendee${ids.length===1?'':'s'} confirmed.`
    : `${ids.length} absence${ids.length===1?'':'s'} recorded.`);
}

function showBulkTrainingAttendance(trainingId){
  const ids=[...document.querySelectorAll('.attendance-person:checked')].map(x=>x.value);
  if(!ids.length)return toast('Select at least one person.');
  const t=state.training.find(x=>x.id===trainingId);
  openModal('Record selected attendance',`<p><strong>${esc(t.name)}</strong></p><p>${ids.length} person${ids.length===1?'':'s'} selected.</p><div class="form-grid"><label>Training date<input id="bulkTrainingDate" type="date" value="${todayISO()}"></label><label>Status<select id="bulkTrainingStatus"><option value="ATTENDED">Attended / training delivered</option><option value="ABSENT">Absent / not attended</option></select></label><label class="full">Instructor note (optional)<textarea id="bulkTrainingNote"></textarea></label></div><p class="muted">People you did not select are unchanged and can be trained later.</p><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Save selected','primary',`data-save-bulk-training="${trainingId}"`)}</div>`);
  window._selectedTrainingAssignments=ids;
}
async function saveBulkTrainingAttendance(trainingId){
  const ids=window._selectedTrainingAssignments||[],delivery_date=$('bulkTrainingDate').value||todayISO(),attendance_status=$('bulkTrainingStatus').value,reason=$('bulkTrainingNote').value.trim()||null;
  if(!ids.length)return toast('No people selected.');
  for(const id of ids){const a=state.trainingAssignments.find(x=>x.id===id);const {error}=await sb.from('training_delivery_confirmations').insert({assignment_id:id,user_id:a.user_id,confirmed_by:state.user.id,confirmation_type:'INSTRUCTOR',reason,delivery_date,attendance_status});if(error)return toast(error.message)}
  window._selectedTrainingAssignments=[];closeModal();await refresh(attendance_status==='ATTENDED'?'Selected trainees confirmed.':'Selected absences recorded.');
}

function signTraining(assignmentId){
  const a=state.trainingAssignments.find(x=>x.id===assignmentId),t=state.training.find(x=>x.id===a.training_session_id),prev=latestTrainingSignoff(a),method=effectiveTrainingMethod(t,a);
  if(method==='INSTRUCTOR_LED'&&!freshConfirmation(latestTrainingConfirmation(a),prev))return toast('Instructor confirmation is required before you can sign off.');
  openModal('Training sign-off',`<p><strong>${esc(t.name)}</strong></p><p>I confirm I completed/attended this training and understand that I should ask my manager if anything is unclear.</p>${signatureBlock('train')}<label class="check-row"><input id="trainAckCheck" type="checkbox"> I confirm this sign-off and digital signature.</label><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Sign off','primary',`data-confirm-sign-training="${assignmentId}"`)}</div>`);
  setupSignaturePad('trainSignaturePad','trainClearSignature');
}
async function confirmSignTraining(id){
  if(!$('trainAckCheck').checked)return toast('Tick the confirmation first.');
  const sig=signatureData('trainSignaturePad'),sigName=$('trainSignatureName').value.trim();
  if(!sig)return toast('Please sign in the digital signature box.');
  if(!sigName)return toast('Enter the signature name.');
  const a=state.trainingAssignments.find(x=>x.id===id),t=state.training.find(x=>x.id===a.training_session_id),c=latestTrainingConfirmation(a);
  const statement='I confirm I completed/attended this training and understand that I should ask my manager if anything is unclear.';
  const {error}=await sb.from('training_signoffs').insert({training_assignment_id:id,training_session_id:t.id,user_id:state.user.id,statement_snapshot:statement,training_name_snapshot:t.name,trainer_snapshot:t.trainer_name,delivered_date_snapshot:c?.delivery_date||t.delivered_date,signature_data:sig,signature_name:sigName});
  if(error)return toast(error.message);closeModal();await refresh('Training sign-off and digital signature recorded.');
}
async function archiveTraining(id){await sb.from('training_sessions').update({status:'ARCHIVED'}).eq('id',id);await refresh('Training archived.');}

function renderPeople(){
  $('peopleList').innerHTML=state.people.length?state.people.map(p=>`<div class="item-card"><div class="row-between"><div><h3>${esc(p.display_name||p.email)}</h3><div class="meta"><span>${esc(p.email||'')}</span><span class="badge">${esc(p.role)}</span></div></div><span class="badge ${p.active===false?'overdue':'complete'}">${p.active===false?'Disabled':'Active'}</span></div><div class="row">${btn('Safety / training record','secondary',`data-person-record="${p.id}"`)}${isAdmin()?`${btn('Set role','secondary',`data-set-role="${p.id}"`)}${p.id!==state.user.id?btn(p.active===false?'Enable':'Disable',p.active===false?'secondary':'danger',`data-toggle-user="${p.id}"`):''}`:''}</div></div>`).join(''):'<div class="empty">No users.</div>';
}

function personComplianceRows(userId){return complianceRows().filter(r=>r.user_id===userId)}
function showPersonRecord(id){
  const p=state.people.find(x=>x.id===id),rows=personComplianceRows(id),docSigns=state.docSignoffs.filter(s=>s.user_id===id).sort((a,b)=>new Date(b.signed_at)-new Date(a.signed_at)),trainSigns=state.trainingSignoffs.filter(s=>s.user_id===id).sort((a,b)=>new Date(b.signed_at)-new Date(a.signed_at));
  openModal('Employee safety / training record',`<div class="stack"><div><strong>${esc(p.display_name||p.email)}</strong><div class="meta"><span>${esc(p.email||'')}</span><span>${esc(p.role)}</span></div></div><div class="stats-grid">${stat(rows.filter(r=>r.statusCode!=='COMPLETED').length,'Outstanding')}${stat(rows.filter(r=>r.statusCode==='OVERDUE').length,'Overdue')}${stat(docSigns.length+trainSigns.length,'Sign-offs')}</div><div><strong>Current requirements</strong><div class="card-list">${rows.length?rows.map(r=>`<div class="item-card compact"><div class="row-between"><span>${esc(r.kind==='DOCUMENT'?r.item.title:r.item.name)}</span><span class="badge ${r.statusCode==='COMPLETED'?'complete':r.statusCode==='OVERDUE'?'overdue':'due'}">${esc(r.statusLabel)}</span></div><div class="meta"><span>${deliveryText(r.method)}</span><span>Due ${r.due?fmtDate(r.due):'—'}</span></div></div>`).join(''):'<span class="muted">Nothing assigned.</span>'}</div></div><div><strong>Completion history</strong><div class="card-list">${[...docSigns.map(s=>({date:s.signed_at,label:`${s.title_snapshot} · v${s.version_snapshot}`})),...trainSigns.map(s=>({date:s.signed_at,label:s.training_name_snapshot}))].sort((a,b)=>new Date(b.date)-new Date(a.date)).map(x=>`<div class="item-card compact"><div class="row-between"><span>${esc(x.label)}</span><span>${fmtDateTime(x.date)}</span></div></div>`).join('')||'<span class="muted">No completion history yet.</span>'}</div></div><div class="actions">${btn('Download record PDF','secondary',`data-person-record-pdf="${id}"`)}</div></div>`);
}
function downloadPersonRecord(id){
  if(!pdfReady())return toast('PDF library did not load. Refresh the page and try again.');
  const p=state.people.find(x=>x.id===id);
  const rows=personComplianceRows(id).map(r=>({
    Person:p.display_name||p.email,
    Email:p.email||'',
    Kind:r.kind,
    Item:r.kind==='DOCUMENT'?r.item.title:r.item.name,
    Reference:r.kind==='DOCUMENT'?(r.item.reference||''):'',
    Version:r.kind==='DOCUMENT'?r.version.version_label:'',
    Delivery:deliveryText(r.method),
    Status:r.statusLabel,
    Due:r.due?fmtDateTime(r.due):'',
    Last_signed:r.signoff?fmtDateTime(r.signoff.signed_at):'',
    Training_date:r.confirmation?.delivery_date||''
  }));

  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const title=`${p.display_name||p.email} - Safety / Training Record`;
  doc.setFontSize(16);doc.text(title,14,14);
  doc.setFontSize(9);doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`,14,20);
  addPdfTable(doc,'Compliance Record',rows,28);
  addPersonSignaturePages(doc,id);
  stampPdfPages(doc,title);
  doc.save(`${safeFileName(p.display_name||'employee')}-safety-record-${todayISO()}.pdf`);
}
function showInviteUser(){
  openModal('Invite user',`<div class="form-grid"><label>Name<input id="inviteName"></label><label>Email<input id="inviteEmail" type="email"></label><label>Role<select id="inviteRole"><option value="user">User</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label><div class="full hint-box"><strong>Secure sign-off:</strong> the invitee must use their email invitation and choose their own password before entering the system. Only their signed-in account can submit their trainee acknowledgements.</div></div><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Send invite','primary','id="sendInvite"')}</div>`);
}
async function sendInvite(){
  const name=$('inviteName').value.trim();
  const email=$('inviteEmail').value.trim().toLowerCase();
  const role=$('inviteRole').value;
  if(!name)return toast('Enter the user name.');
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return toast('Enter a valid email address.');

  const button=$('sendInvite');
  const oldLabel=button?.textContent||'Send invite';
  if(button){button.disabled=true;button.textContent='Sending invite…';}

  try{
    const {data:{session},error:sessionError}=await sb.auth.getSession();
    if(sessionError)throw sessionError;
    if(!session?.access_token)throw new Error('Your Admin session has expired. Sign out and sign back in, then try again.');

    const redirect=`${location.origin}${location.pathname}?invite=1`;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);

    let res;
    try{
      res=await fetch(`${CFG.supabaseUrl}/functions/v1/invite-user`,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'Authorization':`Bearer ${session.access_token}`,
          'apikey':CFG.supabaseKey
        },
        body:JSON.stringify({action:'invite',email,display_name:name,role,redirect_to:redirect}),
        signal:controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const raw=await res.text();
    let out={};
    try{out=raw?JSON.parse(raw):{}}catch{out={error:raw}}

    if(!res.ok){
      const detail=out.error||out.message||`Invite failed (HTTP ${res.status})`;
      throw new Error(detail);
    }

    closeModal();
    toast(`Invitation sent to ${email}. They must use the email link and choose their own password.`);
    setTimeout(()=>refresh(),300);
  }catch(err){
    const msg=err?.name==='AbortError'
      ? 'Invite request timed out. Check Supabase Edge Functions → invite-user → Logs.'
      : (err?.message||String(err)||'Invite failed.');
    toast(`Invite failed: ${msg}`);
    const liveButton=$('sendInvite');
    if(liveButton){liveButton.disabled=false;liveButton.textContent=oldLabel;}
  }
}
function showSetRole(id){const p=state.people.find(x=>x.id===id);openModal('Set role',`<label>Role<select id="roleSelect"><option value="user" ${p.role==='user'?'selected':''}>User</option><option value="manager" ${p.role==='manager'?'selected':''}>Manager</option><option value="admin" ${p.role==='admin'?'selected':''}>Admin</option></select></label><div class="actions">${btn('Save','primary',`data-save-role="${id}"`)}</div>`)}
async function saveRole(id){const {data:{session}}=await sb.auth.getSession();const r=await fetch(`${CFG.supabaseUrl}/functions/v1/invite-user`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':CFG.supabaseKey},body:JSON.stringify({action:'set_role',user_id:id,role:$('roleSelect').value})});const o=await r.json().catch(()=>({}));if(!r.ok)return toast(o.error||'Role update failed');closeModal();await refresh('Role updated.');}
async function toggleUser(id){const p=state.people.find(x=>x.id===id);const {data:{session}}=await sb.auth.getSession();const r=await fetch(`${CFG.supabaseUrl}/functions/v1/invite-user`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':CFG.supabaseKey},body:JSON.stringify({action:p.active===false?'enable':'disable',user_id:id})});const o=await r.json().catch(()=>({}));if(!r.ok)return toast(o.error||'User update failed');await refresh('User updated.');}


function complianceRows(){
  const rows=[],now=new Date();
  state.docAssignments.filter(a=>a.active!==false).forEach(a=>{
    const v=state.versions.find(x=>x.id===a.document_version_id),d=v&&state.documents.find(x=>x.id===v.document_id);if(!d||!v)return;
    const s=latestDocSignoff(a),due=documentAssignmentDue(a,s),method=effectiveDocumentMethod(d,a,v),c=latestDocConfirmation(a),event=latestDocEvent(a),ready=freshConfirmation(c,s),needs=!s||(a.renewal_value&&new Date(due)<=now);
    let code='COMPLETED',label='Completed';
    if(needs){if(due&&new Date(due)<now){code='OVERDUE';label='Overdue';}else if(method==='INSTRUCTOR_LED'){if(ready){code='READY_TO_SIGN';label='Ready for trainee sign-off';}else if(event?.attendance_status==='ABSENT'){code='ABSENT';label='Absent / not attended';}else{code='AWAITING_INSTRUCTOR';label='Awaiting instructor confirmation';}}else{code='OUTSTANDING';label=s?'Renewal due':'Not started';}}
    else if(due&&withinDays(due,30)){code='DUE_SOON';label='Due within 30 days';}
    rows.push({kind:'DOCUMENT',assignment:a,item:d,version:v,user_id:a.user_id,method,signoff:s,confirmation:c,event,due,statusCode:code,statusLabel:label,needs,ready});
  });
  state.trainingAssignments.filter(a=>a.active!==false).forEach(a=>{
    const t=state.training.find(x=>x.id===a.training_session_id);if(!t)return;
    const s=latestTrainingSignoff(a),due=trainingAssignmentDue(a,s),method=effectiveTrainingMethod(t,a),c=latestTrainingConfirmation(a),event=latestTrainingEvent(a),ready=freshConfirmation(c,s),needs=!s||(a.renewal_value&&new Date(due)<=now);
    let code='COMPLETED',label='Completed';
    if(needs){if(due&&new Date(due)<now){code='OVERDUE';label='Overdue';}else if(method==='INSTRUCTOR_LED'){if(ready){code='READY_TO_SIGN';label='Ready for trainee sign-off';}else if(event?.attendance_status==='ABSENT'){code='ABSENT';label='Absent / not attended';}else{code='AWAITING_INSTRUCTOR';label='Awaiting instructor confirmation';}}else{code='OUTSTANDING';label=s?'Renewal due':'Not started';}}
    else if(due&&withinDays(due,30)){code='DUE_SOON';label='Due within 30 days';}
    rows.push({kind:'TRAINING',assignment:a,item:t,user_id:a.user_id,method,signoff:s,confirmation:c,event,due,statusCode:code,statusLabel:label,needs,ready});
  });
  return rows;
}

function instructorRows(){
  return complianceRows().filter(r=>r.method==='INSTRUCTOR_LED'&&r.needs);
}

function renderInstructor(){
  if(!isManager()||!$('instructorList'))return;

  const person=$('instructorPersonFilter')?.value||'';
  const kind=$('instructorKindFilter')?.value||'';
  const status=$('instructorStatusFilter')?.value||'';

  const all=instructorRows();
  const awaiting=all.filter(r=>r.statusCode==='AWAITING_INSTRUCTOR').length;
  const ready=all.filter(r=>r.statusCode==='READY_TO_SIGN').length;
  const absent=all.filter(r=>r.statusCode==='ABSENT').length;
  const overdue=all.filter(r=>r.statusCode==='OVERDUE').length;

  $('instructorStats').innerHTML=
    stat(all.length,'Instructor-led outstanding')+
    stat(awaiting,'Awaiting instructor')+
    stat(ready,'Ready for trainee')+
    stat(absent,'Absent')+
    stat(overdue,'Overdue');

  let rows=all.filter(r=>
    (!person||r.user_id===person)&&
    (!kind||r.kind===kind)&&
    (!status||r.statusCode===status)
  );

  rows.sort((a,b)=>{
    const pa=personName(a.user_id),pb=personName(b.user_id);
    return pa.localeCompare(pb)||a.statusLabel.localeCompare(b.statusLabel);
  });

  $('instructorList').innerHTML=rows.length?rows.map(r=>{
    const title=r.kind==='DOCUMENT'?r.item.title:r.item.name;
    const sub=r.kind==='DOCUMENT'
      ? `${docTypeLabel(r.item.doc_type)} · ${r.item.reference||'No reference'} · Version ${r.version.version_label}`
      : `${r.item.session_type.replaceAll('_',' ')}`;

    const canRecord=!r.ready;
    const attendanceButton=canRecord
      ? btn(r.event?.attendance_status==='ABSENT'?'Record attendance now':'Record attendance','primary',
          r.kind==='DOCUMENT'
            ? `data-confirm-doc-instructor="${r.assignment.id}"`
            : `data-confirm-training-instructor="${r.assignment.id}"`)
      : '';

    return `<div class="item-card">
      <div class="row-between">
        <div>
          <h3>${esc(personName(r.user_id))}</h3>
          <div class="meta">
            <span>${esc(title)}</span>
            <span>${esc(sub)}</span>
            <span>${deliveryText(r.method)}</span>
          </div>
        </div>
        <span class="badge ${r.statusCode==='OVERDUE'?'overdue':'due'}">${esc(r.statusLabel)}</span>
      </div>
      <div class="meta">
        <span>Due ${r.due?fmtDate(r.due):'—'}</span>
        ${r.event?.delivery_date?`<span>${r.event.attendance_status==='ABSENT'?'Absent':'Last attendance'} ${fmtDate(r.event.delivery_date)}</span>`:''}
        ${r.confirmation?.confirmed_by?`<span>Confirmed by ${esc(personName(r.confirmation.confirmed_by))}</span>`:''}
      </div>
      <div class="row">
        ${attendanceButton}
        ${r.ready?'<span class="muted">Instructor step complete — waiting for trainee digital signature.</span>':''}
      </div>
    </div>`;
  }).join(''):'<div class="empty">No matching instructor-led assignments.</div>';
}

function renderCompliance(){
  if(!isManager())return;
  const person=$('compliancePersonFilter')?.value||'',kind=$('complianceKindFilter')?.value||'',status=$('complianceStatusFilter')?.value||'';
  const all=complianceRows(),outstanding=all.filter(r=>!['COMPLETED','DUE_SOON'].includes(r.statusCode)),awaiting=all.filter(r=>r.statusCode==='AWAITING_INSTRUCTOR'),overdue=all.filter(r=>r.statusCode==='OVERDUE'),dueSoon=all.filter(r=>r.due&&withinDays(r.due,30)&&r.statusCode!=='COMPLETED'),reviews=reviewAlertCounts();
  $('complianceStats').innerHTML=stat(all.length,'Assignments')+stat(outstanding.length,'Outstanding')+stat(awaiting.length,'Awaiting instructor')+stat(overdue.length,'Overdue')+stat(dueSoon.length,'Renewals due ≤30d')+stat(reviews.overdue,'Reviews overdue')+stat(reviews.dueSoon,'Reviews due ≤30d');
  let rows=all.filter(r=>(!person||r.user_id===person)&&(!kind||r.kind===kind)&&(!status||r.statusCode===status));
  rows.sort((a,b)=>personName(a.user_id).localeCompare(personName(b.user_id))||a.statusLabel.localeCompare(b.statusLabel));
  $('complianceList').innerHTML=rows.length?rows.map(r=>{
    const title=r.kind==='DOCUMENT'?r.item.title:r.item.name,sub=r.kind==='DOCUMENT'?`${r.item.doc_type} · ${r.item.reference||'No reference'} · Version ${r.version.version_label}`:`${r.item.session_type.replaceAll('_',' ')}`;
    const confirm=r.needs&&r.method==='INSTRUCTOR_LED'&&!r.ready?btn('Record attendance','secondary',r.kind==='DOCUMENT'?`data-confirm-doc-instructor="${r.assignment.id}"`:`data-confirm-training-instructor="${r.assignment.id}"`):'';
    return `<div class="item-card"><div class="row-between"><div><h3>${esc(personName(r.user_id))}</h3><div class="meta"><span>${esc(title)}</span><span>${esc(sub)}</span><span>${deliveryText(r.method)}</span></div></div><span class="badge ${r.statusCode==='COMPLETED'?'complete':r.statusCode==='OVERDUE'?'overdue':'due'}">${esc(r.statusLabel)}</span></div><div class="meta"><span>Due ${r.due?fmtDate(r.due):'—'}</span>${r.signoff?`<span>Last signed ${fmtDateTime(r.signoff.signed_at)}</span>`:''}${r.event?.delivery_date?`<span>${r.event.attendance_status==='ABSENT'?'Absent':'Training'} ${fmtDate(r.event.delivery_date)}</span>`:''}</div><div class="row">${confirm}</div></div>`;
  }).join(''):'<div class="empty">No matching assignments.</div>';
}
function showConfirmDocumentInstructor(id){
  const a=state.docAssignments.find(x=>x.id===id),v=state.versions.find(x=>x.id===a.document_version_id),d=state.documents.find(x=>x.id===v.document_id);
  openModal('Record instructor-led delivery',`<p><strong>${esc(personName(a.user_id))}</strong> · ${esc(d.title)} · Version ${esc(v.version_label)}</p><div class="form-grid"><label>Training date<input id="confirmDeliveryDate" type="date" value="${todayISO()}"></label><label>Status<select id="confirmAttendanceStatus"><option value="ATTENDED">Attended / training delivered</option><option value="ABSENT">Absent / not attended</option></select></label><label class="full">Instructor note (optional)<textarea id="confirmNote"></textarea></label></div><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Save','primary',`data-save-doc-confirm="${id}"`)}</div>`);
}
async function saveDocumentInstructorConfirmation(id){
  const a=state.docAssignments.find(x=>x.id===id),reason=$('confirmNote').value.trim()||null,delivery_date=$('confirmDeliveryDate').value||todayISO(),attendance_status=$('confirmAttendanceStatus').value;
  const {error}=await sb.from('document_delivery_confirmations').insert({assignment_id:id,user_id:a.user_id,confirmed_by:state.user.id,confirmation_type:'INSTRUCTOR',reason,delivery_date,attendance_status});
  if(error)return toast(error.message);closeModal();await refresh(attendance_status==='ATTENDED'?'Instructor-led delivery confirmed.':'Absence recorded; user remains outstanding.');
}
function showConfirmTrainingInstructor(id){
  const a=state.trainingAssignments.find(x=>x.id===id),t=state.training.find(x=>x.id===a.training_session_id);
  openModal('Record training attendance',`<p><strong>${esc(personName(a.user_id))}</strong> · ${esc(t.name)}</p><div class="form-grid"><label>Training date<input id="confirmDeliveryDate" type="date" value="${todayISO()}"></label><label>Status<select id="confirmAttendanceStatus"><option value="ATTENDED">Attended / training delivered</option><option value="ABSENT">Absent / not attended</option></select></label><label class="full">Instructor note (optional)<textarea id="confirmNote"></textarea></label></div><p class="muted">Only “Attended” unlocks the trainee's own sign-off. “Absent” leaves them outstanding for a later date.</p><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Save attendance','primary',`data-save-training-confirm="${id}"`)}</div>`);
}
async function saveTrainingInstructorConfirmation(id){
  const a=state.trainingAssignments.find(x=>x.id===id),reason=$('confirmNote').value.trim()||null,delivery_date=$('confirmDeliveryDate').value||todayISO(),attendance_status=$('confirmAttendanceStatus').value;
  const {error}=await sb.from('training_delivery_confirmations').insert({assignment_id:id,user_id:a.user_id,confirmed_by:state.user.id,confirmation_type:'INSTRUCTOR',reason,delivery_date,attendance_status});
  if(error)return toast(error.message);closeModal();await refresh(attendance_status==='ATTENDED'?'Training attendance confirmed.':'Absence recorded; trainee remains outstanding.');
}
function showDocumentException(id){
  openModal('Sign off as exception',`<p>This bypasses normal instructor confirmation only because you created this item and assigned it to yourself. The exception is retained in the audit trail.</p><label>Exception reason<textarea id="exceptionReason" placeholder="e.g. Author / competent person self-completion"></textarea></label>${signatureBlock('exception')}<label class="check-row"><input id="exceptionAck" type="checkbox"> I confirm I have completed/reviewed this requirement and signed this exception.</label><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Record exception and sign off','primary',`data-save-doc-exception="${id}"`)}</div>`);
  setupSignaturePad('exceptionSignaturePad','exceptionClearSignature');
}
async function saveDocumentException(id){
  const reason=$('exceptionReason').value.trim();if(!reason)return toast('Enter an exception reason.');if(!$('exceptionAck').checked)return toast('Tick the confirmation first.');
  const sig=signatureData('exceptionSignaturePad'),sigName=$('exceptionSignatureName').value.trim();if(!sig)return toast('Please sign in the digital signature box.');if(!sigName)return toast('Enter the signature name.');
  const a=state.docAssignments.find(x=>x.id===id),v=state.versions.find(x=>x.id===a.document_version_id),d=state.documents.find(x=>x.id===v.document_id);
  if(!isManager()||a.user_id!==state.user.id||d.created_by!==state.user.id)return toast('This exception is only available to the creator for their own assignment.');
  let r=await sb.from('document_delivery_confirmations').insert({assignment_id:id,user_id:state.user.id,confirmed_by:state.user.id,confirmation_type:'EXCEPTION',reason});if(r.error)return toast(r.error.message);
  r=await sb.from('document_signoffs').insert({assignment_id:a.id,document_version_id:v.id,user_id:state.user.id,statement_snapshot:'Exception completion: I confirm I completed/reviewed this requirement. Instructor confirmation was waived and the exception reason is recorded.',title_snapshot:d.title,reference_snapshot:d.reference,version_snapshot:v.version_label,signature_data:sig,signature_name:sigName});if(r.error)return toast(r.error.message);
  closeModal();await refresh('Exception and digital signature recorded.');
}
function showTrainingException(id){
  openModal('Sign off as exception',`<p>This bypasses normal instructor confirmation only because you created this training and assigned it to yourself. The exception is retained in the audit trail.</p><label>Exception reason<textarea id="exceptionReason" placeholder="e.g. Trainer / competent person self-completion"></textarea></label>${signatureBlock('exception')}<label class="check-row"><input id="exceptionAck" type="checkbox"> I confirm I have completed this requirement and signed this exception.</label><div class="actions">${btn('Cancel','ghost','data-close-modal')}${btn('Record exception and sign off','primary',`data-save-training-exception="${id}"`)}</div>`);
  setupSignaturePad('exceptionSignaturePad','exceptionClearSignature');
}
async function saveTrainingException(id){
  const reason=$('exceptionReason').value.trim();if(!reason)return toast('Enter an exception reason.');if(!$('exceptionAck').checked)return toast('Tick the confirmation first.');
  const sig=signatureData('exceptionSignaturePad'),sigName=$('exceptionSignatureName').value.trim();if(!sig)return toast('Please sign in the digital signature box.');if(!sigName)return toast('Enter the signature name.');
  const a=state.trainingAssignments.find(x=>x.id===id),t=state.training.find(x=>x.id===a.training_session_id);
  if(!isManager()||a.user_id!==state.user.id||t.created_by!==state.user.id)return toast('This exception is only available to the creator for their own assignment.');
  let r=await sb.from('training_delivery_confirmations').insert({assignment_id:id,user_id:state.user.id,confirmed_by:state.user.id,confirmation_type:'EXCEPTION',reason});if(r.error)return toast(r.error.message);
  r=await sb.from('training_signoffs').insert({training_assignment_id:id,training_session_id:t.id,user_id:state.user.id,statement_snapshot:'Exception completion: I confirm I completed this requirement. Instructor confirmation was waived and the exception reason is recorded.',training_name_snapshot:t.name,trainer_snapshot:t.trainer_name,delivered_date_snapshot:t.delivered_date,signature_data:sig,signature_name:sigName});if(r.error)return toast(r.error.message);
  closeModal();await refresh('Exception and digital signature recorded.');
}
function reportRows(){
  const doc=[];state.docSignoffs.forEach(s=>{const a=state.docAssignments.find(x=>x.id===s.assignment_id),c=a&&docEvents(a).find(x=>(x.attendance_status||'ATTENDED')==='ATTENDED'&&new Date(x.confirmed_at)<=new Date(s.signed_at));doc.push({person:personName(s.user_id),email:state.people.find(p=>p.id===s.user_id)?.email||'',type:'Document',title:s.title_snapshot,reference:s.reference_snapshot||'',version:s.version_snapshot,training_date:c?.delivery_date||'',signed_at:s.signed_at,signature_name:s.signature_name||'',digital_signature:s.signature_data?'Captured':'',renewal:renewalText(a?.renewal_value,a?.renewal_unit)})});
  const tr=[];state.trainingSignoffs.forEach(s=>{const a=state.trainingAssignments.find(x=>x.id===s.training_assignment_id),c=a&&trainingEvents(a).find(x=>(x.attendance_status||'ATTENDED')==='ATTENDED'&&new Date(x.confirmed_at)<=new Date(s.signed_at));tr.push({person:personName(s.user_id),email:state.people.find(p=>p.id===s.user_id)?.email||'',type:'Training',title:s.training_name_snapshot,reference:'',version:'',training_date:s.delivered_date_snapshot||c?.delivery_date||'',instructor:s.trainer_snapshot||'',signed_at:s.signed_at,signature_name:s.signature_name||'',digital_signature:s.signature_data?'Captured':'',renewal:renewalText(a?.renewal_value,a?.renewal_unit)})});return {doc,tr};
}
function outstandingRows(){
  const rows=[];state.docAssignments.filter(a=>a.active!==false).forEach(a=>{const s=latestDocSignoff(a),due=documentAssignmentDue(a,s);if(!s||(a.renewal_value&&new Date(due)<=new Date())){const v=state.versions.find(x=>x.id===a.document_version_id),d=v&&state.documents.find(x=>x.id===v.document_id);if(d)rows.push({person:personName(a.user_id),kind:'Document',item:d.title,reference:d.reference||'',version:v.version_label,due})}});
  state.trainingAssignments.filter(a=>a.active!==false).forEach(a=>{const s=latestTrainingSignoff(a),due=trainingAssignmentDue(a,s);if(!s||(a.renewal_value&&new Date(due)<=new Date())){const t=state.training.find(x=>x.id===a.training_session_id);if(t)rows.push({person:personName(a.user_id),kind:'Training',item:t.name,reference:'',version:'',due})}});
  return rows;
}

function renderHelp(){
  const box=$('helpContent');if(!box)return;
  const role=state.profile?.role||'user';
  const roleLabel=role==='admin'?'Admin':role==='manager'?'Manager':'User';

  const common=`
    <div class="section-card">
      <div class="help-role-banner"><strong>Your role: ${esc(roleLabel)}</strong><div class="muted">Only use your own login. A user's digital acknowledgement must be completed by that user.</div></div>
      <h3>How Safety Tracker works</h3>
      <div class="help-grid">
        <div class="help-card">
          <h3>My Safety</h3>
          <ul>
            <li>Shows documents and training assigned to you.</li>
            <li><strong>Actions required</strong> shows anything waiting for you.</li>
            <li><strong>Completed</strong> shows your current completed records.</li>
            <li>Due and overdue dates are shown against each assignment.</li>
          </ul>
        </div>
        <div class="help-card">
          <h3>Self-training</h3>
          <ol>
            <li>Open the assigned document or training material.</li>
            <li>Read/review it fully.</li>
            <li>If anything is unclear, ask your Manager/Admin.</li>
            <li>If you want someone to go through it with you, choose <strong>Request instructor-led support</strong>.</li>
            <li>When ready, complete your own acknowledgement and digital signature.</li>
          </ol>
        </div>
        <div class="help-card">
          <h3>Instructor-led</h3>
          <ol>
            <li>An Instructor/Admin/Manager delivers the training.</li>
            <li>They record your attendance and the actual training date.</li>
            <li>Your item changes to <strong>Ready to sign off</strong>.</li>
            <li>You then log in yourself and complete your digital signature.</li>
          </ol>
          <div class="help-tip">The instructor confirms training was delivered. They do not sign on behalf of the trainee.</div>
        </div>
        <div class="help-card">
          <h3>Digital signature</h3>
          <ul>
            <li>Enter/check the signature name.</li>
            <li>Sign in the white signature box with finger or mouse.</li>
            <li>Wait for <strong>✓ Signature captured</strong>.</li>
            <li>Tick the confirmation box.</li>
            <li>Press the final sign-off button.</li>
          </ul>
        </div>
      </div>
    </div>`;

  const userGuide=`
    <h2 class="help-section-title">User guide</h2>
    <div class="section-card">
      <div class="help-grid">
        <div class="help-card">
          <h3>What a User can do</h3>
          <ul>
            <li>View assigned documents and training.</li>
            <li>Open the exact document/training material assigned.</li>
            <li>Complete self-training acknowledgements.</li>
            <li>Request instructor-led support instead of self-training.</li>
            <li>Sign their own completed training/documents digitally.</li>
            <li>See their completed and outstanding records.</li>
          </ul>
        </div>
        <div class="help-card">
          <h3>If you need help</h3>
          <p>Do not sign something you do not understand. Ask your Manager/Admin or request instructor-led support from the assignment.</p>
          <div class="help-warning">Never use another person's account and never ask someone else to provide your digital acknowledgement.</div>
        </div>
      </div>
    </div>`;

  const managerGuide=`
    <h2 class="help-section-title">Manager guide</h2>
    <div class="section-card">
      <div class="help-grid">
        <div class="help-card">
          <h3>Documents</h3>
          <ol>
            <li>Go to <strong>Documents → New document</strong>.</li>
            <li>Choose type, delivery method, version, review date and sign-off frequency.</li>
            <li>Upload the finished controlled document.</li>
            <li>Use <strong>Assign</strong> to choose people and set a due date.</li>
            <li>Untick a person and save to remove their active assignment without deleting history.</li>
          </ol>
          <h4>New versions</h4>
          <p>Use <strong>New version</strong> and choose Keep current, Self-training or Instructor-led. Historical versions and previous evidence remain preserved.</p>
        </div>
        <div class="help-card">
          <h3>Training</h3>
          <ol>
            <li>Go to <strong>Training → New training</strong>.</li>
            <li>Choose delivery method and default completion due date.</li>
            <li>Assign the required people.</li>
            <li>For instructor-led sessions, use the <strong>Instructor</strong> screen to record attendance.</li>
          </ol>
          <h4>Group attendance</h4>
          <ol>
            <li>Open <strong>Instructor</strong>.</li>
            <li>Select the training session.</li>
            <li>Choose <strong>Select attendees</strong>.</li>
            <li>Tick everyone who attended.</li>
            <li>Enter the actual training date and save.</li>
          </ol>
          <p class="muted">People left unticked remain outstanding and can be trained later.</p>
        </div>
        <div class="help-card">
          <h3>Compliance</h3>
          <ul>
            <li>Use <strong>Compliance</strong> to see outstanding, overdue, awaiting instructor and ready-to-sign items.</li>
            <li>Filter by person, item type or status.</li>
            <li>Use <strong>Instructor</strong> for a simpler view of instructor-led work awaiting action.</li>
            <li>Use <strong>People → Safety / training record</strong> to review an individual's record.</li>
          </ul>
        </div>
        <div class="help-card">
          <h3>Evidence and reports</h3>
          <p>For an audit or evidence request, normally provide:</p>
          <ol>
            <li>The relevant source document/training material.</li>
            <li>The relevant PDF sign-off or employee record.</li>
            <li>For instructor-led training, attendance/instructor confirmation evidence.</li>
            <li>The employee's own digital signature evidence.</li>
          </ol>
          <p>Use <strong>Reports</strong> for document sign-offs, training sign-offs, training matrix, review dates and full evidence PDFs.</p>
        </div>
      </div>
    </div>`;

  const adminGuide=`
    <h2 class="help-section-title">Admin guide</h2>
    <div class="section-card">
      <div class="help-grid">
        <div class="help-card">
          <h3>People and roles</h3>
          <ul>
            <li>Invite new users from <strong>People</strong>.</li>
            <li>Set roles: User, Manager or Admin.</li>
            <li>Disable a user rather than deleting them so historical evidence remains intact.</li>
            <li>Re-enable a disabled user if needed later.</li>
          </ul>
        </div>
        <div class="help-card">
          <h3>Admin backup</h3>
          <ul>
            <li><strong>Download JSON backup</strong> creates a database-only backup.</li>
            <li><strong>Full backup ZIP</strong> includes database data plus uploaded safety/training files.</li>
            <li>Create a fresh full backup before major system/database changes.</li>
            <li>Use <strong>Admin → Bulk Import</strong> for section PDF packs. Always check the preview before importing.</li>
          </ul>
        </div>
        <div class="help-card">
          <h3>Creator exception</h3>
          <p>If an Admin/Manager created an instructor-led item and assigned it to themselves, the creator exception can be used when appropriate.</p>
          <ul>
            <li>A reason is required.</li>
            <li>The creator still provides a digital signature.</li>
            <li>The exception is retained in the evidence trail.</li>
          </ul>
          <div class="help-warning">Use the exception only where it genuinely reflects the competent person's own completion/review. It should not be used to bypass normal trainee acknowledgement.</div>
        </div>
        <div class="help-card">
          <h3>Good administration</h3>
          <ul>
            <li>Keep document versions, review dates and training frequencies current.</li>
            <li>SDS/MSDS is reference-only: keep the manufacturer revision current, but do not assign it for acknowledgement or signed review.</li>
            <li>Complete document reviews using <strong>Record signed review</strong>. The system records reviewer, timestamp, outcome, note, next review date and digital signature.</li>
            <li>Version details also show who uploaded each file and when.</li>
            <li>Use new versions instead of overwriting historical evidence.</li>
            <li>Check overdue and review-due reports regularly.</li>
            <li>Keep the source RA/COSHH/SSW/training material available with the sign-off evidence.</li>
          </ul>
        </div>
      </div>
    </div>`;

  let html=common+userGuide;
  if(role==='manager'||role==='admin')html+=managerGuide;
  if(role==='admin')html+=adminGuide;

  box.innerHTML=html;
}

function renderReports(){const out=outstandingRows(),reviews=[...state.versions.filter(v=>v.status==='CURRENT'&&v.review_date),...state.training.filter(t=>t.status==='ACTIVE'&&t.review_date)],rc=reviewAlertCounts(),dueSoon=complianceRows().filter(r=>r.statusCode==='DUE_SOON').length;$('reportStats').innerHTML=stat(out.length,'Outstanding')+stat(out.filter(r=>r.due&&new Date(r.due)<new Date()).length,'Overdue')+stat(dueSoon,'Renewals due ≤30d')+stat(rc.dueSoon,'Reviews due ≤30d')+stat(rc.overdue,'Reviews overdue')+stat(state.docSignoffs.length+state.trainingSignoffs.length,'Sign-offs recorded');}
function csvEscape(v){return `"${String(v??'').replaceAll('"','""')}"`}
function downloadCSV(name,rows){if(!rows.length)return toast('No rows to export.');const keys=Object.keys(rows[0]);const csv=[keys.map(csvEscape).join(','),...rows.map(r=>keys.map(k=>csvEscape(r[k])).join(','))].join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});downloadBlob(blob,name)}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function downloadReport(type){
  const {doc,tr}=reportRows();
  if(type==='outstanding')return downloadPDFTable('Outstanding Safety / Training Actions',outstandingRows().map(r=>({...r,due:fmtDateTime(r.due)})),`safety-outstanding-${todayISO()}.pdf`);
  if(type==='document-signoffs')return downloadSignoffPDF('DOCUMENT');
  if(type==='training-signoffs')return downloadSignoffPDF('TRAINING');
  if(type==='training-matrix')return downloadPDFTable('Training Matrix',evidenceRows().filter(r=>r.kind==='TRAINING'),`training-matrix-${todayISO()}.pdf`);
  if(type==='reviews')return downloadPDFTable('Document and Training Review Dates',reviewRows(),`review-dates-${todayISO()}.pdf`);
  if(type==='document-reviews')return downloadDocumentReviewsPDF();
}
async function downloadBackup(){const payload={exported_at:new Date().toISOString(),profiles:state.people,documents:state.documents,document_versions:state.versions,document_assignments:state.docAssignments,document_signoffs:state.docSignoffs,document_delivery_confirmations:state.docConfirmations,document_links:state.documentLinks,document_reviews:state.documentReviews,training_sessions:state.training,training_assignments:state.trainingAssignments,training_signoffs:state.trainingSignoffs,training_delivery_confirmations:state.trainingConfirmations,training_files:state.trainingFiles};downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),`safety-tracker-backup-${todayISO()}.json`)}


function evidenceRows(){
  return complianceRows().map(r=>({person:personName(r.user_id),email:state.people.find(p=>p.id===r.user_id)?.email||'',kind:r.kind,item:r.kind==='DOCUMENT'?r.item.title:r.item.name,reference:r.kind==='DOCUMENT'?(r.item.reference||''):'',version:r.kind==='DOCUMENT'?r.version.version_label:'',delivery_method:deliveryText(r.method),status:r.statusLabel,due:r.due?fmtDateTime(r.due):'',training_date:r.confirmation?.delivery_date||'',last_signed:r.signoff?fmtDateTime(r.signoff.signed_at):''}));
}
function attendanceEvidenceRows(){
  const doc=state.docConfirmations.map(c=>({kind:'Document / SSW',person:personName(c.user_id),confirmed_by:personName(c.confirmed_by),training_date:c.delivery_date||'',attendance:c.attendance_status||'ATTENDED',confirmed_at:fmtDateTime(c.confirmed_at),reason:c.reason||'',type:c.confirmation_type||'INSTRUCTOR'}));
  const tr=state.trainingConfirmations.map(c=>({kind:'Training',person:personName(c.user_id),confirmed_by:personName(c.confirmed_by),training_date:c.delivery_date||'',attendance:c.attendance_status||'ATTENDED',confirmed_at:fmtDateTime(c.confirmed_at),reason:c.reason||'',type:c.confirmation_type||'INSTRUCTOR'}));
  return [...doc,...tr];
}

function documentReviewEvidenceRows(){
  return state.documentReviews
    .slice()
    .sort((a,b)=>new Date(b.reviewed_at)-new Date(a.reviewed_at))
    .map(r=>({
      title:r.title_snapshot||'',
      reference:r.reference_snapshot||'',
      version:r.version_snapshot||'',
      uploaded_by:personName(state.versions.find(v=>v.id===r.document_version_id)?.created_by),
      uploaded_at:fmtDateTime(state.versions.find(v=>v.id===r.document_version_id)?.created_at),
      reviewed_by:personName(r.reviewer_id),
      reviewed_at:fmtDateTime(r.reviewed_at),
      outcome:reviewOutcomeLabel(r.outcome),
      next_review:r.next_review_date?fmtDate(r.next_review_date):'',
      review_note:r.review_note||'',
      digital_signature:r.signature_data?'Captured':''
    }));
}

function addDocumentReviewSignaturePages(doc,title,rows,useCurrentPage=false){
  if(!useCurrentPage)doc.addPage('a4','landscape');
  const pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight();
  const left=14,right=14,signatureW=70,signatureH=25;
  let y=18;
  doc.setFontSize(16);doc.text(title,left,y);y+=9;

  if(!rows.length){doc.setFontSize(10);doc.text('No signed document reviews.',left,y+3);return;}

  rows.forEach(r=>{
    const blockH=52;
    if(y+blockH>pageH-15){
      doc.addPage('a4','landscape');
      y=18;doc.setFontSize(16);doc.text(title,left,y);y+=9;
    }
    doc.setDrawColor(190);doc.roundedRect(left,y-4,pageW-left-right,blockH,2,2,'S');
    doc.setFontSize(10);doc.setFont('helvetica','bold');
    doc.text(`${r.title_snapshot||''} - Version ${r.version_snapshot||''}`,left+4,y+3);
    doc.setFont('helvetica','normal');doc.setFontSize(8);

    const v=state.versions.find(x=>x.id===r.document_version_id);
    const details=[
      r.reference_snapshot?`Reference: ${r.reference_snapshot}`:'',
      `Uploaded by: ${personName(v?.created_by)} | ${fmtDateTime(v?.created_at)}`,
      `Reviewed by: ${personName(r.reviewer_id)} | ${fmtDateTime(r.reviewed_at)}`,
      `Outcome: ${reviewOutcomeLabel(r.outcome)}`,
      r.next_review_date?`Next review: ${fmtDate(r.next_review_date)}`:'',
      r.review_note?`Note: ${r.review_note}`:'',
      r.signature_name?`Signature name: ${r.signature_name}`:''
    ].filter(Boolean);

    let ty=y+10;
    for(const line of details){
      const parts=doc.splitTextToSize(String(line),pageW-left-right-signatureW-18);
      doc.text(parts,left+4,ty);
      ty+=4.1*parts.length;
      if(ty>y+44)break;
    }

    const sigX=pageW-right-signatureW-4,sigY=y+5;
    doc.setFont('helvetica','bold');doc.text('Reviewer signature',sigX,sigY-2);
    doc.setFont('helvetica','normal');doc.setFillColor(255,255,255);doc.setDrawColor(160);
    doc.rect(sigX,sigY,signatureW,signatureH,'FD');
    if(r.signature_data){
      try{doc.addImage(r.signature_data,'PNG',sigX+1,sigY+1,signatureW-2,signatureH-2);}
      catch(e){doc.text('Signature stored - image render failed',sigX+3,sigY+13);}
    }else doc.text('No signature image stored',sigX+3,sigY+13);

    y+=blockH+5;
  });
}

function downloadDocumentReviewsPDF(){
  if(!pdfReady())return toast('PDF library did not load. Refresh the page and try again.');
  try{
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    const rows=state.documentReviews.slice().sort((a,b)=>new Date(b.reviewed_at)-new Date(a.reviewed_at));
    addDocumentReviewSignaturePages(doc,'Signed Document Review Evidence',rows,true);
    stampPdfPages(doc,'Document Reviews');
    doc.save(`document-review-evidence-${todayISO()}.pdf`);
  }catch(e){
    console.error('Document review PDF failed',e);
    toast(`PDF failed: ${e?.message||'Unknown error'}`);
  }
}

function reviewRows(){
  const rows=[];state.versions.filter(v=>v.status==='CURRENT').forEach(v=>{const d=state.documents.find(x=>x.id===v.document_id);rows.push({kind:'Document',title:d?.title||'',reference:d?.reference||'',version:v.version_label,review_date:v.review_date||'',status:v.review_date&&v.review_date<todayISO()?'Overdue':v.review_date&&v.review_date<=daysFromNow(30)?'Due within 30 days':'Current'})});state.training.filter(t=>t.status==='ACTIVE').forEach(t=>rows.push({kind:'Training',title:t.name,reference:'',version:'',review_date:t.review_date||'',status:t.review_date&&t.review_date<todayISO()?'Overdue':t.review_date&&t.review_date<=daysFromNow(30)?'Due within 30 days':'Current'}));return rows;
}
function safeFileName(s){return String(s||'report').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()}
function pdfReady(){return !!(window.jspdf&&window.jspdf.jsPDF)}
function pdfLabel(k){return String(k).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}
function stampPdfPages(doc,title){
  const pages=doc.internal.getNumberOfPages(),generated=new Date().toLocaleString('en-GB');
  for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(90);doc.text(`Safety Tracker evidence copy | Generated ${generated} | Page ${i} of ${pages}`,14,doc.internal.pageSize.getHeight()-7);doc.setTextColor(0)}
}
function addPdfTable(doc,title,rows,startY=24){
  doc.setFontSize(13);doc.text(title,14,startY-5);
  if(!rows.length){doc.setFontSize(10);doc.text('No records.',14,startY+3);return startY+12}
  const keys=Object.keys(rows[0]),body=rows.map(r=>keys.map(k=>String(r[k]??'')));
  doc.autoTable({head:[keys.map(pdfLabel)],body,startY,theme:'grid',styles:{fontSize:7,cellPadding:1.6,overflow:'linebreak'},headStyles:{fontSize:7},margin:{left:10,right:10,bottom:15}});
  return (doc.lastAutoTable?.finalY||startY)+10;
}
function downloadPDFTable(title,rows,filename){
  if(!pdfReady())return toast('PDF library did not load. Refresh the page and try again.');
  const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  doc.setFontSize(16);doc.text(title,14,14);doc.setFontSize(9);doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`,14,20);
  addPdfTable(doc,'Evidence',rows,28);stampPdfPages(doc,title);doc.save(filename);
}
function documentLinkEvidenceRows(){
  return state.documentLinks.map(l=>{const s=state.documents.find(d=>d.id===l.source_document_id),t=state.documents.find(d=>d.id===l.target_document_id);return {Relationship:linkTypeLabel(l.link_type),Source_type:docTypeLabel(s?.doc_type),Source_reference:s?.reference||'',Source_document:s?.title||'',Target_type:docTypeLabel(t?.doc_type),Target_reference:t?.reference||'',Target_document:t?.title||'',Created:fmtDateTime(l.created_at)}})
}

function signoffEvidenceRows(kind,userId=null){
  if(kind==='DOCUMENT'){
    return state.docSignoffs
      .filter(s=>!userId||s.user_id===userId)
      .map(s=>{
        const a=state.docAssignments.find(x=>x.id===s.assignment_id);
        const c=a&&docEvents(a).find(x=>(x.attendance_status||'ATTENDED')==='ATTENDED'&&new Date(x.confirmed_at)<=new Date(s.signed_at));
        return {
          kind:'Document',
          person:personName(s.user_id),
          email:state.people.find(p=>p.id===s.user_id)?.email||'',
          title:s.title_snapshot||'',
          reference:s.reference_snapshot||'',
          version:s.version_snapshot||'',
          training_date:c?.delivery_date||'',
          instructor:c?personName(c.confirmed_by):'',
          signed_at:s.signed_at,
          signature_name:s.signature_name||'',
          signature_data:s.signature_data||null
        };
      });
  }
  return state.trainingSignoffs
    .filter(s=>!userId||s.user_id===userId)
    .map(s=>{
      const a=state.trainingAssignments.find(x=>x.id===s.training_assignment_id);
      const c=a&&trainingEvents(a).find(x=>(x.attendance_status||'ATTENDED')==='ATTENDED'&&new Date(x.confirmed_at)<=new Date(s.signed_at));
      return {
        kind:'Training',
        person:personName(s.user_id),
        email:state.people.find(p=>p.id===s.user_id)?.email||'',
        title:s.training_name_snapshot||'',
        reference:'',
        version:'',
        training_date:s.delivered_date_snapshot||c?.delivery_date||'',
        instructor:s.trainer_snapshot||(c?personName(c.confirmed_by):''),
        signed_at:s.signed_at,
        signature_name:s.signature_name||'',
        signature_data:s.signature_data||null
      };
    });
}

function addSignatureEvidencePages(doc,title,rows,useCurrentPage=false){
  if(!useCurrentPage)doc.addPage('a4','landscape');

  const pageW=doc.internal.pageSize.getWidth();
  const pageH=doc.internal.pageSize.getHeight();
  const left=14,right=14;
  const signatureW=70,signatureH=25;
  let y=18;

  doc.setFontSize(16);doc.text(title,left,y);y+=9;

  if(!rows.length){
    doc.setFontSize(10);doc.text('No signed records.',left,y+3);
    return;
  }

  rows.forEach(r=>{
    const blockH=48;
    if(y+blockH>pageH-15){
      doc.addPage('a4','landscape');
      y=18;
      doc.setFontSize(16);doc.text(title,left,y);y+=9;
    }

    doc.setDrawColor(190);
    doc.roundedRect(left,y-4,pageW-left-right,blockH,2,2,'S');

    doc.setFontSize(10);
    doc.setFont('helvetica','bold');
    doc.text(`${r.person} - ${r.title}`,left+4,y+3);
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);

    const details=[
      `Type: ${r.kind}`,
      r.reference?`Reference: ${r.reference}`:'',
      r.version?`Version: ${r.version}`:'',
      r.training_date?`Training date: ${fmtDate(r.training_date)}`:'',
      r.instructor?`Instructor: ${r.instructor}`:'',
      `Signed: ${fmtDateTime(r.signed_at)}`,
      r.signature_name?`Signature name: ${r.signature_name}`:''
    ].filter(Boolean);

    let ty=y+10;
    for(const line of details){doc.text(String(line),left+4,ty);ty+=4.2;}

    const sigX=pageW-right-signatureW-4;
    const sigY=y+5;
    doc.setFont('helvetica','bold');
    doc.text('Digital signature',sigX,sigY-2);
    doc.setFont('helvetica','normal');
    doc.setFillColor(255,255,255);
    doc.setDrawColor(160);
    doc.rect(sigX,sigY,signatureW,signatureH,'FD');

    if(r.signature_data){
      try{
        doc.addImage(r.signature_data,'PNG',sigX+1,sigY+1,signatureW-2,signatureH-2);
      }catch(e){
        console.error('PDF signature image error',e);
        doc.text('Signature stored - image render failed',sigX+3,sigY+13);
      }
    }else{
      doc.text('No signature image stored',sigX+3,sigY+13);
    }

    y+=blockH+5;
  });
}
function downloadSignoffPDF(kind){
  if(!pdfReady())return toast('PDF library did not load. Refresh the page and try again.');
  try{
    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    const rows=signoffEvidenceRows(kind);
    const title=kind==='DOCUMENT'?'Document Sign-offs - Signature Evidence':'Training Sign-offs - Signature Evidence';

    // Use the PDF's first page rather than deleting it. Deleting the only page
    // caused the sign-off PDF button to fail on some mobile browsers.
    addSignatureEvidencePages(doc,title,rows,true);
    stampPdfPages(doc,kind==='DOCUMENT'?'Document Sign-offs':'Training Sign-offs');
    doc.save(kind==='DOCUMENT'?`document-signoffs-${todayISO()}.pdf`:`training-signoffs-${todayISO()}.pdf`);
  }catch(e){
    console.error('Sign-off PDF failed',e);
    toast(`PDF failed: ${e?.message||'Unknown error'}`);
  }
}
function addPersonSignaturePages(doc,userId){
  const docs=signoffEvidenceRows('DOCUMENT',userId);
  const training=signoffEvidenceRows('TRAINING',userId);
  if(docs.length)addSignatureEvidencePages(doc,'Document Signatures',docs);
  if(training.length)addSignatureEvidencePages(doc,'Training Signatures',training);
}

function downloadEvidencePDF(){
  if(!pdfReady())return toast('PDF library did not load. Refresh the page and try again.');
  const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'}),{doc:docSigns,tr}=reportRows();
  const sections=[
    ['Compliance',evidenceRows()],
    ['Document Sign-offs',docSigns.map(r=>({...r,signed_at:fmtDateTime(r.signed_at)}))],
    ['Training Sign-offs',tr.map(r=>({...r,signed_at:fmtDateTime(r.signed_at)}))],
    ['Instructor / Attendance Events',attendanceEvidenceRows()],
    ['Review Dates',reviewRows()],
    ['Signed Document Review History',documentReviewEvidenceRows()],
    ['Document Links',documentLinkEvidenceRows()]
  ];
  doc.setFontSize(17);doc.text('Safety Tracker - Full Evidence Report',14,14);doc.setFontSize(9);doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`,14,20);
  let first=true;
  for(const [title,rows] of sections){
    if(!first)doc.addPage('a4','landscape');
    first=false;
    addPdfTable(doc,title,rows,18);
  }

  // Add the actual stored signature images as evidence pages.
  addSignatureEvidencePages(doc,'Document Signature Evidence',signoffEvidenceRows('DOCUMENT'));
  addSignatureEvidencePages(doc,'Training Signature Evidence',signoffEvidenceRows('TRAINING'));
  addDocumentReviewSignaturePages(doc,'Signed Document Review Evidence',state.documentReviews.slice().sort((a,b)=>new Date(b.reviewed_at)-new Date(a.reviewed_at)));

  stampPdfPages(doc,'Full Evidence Report');
  doc.save(`safety-evidence-${todayISO()}.pdf`);
}
async function listStorageRecursive(prefix=''){
  const out=[];let offset=0;
  while(true){const {data,error}=await sb.storage.from('safety-files').list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}});if(error)throw error;if(!data?.length)break;
    for(const item of data){const path=prefix?`${prefix}/${item.name}`:item.name;if(item.id)out.push(path);else out.push(...await listStorageRecursive(path))}
    if(data.length<100)break;offset+=100;
  }return out;
}
async function downloadFullBackup(){
  if(typeof JSZip==='undefined')return toast('ZIP library did not load. Use JSON backup for now.');
  try{
    toast('Building full backup…');
    const zip=new JSZip(),payload={exported_at:new Date().toISOString(),profiles:state.people,documents:state.documents,document_versions:state.versions,document_assignments:state.docAssignments,document_signoffs:state.docSignoffs,document_delivery_confirmations:state.docConfirmations,document_links:state.documentLinks,document_reviews:state.documentReviews,training_sessions:state.training,training_assignments:state.trainingAssignments,training_signoffs:state.trainingSignoffs,training_delivery_confirmations:state.trainingConfirmations,training_files:state.trainingFiles};
    zip.file('database/safety-tracker.json',JSON.stringify(payload,null,2));
    const files=await listStorageRecursive('');
    for(const path of files){const {data,error}=await sb.storage.from('safety-files').download(path);if(!error&&data)zip.file(`files/${path}`,data)}
    const blob=await zip.generateAsync({type:'blob'});downloadBlob(blob,`safety-tracker-full-backup-${todayISO()}.zip`);toast(`Full backup created (${files.length} files).`);
  }catch(e){toast(e.message||'Full backup failed.');}
}

async function refresh(msg){await loadAll();renderMySafety();renderDocuments();renderTraining();if(isManager()){renderPeople();renderCompliance();renderInstructor();renderReports()}if(msg)toast(msg)}
async function globalClick(e){const el=e.target.closest('button');if(!el)return;if(el.dataset.closeModal!==undefined)return closeModal();if(el.dataset.createDocument!==undefined)return createDocumentRecord();if(el.id==='saveNewPassword'){const {error}=await sb.auth.updateUser({password:$('newPassword').value});if(error)return toast(error.message);closeModal();toast('Password updated.');return}if(el.id==='saveTraining')return saveTraining();if(el.id==='sendInvite')return sendInvite();if(el.dataset.openDoc)return openDocument(el.dataset.openDoc);if(el.dataset.signDoc)return signDocument(el.dataset.signDoc);if(el.dataset.confirmSignDoc)return confirmSignDocument(el.dataset.confirmSignDoc);if(el.dataset.assignDoc)return showAssignDocument(el.dataset.assignDoc);if(el.dataset.saveDocAssignment)return saveDocAssignments(el.dataset.saveDocAssignment);if(el.dataset.newVersion)return showNewVersion(el.dataset.newVersion);if(el.dataset.publishVersion)return publishVersion(el.dataset.publishVersion);if(el.dataset.docDetails)return showDocDetails(el.dataset.docDetails);if(el.dataset.docLinks)return showDocumentLinks(el.dataset.docLinks);if(el.dataset.addDocLink)return addDocumentLink(el.dataset.addDocLink);if(el.dataset.removeDocLink)return removeDocumentLink(el.dataset.removeDocLink);if(el.dataset.recordDocReview)return showDocumentReview(el.dataset.recordDocReview);
if(el.dataset.saveDocReview)return saveDocumentReview(el.dataset.saveDocReview);
if(el.dataset.viewDocReview)return showDocumentReviewEvidence(el.dataset.viewDocReview);
if(el.dataset.clearReview)return showDocumentReview(el.dataset.clearReview);if(el.dataset.toggleDoc)return toggleDocument(el.dataset.toggleDoc);if(el.dataset.viewTraining)return showTrainingDetails(el.dataset.viewTraining);if(el.dataset.openTrainingFile)return openTrainingFile(el.dataset.openTrainingFile);if(el.dataset.assignTraining)return showAssignTraining(el.dataset.assignTraining);if(el.dataset.saveTrainingAssignment)return saveTrainingAssignments(el.dataset.saveTrainingAssignment);if(el.dataset.requestDocInstructor)return showRequestDocumentInstructor(el.dataset.requestDocInstructor);if(el.dataset.saveRequestDocInstructor)return saveRequestDocumentInstructor(el.dataset.saveRequestDocInstructor);if(el.dataset.requestTrainingInstructor)return showRequestTrainingInstructor(el.dataset.requestTrainingInstructor);if(el.dataset.saveRequestTrainingInstructor)return saveRequestTrainingInstructor(el.dataset.saveRequestTrainingInstructor);if(el.dataset.signTraining)return signTraining(el.dataset.signTraining);if(el.dataset.confirmSignTraining)return confirmSignTraining(el.dataset.confirmSignTraining);if(el.dataset.confirmDocInstructor)return showConfirmDocumentInstructor(el.dataset.confirmDocInstructor);if(el.dataset.saveDocConfirm)return saveDocumentInstructorConfirmation(el.dataset.saveDocConfirm);if(el.dataset.confirmTrainingInstructor)return showConfirmTrainingInstructor(el.dataset.confirmTrainingInstructor);if(el.dataset.bulkTrainingAttendance)return showBulkTrainingAttendance(el.dataset.bulkTrainingAttendance);if(el.dataset.saveGroupTraining)return saveInstructorGroupAttendance(el.dataset.saveGroupTraining);if(el.dataset.saveBulkTraining)return saveBulkTrainingAttendance(el.dataset.saveBulkTraining);if(el.dataset.saveTrainingConfirm)return saveTrainingInstructorConfirmation(el.dataset.saveTrainingConfirm);if(el.dataset.docException)return showDocumentException(el.dataset.docException);if(el.dataset.saveDocException)return saveDocumentException(el.dataset.saveDocException);if(el.dataset.trainingException)return showTrainingException(el.dataset.trainingException);if(el.dataset.saveTrainingException)return saveTrainingException(el.dataset.saveTrainingException);if(el.dataset.archiveTraining)return archiveTraining(el.dataset.archiveTraining);if(el.dataset.setRole)return showSetRole(el.dataset.setRole);if(el.dataset.saveRole)return saveRole(el.dataset.saveRole);if(el.dataset.toggleUser)return toggleUser(el.dataset.toggleUser);if(el.dataset.personRecord)return showPersonRecord(el.dataset.personRecord);if(el.dataset.personRecordPdf)return downloadPersonRecord(el.dataset.personRecordPdf);}

init();
