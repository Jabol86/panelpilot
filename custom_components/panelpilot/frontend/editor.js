/* Edytor pulpitów w menu bocznym Home Assistanta.
   Podgląd to prawdziwy panel w ramce, więc widać dokładnie to, co będzie na ścianie. */
import { SAMPLE } from './samples.js';
import { h, field, group, check, text, select, clone, uid } from './ui.js';

const BASE = new URL('.', import.meta.url);
const GAP = 8;
const LAYOUTS = [['column', 'Ikona nad tekstem'], ['row', 'Ikona obok tekstu'], ['center', 'Wszystko na środku']];
const ICON_SIZES = [['S', 'Mała'], ['M', 'Zwykła'], ['L', 'Duża'], ['XL', 'Bardzo duża'], ['XXL', 'Ogromna']];
const ALIGN_H = [['left', 'Do lewej'], ['center', 'Na środku'], ['right', 'Do prawej']];
const ALIGN_V = [['top', 'Do góry'], ['center', 'Na środku'], ['bottom', 'Do dołu']];
const ANIMS = [['pulse', 'Pulsowanie'], ['spin', 'Obracanie (wentylator)'], ['blink', 'Miganie'], ['bounce', 'Podskakiwanie'], ['shake', 'Kołysanie (dzwonek)'], ['glow', 'Świecenie']];
const RULE_OPS = [['on', 'jest włączona / otwarta'], ['off', 'jest wyłączona / zamknięta'], ['eq', 'ma stan równy'], ['ne', 'ma stan inny niż'], ['gt', 'jest większa niż'], ['lt', 'jest mniejsza niż']];

class PanelPilotEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.tab = 'tiles'; this.fmt = 'portrait'; this.page = 0; this.sel = null;
    this.undo = []; this.redo = []; this.dirty = false; this.bellDirty = false; this.pEdits = {};
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
  /** Coś czeka na przycisk Zapisz: pulpit, domofon albo ustawienia paneli. */
  get unsaved() { return this.dirty || this.bellDirty || Object.keys(this.pEdits).length > 0; }
  set panel(p) { this._panel = p; }
  set narrow(v) { this._narrow = v; }

  connectedCallback() {
    this._leave = e => { if (this.unsaved) { e.preventDefault(); e.returnValue = ''; } };
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
    this.frame = h('iframe', { title: 'Podgląd panelu', src: new URL('index.html?preview&' + v, BASE).href });
    this._unsub = this.hass.connection.subscribeMessage(d => this.onData(d), { type: 'panelpilot/admin/subscribe' });
    this._unsub.catch(e => this.shadowRoot.replaceChildren(h('p', { style: 'padding:24px' }, 'Integracja Panel Pilot nie odpowiada: ' + (e.message || e.code))));
  }

  onData(d) {
    const first = !this.data;
    this.data = d;
    this.syncFormats();
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
    if (!same) this.fmt = this.guessFmt();
    this.doc.pages.forEach(p => p.tiles.forEach(t => { t.id = t.id || uid(); t.l = t.l || {}; }));
    if (this._ready) { this.header(); this.renderBody(); this.refresh(); }
  }

  /** Własne formaty z HA trafiają do DP edytora; zniknięty format = powrót do pionu. */
  syncFormats() {
    if (!this.DP || !this.data) return;
    this.DP.setFormats(this.data.formats || {});
    if (!this.DP.FORMATS[this.fmt]) this.fmt = 'portrait';
  }

  /** Dodanie albo zmiana własnego formatu: rozmiar w pikselach CSS i siatka kafelków. */
  formatDialog(id, done) {
    const all = Object.assign({}, this.data.formats || {}), size = this.panelSize();
    // Wbudowanego formatu (Kwadrat, Pion, Poziom) nie zmieniamy: zapisujemy jego kopię z własną siatką.
    const base = id && !all[id] && this.DP.FORMATS[id];
    const f = base ? { name: base.name + ' ' + base.cols + '×' + base.rows, w: base.w, h: base.h, cols: base.cols, rows: base.rows }
      : Object.assign({ name: 'Tablet', w: 1280, h: 800, cols: 10, rows: 6 }, id ? all[id] : {});
    const picker = this.gridPicker(f);
    const num = (label, key, hint) => field(label, text(f[key], v => { f[key] = Number(v); picker.redraw(); }, { type: 'number', min: 1, placeholder: hint || '' }));
    const body = [
      base ? h('p', { class: 'dim', style: 'margin-bottom:8px' }, 'Format „' + base.name + '” jest wbudowany, więc powstanie jego kopia z tą siatką. Pulpit przełączy się na kopię, a kafelki zostaną na swoich miejscach (te, które się nie zmieszczą, ułożą się same).') : null,
      field('Nazwa', text(f.name, v => { f.name = v; })),
      picker,
      base ? null : h('div', { class: 'row2' }, num('Szerokość ekranu (px CSS)', 'w'), num('Wysokość ekranu (px CSS)', 'h')),
      base ? null : h('p', { class: 'dim' }, 'Rozmiar w pikselach CSS, czyli rozdzielczość podzielona przez skalę ekranu (np. 1920×1200 przy skali 1,5 to 1280×800; NSPanel Pro 1334×750 przy 1,5 to 889×500). Rozmiar służy do podglądu; na tablecie kafelki wypełnią cały ekran według siatki.'),
      !base && size ? h('p', { class: 'dim' }, 'Podpowiedź z podłączonego panelu: ' + size[0] + '×' + size[1] + '.') : null,
      base ? null : h('p', { class: 'dim' }, 'Żeby panel używał tego formatu, wybierz go w zakładce „Panele i jasność” → Format ekranu.')];
    const save = async (list, fid) => {
      try {
        await this.hass.callWS({ type: 'panelpilot/admin/formats_save', data: list });
        this.data.formats = list; this.syncFormats();
        if (fid && done) done(fid);
        if (this.doc.format && !this.DP.FORMATS[this.doc.format]) this.commit(() => { this.doc.format = ''; });
        this.header(); this.bar(); this.renderSides(); this.fit(); this.refresh();
        this.toast('Formaty zapisane');
      } catch (e) { this.toast(e.message || e.code, true); }
    };
    const buttons = [['Anuluj']];
    if (id && !base) buttons.push(['Usuń format', () => { const list = Object.assign({}, all); delete list[id]; if (this.fmt === id) this.fmt = 'portrait'; save(list); }]);
    buttons.push([base ? 'Zapisz siatkę' : 'Zapisz format', () => {
      const fid = id && !base ? id : 'c_' + Math.random().toString(36).slice(2, 10);
      this.fmt = fid;
      const cols = Math.max(1, Math.min(24, Math.round(f.cols) || 1)), rows = Math.max(1, Math.min(24, Math.round(f.rows) || 1));
      // Kopia wbudowanego formatu: przenosimy układ kafelków tam, gdzie się mieści, i przełączamy na nią pulpit.
      const fromBase = base && (newId => this.commit(() => {
        this.doc.pages.forEach(p => p.tiles.forEach(t => {
          const r = t.l && t.l[id];
          if (r === false) t.l[newId] = false;
          else if (Array.isArray(r) && r[0] + r[2] <= cols && r[1] + r[3] <= rows) t.l[newId] = r.slice();
        }));
        this.doc.format = newId;
      }));
      // Nazwa kopii bez zmian użytkownika dostaje nową siatkę, np. „Poziom 14×7”.
      if (base && f.name === base.name + ' ' + base.cols + '×' + base.rows) f.name = base.name + ' ' + cols + '×' + rows;
      save(Object.assign({}, all, { [fid]: { name: (f.name || 'Tablet').trim(), w: f.w, h: f.h, cols, rows } }), fid).then(() => { if (fromBase && this.DP.FORMATS[fid]) { fromBase(fid); this.bar(); this.renderSides(); this.fit(); this.refresh(); } });
    }]);
    this.dialog(base ? 'Siatka formatu „' + base.name + '”' : id ? 'Format „' + f.name + '”' : 'Nowy format ekranu', h('div', {}, ...body.filter(Boolean)), ...buttons);
  }

  /** Wybór siatki jak w ustawieniach ekranu głównego Androida: gotowe warianty z miniaturką,
      −/+ dla kolumn i wierszy oraz podgląd ekranu z wielkością jednego kafelka. Zmienia f.cols i f.rows. */
  gridPicker(f) {
    const box = h('div', { class: 'gridpick' });
    const clamp = v => Math.max(1, Math.min(24, Math.round(v) || 1));
    const presets = () => {
      const r = (+f.w || 1) / (+f.h || 1);
      return r > 1.2 ? [[6, 3], [8, 4], [10, 5], [12, 6], [14, 7], [16, 8]]
        : r < 0.83 ? [[3, 6], [4, 7], [5, 9], [6, 10], [7, 12], [8, 14]]
          : [[4, 4], [5, 4], [6, 5], [8, 6], [8, 8], [10, 8]];
    };
    const mini = (c, r, big) => h('div', { class: 'gp-screen' + (big ? ' big' : ''), style: 'aspect-ratio:' + (+f.w || 16) + '/' + (+f.h || 9) + ';grid-template:repeat(' + r + ',1fr)/repeat(' + c + ',1fr)' },
      Array.from({ length: Math.min(c * r, 576) }, () => h('i')));
    const step = (label, key) => h('div', { class: 'gp-step' }, h('span', { class: 'dim' }, label),
      h('button', { type: 'button', 'aria-label': label + ' mniej', onclick: () => { f[key] = clamp(f[key] - 1); box.redraw(); } }, '−'),
      h('b', {}, String(f[key])),
      h('button', { type: 'button', 'aria-label': label + ' więcej', onclick: () => { f[key] = clamp(f[key] + 1); box.redraw(); } }, '+'));
    box.redraw = () => {
      f.cols = clamp(f.cols); f.rows = clamp(f.rows);
      const tw = Math.round((+f.w || 0) / f.cols), th = Math.round((+f.h || 0) / f.rows);
      box.replaceChildren(
        h('span', { class: 'dim' }, 'Siatka kafelków'),
        h('div', { class: 'gp-presets' }, presets().map(([c, r]) => h('button', { type: 'button', class: 'gp-preset' + (c === f.cols && r === f.rows ? ' on' : ''), onclick: () => { f.cols = c; f.rows = r; box.redraw(); } }, mini(c, r), h('span', {}, c + '×' + r)))),
        h('div', { class: 'gp-main' }, mini(f.cols, f.rows, true),
          h('div', { class: 'gp-side' }, step('Kolumny', 'cols'), step('Wiersze', 'rows'),
            h('p', { class: 'dim' }, 'Kafelek 1×1: ok. ' + tw + '×' + th + ' px. Więcej kolumn i wierszy = mniejsze kafelki, więcej miejsca.'))));
    };
    box.redraw();
    return box;
  }

  /** Rozmiar zgłoszony przez panel z tym pulpitem (np. „1280×800”), do podpowiedzi. */
  panelSize() {
    const list = Object.values(this.data.panels || {}).filter(p => p.dashboard === this.dashId);
    const p = list.find(x => x.connected) || list[0], m = p && /(\d+)\D+(\d+)/.exec(p.size || '');
    return m ? [+m[1], +m[2]] : null;
  }

  /** Podgląd w formacie panelu, który pokazuje ten pulpit (najpierw połączonego), zamiast zawsze w pionie. */
  guessFmt() {
    // Pulpit ma swój format (wybrany przy tworzeniu albo u góry): od niego zaczynamy.
    const own = this.doc && this.doc.format;
    if (own && (!this.DP || this.DP.FORMATS[own])) return own;
    const list = Object.values(this.data.panels || {}).filter(p => p.dashboard === this.dashId);
    const p = list.find(x => x.connected) || list[0];
    if (!p) return this.fmt;
    const chosen = (p.settings || {}).format;
    if (chosen && chosen !== 'auto' && (!this.DP || this.DP.FORMATS[chosen])) return chosen;
    if (p.shape === 'square') return 'square';
    const m = /(\d+)\D+(\d+)/.exec(p.size || '');
    if (m) { const w = +m[1], hh = +m[2]; return w > hh * 1.18 ? 'landscape' : hh > w * 1.18 ? 'portrait' : 'square'; }
    return [90, 270].includes((p.settings || {}).rotation) ? 'landscape' : 'portrait';
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
      for (const [id, data] of Object.entries(this.pEdits)) {
        if (this.data.panels[id]) await this.hass.callWS({ type: 'panelpilot/admin/panel_save', device_id: id, data });
        delete this.pEdits[id];
      }
      if (this.tab === 'panels') this.renderBody();
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
    this.syncFormats();
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
    const dashes = Object.entries(this.data.dashboards), waiting = this.data.pairing.length, mode = this.doc.mode || 'tiles', dirty = this.unsaved;
    this.headEl.replaceChildren(
      h('button', { class: 'icon', 'aria-label': 'Menu Home Assistant', onclick: () => this.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true })) }, '☰'),
      select(this.dashId, dashes.map(([id, d]) => [id, id === this.dashId ? this.doc.name : d.name]), id => this.guard(() => this.openDash(id), () => this.header())),
      h('button', { onclick: () => this.newDash() }, 'Nowy'),
      this.formatSelect(),
      select(mode, [['tiles', 'Kafelki'], ['code', 'Własny kod (HTML, CSS, JS)'], ['module', 'Moduł JS z pliku']], v => { this.sel = null; this.commit(() => { this.doc.mode = v; }); this.tab = v === 'tiles' ? 'tiles' : 'code'; this.header(); this.renderBody(); }),
      h('span', { class: 'sp' }),
      h('button', { class: 'icon', 'aria-label': 'Cofnij', title: 'Cofnij (Ctrl+Z)', disabled: !this.undo.length, onclick: () => this.back(this.undo, this.redo) }, '↶'),
      h('button', { class: 'icon', 'aria-label': 'Ponów', title: 'Ponów (Ctrl+Y)', disabled: !this.redo.length, onclick: () => this.back(this.redo, this.undo) }, '↷'),
      h('button', { class: 'primary', disabled: !dirty, onclick: () => this.save() }, dirty ? 'Zapisz' : 'Zapisane'));
    const tiles = mode === 'tiles';
    if (!tiles && this.tab === 'tiles') this.tab = 'code';
    const tabs = [tiles && ['tiles', 'Kafelki'], ['look', 'Wygląd'], ['gestures', 'Gesty'], ['saver', 'Wygaszacz'], ['bell', 'Domofon'], ['code', tiles ? 'CSS i JS' : 'Kod'], ['json', 'Eksport'], ['panels', 'Panele i jasność']].filter(Boolean);
    this.tabsEl.replaceChildren(...tabs.map(([id, name]) => h('button', { role: 'tab', 'aria-selected': String(this.tab === id), onclick: () => { this.tab = id; this.sel = null; this.header(); this.renderBody(); this.refresh(); } }, name, id === 'panels' && waiting ? h('span', { class: 'badge' }, String(waiting)) : null)));
  }

  guard(fn, cancel) {
    if (!this.dirty) return fn();
    this.dialog('Niezapisane zmiany', h('p', {}, 'Zmiany w tym pulpicie nie są zapisane.'), ['Wróć', cancel], ['Odrzuć zmiany', () => { this.dirty = false; fn(); }]);
  }

  /** Lista formatów: wbudowane i własne, opcjonalnie z pozycją „+ Nowy format…”. */
  formatOptions(extra) {
    const all = this.DP ? Object.entries(this.DP.FORMATS) : [];
    const hint = { square: ' (NSPanel Pro 86)', portrait: ' (NSPanel Pro 120 pionowo)', landscape: ' (NSPanel Pro 120 poziomo)' };
    return all.map(([id, f]) => [id, f.name + (hint[id] || ' · ' + f.w + '×' + f.h)]).concat(extra ? [['__new', '+ Nowy format…']] : []);
  }

  /** Format pulpitu na górnym pasku: w nim projektujesz i z niego korzysta panel bez własnego wyboru. */
  formatSelect() {
    if ((this.doc.mode || 'tiles') !== 'tiles') return null;
    const cur = this.doc.format || '', f = cur && this.DP && this.DP.FORMATS[cur];
    const opts = [['', 'Format: z ekranu panelu']].concat(this.formatOptions(true));
    // Własny format: zmiana nazwy, rozmiaru i siatki; wbudowany: zmiana siatki (zapisuje się jako kopia).
    if (f) opts.push(['__edit', f.custom ? 'Edytuj „' + f.name + '” (rozmiar, siatka)…' : 'Zmień siatkę „' + f.name + '” (' + f.cols + '×' + f.rows + ')…']);
    const el = select(cur, opts, v => {
      if (v === '__new') { el.value = cur; return this.formatDialog(null, fid => this.commit(() => { this.doc.format = fid; })); }
      if (v === '__edit') { el.value = cur; return this.formatDialog(cur); }
      this.commit(() => { this.doc.format = v; });
      if (v) this.fmt = v;
      this.bar(); this.renderSides(); this.fit(); this.refresh();
    });
    el.title = 'Format ekranu tego pulpitu'; el.className = 'fmt';
    return el;
  }

  newDash() {
    let name = 'Nowy pulpit', from = 'empty', format = this.doc.format || this.fmt;
    const fmtField = field('Format ekranu', select(format, this.formatOptions(true), v => { format = v; }));
    this.dialog('Nowy pulpit', [field('Nazwa', text(name, v => { name = v; })),
      fmtField, h('p', { class: 'dim' }, 'Format to rozmiar ekranu i siatka kafelków. „+ Nowy format…” pozwala dodać inny tablet. Później zmienisz go na górnym pasku.'),
      field('Zacznij od', select(from, [['empty', 'Pusty'], ['copy', 'Kopia obecnego'], ['code', 'Własny kod']], v => { from = v; }))], ['Anuluj'], ['Utwórz', async () => {
      const code = from === 'code', data = from === 'copy' ? clone(this.doc) : { pages: [{ name: 'Dom', tiles: [] }], mode: code ? 'code' : 'tiles', html: code ? SAMPLE.html : '', css: code ? SAMPLE.css : '', code: code ? SAMPLE.js : '' };
      data.name = name;
      delete data.rev;
      data.format = format === '__new' ? '' : format;
      try {
        const r = await this.hass.callWS({ type: 'panelpilot/admin/dashboard_save', dashboard_id: null, data });
        this.data.dashboards[r.id] = this.data.dashboards[r.id] || Object.assign(data, { rev: r.rev });
        this.guard(() => {
          this.tab = data.mode === 'tiles' ? 'tiles' : 'code'; this.openDash(r.id);
          if (format === '__new') this.formatDialog(null, fid => { this.commit(() => { this.doc.format = fid; }); this.save(); });
        });
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
      this.win.Panel.setPreview({ bridge: this.bridge, states: this.hass.states, dashboard: clone(this.doc), doorbell: Object.assign({}, this.bell, { own: !!this.bell.stream }), formats: this.data.formats || {}, format: this.fmt, page: at, mode, night: this.night });
      this.drawOver();
      // Własny JS mógł dodać nowe rodzaje kafelków.
      const n = Object.keys(this.win.Panel.widgets).length;
      if (n !== this._kinds) { this._kinds = n; if (this.tab === 'tiles') this.palette(); }
    }, 60);
  }

  get tiles() { return this.doc.pages[this.page].tiles; }
  tile(id) { return this.tiles.find(t => t.id === id); }
  layout() { return this.DP.layout(this.tiles, this.fmt, this.win.Panel.widgets); }

  /** Geometria siatki podglądu. Wiersze mogą mieć różną wysokość (wiersz sekcji = pół), więc bierzemy je z panelu. */
  geo() {
    const el = this.win.document.getElementById('grid'), g = el.getBoundingClientRect(), f = this.DP.FORMATS[this.fmt];
    const ch = (g.height - GAP * (f.rows - 1)) / f.rows;
    let hs = this.win.getComputedStyle(el).gridTemplateRows.split(' ').map(parseFloat);
    if (hs.length !== f.rows || hs.some(isNaN)) hs = new Array(f.rows).fill(ch);
    const tops = [];
    hs.reduce((top, hh, i) => { tops[i] = top; return top + hh + GAP; }, 0);
    return { x: g.left, y: g.top, cw: (g.width - GAP * (f.cols - 1)) / f.cols, ch, hs, tops, f };
  }
  /** Górna krawędź i wysokość wierszy od y do y+h (z zabezpieczeniem na krańcach siatki). */
  rowSpan(g, y, hh) {
    const a = Math.max(0, Math.min(g.hs.length - 1, y)), b = Math.max(a, Math.min(g.hs.length - 1, y + hh - 1));
    return [g.tops[a], g.tops[b] + g.hs[b] - g.tops[a]];
  }
  css(r, g) {
    const k = this.k, [top, height] = this.rowSpan(g, r.y, r.h);
    return 'left:' + (g.x + r.x * (g.cw + GAP)) * k + 'px;top:' + (g.y + top) * k + 'px;width:' + (r.w * g.cw + (r.w - 1) * GAP) * k + 'px;height:' + height * k + 'px';
  }
  cell(e, g) {
    const b = this.screen.getBoundingClientRect(), k = this.k, py = (e.clientY - b.top) / k - g.y;
    // Numer wiersza z ułamkiem, liczony po rzeczywistych wysokościach wierszy.
    let y = py / (g.ch + GAP);
    if (py >= 0) for (let i = 0; i < g.hs.length; i++) {
      if (py < g.tops[i] + g.hs[i] + GAP || i === g.hs.length - 1) { y = i + (py - g.tops[i]) / (g.hs[i] + GAP); break; }
    }
    return { x: ((e.clientX - b.left) / k - g.x) / (g.cw + GAP), y };
  }

  drawOver() {
    if (!this.win || this._drag) return;
    const coded = this.doc.mode === 'code' || this.doc.mode === 'module';
    this.over.classList.toggle('off', coded && this.tab === 'code');
    if (this.tab !== 'tiles' || coded) { this.over.replaceChildren(); this.tray.replaceChildren(); return; }
    const g = this.geo(), { placed, overflow } = this.layout(), f = g.f;
    const lines = h('div', { class: 'gridlines', style: this.css({ x: 0, y: 0, w: f.cols, h: f.rows }, g) + ';grid-template:' + g.hs.map(v => v * this.k + 'px').join(' ') + '/repeat(' + f.cols + ',1fr);gap:' + GAP * this.k + 'px' }, Array.from({ length: f.cols * f.rows }, () => h('i')));
    this.over.replaceChildren(lines, ...placed.map(p => h('div', { class: 'box' + (p.tile.id === this.sel ? ' sel' : ''), style: this.css(p, g), 'data-id': p.tile.id }, h('div', { class: 'hd' }))));
    if (!this.tiles.length) this.over.append(h('div', { class: 'empty' }, h('b', {}, 'Pusta strona'), h('span', {}, 'Przeciągnij kafelek z listy po lewej.')));
    const hidden = this.tiles.filter(t => t.l[this.fmt] === false);
    // Kliknięcie nazwy otwiera ustawienia kafelka (tam jest rozmiar i „Usuń”), × usuwa od razu.
    const chip = t => h('span', { class: 'chip' + (t.id === this.sel ? ' sel' : '') },
      h('button', { type: 'button', title: 'Ustawienia kafelka', onclick: () => { this.sel = t.id; this.renderSides(); this.drawOver(); } }, this.label(t)),
      h('button', { type: 'button', 'aria-label': 'Usuń ' + this.label(t), title: 'Usuń kafelek', onclick: () => this.remove(t.id) }, '×'));
    const toNewPage = () => this.commit(() => {
      const moving = overflow.map(t => t.tile || t);
      this.doc.pages[this.page].tiles = this.tiles.filter(t => !moving.includes(t));
      moving.forEach(t => { t.l = {}; });
      this.doc.pages.splice(this.page + 1, 0, { name: this.doc.pages[this.page].name + ' 2', tiles: moving });
    });
    this.tray.replaceChildren(
      ...(overflow.length ? [h('span', { class: 'dim' }, 'Nie mieszczą się na tej stronie (na panelu trafią na dodatkową stronę):'), ...overflow.map(chip), h('button', { type: 'button', onclick: toNewPage }, 'Przenieś na nową stronę')] : []),
      ...(hidden.length ? [h('span', { class: 'dim' }, 'Ukryte w tym formacie:'), ...hidden.map(chip)] : []));
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
    if (ctrl && k === 's') { e.preventDefault(); if (this.unsaved) this.save(); return; }
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
    const formats = this.DP ? Object.entries(this.DP.FORMATS) : [], cur = this.DP && this.DP.FORMATS[this.fmt];
    // Pulpit z ustalonym formatem (górny pasek) nie potrzebuje przełącznika podglądu.
    const fixed = this.doc.format && cur && this.fmt === this.doc.format;
    this.barEl.replaceChildren(...[
      fixed ? null : h('div', { class: 'seg', role: 'group', 'aria-label': 'Podgląd w formacie' }, formats.map(([id, f]) => h('button', { 'aria-pressed': String(this.fmt === id), onclick: () => { this.fmt = id; this.bar(); this.renderSides(); this.fit(); this.refresh(); } }, f.name))),
      h('span', { class: 'dim' }, cur ? (fixed ? cur.name + ': ' : '') + cur.w + '×' + cur.h + ', siatka ' + cur.cols + '×' + cur.rows : ''),
      cur && this.tab === 'tiles' ? h('button', { title: 'Liczba kolumn i wierszy kafelków w tym formacie', onclick: () => this.formatDialog(this.fmt) }, 'Zmień siatkę') : null,
      h('span', { style: 'flex:1' }),
      this.tab === 'tiles' ? h('button', { title: 'Usuwa ręczny układ tylko w tym formacie', onclick: () => this.commit(() => this.tiles.forEach(t => { delete t.l[this.fmt]; })) }, 'Ułóż automatycznie') : null,
      this.tab === 'saver' ? check('Widok nocny', this.night, v => { this.night = v; this.refresh(); }) : null].filter(Boolean));
  }

  renderSides() {
    if (!this.win || !this._ready) return;
    const tabs = { look: () => this.lookTab(), gestures: () => this.gestureTab(), saver: () => this.saverTab(), bell: () => this.bellTab(), code: () => this.codeTab() };
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
      field('Nagłówek nad kafelkami (pusty = bez)', text(p.title, v => this.commit(() => { if (v.trim()) p.title = v; else delete p.title; }, { key: 'title' + i, quiet: true }), { placeholder: 'np. Kuchnia' })),
      p.title ? field('Położenie nagłówka', select(p.titleAlign || 'left', ALIGN_H, v => this.commit(() => { p.titleAlign = v; }))) : null,
      h('p', { class: 'dim', style: 'margin:-4px 0 8px' }, 'Nagłówek ma wysokość pół kafelka i zajmuje całą szerokość nad siatką.'),
      h('div', { class: 'btns', style: 'justify-content:flex-start' }, h('button', { disabled: i === 0, onclick: () => move(-1) }, 'Wcześniej'), h('button', { disabled: i === n - 1, onclick: () => move(1) }, 'Później'), h('button', { class: 'danger', disabled: n === 1, onclick: () => this.commit(() => { this.doc.pages.splice(i, 1); this.page = Math.max(0, i - 1); }) }, 'Usuń stronę')),
      h('h3', {}, 'Pulpit'), field('Nazwa pulpitu', text(this.doc.name, v => this.commit(() => { this.doc.name = v; }, { key: 'name', quiet: true }))),
      h('button', { class: 'danger', disabled: Object.keys(this.data.dashboards).length < 2, onclick: () => this.dialog('Usunąć pulpit „' + this.doc.name + '”?', h('p', {}, 'Tego nie da się cofnąć. Panele z tym pulpitem dostaną inny.'), ['Anuluj'], ['Usuń', () => { this.dirty = false; this.hass.callWS({ type: 'panelpilot/admin/dashboard_delete', dashboard_id: this.dashId }).catch(e => this.toast(e.message, true)); }]) }, 'Usuń pulpit'),
      h('h3', {}, 'Wskazówki'), h('p', { class: 'dim' }, 'Kliknij kafelek, aby go ustawić. Przeciągnij, aby przesunąć; kropka w rogu zmienia rozmiar. Strzałki przesuwają, Shift+strzałki zmieniają rozmiar, Ctrl+D powiela, Delete usuwa. Każdy format ma własny układ.')];
  }

  inspector(t) {
    const w = this.win.Panel.widgets[t.type] || { name: t.type, fields: [] };
    const set = (k, v, full) => this.commit(() => { if (v === '' || v == null) delete t[k]; else t[k] = v; }, full ? {} : { key: t.id + k, quiet: true });
    const fields = (w.fields || []).map(f => {
      const L = this.lbl(f.l, f.tip);
      if (f.t === 'entity') return field(L, this.entityPicker(t[f.k], f.d, v => set(f.k, v, true)));
      if (f.t === 'entities') return group(L, this.entityList(t[f.k] || [], f.d, v => set(f.k, v, true)),
        // Szybkie wypełnienie, np. wszystkie światła (bez grup świateł, żeby nie liczyć ich podwójnie).
        ...(f.quick || []).map(([dom, label]) => h('button', { type: 'button', class: 'add', onclick: () => {
          const all = Object.keys(this.hass.states).filter(id => id.startsWith(dom + '.') && !Array.isArray(this.hass.states[id].attributes.entity_id)).sort();
          set(f.k, [...new Set((t[f.k] || []).concat(all))], true);
        } }, label)));
      if (f.t === 'bool') return check(L, t[f.k] === undefined ? f.def : t[f.k], v => this.commit(() => { t[f.k] = v; }, { quiet: true }));
      if (f.t === 'area') return field(L, h('textarea', { value: t[f.k] || '', rows: 4, oninput: e => set(f.k, e.target.value) }));
      if (f.t === 'code') return group(L, this.codeField(t[f.k], v => set(f.k, v), 7));
      if (f.t === 'stations') return group(L, this.stations(t));
      if (f.t === 'sources') return group(L, this.tvSources(t));
      if (f.t === 'select') return field(L, select(t[f.k] || '', f.o, v => set(f.k, v)));
      const num = f.t === 'number';
      return field(L, text(t[f.k], v => set(f.k, num && v !== '' ? Number(String(v).replace(',', '.')) : v), { type: num ? 'number' : 'text', step: 'any', placeholder: f.ph || '' }));
    });
    const tap = t.tap || {}, setTap = o => this.commit(() => { t.tap = Object.assign({}, t.tap, o); if (t.tap.kind === 'default') delete t.tap; });
    const p = this.layout().placed.find(x => x.tile === t), f = this.DP.FORMATS[this.fmt];
    const num = (k, i) => field(k, text(p ? [p.x, p.y, p.w, p.h][i] + (i < 2 ? 1 : 0) : '', v => {
      const now = this.layout().placed.find(x => x.tile === t), r = { x: now.x, y: now.y, w: now.w, h: now.h };
      r['xywh'[i]] = Number(v) - (i < 2 ? 1 : 0);
      if (r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= f.cols && r.y + r.h <= f.rows) this.commit(() => this.place(t, r), { quiet: true, key: t.id + k });
    }, { type: 'number', disabled: !p }));
    const rules = (t.rules || []).length, tapNames = { none: 'nic', toggle: 'przełącz', page: 'strona', service: 'akcja' };
    return [
      h('h3', {}, w.name),
      // Działy do zwijania: najpierw to, co kafelek robi, potem wygląd, warunki, dotknięcie i położenie.
      this.sec('basic', 'Podstawowe', [
        field(this.lbl('Rodzaj kafelka', 'Zmiana rodzaju zachowuje nazwę, kolory i położenie; pola specyficzne dla rodzaju trzeba ustawić od nowa.'), select(t.type, Object.entries(this.win.Panel.widgets).map(([id, x]) => [id, x.name]), v => this.commit(() => { t.type = v; if (v === 'music' && !t.stations) t.stations = []; }))),
        ...fields,
        field(this.lbl(w.thin ? 'Napis, np. Kuchnia' : 'Nazwa', w.thin ? '' : 'Napis na kafelku. Pusta = nazwa encji z Home Assistant.'), text(t.name, v => set('name', v))),
        w.noIcon ? null : field(this.lbl('Ikona', 'Własne ikony Panel Pilot albo dowolna mdi:… z Home Assistant.'), this.iconPicker(t.icon || w.icon, v => set('icon', v, true))),
        w.noEntity || w.thin ? null : field(this.lbl('Licznik czasu', 'Liczy od chwili, w której encja kafelka się włączyła (ostatnia zmiana stanu w Home Assistant), dopóki jest włączona. Po wyłączeniu znika. Po restarcie Home Assistanta liczy od restartu.'),
          select(t.timer || '', [['', 'Brak'], ['up', 'Ile minęło od włączenia'], ['down', 'Odliczanie do zera']], v => this.commit(() => { if (v) t.timer = v; else { delete t.timer; delete t.timerMin; } }))),
        t.timer === 'down' ? field(this.lbl('Czas odliczania (min)', 'Ustaw tyle samo, co w automatyzacji, która wyłącza encję (np. 60 w stoptimer w Node-RED). Ostatnia minuta miga.'),
          text(t.timerMin == null ? '' : t.timerMin, v => set('timerMin', v === '' ? '' : Number(String(v).replace(',', '.'))), { type: 'number', step: '1', min: 1, max: 1440, placeholder: '60' })) : null]),
      this.sec('look', 'Wygląd', [
        h('div', { class: 'row2' }, this.color('Tło', t.bg, v => set('bg', v)), this.color('Kolor podświetlenia', t.color, v => set('color', v))),
        w.noIcon ? null : this.color('Tło ikony (kółko)', t.iconBg, v => set('iconBg', v)),
        w.plain ? null : field(this.lbl('Nazwa na kafelku', 'Ukryj, gdy wystarczy ikona i napis z warunku, np. alarm: zamiast „Alarm Status” i „disarmed” tylko „Rozbrojony”.'),
          select(t.showName === false ? '0' : '', [['', 'Pokaż'], ['0', 'Ukryj']], v => this.commit(() => { if (v === '0') t.showName = false; else delete t.showName; }))),
        w.plain ? null : field(this.lbl('Stan pod nazwą', 'Napis typu „włączone”, „wyłączone”, „2 włączone”. „Jak w motywie” bierze ustawienie z zakładki Wygląd. Napis z warunku pokazuje się zawsze.'), select(t.showState == null ? '' : t.showState ? '1' : '0', [['', 'Jak w motywie'], ['1', 'Pokaż'], ['0', 'Ukryj']], v => this.commit(() => { if (v === '') delete t.showState; else t.showState = v === '1'; }))),
        field('Wielkość tekstu', select(t.text || '', [['S', 'Mała'], ['', 'Zwykła'], ['L', 'Duża'], ['XL', 'Bardzo duża']], v => set('text', v))),
        w.noIcon ? null : h('div', { class: 'row2' },
          field(this.lbl('Układ', 'Ikona nad napisem albo obok niego.'), select(t.layout || '', [['', 'Jak w motywie']].concat(LAYOUTS), v => set('layout', v, true))),
          field('Wielkość ikony', select(t.iconSize || '', [['', 'Jak w motywie']].concat(ICON_SIZES), v => set('iconSize', v, true)))),
        w.plain ? null : this.posPicker('Położenie treści w kafelku', t.align, t.valign, 'Jak w motywie',
          (a, v) => this.commit(() => { if (a) t.align = a; else delete t.align; if (v) t.valign = v; else delete t.valign; })),
        w.noIcon ? null : field(this.lbl('Animacja ikony, gdy włączony', 'Działa, gdy kafelek jest „włączony” (np. światło świeci). Warunki mogą ustawić inną animację.'), select(t.anim || '', [['', 'Jak w motywie']].concat([['none', 'Bez animacji']], ANIMS), v => set('anim', v, true)))]),
      this.sec('rules', 'Warunki', this.rulesFields(t), rules ? String(rules) : ''),
      this.sec('tap', 'Dotknięcie', [
        field(this.lbl('Co robi', '„Domyślnie” to zachowanie rodzaju kafelka, np. przełącznik włącza i wyłącza encję. Możesz zamiast tego otworzyć stronę albo wywołać akcję.'), select(tap.kind || 'default', [['default', 'Domyślnie dla tego kafelka'], ['none', 'Nic'], ['toggle', 'Przełącz encję'], ['page', 'Otwórz stronę'], ['service', 'Wywołaj akcję HA']], v => setTap({ kind: v }))),
        tap.kind === 'page' ? field('Strona', select(tap.page || '', [['', '–']].concat(this.doc.pages.map(x => [x.name, x.name])), v => setTap({ page: v }))) : null,
        ...(tap.kind === 'service' ? this.serviceFields(tap, setTap) : []),
        w.confirmable || tap.kind === 'service' || tap.kind === 'toggle' ? check('Pytaj o potwierdzenie', t.confirm, v => set('confirm', v)) : null], tapNames[tap.kind] || ''),
      this.sec('place', 'Położenie: ' + f.name.toLowerCase(), [
        !p && t.l[this.fmt] !== false ? h('div', { class: 'st' }, h('p', { class: 'dim', style: 'margin:0 0 6px' }, 'Ten kafelek nie mieści się na tej stronie.'),
          h('button', { onclick: () => this.fitIn(t) }, 'Wstaw w największe wolne miejsce')) : null,
        h('div', { class: 'row4' }, num('Kol.', 0), num('Wiersz', 1), num('Szer.', 2), num('Wys.', 3)),
        check(this.lbl('Pokazuj w tym formacie', 'Każdy format ekranu (kwadrat, pion, poziom, własne) ma osobny układ. Odznacz, żeby ukryć kafelek tylko w tym formacie.'), t.l[this.fmt] !== false, v => this.commit(() => { if (v) delete t.l[this.fmt]; else { this.pin(); t.l[this.fmt] = false; } })),
        this.doc.pages.length > 1 ? field('Na stronie', select(String(this.page), this.doc.pages.map((x, i) => [String(i), x.name]), v => this.commit(() => { this.doc.pages[this.page].tiles = this.tiles.filter(x => x !== t); t.l = {}; this.page = +v; this.tiles.push(t); }))) : null]),
      h('div', { class: 'btns' }, h('button', { class: 'danger', onclick: () => this.remove(t.id) }, 'Usuń'), h('button', { onclick: () => this.duplicate(t.id) }, 'Powiel')),
    ];
  }
  /** Zmniejsza kafelek, aż zmieści się w wolnym miejscu strony (największe pole wygrywa). */
  fitIn(t) {
    const f = this.DP.FORMATS[this.fmt], taken = this.layout().placed.filter(p => p.tile !== t);
    let best = null;
    for (let w = f.cols; w >= 1; w--) for (let hh = f.rows; hh >= 1; hh--) {
      if (best && w * hh <= best.w * best.h) continue;
      const s = this.DP.freeSpot(w, hh, f, taken);
      if (s) best = s;
    }
    if (!best) return this.toast('Na tej stronie nie ma wolnego miejsca. Użyj „Przenieś na nową stronę”.', true);
    this.commit(() => { this.pin(); t.l[this.fmt] = [best.x, best.y, best.w, best.h]; });
  }

  /** Warunki: „gdy encja … to kolor / tło / ikona / animacja”. Liczy się pierwszy spełniony. */
  rulesFields(t) {
    const rules = t.rules || [];
    const upd = (fn, key) => this.commit(() => { t.rules = (t.rules || []).map(r => Object.assign({}, r)); fn(t.rules); if (!t.rules.length) delete t.rules; }, key ? { key: t.id + key, quiet: true } : {});
    const out = [h('p', { class: 'dim', style: 'margin:0 0 8px' }, 'Np. gdy czujnik ruchu jest włączony, kafelek świeci na czerwono; gdy brama się otwiera, pod nazwą widać „Otwieranie…”. Sprawdzane po kolei, działa pierwszy spełniony.')];
    rules.forEach((r, i) => {
      const set = (k, v, full) => upd(list => { if (v === '' || v == null) delete list[i][k]; else list[i][k] = v; }, full ? null : 'r' + i + k);
      const needsValue = ['eq', 'ne', 'gt', 'lt'].includes(r.op);
      out.push(h('div', { class: 'st rule' },
        h('div', { style: 'display:flex;gap:6px;align-items:center' }, h('b', { style: 'flex:1' }, 'Warunek ' + (i + 1)),
          h('button', { class: 'icon', 'aria-label': 'Wyżej', disabled: !i, onclick: () => upd(list => list.splice(i - 1, 0, list.splice(i, 1)[0])) }, '↑'),
          // Kopia warunku tuż pod nim: zwykle zmienia się tylko wartość, kolor i napis.
          h('button', { class: 'icon', 'aria-label': 'Powiel warunek', title: 'Powiel warunek', onclick: () => upd(list => list.splice(i + 1, 0, JSON.parse(JSON.stringify(list[i])))) }, '⧉'),
          h('button', { class: 'icon danger', 'aria-label': 'Usuń warunek', onclick: () => upd(list => list.splice(i, 1)) }, '×')),
        group('Gdy encja', this.entityPicker(r.entity, null, v => set('entity', v, true)), r.entity ? null : h('small', { class: 'dim' }, 'Pusta = encja tego kafelka')),
        h('div', { class: 'row2' }, select(r.op || 'on', RULE_OPS, v => set('op', v, true)),
          needsValue ? text(r.value, v => set('value', v), { placeholder: r.op === 'gt' || r.op === 'lt' ? 'np. 25' : 'np. open' }) : h('span')),
        h('div', { class: 'row2' }, this.color('Kolor podświetlenia', r.color, v => set('color', v)), this.color('Tło kafelka', r.bg, v => set('bg', v))),
        h('div', { class: 'row2' },
          field('Podświetlenie', select(r.lit == null ? '' : r.lit ? '1' : '0', [['', 'Jak zwykle'], ['1', 'Podświetl'], ['0', 'Bez podświetlenia']], v => set('lit', v === '' ? null : v === '1', true))),
          field('Animacja', select(r.anim || '', [['', 'Bez animacji']].concat(ANIMS), v => set('anim', v, true)))),
        field('Inna ikona', h('div', { style: 'display:flex;gap:6px;align-items:center' }, this.iconPicker(r.icon || '', v => set('icon', v, true)),
          r.icon ? h('button', { class: 'icon', 'aria-label': 'Bez zmiany ikony', onclick: () => set('icon', '', true) }, '×') : null)),
        field(this.lbl('Napis stanu', 'Tekst na kafelku, gdy ten warunek jest spełniony, np. „Otwieranie…” albo „Rozbrojony”. W kafelku z wartością (czujnik, alarm) zastępuje wartość, w pozostałych stan pod nazwą. {state} wstawia stan encji. Nazwę kafelka ukryjesz w dziale Wygląd.'),
          text(r.text, v => set('text', v), { placeholder: 'np. Otwieranie…' }))));
    });
    out.push(h('div', { class: 'btns', style: 'justify-content:flex-start' },
      h('button', { onclick: () => upd(list => list.push({ op: 'on', color: '#ee1c25', lit: true })) }, '+ Warunek')));
    return out;
  }

  /** Etykieta z przyciskiem (i): kliknięcie pokazuje lub chowa wyjaśnienie pod polem. */
  lbl(label, tip) {
    if (!tip) return label;
    const box = h('small', { class: 'tipbox', hidden: true }, tip);
    const btn = h('button', { type: 'button', class: 'info', title: tip, 'aria-label': 'Co to robi?', onclick: e => { e.preventDefault(); e.stopPropagation(); box.hidden = !box.hidden; btn.classList.toggle('on', !box.hidden); } }, 'i');
    // Wyjaśnienie trafia na koniec pola (po kontrolce), gdy pole jest już w drzewie.
    queueMicrotask(() => { const f = btn.closest('.f'); if (f) f.append(box); });
    return h('span', { class: 'lbl' }, label, btn);
  }

  /** Zwijany dział ustawień kafelka; to, co otwarte, edytor pamięta. */
  sec(id, title, kids, badge) {
    const open = this.secOpen || (this.secOpen = (() => { try { return JSON.parse(localStorage.getItem('pp-sec')) || null; } catch (e) { return null; } })() || { basic: true });
    const d = h('details', { class: 'sec', open: !!open[id], ontoggle: () => { open[id] = d.open; try { localStorage.setItem('pp-sec', JSON.stringify(open)); } catch (e) { /* bez pamięci */ } } },
      h('summary', {}, h('span', {}, title), badge ? h('em', {}, badge) : null), h('div', { class: 'sec-body' }, kids));
    return d;
  }

  /** Siatka 3×3: jedno kliknięcie ustawia położenie w poziomie i w pionie naraz. */
  posPicker(label, ah, av, resetLabel, fn) {
    const cells = [];
    ALIGN_V.forEach(([v, vn]) => ALIGN_H.forEach(([a, an]) => {
      const on = !!(ah || av) && (ah || 'left') === a && (av || 'center') === v;
      cells.push(h('button', { type: 'button', class: 'pos' + (on ? ' on' : ''), title: vn + ', ' + an.toLowerCase(), 'aria-label': vn + ', ' + an.toLowerCase(), 'aria-pressed': String(on), onclick: () => fn(a, v) }, h('i')));
    }));
    const now = ah || av ? [(ALIGN_V.find(x => x[0] === av) || [0, 'Środek'])[1], (ALIGN_H.find(x => x[0] === ah) || [0, 'do lewej'])[1].toLowerCase()].join(', ') : resetLabel;
    return group(label, h('div', { class: 'posrow' }, h('div', { class: 'posgrid' }, cells),
      h('div', {}, h('div', {}, now), ah || av ? h('button', { type: 'button', style: 'margin-top:6px', onclick: () => fn('', '') }, resetLabel.split(' (')[0]) : null)));
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

  /** Źródła i aplikacje telewizora: nazwa (jak w HA albo nazwa aplikacji), logo i opcjonalna własna akcja. */
  tvSources(t) {
    const list = t.sources = t.sources || [], upd = (fn, key) => this.commit(fn, key ? { quiet: true, key } : {});
    const st = this.hass.states[t.entity], have = st && st.attributes.source_list || [];
    return h('div', {},
      h('p', { class: 'dim', style: 'margin:0 0 6px' }, 'Nazwa źródła taka jak w HA (np. HDMI 1) przełącza wejście. Aplikację (YouTube, Netflix) dodaj z własną akcją, np. media_player.play_media albo remote.send_command. Gdy telewizor pokazuje dane źródło lub aplikację, jego logo staje się tłem kafelka.'),
      list.map((s, i) => h('div', { class: 'st' },
        h('div', { style: 'display:flex;gap:6px' }, text(s.name, v => upd(() => { s.name = v; }, t.id + 'sn' + i), { placeholder: 'Nazwa, np. HDMI 1 albo Netflix' }), h('button', { class: 'icon', 'aria-label': 'Wyżej', disabled: !i, onclick: () => upd(() => list.splice(i - 1, 0, list.splice(i, 1)[0])) }, '↑'), h('button', { class: 'icon danger', 'aria-label': 'Usuń', onclick: () => upd(() => list.splice(i, 1)) }, '×')),
        text(s.image, v => upd(() => { s.image = v; }, t.id + 'si' + i), { placeholder: 'Logo, np. /local/tv/netflix.png' }),
        text(s.match, v => upd(() => { s.match = v; }, t.id + 'sm' + i), { placeholder: 'Rozpoznawaj też po nazwie (opcjonalnie, np. nazwa aplikacji w HA)' }),
        h('details', { open: false }, h('summary', {}, s.service ? 'Akcja: ' + s.service : 'Akcja: przełącz źródło (domyślnie)'), this.serviceFields(s, o => upd(() => Object.assign(s, o)))))),
      h('div', { class: 'btns', style: 'justify-content:flex-start' },
        h('button', { onclick: () => upd(() => list.push({ name: '', data: {} })) }, '+ Dodaj źródło lub aplikację'),
        have.length ? h('button', { onclick: () => upd(() => have.filter(n => !list.some(s => s.name === n)).forEach(n => list.push({ name: n, data: {} }))) }, '+ Wszystkie źródła z telewizora (' + have.length + ')') : null));
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

  /* ---------- wygląd, wygaszacz, domofon ---------- */
  lookTab() {
    const t = this.doc.theme || {}, set = (k, v) => this.commit(() => { this.doc.theme = this.doc.theme || {}; if (v === '') delete this.doc.theme[k]; else this.doc.theme[k] = v; }, { key: 'th' + k, quiet: true });
    // Zmiana, po której prawy panel trzeba narysować od nowa (pojawiają się zależne pola).
    const setFull = (k, v) => this.commit(() => { this.doc.theme = Object.assign({}, this.doc.theme); if (v) this.doc.theme[k] = v; else delete this.doc.theme[k]; });
    const cur = Object.assign({}, this.DP.THEMES.Grafit, t), range = (l, k, min, max, v, conv) => field(l, h('input', { type: 'range', min, max, value: v, oninput: e => set(k, conv(+e.target.value)) }));
    return [h('h3', {}, 'Gotowe motywy'), h('div', { class: 'themes' }, Object.entries(this.DP.THEMES).map(([n, v]) => h('button', { onclick: () => this.commit(() => { this.doc.theme = Object.assign({}, this.doc.theme, v); }) }, h('span', { class: 'sw', style: 'background:linear-gradient(90deg,' + v.bg + ' 33%,' + v.tile + ' 33% 66%,' + v.accent + ' 66%)' }), n))),
      field(this.lbl('Styl', '„Nocne szkło”: cienkie ramki i sześciokąty w rogu, jak ekran konfiguracji aplikacji. „Terminal”: ścięte rogi, pasy ostrzegawcze, siatka sześciokątów i pismo maszynowe. Styl działa z dowolnymi kolorami poniżej.'),
        select(t.style || '', [['', 'Zwykły'], ['glass', 'Nocne szkło'], ['hud', 'Terminal']], v => setFull('style', v))),
      h('h3', {}, 'Czcionki'),
      h('div', { class: 'row2' },
        field(this.lbl('Czcionka', 'Krój całego pulpitu. Kroje pochodzą z systemu panelu (Android), więc działają bez internetu; w przeglądarce edytora mogą wyglądać nieco inaczej.'),
          select(t.font || '', [['', 'Zwykła']].concat(Object.entries(this.DP.FONTS).filter(([k]) => k !== 'sans').map(([k, v]) => [k, v[0]])), v => setFull('font', v))),
        field(this.lbl('Zegar, liczby i stany', 'Osobny krój dla zegara, temperatur, wartości i stanów pod nazwą. „Jak wyżej” w stylach Nocne szkło i Terminal oznacza pismo maszynowe.'),
          select(t.font2 || '', [['', 'Jak wyżej / ze stylu']].concat(Object.entries(this.DP.FONTS).map(([k, v]) => [k, v[0]])), v => setFull('font2', v)))),
      field(this.lbl('Wersaliki', 'Nazwy kafelków, nagłówki sekcji i stany WIELKIMI LITERAMI z odstępami.'), select(t.caps || '', [['', 'Jak w stylu motywu'], ['on', 'Tak'], ['off', 'Nie']], v => setFull('caps', v))),
      h('h3', {}, 'Kolory'), h('div', { class: 'row2' }, Object.entries(this.DP.THEME_FIELDS).map(([k, l]) => field(l, h('input', { type: 'color', value: cur[k], oninput: e => set(k, e.target.value) })))),
      h('h3', {}, 'Kształt i tekst'), range('Zaokrąglenie rogów', 'radius', 0, 40, t.radius == null ? 16 : t.radius, v => v), range('Wielkość tekstu', 'scale', 80, 150, (t.scale || 1) * 100, v => v / 100), range('Krycie kafelków', 'opacity', 20, 100, t.opacity || 100, v => v),
      field('Tapeta (adres obrazka)', text(t.image, v => set('image', v.trim()), { placeholder: '/local/tapeta.jpg' })),
      h('h3', {}, 'Kafelki i ikony'),
      field('Włączony kafelek', select(t.onStyle || '', [['', 'Wypełniony kolorem'], ['outline', 'Świecąca ramka']], v => setFull('onStyle', v))),
      h('div', { class: 'row2' },
        field(this.lbl('Układ treści', '„Automatycznie”: w wysokich kafelkach ikona nad tekstem, w niskich (jeden wiersz) obok tekstu. „Ikona nad tekstem” wymusza ją także w niskich kafelkach.'), select(t.layout || '', [['', 'Automatycznie']].concat(LAYOUTS), v => setFull('layout', v))),
        field('Wielkość ikon', select(t.iconSize || '', [['', 'Zwykła']].concat(ICON_SIZES.filter(s => s[0] !== 'M')), v => setFull('iconSize', v)))),
      this.posPicker('Położenie treści w kafelkach', t.align, t.valign, 'Domyślne (lewo, środek)',
        (a, v) => this.commit(() => { const th = this.doc.theme = Object.assign({}, this.doc.theme); if (a) th.align = a; else delete th.align; if (v) th.valign = v; else delete th.valign; })),
      check('Stan pod nazwą kafelka (np. „włączone”, „wyłączone”)', t.state !== 'hide', v => setFull('state', v ? '' : 'hide')),
      field('Animacja ikony włączonego kafelka', select(t.anim || '', [['', 'Bez animacji']].concat(ANIMS), v => setFull('anim', v))),
      field('Tło ikon', select(t.icons || '', [['', 'Bez tła'], ['circle', 'Kolorowe kółko']], v => setFull('icons', v))),
      t.icons === 'circle' ? this.color('Kolor kółka (puste = z akcentu)', t.icbg, v => set('icbg', v)) : null,
      h('p', { class: 'dim' }, 'Układ, wyrównanie, animację, kolor kółka i warunki pojedynczego kafelka ustawisz po kliknięciu kafelka.'),
      h('p', { class: 'dim' }, 'Pasek stron i przesunięcia palcem ustawisz w zakładce Gesty.')].filter(Boolean);
  }

  gestureTab() {
    const nav = this.doc.nav === false ? 'none' : ['dots', 'tabs', 'none'].includes(this.doc.nav) ? this.doc.nav : 'dots';
    return [h('h3', {}, 'Pasek stron'),
      field('Na dole ekranu', select(nav, [['dots', 'Kropki (tylko pozycja strony)'], ['tabs', 'Nazwy stron'], ['none', 'Nic (więcej miejsca na kafelki)']], v => this.commit(() => { this.doc.nav = v; }))),
      nav === 'none' ? h('p', { class: 'dim' }, 'Bez paska ustawienia panelu otwiera mały przycisk w prawym dolnym rogu albo gest.') : null,
      field(this.lbl('Przejście między stronami', 'Jak panel zmienia stronę po geście albo dotknięciu kropki. „Przesunięcie” działa w kierunku kropek na pasku.'),
        select((this.doc.theme || {}).pageAnim || '', [['', 'Przesunięcie'], ['fade', 'Przenikanie'], ['none', 'Bez animacji']], v => this.commit(() => { this.doc.theme = Object.assign({}, this.doc.theme); if (v) this.doc.theme.pageAnim = v; else delete this.doc.theme.pageAnim; }))),
      nav === 'dots' ? h('p', { class: 'dim' }, 'Przy jednej stronie kropek nie widać; zostaje tylko koło zębate ustawień.') : null,
      ...this.gestureFields()].filter(Boolean);
  }

  gestureFields() {
    const g = this.doc.gestures || {};
    const kinds = [['default', ''], ['none', 'Nic'], ['next', 'Następna strona'], ['prev', 'Poprzednia strona'], ['page', 'Wybrana strona'], ['home', 'Strona główna'], ['saver', 'Wygaszacz'], ['bell', 'Domofon'], ['settings', 'Ustawienia panelu (jasność)'], ['service', 'Akcja Home Assistant']];
    const defaults = { left: 'Następna strona', right: 'Poprzednia strona', up: 'Nic', down: 'Nic' };
    const out = [h('h3', {}, 'Strona główna'),
      field('Od niej panel startuje i do niej wraca po wygaszaczu', select(this.doc.home || '', [['', 'Pierwsza (' + this.doc.pages[0].name + ')']].concat(this.doc.pages.map(x => [x.name, x.name])), v => this.commit(() => { if (v) this.doc.home = v; else delete this.doc.home; }))),
      h('p', { class: 'dim', style: 'margin:-4px 0 8px' }, 'Gest na „Wybraną stronę” działa w obie strony: np. ze strony głównej w lewo na Oświetlenie, potem w prawo z powrotem na główną, a kolejne w prawo na Muzykę.'),
      h('p', { class: 'dim', style: 'margin:-4px 0 8px' }, 'Gdy wybierzesz stronę główną (i są co najmniej 3 strony), jej kropka jest na środku paska. Strona z gestu „w lewo” stoi po prawej, z gestu „w prawo” po lewej, a „Następna/Poprzednia strona” idą w tej kolejności.'),
      h('h3', {}, 'Przesunięcie palcem')];
    [['up', 'W górę ↑'], ['down', 'W dół ↓'], ['left', 'W lewo ←'], ['right', 'W prawo →']].forEach(([dir, label]) => {
      const cur = g[dir] || { kind: 'default' }, set = o => this.commit(() => { this.doc.gestures = Object.assign({}, this.doc.gestures, { [dir]: Object.assign({}, cur, o) }); });
      // Szczegóły (strona, akcja) wcięte pod swoim kierunkiem, żeby było widać, do czego należą.
      const sub = cur.kind === 'page' ? [field('Strona', select(cur.page || '', [['', '–']].concat(this.doc.pages.map(x => [x.name, x.name])), v => set({ page: v })))]
        : cur.kind === 'service' ? this.serviceFields(cur, set) : [];
      out.push(h('div', { class: 'gest' }, field(label, select(cur.kind, kinds.map(([k, n]) => [k, k === 'default' ? 'Domyślnie (' + defaults[dir].toLowerCase() + ')' : n]), v => set({ kind: v }))),
        sub.length ? h('div', { class: 'sub' }, sub) : null));
    });
    return out;
  }

  saverTab() {
    const s = this.doc.saver = Object.assign({ seconds: 60, style: 'zegar', entities: [], names: {} }, this.doc.saver), set = (k, v, full) => this.commit(() => { this.doc.saver[k] = v; }, full ? {} : { key: 'sv' + k, quiet: true });
    return [h('h3', {}, 'Wygaszacz'), field('Włącz po (sekundy, 0 = nigdy)', text(s.seconds, v => set('seconds', Number(v) || 0), { type: 'number', min: 0 })),
      field('Wygląd', select(s.style, [['zegar', 'Zegar'], ['czujniki', 'Duże czujniki'], ['czarny', 'Czarny ekran']], v => set('style', v))),
      group('Co pokazać pod zegarem (czujniki, pogoda…)', this.entityList(s.entities || [], ['sensor', 'binary_sensor', 'weather', 'input_number'], v => set('entities', v.slice(0, 8), true))),
      h('p', { class: 'dim', style: 'margin:-4px 0 8px' }, 'Pogoda (weather.*) pokazuje ikonę warunków, temperaturę i opis.'),
      h('h3', {}, 'Panel pogody'),
      field('Pogoda (pusta = bez panelu)', this.entityPicker(s.weather, ['weather'], v => set('weather', v, true))),
      s.weather ? field('Prognoza: ile dni (0 = tylko teraz)', select(String(s.days == null ? 5 : s.days), [0, 1, 2, 3, 4, 5, 6, 7].map(n => [String(n), String(n)]), v => set('days', +v, true))) : null,
      h('h3', {}, 'Pod zegarem'),
      field('Wielkość pozycji pod zegarem', select(s.size || 'M', [['S', 'Mała'], ['M', 'Zwykła'], ['L', 'Duża'], ['XL', 'Bardzo duża']], v => set('size', v, true))),
      ...(s.entities || []).map(id => h('div', { class: 'st' },
        h('b', {}, this.ename(id)),
        field('Podpis (pusty = nazwa z HA)', text((s.names || {})[id], v => this.commit(() => { const n = Object.assign({}, this.doc.saver.names); if (v) n[id] = v; else delete n[id]; this.doc.saver.names = n; }, { key: 'svn' + id, quiet: true }))),
        field('Ikona', h('div', { style: 'display:flex;gap:6px;align-items:center' },
          this.iconPicker((s.icons || {})[id] || '', v => this.commit(() => { this.doc.saver.icons = Object.assign({}, this.doc.saver.icons, { [id]: v }); })),
          (s.icons || {})[id] ? h('button', { class: 'icon', 'aria-label': 'Bez ikony', onclick: () => this.commit(() => { const i = Object.assign({}, this.doc.saver.icons); delete i[id]; this.doc.saver.icons = i; }) }, '×') : null)))),
      h('h3', {}, 'Ikony powiadomień'),
      h('p', { class: 'dim', style: 'margin-bottom:8px' }, 'Ikona pojawia się nad zegarem tylko wtedy, gdy coś wymaga uwagi: drzwi otwarte, alarm uzbrojony, czujnik zgłasza problem, licznik większy od zera.'),
      this.entityList(s.alerts || [], ['binary_sensor', 'cover', 'lock', 'alarm_control_panel', 'input_boolean', 'switch', 'sensor', 'group'], v => set('alerts', v.slice(0, 12), true)),
      (s.alerts || []).length ? field('Wygląd powiadomień', select(s.alertStyle || 'plain', [['plain', 'Ikona i napis'], ['frame', 'Ikona i napis w cienkiej ramce'], ['icon', 'Sama ikona']], v => set('alertStyle', v, true))) : null,
      ...(s.alerts || []).map(id => h('div', { class: 'st' },
        h('b', {}, this.ename(id)),
        field('Napis, gdy aktywne (pusty = nazwa z HA), np. „Otwarte okno”', text((s.alertText || {})[id], v => this.commit(() => { const n = Object.assign({}, this.doc.saver.alertText); if (v) n[id] = v; else delete n[id]; this.doc.saver.alertText = n; }, { key: 'sva' + id, quiet: true }))),
        field('Ikona', h('div', { style: 'display:flex;gap:6px;align-items:center' },
          this.iconPicker((s.alertIcons || {})[id] || '', v => this.commit(() => { this.doc.saver.alertIcons = Object.assign({}, this.doc.saver.alertIcons, { [id]: v }); })),
          (s.alertIcons || {})[id] ? h('button', { class: 'icon', 'aria-label': 'Ikona domyślna', onclick: () => this.commit(() => { const i = Object.assign({}, this.doc.saver.alertIcons); delete i[id]; this.doc.saver.alertIcons = i; }) }, '×') : null)))),
      h('p', { class: 'dim' }, 'Jasność w dzień i w nocy, próg ciemności i budzenie zbliżeniem ustawiasz dla każdego panelu w zakładce „Panele i jasność”. Na samym panelu jasność zmienisz suwakiem w ustawieniach (koło zębate).')];
  }

  bellTab() {
    const b = this.bell, set = (k, v, full) => { b[k] = v; this.bellDirty = true; this.header(); this.refresh(); if (full) this.renderSides(); };
    b.actions = b.actions || [];
    return [h('h3', {}, 'Domofon (wspólny dla wszystkich paneli)'), field('Nazwa', text(b.name, v => set('name', v))),
      field('Dzwonek: otwiera okno', this.entityPicker(b.entity, ['binary_sensor', 'event', 'input_boolean'], v => set('entity', v, true))),
      h('h3', {}, 'Obraz'),
      // Podgląd na żywo: strumień go2rtc (obraz i dźwięk) albo kamera HA; obie listy obok siebie.
      field(this.lbl('Podgląd na żywo (strumień go2rtc)', 'Strumienie z go2rtc znalezionego w Home Assistant. Obraz idzie prosto ze strumienia, z dźwiękiem; do rozmowy źródło musi obsługiwać dźwięk zwrotny. „Bez strumienia” = obraz z kamery HA poniżej.'), this.streamPicker(b, set)),
      field(this.lbl(b.stream ? 'Kamera HA (zdjęcia, gdy strumień nie działa)' : 'Kamera HA', 'Encja camera.* z Home Assistant. Bez strumienia go2rtc to ona daje obraz; ze strumieniem służy za zapas (zdjęcia co 1,5 s).'), this.entityPicker(b.camera, ['camera'], v => set('camera', v, true))),
      h('div', { class: 'row2' },
        field('Zamknij okno po (s)', text(b.seconds, v => set('seconds', Number(v) || 60), { type: 'number', min: 10 })),
        field('Po otwarciu zostaw (s)', text(b.after == null ? 10 : b.after, v => set('after', v === '' ? 10 : Number(v)), { type: 'number', min: 0, max: 120 }))),
      h('p', { class: 'dim', style: 'margin:-4px 0 8px' }, 'Po otwarciu furtki lub bramy okno pokazuje „Otwarto” i zostaje jeszcze tyle sekund, żeby było widać, kto wchodzi.'),
      check('Gong na panelu', b.chime !== false, v => set('chime', v)),
      check('Przycisk „Rozmawiaj” (mikrofon panelu)', b.talk, v => set('talk', v, true)),
      b.talk && !b.stream ? h('p', { class: 'dim' }, 'Rozmowa wymaga go2rtc ze źródłem z dźwiękiem zwrotnym (sekcja na dole). Bez niego przycisk się pokaże, ale głos nie dotrze do bramki.') : null,
      h('h3', {}, 'Przyciski otwierania'),
      ...b.actions.map((a, i) => h('div', { class: 'st' },
        h('div', { style: 'display:flex;gap:6px' }, text(a.name, v => { a.name = v; set('actions', b.actions); }, { placeholder: 'Nazwa, np. Otwórz furtkę' }), h('button', { class: 'icon danger', 'aria-label': 'Usuń przycisk', onclick: () => { b.actions.splice(i, 1); set('actions', b.actions, true); } }, '×')),
        this.entityPicker(a.entity, ['switch', 'button', 'input_button', 'cover', 'lock', 'script'], v => { a.entity = v; set('actions', b.actions, true); }),
        h('div', { class: 'row2' }, this.iconPicker(a.icon || 'gate', v => { a.icon = v; set('actions', b.actions, true); }), select(a.mode || 'hold', [['hold', 'Przytrzymaj, aby otworzyć'], ['tap', 'Jedno dotknięcie']], v => { a.mode = v; set('actions', b.actions, true); })),
        (a.mode || 'hold') === 'hold' ? field(this.lbl('Czas przytrzymania (s)', 'Jak długo trzymać palec, zanim furtka lub brama się otworzy (0,3–10 s, domyślnie 0,9).'),
          text(a.holdTime == null ? '' : a.holdTime, v => { if (v === '') delete a.holdTime; else a.holdTime = Number(String(v).replace(',', '.')); set('actions', b.actions); }, { type: 'number', step: '0.1', min: 0.3, max: 10, placeholder: '0,9' })) : null)),
      b.actions.length < 4 ? h('div', { class: 'btns', style: 'justify-content:flex-start' },
        h('button', { onclick: () => { b.actions.push({ name: 'Otwórz furtkę', entity: '', icon: 'gate', mode: 'hold' }); set('actions', b.actions, true); } }, '+ Furtka'),
        h('button', { onclick: () => { b.actions.push({ name: 'Otwórz bramę', entity: '', icon: 'garage', mode: 'hold' }); set('actions', b.actions, true); } }, '+ Brama'),
        h('button', { onclick: () => { b.actions.push({ name: 'Przycisk', entity: '', icon: 'touch', mode: 'tap' }); set('actions', b.actions, true); } }, '+ Inny')) : null,
      b.actions.some(a => !a.entity) ? h('p', { class: 'dim' }, 'Przycisk bez wybranej encji nie zostanie zapisany.') : null,
      ...this.go2rtcFields(b, set)];
  }

  /** go2rtc: wynik wykrywania (adres i strumienie) wspólny dla listy strumieni i sekcji z adresem. */
  go2rtcState() {
    const g = this.g2 = this.g2 || { busy: false, done: false, url: '', streams: [] };
    g.detect = g.detect || (() => {
      g.busy = true; this.renderSides();
      this.hass.callWS({ type: 'panelpilot/admin/go2rtc_detect' }).then(r => Object.assign(g, r), () => Object.assign(g, { url: '', streams: [] }))
        .finally(() => { g.busy = false; g.done = true; this.renderSides(); });
    });
    if (!g.done && !g.busy) setTimeout(g.detect);
    return g;
  }

  /** Lista strumieni go2rtc do podglądu w domofonie; bez wykrytych strumieni pole tekstowe. */
  streamPicker(b, set) {
    const g = this.go2rtcState();
    if (!g.streams.length) return text(b.stream, v => set('stream', v.trim()), { placeholder: g.busy ? 'Szukam go2rtc…' : 'nazwa strumienia, np. brama' });
    return select(b.stream || '', [['', 'Bez strumienia (obraz z kamery HA)']].concat(g.streams.map(s => [s, s]))
      .concat(b.stream && !g.streams.includes(b.stream) ? [[b.stream, b.stream + ' (nie ma na liście)']] : []), v => set('stream', v, true));
  }

  /** Sekcja z adresem go2rtc: status wykrywania i ręczny adres. */
  go2rtcFields(b, set) {
    const g = this.go2rtcState();
    const status = g.busy ? 'Szukam go2rtc w Home Assistant…' : g.url ? 'Znaleziono go2rtc: ' + g.url + ' (' + g.streams.length + ' strumieni).' : g.done ? 'Nie znaleziono go2rtc w Home Assistant. Wpisz adres ręcznie, a nazwę strumienia w polu „Podgląd na żywo”.' : '';
    return [h('h3', {}, 'go2rtc'),
      h('div', { class: 'btns', style: 'justify-content:flex-start;align-items:center' }, h('button', { disabled: g.busy, onclick: g.detect }, 'Wykryj ponownie'), h('span', { class: 'dim' }, status)),
      field(this.lbl('Adres go2rtc (pusty = wykryty automatycznie)', 'Wpisz tylko wtedy, gdy go2rtc działa na innym komputerze albo nie zostało znalezione. Panel nie łączy się z tym adresem sam: obraz przekazuje integracja.'), text(b.go2rtc, v => set('go2rtc', v.trim()), { placeholder: g.url || 'http://192.168.1.10:1984' }))];
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
    const panels = Object.entries(this.data.panels).map(([id, saved]) => {
      // Zmiany czekają na przycisk Zapisz u góry, jak w reszcie edytora.
      const edit = this.pEdits[id] || {}, p = Object.assign({}, saved, edit), s = Object.assign({}, saved.settings, edit.settings);
      const save = d => {
        const e = this.pEdits[id] = this.pEdits[id] || {};
        if (d.settings) e.settings = Object.assign({}, e.settings, d.settings); else Object.assign(e, d);
        this.header();
      };
      const setS = (k, v) => save({ settings: { [k]: v } });
      const num = (l, k) => field(l, h('input', { type: 'number', value: s[k], oninput: e => { if (e.target.value !== '') setS(k, Number(e.target.value)); } }));
      const cmd = (c, x) => call(Object.assign({ type: 'panelpilot/admin/panel_command', device_id: id, command: c }, x), 'Wysłano');
      // Karta panelu domyślnie zwinięta: w nagłówku najważniejsze (pulpit, format, obrót, jasność), reszta po rozwinięciu.
      const open = this.pOpen = this.pOpen || new Set(), dash = this.data.dashboards[p.dashboard];
      const fmtName = s.format && s.format !== 'auto' && this.DP && this.DP.FORMATS[s.format] ? this.DP.FORMATS[s.format].name : 'format z ekranu';
      const summary = ['Pulpit: ' + (dash ? dash.name : '–'), fmtName, 'obrót ' + (s.rotation || 0) + '°', 'jasność ' + s.dayBrightness + '% / noc ' + s.nightBrightness + '%'].join(' · ');
      return h('details', { class: 'card pcard', open: open.has(id) || !!this.pEdits[id], ontoggle: e => { if (e.target.open) open.add(id); else open.delete(id); } },
        h('summary', {}, h('div', { class: 'top' }, h('i', { class: 'dot' + (p.connected ? ' on' : '') }), h('h2', {}, p.name), h('span', { class: 'dim' }, [p.model, p.size, p.app, p.connected ? 'połączony' : 'rozłączony'].filter(Boolean).join(' · '))),
          h('div', { class: 'dim psum' }, summary)),
        this.pEdits[id] ? h('p', { class: 'dim', style: 'color:var(--warning-color,#c77700)' }, 'Niezapisane zmiany. Zapiszesz je przyciskiem „Zapisz” u góry.') : null,
        h('div', { class: 'cols' }, field('Nazwa', h('input', { value: p.name, oninput: e => { if (e.target.value.trim()) save({ name: e.target.value.trim() }); } })), field('Pulpit', select(p.dashboard, Object.entries(this.data.dashboards).map(([i, d]) => [i, d.name]), v => save({ dashboard: v }))),
          field('Ekran', select(p.shape, [['auto', 'Wykryj'], ['square', 'Kwadrat (86)'], ['rect', 'Prostokąt (120)']], v => save({ shape: v }))),
          field('Format ekranu', select(s.format || 'auto', [['auto', 'Wykryj z ekranu']].concat(Object.entries(this.DP ? this.DP.FORMATS : {}).map(([fid, x]) => [fid, x.custom ? x.name + ' (' + x.cols + '×' + x.rows + ')' : x.name])), v => setS('format', v))), field('Obrót', select(String(s.rotation), [['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']], v => setS('rotation', Number(v)))),
          num('Jasność w dzień (%)', 'dayBrightness'), num('Jasność w nocy (%)', 'nightBrightness'),
          field('Kiedy jest noc', select(s.nightMode || 'both', [['both', 'W godzinach nocnych albo gdy ciemno'], ['hours', 'Tylko w godzinach nocnych'], ['lux', 'Tylko gdy ciemno (czujnik światła)']], v => setS('nightMode', v))),
          num('Noc od godziny', 'nightFrom'), num('Noc do godziny', 'nightTo'), num('Ciemno poniżej (lx)', 'darkLux')),
        h('p', { class: 'dim' }, 'Gdy zaczyna się noc albo dzień, ręcznie ustawiona jasność wraca na automatyczną.'),
        check('Budź, gdy ktoś podejdzie', s.wakeOnProximity, v => setS('wakeOnProximity', v)), check('Nie włączaj wygaszacza, gdy ktoś stoi przy panelu (najwyżej 3 minuty)', s.proximityHold, v => setS('proximityHold', v)),
        h('p', { class: 'dim' }, 'Zasięg czujnika zbliżenia ustala producent panelu; zwykle to kilkanaście–kilkadziesiąt centymetrów. Stan widać w encji „Zbliżenie” tego panelu w HA.'),
        h('div', { class: 'btns' }, h('button', { class: 'danger', onclick: () => this.dialog('Usunąć panel „' + p.name + '”?', h('p', {}, 'Panel straci dostęp i trzeba będzie sparować go od nowa.'), ['Anuluj'], ['Usuń', () => call({ type: 'panelpilot/admin/panel_delete', device_id: id })]) }, 'Usuń'), h('button', { disabled: !p.connected, onclick: () => cmd('message', { title: 'Test', message: 'Wiadomość z Home Assistant' }) }, 'Wyślij test'), h('button', { disabled: !p.connected, onclick: () => cmd('doorbell') }, 'Pokaż domofon'), h('button', { disabled: !p.connected, onclick: () => cmd('reload') }, 'Odśwież')));
    });
    return [h('h2', {}, 'Panele'), ...pairing, ...panels, h('div', { class: 'card' }, h('h2', {}, 'Dodaj panel'), h('ol', { style: 'margin:0;padding-left:20px;display:grid;gap:6px' }, h('li', {}, 'Zainstaluj aplikację Panel Pilot na NSPanelu i uruchom ją.'), h('li', {}, 'Wybierz na ekranie Home Assistant znaleziony w sieci oraz kształt ekranu.'), h('li', {}, 'Panel pokaże 6-cyfrowy kod. Zatwierdź go tutaj; hasło nie jest potrzebne.')), h('p', { class: 'dim' }, 'Panel dostaje własne konto bez uprawnień administratora, działające tylko w sieci lokalnej. Bez NSPanela możesz otworzyć panel w przeglądarce: ', h('a', { href: new URL('index.html', BASE).href, target: '_blank', rel: 'noopener' }, 'podgląd panelu'), '.'))];
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
