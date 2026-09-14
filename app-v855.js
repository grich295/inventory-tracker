/* Inventory Tracker v8.5.5
   Patch over v8.5.3 stable app.
   Add/Use Stock: compact quantity box + whole-unit quick arrows.
*/
(() => {
  'use strict';

  function loadBase() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'app.js?v=853';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load Inventory Tracker base app.'));
      document.head.appendChild(s);
    });
  }

  function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .qty-stepper-855{
        display:flex;
        align-items:center;
        gap:9px;
        margin-top:5px;
      }
      .qty-stepper-855 #actionQty{
        width:78px !important;
        min-width:78px !important;
        max-width:78px !important;
        height:48px;
        margin:0 !important;
        text-align:center;
        font-size:18px;
        font-weight:800;
      }
      .qty-stepper-btn-855{
        width:52px;
        height:48px;
        min-width:52px;
        border:0;
        border-radius:10px;
        color:#fff;
        font-size:22px;
        font-weight:900;
        line-height:1;
        cursor:pointer;
        touch-action:manipulation;
        box-shadow:0 2px 5px rgba(0,0,0,.16);
      }
      .qty-stepper-down-855{background:#c62828;}
      .qty-stepper-up-855{background:#218838;}
      .qty-stepper-btn-855:active{transform:translateY(1px);box-shadow:none;}
      .qty-stepper-btn-855:disabled{opacity:.45;}
    `;
    document.head.appendChild(style);
  }

  function enhance() {
    const form = document.getElementById('stockActionForm');
    const input = document.getElementById('actionQty');
    if (!form || !input || input.dataset.stepper855) return;

    const type = String(form.dataset.type || '').toUpperCase();
    if (type !== 'ADD' && type !== 'USE') return;

    input.dataset.stepper855 = '1';

    const wrap = document.createElement('div');
    wrap.className = 'qty-stepper-855';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'qty-stepper-btn-855 qty-stepper-down-855';
    down.textContent = '▼';
    down.title = 'Decrease by 1';
    down.setAttribute('aria-label','Decrease quantity by 1');

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'qty-stepper-btn-855 qty-stepper-up-855';
    up.textContent = '▲';
    up.title = 'Increase by 1';
    up.setAttribute('aria-label','Increase quantity by 1');

    wrap.appendChild(down);
    wrap.appendChild(up);

    function change(delta){
      let current = Number(input.value);
      if (!Number.isFinite(current)) current = 0;

      // Arrow operation is always a whole unit.
      let next = Math.trunc(current) + delta;
      if (delta > 0 && input.value === '') next = 1;

      const minAttr = Number(input.min);
      const min = Number.isFinite(minAttr) && input.min !== '' ? Math.max(1, Math.ceil(minAttr)) : 1;
      if (next < min) next = min;

      if (input.max !== '') {
        const max = Math.floor(Number(input.max));
        if (Number.isFinite(max)) next = Math.min(next, max);
      }

      input.value = String(next);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }

    down.addEventListener('click',()=>change(-1));
    up.addEventListener('click',()=>change(1));
  }

  addStyles();
  loadBase().then(() => {
    enhance();
    new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});
  }).catch(console.error);
})();
