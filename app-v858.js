/* Inventory Tracker v8.5.8 CLEAN
   Paint tin sizes + half-tin stock tracking.
   Patch over v8.5.7 base app.js.
*/
(() => {
  'use strict';

  const VERSION='8.5.8';
  const PAINT_SIZE_OPTIONS=[0.25,0.5,0.75,1,2.5,5,7.5,10,12,15,20];
  let paintClient=null;
  let currentItemId=null;
  let currentItemCode='';
  let lastDetailKey='';

  function loadBase(){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='app.js?v=858';
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
      @media(max-width:560px){.paint-qty-tools-858{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  async function itemByCode(code){
    const sb=getClient();if(!sb||!code)return null;
    const {data,error}=await sb.from('items').select('id,item_code,name,category,container_size_litres').eq('item_code',code).maybeSingle();
    if(error){console.warn('Paint metadata lookup failed',error);return null}return data||null;
  }
  async function itemById(id){
    const sb=getClient();if(!sb||!id)return null;
    const {data,error}=await sb.from('items').select('id,item_code,name,category,container_size_litres').eq('id',id).maybeSingle();
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
    wrap.innerHTML=`<label>Paint tin / can size</label><select id="paintTinSize858">${sizeOptionsHtml(null)}</select><div id="paintTinCustomWrap858" hidden style="margin-top:.5rem"><label>Custom size (litres)</label><input id="paintTinCustom858" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="e.g. 3"></div><div class="muted paint-size-help-858">Stock is counted as tins, so you can hold 0.5, 1, 1.5 tins etc. The app also shows the nominal litres.</div>`;
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

  function updateVersionLabels(){
    document.querySelectorAll('.app-version-badge').forEach(el=>{if(el.textContent!==`v${VERSION}`)el.textContent=`v${VERSION}`;});
  }

  function enhance(){
    updateVersionLabels();
    const itemForm=document.getElementById('itemForm');if(itemForm)enhanceItemForm(itemForm).catch(console.warn);
    const stockForm=document.getElementById('stockActionForm');if(stockForm)enhanceStockActionForm(stockForm).catch(console.warn);
    enhanceItemDetail().catch(console.warn);
  }

  document.addEventListener('click',e=>{
    const item=e.target.closest('[data-item]');if(item?.dataset.item)currentItemId=item.dataset.item;
    const stock=e.target.closest('[data-stock-action]');if(stock)readCurrentDetailContext(stock);
  },true);

  addStyles();
  loadBase().then(()=>{
    enhance();
    new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});
  }).catch(err=>{console.error(err);const app=document.getElementById('app');if(app)app.innerHTML='<div class="card notice error">Inventory Tracker could not load. Refresh and try again.</div>';});
})();
