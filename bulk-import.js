/* Safety Tracker v2.2.6 - pending-approval multi-document PDF pack importer (standalone final build).
   Splits combined RA / COSHH / SSW / TBT packs and combined manufacturer SDS/MSDS packs
   into individual records before import. */
'use strict';
(() => {
const api=window.SafetyTrackerV2;if(!api)return;
const {state,sb}=api;
const B={sources:[],items:[],busy:false};
const $=id=>document.getElementById(id);
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const today=()=>new Date().toISOString().slice(0,10);
const plusYear=iso=>{const d=new Date((iso||today())+'T12:00:00');d.setFullYear(d.getFullYear()+1);return d.toISOString().slice(0,10)};
const uniq=a=>[...new Set(a.filter(Boolean))];
const refPattern=/\b(?:RA|COSHH|SSW|PROC|TBT)-\d{3}\b/gi;
function setStatus(msg){const el=$('bulkImportStatus');if(el){el.hidden=!msg;el.textContent=msg||''}}
function kindLabel(k){return ({RISK_ASSESSMENT:'Risk Assessment',COSHH:'COSHH Risk Assessment',SDS:'MSDS / Safety Data Sheet',SSW:'Safe System of Work',TOOLBOX_TALK:'Toolbox Talk',OTHER:'Control / Other'})[k]||k}
function pageLines(content){const lines=[];let current='';for(const it of content.items||[]){const t=String(it.str||'').trim();if(t)current+=(current?' ':'')+t;if(it.hasEOL){if(clean(current))lines.push(clean(current));current=''}}if(clean(current))lines.push(clean(current));return lines}
function titleAfter(lines,heading,stop){let i=lines.findIndex(x=>x.toUpperCase()===heading.toUpperCase());if(i<0)i=lines.findIndex(x=>x.toUpperCase().startsWith(heading.toUpperCase())&&!x.toUpperCase().includes('SHIELD SAFETY'));if(i<0)return '';const out=[];for(let j=i+1;j<Math.min(lines.length,i+7);j++){const l=clean(lines[j]);if(!l)continue;if(stop.test(l))break;if(/^(Maintenance|Department|SHIELD SAFETY)/i.test(l))continue;out.push(l);if(out.join(' ').length>140)break}return clean(out.join(' '))}
function titleBeforeSds(lines){const i=lines.findIndex(x=>/SAFETY DATA SHEET/i.test(x));if(i<0)return '';for(let j=i-1;j>=Math.max(0,i-6);j--){const l=clean(lines[j]);if(!l||/SHIELD SAFETY|SECTION 3\.4|MAINTENANCE/i.test(l))continue;return l}return ''}
function sdsProductName(text,lines,fileName){
  const fromApi=api.extractSdsProductName?.(text)||'';if(fromApi)return fromApi;
  const labels=[
    /^(?:1\.1[.\s]*)?(?:GHS\s+)?Product\s+(?:identifier|name)\s*:?\s*(.+)$/i,
    /^Trade\s+name\s*:?\s*(.+)$/i
  ];
  for(let i=0;i<lines.length;i++)for(const rx of labels){
    const line=clean(lines[i]),m=line.match(rx);
    if(m?.[1]){const c=clean(m[1]).replace(/\s+(?:According to|In accordance with|Conforms? to|COMMISSION REGULATION|REGULATION \(?:EU|EC\)).*$/i,'').replace(/\s*[:;,-]?\s*1\.[12](?:\.\d+)?\s*$/i,'').trim();if(c.length>2&&!/^\d+\s*\/\s*\d+$/.test(c)&&!/^Page\b/i.test(c))return c}
    if(rx.test(line)&&i+1<lines.length){
      const c=clean(lines[i+1]).replace(/\s+(?:According to|In accordance with|Conforms? to|COMMISSION REGULATION|REGULATION \(?:EU|EC\)).*$/i,'').replace(/\s*[:;,-]?\s*1\.[12](?:\.\d+)?\s*$/i,'').trim();
      if(c.length>2&&!/^(?:1\.2|Product code|Article No|SECTION|Page\b|Contains\b)/i.test(c)&&!/^\d+\s*\/\s*\d+$/.test(c))return c;
      // Some SDS layouts put a label such as "Product Name" on one line and the
      // actual product after an intervening "Contains" or blank-like text line.
      for(let j=i+1;j<Math.min(lines.length,i+5);j++){const v=clean(lines[j]);if(!v||/^(?:Contains|Product code|Article No|CAS No|EC No|SECTION|Page\b)/i.test(v))continue;if(v.length>2&&!/^\d+\s*\/\s*\d+$/.test(v))return v}
    }
  }
  const before=titleBeforeSds(lines);if(before&&!/^\d+\s*\/\s*\d+$/.test(before)&&!(before.length<24&&/\)$/.test(before)&&!before.includes('(')))return before;
  return api.safeFileName(fileName.replace(/\.pdf$/i,''));
}
function isSdsStartPage(text,lines){
  const t=String(text||''),u=t.toUpperCase();
  const saysSds=/\b(?:MATERIAL\s+)?SAFETY\s+DATA\s+SHEET\b|\bMSDS\b/.test(u);
  if(!saysSds)return false;
  const hasSection1=/\bSECTION\s*1\s*[:.-]?\s*(?:IDENTIFICATION|IDENTIFICATION OF THE SUBSTANCE|IDENTIFICATION OF THE SUBSTANCE\/MIXTURE)/i.test(t);
  const hasIdentifier=/\b1\.1\.?\s*(?:PRODUCT\s+IDENTIFIER|IDENTIFICATION|PRODUCT\s+NAME|TRADE\s+NAME)/i.test(t)||/\bGHS\s+PRODUCT\s+IDENTIFIER\b/i.test(t);
  const firstPageMarker=/(?:^|\s)(?:Page\s*:?\s*)?1\s*(?:\/|-|of)\s*\d{1,3}(?:\s|$)/i.test(t);
  // Many manufacturers repeat "SAFETY DATA SHEET" on every page. A true boundary
  // therefore needs Section 1 / 1.1 product identification, or an explicit page-1 marker.
  return (hasSection1&&hasIdentifier)||(firstPageMarker&&hasIdentifier);
}
function sdsStartRecord(text,lines,fileName){
  if(!isSdsStartPage(text,lines))return null;
  const title=sdsProductName(text,lines,fileName)||'Manufacturer Safety Data Sheet';
  return {kind:'SDS',ref:'',title,pageNo:1,sdsStart:true};
}
function titleFromRef(lines,ref){const i=lines.findIndex(x=>x.toUpperCase().includes(ref));for(let j=Math.max(0,i-5);j<i;j++){const l=clean(lines[j]);if(!l||/SHIELD SAFETY|MAINTENANCE|RISK ASSESSMENT|COSHH ASSESSMENT/i.test(l))continue;if(l.length>3)return l}return ref}
function uniqueRefs(text,prefix){const rx=new RegExp(`\\b${prefix}-\\d{3}\\b`,'gi');return uniq((text.match(rx)||[]).map(x=>x.toUpperCase()))}
function refNearVersion(text,prefix){const rx=new RegExp(`\\b(${prefix}-\\d{3})\\s*(?:\\||[-–—])?\\s*Version\\b`,'i');return text.match(rx)?.[1]?.toUpperCase()||''}
function pageFormNumber(text,kind){
  if(kind==='COSHH'){const m=text.match(/SS\s*HSMS\s*0014\s*-\s*V\d+\s*(\d+)\s*COSHH\s+Risk\s+Assessment\s+Form/i);return m?Number(m[1]):null}
  const m=text.match(/\bPage\s+(\d+)(?:\s+of\s+\d+)?\b/i);return m?Number(m[1]):null;
}
function coshhSubstanceTitle(text){
  const patterns=[
    /\bName\s+of\s+Substance\s*:\s*(.+?)(?=\s+Brand\s*:|\s+Where\s+is\s+(?:the\s+)?SDS\s+stored\??\s*:|\s+Form\s*:|\s+CLP\s+Hazard\s+Pictograms\b)/i,
    /\bSubstance\s+Details\b[\s\S]{0,350}?\bName\s+of\s+Substance\s*:\s*(.+?)(?=\s+Brand\s*:|\s+Where\s+is\s+(?:the\s+)?SDS\s+stored\??\s*:|\s+Form\s*:)/i
  ];
  for(const rx of patterns){const m=clean(text).match(rx);if(m?.[1]){const v=clean(m[1]).replace(/\s+COSHH-\d{3}.*$/i,'');if(v.length>2&&v.length<220)return v}}
  return '';
}
function cleanRaTitleCandidate(value,ref=''){
  let t=clean(value);if(!t)return '';
  const refEsc=String(ref||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(refEsc)t=t.replace(new RegExp(`^\\s*${refEsc}\\s*[-–—:]?\\s*`,'i'),'').trim();
  t=t.replace(/^RISK\s+ASSESSMENT\s*/i,'').replace(/^TASK\s+RISK\s+ASSESSMENT\s*/i,'').trim();
  t=t.replace(/\s+(?:Department|Location|Scope|Task|Frequency|Linked\s+(?:controls|documents|assessments)|Related\s+(?:document|documents|assessments)|Chemical\s+controls|Typical\s+location|Fuel\s+handling|Existing\s+features)\b.*$/i,'').trim();
  if(!t||t.length<4||t.length>180)return '';
  if(/SHIELD\s+SAFETY|CONTROL\s+MEASURES|\bHAZARDS?\b|RISK\s+RATING|SEVERITY|LIKELIHOOD|PEOPLE\s+EXPOSED|Page\s+\d+|Version\b/i.test(t))return '';
  if(/^(?:Surface and Work Area Checks|Dust Control and PPE|Sanding Equipment|Product and COSHH Checks|Fire and Ventilation|Application and Spill Control|Access and Surface Preparation|Housekeeping and Waste|Storage, Waste and Completion)$/i.test(t))return '';
  if(/\b(?:Follow\s+RA-|Follow\s+SSW-|Follow\s+COSHH-|reposition\s+access\s+equipment|avoid\s+prolonged|keep\s+hands|wear\s+eye\s+protection)\b/i.test(t))return '';
  if(t.length>120&&/[.!?]/.test(t))return '';
  return t;
}
function riskAssessmentTitle(text,lines,ref){
  if(ref){
    const refEsc=String(ref).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    for(const l of lines.slice(0,18)){
      const m=clean(l).match(new RegExp(`^\\s*${refEsc}\\s*[-–—:]\\s*(.+)$`,'i'));
      if(m){const c=cleanRaTitleCandidate(m[1],ref);if(c)return c;}
    }
  }
  for(const l of lines.slice(0,18)){
    const m=clean(l).match(/^\s*RA-\d{3}\s*[-–—:]\s*(.+)$/i);
    if(m){const c=cleanRaTitleCandidate(m[1],ref);if(c)return c;}
  }
  const idx=lines.findIndex(x=>/^(?:TASK\s+)?RISK\s+ASSESSMENT$/i.test(clean(x)));
  if(idx>=0){
    for(let i=idx+1;i<Math.min(lines.length,idx+6);i++){
      const l=clean(lines[i]);if(!l)continue;
      if(/^(?:Department|Location|Persons\s+at\s+risk|Task|Scope|Frequency|Linked\s+(?:controls|documents|assessments)|Related\s+(?:document|documents|assessments)|Chemical\s+controls|Typical\s+location|Fuel\s+handling|Existing\s+features)\b/i.test(l))break;
      if(/SHIELD\s+SAFETY|Maintenance\s+RA|Page\s+\d+/i.test(l))continue;
      const c=cleanRaTitleCandidate(l,ref);if(c)return c;
    }
  }
  const hotelIndex=lines.findIndex(x=>/^Marriott\s+Portsmouth$/i.test(clean(x)));
  if(hotelIndex>0){
    const parts=[];
    for(let i=hotelIndex-1;i>=0&&parts.length<3;i--){
      const l=clean(lines[i]);if(!l)continue;
      if(/SHIELD\s+SAFETY|(?:TASK\s+)?RISK\s+ASSESSMENT|Maintenance\s+RA|Page\s+\d+|SECTION\s+\d/i.test(l))break;
      if(/^Maintenance$/i.test(l))continue;
      parts.unshift(l);
    }
    const c=cleanRaTitleCandidate(parts.join(' '),ref);if(c)return c;
  }
  const flat=clean(text);
  if(ref){
    const refEsc=String(ref).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const m=flat.match(new RegExp(`\\b${refEsc}\\s*[-–—:]\\s*(.{4,180}?)(?=\\s+(?:Department|Location|Scope|Task|Frequency|Linked|Related|Chemical|Typical|Fuel|Existing)\\b)`,'i'));
    if(m){const c=cleanRaTitleCandidate(m[1],ref);if(c)return c;}
  }
  return '';
}
function titleForDetected(kind,text,lines,ref){
  if(kind==='COSHH')return coshhSubstanceTitle(text)||titleAfter(lines,'COSHH RISK ASSESSMENT',/\bCOSHH\s+(Reference|Ref)\b/i)||titleAfter(lines,'COSHH ASSESSMENT',/\bCOSHH\s+(Reference|Ref)\b/i)||ref;
  if(kind==='TOOLBOX_TALK')return titleAfter(lines,'TOOLBOX TALK',/\bTBT\s+(Reference|Ref)\b/i)||titleFromRef(lines,ref)||ref;
  if(kind==='SSW')return titleAfter(lines,'SAFE SYSTEM OF WORK (SSW)',/\bSSW\s+(Reference|Ref)\b/i)||titleAfter(lines,'SAFE SYSTEM OF WORK',/\bSSW\s+(Reference|Ref)\b/i)||titleFromRef(lines,ref)||ref;
  if(kind==='RISK_ASSESSMENT')return riskAssessmentTitle(text,lines,ref)||titleAfter(lines,'RISK ASSESSMENT',/\b(?:RA\s+Reference|Risk Assessment\s+(?:Reference|Ref))\b/i)||titleFromRef(lines,ref)||ref;
  return ref;
}
function isDirectoryOrIndexPage(text){const u=String(text||'').toUpperCase();return /\b(?:DIRECTORY|MASTER\s+INDEX|DOCUMENT\s+INDEX|RISK\s+ASSESSMENT\s+INVENTORY|CHEMICAL\s+INVENTORY)\b/.test(u)&&!/COSHH\s+RISK\s+ASSESSMENT\s+FORM/.test(u)}
function detectPageRecord(text,lines){
  const u=String(text||'').toUpperCase();
  if(isDirectoryOrIndexPage(text))return null;

  // Shield Safety COSHH packs put the controlled COSHH reference in the footer of
  // every page (for example "COSHH-014 | Version 1.2"), not beside a "COSHH Ref"
  // field. Detect the form itself, then use that footer reference to group pages.
  if(/COSHH\s+RISK\s+ASSESSMENT\s+FORM/i.test(text)){
    let ref=refNearVersion(text,'COSHH');
    if(!ref){const refs=uniqueRefs(text,'COSHH');if(refs.length===1)ref=refs[0]}
    if(ref)return {kind:'COSHH',ref,title:titleForDetected('COSHH',text,lines,ref),pageNo:pageFormNumber(text,'COSHH')};
  }

  // Toolbox Talk source pages. Exclude a generic training/sign-off page unless it
  // is carrying the same TBT reference, in which case it remains part of the TBT.
  if(/TOOLBOX\s+TALK/i.test(text)){
    let ref=refNearVersion(text,'TBT')||text.match(/\b(?:TBT\s+(?:Reference|Ref)\s*:?\s*)?(TBT-\d{3})\b/i)?.[1]?.toUpperCase()||'';
    if(ref)return {kind:'TOOLBOX_TALK',ref,title:titleForDetected('TOOLBOX_TALK',text,lines,ref),pageNo:pageFormNumber(text,'TOOLBOX_TALK')};
  }

  if(/SAFE\s+SYSTEM(?:S)?\s+OF\s+WORK/i.test(text)){
    let ref=refNearVersion(text,'SSW')||text.match(/\b(SSW-\d{3})\b/i)?.[1]?.toUpperCase()||'';
    if(ref)return {kind:'SSW',ref,title:titleForDetected('SSW',text,lines,ref),pageNo:pageFormNumber(text,'SSW')};
  }

  if(/RISK\s+ASSESSMENT/i.test(text)&&!/COSHH\s+RISK\s+ASSESSMENT/i.test(text)){
    let ref=refNearVersion(text,'RA')||text.match(/\b(RA-\d{3})\b/i)?.[1]?.toUpperCase()||'';
    if(ref)return {kind:'RISK_ASSESSMENT',ref,title:titleForDetected('RISK_ASSESSMENT',text,lines,ref),pageNo:pageFormNumber(text,'RISK_ASSESSMENT')};
  }

  const sds=sdsStartRecord(text,lines,'SDS.pdf');
  if(sds)return sds;
  return null;
}
function itemTitleFromSegment(kind,ref,segment,fallback){
  const text=clean(segment.map(x=>x.text).join(' '));
  if(kind==='COSHH')return coshhSubstanceTitle(text)||fallback||ref;
  const first=segment[0]||{};
  if(kind==='SDS')return sdsProductName(first.text||text,first.lines||[],fallback||'SDS.pdf')||fallback||'Manufacturer Safety Data Sheet';
  return titleForDetected(kind,first.text||text,first.lines||[],ref)||fallback||ref;
}
function inferSingle(text,lines,fileName){const upper=text.toUpperCase();if(/TOOLBOX TALK DIRECTORY/.test(upper))return {kind:'OTHER',ref:'SECTION 5.1',title:'Toolbox Talk Directory'};if(/RISK ASSESSMENT DIRECTORY/.test(upper))return {kind:'OTHER',ref:'RA DIRECTORY',title:'Risk Assessment Directory'};if(/COSHH DIRECTORY/.test(upper))return {kind:'OTHER',ref:'COSHH DIRECTORY',title:'COSHH Directory'};if(/SAFE SYSTEM(?:S)? OF WORK DIRECTORY|SSW DIRECTORY/.test(upper))return {kind:'OTHER',ref:'SSW DIRECTORY',title:'Safe Systems of Work Directory'};const detected=api.classifySafetyPdfText?.(text);if(detected==='COSHH'){const m=text.match(/\bCOSHH\s+(?:Reference|Ref)\s*:?\s*(COSHH-\d{3})\b/i);return {kind:'COSHH',ref:m?.[1]?.toUpperCase()||'',title:titleAfter(lines,'COSHH RISK ASSESSMENT',/\bCOSHH\s+(Reference|Ref)\b/i)||titleAfter(lines,'COSHH ASSESSMENT',/\bCOSHH\s+(Reference|Ref)\b/i)||api.safeFileName(fileName.replace(/\.pdf$/i,''))}}if(detected==='SDS')return {kind:'SDS',ref:'',title:sdsProductName(text,lines,fileName)};return {kind:'OTHER',ref:'',title:api.safeFileName(fileName.replace(/\.pdf$/i,''))}}
function metaFromText(text,kind){const refs=uniq((api.refsInText?.(text)||((text.match(refPattern)||[]).map(x=>x.toUpperCase()))).map(x=>api.canonicalRef?.(x)||x.toUpperCase()));let version='1',versionExplicit=false;const vm=text.match(/\bVersion\s*:?\s*([A-Za-z0-9._-]+)/i);if(vm){version=vm[1];versionExplicit=true}return {refs,version,versionExplicit,issue:today(),review:kind==='SDS'?null:plusYear(today())}}
async function analyseOne(file,sourceIndex){
  const ab=await file.arrayBuffer(),pdf=await pdfjsLib.getDocument({data:ab.slice(0)}).promise,pages=[];
  for(let p=1;p<=pdf.numPages;p++){
    setStatus(`Analysing ${file.name}: page ${p} of ${pdf.numPages}…`);
    const pg=await pdf.getPage(p),content=await pg.getTextContent(),lines=pageLines(content),text=clean(lines.join(' '));
    pages.push({page:p,lines,text,record:detectPageRecord(text,lines)});
  }
  B.sources[sourceIndex]={file,arrayBuffer:ab,pageCount:pdf.numPages};

  // Build boundaries by controlled reference for RA/COSHH/SSW/TBT, and by a
  // manufacturer SDS first page for ref-less SDS/MSDS packs. This lets one pack
  // contain many unrelated manufacturer data sheets without importing as one record.
  const starts=[];let lastKey='';
  pages.forEach((pg,i)=>{
    const r=pg.record;if(!r)return;
    if(r.kind==='SDS'&&r.sdsStart){
      starts.push({...r,index:i});
      lastKey='';
      return;
    }
    if(!r.ref)return;
    const key=`${r.kind}|${r.ref}`;
    if(key!==lastKey){starts.push({...r,index:i});lastKey=key}
    else if(starts.length&&(!starts[starts.length-1].title||starts[starts.length-1].title===starts[starts.length-1].ref)&&r.title&&r.title!==r.ref){starts[starts.length-1].title=r.title}
  });

  const items=[];
  if(starts.length){
    for(let n=0;n<starts.length;n++){
      const s=starts[n];let end=n+1<starts.length?starts[n+1].index-1:pages.length-1;
      // A directory/section cover between two controlled documents belongs to
      // neither record. Trim it from the preceding record instead of importing it.
      while(end>s.index&&isDirectoryOrIndexPage(pages[end].text))end--;
      const segment=pages.slice(s.index,end+1),text=clean(segment.map(x=>x.text).join(' ')),meta=metaFromText(text,s.kind),hash=await api.sha256Text(text).catch(()=>null);
      items.push({sourceIndex,sourceName:file.name,startPage:s.index+1,endPage:end+1,kind:s.kind,reference:s.ref,title:itemTitleFromSegment(s.kind,s.ref,segment,s.title)||s.ref,version:meta.version,versionExplicit:meta.versionExplicit,issueDate:meta.issue,reviewDate:meta.review,relatedRefs:meta.refs.filter(r=>(api.canonicalRef?.(r)||r)!==(api.canonicalRef?.(s.ref)||s.ref)),contentHash:hash,compareStatus:'NEW',mode:'CREATE',selected:true,existingId:null});
    }
  }else{
    const text=clean(pages.map(x=>x.text).join(' ')),single=inferSingle(text,pages[0]?.lines||[],file.name),meta=metaFromText(text,single.kind),hash=await api.sha256Text(text).catch(()=>null);
    items.push({sourceIndex,sourceName:file.name,startPage:1,endPage:pages.length,kind:single.kind,reference:single.ref,title:single.title,version:meta.version,versionExplicit:meta.versionExplicit,issueDate:meta.issue,reviewDate:meta.review,relatedRefs:meta.refs.filter(r=>(api.canonicalRef?.(r)||r)!==(api.canonicalRef?.(single.ref||'')||single.ref||'')),contentHash:hash||null,compareStatus:'NEW',mode:'CREATE',selected:true,existingId:null});
  }
  return items;
}
async function splitRange(arrayBuffer,startIndex,endIndex){const src=await PDFLib.PDFDocument.load(arrayBuffer.slice(0)),out=await PDFLib.PDFDocument.create(),idx=[];for(let p=startIndex;p<=endIndex;p++)idx.push(p);const pages=await out.copyPages(src,idx);pages.forEach(p=>out.addPage(p));return await out.save()}
async function splitItem(item){const src=B.sources[item.sourceIndex];return new Blob([await splitRange(src.arrayBuffer,item.startPage-1,item.endPage-1)],{type:'application/pdf'})}
function existingTraining(item){if(item.kind!=='TOOLBOX_TALK')return null;const ref=clean(item.reference).toUpperCase();const matches=state.training.filter(t=>ref?clean(t.reference||t.name).toUpperCase().includes(ref):clean(t.name).toLowerCase()===clean(item.title).toLowerCase());return matches.find(t=>t.status!=='ARCHIVED')||matches[0]||null}
async function compareItem(item){if(item.kind==='TOOLBOX_TALK'){const x=existingTraining(item);item.existingId=x?.id||null;if(!x){item.compareStatus='NEW';item.mode='CREATE';item.selected=true;return}const f=state.trainingFiles.filter(f=>f.training_session_id===x.id).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0],oldHash=f?.content_text_sha256||null;if(oldHash&&item.contentHash&&oldHash===item.contentHash){item.compareStatus='UNCHANGED';item.mode='SKIP';item.selected=false}else{item.compareStatus=oldHash&&item.contentHash?'CHANGED':'UNKNOWN';item.mode=item.compareStatus==='CHANGED'?'REPLACE_TRAINING':'SKIP';item.selected=item.mode!=='SKIP'}return}
  const x=api.existingDocMatch(item.kind,item.reference,item.title);item.existingId=x?.id||null;if(!x){item.compareStatus='NEW';item.mode='CREATE';item.selected=true;return}const pending=api.pendingApprovalVersion?.(x.id);if(pending){item.compareStatus='PENDING_APPROVAL';item.mode='SKIP';item.selected=false;item.version=pending.version_label||item.version;return}const old=api.approvedCurrentVersion?.(x.id)||api.currentVersion(x.id),oldHash=await storedHash(old);if(oldHash&&item.contentHash){if(oldHash===item.contentHash){item.compareStatus='UNCHANGED';item.mode='SKIP';item.selected=false}else{item.compareStatus='CHANGED';item.mode='NEW_VERSION';item.selected=true;item.version=api.nextVersionLabel(x.id)}}else{item.compareStatus='UNKNOWN';item.mode='SKIP';item.selected=false}}
async function storedHash(v){if(!v)return null;if(v.content_text_sha256)return v.content_text_sha256;if(!v.storage_path)return null;try{const r=await sb.storage.from('safety-files').download(v.storage_path);if(r.error||!r.data)return null;const h=await api.hashPdf(r.data);if(h){await sb.from('document_versions').update({content_text_sha256:h}).eq('id',v.id);v.content_text_sha256=h}return h}catch{return null}}
function modeOptions(i){if(i.kind==='TOOLBOX_TALK'){if(i.existingId)return `<option value="SKIP" ${i.mode==='SKIP'?'selected':''}>Skip</option><option value="REPLACE_TRAINING" ${i.mode==='REPLACE_TRAINING'?'selected':''}>Create revised training</option>`;return `<option value="CREATE" selected>Create training</option><option value="SKIP">Skip</option>`}if(i.existingId)return `<option value="SKIP" ${i.mode==='SKIP'?'selected':''}>Skip existing</option><option value="NEW_VERSION" ${i.mode==='NEW_VERSION'?'selected':''}>Upload pending version</option>`;return `<option value="CREATE" selected>Create</option><option value="SKIP">Skip</option>`}
function renderPreview(){const box=$('bulkImportPreview'),sum=$('bulkImportSummary');if(!box)return;const counts={};B.items.forEach(i=>counts[i.kind]=(counts[i.kind]||0)+1);const changed=B.items.filter(i=>i.compareStatus==='CHANGED').length,pending=B.items.filter(i=>i.compareStatus==='PENDING_APPROVAL').length,unchanged=B.items.filter(i=>i.compareStatus==='UNCHANGED').length,fresh=B.items.filter(i=>i.compareStatus==='NEW').length;sum.innerHTML=Object.entries(counts).map(([k,n])=>`<div class="stat"><strong>${n}</strong><span>${esc(kindLabel(k))}${n===1?'':'s'}</span></div>`).join('')+`<div class="stat"><strong>${changed}</strong><span>Changed</span></div><div class="stat"><strong>${pending}</strong><span>Pending approval</span></div><div class="stat"><strong>${unchanged}</strong><span>Unchanged</span></div><div class="stat"><strong>${fresh}</strong><span>New</span></div>`;box.innerHTML=B.items.map((i,idx)=>`<div class="item-card bulk-preview-card" data-kind="${i.kind}" data-index="${idx}"><div class="row-between"><label class="check-row"><input class="bulk-select" type="checkbox" ${i.selected?'checked':''}> <span><strong>${esc(i.reference||kindLabel(i.kind))}</strong> · ${esc(i.title)}</span></label><span class="badge ${['CHANGED','PENDING_APPROVAL'].includes(i.compareStatus)?'due':i.compareStatus==='UNCHANGED'?'complete':''}">${esc(i.compareStatus)}</span></div><div class="meta"><span>${esc(i.sourceName)} · pages ${i.startPage}-${i.endPage}</span><span>${esc(kindLabel(i.kind))}</span>${i.relatedRefs.length?`<span>References: ${esc(i.relatedRefs.join(', '))}</span>`:''}</div><div class="bulk-grid"><label>Action<select class="bulk-mode">${modeOptions(i)}</select></label><label class="wide">Title<input class="bulk-title" value="${esc(i.title)}"></label><label>Reference<input class="bulk-ref" value="${esc(i.reference)}"></label><label>Version<input class="bulk-version" value="${esc(i.version)}"></label><label>Issue date<input type="date" class="bulk-issue" value="${esc(i.issueDate||today())}"></label><label>Review date<input type="date" class="bulk-review" value="${esc(i.reviewDate||'')}" ${i.kind==='SDS'?'disabled':''}></label></div></div>`).join('');box.querySelectorAll('[data-index]').forEach(card=>{const i=B.items[Number(card.dataset.index)];card.querySelector('.bulk-select').onchange=e=>i.selected=e.target.checked;card.querySelector('.bulk-mode').onchange=e=>{i.mode=e.target.value;i.selected=i.mode!=='SKIP';renderPreview()};card.querySelector('.bulk-title').onchange=e=>i.title=clean(e.target.value)||i.title;card.querySelector('.bulk-ref').onchange=e=>i.reference=clean(e.target.value).toUpperCase();card.querySelector('.bulk-version').onchange=e=>i.version=clean(e.target.value)||'1';card.querySelector('.bulk-issue').onchange=e=>{i.issueDate=e.target.value||today();if(i.kind!=='SDS')i.reviewDate=plusYear(i.issueDate)};card.querySelector('.bulk-review')?.addEventListener('change',e=>i.reviewDate=e.target.value||null)});$('bulkImportBtn').disabled=!B.items.some(i=>i.selected&&i.mode!=='SKIP')}
async function analyse(){if(B.busy)return;if(!navigator.onLine)return api.toast('Bulk Import requires an internet connection.');if(!window.pdfjsLib||!window.PDFLib)return api.toast('PDF libraries did not load.');const files=[...($('bulkImportFiles')?.files||[])];if(!files.length)return api.toast('Choose one or more PDF files first.');if(files.some(f=>f.size>45*1024*1024))return api.toast('One or more PDFs exceed 45 MB.');B.busy=true;B.sources=[];B.items=[];$('bulkAnalyzeBtn').disabled=true;try{await api.loadAll();for(let i=0;i<files.length;i++){const items=await analyseOne(files[i],i);B.items.push(...items)}let n=0;for(const item of B.items){setStatus(`Comparing existing records: ${++n} of ${B.items.length}…`);await compareItem(item)}renderPreview();const sdsCount=B.items.filter(x=>x.kind==='SDS').length;setStatus(`Analysis complete: ${B.items.length} record${B.items.length===1?'':'s'} detected from ${files.length} PDF pack${files.length===1?'':'s'}${sdsCount?` (${sdsCount} SDS/MSDS)`:''}. Review the page ranges below before importing. Filenames are not used to decide whether content changed.`)}catch(e){console.error(e);setStatus(`Analysis failed: ${e.message||e}`);api.toast('Could not analyse the PDF.')}finally{B.busy=false;$('bulkAnalyzeBtn').disabled=false}}
async function createDoc(item,blob){const type=item.kind,renewal=['RISK_ASSESSMENT','COSHH'].includes(type)?{value:12,unit:'MONTHS'}:{value:null,unit:null};const ins=await sb.from('documents').insert({title:item.title,reference:item.reference||null,doc_type:type,delivery_method:type==='SSW'?'INSTRUCTOR_LED':'SELF_TRAINING',status:'ACTIVE',default_renewal_value:renewal.value,default_renewal_unit:renewal.unit,resign_on_new_version:false,created_by:state.user.id}).select().single();if(ins.error)throw ins.error;const d=ins.data,name=`${api.safeFileName(item.reference||item.title)}-v${api.safeFileName(item.version||'1')}.pdf`,path=`documents/${d.id}/${crypto.randomUUID()}-${name}`,up=await sb.storage.from('safety-files').upload(path,blob,{contentType:'application/pdf'});if(up.error){await sb.from('documents').delete().eq('id',d.id);throw up.error}const vr=await sb.from('document_versions').insert({document_id:d.id,version_label:item.version||'1',issue_date:item.issueDate||today(),review_date:type==='SDS'?null:(item.reviewDate||plusYear(today())),delivery_method:type==='SSW'?'INSTRUCTOR_LED':'SELF_TRAINING',storage_path:path,file_name:name,notes:`Bulk imported from ${item.sourceName}, pages ${item.startPage}-${item.endPage}.`,status:'CURRENT',approval_status:'PENDING',content_text_sha256:item.contentHash||await api.hashPdf(blob),created_by:state.user.id}).select().single();if(vr.error){await sb.storage.from('safety-files').remove([path]);await sb.from('documents').delete().eq('id',d.id);throw vr.error}item.dbDocId=d.id}
async function replaceTraining(item,blob){const old=state.training.find(t=>t.id===item.existingId),oldAssignments=state.trainingAssignments.filter(a=>a.training_session_id===old?.id&&a.active!==false);if(old){const ar=await sb.from('training_sessions').update({status:'ARCHIVED'}).eq('id',old.id);if(ar.error)throw ar.error;for(const a of oldAssignments){const off=await sb.from('training_assignments').update({active:false}).eq('id',a.id);if(off.error)throw off.error}}const t=await createToolbox(item,blob);for(const a of oldAssignments){const add=await sb.from('training_assignments').insert({training_session_id:t.id,user_id:a.user_id,due_date:new Date(Date.now()+14*864e5).toISOString().slice(0,10),renewal_value:a.renewal_value,renewal_unit:a.renewal_unit,assigned_by:state.user.id,active:true});if(add.error)throw add.error}}
async function createToolbox(item,blob){const name=item.reference?`${item.reference} - ${item.title}`:item.title,ins=await sb.from('training_sessions').insert({name,session_type:'TOOLBOX_TALK',delivery_method:'INSTRUCTOR_LED',description:`Bulk imported Toolbox Talk. Relevant documents: ${item.relatedRefs.join(', ')||'none detected'}.`,delivered_date:null,trainer_name:null,trainer_user_id:state.user.id,review_date:item.reviewDate||plusYear(today()),default_due_date:new Date(Date.now()+14*864e5).toISOString().slice(0,10),renewal_value:null,renewal_unit:null,status:'ACTIVE',created_by:state.user.id,reference:item.reference||null,source_kind:'TOOLBOX_TALK',auto_managed:false,review_required:false,review_reason:null}).select().single();if(ins.error)throw ins.error;const t=ins.data,path=`training/${t.id}/${crypto.randomUUID()}-${api.safeFileName(item.reference||item.title)}.pdf`,up=await sb.storage.from('safety-files').upload(path,blob,{contentType:'application/pdf'});if(up.error)throw up.error;const fi=await sb.from('training_files').insert({training_session_id:t.id,file_name:`${api.safeFileName(item.reference||item.title)}.pdf`,storage_path:path,uploaded_by:state.user.id,content_text_sha256:item.contentHash||await api.hashPdf(blob)});if(fi.error)throw fi.error;await api.loadAll();for(const ref of item.relatedRefs){const d=state.documents.find(x=>clean(x.reference).toUpperCase()===ref.toUpperCase());if(d)await api.ensureTrainingDocLink(t.id,d.id,'RELATED')}return t}
async function importSelected(){if(B.busy)return;const items=B.items.filter(i=>i.selected&&i.mode!=='SKIP');if(!items.length)return api.toast('Nothing selected to import.');if(!confirm(`Import ${items.length} selected record${items.length===1?'':'s'} into Safety Tracker v2?`))return;B.busy=true;$('bulkImportBtn').disabled=true;$('bulkAnalyzeBtn').disabled=true;let done=0,failed=0;try{for(const item of items){try{setStatus(`Importing ${done+1} of ${items.length}: ${item.reference||item.title}…`);const blob=await splitItem(item);if(item.kind==='TOOLBOX_TALK'&&item.mode==='REPLACE_TRAINING')await replaceTraining(item,blob);else if(item.kind==='TOOLBOX_TALK')await createToolbox(item,blob);else if(item.mode==='NEW_VERSION'){const d=state.documents.find(x=>x.id===item.existingId);if(!d)throw new Error('Existing document not found');const ok=await api.publishFileAsNewVersion(d,blob,item.issueDate,item.reviewDate,`Bulk imported changed content from ${item.sourceName}, pages ${item.startPage}-${item.endPage}.`,true);if(!ok)throw new Error('Pending version was not uploaded')}else await createDoc(item,blob);done++;await api.loadAll()}catch(e){failed++;item.error=e.message||String(e);console.error('Bulk item failed',item,e)}}setStatus('Synchronising approved/current Training and document links…');await api.loadAll();const r=await api.runSafetySync({scan:'full',progress:m=>setStatus(m)});await api.refresh();setStatus(`Bulk import finished: ${done} imported${failed?`, ${failed} failed`:''}. New/changed controlled documents are Pending Approval; Force Sync applied only to approved/current records and made ${r.changes} update${r.changes===1?'':'s'}.`);api.toast(failed?'Bulk import completed with some errors.':'Bulk import complete — review the Pending Approval queue.')}finally{B.busy=false;$('bulkImportBtn').disabled=false;$('bulkAnalyzeBtn').disabled=false;renderPreview()}}
function clearAll(){if(B.busy)return;B.sources=[];B.items=[];$('bulkImportFiles').value='';$('bulkImportPreview').innerHTML='';$('bulkImportSummary').innerHTML='';$('bulkImportBtn').disabled=true;setStatus('')}
$('bulkAnalyzeBtn')?.addEventListener('click',analyse);$('bulkImportBtn')?.addEventListener('click',importSelected);$('bulkClearBtn')?.addEventListener('click',clearAll);
})();
