/* Edytor pulpitów w menu bocznym Home Assistanta.
   Podgląd to prawdziwy panel w ramce, więc widać dokładnie to, co będzie na ścianie. */
import { SAMPLE } from './samples.js';
import { h, field, group, check, text, select, clone, uid } from './ui.js';

const BASE = new URL('.', import.meta.url);
const GAP = 8;
const LAYOUTS = [['column', 'Ikona nad tekstem'], ['row', 'Ikona obok tekstu'], ['center', 'Wszystko na środku']];
const ICON_SIZES = [['S', 'Mała'], ['M', 'Zwykła'], ['L', 'Duża'], ['XL', 'Bardzo duża'], ['XXL', 'Ogromna']];

class PanelPilotEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.tab = 'tiles'; this.fmt = 'portrait'; this.page = 0; this.sel = null;
    this.undo = []; this.redo = []; this.dirty = false; this.bellDirty = false;
  }

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!old) { if (this.isConnected) this.init(); return; }
    if (old.states === hass.states || !this.win) return;
    this._changed = this._changed || new Set();
    Object.keys(hass.states).forEach(id => { if (hass.states[id] !== old.states[id]) this._changed.add(id); });
    if (this._push) return;
    this._push = setTimeout(() => {
      this._push = null;
      if (!this.win) return;
      this.win.Panel.setPreview({ states: this._hass.states, changed: this._changed });
      this._changed = new Set();
    }, 500);
  }
  get hass() { return this._hass; }
  set panel(p) { this._panel = p; }
  set narrow(v) { this._narrow = v; }

  connectedCallback() {
    this._leave = e => { if (this.dirty || this.bellDirty) { e.preventDefault(); e.returnValue = ''; } };
    this._keys = e => this.onKey(e);
    this._size = () => this.fit();
    addEventListener('beforeunload', this._leave);
    addEventListener('keydown', this._keys);
    addEventListener('resize', this._size);
    if (this._hass) this.init();
  }
  disconnectedCallback() {
    removeEventListener('beforeunload', this._leave);
    removeEventListener('keydown', this._keys);
    removeEventListener('resize', this._size);
    this.closePop();
    if (this._unsub) this._unsub.then(f => f(), () => {});
    this._unsub = null; this.win = null; this._ready = false; this.data = null;
  }

  init() {
    if (this._unsub) return;
    const v = import.meta.url.split('?')[1] || '';
    this.shadowRoot.replaceChildren(h('link', { rel: 'stylesheet', href: new URL('editor.css?' + v, BASE).href }), h('p', { style: 'padding:24px' }, 'Ładowanie edytora…'));
    this.frame = h('iframe', { title: 'Podgląd panelu', src: new URL('index.html?preview', BASE).href });
    this._unsub = this.hass.connection.subscribeMessage(d => this.onData(d), { type: 'panelpilot/admin/subscribe' });
    this._unsub.catch(e => this.shadowRoot.replaceChildren(h('p', { style: 'padding:24px' }, 'Integracja PanelPilot nie odpowiada: ' + (e.message || e.code))));
  }

  onData(d) {
    const first = !this.data;
    this.data = d;
    if (!this.bellDirty) this.bell = clone(d.doorbell);
    // Ktoś przyszedł z powiadomienia o nowym panelu: od razu zakładka z kodem.
    if (first && d.pairing.length) this.tab = 'panels';
    if (first) { this.openDash(Object.keys(d.dashboards)[0]); this.build(); return; }
    if (!d.dashboards[this.dashId]) this.openDash(Object.keys(d.dashboards)[0]);
    else if (!this.dirty && d.dashboards[this.dashId].rev > this.rev) this.openDash(this.dashId);
    this.header();
    const active = this.shadowRoot.activeElement;
    if (this.tab === 'panels' && !(active && active.matches('input,select'))) this.renderBody();
  }

  openDash(id) {
    const same = id === this.dashId;
    this.dashId = id;
    this.doc = clone(this.data.dashboards[id]);
    this.rev = this.doc.rev; delete this.doc.rev;
    this.undo = []; this.redo = []; this.dirty = false; this.sel = null;
    this.page = same ? Math.min(this.page, this.doc.pages.length - 1) : 0;
    this.doc.pages.forEach(p => p.tiles.forEach(t => { t.id = t.id || uid(); t.l = t.l || {}; }));
    if (this._ready) { this.header(); this.renderBody(); this.refresh(); }
  }

  /* ---------- zmiany ---------- */
  commit(fn, opts) {
    const o = opts || {};
    // Pisanie w jednym polu to jeden krok cofania.
    if (!(o.key && o.key === this._lastKey && Date.now() - this._lastAt < 1500)) { this.undo.push(JSON.stringify(this.doc)); if (this.undo.length > 80) this.undo.shift(); }
    this._lastKey = o.key; this._lastAt = Date.now();
    this.redo = [];
    fn();
    this.dirty = true;
    this.header(); this.refresh();
    if (!o.quiet) this.renderSides();
  }
  back(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(from.pop());
    this.page = Math.min(this.page, this.doc.pages.length - 1);
    this._lastKey = null; this.dirty = true;
    this.header(); this.renderBody(); this.refresh();
  }

  async save() {
    if (this._saving) return;
    this._saving = true;
    try {
      if (this.dirty) {
        const before = JSON.stringify(this.doc);
        const r = await this.hass.callWS({ type: 'panelpilot/admin/dashboard_save', dashboard_id: this.dashId, rev: this.rev, data: this.doc });
        this.rev = r.rev;
        if (JSON.stringify(this.doc) === before) this.dirty = false;
      }
      if (this.bellDirty) { await this.hass.callWS({ type: 'panelpilot/admin/doorbell_save', data: this.bell }); this.bellDirty = false; }
      this.header(); this.toast('Zapisano. Panele już mają nową wersję.');
    } catch (e) {
      if (e.code === 'conflict') this.dialog('Ten pulpit zmieniono w innym oknie', h('p', {}, 'Możesz zapisać swoją wersję na wierzch albo wczytać tamtą i stracić swoje zmiany.'),
        ['Wczytaj tamtą', () => { this.dirty = false; this.openDash(this.dashId); }], ['Zapisz moją', () => { this.rev = null; this.save(); }]);
      else this.toast('Nie zapisano: ' + (e.message || e.code), true);
    } finally { this._saving = false; }
  }

  /* ---------- szkielet ---------- */
  build() {
    const link = this.shadowRoot.querySelector('link');
    this.headEl = h('header'); this.tabsEl = h('div', { class: 'tabs', role: 'tablist' }); this.bodyEl = h('div', { class: 'body' });
    this.over = h('div', { class: 'over' });
    this.screen = h('div', { class: 'screen' }, this.frame, this.over);
    this.stage = h('div', { class: 'stage' }, h('div', { class: 'device' }, this.screen));
    this.barEl = h('div', { class: 'bar' }); this.tray = h('div', { class: 'tray' });
    this.mid = h('div', { class: 'mid' }, this.barEl, this.stage, this.tray);
    this.left = h('div', { class: 'side' }); this.right = h('div', { class: 'side r' });
    this.frame.addEventListener('load', () => this.frameReady());
    this.over.addEventListener('pointerdown', e => this.onDown(e));
    this.bodyEl.append(this.left, this.mid, this.right);
    this.shadowRoot.replaceChildren(link, this.headEl, this.tabsEl, this.bodyEl);
    this._ready = true;
    this.header(); this.renderBody();
    new ResizeObserver(() => this.fit()).observe(this.stage);
  }

  frameReady() {
    const w = this.frame.contentWindow;
    if (!w || !w.Panel || !w.DP) return;
    this.win = w; this.DP = w.DP;
    const conn = this.hass.connection;
    this.bridge = {
      forecast: (id, cb) => conn.subscribeMessage(e => cb(e.forecast || []), { type: 'weather/subscribe_forecast', forecast_type: 'daily', entity_id: id }),
      history: async (id, hours) => {
        const r = await this.hass.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - hours * 36e5).toISOString(), entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false });
        return (r[id] || []).map(p => [(p.lu || p.lc) * 1000, parseFloat(p.s)]).filter(p => !isNaN(p[1]));
      },
      ws: m => this.hass.callWS(m),
      sub: (m, cb) => conn.subscribeMessage(cb, m),
    };
    this.header(); this.renderBody(); this.fit(); this.refresh();
  }

  header() {
    if (!this._ready) return;
    const dashes = Object.entries(this.data.dashboards), waiting = this.data.pairing.length, mode = this.doc.mode || 'tiles', dirty = this.dirty || this.bellDirty;
    this.headEl.replaceChildren(
      h('button', { class: 'icon', 'aria-label': 'Menu Home Assistant', onclick: () => this.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true })) }, '☰'),
      select(this.dashId, dashes.map(([id, d]) => [id, id === this.dashId ? this.doc.name : d.name]), id => this.guard(() => this.openDash(id), () => this.header())),
      h('button', { onclick: () => this.newDash() }, 'Nowy'),
      select(mode, [['tiles', 'Kafelki'], ['code', 'Własny kod (HTML, CSS, JS)'], ['module', 'Moduł JS z pliku']], v => { this.sel = null; this.commit(() => { this.doc.mode = v; }); this.tab = v === 'tiles' ? 'tiles' : 'code'; this.header(); this.renderBody(); }),
      h('span', { class: 'sp' }),
      h('button', { class: 'icon', 'aria-label': 'Cofnij', title: 'Cofnij (Ctrl+Z)', disabled: !this.undo.length, onclick: () => this.back(this.undo, this.redo) }, '↶'),
      h('button', { class: 'icon', 'aria-label': 'Ponów', title: 'Ponów (Ctrl+Y)', disabled: !this.redo.length, onclick: () => this.back(this.redo, this.undo) }, '↷'),
      h('button', { class: 'primary', disabled: !dirty, onclick: () => this.save() }, dirty ? 'Zapisz' : 'Zapisane'));
    const tiles = mode === 'tiles';
    if (!tiles && this.tab === 'tiles') this.tab = 'code';
    const tabs = [tiles && ['tiles', 'Kafelki'], ['look', 'Wygląd'], ['saver', 'Wygaszacz'], ['bell', 'Domofon'], ['code', tiles ? 'CSS i JS' : 'Kod'], ['json', 'Eksport'], ['panels', 'Panele i jasność']].filter(Boolean);
    this.tabsEl.replaceChildren(...tabs.map(([id, name]) => h('button', { role: 'tab', 'aria-selected': String(this.tab === id), onclick: () => { this.tab = id; this.sel = null; this.header(); this.renderBody(); this.refresh(); } }, name, id === 'panels' && waiting ? h('span', { class: 'badge' }, String(waiting)) : null)));
  }

  guard(fn, cancel) {
    if (!this.dirty) return fn();
    this.dialog('Niezapisane zmiany', h('p', {}, 'Zmiany w tym pulpicie nie są zapisane.'), ['Wróć', cancel], ['Odrzuć zmiany', () => { this.dirty = false; fn(); }]);
  }

  newDash() {
    let name = 'Nowy pulpit', from = 'empty';
    this.dialog('Nowy pulpit', [field('Nazwa', text(name, v => { name = v; })), field('Zacznij od', select(from, [['empty', 'Pusty'], ['copy', 'Kopia obecnego'], ['code', 'Własny kod']], v => { from = v; }))], ['Anuluj'], ['Utwórz', async () => {
      const code = from === 'code', data = from === 'copy' ? clone(this.doc) : { pages: [{ name: 'Dom', tiles: [] }], mode: code ? 'code' : 'tiles', html: code ? SAMPLE.html : '', css: code ? SAMPLE.css : '', code: code ? SAMPLE.js : '' };
      data.name = name;
      try {
        const r = await this.hass.callWS({ type: 'panelpilot/admin/dashboard_save', dashboard_id: null, data });
        this.data.dashboards[r.id] = this.data.dashboards[r.id] || Object.assign(data, { rev: r.rev });
        this.guard(() => { this.tab = data.mode === 'tiles' ? 'tiles' : 'code'; this.openDash(r.id); });
      } catch (e) { this.toast(e.message, true); }
    }]);
  }

  /* ---------- podgląd ---------- */
  fit() {
    if (!this.DP || !this.stage || !this.stage.clientWidth) return;
    const f = this.DP.FORMATS[this.fmt], pad = 28 + 24;
    const k = this.k = Math.max(0.2, Math.min((this.stage.clientWidth - pad) / f.w, (this.stage.clientHeight - pad) / f.h, 1.4));
    this.screen.style.width = f.w * k + 'px'; this.screen.style.height = f.h * k + 'px';
    this.frame.style.width = f.w + 'px'; this.frame.style.height = f.h + 'px';
    this.frame.style.transform = 'scale(' + k + ')';
    requestAnimationFrame(() => this.drawOver());
  }

  refresh() {
    clearTimeout(this._refresh);
    this._refresh = setTimeout(() => {
      if (!this.win) return;
      const pages = this.DP.pagesFor(this.doc.pages, this.fmt, this.win.Panel.widgets);
      const at = Math.max(0, pages.findIndex(p => p.page === this.page && !p.extra));
      const mode = this.tab === 'saver' ? 'saver' : this.tab === 'bell' ? 'bell' : 'page';
      this.win.Panel.setPreview({ bridge: this.bridge, states: this.hass.states, dashboard: clone(this.doc), doorbell: Object.assign({}, this.bell, { own: !!(this.bell.go2rtc && this.bell.stream) }), format: this.fmt, page: at, mode, night: this.night });
      this.drawOver();
      // Własny JS mógł dodać nowe rodzaje kafelków.
      const n = Object.keys(this.win.Panel.widgets).length;
      if (n !== this._kinds) { this._kinds = n; if (this.tab === 'tiles') this.palette(); }
    }, 60);
  }

  get tiles() { return this.doc.pages[this.page].tiles; }
  tile(id) { return this.tiles.find(t => t.id === id); }
  layout() { return this.DP.layout(this.tiles, this.fmt, this.win.Panel.widgets); }

  geo() {
    const g = this.win.document.getElementById('grid').getBoundingClientRect(), f = this.DP.FORMATS[this.fmt];
    return { x: g.left, y: g.top, cw: (g.width - GAP * (f.cols - 1)) / f.cols, ch: (g.height - GAP * (f.rows - 1)) / f.rows, f };
  }
  css(r, g) {
    const k = this.k;
    return 'left:' + (g.x + r.x * (g.cw + GAP)) * k + 'px;top:' + (g.y + r.y * (g.ch + GAP)) * k + 'px;width:' + (r.w * g.cw + (r.w - 1) * GAP) * k + 'px;height:' + (r.h * g.ch + (r.h - 1) * GAP) * k + 'px';
  }
  cell(e, g) {
    const b = this.screen.getBoundingClientRect(), k = this.k;
    return { x: ((e.clientX - b.left) / k - g.x) / (g.cw + GAP), y: ((e.clientY - b.top) / k - g.y) / (g.ch + GAP) };
  }

  drawOver() {
    if (!this.win || this._drag) return;
    const coded = this.doc.mode === 'code' || this.doc.mode === 'module';
    this.over.classList.toggle('off', coded && this.tab === 'code');
    if (this.tab !== 'tiles' || coded) { this.over.replaceChildren(); this.tray.replaceChildren(); return; }
    const g = this.geo(), { placed, overflow } = this.layout(), f = g.f;
    const lines = h('div', { class: 'gridlines', style: this.css({ x: 0, y: 0, w: f.cols, h: f.rows }, g) + ';grid-template:repeat(' + f.rows + ',1fr)/repeat(' + f.cols + ',1fr);gap:' + GAP * this.k + 'px' }, Array.from({ length: f.cols * f.rows }, () => h('i')));
    this.over.replaceChildren(lines, ...placed.map(p => h('div', { class: 'box' + (p.tile.id === this.sel ? ' sel' : ''), style: this.css(p, g), 'data-id': p.tile.id }, h('div', { class: 'hd' }))));
    if (!this.tiles.length) this.over.append(h('div', { class: 'empty' }, h('b', {}, 'Pusta strona'), h('span', {}, 'Przeciągnij kafelek z lewej albo'), h('button', { class: 'primary', onclick: () => this.wizard(), onpointerdown: e => e.stopPropagation() }, 'Wybierz, co pokazać')));
    const hidden = this.tiles.filter(t => t.l[this.fmt] === false), chip = t => h('button', { onclick: () => { this.sel = t.id; this.renderSides(); this.drawOver(); } }, this.label(t));
    this.tray.replaceChildren(...(overflow.length ? [h('span', { class: 'dim' }, 'Nie mieszczą się tutaj (na panelu trafią na dodatkową stronę):'), ...overflow.map(chip)] : []), ...(hidden.length ? [h('span', { class: 'dim' }, 'Ukryte w tym formacie:'), ...hidden.map(chip)] : []));
  }

  ename(id) { const s = this.hass.states[id]; return s && s.attributes.friendly_name || id; }
  label(t) { const w = this.win.Panel.widgets[t.type]; return t.name || (t.entity && this.ename(t.entity)) || (w && w.name) || t.type; }

  /** Przed ręczną zmianą zapamiętuje pozycje wszystkich kafelków, żeby reszta się nie przesunęła. */
  pin() { this.layout().placed.forEach(p => { p.tile.l[this.fmt] = [p.x, p.y, p.w, p.h]; }); }

  place(tile, r, from) {
    this.pin();
    const f = this.DP.FORMATS[this.fmt], list = this.layout().placed.filter(p => p.tile !== tile);
    const hit = list.filter(p => this.DP.overlaps(p, r)), keep = list.filter(p => !hit.includes(p));
    tile.l[this.fmt] = [r.x, r.y, r.w, r.h];
    const taken = keep.concat([r]);
    // Ten sam rozmiar: zamiana miejscami. Inaczej sąsiad przesuwa się na najbliższe wolne pole.
    hit.forEach(p => {
      let spot = null;
      if (from && hit.length === 1 && p.w === from.w && p.h === from.h && !this.DP.overlaps(from, r)) spot = { x: from.x, y: from.y, w: p.w, h: p.h };
      spot = spot || this.DP.freeSpot(p.w, p.h, f, taken, p);
      if (spot) { taken.push(spot); p.tile.l[this.fmt] = [spot.x, spot.y, spot.w, spot.h]; } else delete p.tile.l[this.fmt];
    });
  }

  track(move, end) {
    const stop = ev => { ['pointermove', 'pointerup', 'pointercancel'].forEach(n => removeEventListener(n, n === 'pointermove' ? move : stop)); this._drag = false; this.over.classList.remove('dragging'); end(ev); };
    addEventListener('pointermove', move); addEventListener('pointerup', stop); addEventListener('pointercancel', stop);
  }

  onDown(e) {
    if (this.tab !== 'tiles' || e.button) return;
    const box = e.target.closest('.box');
    if (!box) { this.sel = null; this.renderSides(); this.drawOver(); return; }
    e.preventDefault();
    const tile = this.tile(box.dataset.id), g = this.geo(), start = this.layout().placed.find(p => p.tile === tile), resize = e.target.classList.contains('hd');
    const at = this.cell(e, g), off = { x: at.x - start.x, y: at.y - start.y }, f = g.f, drop = h('div', { class: 'drop' });
    this.sel = tile.id;
    this.over.querySelectorAll('.box').forEach(b => b.classList.toggle('sel', b === box));
    let r = null;
    this.track(ev => {
      if (!this._drag && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
      if (!this._drag) { this._drag = true; this.over.classList.add('dragging'); box.classList.add('moving'); this.over.append(drop); }
      const c = this.cell(ev, g);
      r = resize
        ? { x: start.x, y: start.y, w: Math.max(1, Math.min(f.cols - start.x, Math.round(c.x - start.x))), h: Math.max(1, Math.min(f.rows - start.y, Math.round(c.y - start.y))) }
        : { x: Math.max(0, Math.min(f.cols - start.w, Math.round(c.x - off.x))), y: Math.max(0, Math.min(f.rows - start.h, Math.round(c.y - off.y))), w: start.w, h: start.h };
      drop.style.cssText = this.css(r, g);
      if (!resize) box.style.transform = 'translate(' + (ev.clientX - e.clientX) + 'px,' + (ev.clientY - e.clientY) + 'px)';
    }, ev => {
      const changed = r && ev.type === 'pointerup' && (r.x !== start.x || r.y !== start.y || r.w !== start.w || r.h !== start.h);
      if (changed) this.commit(() => this.place(tile, r, resize ? null : start)); else { this.renderSides(); this.drawOver(); }
    });
  }

  fromPalette(e, type) {
    if (e.button) return;
    const g = this.geo(), w = this.win.Panel.widgets[type], f = g.f, sw = Math.min(f.cols, (w.size || [2, 1])[0]), sh = Math.min(f.rows, (w.size || [2, 1])[1]);
    const ghost = h('div', { class: 'ghost' }, w.name), drop = h('div', { class: 'drop' });
    let r = null, moved = false;
    this.track(ev => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
      if (!moved) { moved = true; this._drag = true; this.shadowRoot.append(ghost); this.over.classList.add('dragging'); this.over.append(drop); }
      ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 12 + 'px';
      const c = this.cell(ev, g), inside = c.x > -0.5 && c.y > -0.5 && c.x < f.cols + 0.5 && c.y < f.rows + 0.5;
      r = inside ? { x: Math.max(0, Math.min(f.cols - sw, Math.round(c.x - sw / 2))), y: Math.max(0, Math.min(f.rows - sh, Math.round(c.y - sh / 2))), w: sw, h: sh } : null;
      drop.hidden = !r;
      if (r) drop.style.cssText = this.css(r, g);
    }, ev => {
      ghost.remove();
      if (ev.type === 'pointerup' && (!moved || r)) this.add(type, moved ? r : null); else this.drawOver();
    });
  }

  add(type, r) {
    const t = { id: uid(), type, l: {} };
    if (type === 'music') t.stations = [];
    this.sel = t.id;
    this.commit(() => { this.tiles.push(t); if (r) this.place(t, r); });
  }
  remove(id) { this.sel = null; this.commit(() => { this.doc.pages[this.page].tiles = this.tiles.filter(t => t.id !== id); }); }
  duplicate(id) {
    const src = this.layout().placed.find(p => p.tile.id === id), t = clone(this.tile(id));
    t.id = uid();
    this.sel = t.id;
    this.commit(() => {
      this.pin();
      const s = src && this.DP.freeSpot(src.w, src.h, this.DP.FORMATS[this.fmt], this.layout().placed);
      t.l = s ? { [this.fmt]: [s.x, s.y, s.w, s.h] } : {};
      this.tiles.push(t);
    });
  }

  onKey(e) {
    if (!this._ready) return;
    const inField = e.composedPath().some(n => n.matches && n.matches('input,textarea,select')), ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && k === 's') { e.preventDefault(); if (this.dirty || this.bellDirty) this.save(); return; }
    if (k === 'escape') { const m = this.shadowRoot.querySelector('.modal'); if (m) m.remove(); return; }
    if (inField || this.shadowRoot.querySelector('.modal,.pop')) return;
    if (ctrl && k === 'z') { e.preventDefault(); return e.shiftKey ? this.back(this.redo, this.undo) : this.back(this.undo, this.redo); }
    if (ctrl && k === 'y') { e.preventDefault(); return this.back(this.redo, this.undo); }
    if (!this.sel || this.tab !== 'tiles') return;
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); return this.remove(this.sel); }
    if (ctrl && k === 'd') { e.preventDefault(); return this.duplicate(this.sel); }
    const d = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (!d) return;
    e.preventDefault();
    const t = this.tile(this.sel), p = this.layout().placed.find(x => x.tile === t), f = this.DP.FORMATS[this.fmt];
    if (!p) return;
    const r = e.shiftKey ? { x: p.x, y: p.y, w: p.w + d[0], h: p.h + d[1] } : { x: p.x + d[0], y: p.y + d[1], w: p.w, h: p.h };
    if (r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= f.cols && r.y + r.h <= f.rows) this.commit(() => this.place(t, r, e.shiftKey ? null : p));
  }

  /* ---------- zakładki ---------- */
  renderBody() {
    if (!this._ready) return;
    const full = this.tab === 'panels' || this.tab === 'json';
    this.left.hidden = full || this.tab !== 'tiles'; this.mid.hidden = full; this.right.hidden = full;
    this.bodyEl.style.gridTemplateColumns = full ? '1fr' : this.tab === 'tiles' ? '' : this.tab === 'code' ? 'minmax(0,1fr) minmax(380px,46%)' : 'minmax(0,1fr) 380px';
    this.bodyEl.querySelectorAll('.full').forEach(n => n.remove());
    if (full) { this.bodyEl.append(h('div', { class: 'full' }, h('div', { class: 'w' }, this.tab === 'panels' ? this.panelsTab() : this.jsonTab()))); return; }
    this.bar(); this.renderSides(); this.fit();
  }

  bar() {
    const formats = this.DP ? Object.entries(this.DP.FORMATS) : [];
    this.barEl.replaceChildren(...[
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Format ekranu' }, formats.map(([id, f]) => h('button', { 'aria-pressed': String(this.fmt === id), onclick: () => { this.fmt = id; this.bar(); this.renderSides(); this.fit(); this.refresh(); } }, f.name))),
      h('span', { class: 'dim' }, { square: 'NSPanel Pro 86', portrait: 'NSPanel Pro 120 pionowo', landscape: 'NSPanel Pro 120 poziomo' }[this.fmt]),
      h('span', { style: 'flex:1' }),
      this.tab === 'tiles' ? h('button', { onclick: () => this.wizard() }, 'Wybierz, co pokazać') : null,
      this.tab === 'tiles' ? h('button', { title: 'Usuwa ręczny układ tylko w tym formacie', onclick: () => this.commit(() => this.tiles.forEach(t => { delete t.l[this.fmt]; })) }, 'Ułóż automatycznie') : null,
      this.tab === 'saver' ? check('Widok nocny', this.night, v => { this.night = v; this.refresh(); }) : null].filter(Boolean));
  }

  renderSides() {
    if (!this.win || !this._ready) return;
    const tabs = { look: () => this.lookTab(), saver: () => this.saverTab(), bell: () => this.bellTab(), code: () => this.codeTab() };
    let kids = [];
    if (this.tab === 'tiles') { this.palette(); const t = this.sel && this.tile(this.sel); kids = t ? this.inspector(t) : this.pageSettings(); }
    else if (tabs[this.tab]) kids = tabs[this.tab]();
    const top = this.right.scrollTop;
    this.right.replaceChildren(...kids.filter(Boolean));
    this.right.scrollTop = top;
    this.paintIcons(this.right);
  }

  palette() {
    const groups = {};
    Object.entries(this.win.Panel.widgets).forEach(([id, w]) => { const g = w.group || 'Własne'; (groups[g] = groups[g] || []).push([id, w]); });
    this.left.replaceChildren(
      h('h3', {}, 'Strony'),
      h('div', { class: 'pages' }, this.doc.pages.map((p, i) => h('button', { 'aria-current': String(i === this.page), onclick: () => { this.page = i; this.sel = null; this.renderSides(); this.refresh(); } }, p.name)),
        h('button', { onclick: () => { this.sel = null; this.commit(() => { this.doc.pages.push({ name: 'Strona ' + (this.doc.pages.length + 1), tiles: [] }); this.page = this.doc.pages.length - 1; }); } }, '+ Dodaj stronę')),
      ...Object.entries(groups).map(([name, list]) => [h('h3', {}, name), h('div', { class: 'pal' }, list.map(([id, w]) => h('button', { onpointerdown: e => this.fromPalette(e, id), onkeydown: e => { if (e.key === 'Enter') this.add(id); } }, h('span', { html: this.DP.icon(w.icon) }), w.name)))]).flat());
  }

  pageSettings() {
    const p = this.doc.pages[this.page], i = this.page, n = this.doc.pages.length;
    const move = d => this.commit(() => { this.doc.pages.splice(i + d, 0, this.doc.pages.splice(i, 1)[0]); this.page = i + d; });
    return [h('h3', {}, 'Strona'), field('Nazwa strony', text(p.name, v => { this.commit(() => { p.name = v; }, { key: 'page' + i, quiet: true }); this.palette(); })),
      h('div', { class: 'btns', style: 'justify-content:flex-start' }, h('button', { disabled: i === 0, onclick: () => move(-1) }, 'Wcześniej'), h('button', { disabled: i === n - 1, onclick: () => move(1) }, 'Później'), h('button', { class: 'danger', disabled: n === 1, onclick: () => this.commit(() => { this.doc.pages.splice(i, 1); this.page = Math.max(0, i - 1); }) }, 'Usuń stronę')),
      h('h3', {}, 'Pulpit'), field('Nazwa pulpitu', text(this.doc.name, v => this.commit(() => { this.doc.name = v; }, { key: 'name', quiet: true }))),
      h('button', { class: 'danger', disabled: Object.keys(this.data.dashboards).length < 2, onclick: () => this.dialog('Usunąć pulpit „' + this.doc.name + '”?', h('p', {}, 'Tego nie da się cofnąć. Panele z tym pulpitem dostaną inny.'), ['Anuluj'], ['Usuń', () => { this.dirty = false; this.hass.callWS({ type: 'panelpilot/admin/dashboard_delete', dashboard_id: this.dashId }).catch(e => this.toast(e.message, true)); }]) }, 'Usuń pulpit'),
      h('h3', {}, 'Wskazówki'), h('p', { class: 'dim' }, 'Kliknij kafelek, aby go ustawić. Przeciągnij, aby przesunąć; kropka w rogu zmienia rozmiar. Strzałki przesuwają, Shift+strzałki zmieniają rozmiar, Ctrl+D powiela, Delete usuwa. Każdy format ma własny układ.')];
  }

  inspector(t) {
    const w = this.win.Panel.widgets[t.type] || { name: t.type, fields: [] };
    const set = (k, v, full) => this.commit(() => { if (v === '' || v == null) delete t[k]; else t[k] = v; }, full ? {} : { key: t.id + k, quiet: true });
    const fields = (w.fields || []).map(f => {
      if (f.t === 'entity') return field(f.l, this.entityPicker(t[f.k], f.d, v => set(f.k, v, true)));
      if (f.t === 'entities') return group(f.l, this.entityList(t[f.k] || [], f.d, v => set(f.k, v, true)));
      if (f.t === 'bool') return check(f.l, t[f.k] === undefined ? f.def : t[f.k], v => this.commit(() => { t[f.k] = v; }, { quiet: true }));
      if (f.t === 'area') return field(f.l, h('textarea', { value: t[f.k] || '', rows: 4, oninput: e => set(f.k, e.target.value) }));
      if (f.t === 'code') return group(f.l, this.codeField(t[f.k], v => set(f.k, v), 7));
      if (f.t === 'stations') return group(f.l, this.stations(t));
      if (f.t === 'select') return field(f.l, select(t[f.k] || '', f.o, v => set(f.k, v)));
      return field(f.l, text(t[f.k], v => set(f.k, f.t === 'number' && v !== '' ? Number(v) : v), { type: f.t === 'number' ? 'number' : 'text', step: 'any' }));
    });
    const tap = t.tap || {}, setTap = o => this.commit(() => { t.tap = Object.assign({}, t.tap, o); if (t.tap.kind === 'default') delete t.tap; });
    const p = this.layout().placed.find(x => x.tile === t), f = this.DP.FORMATS[this.fmt];
    const num = (k, i) => field(k, text(p ? [p.x, p.y, p.w, p.h][i] + (i < 2 ? 1 : 0) : '', v => {
      const now = this.layout().placed.find(x => x.tile === t), r = { x: now.x, y: now.y, w: now.w, h: now.h };
      r['xywh'[i]] = Number(v) - (i < 2 ? 1 : 0);
      if (r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= f.cols && r.y + r.h <= f.rows) this.commit(() => this.place(t, r), { quiet: true, key: t.id + k });
    }, { type: 'number', disabled: !p }));
    return [
      h('h3', {}, w.name),
      field('Rodzaj kafelka', select(t.type, Object.entries(this.win.Panel.widgets).map(([id, x]) => [id, x.name]), v => this.commit(() => { t.type = v; if (v === 'music' && !t.stations) t.stations = []; }))),
      ...fields,
      field('Nazwa (pusta = z Home Assistant)', text(t.name, v => set('name', v))),
      w.noIcon ? null : field('Ikona', this.iconPicker(t.icon || w.icon, v => set('icon', v, true))),
      h('h3', {}, 'Wygląd'),
      h('div', { class: 'row2' }, this.color('Tło', t.bg, v => set('bg', v)), this.color('Kolor', t.color, v => set('color', v))),
      w.noIcon ? null : this.color('Tło ikony (kółko)', t.iconBg, v => set('iconBg', v)),
      field('Wielkość tekstu', select(t.text || '', [['S', 'Mała'], ['', 'Zwykła'], ['L', 'Duża'], ['XL', 'Bardzo duża']], v => set('text', v))),
      w.noIcon ? null : h('div', { class: 'row2' },
        field('Układ', select(t.layout || '', [['', 'Jak w motywie']].concat(LAYOUTS), v => set('layout', v, true))),
        field('Wielkość ikony', select(t.iconSize || '', [['', 'Jak w motywie']].concat(ICON_SIZES), v => set('iconSize', v, true)))),
      h('h3', {}, 'Dotknięcie'),
      field('Co robi', select(tap.kind || 'default', [['default', 'Domyślnie dla tego kafelka'], ['none', 'Nic'], ['toggle', 'Przełącz encję'], ['page', 'Otwórz stronę'], ['service', 'Wywołaj akcję HA']], v => setTap({ kind: v }))),
      tap.kind === 'page' ? field('Strona', select(tap.page || '', [['', '–']].concat(this.doc.pages.map(x => [x.name, x.name])), v => setTap({ page: v }))) : null,
      ...(tap.kind === 'service' ? this.serviceFields(tap, setTap) : []),
      w.confirmable || tap.kind === 'service' || tap.kind === 'toggle' ? check('Pytaj o potwierdzenie', t.confirm, v => set('confirm', v)) : null,
      h('h3', {}, 'Położenie: ' + f.name.toLowerCase()),
      h('div', { class: 'row4' }, num('Kol.', 0), num('Wiersz', 1), num('Szer.', 2), num('Wys.', 3)),
      check('Pokazuj w tym formacie', t.l[this.fmt] !== false, v => this.commit(() => { if (v) delete t.l[this.fmt]; else { this.pin(); t.l[this.fmt] = false; } })),
      this.doc.pages.length > 1 ? field('Na stronie', select(String(this.page), this.doc.pages.map((x, i) => [String(i), x.name]), v => this.commit(() => { this.doc.pages[this.page].tiles = this.tiles.filter(x => x !== t); t.l = {}; this.page = +v; this.tiles.push(t); }))) : null,
      h('div', { class: 'btns' }, h('button', { class: 'danger', onclick: () => this.remove(t.id) }, 'Usuń'), h('button', { onclick: () => this.duplicate(t.id) }, 'Powiel')),
    ];
  }

  color(label, value, fn) {
    return group(label, h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('input', { type: 'color', 'aria-label': label, value: value || '#1c2328', oninput: e => fn(e.target.value) }), value ? h('button', { class: 'icon', 'aria-label': 'Wyczyść', onclick: () => { fn(''); this.renderSides(); } }, '×') : h('span', { class: 'dim' }, 'z motywu')));
  }

  serviceFields(o, set) {
    const list = [];
    Object.entries(this.hass.services || {}).forEach(([d, s]) => Object.keys(s).forEach(n => list.push(d + '.' + n)));
    return [field('Akcja', h('div', { style: 'display:flex;gap:6px' }, h('input', { value: o.service || '', placeholder: 'script.turn_on', onchange: e => set({ service: e.target.value.trim() }) }), list.length ? h('button', { type: 'button', onclick: e => { e.preventDefault(); this.popup(e.currentTarget, list.sort().map(s => ({ id: s, name: s })), v => set({ service: v })); } }, 'Lista') : null)),
      field('Encja', this.entityPicker((o.data || {}).entity_id, null, v => { const data = Object.assign({}, o.data); if (v) data.entity_id = v; else delete data.entity_id; set({ data }); })),
      field('Dane (JSON)', h('textarea', { class: 'code', rows: 3, value: JSON.stringify(o.data || {}, null, 1), onchange: e => { try { set({ data: JSON.parse(e.target.value || '{}') }); } catch (x) { this.toast('Błędny JSON: ' + x.message, true); } } }))];
  }

  stations(t) {
    const list = t.stations = t.stations || [], upd = (fn, key) => this.commit(fn, key ? { quiet: true, key } : {});
    return h('div', {}, list.map((s, i) => h('div', { class: 'st' },
      h('div', { style: 'display:flex;gap:6px' }, text(s.name, v => upd(() => { s.name = v; }, t.id + 'n' + i), { placeholder: 'Nazwa' }), h('button', { class: 'icon', 'aria-label': 'Wyżej', disabled: !i, onclick: () => upd(() => list.splice(i - 1, 0, list.splice(i, 1)[0])) }, '↑'), h('button', { class: 'icon danger', 'aria-label': 'Usuń stację', onclick: () => upd(() => list.splice(i, 1)) }, '×')),
      text(s.image, v => upd(() => { s.image = v; }, t.id + 'i' + i), { placeholder: 'Logo, np. /local/radio/logo.png' }),
      h('details', { open: !s.service }, h('summary', {}, s.service || 'Akcja nieustawiona'), this.serviceFields(s, o => upd(() => Object.assign(s, o)))))),
    h('button', { onclick: () => upd(() => list.push({ name: 'Stacja ' + (list.length + 1), data: {} })) }, '+ Dodaj stację'));
  }

  /* ---------- wybór encji i ikon ---------- */
  entities(domains) {
    return Object.keys(this.hass.states).filter(id => !domains || domains.includes(id.split('.')[0])).map(id => {
      const s = this.hass.states[id], u = s.attributes.unit_of_measurement;
      return { id, name: s.attributes.friendly_name || id, state: s.state + (u ? ' ' + u : '') };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }
  entityPicker(value, domains, fn) {
    return h('button', { type: 'button', class: 'ep-btn', onclick: e => { e.preventDefault(); this.popup(e.currentTarget, this.entities(domains), fn, { all: domains && (() => this.entities()), clear: !!value, custom: true }); } },
      value ? h('div', {}, this.ename(value), h('small', {}, this.hass.states[value] ? value : 'nie ma takiej encji')) : h('div', { class: 'dim' }, 'Wybierz encję…'), h('span', {}, '▾'));
  }
  entityList(list, domains, fn) {
    return h('div', {}, h('div', { class: 'chips' }, list.map((id, i) => h('span', { class: 'chip', title: id }, h('span', {}, this.ename(id)), h('button', { type: 'button', 'aria-label': 'Usuń ' + this.ename(id), onclick: () => fn(list.filter((x, j) => j !== i)) }, '×')))),
      h('button', { type: 'button', class: 'add', onclick: e => this.popup(e.currentTarget, this.entities(domains).filter(x => !list.includes(x.id)), v => v && fn(list.concat(v)), { all: domains && (() => this.entities().filter(x => !list.includes(x.id))), custom: true }) }, '+ Dodaj encję'));
  }

  openPop(anchor, pop, input) {
    this.closePop();
    const b = anchor.getBoundingClientRect();
    this.shadowRoot.append(pop);
    this._pop = pop;
    return () => {
      pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, b.left)) + 'px';
      pop.style.top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, b.bottom + 4)) + 'px';
      input.focus();
      this._popOut = e => { if (!e.composedPath().includes(pop)) this.closePop(); };
      setTimeout(() => this._pop === pop && addEventListener('pointerdown', this._popOut, true));
    };
  }
  closePop() { if (this._pop) this._pop.remove(); this._pop = null; if (this._popOut) removeEventListener('pointerdown', this._popOut, true); }

  popup(anchor, items, fn, opts) {
    const o = opts || {}, list = h('div', { class: 'list' });
    let src = items, hi = 0, shown = [];
    const pick = v => { this.closePop(); fn(v); };
    const draw = () => {
      const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      shown = src.filter(i => { const s = (i.name + ' ' + i.id).toLowerCase(); return q.every(x => s.includes(x)); }).slice(0, 120);
      hi = Math.max(0, Math.min(hi, shown.length - 1));
      list.replaceChildren(...shown.map((i, n) => h('button', { type: 'button', class: 'opt' + (n === hi ? ' hi' : ''), onclick: () => pick(i.id) }, h('b', {}, i.name), i.name !== i.id ? h('small', {}, i.id) : null, i.state ? h('em', {}, i.state) : null)), ...(shown.length ? [] : [h('p', { class: 'dim', style: 'padding:8px' }, 'Nic nie pasuje.')]));
    };
    const input = h('input', { placeholder: 'Szukaj po nazwie lub encji…', oninput: () => { hi = 0; draw(); }, onkeydown: e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi += e.key === 'ArrowDown' ? 1 : -1; draw(); const n = list.querySelector('.hi'); if (n) n.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) pick(shown[hi].id); else if (o.custom && this.DP.isEntity(input.value.trim())) pick(input.value.trim()); }
      else if (e.key === 'Escape') { e.stopPropagation(); this.closePop(); anchor.focus(); }
    } });
    const pop = h('div', { class: 'pop' }, input, list, o.all || o.clear ? h('div', { class: 'btns', style: 'justify-content:space-between;align-items:center' }, o.all ? check('Pokaż wszystkie encje', false, v => { src = v ? o.all() : items; draw(); }) : h('span'), o.clear ? h('button', { type: 'button', onclick: () => pick('') }, 'Wyczyść') : null) : null);
    const show = this.openPop(anchor, pop, input);
    draw(); show();
  }

  iconPicker(value, fn) {
    return h('button', { type: 'button', class: 'ep-btn', onclick: e => {
      e.preventDefault();
      const grid = h('div', { class: 'icons list' });
      let names = this.DP.ICONS.slice();
      const draw = () => { const q = input.value.trim().toLowerCase(); grid.replaceChildren(...names.filter(n => n.includes(q)).slice(0, 150).map(n => h('button', { type: 'button', title: n, 'aria-label': n, html: this.DP.icon(n), onclick: () => { this.closePop(); fn(n); } }))); this.paintIcons(grid); };
      const input = h('input', { placeholder: 'Szukaj ikony (mdi, po angielsku)…', oninput: draw }), pop = h('div', { class: 'pop' }, input, grid);
      const show = this.openPop(e.currentTarget, pop, input);
      draw(); show();
      this.DP.mdiNames().then(l => { names = names.concat(l.map(n => 'mdi:' + n)); if (this._pop === pop) draw(); }, () => {});
    } }, h('div', { style: 'display:flex;gap:10px;align-items:center', html: this.DP.icon(value) + '<span>' + this.DP.esc(value || 'Wybierz') + '</span>' }), h('span', {}, '▾'));
  }
  // Ikony mdi doczytują się asynchronicznie; w edytorze uzupełniamy je sami.
  paintIcons(root) { root.querySelectorAll('svg[data-mdi]').forEach(s => { if (!s.innerHTML) this.DP.mdiPath(s.dataset.mdi).then(d => { s.innerHTML = '<path d="' + this.DP.esc(d || '') + '"/>'; }, () => {}); }); }

  /** Kreator: użytkownik wskazuje, co ma być na ekranie. Nic nie jest wybierane za niego. */
  wizard() {
    const pick = {}, rows = [
      ['weather', 'Pogoda', ['weather'], 'Pokaż też prognozę na kolejne dni'], ['sensor', 'Czujniki (temperatura, wilgotność, moc…)', ['sensor', 'input_number', 'number']], ['light', 'Światła i przełączniki', ['light', 'switch', 'input_boolean', 'fan']],
      ['opening', 'Okna i drzwi (jeden wspólny kafelek)', ['binary_sensor', 'group']], ['cover', 'Rolety', ['cover']], ['climate', 'Ogrzewanie', ['climate']], ['camera', 'Kamery', ['camera']], ['music', 'Odtwarzacze', ['media_player']], ['hold', 'Bramy i furtki (przytrzymanie)', ['switch', 'button', 'cover', 'lock', 'script']], ['button', 'Skrypty i sceny', ['script', 'scene', 'input_button', 'button']],
    ];
    let clock = !this.tiles.some(t => t.type === 'clock'), forecast = true;
    const bodyEl = h('div');
    const draw = () => bodyEl.replaceChildren(check('Zegar z datą', clock, v => { clock = v; }), ...rows.map(([k, label, d, extra]) => group(label, this.entityList(pick[k] || [], d, v => { pick[k] = v; draw(); }), extra && (pick[k] || []).length ? check(extra, forecast, v => { forecast = v; }) : null)));
    draw();
    this.dialog('Co ma być na stronie „' + this.doc.pages[this.page].name + '”?', bodyEl, ['Anuluj'], ['Dodaj', () => {
      const out = [], t = (type, o) => out.push(Object.assign({ id: uid(), type, l: {} }, o));
      if (clock) t('clock', {});
      (pick.weather || []).forEach(e => { t('weather', { entity: e }); if (forecast) t('forecast', { entity: e }); });
      (pick.sensor || []).forEach(e => { const s = this.hass.states[e], icon = { temperature: 'temp', humidity: 'drop', power: 'bolt', energy: 'bolt', moisture: 'drop' }[s && s.attributes.device_class]; t('sensor', icon ? { entity: e, icon } : { entity: e }); });
      if ((pick.opening || []).length) t('opening', { entities: pick.opening });
      (pick.light || []).forEach(e => t('toggle', { entity: e, icon: e.startsWith('fan.') ? 'fan' : 'bulb' }));
      ['cover', 'climate', 'camera', 'hold', 'button'].forEach(k => (pick[k] || []).forEach(e => t(k, { entity: e })));
      (pick.music || []).forEach(e => t('music', { entity: e, stations: [] }));
      if (out.length) this.commit(() => this.tiles.push(...out));
    }]);
  }

  /* ---------- wygląd, wygaszacz, domofon ---------- */
  lookTab() {
    const t = this.doc.theme || {}, set = (k, v) => this.commit(() => { this.doc.theme = this.doc.theme || {}; if (v === '') delete this.doc.theme[k]; else this.doc.theme[k] = v; }, { key: 'th' + k, quiet: true });
    // Zmiana, po której prawy panel trzeba narysować od nowa (pojawiają się zależne pola).
    const setFull = (k, v) => this.commit(() => { this.doc.theme = Object.assign({}, this.doc.theme); if (v) this.doc.theme[k] = v; else delete this.doc.theme[k]; });
    const cur = Object.assign({}, this.DP.THEMES.Grafit, t), range = (l, k, min, max, v, conv) => field(l, h('input', { type: 'range', min, max, value: v, oninput: e => set(k, conv(+e.target.value)) }));
    return [h('h3', {}, 'Gotowe motywy'), h('div', { class: 'themes' }, Object.entries(this.DP.THEMES).map(([n, v]) => h('button', { onclick: () => this.commit(() => { this.doc.theme = Object.assign({}, this.doc.theme, v); }) }, h('span', { class: 'sw', style: 'background:linear-gradient(90deg,' + v.bg + ' 33%,' + v.tile + ' 33% 66%,' + v.accent + ' 66%)' }), n))),
      h('h3', {}, 'Kolory'), h('div', { class: 'row2' }, Object.entries(this.DP.THEME_FIELDS).map(([k, l]) => field(l, h('input', { type: 'color', value: cur[k], oninput: e => set(k, e.target.value) })))),
      h('h3', {}, 'Kształt i tekst'), range('Zaokrąglenie rogów', 'radius', 0, 40, t.radius == null ? 16 : t.radius, v => v), range('Wielkość tekstu', 'scale', 80, 150, (t.scale || 1) * 100, v => v / 100), range('Krycie kafelków', 'opacity', 20, 100, t.opacity || 100, v => v),
      field('Tapeta (adres obrazka)', text(t.image, v => set('image', v.trim()), { placeholder: '/local/tapeta.jpg' })),
      h('h3', {}, 'Kafelki i ikony'),
      field('Włączony kafelek', select(t.onStyle || '', [['', 'Wypełniony kolorem'], ['outline', 'Świecąca ramka']], v => setFull('onStyle', v))),
      h('div', { class: 'row2' },
        field('Układ treści', select(t.layout || '', [['', 'Ikona nad tekstem']].concat(LAYOUTS.slice(1)), v => setFull('layout', v))),
        field('Wielkość ikon', select(t.iconSize || '', [['', 'Zwykła']].concat(ICON_SIZES.filter(s => s[0] !== 'M')), v => setFull('iconSize', v)))),
      field('Tło ikon', select(t.icons || '', [['', 'Bez tła'], ['circle', 'Kolorowe kółko']], v => setFull('icons', v))),
      t.icons === 'circle' ? this.color('Kolor kółka (puste = z akcentu)', t.icbg, v => set('icbg', v)) : null,
      h('p', { class: 'dim' }, 'Układ, wielkość ikony i kolor kółka pojedynczego kafelka ustawisz po kliknięciu kafelka.'),
      h('h3', {}, 'Nawigacja'),
      check('Pasek stron na dole ekranu', this.doc.nav !== false, v => this.commit(() => { this.doc.nav = v; })),
      this.doc.nav === false ? h('p', { class: 'dim' }, 'Bez paska ustawienia panelu otwiera mały przycisk w prawym dolnym rogu albo gest poniżej.') : null,
      ...this.gestureFields()].filter(Boolean);
  }

  gestureFields() {
    const g = this.doc.gestures || {};
    const kinds = [['default', ''], ['none', 'Nic'], ['next', 'Następna strona'], ['prev', 'Poprzednia strona'], ['page', 'Wybrana strona'], ['saver', 'Wygaszacz'], ['bell', 'Domofon'], ['settings', 'Ustawienia panelu (jasność)'], ['service', 'Akcja Home Assistant']];
    const defaults = { left: 'Następna strona', right: 'Poprzednia strona', up: 'Nic', down: 'Nic' };
    const out = [h('h3', {}, 'Przesunięcie palcem')];
    [['up', 'W górę ↑'], ['down', 'W dół ↓'], ['left', 'W lewo ←'], ['right', 'W prawo →']].forEach(([dir, label]) => {
      const cur = g[dir] || { kind: 'default' }, set = o => this.commit(() => { this.doc.gestures = Object.assign({}, this.doc.gestures, { [dir]: Object.assign({}, cur, o) }); });
      out.push(field(label, select(cur.kind, kinds.map(([k, n]) => [k, k === 'default' ? 'Domyślnie (' + defaults[dir].toLowerCase() + ')' : n]), v => set({ kind: v }))));
      if (cur.kind === 'page') out.push(field('Strona', select(cur.page || '', [['', '–']].concat(this.doc.pages.map(x => [x.name, x.name])), v => set({ page: v }))));
      if (cur.kind === 'service') out.push(...this.serviceFields(cur, set));
    });
    return out;
  }

  saverTab() {
    const s = this.doc.saver = Object.assign({ seconds: 60, style: 'zegar', entities: [], names: {} }, this.doc.saver), set = (k, v, full) => this.commit(() => { this.doc.saver[k] = v; }, full ? {} : { key: 'sv' + k, quiet: true });
    return [h('h3', {}, 'Wygaszacz'), field('Włącz po (sekundy, 0 = nigdy)', text(s.seconds, v => set('seconds', Number(v) || 0), { type: 'number', min: 0 })),
      field('Wygląd', select(s.style, [['zegar', 'Zegar'], ['czujniki', 'Duże czujniki'], ['czarny', 'Czarny ekran']], v => set('style', v))),
      group('Co pokazać pod zegarem', this.entityList(s.entities || [], ['sensor', 'binary_sensor', 'weather', 'input_number'], v => set('entities', v.slice(0, 8), true))),
      ...(s.entities || []).map(id => field('Podpis: ' + this.ename(id), text((s.names || {})[id], v => this.commit(() => { const n = Object.assign({}, this.doc.saver.names); if (v) n[id] = v; else delete n[id]; this.doc.saver.names = n; }, { key: 'svn' + id, quiet: true })))),
      h('h3', {}, 'Ikony powiadomień'),
      h('p', { class: 'dim', style: 'margin-bottom:8px' }, 'Ikona pojawia się nad zegarem tylko wtedy, gdy coś wymaga uwagi: drzwi otwarte, alarm uzbrojony, czujnik zgłasza problem, licznik większy od zera.'),
      this.entityList(s.alerts || [], ['binary_sensor', 'cover', 'lock', 'alarm_control_panel', 'input_boolean', 'switch', 'sensor', 'group'], v => set('alerts', v.slice(0, 12), true)),
      h('p', { class: 'dim' }, 'Jasność w dzień i w nocy, próg ciemności i budzenie zbliżeniem ustawiasz dla każdego panelu w zakładce „Panele i jasność”. Na samym panelu jasność zmienisz suwakiem w ustawieniach (koło zębate).')];
  }

  bellTab() {
    const b = this.bell, set = (k, v, full) => { b[k] = v; this.bellDirty = true; this.header(); this.refresh(); if (full) this.renderSides(); };
    b.actions = b.actions || [];
    return [h('h3', {}, 'Domofon (wspólny dla wszystkich paneli)'), field('Nazwa', text(b.name, v => set('name', v))),
      field('Dzwonek: otwiera okno', this.entityPicker(b.entity, ['binary_sensor', 'event', 'input_boolean'], v => set('entity', v, true))),
      field('Kamera', this.entityPicker(b.camera, ['camera'], v => set('camera', v, true))),
      field('Zamknij okno po (s)', text(b.seconds, v => set('seconds', Number(v) || 60), { type: 'number', min: 10 })),
      check('Gong na panelu', b.chime !== false, v => set('chime', v)),
      check('Przycisk „Rozmawiaj” (mikrofon panelu)', b.talk, v => set('talk', v, true)),
      b.talk && !(b.go2rtc && b.stream) ? h('p', { class: 'dim' }, 'Rozmowa wymaga go2rtc ze źródłem z dźwiękiem zwrotnym (sekcja na dole). Bez niego przycisk się pokaże, ale głos nie dotrze do bramki.') : null,
      h('h3', {}, 'Przyciski otwierania'),
      ...b.actions.map((a, i) => h('div', { class: 'st' },
        h('div', { style: 'display:flex;gap:6px' }, text(a.name, v => { a.name = v; set('actions', b.actions); }, { placeholder: 'Nazwa, np. Otwórz furtkę' }), h('button', { class: 'icon danger', 'aria-label': 'Usuń przycisk', onclick: () => { b.actions.splice(i, 1); set('actions', b.actions, true); } }, '×')),
        this.entityPicker(a.entity, ['switch', 'button', 'input_button', 'cover', 'lock', 'script'], v => { a.entity = v; set('actions', b.actions, true); }),
        h('div', { class: 'row2' }, this.iconPicker(a.icon || 'gate', v => { a.icon = v; set('actions', b.actions, true); }), select(a.mode || 'hold', [['hold', 'Przytrzymaj, aby otworzyć'], ['tap', 'Jedno dotknięcie']], v => { a.mode = v; set('actions', b.actions, true); })))),
      b.actions.length < 4 ? h('div', { class: 'btns', style: 'justify-content:flex-start' },
        h('button', { onclick: () => { b.actions.push({ name: 'Otwórz furtkę', entity: '', icon: 'gate', mode: 'hold' }); set('actions', b.actions, true); } }, '+ Furtka'),
        h('button', { onclick: () => { b.actions.push({ name: 'Otwórz bramę', entity: '', icon: 'garage', mode: 'hold' }); set('actions', b.actions, true); } }, '+ Brama'),
        h('button', { onclick: () => { b.actions.push({ name: 'Przycisk', entity: '', icon: 'touch', mode: 'tap' }); set('actions', b.actions, true); } }, '+ Inny')) : null,
      b.actions.some(a => !a.entity) ? h('p', { class: 'dim' }, 'Przycisk bez wybranej encji nie zostanie zapisany.') : null,
      h('h3', {}, 'Obraz i rozmowa przez własne go2rtc'), h('p', { class: 'dim', style: 'margin-bottom:8px' }, 'Puste = obraz z kamery HA. Do rozmowy wpisz go2rtc ze źródłem obsługującym dźwięk zwrotny.'),
      field('Adres go2rtc', text(b.go2rtc, v => set('go2rtc', v.trim()), { placeholder: 'http://192.168.1.10:1984' })), field('Nazwa strumienia', text(b.stream, v => set('stream', v.trim()), { placeholder: 'brama' }))];
  }

  /* ---------- kod ---------- */
  codeField(value, fn, rows) {
    const area = h('textarea', { class: 'code', spellcheck: false, rows: rows || 12, value: value || '', oninput: () => fn(area.value), onkeydown: e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); put('  '); } } });
    const put = s => { area.setRangeText(s, area.selectionStart, area.selectionEnd, 'end'); fn(area.value); area.focus(); };
    return h('div', { style: 'display:grid;gap:6px' }, area, h('div', { class: 'btns', style: 'justify-content:flex-start' }, h('button', { type: 'button', class: 'ins', onclick: e => { e.preventDefault(); this.popup(e.currentTarget, this.entities(), v => v && put(v)); } }, 'Wstaw encję')));
  }

  codeTab() {
    const d = this.doc, mode = d.mode || 'tiles', set = (k, v) => this.commit(() => { d[k] = v; }, { key: 'c' + k, quiet: true });
    const ed = (label, k, rows) => group(label, this.codeField(d[k], v => set(k, v), rows));
    if (mode === 'module') return [h('h3', {}, 'Moduł JS z pliku'), h('p', { class: 'dim', style: 'margin-bottom:8px' }, 'Gotowy element, taki jak w panel_custom. Dostaje obiekt hass (stany, callService, callWS, connection). Elementy samego HA, np. karty ha-*, nie są dostępne poza ikonami ha-icon.'),
      field('Adres modułu', text(d.module, v => set('module', v.trim()), { placeholder: '/local/moj-panel/panel.js' })), field('Nazwa elementu', text(d.element, v => set('element', v.trim()), { placeholder: 'moj-panel' })), this.watchField()];
    if (mode === 'code') return [h('div', { class: 'codearea' }, ed('HTML', 'html', 11), ed('CSS', 'css', 11), ed('JavaScript: dostępne root, hass, panel', 'code', 14), this.watchField(), this.help())];
    return [h('div', { class: 'codearea' }, ed('CSS całego pulpitu', 'css', 14), ed('JavaScript: własne kafelki przez Panel.widget(…)', 'js', 16), h('p', { class: 'dim' }, 'Nowe kafelki z JS pojawią się na liście po lewej, w zakładce Kafelki. Chcesz napisać cały ekran od zera? Przełącz u góry na „Własny kod”.'), h('button', { onclick: () => this.commit(() => { d.js = (d.js ? d.js + '\n\n' : '') + SAMPLE.widget; }) }, 'Wstaw przykład kafelka'))];
  }
  watchField() { return group('Ogranicz do encji (puste = wszystkie; krótsza lista odciąża panel)', this.entityList(this.doc.watch || [], null, v => this.commit(() => { this.doc.watch = v; }))); }
  help() {
    const li = s => h('li', { html: s });
    return h('details', {}, h('summary', {}, 'Ściąga'), h('ul', { style: 'padding-left:18px;margin:8px 0' }, li('<code>data-text="sensor.x"</code> wstawia wartość na żywo'), li('<code>data-text="sensor.x|0"</code> bez miejsc po przecinku'), li('<code>data-toggle="light.x"</code> przełącza po dotknięciu'), li('<code>data-service="script.turn_on" data-entity="script.x"</code> wywołuje akcję'), li('<code>data-state="light.x"</code> dodaje klasę <code>is-on</code> i atrybut <code>state</code> do CSS'), li('<code>hass.callWS(…)</code>, <code>hass.connection.subscribeMessage(cb, …)</code> to bezpośredni WebSocket'), li('<code>panel.onState((hass, zmienione) =&gt; …)</code> po każdej zmianie stanu'), li('<code>panel.forecast(id, cb)</code>, <code>panel.history(id, godziny)</code>, <code>panel.sensors.lux</code>, <code>panel.format</code>')), h('button', { onclick: () => this.commit(() => { this.doc.html = SAMPLE.html; this.doc.css = SAMPLE.css; this.doc.code = SAMPLE.js; }) }, 'Zastąp przykładem'));
  }

  jsonTab() {
    const area = h('textarea', { class: 'code', rows: 24, spellcheck: false, value: JSON.stringify(this.doc, null, 2) });
    const use = s => {
      try {
        const v = JSON.parse(s);
        if (!Array.isArray(v.pages) || !v.pages.length) throw new Error('brak listy pages');
        v.pages.forEach(p => { p.tiles = (p.tiles || []).map(t => Object.assign({}, t, { id: t.id || uid(), l: t.l || {} })); });
        delete v.rev;
        this.page = 0; this.sel = null;
        this.commit(() => { this.doc = v; });
        this.toast('Wczytano. Sprawdź podgląd i zapisz.');
        this.renderBody();
      } catch (e) { this.toast('Błędny JSON: ' + e.message, true); }
    };
    return [h('h2', {}, 'Eksport i import pulpitu'), h('p', { class: 'dim' }, 'Cały pulpit jako tekst: do kopii zapasowej albo do przekazania komuś. Pulpit z JS uruchamia kod, więc importuj tylko z zaufanego źródła.'), area,
      h('div', { class: 'btns' }, h('button', { onclick: () => h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(this.doc, null, 2)], { type: 'application/json' })), download: 'pulpit.json' }).click() }, 'Pobierz plik'), h('button', { onclick: () => { const f = h('input', { type: 'file', accept: '.json', onchange: () => f.files[0] && f.files[0].text().then(use) }); f.click(); } }, 'Wczytaj plik'), h('button', { class: 'primary', onclick: () => use(area.value) }, 'Zastosuj tekst'))];
  }

  /* ---------- panele ---------- */
  panelsTab() {
    const call = (m, ok) => this.hass.callWS(m).then(() => ok && this.toast(ok), e => this.toast(e.message || e.code, true));
    const pairing = this.data.pairing.map(p => {
      let name = p.name;
      return h('div', { class: 'card' }, h('h2', {}, 'Nowy panel czeka: ' + p.code.slice(0, 3) + ' ' + p.code.slice(3)), h('p', { class: 'dim' }, p.model + ' · ' + p.remote + '. Zatwierdź tylko wtedy, gdy ten sam kod widzisz na ekranie panelu.'), field('Nazwa panelu', text(name, v => { name = v; })),
        h('div', { class: 'btns' }, h('button', { onclick: () => call({ type: 'panelpilot/admin/pair_reject', code: p.code }) }, 'Odrzuć'), h('button', { class: 'primary', onclick: () => call({ type: 'panelpilot/admin/pair_approve', code: p.code, name: name.trim() || 'Panel' }, 'Panel dodany') }, 'Zatwierdź')));
    });
    const panels = Object.entries(this.data.panels).map(([id, p]) => {
      const save = d => call({ type: 'panelpilot/admin/panel_save', device_id: id, data: d }, 'Zapisano'), s = p.settings, setS = (k, v) => save({ settings: { [k]: v } });
      const num = (l, k) => field(l, h('input', { type: 'number', value: s[k], onchange: e => setS(k, Number(e.target.value)) }));
      const cmd = (c, x) => call(Object.assign({ type: 'panelpilot/admin/panel_command', device_id: id, command: c }, x), 'Wysłano');
      return h('div', { class: 'card' }, h('div', { class: 'top' }, h('i', { class: 'dot' + (p.connected ? ' on' : '') }), h('h2', {}, p.name), h('span', { class: 'dim' }, [p.model, p.size, p.app, p.connected ? 'połączony' : 'rozłączony'].filter(Boolean).join(' · '))),
        h('div', { class: 'cols' }, field('Nazwa', h('input', { value: p.name, onchange: e => save({ name: e.target.value }) })), field('Pulpit', select(p.dashboard, Object.entries(this.data.dashboards).map(([i, d]) => [i, d.name]), v => save({ dashboard: v }))),
          field('Ekran', select(p.shape, [['auto', 'Wykryj'], ['square', 'Kwadrat (86)'], ['rect', 'Prostokąt (120)']], v => save({ shape: v }))), field('Obrót', select(String(s.rotation), [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], v => setS('rotation', Number(v)))),
          num('Jasność w dzień (%)', 'dayBrightness'), num('Jasność w nocy (%)', 'nightBrightness'), num('Ciemno poniżej (lx)', 'darkLux'), num('Noc od godziny', 'nightFrom'), num('Noc do godziny', 'nightTo')),
        check('Budź, gdy ktoś podejdzie', s.wakeOnProximity, v => setS('wakeOnProximity', v)), check('Nie włączaj wygaszacza, gdy ktoś stoi przy panelu', s.proximityHold, v => setS('proximityHold', v)),
        h('div', { class: 'btns' }, h('button', { class: 'danger', onclick: () => this.dialog('Usunąć panel „' + p.name + '”?', h('p', {}, 'Panel straci dostęp i trzeba będzie sparować go od nowa.'), ['Anuluj'], ['Usuń', () => call({ type: 'panelpilot/admin/panel_delete', device_id: id })]) }, 'Usuń'), h('button', { disabled: !p.connected, onclick: () => cmd('message', { title: 'Test', message: 'Wiadomość z Home Assistant' }) }, 'Wyślij test'), h('button', { disabled: !p.connected, onclick: () => cmd('doorbell') }, 'Pokaż domofon'), h('button', { disabled: !p.connected, onclick: () => cmd('reload') }, 'Odśwież')));
    });
    return [h('h2', {}, 'Panele'), ...pairing, ...panels, h('div', { class: 'card' }, h('h2', {}, 'Dodaj panel'), h('ol', { style: 'margin:0;padding-left:20px;display:grid;gap:6px' }, h('li', {}, 'Zainstaluj aplikację PanelPilot na NSPanelu i uruchom ją.'), h('li', {}, 'Wybierz na ekranie Home Assistant znaleziony w sieci oraz kształt ekranu.'), h('li', {}, 'Panel pokaże 6-cyfrowy kod. Zatwierdź go tutaj; hasło nie jest potrzebne.')), h('p', { class: 'dim' }, 'Panel dostaje własne konto bez uprawnień administratora, działające tylko w sieci lokalnej. Bez NSPanela możesz otworzyć panel w przeglądarce: ', h('a', { href: new URL('index.html', BASE).href, target: '_blank', rel: 'noopener' }, 'podgląd panelu'), '.'))];
  }

  /* ---------- drobiazgi ---------- */
  dialog(title, content, ...buttons) {
    this.closePop();
    const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', {}, h('h2', {}, title), content, h('div', { class: 'btns' }, buttons.map(([l, fn], i) => h('button', { class: i === buttons.length - 1 ? 'primary' : '', onclick: () => { m.remove(); if (fn) fn(); } }, l)))));
    this.shadowRoot.append(m);
    (m.querySelector('input') || m.querySelector('button.primary')).focus();
  }
  toast(t, bad) {
    this.shadowRoot.querySelectorAll('.toast').forEach(x => x.remove());
    const el = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, t);
    this.shadowRoot.append(el);
    setTimeout(() => el.remove(), bad ? 6000 : 2600);
  }
}

if (!customElements.get('panelpilot-editor')) customElements.define('panelpilot-editor', PanelPilotEditor);
