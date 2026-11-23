/* Pełna dowolność:
   1. kafelek „Własny HTML” – HTML z wartościami {{encja}} i atrybutami data-*,
   2. tryb „Własny kod” – cały ekran z Twojego HTML + CSS + JS,
   3. tryb „Moduł z pliku” – gotowy element JS (jak panel_custom w HA), np. /local/tablet-dashboard/…

   W JS dostępne są:  root – korzeń Twojego HTML,  hass – jak w kartach HA,  panel – funkcje panelu. */
(function () {
  const P = Panel, esc = P.esc;

  /** {{sensor.x}}, {{sensor.x.attributes.y}}, {{sensor.x|1}} (miejsca po przecinku), {{name:sensor.x}} */
  function fill(html) {
    return String(html || '').replace(/\{\{\s*(name:)?([a-z0-9_]+\.[a-z0-9_]+)(?:\.attributes\.([A-Za-z0-9_]+))?(?:\|(\d))?\s*\}\}/g, (m, name, id, a, digits) => {
      if (name) return esc(P.name(id));
      if (!a) return P.value(id, digits);
      const s = P.state(id), v = s && s.attributes[a];
      return v == null ? '–' : esc(typeof v === 'number' && digits !== undefined ? v.toFixed(+digits) : v);
    });
  }
  const idsIn = text => [...new Set((String(text || '').match(/\b[a-z][a-z0-9_]*\.[a-z0-9_]+\b/g) || []))];

  /** data-toggle="light.x" · data-service="script.turn_on" data-entity="script.x" data-json='{…}' · data-page="Nazwa"
      data-state="light.x" ustawia klasę „is-on” i atrybut state, wygodne do stylowania w CSS. */
  function bind(root) {
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-toggle],[data-service],[data-page]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.page) return P.goto(b.dataset.page);
      if (b.dataset.toggle) return P.service('homeassistant.toggle', { entity_id: b.dataset.toggle });
      let data = {};
      try { data = JSON.parse(b.dataset.json || '{}'); } catch (err) { return P.toast('Błędny data-json', true); }
      if (b.dataset.entity) data.entity_id = b.dataset.entity;
      P.service(b.dataset.service, data);
    });
  }
  function paint(root) {
    root.querySelectorAll('[data-state]').forEach(n => {
      const id = n.dataset.state;
      n.classList.toggle('is-on', P.isOn(id));
      n.setAttribute('state', P.ok(id) ? P.state(id).state : 'unavailable');
    });
    root.querySelectorAll('[data-text]').forEach(n => { const v = fill('{{' + n.dataset.text + '}}'); if (n.innerHTML !== v) n.innerHTML = v; });
  }

  P.widget('custom', {
    name: 'Własny HTML', icon: 'text', group: 'Własne', size: [3, 2], noEntity: true, noIcon: true,
    fields: [{ k: 'html', l: 'HTML: {{sensor.x}}, data-toggle="light.x"', t: 'code' }, { k: 'css', l: 'CSS (tylko ten kafelek)', t: 'code' }],
    entities: t => idsIn(t.html).filter(id => P.state(id) || /^(sensor|binary_sensor|switch|light|weather|climate|cover|camera|input_|media_player|person|group|script|number|select|lock|fan|sun)/.test(id)),
    mount(el) { el._root = el.attachShadow({ mode: 'open' }); bind(el._root); },
    update(el, t) {
      const html = '<style>:host{font:inherit}*{box-sizing:border-box}' + String(t.css || '').replace(/<\/style/gi, '') + '</style>' + fill(t.html || '<b>Własny HTML</b>');
      if (el._html !== html) { el._root.innerHTML = html; el._html = html; }
      paint(el._root);
    },
  });

  /* ---------- obiekt hass zgodny z kartami HA ---------- */
  const SAFE = /^(weather\/subscribe_forecast|history\/|recorder\/|get_states|get_config|get_services|calendar\/|config\/(area|device|entity)_registry\/list)/;
  function makeHass() {
    const ha = P.ha, states = {};
    Object.keys(ha.states).forEach(id => { states[id] = Object.assign({ entity_id: id, last_changed: '', last_updated: '' }, ha.states[id]); });
    const ws = msg => ha.preview && !SAFE.test(msg.type) ? Promise.reject(new Error('Niedostępne w podglądzie')) : ha.ws(msg);
    return {
      states, connected: ha.online, language: 'pl', locale: { language: 'pl' }, themes: { darkMode: true }, user: ha.user || { name: 'Panel', is_admin: false },
      config: ha.config || {}, localize: k => k,
      callService: (d, s, data, target) => ha.preview ? Promise.resolve() : ha.call(d, s, Object.assign({}, data, target)),
      callWS: ws,
      hassUrl: p => p || '/',
      formatEntityState: s => P.value(s.entity_id).replace(/<[^>]*>/g, ''),
      connection: {
        sendMessagePromise: ws, sendMessage: m => { ws(m).catch(() => {}); },
        subscribeMessage: (cb, msg) => ha.preview && !SAFE.test(msg.type) ? Promise.resolve(() => {}) : ha.sub(msg, cb),
        subscribeEvents: (cb, type) => ha.preview ? Promise.resolve(() => {}) : ha.sub({ type: 'subscribe_events', event_type: type }, cb),
        addEventListener: (n, cb) => { ha.listeners.push([n, cb]); }, removeEventListener: (n, cb) => { ha.listeners = ha.listeners.filter(l => l[1] !== cb); },
      },
    };
  }

  // Lekki zamiennik <ha-icon>, żeby moduły napisane pod HA miały ikony.
  if (!customElements.get('ha-icon')) {
    customElements.define('ha-icon', class extends HTMLElement {
      static get observedAttributes() { return ['icon']; }
      attributeChangedCallback() { this.draw(); }
      connectedCallback() { this.draw(); }
      set icon(v) { this.setAttribute('icon', v || ''); }
      get icon() { return this.getAttribute('icon'); }
      draw() {
        const m = /^mdi:([a-z0-9-]+)$/.exec(this.getAttribute('icon') || '');
        this.style.cssText = 'display:inline-flex;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);' + (this.getAttribute('style') || '').replace(/display:inline-flex;width:var\(--mdc-icon-size,24px\);height:var\(--mdc-icon-size,24px\);/g, '');
        if (!m) return;
        DP.mdiPath(m[1]).then(d => { this.innerHTML = '<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:currentColor"><path d="' + esc(d || '') + '"/></svg>'; }, () => {});
      }
    });
  }

  let host = null, timer = null, current = null;
  const api = P.code = {
    fill, idsIn, makeHass,
    /** Uruchamia tryb kodu/modułu w podanym elemencie. */
    async mount(el, dash) {
      api.unmount();
      const box = host = document.createElement('div');
      box.className = 'code-host';
      el.replaceChildren(box);
      const listeners = [];
      current = { dash, listeners, app: null, root: null };
      const mine = current;
      try {
        if (dash.mode === 'module') {
          if (!dash.module) throw new Error('Podaj adres modułu w edytorze');
          const u = new URL(dash.module, location.origin);
          if (P.ha.preview) u.searchParams.set('preview', Date.now());
          await import(u.href);
          if (mine !== current) return;
          if (!dash.element) throw new Error('Podaj nazwę elementu, np. tablet-dashboard');
          await Promise.race([customElements.whenDefined(dash.element), new Promise((r, j) => setTimeout(() => j(new Error('Moduł nie zdefiniował elementu ' + dash.element)), 8000))]);
          if (mine !== current) return;
          const app = document.createElement(dash.element);
          app.hass = makeHass(); app.panel = { config: {}, url_path: 'panelpilot' }; app.narrow = P.format !== 'landscape';
          mine.app = app;
          box.append(app);
        } else {
          const root = mine.root = box.attachShadow({ mode: 'open' });
          root.innerHTML = '<style>:host{display:block;height:100%}*{box-sizing:border-box}' + String(dash.css || '').replace(/<\/style/gi, '') + '</style>' + (dash.html || '');
          bind(root); paint(root);
          const panel = {
            onState: fn => listeners.push(fn), value: P.value, state: P.state, isOn: P.isOn, service: P.service, toast: P.toast, confirm: P.confirm,
            sensors: P.sensors, get format() { return P.format; }, doorbell: () => P.doorbell.open(), icon: P.icon, forecast: (id, cb) => P.ha.forecast(id, cb), history: (id, h) => P.ha.history(id, h),
          };
          const r = new Function('root', 'hass', 'panel', '"use strict";' + (dash.code || ''))(root, makeHass(), panel);
          if (typeof r === 'function') mine.stop = r;
        }
      } catch (e) {
        console.error(e);
        // W trybie kodu treść jest w shadow DOM i zasłania zwykłe dzieci.
        const note = '<div style="position:absolute;left:8px;right:8px;bottom:8px;padding:12px;border-radius:12px;background:#8a3a29;color:#fff;font:15px sans-serif"><b>Błąd w kodzie pulpitu</b><br>' + esc(e.message) + '</div>';
        if (mine === current) (mine.root ? mine.root.lastElementChild : box).insertAdjacentHTML(mine.root ? 'afterend' : 'beforeend', note);
      }
    },
    update(changed) {
      if (!current || timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (!current) return;
        const hass = makeHass();
        if (current.app) current.app.hass = hass;
        if (current.root) paint(current.root);
        current.listeners.forEach(f => { try { f(hass, changed); } catch (e) { console.error(e); } });
      }, 120);
    },
    unmount() {
      if (current && current.stop) { try { current.stop(); } catch (e) { console.error(e); } }
      current = null; if (host) host.remove(); host = null;
    },
  };
})();
