/* Inventory Tracker v8.5.4
   Patch over v8.5.3.
   Adds quick +1 / -1 buttons beside the existing quantity input
   for ADD and USE stock actions. The original text/number box remains unchanged.
*/
(() => {
  'use strict';

  const BASE_APP = 'app.js?v=853';

  function loadBase() {
    return new Promise((resolve, reject) => {
      if (window.__INVENTORY_BASE_853_LOADED) return resolve();
      const s = document.createElement('script');
      s.src = BASE_APP;
      s.onload = () => {
        window.__INVENTORY_BASE_853_LOADED = true;
        resolve();
      };
      s.onerror = () => reject(new Error('Could not load Inventory Tracker v8.5.3 base app.'));
      document.head.appendChild(s);
    });
  }

  function injectCss() {
    if (document.getElementById('qtyStepper854Styles')) return;
    const style = document.createElement('style');
    style.id = 'qtyStepper854Styles';
    style.textContent = `
      .qty-stepper-854{
        display:grid;
        grid-template-columns:minmax(0,1fr) 52px 52px;
        gap:8px;
        align-items:stretch;
        margin-top:4px;
      }
      .qty-stepper-854 > #actionQty{
        width:100%;
        margin:0;
      }
      .qty-stepper-btn-854{
        min-height:48px;
        border:1px solid rgba(15,23,42,.18);
        border-radius:10px;
        background:#fff;
        color:#0f172a;
        font-size:22px;
        font-weight:800;
        line-height:1;
        touch-action:manipulation;
        user-select:none;
        -webkit-user-select:none;
      }
      .qty-stepper-btn-854:active{
        transform:translateY(1px);
      }
      .qty-stepper-btn-854:disabled{
        opacity:.45;
      }
      @media(max-width:520px){
        .qty-stepper-854{
          grid-template-columns:minmax(0,1fr) 50px 50px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function decimalPlaces(step) {
    const s = String(step || '');
    return s.includes('.') ? s.split('.')[1].length : 0;
  }

  function normalise(n, places) {
    if (!Number.isFinite(n)) return '';
    return String(Number(n.toFixed(Math.max(0, places))));
  }

  function installStepper() {
    const form = document.getElementById('stockActionForm');
    const input = document.getElementById('actionQty');
    if (!form || !input || input.dataset.stepper854 === '1') return;

    const type = String(form.dataset.type || '').toUpperCase();
    if (!['ADD', 'USE'].includes(type)) return;

    input.dataset.stepper854 = '1';

    const wrap = document.createElement('div');
    wrap.className = 'qty-stepper-854';

    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'qty-stepper-btn-854';
    down.setAttribute('aria-label', 'Decrease quantity by 1');
    down.textContent = '▼';

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'qty-stepper-btn-854';
    up.setAttribute('aria-label', 'Increase quantity by 1');
    up.textContent = '▲';

    wrap.appendChild(down);
    wrap.appendChild(up);

    const change = delta => {
      if (input.disabled) return;

      const min = input.min === '' ? 0 : Number(input.min);
      const max = input.max === '' ? Infinity : Number(input.max);
      const current = input.value === '' ? 0 : Number(input.value);

      let next = (Number.isFinite(current) ? current : 0) + delta;

      // For Add/Use, never allow zero or negative via the quick buttons.
      // If the box is empty, ▲ starts at 1. ▼ from an empty/1 value stays at 1.
      const floor = Number.isFinite(min) ? Math.max(min, 0.01) : 0.01;
      if (delta > 0 && input.value === '') next = 1;
      if (next < floor) next = floor;
      if (Number.isFinite(max)) next = Math.min(next, max);

      const places = Math.max(decimalPlaces(input.step), 2);
      input.value = normalise(next, places);

      // Existing Inventory Tracker listeners update availability/validation.
      input.dispatchEvent(new Event('input', { bubbles:true }));
      input.dispatchEvent(new Event('change', { bubbles:true }));
      input.focus({ preventScroll:true });
    };

    down.addEventListener('click', () => change(-1));
    up.addEventListener('click', () => change(1));
  }

  function startObserver() {
    installStepper();
    const obs = new MutationObserver(() => installStepper());
    obs.observe(document.body, { childList:true, subtree:true });
  }

  injectCss();
  loadBase()
    .then(startObserver)
    .catch(err => {
      console.error(err);
      const app = document.getElementById('app');
      if (app) app.innerHTML = `<div class="card"><h2>Inventory Tracker</h2><p>${err.message}</p></div>`;
    });
})();
