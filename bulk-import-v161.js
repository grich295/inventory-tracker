/* Safety Tracker v1.6.1 - bulk importer with automatic content change detection */
(() => {
'use strict';
const B={sources:[],items:[],busy:false};
const $b=id=>document.getElementById(id);
const today=()=>new Date().toISOString().slice(0,10);
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const safe=s=>clean(s).replace(/[<>:"/\\|?*]+/g,'-').replace(/\s+/g,' ').slice(0,120)||'document';
const escB=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const uniq=a=>[...new Set(a.filter(Boolean))];
const refPattern=/\b(?:RA|COSHH|SSW|PROC|TBT)-\d{3}\b/gi;

function normaliseFingerprintText(s){
  return String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
}
async function sha256Text(s){
  const bytes=new TextEncoder().encode(normaliseFingerprintText(s));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function textHashFromPdfBlob(blob){
  const ab=await blob.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:ab.slice(0)}).promise;
  const text=[];
  for(let p=1;p<=pdf.numPages;p++){
    const pg=await pdf.getPage(p),content=await pg.getTextContent();
    text.push(pageLines(content).join(' '));
  }
  const joined=text.join(' ');
  return normaliseFingerprintText(joined)?await sha256Text(joined):null;
}
function comparisonLabel(status){
  return ({NEW:'New',UNCHANGED:'Unchanged',CHANGED:'Changed',UNKNOWN:'Existing - check'})[status]||status||'';
}
function comparisonClass(status){
  return status==='NEW'?'complete':status==='UNCHANGED'?'complete':status==='CHANGED'?'due':'';
}

function setStatus(msg){const el=$b('bulkImportStatus');if(el)el.textContent=msg||''}
function requireAdmin(){if(typeof isAdmin!=='function'||!isAdmin()){toast('Admin access required.');return false}return true}
function librariesReady(){return !!(window.pdfjsLib&&window.PDFLib)}
function isoDate(raw){
  if(!raw)return null;raw=clean(raw);
  let m=raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=raw.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}
function pageLines(content){
  const lines=[];let current='';
  for(const it of content.items||[]){
    const t=String(it.str||'').trim();if(t)current+=(current?' ':'')+t;
    if(it.hasEOL){if(clean(current))lines.push(clean(current));current=''}
  }
  if(clean(current))lines.push(clean(current));
  return lines;
}
function titleAfter(lines,heading,stopRegex){
  let i=lines.findIndex(x=>x.toUpperCase()===heading.toUpperCase());
  if(i<0)i=lines.findIndex(x=>x.toUpperCase().startsWith(heading.toUpperCase())&&!x.toUpperCase().includes('SHIELD SAFETY'));
  if(i<0)return '';
  const out=[];
  for(let j=i+1;j<Math.min(lines.length,i+6);j++){
    const l=clean(lines[j]);if(!l)continue;if(stopRegex.test(l))break;
    if(/^(Maintenance|Department|SHIELD SAFETY)/i.test(l))continue;
    out.push(l);if(out.join(' ').length>120)break;
  }
  return clean(out.join(' '));
}
function titleBeforeSds(lines){
  const i=lines.findIndex(x=>/SAFETY DATA SHEET/i.test(x));if(i<0)return '';
  for(let j=i-1;j>=Math.max(0,i-5);j--){const l=clean(lines[j]);if(!l)continue;if(/SHIELD SAFETY|SECTION 3\.4|MAINTENANCE/i.test(l))continue;return l}
  return '';
}
function titleFromRefLine(lines,ref){
  const idx=lines.findIndex(x=>x.toUpperCase().includes(ref));
  for(let j=Math.max(0,idx-4);j<idx;j++){
    const l=clean(lines[j]);if(!l||/SHIELD SAFETY|MAINTENANCE|RISK ASSESSMENT|COSHH ASSESSMENT/i.test(l))continue;
    if(l.length>3)return l;
  }
  return ref;
}
function detectStart(text,lines){
  let m=text.match(/\bTBT\s+(?:Reference|Ref)\s+(TBT-\d{3})\b/i);
  if(m&&/TOOLBOX TALK/i.test(text)&&!/TRAINING\s*&\s*SIGN-OFF/i.test(lines.slice(0,4).join(' '))){return {kind:'TOOLBOX_TALK',ref:m[1].toUpperCase(),title:titleAfter(lines,'TOOLBOX TALK',/\bTBT\s+(Reference|Ref)\b/i)||m[1].toUpperCase()}}
  m=text.match(/\bSSW\s+Reference\s+(SSW-\d{3})\b/i);
  if(m){return {kind:'SSW',ref:m[1].toUpperCase(),title:titleAfter(lines,'SAFE SYSTEM OF WORK (SSW)',/\bSSW\s+Reference\b/i)||m[1].toUpperCase()}}
  m=text.match(/\b(?:RA\s+Reference|Risk Assessment\s+(?:Reference|Ref))\s*:?[\s-]*(RA-\d{3})\b/i);
  if(m){return {kind:'RISK_ASSESSMENT',ref:m[1].toUpperCase(),title:titleAfter(lines,'RISK ASSESSMENT',/\b(?:RA\s+Reference|Risk Assessment\s+(?:Reference|Ref))\b/i)||titleFromRefLine(lines,m[1].toUpperCase())}}
  m=text.match(/\bCOSHH\s+(?:Reference|Ref)\s*:?[\s-]*(COSHH-\d{3})\b/i);
  if(m){return {kind:'COSHH',ref:m[1].toUpperCase(),title:titleAfter(lines,'COSHH RISK ASSESSMENT',/\bCOSHH\s+(Reference|Ref)\b/i)||titleAfter(lines,'COSHH ASSESSMENT',/\bCOSHH\s+(Reference|Ref)\b/i)||titleFromRefLine(lines,m[1].toUpperCase())}}
  if(/SAFETY DATA SHEET/i.test(text)&&/(SECTION\s+1\s*:|1\.1\s+Product identifier|Identification of the substance)/i.test(text)){
    return {kind:'SDS',ref:'',title:titleBeforeSds(lines)||'Manufacturer Safety Data Sheet'};
  }
  return null;
}
function inferSingle(text,lines,fileName){
  const upper=text.toUpperCase();
  if(/TOOLBOX TALK DIRECTORY/.test(upper))return {kind:'OTHER',ref:'SECTION 5.1',title:'Toolbox Talk Directory'};
  if(/RISK ASSESSMENT DIRECTORY/.test(upper))return {kind:'OTHER',ref:'RA DIRECTORY',title:'Risk Assessment Directory'};
  if(/COSHH DIRECTORY/.test(upper))return {kind:'OTHER',ref:'COSHH DIRECTORY',title:'COSHH Directory'};
  if(/SAFE SYSTEM(?:S)? OF WORK DIRECTORY|SSW DIRECTORY/.test(upper))return {kind:'OTHER',ref:'SSW DIRECTORY',title:'Safe Systems of Work Directory'};
  if(/SAFETY DATA SHEET/.test(upper))return {kind:'SDS',ref:'',title:titleBeforeSds(lines)||safe(fileName.replace(/\.pdf$/i,''))};
  return {kind:'OTHER',ref:'',title:safe(fileName.replace(/\.pdf$/i,''))};
}
function metaFromText(text,kind){
  const refs=uniq((text.match(refPattern)||[]).map(x=>x.toUpperCase()));
  let version='1',versionExplicit=false;
  const vm=text.match(/\bVersion\s*:?\s*([A-Za-z0-9._-]+)/i);
  if(vm){version=vm[1];versionExplicit=true;}
  let issue=null,review=null;
  let dm=text.match(/(?:Date of issue\/Date of revision|Date of issue|Issue date)\s*:?\s*([0-9]{1,4}[\/-][0-9]{1,2}[\/-][0-9]{1,4})/i);if(dm)issue=isoDate(dm[1]);
  dm=text.match(/(?:Review date|Next review)\s*:?\s*([0-9]{1,4}[\/-][0-9]{1,2}[\/-][0-9]{1,4})/i);if(dm)review=isoDate(dm[1]);
  if(kind==='SDS')review=null;
  return {refs,version,versionExplicit,issue,review};
}
async function analyseOne(file,sourceIndex){
  const ab=await file.arrayBuffer();
  const pdf=await pdfjsLib.getDocument({data:ab.slice(0)}).promise;
  const pages=[];
  for(let p=1;p<=pdf.numPages;p++){
    setStatus(`Analysing ${file.name}: page ${p} of ${pdf.numPages}…`);
    const pg=await pdf.getPage(p),content=await pg.getTextContent();
    const lines=pageLines(content),text=clean(lines.join(' '));pages.push({page:p,lines,text});
  }
  B.sources[sourceIndex]={file,arrayBuffer:ab,pageCount:pdf.numPages};
  const starts=[];
  pages.forEach((pg,i)=>{const s=detectStart(pg.text,pg.lines);if(s)starts.push({...s,index:i})});
  const items=[];
  if(starts.length){
    for(let n=0;n<starts.length;n++){
      const s=starts[n],end=(n+1<starts.length?starts[n+1].index-1:pages.length-1),
            segment=pages.slice(s.index,end+1),text=segment.map(x=>x.text).join(' '),meta=metaFromText(text,s.kind),
            contentHash=await sha256Text(text);
      const related=meta.refs.filter(r=>r!==s.ref && !r.startsWith('TBT-'));
      items.push({
        sourceIndex,sourceName:file.name,startPage:s.index+1,endPage:end+1,kind:s.kind,
        reference:s.ref,title:s.title||s.ref,version:meta.version||'1',versionExplicit:meta.versionExplicit,
        issueDate:meta.issue,reviewDate:meta.review,relatedRefs:related,contentHash,
        compareStatus:'NEW',selected:true,mode:'CREATE',existingId:null
      });
    }
  }else{
    const allText=pages.map(x=>x.text).join(' '),single=inferSingle(allText,pages[0]?.lines||[],file.name),
          meta=metaFromText(allText,single.kind),contentHash=await sha256Text(allText);
    items.push({
      sourceIndex,sourceName:file.name,startPage:1,endPage:pages.length,kind:single.kind,
      reference:single.ref,title:single.title,version:meta.version||'1',versionExplicit:meta.versionExplicit,
      issueDate:meta.issue,reviewDate:meta.review,relatedRefs:meta.refs.filter(r=>!r.startsWith('TBT-')),
      contentHash,compareStatus:'NEW',selected:true,mode:'CREATE',existingId:null
    });
  }
  return items;
}
function existingFor(item){
  if(item.kind==='TOOLBOX_TALK'){
    const ref=item.reference.toUpperCase();
    const matches=state.training.filter(t=>ref?String(t.name||'').toUpperCase().startsWith(ref):clean(t.name).toLowerCase()===clean(item.title).toLowerCase());
    return matches.find(t=>t.status==='ACTIVE')||matches[0]||null;
  }
  if(item.reference){
    const ref=item.reference.toUpperCase();
    const hit=state.documents.find(d=>String(d.reference||'').toUpperCase()===ref);
    if(hit)return hit;
  }
  if(item.kind==='SDS'){
    const key=productWords(item.title).join(' ');
    return state.documents.find(d=>d.doc_type==='SDS'&&productWords(d.title).join(' ')===key)||null;
  }
  return null;
}
async function storedHashForDocument(doc){
  const v=currentVersion(doc.id);
  if(!v)return null;
  if(v.content_text_sha256)return v.content_text_sha256;
  if(!v.storage_path)return null;
  try{
    const {data,error}=await sb.storage.from('safety-files').download(v.storage_path);
    if(error||!data)return null;
    const hash=await textHashFromPdfBlob(data);
    if(hash){
      const up=await sb.from('document_versions').update({content_text_sha256:hash}).eq('id',v.id);
      if(!up.error)v.content_text_sha256=hash;
    }
    return hash;
  }catch(e){console.warn('Existing document comparison failed',e);return null}
}
async function storedHashForTraining(training){
  const files=state.trainingFiles.filter(f=>f.training_session_id===training.id)
    .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
  const f=files[0];if(!f)return null;
  if(f.content_text_sha256)return f.content_text_sha256;
  if(!f.storage_path)return null;
  try{
    const {data,error}=await sb.storage.from('safety-files').download(f.storage_path);
    if(error||!data)return null;
    const hash=await textHashFromPdfBlob(data);
    if(hash){
      const up=await sb.from('training_files').update({content_text_sha256:hash}).eq('id',f.id);
      if(!up.error)f.content_text_sha256=hash;
    }
    return hash;
  }catch(e){console.warn('Existing training comparison failed',e);return null}
}
async function compareItem(item){
  const x=existingFor(item);
  item.existingId=x?.id||null;
  if(!x){
    item.compareStatus='NEW';item.mode='CREATE';item.selected=true;return;
  }
  const oldHash=item.kind==='TOOLBOX_TALK'?await storedHashForTraining(x):await storedHashForDocument(x);
  if(oldHash&&item.contentHash){
    if(oldHash===item.contentHash){
      item.compareStatus='UNCHANGED';item.mode='SKIP';item.selected=false;
    }else{
      item.compareStatus='CHANGED';
      if(item.kind==='TOOLBOX_TALK'){
        item.mode='REPLACE_TRAINING';item.selected=true;
      }else{
        item.mode='NEW_VERSION';item.selected=true;
        const old=currentVersion(x.id);
        if(!item.versionExplicit||String(item.version)===String(old?.version_label||''))item.version=nextVersionLabel(x.id);
      }
    }
  }else{
    item.compareStatus='UNKNOWN';item.mode='SKIP';item.selected=false;
  }
}
async function prepareExistingFlags(){
  let n=0;
  for(const item of B.items){
    n++;
    const x=existingFor(item);
    if(x)setStatus(`Comparing existing records: ${n} of ${B.items.length}…`);
    await compareItem(item);
  }
}
function productWords(s){
  const stop=new Set(['safety','data','sheet','sds','msds','coshh','assessment','risk','the','and','for','product','manufacturer','trade','uk','gb','pure','white']);
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ').filter(x=>x.length>2&&!stop.has(x));
}
function kindLabel(k){return ({RISK_ASSESSMENT:'Risk Assessment',COSHH:'COSHH Assessment',SDS:'SDS / MSDS',SSW:'Safe System of Work',POLICY:'Policy',PROCEDURE:'Procedure',OTHER:'Control / Other',TOOLBOX_TALK:'Toolbox Talk'})[k]||k}
function methodLabel(item){if(item.kind==='SDS')return 'Reference only · no signature';if(item.kind==='SSW'||item.kind==='TOOLBOX_TALK')return 'Instructor-led';if(['RISK_ASSESSMENT','COSHH'].includes(item.kind))return 'Self-training';return 'Reference / unassigned'}
function typeOptions(k){return ['RISK_ASSESSMENT','COSHH','SDS','SSW','POLICY','PROCEDURE','OTHER','TOOLBOX_TALK'].map(v=>`<option value="${v}" ${v===k?'selected':''}>${escB(kindLabel(v))}</option>`).join('')}
function modeOptions(item){
  if(item.kind==='TOOLBOX_TALK'){
    if(item.existingId){
      return `<option value="SKIP" ${item.mode==='SKIP'?'selected':''}>Skip</option>
              <option value="REPLACE_TRAINING" ${item.mode==='REPLACE_TRAINING'?'selected':''}>Create revised training</option>`;
    }
    return `<option value="CREATE" ${item.mode==='CREATE'?'selected':''}>Create training</option>
            <option value="SKIP" ${item.mode==='SKIP'?'selected':''}>Skip</option>`;
  }
  if(item.existingId)return `<option value="SKIP" ${item.mode==='SKIP'?'selected':''}>Skip existing</option>
    <option value="NEW_VERSION" ${item.mode==='NEW_VERSION'?'selected':''}>Publish as new version</option>`;
  return `<option value="CREATE" selected>Create</option><option value="SKIP">Skip</option>`;
}
function renderPreview(){
  const box=$b('bulkImportPreview'),sum=$b('bulkImportSummary'),actions=$b('bulkImportActions');if(!box)return;
  const counts={};B.items.forEach(i=>counts[i.kind]=(counts[i.kind]||0)+1);
  const changed=B.items.filter(i=>i.compareStatus==='CHANGED').length,
        unchanged=B.items.filter(i=>i.compareStatus==='UNCHANGED').length,
        fresh=B.items.filter(i=>i.compareStatus==='NEW').length;
  sum.innerHTML=
    Object.entries(counts).map(([k,n])=>`<div class="stat"><strong>${n}</strong><span>${escB(kindLabel(k))}${n===1?'':'s'}</span></div>`).join('')+
    `<div class="stat"><strong>${changed}</strong><span>Changed</span></div><div class="stat"><strong>${unchanged}</strong><span>Unchanged</span></div><div class="stat"><strong>${fresh}</strong><span>New</span></div>`;
  box.innerHTML=B.items.map((i,idx)=>`<div class="item-card bulk-preview-card" data-kind="${i.kind}" data-bulk-index="${idx}">
    <div class="row-between">
      <label class="check-row"><input class="bulk-select" type="checkbox" ${i.selected?'checked':''}> <strong>${escB(i.reference?`${i.reference} · ${i.title}`:i.title)}</strong></label>
      <span class="badge ${comparisonClass(i.compareStatus)}">${escB(comparisonLabel(i.compareStatus))}</span>
    </div>
    <div class="meta">
      <span>${escB(i.sourceName)}</span><span>Pages ${i.startPage}${i.endPage!==i.startPage?`–${i.endPage}`:''}</span><span>${escB(methodLabel(i))}</span>
      ${i.compareStatus==='CHANGED'?'<span>Content differs from current tracker copy</span>':''}
      ${i.compareStatus==='UNCHANGED'?'<span>Actual PDF content matches current tracker copy</span>':''}
    </div>
    ${i.relatedRefs.length?`<div class="bulk-ref-list">Relevant refs: ${escB(i.relatedRefs.join(', '))}</div>`:''}
    <div class="bulk-grid">
      <label>Reference<input class="bulk-ref" value="${escB(i.reference)}" placeholder="Optional"></label>
      <label class="wide">Title<input class="bulk-title" value="${escB(i.title)}"></label>
      <label>Section<select class="bulk-kind">${typeOptions(i.kind)}</select></label>
      <label>Action<select class="bulk-mode">${modeOptions(i)}</select></label>
      ${i.kind!=='TOOLBOX_TALK'?`<label>Version<input class="bulk-version" value="${escB(i.version||'1')}"></label>
      <label>Issue date<input class="bulk-issue" type="date" value="${escB(i.issueDate||'')}"></label>
      ${i.kind!=='SDS'?`<label>Review date<input class="bulk-review" type="date" value="${escB(i.reviewDate||'')}"></label>`:''}`:''}
    </div>
  </div>`).join('');
  actions.hidden=!B.items.length;
  bindPreviewEdits();
}
function bindPreviewEdits(){
  document.querySelectorAll('[data-bulk-index]').forEach(card=>{
    const i=B.items[Number(card.dataset.bulkIndex)];
    card.querySelector('.bulk-select').onchange=e=>{
      i.selected=e.target.checked;
      if(!i.selected)i.mode='SKIP';
      else if(i.mode==='SKIP')i.mode=i.existingId?(i.kind==='TOOLBOX_TALK'?'REPLACE_TRAINING':'NEW_VERSION'):'CREATE';
      renderPreview();
    };
    card.querySelector('.bulk-ref').onchange=async e=>{i.reference=clean(e.target.value).toUpperCase();setStatus('Re-checking changed reference…');await compareItem(i);renderPreview();setStatus('Comparison updated.');};
    card.querySelector('.bulk-title').onchange=async e=>{i.title=clean(e.target.value);setStatus('Re-checking changed title…');await compareItem(i);renderPreview();setStatus('Comparison updated.');};
    card.querySelector('.bulk-kind').onchange=async e=>{i.kind=e.target.value;setStatus('Re-checking changed section…');await compareItem(i);renderPreview();setStatus('Comparison updated.');};
    card.querySelector('.bulk-mode').onchange=e=>{i.mode=e.target.value;i.selected=i.mode!=='SKIP';renderPreview()};
    card.querySelector('.bulk-version')?.addEventListener('change',e=>i.version=clean(e.target.value)||'1');
    card.querySelector('.bulk-issue')?.addEventListener('change',e=>i.issueDate=e.target.value||null);
    card.querySelector('.bulk-review')?.addEventListener('change',e=>i.reviewDate=e.target.value||null);
  });
}
async function analyse(){
  if(!requireAdmin()||B.busy)return;if(!navigator.onLine)return toast('Bulk Import requires an internet connection.');
  if(!librariesReady())return toast('PDF libraries did not load. Refresh and try again.');
  const files=[...($b('bulkImportFiles')?.files||[])];if(!files.length)return toast('Choose one or more PDF section files first.');
  if(files.some(f=>f.size>45*1024*1024))return toast('One or more PDFs exceed 45 MB. Split the pack first.');
  B.busy=true;B.sources=[];B.items=[];$b('bulkAnalyzeBtn').disabled=true;
  try{
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    for(let i=0;i<files.length;i++){const items=await analyseOne(files[i],i);B.items.push(...items)}
    await prepareExistingFlags();
    renderPreview();
    const changed=B.items.filter(i=>i.compareStatus==='CHANGED').length,
          unchanged=B.items.filter(i=>i.compareStatus==='UNCHANGED').length,
          fresh=B.items.filter(i=>i.compareStatus==='NEW').length;
    setStatus(`Analysis complete: ${B.items.length} record${B.items.length===1?'':'s'} detected · ${fresh} new · ${changed} changed · ${unchanged} unchanged. Filename is not used to decide whether content changed.`);
  }catch(e){console.error(e);setStatus(`Analysis failed: ${e.message||e}`);toast('Could not analyse one of the PDFs.');}
  finally{B.busy=false;$b('bulkAnalyzeBtn').disabled=false}
}
async function splitPdf(item){
  const src=B.sources[item.sourceIndex];const srcDoc=await PDFLib.PDFDocument.load(src.arrayBuffer.slice(0));const out=await PDFLib.PDFDocument.create();
  const idx=[];for(let p=item.startPage-1;p<=item.endPage-1;p++)idx.push(p);const pages=await out.copyPages(srcDoc,idx);pages.forEach(p=>out.addPage(p));
  const bytes=await out.save();return new Blob([bytes],{type:'application/pdf'});
}
function nextVersionLabel(docId){
  const vals=state.versions.filter(v=>v.document_id===docId).map(v=>String(v.version_label||'')).map(v=>Number(v)).filter(Number.isFinite);return vals.length?String(Math.max(...vals)+1):String(Date.now()).slice(-6);
}
async function createDocument(item,blob){
  const type=item.kind,delivery=type==='SSW'?'INSTRUCTOR_LED':'SELF_TRAINING';
  const {data:d,error}=await sb.from('documents').insert({title:item.title,reference:item.reference||null,doc_type:type,delivery_method:delivery,status:'ACTIVE',default_renewal_value:null,default_renewal_unit:null,resign_on_new_version:type!=='SDS',created_by:state.user.id}).select().single();if(error)throw error;
  const ver=item.version||'1',name=`${safe(item.reference||item.title)}-v${safe(ver)}.pdf`,path=`documents/${d.id}/${crypto.randomUUID()}-${name}`;
  const up=await sb.storage.from('safety-files').upload(path,blob,{contentType:'application/pdf'});if(up.error){await sb.from('documents').delete().eq('id',d.id);throw up.error}
  const notes=`Bulk imported from ${item.sourceName}, pages ${item.startPage}-${item.endPage}.`;
  const {error:ve}=await sb.from('document_versions').insert({document_id:d.id,version_label:ver,issue_date:item.issueDate||null,review_date:type==='SDS'?null:(item.reviewDate||null),delivery_method:delivery,storage_path:path,file_name:name,notes,status:'CURRENT',content_text_sha256:item.contentHash||null,created_by:state.user.id});if(ve){await sb.storage.from('safety-files').remove([path]);await sb.from('documents').delete().eq('id',d.id);throw ve}
  item.dbDocId=d.id;
}
async function publishVersion(item,blob){
  const d=state.documents.find(x=>x.id===item.existingId);if(!d)throw new Error(`Existing document not found for ${item.reference||item.title}`);
  const old=currentVersion(d.id),method=effectiveDocumentMethod(d,null,old),ver=item.version&&item.version!=='1'?item.version:nextVersionLabel(d.id),name=`${safe(item.reference||item.title)}-v${safe(ver)}.pdf`,path=`documents/${d.id}/${crypto.randomUUID()}-${name}`;
  const up=await sb.storage.from('safety-files').upload(path,blob,{contentType:'application/pdf'});if(up.error)throw up.error;
  if(old){const {error}=await sb.from('document_versions').update({status:'SUPERSEDED'}).eq('id',old.id);if(error)throw error}
  const {data:nv,error}=await sb.from('document_versions').insert({document_id:d.id,version_label:ver,issue_date:item.issueDate||null,review_date:d.doc_type==='SDS'?null:(item.reviewDate||null),delivery_method:method,storage_path:path,file_name:name,notes:`Bulk imported new version from ${item.sourceName}, pages ${item.startPage}-${item.endPage}. Automatic comparison confirmed the content changed.`,status:'CURRENT',content_text_sha256:item.contentHash||null,created_by:state.user.id}).select().single();if(error)throw error;
  if(old&&d.resign_on_new_version&&d.doc_type!=='SDS'){
    const oldA=state.docAssignments.filter(a=>a.document_version_id===old.id&&a.active!==false);
    for(const a of oldA){const {error:ae}=await sb.from('document_assignments').insert({document_version_id:nv.id,user_id:a.user_id,due_date:daysFromNow(14),renewal_value:a.renewal_value,renewal_unit:a.renewal_unit,assigned_by:state.user.id,active:true});if(ae)throw ae}
  }
  item.dbDocId=d.id;item.version=ver;
}
async function createTraining(item,blob){
  const name=item.reference?`${item.reference} - ${item.title}`:item.title;
  const refs=item.relatedRefs.length?` Relevant documents: ${item.relatedRefs.join(', ')}.`:'';
  const desc=`Bulk imported from ${item.sourceName}, pages ${item.startPage}-${item.endPage}.${refs}`;
  const {data:t,error}=await sb.from('training_sessions').insert({name,session_type:'TOOLBOX_TALK',delivery_method:'INSTRUCTOR_LED',description:desc,delivered_date:null,trainer_name:null,trainer_user_id:state.user.id,review_date:item.reviewDate||null,default_due_date:null,renewal_value:null,renewal_unit:null,status:'ACTIVE',created_by:state.user.id}).select().single();if(error)throw error;
  const fname=`${safe(item.reference||item.title)}.pdf`,path=`training/${t.id}/${crypto.randomUUID()}-${fname}`;const up=await sb.storage.from('safety-files').upload(path,blob,{contentType:'application/pdf'});if(up.error)throw up.error;
  const {error:fe}=await sb.from('training_files').insert({training_session_id:t.id,file_name:fname,storage_path:path,content_text_sha256:item.contentHash||null,uploaded_by:state.user.id});if(fe)throw fe;item.dbTrainingId=t.id;
}

async function replaceTraining(item,blob){
  const old=state.training.find(x=>x.id===item.existingId);
  if(!old)throw new Error(`Existing training not found for ${item.reference||item.title}`);
  const oldAssignments=state.trainingAssignments.filter(a=>a.training_session_id===old.id&&a.active!==false);

  const {error:archiveError}=await sb.from('training_sessions').update({status:'ARCHIVED'}).eq('id',old.id);
  if(archiveError)throw archiveError;

  await createTraining(item,blob);
  const newId=item.dbTrainingId;

  for(const a of oldAssignments){
    const {error:offError}=await sb.from('training_assignments').update({active:false}).eq('id',a.id);
    if(offError)throw offError;
    const {error:addError}=await sb.from('training_assignments').insert({
      training_session_id:newId,
      user_id:a.user_id,
      due_date:daysFromNow(14),
      renewal_value:a.renewal_value,
      renewal_unit:a.renewal_unit,
      assigned_by:state.user.id,
      active:true
    });
    if(addError)throw addError;
  }
}
function pairExists(a,b){return state.documentLinks.some(l=>(l.source_document_id===a&&l.target_document_id===b)||(l.source_document_id===b&&l.target_document_id===a))}
async function addAutoLink(a,b){if(!a||!b||a.id===b.id||pairExists(a.id,b.id))return;const rel=inferLinkType(a,b);const {error}=await sb.from('document_links').insert({source_document_id:rel.source.id,target_document_id:rel.target.id,link_type:rel.type,created_by:state.user.id});if(error&&!/duplicate/i.test(error.message||''))console.warn('Bulk link',error)}
function similarity(a,b){const A=productWords(a),B2=productWords(b);if(!A.length||!B2.length)return 0;const bs=new Set(B2),common=A.filter(x=>bs.has(x));return common.length/Math.max(2,Math.min(A.length,B2.length))}
async function autoLink(){
  await loadAll();
  for(const item of B.items.filter(i=>i.dbDocId)){
    const d=state.documents.find(x=>x.id===item.dbDocId);if(!d)continue;
    for(const ref of item.relatedRefs){const other=state.documents.find(x=>String(x.reference||'').toUpperCase()===ref.toUpperCase());if(other)await addAutoLink(d,other)}
  }
  // Conservative SDS <-> COSHH title matching. Only link when the best match is clearly unique.
  const sds=state.documents.filter(d=>d.doc_type==='SDS'),coshh=state.documents.filter(d=>d.doc_type==='COSHH');
  for(const s of sds){const scored=coshh.map(c=>({c,score:similarity(s.title,c.title)})).sort((a,b)=>b.score-a.score);if(scored[0]?.score>=0.60&&(scored.length===1||scored[0].score-scored[1].score>=0.15))await addAutoLink(s,scored[0].c)}
}
async function importSelected(){
  if(!requireAdmin()||B.busy)return;if(!navigator.onLine)return toast('Bulk Import requires an internet connection.');
  const items=B.items.filter(i=>i.selected&&i.mode!=='SKIP');if(!items.length)return toast('Nothing selected to import.');
  if(!confirm(`Import ${items.length} selected record${items.length===1?'':'s'} into Safety Tracker?`))return;
  B.busy=true;$b('bulkImportBtn').disabled=true;$b('bulkAnalyzeBtn').disabled=true;
  let done=0,failed=0;
  try{
    for(const item of items){
      try{setStatus(`Importing ${done+1} of ${items.length}: ${item.reference||item.title}…`);const blob=await splitPdf(item);if(item.kind==='TOOLBOX_TALK'&&item.mode==='REPLACE_TRAINING')await replaceTraining(item,blob);else if(item.kind==='TOOLBOX_TALK')await createTraining(item,blob);else if(item.mode==='NEW_VERSION')await publishVersion(item,blob);else await createDocument(item,blob);done++}
      catch(e){failed++;item.error=e.message||String(e);console.error('Bulk import item failed',item,e)}
    }
    setStatus('Creating document links…');await autoLink();await refresh();await prepareExistingFlags();renderPreview();
    setStatus(`Bulk import finished: ${done} imported${failed?`, ${failed} failed`:''}. ${failed?'Failed items remain in the preview.':'Files are now available in Documents / Training.'}`);toast(failed?'Bulk import finished with some errors.':'Bulk import complete.');
  }finally{B.busy=false;$b('bulkImportBtn').disabled=false;$b('bulkAnalyzeBtn').disabled=false}
}
function clearAll(){if(B.busy)return;B.sources=[];B.items=[];if($b('bulkImportFiles'))$b('bulkImportFiles').value='';if($b('bulkImportPreview'))$b('bulkImportPreview').innerHTML='';if($b('bulkImportSummary'))$b('bulkImportSummary').innerHTML='';if($b('bulkImportActions'))$b('bulkImportActions').hidden=true;setStatus('')}
function attach(){
  $b('bulkAnalyzeBtn')?.addEventListener('click',analyse);$b('bulkImportBtn')?.addEventListener('click',importSelected);$b('bulkClearBtn')?.addEventListener('click',clearAll);
  const dz=$b('bulkDropZone');if(dz){dz.addEventListener('dragover',e=>{e.preventDefault()});dz.addEventListener('drop',e=>{e.preventDefault();const input=$b('bulkImportFiles');if(!input)return;const dt=new DataTransfer();[...e.dataTransfer.files].filter(f=>/\.pdf$/i.test(f.name)).forEach(f=>dt.items.add(f));input.files=dt.files})}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach);else attach();
})();
