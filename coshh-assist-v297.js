/* Safety Tracker COSHH Assist v2.9.7 overlay
   Designed to sit on top of the current Safety Tracker build without changing database schema.
   Features: next reference suggestion, editable override, people-exposed dropdown, local SDS PDF analysis,
   found/missing review summary, and SSW/TBT recommendation prompts.
*/
(()=>{
'use strict';
const PATCH_VERSION='2.9.7';
const PATCH_ID='coshh-assist-v297-20260913';
const TYPE_PREFIX={RISK_ASSESSMENT:'RA',RA:'RA',COSHH:'COSHH',SSW:'SSW',SDS:'MSDS',MSDS:'MSDS',TOOLBOX_TALK:'TBT',TBT:'TBT'};
const PEOPLE_DEFAULTS=['Maintenance staff','Maintenance staff; guests excluded','Maintenance staff; contractors/others kept clear','Colleagues','Visitors / Guests','Contractors','Colleagues; Visitors / Guests'];
let lastPdfText='';
let lastAnalysis=null;
const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>[...r.querySelectorAll(s)];
const text=n=>String(n?.textContent||'').replace(/\s+/g,' ').trim();
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function appState(){return window.SafetyTrackerV2?.state||window.SafetyTracker?.state||window.state||null}
function toast(msg){if(typeof window.toast==='function')return window.toast(msg);const t=q('#toast');if(t){t.textContent=msg;t.hidden=false;setTimeout(()=>t.hidden=true,4500)}else console.log('[COSHH Assist]',msg)}
function labels(root=document){return qa('label',root)}
function fieldByLabel(rx,root=document){
  for(const l of labels(root)){if(rx.test(text(l))){const f=q('input:not([type=checkbox]):not([type=radio]), textarea, select',l);if(f)return f}}
  const all=qa('input:not([type=checkbox]):not([type=radio]), textarea, select',root);
  for(const f of all){const id=f.id;const l=id?q(`label[for="${CSS.escape(id)}"]`,root):null;if(l&&rx.test(text(l)))return f}
  return null;
}
function modalRoot(){return q('dialog[open]')||q('.modal[open]')||q('#modal[open]')||q('.modal-backdrop:not([hidden])')||document}
function normaliseType(v){const x=String(v||'').toUpperCase();if(x.includes('SAFETY DATA')||x.includes('MSDS')||x==='SDS')return 'SDS';if(x.includes('COSHH'))return 'COSHH';if(x.includes('RISK')||x==='RA')return 'RISK_ASSESSMENT';if(x.includes('SAFE SYSTEM')||x==='SSW')return 'SSW';if(x.includes('TOOLBOX')||x==='TBT')return 'TOOLBOX_TALK';return x}
function prefixFor(v){return TYPE_PREFIX[normaliseType(v)]||''}
function referencesForPrefix(prefix){
 const st=appState();const refs=[];
 (st?.documents||[]).forEach(d=>refs.push(d.reference,d.ref,d.document_reference));
 (st?.training||[]).forEach(d=>refs.push(d.reference,d.ref));
 return refs.filter(Boolean).map(x=>String(x).toUpperCase()).filter(x=>x.startsWith(prefix+'-'));
}
function nextReference(prefix){
 const used=new Set(referencesForPrefix(prefix).map(r=>Number((r.match(/(\d{1,4})$/)||[])[1])).filter(Number.isFinite));
 let n=1;while(used.has(n))n++;return `${prefix}-${String(n).padStart(3,'0')}`;
}
function enhanceReference(root){
 const ref=fieldByLabel(/^Reference\b/i,root), type=fieldByLabel(/^Type\b/i,root);if(!ref||!type)return;
 if(!ref.dataset.referenceAssist){
   ref.dataset.referenceAssist='1';ref.dataset.autoSuggested='';
   const hint=document.createElement('div');hint.className='coshh-assist-hint';hint.innerHTML='<strong>Suggested reference:</strong> <span data-next-ref>—</span> <button type="button" class="coshh-mini" data-use-next-ref>Use suggestion</button><br><span>Editable — you can overwrite the number before saving.</span>';
   ref.parentElement?.appendChild(hint);
   hint.querySelector('[data-use-next-ref]')?.addEventListener('click',()=>{const p=prefixFor(type.options?.[type.selectedIndex]?.text||type.value);if(!p)return;ref.value=nextReference(p);ref.dataset.autoSuggested=ref.value;ref.dispatchEvent(new Event('input',{bubbles:true}))});
 }
 const refresh=()=>{const p=prefixFor(type.options?.[type.selectedIndex]?.text||type.value);if(!p)return;const n=nextReference(p),span=root.querySelector('[data-next-ref]');if(span)span.textContent=n;if(!clean(ref.value)||ref.value===ref.dataset.autoSuggested){ref.value=n;ref.dataset.autoSuggested=n;ref.dispatchEvent(new Event('input',{bubbles:true}))}};
 if(!type.dataset.referenceAssist){type.dataset.referenceAssist='1';type.addEventListener('change',refresh)}
 refresh();
}
function enhancePeople(root){
 const f=fieldByLabel(/People exposed|who performs it/i,root);if(!f||f.dataset.peopleAssist)return;f.dataset.peopleAssist='1';
 if(f.tagName==='INPUT'){const list=document.createElement('datalist');list.id='coshhPeopleOptions';const existing=new Set(PEOPLE_DEFAULTS);try{JSON.parse(localStorage.getItem('safetyTrackerPeopleExposedOptions')||'[]').forEach(x=>existing.add(x))}catch{}
 list.innerHTML=[...existing].sort().map(x=>`<option value="${esc(x)}"></option>`).join('');document.body.appendChild(list);f.setAttribute('list',list.id);f.placeholder='Select a common option or type a new one';
 f.addEventListener('change',()=>{const v=clean(f.value);if(!v)return;let a=[];try{a=JSON.parse(localStorage.getItem('safetyTrackerPeopleExposedOptions')||'[]')}catch{};if(!a.includes(v)){a.push(v);localStorage.setItem('safetyTrackerPeopleExposedOptions',JSON.stringify(a.slice(-50)))}})
 }
 const hint=document.createElement('div');hint.className='coshh-assist-hint';hint.textContent='Choose an existing COSHH-style entry or type a new one. New entries are remembered on this device.';f.parentElement?.appendChild(hint);
}
async function pdfText(file){
 if(!file)throw new Error('Choose or link an SDS/MSDS PDF first.');if(!window.pdfjsLib)throw new Error('PDF reader is not available. Refresh while online and try again.');
 const buf=await file.arrayBuffer();const pdf=await window.pdfjsLib.getDocument({data:buf}).promise;let out='';for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i),c=await p.getTextContent();out+='\n'+c.items.map(x=>x.str).join(' ')}return out;
}
function section(t,n,next=n+1){const rx=new RegExp(`SECTION\\s*${n}\\s*:?([\\s\\S]*?)(?=SECTION\\s*${next}\\s*:|$)`,'i'),m=t.match(rx);return clean(m?.[1]||'')}
function sentences(s,limit=900){s=clean(s);if(s.length<=limit)return s;return s.slice(0,limit).replace(/\s+\S*$/,'')+'…'}
function analyse(text){
 const s2=section(text,2,3),s4=section(text,4,5),s5=section(text,5,6),s6=section(text,6,7),s7=section(text,7,8),s8=section(text,8,9),s11=section(text,11,12),s13=section(text,13,14),s1=section(text,1,2);
 const product=(s1.match(/(?:Product name|Product identifier|Trade name)\s*:?\s*([^.;]{3,120})/i)||[])[1]||'';
 const hazardBits=[];(s2.match(/H\d{3}[^H]{0,180}/g)||[]).slice(0,8).forEach(x=>hazardBits.push(clean(x)));
 const ppe=[];if(/glove|hand protection|nitrile|neoprene|rubber/i.test(s8))ppe.push('Protective gloves as specified in SDS Section 8');if(/goggle|eye protection|safety glasses|face shield/i.test(s8))ppe.push('Eye/face protection where exposure or splashing is possible');if(/respir|mask|filter|RPE/i.test(s8))ppe.push('Respiratory protection where Section 8 conditions require it');if(/protective clothing|overall|apron|footwear/i.test(s8))ppe.push('Suitable protective clothing/footwear');
 const exposure=[];if(/inhal/i.test(s2+' '+s11+' '+s8))exposure.push('inhalation');if(/skin|dermal/i.test(s2+' '+s11+' '+s8))exposure.push('skin');if(/eye/i.test(s2+' '+s11+' '+s8))exposure.push('eyes');if(/ingest|oral/i.test(s2+' '+s11))exposure.push('ingestion');
 const flammable=/flammable|H22[2456]|aerosol|ignition/i.test(s2+' '+s5+' '+s7), corrosive=/corros|H31[48]/i.test(s2), sensit=/sensiti[sz]|H317|H334/i.test(s2+' '+s11), acute=/toxic|H30[0-3]|H31[01]|H33[01]/i.test(s2);
 const sswRecommended=!!(flammable||corrosive||sensit||acute||/spray|aerosol|mixing|dilut|decant|immersion|fuel|solvent/i.test(s7+' '+s8));
 const tbtRecommended=!!(sswRecommended&&(/daily|weekly|frequent|spray|aerosol|flammable|corros|sensiti[sz]/i.test(text)));
 return {product:clean(product),hazards:sentences(hazardBits.join('; ')||s2,800),ppe:ppe.join('; ')||sentences(s8,700),emergency:sentences([s4&&'First aid: '+s4,s5&&'Fire: '+s5,s6&&'Spill: '+s6].filter(Boolean).join(' | '),1200),controls:sentences([s7,s8].filter(Boolean).join(' '),1000),method:sentences(s7,900),use:sentences((s1.match(/Relevant identified uses[^:]*:?\s*([\s\S]{0,350}?)(?=1\.3|Details of the supplier|$)/i)||[])[1]||s7,500),exposure:exposure.length?`${exposure.join(', ')}. Ventilation/PPE controls: ${sentences(s8,600)}`:sentences(s8,700),disposal:sentences(s13,500),sswRecommended,tbtRecommended};
}
function setField(root,rx,value){if(!clean(value))return false;const f=fieldByLabel(rx,root);if(!f)return false;if(!clean(f.value)){f.value=value;f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}));f.dataset.coshhFound='1';return true}return false}
function findPdfFile(root){const inputs=qa('input[type=file]',root);for(const i of inputs){const f=i.files?.[0];if(f&&/pdf/i.test(f.type||f.name))return f}return null}
function analysisPanel(root,a){let panel=root.querySelector('#coshhAnalysisSummary');if(!panel){panel=document.createElement('div');panel.id='coshhAnalysisSummary';panel.className='coshh-analysis-panel';const body=q('#modalBody',root)||root;body.insertBefore(panel,body.firstChild)}
 const found=[['Product',a.product],['Hazards',a.hazards],['PPE',a.ppe],['Emergency / spill / first aid',a.emergency],['Handling / controls',a.controls],['Exposure / ventilation',a.exposure]].filter(x=>clean(x[1]));
 panel.innerHTML=`<h4>SDS/MSDS analysis</h4><div class="coshh-found"><strong>Found in file:</strong>${found.length?`<ul>${found.map(x=>`<li><strong>${esc(x[0])}:</strong> ${esc(sentences(x[1],220))}</li>`).join('')}</ul>`:' nothing reliable was extracted.'}</div><div class="coshh-review"><strong>Still review / complete manually:</strong> frequency, typical duration, quantity, people exposed, exact site method and any controls that depend on how the product is actually used.</div><div class="coshh-recommend"><strong>SSW:</strong> ${a.sswRecommended?'Recommended — review and create unless you decide an existing SSW already covers the task.':'Not automatically required from the SDS alone; you can override and create one.'}<br><strong>Toolbox Talk:</strong> ${a.tbtRecommended?'Recommended for this hazard/use profile — can be overridden.':'Not automatically required from the SDS alone; you can override and create one.'}</div>`;
}
async function runAnalysis(root){const file=findPdfFile(root);if(!file)throw new Error('Choose the SDS/MSDS PDF in this form first.');const btn=root.querySelector('[data-coshh-read]');if(btn){btn.disabled=true;btn.textContent='Reading SDS…'}try{lastPdfText=await pdfText(file);lastAnalysis=analyse(lastPdfText);setField(root,/PPE required/i,lastAnalysis.ppe);setField(root,/Emergency|stop-work/i,lastAnalysis.emergency);setField(root,/Existing controls/i,lastAnalysis.controls);setField(root,/Safe method|key steps/i,lastAnalysis.method);setField(root,/How is the substance used/i,lastAnalysis.use);setField(root,/Exposure routes|ventilation/i,lastAnalysis.exposure);setField(root,/Hazards?/i,lastAnalysis.hazards);analysisPanel(root,lastAnalysis);toast('SDS read. Suggestions inserted where fields were blank — review everything before generating.')}finally{if(btn){btn.disabled=false;btn.textContent='Read / analyse linked SDS'}}}
function enhanceSdsAnalysis(root){
 const hasCoshh=/PPE required|How is the substance used|People exposed|Safe method \/ key steps/i.test(text(root));if(!hasCoshh)return;
 if(root.querySelector('[data-coshh-read]'))return;
 const file=qa('input[type=file]',root).find(i=>/PDF|file|SDS|MSDS/i.test(text(i.parentElement))||i.accept?.includes('pdf'));
 const anchor=file?.parentElement||root.querySelector('form')||root;
 const box=document.createElement('div');box.className='coshh-assist-box';box.innerHTML='<strong>Linked SDS/MSDS</strong><p>Choose/link the SDS first, then read it. Safety Tracker will fill only fields it can support from the file and will show what still needs your input.</p><button type="button" class="secondary" data-coshh-read>Read / analyse linked SDS</button>';
 anchor.parentElement?.insertBefore(box,anchor.nextSibling);
 box.querySelector('[data-coshh-read]').addEventListener('click',()=>runAnalysis(root).catch(e=>toast(e.message||String(e))));
}
function addRecommendationControls(root){if(!/Create|COSHH|SSW|Toolbox/i.test(text(root)))return;if(root.querySelector('#coshhCreateRecommendations'))return;const hasCreator=/PPE required|Safe method|People exposed/i.test(text(root));if(!hasCreator)return;const box=document.createElement('div');box.id='coshhCreateRecommendations';box.className='coshh-assist-box';box.innerHTML='<strong>Related document decision</strong><p>After the SDS is read, the app gives an SSW/TBT recommendation. You remain in control.</p><label class="check-row"><input type="checkbox" id="coshhOverrideSSW"> Create / require an SSW (manual override)</label><label class="check-row"><input type="checkbox" id="coshhOverrideTBT"> Create / require a Toolbox Talk (manual override)</label><p class="coshh-assist-hint">These override choices are advisory in this overlay and do not replace your final review/approval.</p>';root.appendChild(box)}
function enhance(root=modalRoot()){try{enhanceReference(root);enhancePeople(root);enhanceSdsAnalysis(root);addRecommendationControls(root)}catch(e){console.warn('[COSHH Assist] enhance failed',e)}}
const obs=new MutationObserver(()=>enhance(modalRoot()));obs.observe(document.documentElement,{childList:true,subtree:true});document.addEventListener('change',()=>setTimeout(()=>enhance(modalRoot()),0),true);document.addEventListener('click',()=>setTimeout(()=>enhance(modalRoot()),0),true);
setTimeout(()=>enhance(modalRoot()),500);
window.SafetyTrackerCoshhAssist={version:PATCH_VERSION,build:PATCH_ID,analyse,pdfText,nextReference,enhance,get lastAnalysis(){return lastAnalysis}};
})();
