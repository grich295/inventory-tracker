/* Inventory Tracker v8.5.9 CLEAN
   Paint tin sizes + half-tin stock tracking + true linked size variants.
   Patch over v8.5.7 base app.js. Variants keep separate stock/QR/orders while inheriting Safety Bridge links.
*/
(() => {
  'use strict';

  const VERSION='8.5.9';
  const PAINT_SIZE_OPTIONS=[0.25,0.5,0.75,1,2.5,5,7.5,10,12,15,20];
  let paintClient=null;
  let currentItemId=null;
  let currentItemCode='';
  let lastDetailKey='';

  function loadBase(){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='app.js?v=859';
      s.onload=resolve;
      s.onerror=()=>reject(new Error('Could not load Inventory Tracker base app.'));
      document.head.appendChild(s);
    });
  }

  function getClient(){
    if(paintClient)return paintClient;
    const cfg=window.APP_CONFIG||{};
    if(!window.supabase||!cfg.supabaseUrl||!cfg.anonKey)return null;
    paintClient=window.supabase.createClient(cfg.supabaseUrl,cfg.anonKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
    return paintClient;
  }

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const isPaintCategory=v=>/\bpaint(?:s)?\b/i.test(clean(v));
  const prettyLitres=v=>{
    const n=Number(v);
    if(!Number.isFinite(n))return '';
    return `${Number.isInteger(n)?n:n.toFixed(3).replace(/0+$/,'').replace(/\.$/,'')} L`;
  };
  const prettyQty=v=>{
    const n=Number(v);
    if(!Number.isFinite(n))return '';
    return n.toLocaleString(undefined,{maximumFractionDigits:2});
  };
  function notify(msg,type=''){
    const existing=document.querySelector('.paint-858-message');
    if(existing)existing.remove();
    const form=document.getElementById('itemForm')||document.getElementById('stockActionForm');
    if(form){
      const d=document.createElement('div');d.className=`notice compact paint-858-message ${type==='error'?'error':''}`;d.textContent=msg;
      const actions=form.querySelector('.actions');(actions||form).insertAdjacentElement('beforebegin',d);setTimeout(()=>d.remove(),4500);return;
    }
    console[type==='error'?'error':'log'](msg);
  }

  function addStyles(){
    const style=document.createElement('style');
    style.textContent=`
      .paint-only-858{border-left:4px solid #2563eb;padding-left:12px}
      .paint-size-help-858{margin-top:5px}
      .paint-qty-tools-858{display:grid;grid-template-columns:minmax(130px,190px) 1fr;gap:10px;align-items:end;margin:.6rem 0}
      .paint-litres-preview-858{padding:.65rem .8rem;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;font-weight:700}
      .paint-tin-badge-858{display:inline-flex;align-items:center;gap:6px;margin:.3rem 0 .7rem;padding:.35rem .65rem;border-radius:999px;background:#dbeafe;color:#1e3a8a;font-weight:800}
      .qty-stepper-858{display:flex;align-items:center;gap:9px;margin-top:5px}
      .qty-stepper-858 #actionQty{width:78px!important;min-width:78px!important;max-width:78px!important;height:48px;margin:0!important;text-align:center;font-size:18px;font-weight:800}
      .qty-stepper-btn-858{width:52px;height:48px;min-width:52px;border:0;border-radius:10px;color:#fff;font-size:22px;font-weight:900;line-height:1;cursor:pointer;touch-action:manipulation;box-shadow:0 2px 5px rgba(0,0,0,.16)}
      .qty-stepper-down-858{background:#c62828}.qty-stepper-up-858{background:#218838}
      .qty-stepper-btn-858:active{transform:translateY(1px);box-shadow:none}.qty-stepper-btn-858:disabled{opacity:.45}
      .variant-modal-backdrop-859{position:fixed;inset:0;background:rgba(15,23,42,.62);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:4vh 14px;overflow:auto}
      .variant-modal-859{width:min(760px,100%);background:#fff;border-radius:16px;padding:18px;box-shadow:0 24px 70px rgba(0,0,0,.3)}
      .variant-modal-859 header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}
      .variant-grid-859{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:10px;margin-top:10px}
      .variant-card-859{display:flex;flex-direction:column;gap:5px;text-align:left;padding:12px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;cursor:pointer}
      .variant-card-859.current{border:2px solid #2563eb;background:#eff6ff;cursor:default}
      .variant-card-859 strong{font-size:1.05rem}.variant-card-859 span{font-weight:700}.variant-card-859 small{color:#64748b}
      .paint-size-list-859{margin-left:.3rem}
      @media(max-width:560px){.paint-qty-tools-858{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  async function itemByCode(code){
    const sb=getClient();if(!sb||!code)return null;
    const {data,error}=await sb.from('items').select('id,parent_item_id,variant_label,item_code,qr_value,name,category,container_size_litres,unit_cost,reorder_level,default_location_id,primary_photo_path,is_chemical,risk_rating,acknowledgement_required,active,created_by').eq('item_code',code).maybeSingle();
    if(error){console.warn('Paint metadata lookup failed',error);return null}return data||null;
  }
  async function itemById(id){
    const sb=getClient();if(!sb||!id)return null;
    const {data,error}=await sb.from('items').select('id,parent_item_id,variant_label,item_code,qr_value,name,category,container_size_litres,unit_cost,reorder_level,default_location_id,primary_photo_path,is_chemical,risk_rating,acknowledgement_required,active,created_by').eq('id',id).maybeSingle();
    if(error){console.warn('Paint metadata lookup failed',error);return null}return data||null;
  }

  function sizeOptionsHtml(current){
    const n=Number(current||0);
    return `<option value="">Select tin size</option>${PAINT_SIZE_OPTIONS.map(v=>`<option value="${v}" ${Math.abs(n-v)<1e-9?'selected':''}>${prettyLitres(v)}</option>`).join('')}<option value="CUSTOM" ${n>0&&!PAINT_SIZE_OPTIONS.some(v=>Math.abs(n-v)<1e-9)?'selected':''}>Other / custom size</option>`;
  }

  function selectedPaintSize(){
    const sel=document.getElementById('paintTinSize858');
    if(!sel)return null;
    if(sel.value==='CUSTOM')return Number(document.getElementById('paintTinCustom858')?.value||0)||null;
    return Number(sel.value||0)||null;
  }

  function updatePaintFormVisibility(){
    const cat=document.getElementById('newCategory'),wrap=document.getElementById('paintTinSizeWrap858'),opening=document.getElementById('openingQty');
    if(!cat||!wrap)return;
    const paint=isPaintCategory(cat.value);
    wrap.hidden=!paint;
    if(opening){opening.step=paint?'0.5':'0.01';opening.min='0';}
    const custom=document.getElementById('paintTinCustomWrap858'),sel=document.getElementById('paintTinSize858');
    if(custom&&sel)custom.hidden=sel.value!=='CUSTOM';
    updateOpeningPreview();
  }

  function updateOpeningPreview(){
    const p=document.getElementById('paintOpeningPreview858');if(!p)return;
    const cat=document.getElementById('newCategory');
    if(!cat||!isPaintCategory(cat.value)){p.textContent='';return}
    const size=selectedPaintSize(),q=Number(document.getElementById('openingQty')?.value||0);
    p.textContent=size&&q>0?`${prettyQty(q)} tin${q===1?'':'s'} × ${prettyLitres(size)} = ${prettyLitres(q*size)} nominal paint`:size?'Stock is recorded in tins; half tins are allowed (0.5, 1, 1.5…).':'';
  }

  async function enhanceItemForm(form){
    if(!form||form.dataset.paint858)return;form.dataset.paint858='1';
    const cat=document.getElementById('newCategory');if(!cat)return;
    const categoryCell=cat.closest('div')||cat.parentElement;
    const wrap=document.createElement('div');wrap.id='paintTinSizeWrap858';wrap.className='paint-only-858';wrap.hidden=true;
    wrap.innerHTML=`<label>Paint tin / can size</label><select id="paintTinSize858">${sizeOptionsHtml(null)}</select><div id="paintTinCustomWrap858" hidden style="margin-top:.5rem"><label>Custom size (litres)</label><input id="paintTinCustom858" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="e.g. 3"></div><div class="muted paint-size-help-858">Stock is counted as tins, so you can hold 0.5, 1, 1.5 tins etc. The app also shows the nominal litres. Create the first size, then use <strong>Paint size variants → Add size</strong> on the item to add the other tin sizes.</div>`;
    categoryCell.insertAdjacentElement('afterend',wrap);

    const opening=document.getElementById('openingQty');
    if(opening){const p=document.createElement('div');p.id='paintOpeningPreview858';p.className='muted';opening.insertAdjacentElement('afterend',p);opening.addEventListener('input',updateOpeningPreview);}

    cat.addEventListener('change',updatePaintFormVisibility);
    wrap.querySelector('#paintTinSize858').addEventListener('change',updatePaintFormVisibility);
    wrap.querySelector('#paintTinCustom858').addEventListener('input',updateOpeningPreview);

    const header=clean(form.closest('.modal')?.querySelector('header h2')?.textContent||'');
    const editing=/edit item/i.test(header);
    if(editing){
      const code=clean(document.getElementById('newCode')?.value);
      const item=await itemByCode(code);
      if(item?.container_size_litres){
        const size=Number(item.container_size_litres),sel=document.getElementById('paintTinSize858');
        if(PAINT_SIZE_OPTIONS.some(v=>Math.abs(v-size)<1e-9))sel.value=String(size);else{sel.value='CUSTOM';document.getElementById('paintTinCustom858').value=String(size);}
      }
    }
    updatePaintFormVisibility();

    form.addEventListener('submit',e=>{
      const category=cat.value||'';
      const isPaint=isPaintCategory(category);
      const size=isPaint?selectedPaintSize():null;
      if(isPaint&&!(size>0)){
        e.preventDefault();e.stopImmediatePropagation();notify('Select the paint tin / can size before saving the item.','error');return;
      }
      const snap={code:clean(document.getElementById('newCode')?.value),category,size};
      savePaintMetaWhenReady(snap);
    },true);
  }

  async function savePaintMetaWhenReady(snap){
    if(!snap.code)return;
    const sb=getClient();if(!sb)return;
    for(let attempt=0;attempt<24;attempt++){
      const item=await itemByCode(snap.code);
      if(item){
        const {error}=await sb.from('items').update({container_size_litres:snap.size||null}).eq('id',item.id);
        if(error)console.warn('Could not save paint tin size',error);
        return;
      }
      await new Promise(r=>setTimeout(r,180));
    }
    console.warn('Paint tin size could not be attached because the saved item was not found.');
  }

  function readCurrentDetailContext(button){
    const modal=button?.closest('.modal')||document.querySelector('.modal');
    const codeText=clean(modal?.querySelector('header .muted')?.textContent||'');
    currentItemCode=codeText.replace(/\s*·\s*Archived\s*$/i,'').trim();
  }

  function quantitySelectHtml(){
    let opts='<option value="">Choose quantity</option>';
    for(let n=.5;n<=10.0001;n+=.5)opts+=`<option value="${n}">${prettyQty(n)} tin${Math.abs(n-1)<1e-9?'':'s'}</option>`;
    return opts+'<option value="CUSTOM">Other / type amount</option>';
  }

  function addQuickQuantity(input,size){
    if(!input||input.dataset.paintQty858)return;input.dataset.paintQty858='1';
    input.step='0.5';if(input.id==='actionQty')input.min='0.5';
    const tools=document.createElement('div');tools.className='paint-qty-tools-858';
    tools.innerHTML=`<label>Quick tin quantity<select class="paint-qty-select-858">${quantitySelectHtml()}</select></label><div class="paint-litres-preview-858">Select a tin quantity to see litres.</div>`;
    input.insertAdjacentElement('afterend',tools);
    const sel=tools.querySelector('select'),preview=tools.querySelector('.paint-litres-preview-858');
    const update=()=>{
      const q=Number(input.value||0);
      if(q>0){preview.textContent=`${prettyQty(q)} tin${Math.abs(q-1)<1e-9?'':'s'} × ${prettyLitres(size)} = ${prettyLitres(q*size)} nominal paint`;
        const match=[...sel.options].find(o=>o.value&&o.value!=='CUSTOM'&&Math.abs(Number(o.value)-q)<1e-9);sel.value=match?match.value:'CUSTOM';
      }else{preview.textContent=`Tin size: ${prettyLitres(size)}. Stock can be entered in half tins.`;sel.value='';}
    };
    sel.addEventListener('change',()=>{if(sel.value&&sel.value!=='CUSTOM'){input.value=sel.value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}else if(sel.value==='CUSTOM'){input.focus();}});
    input.addEventListener('input',update);update();
  }

  function addStepper(form,input,isPaint){
    if(!input||input.dataset.stepper858||!['ADD','USE'].includes(String(form.dataset.type||'').toUpperCase()))return;
    input.dataset.stepper858='1';
    const wrap=document.createElement('div');wrap.className='qty-stepper-858';input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);
    const down=document.createElement('button');down.type='button';down.className='qty-stepper-btn-858 qty-stepper-down-858';down.textContent='▼';
    const up=document.createElement('button');up.type='button';up.className='qty-stepper-btn-858 qty-stepper-up-858';up.textContent='▲';
    const step=isPaint?.5:1;
    down.title=`Decrease by ${step}`;up.title=`Increase by ${step}`;down.setAttribute('aria-label',down.title);up.setAttribute('aria-label',up.title);
    wrap.appendChild(down);wrap.appendChild(up);
    const change=delta=>{
      let cur=Number(input.value);if(!Number.isFinite(cur))cur=0;
      let next=Math.round((cur+delta)*100)/100;
      const min=isPaint?.5:1;if(next<min)next=min;
      if(input.max!==''){const max=Number(input.max);if(Number.isFinite(max))next=Math.min(next,max);}
      input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    };
    down.onclick=()=>change(-step);up.onclick=()=>change(step);
  }

  async function enhanceStockActionForm(form){
    if(!form||form.dataset.paintStock858)return;form.dataset.paintStock858='pending';
    let item=currentItemId?await itemById(currentItemId):null;
    if(!item&&currentItemCode)item=await itemByCode(currentItemCode);
    if(!item){form.dataset.paintStock858='none';addStepper(form,document.getElementById('actionQty'),false);return;}
    const paint=isPaintCategory(item.category)&&Number(item.container_size_litres)>0;
    const input=document.getElementById('actionQty')||document.getElementById('newQty');
    if(!paint){form.dataset.paintStock858='no';addStepper(form,document.getElementById('actionQty'),false);return;}
    form.dataset.paintStock858='yes';
    const size=Number(item.container_size_litres);
    const head=form.querySelector('header')||form.firstElementChild;
    const badge=document.createElement('div');badge.className='paint-tin-badge-858';badge.textContent=`Paint stock · ${prettyLitres(size)} per tin · half tins allowed`;head?.insertAdjacentElement('afterend',badge);
    addQuickQuantity(input,size);addStepper(form,document.getElementById('actionQty'),true);
    form.addEventListener('submit',e=>{
      const v=Number(input?.value||0);
      if(v>=0&&Math.abs(v*2-Math.round(v*2))>1e-8){
        e.preventDefault();e.stopImmediatePropagation();notify('Paint stock is recorded in half tins: 0.5, 1, 1.5, 2 etc.','error');
      }
    },true);
  }

  async function enhanceItemDetail(){
    const modal=document.querySelector('.modal');
    const stockBtn=modal?.querySelector('[data-stock-action]');if(!modal||!stockBtn)return;
    const code=clean(modal.querySelector('header .muted')?.textContent||'').replace(/\s*·\s*Archived\s*$/i,'').trim();
    const key=`${currentItemId||''}:${code}`;if(!code||lastDetailKey===key||modal.dataset.paintDetail858)return;
    modal.dataset.paintDetail858='pending';
    let item=currentItemId?await itemById(currentItemId):null;if(!item||item.item_code!==code)item=await itemByCode(code);
    if(!item){modal.dataset.paintDetail858='none';return}
    currentItemId=item.id;currentItemCode=item.item_code;lastDetailKey=key;
    if(!(isPaintCategory(item.category)&&Number(item.container_size_litres)>0)){modal.dataset.paintDetail858='no';return}
    modal.dataset.paintDetail858='yes';
    const size=Number(item.container_size_litres);
    const rightCard=[...modal.querySelectorAll('.card')].find(c=>/QR value/i.test(c.textContent||''));
    if(rightCard&&!rightCard.querySelector('.paint-size-detail-858')){
      const d=document.createElement('div');d.className='paint-size-detail-858';d.innerHTML=`<strong>Paint tin size</strong><br>${esc(prettyLitres(size))} per tin`;rightCard.appendChild(d);
    }
    const stockCard=[...modal.querySelectorAll('.grid.cards .card')].find(c=>/Overall stock/i.test(c.textContent||''));
    if(stockCard){
      const label=stockCard.querySelector('.muted');if(label)label.textContent='Overall stock (tins)';
      const stat=stockCard.querySelector('.stat'),q=Number(String(stat?.textContent||'').replace(/,/g,''));
      if(stat&&Number.isFinite(q)&&!stockCard.querySelector('.paint-total-litres-858')){const d=document.createElement('div');d.className='muted paint-total-litres-858';d.textContent=`${prettyLitres(q*size)} nominal paint`;stockCard.appendChild(d);}
    }
  }


  // --- v8.5.9 true item variants --------------------------------------------
  let variantItemsCache859=[];
  let variantItemsCacheAt859=0;

  async function variantItems859(force=false){
    const now=Date.now();
    if(!force&&variantItemsCache859.length&&now-variantItemsCacheAt859<5000)return variantItemsCache859;
    const sb=getClient();if(!sb)return [];
    const {data,error}=await sb.from('items').select('id,parent_item_id,variant_label,item_code,qr_value,name,category,container_size_litres,unit_cost,reorder_level,default_location_id,primary_photo_path,is_chemical,risk_rating,acknowledgement_required,active,created_by').order('name');
    if(error){console.warn('Variant item lookup failed',error);return variantItemsCache859}
    variantItemsCache859=data||[];variantItemsCacheAt859=now;return variantItemsCache859;
  }
  const sameId=(a,b)=>String(a||'')===String(b||'');
  function variantRoot859(item,items){if(!item)return null;return item.parent_item_id?(items.find(x=>sameId(x.id,item.parent_item_id))||item):item}
  function variantFamily859(item,items){
    const root=variantRoot859(item,items);if(!root)return [];
    return [root,...items.filter(x=>x.active!==false&&sameId(x.parent_item_id,root.id))]
      .filter((x,i,a)=>a.findIndex(y=>sameId(y.id,x.id))===i)
      .sort((a,b)=>(Number(a.container_size_litres)||9999)-(Number(b.container_size_litres)||9999)||String(a.item_code||'').localeCompare(String(b.item_code||'')));
  }
  function sizeToken859(v){
    const n=Number(v);if(!Number.isFinite(n)||n<=0)return 'VAR';
    if(n<1)return `${Math.round(n*1000)}ML`;
    return `${String(n).replace('.','-')}L`;
  }
  function baseCode859(code){return clean(code).replace(/[-_ ](?:\d+(?:[.-]\d+)?L|\d+ML)$/i,'')||clean(code)}
  function variantModalClose859(){document.querySelector('.variant-modal-backdrop-859')?.remove()}
  function variantModal859(title,html){
    variantModalClose859();
    const back=document.createElement('div');back.className='variant-modal-backdrop-859';
    back.innerHTML=`<section class="variant-modal-859"><header><div><h2>${esc(title)}</h2></div><button class="close" type="button" data-close-variant-859>×</button></header>${html}</section>`;
    document.body.appendChild(back);return back;
  }
  function variantSizeSelect859(id='variantSize859',current=''){
    return `<select id="${id}">${sizeOptionsHtml(current)}</select><div id="${id}CustomWrap" hidden style="margin-top:.5rem"><label>Custom size (litres)</label><input id="${id}Custom" type="number" min="0.01" step="0.01" inputmode="decimal"></div>`;
  }
  function variantSelectedSize859(id='variantSize859'){
    const sel=document.getElementById(id);if(!sel)return null;
    if(sel.value==='CUSTOM')return Number(document.getElementById(id+'Custom')?.value||0)||null;
    return Number(sel.value||0)||null;
  }
  function wireVariantSize859(id='variantSize859'){
    const sel=document.getElementById(id),wrap=document.getElementById(id+'CustomWrap');if(!sel||!wrap)return;
    const update=()=>wrap.hidden=sel.value!=='CUSTOM';sel.addEventListener('change',update);update();
  }
  async function variantBalances859(ids){
    const sb=getClient();if(!sb||!ids.length)return new Map();
    const {data,error}=await sb.from('stock_balances').select('item_id,quantity').in('item_id',ids);
    if(error){console.warn('Variant balance lookup failed',error);return new Map()}
    const m=new Map();for(const r of data||[])m.set(r.item_id,(m.get(r.item_id)||0)+Number(r.quantity||0));return m;
  }

  async function showAddVariant859(item){
    const items=await variantItems859(true),root=variantRoot859(item,items);if(!root)return;
    const family=variantFamily859(root,items),used=new Set(family.map(x=>Number(x.container_size_litres)).filter(x=>x>0));
    const defaultCost=root.unit_cost==null?'':root.unit_cost;
    const back=variantModal859(`Add variant · ${root.name}`,`
      <div class="notice compact"><strong>One product, separate stock by size.</strong> The new size gets its own QR/code, stock, supplier prices, reorder level and order history. Safety Tracker links are inherited automatically from the parent product.</div>
      <div class="form-grid">
        <div><label>Tin / can size</label>${variantSizeSelect859()}</div>
        <div><label>Variant item code</label><input id="variantCode859" value="${esc(baseCode859(root.item_code))}-"></div>
        <div><label>Variant QR value</label><input id="variantQr859" value="${esc(baseCode859(root.item_code))}-"></div>
        <div><label>Reorder level (tins)</label><input id="variantReorder859" type="number" min="0" step="0.5" value="${esc(root.reorder_level??0)}"></div>
        <div><label>Unit cost £ / tin (optional)</label><input id="variantCost859" type="number" min="0" step="0.01" value="${esc(defaultCost)}"></div>
      </div>
      <div id="variantCreateMsg859" class="notice compact" hidden></div>
      <div class="actions"><button class="btn ghost" type="button" data-close-variant-859>Cancel</button><button class="btn" type="button" id="createVariant859">Create variant</button></div>`);
    wireVariantSize859();
    const sel=document.getElementById('variantSize859'),code=document.getElementById('variantCode859'),qr=document.getElementById('variantQr859');
    let codeTouched=false,qrTouched=false;const base=baseCode859(root.item_code);
    code.addEventListener('input',()=>codeTouched=true);qr.addEventListener('input',()=>qrTouched=true);
    const setCode=()=>{const size=variantSelectedSize859();if(!size)return;const v=`${base}-${sizeToken859(size)}`;if(!codeTouched)code.value=v;if(!qrTouched)qr.value=v;};
    sel.addEventListener('change',setCode);document.getElementById('variantSize859Custom')?.addEventListener('input',setCode);
    document.getElementById('createVariant859').onclick=async()=>{
      const size=variantSelectedSize859(),btn=document.getElementById('createVariant859'),msg=document.getElementById('variantCreateMsg859');
      if(!(size>0)){msg.hidden=false;msg.className='notice compact error';msg.textContent='Choose a tin / can size.';return}
      if([...used].some(v=>Math.abs(v-size)<1e-9)){msg.hidden=false;msg.className='notice compact error';msg.textContent=`${prettyLitres(size)} already exists in this variant family.`;return}
      const itemCode=clean(code.value),qrValue=clean(qr.value)||itemCode;if(!itemCode){msg.hidden=false;msg.className='notice compact error';msg.textContent='Enter a variant item code.';return}
      btn.disabled=true;btn.textContent='Creating…';
      try{
        const sb=getClient(),{data:{user}}=await sb.auth.getUser();
        const payload={
          parent_item_id:root.id,variant_label:prettyLitres(size),name:root.name,item_code:itemCode,qr_value:qrValue,category:root.category,
          container_size_litres:size,reorder_level:Number(document.getElementById('variantReorder859').value||0),
          unit_cost:document.getElementById('variantCost859').value===''?null:Number(document.getElementById('variantCost859').value),
          default_location_id:root.default_location_id||null,primary_photo_path:root.primary_photo_path||null,is_chemical:!!root.is_chemical,
          risk_rating:root.risk_rating||'NONE',acknowledgement_required:root.acknowledgement_required!==false,active:true,created_by:user?.id||null
        };
        const {data,error}=await sb.from('items').insert(payload).select('id').single();if(error)throw error;
        variantItemsCacheAt859=0;notify(`${prettyLitres(size)} variant created.`);variantModalClose859();
        await new Promise(r=>setTimeout(r,250));await openVariantInBase859(data.id);
      }catch(err){msg.hidden=false;msg.className='notice compact error';msg.textContent=err?.message||String(err);btn.disabled=false;btn.textContent='Create variant';}
    };
  }

  async function showLinkExistingVariant859(item){
    const items=await variantItems859(true),root=variantRoot859(item,items);if(!root)return;
    const childParents=new Set(items.filter(x=>x.parent_item_id).map(x=>x.parent_item_id));
    const candidates=items.filter(x=>x.active!==false&&!sameId(x.id,root.id)&&!x.parent_item_id&&!childParents.has(x.id)&&isPaintCategory(x.category));
    const opts=candidates.map(x=>`<option value="${x.id}">${esc(x.name)} · ${esc(x.item_code)}${x.container_size_litres?` · ${esc(prettyLitres(x.container_size_litres))}`:''}</option>`).join('');
    variantModal859(`Link existing item · ${root.name}`,`
      <div class="notice compact"><strong>Use only for the exact same paint product/colour/base.</strong> Existing stock and history stay with the item; it simply becomes a size variant of this product.</div>
      <label>Existing paint item<select id="linkVariantItem859"><option value="">Select item</option>${opts}</select></label>
      <div id="linkVariantSizeWrap859" style="margin-top:.7rem"><label>Size if not already set</label>${variantSizeSelect859('linkVariantSize859')}</div>
      <label style="margin-top:.7rem">Notes (optional)<input id="linkVariantNote859" placeholder="e.g. same Dulux Trade Vinyl Matt White"></label>
      <div id="linkVariantMsg859" class="notice compact" hidden></div>
      <div class="actions"><button class="btn ghost" type="button" data-close-variant-859>Cancel</button><button class="btn" type="button" id="confirmLinkVariant859">Link as variant</button></div>`);
    wireVariantSize859('linkVariantSize859');
    const select=document.getElementById('linkVariantItem859');
    select.addEventListener('change',()=>{const x=items.find(i=>sameId(i.id,select.value));if(x?.container_size_litres){const size=Number(x.container_size_litres),s=document.getElementById('linkVariantSize859');if(PAINT_SIZE_OPTIONS.some(v=>Math.abs(v-size)<1e-9))s.value=String(size);else{s.value='CUSTOM';document.getElementById('linkVariantSize859Custom').value=String(size)}s.dispatchEvent(new Event('change'));}});
    document.getElementById('confirmLinkVariant859').onclick=async()=>{
      const target=items.find(x=>sameId(x.id,select.value)),msg=document.getElementById('linkVariantMsg859');if(!target){msg.hidden=false;msg.className='notice compact error';msg.textContent='Select an existing item.';return}
      const size=Number(target.container_size_litres)||variantSelectedSize859('linkVariantSize859');if(!(size>0)){msg.hidden=false;msg.className='notice compact error';msg.textContent='Set the tin / can size.';return}
      if(!confirm(`Link ${target.name} · ${target.item_code} (${prettyLitres(size)}) as a variant of ${root.name}? Existing stock and transaction history will be kept.`))return;
      const {error}=await getClient().from('items').update({parent_item_id:root.id,variant_label:prettyLitres(size),container_size_litres:size}).eq('id',target.id);if(error){msg.hidden=false;msg.className='notice compact error';msg.textContent=error.message;return}
      variantItemsCacheAt859=0;variantModalClose859();notify('Existing item linked as a variant.');await new Promise(r=>setTimeout(r,250));enhance();
    };
  }

  async function openVariantInBase859(id){
    variantModalClose859();
    document.querySelector('.modal .close')?.click();
    const items=await variantItems859(),target=items.find(x=>sameId(x.id,id));if(!target)return;
    const nav=document.querySelector('[data-page="items"]');if(nav)nav.click();
    await new Promise(r=>setTimeout(r,120));
    const search=document.getElementById('itemSearch');if(search){search.value=target.item_code;search.dispatchEvent(new Event('input',{bubbles:true}));}
    await new Promise(r=>setTimeout(r,100));
    const row=document.querySelector(`[data-item="${String(id)}"]`);if(row)row.click();else notify(`Variant ${target.item_code} is ready. Search for it under Items.`);
  }

  async function enhanceVariantDetail859(){
    const modal=document.querySelector('.modal'),stockBtn=modal?.querySelector('[data-stock-action]');if(!modal||!stockBtn||modal.querySelector('.variant-family-859'))return;
    const code=clean(modal.querySelector('header .muted')?.textContent||'').replace(/\s*·\s*Archived\s*$/i,'').trim();if(!code)return;
    const items=await variantItems859(),item=items.find(x=>x.item_code===code);if(!item||!isPaintCategory(item.category)||!(Number(item.container_size_litres)>0))return;
    const root=variantRoot859(item,items),family=variantFamily859(item,items),balances=await variantBalances859(family.map(x=>x.id));
    const totalLitres=family.reduce((a,x)=>a+(balances.get(x.id)||0)*Number(x.container_size_litres||0),0);
    const canManage=!!modal.querySelector('#editItemBtn');
    const panel=document.createElement('div');panel.className='card variant-family-859';panel.innerHTML=`
      <div class="row-between"><div><h3>Paint size variants</h3><p class="muted">Same product, separate stock by tin size. Total nominal paint across all sizes: <strong>${esc(prettyLitres(totalLitres))}</strong>.</p></div>${canManage?`<div class="actions compact"><button class="btn" type="button" data-add-variant-859="${root.id}">Add size</button><button class="btn ghost" type="button" data-link-variant-859="${root.id}">Link existing</button></div>`:''}</div>
      <div class="variant-grid-859">${family.map(v=>{const tins=balances.get(v.id)||0,size=Number(v.container_size_litres||0),current=sameId(v.id,item.id);return `<button type="button" class="variant-card-859 ${current?'current':''}" data-open-variant-859="${v.id}" ${current?'disabled':''}><strong>${esc(prettyLitres(size)||v.variant_label||'Variant')}</strong><span>${esc(prettyQty(tins))} tin${Math.abs(tins-1)<1e-9?'':'s'} · ${esc(prettyLitres(tins*size))}</span><small>${esc(v.item_code)} · reorder ${esc(prettyQty(v.reorder_level||0))}${current?' · current':''}</small></button>`}).join('')}</div>
      <p class="muted" style="margin-top:.6rem">Each size keeps its own QR code, suppliers, cost, reorder level, purchase orders and usage history. Safety Bridge links are inherited from the parent product.</p>`;
    const supplier=[...modal.querySelectorAll('.card')].find(c=>/Suppliers & orders/i.test(c.textContent||''));if(supplier)supplier.insertAdjacentElement('beforebegin',panel);else modal.querySelector('.split')?.insertAdjacentElement('afterend',panel);
  }

  async function enhanceInventoryRows859(){
    const rows=[...document.querySelectorAll('.inventory-item-row[data-item]')];if(!rows.length)return;
    const items=await variantItems859();
    const childCount=new Map();for(const x of items)if(x.parent_item_id&&x.active!==false)childCount.set(x.parent_item_id,(childCount.get(x.parent_item_id)||0)+1);
    for(const row of rows){if(row.dataset.variant859)return;const item=items.find(x=>sameId(x.id,row.dataset.item));if(!item)continue;row.dataset.variant859='1';if(!isPaintCategory(item.category)||!(Number(item.container_size_litres)>0))continue;
      const title=row.querySelector('.item-title');if(title){const b=document.createElement('span');b.className='badge paint-size-list-859';b.textContent=prettyLitres(item.container_size_litres);title.append(' ',b);if(item.parent_item_id){const v=document.createElement('span');v.className='badge muted';v.textContent='Variant';title.append(' ',v)}else if(childCount.get(item.id)){const v=document.createElement('span');v.className='badge good';v.textContent=`${childCount.get(item.id)+1} sizes`;title.append(' ',v)}}
    }
  }

  async function enhanceSafetyBridgeVariants859(){
    const sel=document.getElementById('safetyBridgeItem');if(!sel||sel.dataset.variants859)return;sel.dataset.variants859='1';const items=await variantItems859();
    for(const opt of [...sel.options]){const item=items.find(x=>sameId(x.id,opt.value));if(!item)continue;if(item.parent_item_id){const root=items.find(x=>sameId(x.id,item.parent_item_id));opt.disabled=true;opt.textContent=`↳ ${item.name} · ${prettyLitres(item.container_size_litres)} — inherits ${root?.name||'parent'}`;}else{const count=items.filter(x=>sameId(x.parent_item_id,item.id)&&x.active!==false).length;if(count)opt.textContent=`${item.name} — variant parent (${count+1} sizes)`;}}
  }
  // ---------------------------------------------------------------------------
  function updateVersionLabels(){
    document.querySelectorAll('.app-version-badge').forEach(el=>{if(el.textContent!==`v${VERSION}`)el.textContent=`v${VERSION}`;});
  }

  function enhance(){
    updateVersionLabels();
    const itemForm=document.getElementById('itemForm');if(itemForm)enhanceItemForm(itemForm).catch(console.warn);
    const stockForm=document.getElementById('stockActionForm');if(stockForm)enhanceStockActionForm(stockForm).catch(console.warn);
    enhanceItemDetail().catch(console.warn);
    enhanceVariantDetail859().catch(console.warn);
    enhanceInventoryRows859().catch(console.warn);
    enhanceSafetyBridgeVariants859().catch(console.warn);
  }

  document.addEventListener('click',e=>{
    const closeVariant=e.target.closest('[data-close-variant-859]');if(closeVariant){e.preventDefault();e.stopPropagation();variantModalClose859();return;}
    const openVariant=e.target.closest('[data-open-variant-859]');if(openVariant){e.preventDefault();e.stopPropagation();openVariantInBase859(openVariant.dataset.openVariant859).catch(console.warn);return;}
    const addVariant=e.target.closest('[data-add-variant-859]');if(addVariant){e.preventDefault();e.stopPropagation();itemById(addVariant.dataset.addVariant859).then(showAddVariant859).catch(console.warn);return;}
    const linkVariant=e.target.closest('[data-link-variant-859]');if(linkVariant){e.preventDefault();e.stopPropagation();itemById(linkVariant.dataset.linkVariant859).then(showLinkExistingVariant859).catch(console.warn);return;}
    const item=e.target.closest('[data-item]');if(item?.dataset.item)currentItemId=item.dataset.item;
    const stock=e.target.closest('[data-stock-action]');if(stock)readCurrentDetailContext(stock);
  },true);

  addStyles();
  loadBase().then(()=>{
    enhance();
    new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});
  }).catch(err=>{console.error(err);const app=document.getElementById('app');if(app)app.innerHTML='<div class="card notice error">Inventory Tracker could not load. Refresh and try again.</div>';});
})();
