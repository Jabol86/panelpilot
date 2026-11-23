/* Silnik panelu: format, obrót, strony, wygaszacz, komunikacja z integracją i aplikacją Android.
   Most do aplikacji (window.PanelNative): info(), setBrightness(0-255), setRotation(stopnie), openSetup(), reload()
   Aplikacja -> panel: Panel.sensor('lux', 123), Panel.sensor('proximity', 0|1) */
(function () {
  const $ = id => document.getElementById(id);
  const esc = DP.esc, icon = DP.icon;
  const query = new URLSearchParams(location.search);
  const native = window.PanelNative || null;
  const info = (() => { try { return native ? JSON.parse(native.info()) : {}; } catch (e) { return {}; } })();

  const CONDITIONS = {
    sunny: ['sun', 'Słonecznie'], 'clear-night': ['moon', 'Bezchmurnie'], partlycloudy: ['cloud', 'Częściowe zachmurzenie'], cloudy: ['cloud', 'Pochmurno'],
    rainy: ['rain', 'Deszcz'], pouring: ['rain', 'Ulewa'], snowy: ['snow', 'Śnieg'], 'snowy-rainy': ['snow', 'Deszcz ze śniegiem'], fog: ['cloud', 'Mgła'],
    lightning: ['bolt', 'Burza'], 'lightning-rainy': ['bolt', 'Burza z deszczem'], windy: ['fan', 'Wietrznie'], 'windy-variant': ['fan', 'Wietrznie'], hail: ['snow', 'Grad'], exceptional: ['bolt', 'Zjawisko ekstremalne'],
  };
  const SAVER = { seconds: 60, style: 'zegar', entities: [] };
  const SETTINGS = { format: 'auto', rotation: 0, dayBrightness: 80, nightBrightness: 8, darkLux: 8, nightFrom: 22, nightTo: 6, nightMode: 'both', wakeOnProximity: true, proximityHold: true, proximityInvert: false };

  const widgets = {};
  const sensors = { lux: null, proximity: null };
  let ha, dash = { pages: [], saver: {}, theme: {} }, bell = {}, cfg = {}, shape = info.shape || 'auto';
  let fmt = 'portrait', pages = [], page = 0, sleeping = false, screenOff = false, lastTouch = Date.now(), dark = false, manual = null, rawNear = null;
  let homed = null, cleanup = [], jsRun = '', nearSince = 0, loadedVersion = '', lastPing = Date.now();
  const HOLD_MAX = 3 * 60 * 1000;

  const Panel = window.Panel = {
    esc, icon, CONDITIONS, sensors, widgets, info, hooks: [], busy: false,
    get ha() { return ha; },
    get sleeping() { return sleeping; },
    get doorbellConfig() { return bell; },
    get format() { return fmt; },
    widget(type, def) { widgets[type] = def; },

    state(id) { return id && ha.states[id] || null; },
    ok(id) { const s = Panel.state(id); return !!s && s.state !== 'unavailable' && s.state !== 'unknown'; },
    num(id) { return Panel.ok(id) ? parseFloat(Panel.state(id).state) : NaN; },
    isOn(id) { return Panel.ok(id) && ['on', 'open', 'opening', 'playing', 'heat', 'cool', 'auto', 'heat_cool', 'home', 'unlocked'].includes(Panel.state(id).state); },
    name(id) { const s = Panel.state(id); return s && s.attributes.friendly_name || id || ''; },
    value(id, digits) {
      if (!Panel.ok(id)) return '–';
      const s = Panel.state(id), n = Number(s.state), unit = s.attributes.unit_of_measurement;
      const text = s.state !== '' && !isNaN(n) ? n.toLocaleString('pl-PL', { maximumFractionDigits: digits === '' || digits == null ? 1 : +digits }) : s.state;
      return esc(text) + (unit ? '<small> ' + esc(unit) + '</small>' : '');
    },
    /** Dowolna akcja HA, np. Panel.service('script.turn_on', { entity_id: 'script.x' }). */
    async service(name, data) {
      if (ha.preview) return false;
      if (!ha.online) { Panel.toast('Brak połączenia z Home Assistant', true); return false; }
      const [domain, service] = String(name).split('.');
      try { await ha.call(domain, service, data); return true; }
      catch (e) { Panel.toast(e.message, true); return false; }
    },
    call(entity, service) { return Panel.service(entity.split('.')[0] + '.' + service, { entity_id: entity }); },
    toast(text, bad, ms) {
      const t = $('toast');
      t.textContent = text; t.className = bad ? 'bad' : ''; t.hidden = false;
      clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, ms || (bad ? 5000 : 2200));
    },
    confirm(text, fn) {
      const el = sheet(text, '', btn('no', 'Nie') + btn('yes', 'Tak', 'primary'));
      on(el, 'no', closeSheet); on(el, 'yes', () => { closeSheet(); fn(); });
    },
    sensor(name, value) {
      if (name === 'proximity') { rawNear = value ? 1 : 0; if (cfg.proximityInvert) value = rawNear ? 0 : 1; }
      const before = sensors[name];
      sensors[name] = value;
      if (name === 'lux') updateDark();
      if (name === 'proximity') nearSince = value ? (before ? nearSince || Date.now() : Date.now()) : 0;
      if (name === 'proximity' && cfg.wakeOnProximity) {
        if (value && !before) wake();
        lastTouch = Date.now();
      }
      document.querySelectorAll('.tile[data-type=device]').forEach(updateTile);
      report();
    },
    wake: () => wake(),
    openPage(i) { page = i; back = null; render(); report(); },
    start, setPreview,
    geometry: () => ({ fmt, pages }),
  };

  /* ---------- start ---------- */
  function start() {
    Object.assign(cfg, SETTINGS);
    bindInput();
    addEventListener('resize', () => { apply(); render(); });
    setInterval(tick, 1000);
    if (query.has('preview')) {
      ha = new PreviewHAClient();
      document.body.classList.add('preview');
      return;
    }
    ha = new HAClient();
    ha.deviceId = deviceId();
    ha.onStatus = v => document.body.classList.toggle('offline', !v);
    ha.onState = onState;
    ha.onReady = connectIntegration;
    ha.onAuth = pairing;
    apply(); render();
    ha.connect();
  }

  function deviceId() {
    if (info.id) return info.id;
    let id = null;
    try { id = localStorage.getItem('panelpilot_device'); } catch (e) { /* brak pamięci */ }
    if (!id) {
      id = 'web_' + Math.random().toString(36).slice(2, 12);
      try { localStorage.setItem('panelpilot_device', id); } catch (e) { /* brak pamięci */ }
    }
    return id;
  }

  function pairing() {
    const show = html => { $('grid').innerHTML = '<div class="empty">' + html + '<button class="login" type="button">Zaloguj hasłem</button></div>'; $('grid').querySelector('.login').onclick = () => ha.login(); };
    show('<b>Łączenie…</b>');
    ha.pair({ device_id: ha.deviceId, name: info.name || 'Przeglądarka', model: info.model || 'Przeglądarka' }, code => {
      show('<span>W Home Assistant kliknij powiadomienie <b>PanelPilot</b> i zatwierdź kod:</span><div class="code">' + esc(code.slice(0, 3) + ' ' + code.slice(3)) + '</div>');
    }).then(() => location.reload(), e => {
      show('<b>Parowanie nieudane</b><span>' + esc(e.message) + '</span>');
      setTimeout(pairing, 20000);
    });
  }

  async function connectIntegration() {
    try {
      await ha.send({
        type: 'panelpilot/register', device_id: ha.deviceId, name: info.name || 'Przeglądarka', model: info.model || 'Przeglądarka',
        app: info.version || 'web', shape, rotation: info.rotation || 0, size: innerWidth + '×' + innerHeight,
      });
      await ha.subscribe({ type: 'panelpilot/subscribe', device_id: ha.deviceId }, onIntegration);
      report.last = ''; report();
    } catch (e) {
      const missing = e.code === 'unknown_command';
      $('grid').innerHTML = '<div class="empty"><b>' + (missing ? 'Brak integracji PanelPilot w Home Assistant' : 'Nie udało się zarejestrować panelu') + '</b><span>'
        + (missing ? 'Zainstaluj integrację i dodaj ją w Ustawienia → Urządzenia oraz usługi.' : esc(e.message)) + '</span></div>';
      setTimeout(() => { if (ha.online) connectIntegration(); }, 15000);
    }
  }

  function onIntegration(ev) {
    if (ev.type === 'config') {
      // Nowa wersja integracji (aktualizacja w HACS): wczytaj od nowa kod panelu, bez pamięci podręcznej.
      if (ev.version && loadedVersion && ev.version !== loadedVersion) return native && native.reload ? native.reload() : location.reload();
      loadedVersion = loadedVersion || ev.version;
      DP.setFormats(ev.formats);
      cfg = Object.assign({}, SETTINGS, ev.panel.settings);
      shape = ev.panel.shape || shape;
      bell = ev.doorbell || {};
      setDashboard(ev.dashboard);
      // Nowe ustawienia (np. odwrócenie czujnika, tryb nocny) działają od razu.
      if (rawNear != null) Panel.sensor('proximity', rawNear);
      updateDark(true);
    } else if (ev.type === 'command') command(ev);
  }

  function command(c) {
    if (c.command === 'screen') {
      if (c.brightness != null) manual = Math.max(1, Math.min(255, c.brightness));
      if (c.on) wake(); else { screenOff = true; sleep(); }
      updateDark(true); report();
    } else if (c.command === 'page') {
      const i = pages.findIndex(p => p.name === c.page);
      if (i >= 0) { wake(); Panel.openPage(i); }
    } else if (c.command === 'reload') native && native.reload ? native.reload() : location.reload();
    else if (c.command === 'doorbell') Panel.doorbell.open(true);
    else if (c.command === 'message') { wake(); message(c); }
  }

  function setDashboard(d) {
    dash = d || { pages: [] };
    dash.saver = Object.assign({}, SAVER, dash.saver);
    DP.applyTheme($('root'), dash.theme);
    $('custom-css').textContent = dash.mode === 'code' ? '' : dash.css || '';
    if ((dash.js || '') !== jsRun) {
      jsRun = dash.js || '';
      try { new Function('Panel', jsRun)(Panel); } catch (e) { console.error(e); Panel.toast('Błąd w Twoim JS: ' + e.message, true); }
    }
    apply(); render();
  }

  /** Wywoływane przez edytor w HA. */
  function setPreview(o) {
    if (o.bridge) ha.bridge = o.bridge;
    if (o.states) ha.states = o.states;
    if (o.formats) DP.setFormats(o.formats);
    if (o.format) fmt = o.format;
    if (o.page != null) page = o.page;
    if (o.changed) return onState(o.changed);
    bell = o.doorbell || bell;
    if (o.settings) cfg = Object.assign({}, SETTINGS, o.settings);
    sleeping = o.mode === 'saver';
    dark = !!o.night;
    document.body.classList.toggle('dark', dark);
    $('saver').hidden = !sleeping;
    setDashboard(o.dashboard);
    if (sleeping) renderSaver(true);
    if (o.mode === 'bell') Panel.doorbell.open(); else Panel.doorbell.close();
  }

  /* ---------- wygląd ---------- */
  function apply() {
    const rot = ha.preview ? 0 : +cfg.rotation || 0;
    const system = native && native.setRotation && !info.cssRotation;
    if (system) native.setRotation(rot);
    const turn = system ? 0 : rot, swap = turn === 90 || turn === 270;
    const w = swap ? innerHeight : innerWidth, h = swap ? innerWidth : innerHeight, r = $('root');
    // Bez obrotu rozmiar bierze się z CSS (100%), więc nie rozjedzie się przy spóźnionym „resize”.
    r.style.width = turn ? w + 'px' : '100%'; r.style.height = turn ? h + 'px' : '100%';
    r.style.transform = 'translate(-50%,-50%) rotate(' + turn + 'deg)';
    r._turn = turn;
    // Format wybrany w HA dla tego panelu, potem format pulpitu, a na końcu wykryty z ekranu.
    if (!ha.preview) fmt = DP.FORMATS[cfg.format] ? cfg.format : DP.FORMATS[dash.format] ? dash.format : DP.formatFor(shape, w, h);
    if (!DP.FORMATS[fmt]) fmt = DP.formatFor(shape, w, h);
    r.className = 'fmt-' + fmt + (w > h * 1.18 ? ' land' : '');
    r.classList.add('nav-' + navStyle());
    updateDark(true);
  }

  /** Pasek stron: kropki (domyślnie), nazwy stron albo brak; dawne true/false też działają. */
  const navStyle = () => dash.nav === false ? 'none' : ['dots', 'tabs', 'none'].includes(dash.nav) ? dash.nav : 'dots';

  const ENTITY_FIELDS = ['entity', 'entity2', 'state_entity', 'pv', 'home', 'grid', 'battery', 'output'];
  const entitiesOf = t => {
    const def = widgets[t.type], rules = Array.isArray(t.rules) ? t.rules.map(r => r && r.entity) : [];
    return ENTITY_FIELDS.map(f => t[f]).concat(Array.isArray(t.entities) ? t.entities : [], def && def.entities ? def.entities(t) : [], rules).filter(DP.isEntity);
  };

  /* ---------- warunki i animacje kafelka ---------- */
  const ANIMS = ['pulse', 'spin', 'blink', 'bounce', 'glow', 'shake'];
  /** Czy warunek jest spełniony; encja pusta = encja kafelka. */
  function ruleHit(r, t) {
    const id = DP.isEntity(r.entity) ? r.entity : t.entity, s = Panel.state(id);
    if (!s) return false;
    const v = String(r.value == null ? '' : r.value).trim(), n = parseFloat(s.state);
    switch (r.op) {
      case 'on': return Panel.isOn(id) || ['detected', 'problem', 'triggered'].includes(s.state);
      case 'off': return Panel.ok(id) && !Panel.isOn(id);
      case 'eq': return s.state === v;
      case 'ne': return s.state !== v;
      case 'gt': return !isNaN(n) && n > parseFloat(v);
      case 'lt': return !isNaN(n) && n < parseFloat(v);
      default: return false;
    }
  }
  Panel.ruleOf = t => (Array.isArray(t.rules) ? t.rules : []).find(r => r && ruleHit(r, t)) || null;

  /** Kolory z kafelka, a na wierzchu z pierwszego spełnionego warunku. */
  function styleTile(el, t, rule) {
    ['--tile', '--on', '--accent', '--icbg'].forEach(v => el.style.removeProperty(v));
    el.classList.remove('icbg');
    const bg = rule && DP.isColor(rule.bg) ? rule.bg : t.bg, color = rule && DP.isColor(rule.color) ? rule.color : t.color;
    if (DP.isColor(bg)) el.style.setProperty('--tile', bg);
    if (DP.isColor(color)) ['--accent', '--on'].forEach(v => el.style.setProperty(v, color));
    if (DP.isColor(t.iconBg)) { el.classList.add('icbg'); el.style.setProperty('--icbg', t.iconBg); }
  }
  Panel.entitiesOf = entitiesOf;
  Panel.goto = name => { const i = pages.findIndex(p => p.name === name); if (i >= 0) Panel.openPage(i); };
  const coded = () => dash.mode === 'code' || dash.mode === 'module';

  function watched() {
    // Własny kod może czytać dowolne encje; listę można ograniczyć w edytorze.
    if (coded() && !(dash.watch || []).length) return null;
    const ids = new Set((dash.saver.entities || []).concat(dash.saver.alerts || [], [dash.saver.weather], coded() ? dash.watch : []));
    [bell.entity, bell.camera].concat((bell.actions || []).map(a => a.entity)).forEach(id => ids.add(id));
    dash.pages.forEach(p => p.tiles.forEach(t => entitiesOf(t).forEach(id => ids.add(id))));
    return [...ids].filter(DP.isEntity);
  }

  let codeKey = '';
  function renderCode() {
    $('root').classList.add('full');
    pageTitle(null);
    pages =[{ name: dash.name || 'Pulpit', placed: [] }]; page = 0;
    if (ha.online && !ha.preview) ha.watch(watched()).catch(e => console.warn(e));
    // Kod uruchamiany ponownie tylko po zmianie, żeby nie gubić jego stanu.
    const key = JSON.stringify([dash.mode, dash.html, dash.css, dash.code, dash.module, dash.element, fmt]);
    if (key === codeKey && $('grid').querySelector('.code-host')) return;
    codeKey = key;
    cleanup.forEach(f => f()); cleanup = [];
    Panel.code.mount($('grid'), dash);
    gear(true);
  }

  /** Mały przycisk ustawień, gdy nie ma paska stron (własny kod albo ukryty pasek). */
  function gear(show) {
    let g = document.querySelector('.gearbtn');
    if (!show) { if (g) g.remove(); return; }
    if (g) return;
    g = document.createElement('button');
    g.className = 'gearbtn'; g.setAttribute('aria-label', 'Ustawienia panelu'); g.innerHTML = icon('gear');
    g.onclick = () => ha.preview || openSettings();
    $('root').append(g);
  }

  function render() {
    if (coded() && (ha.preview || ha.online || codeKey)) return renderCode();
    if (codeKey) { codeKey = ''; Panel.code.unmount(); }
    $('root').classList.remove('full');
    $('root').classList.toggle('nonav', navStyle() === 'none');
    gear(navStyle() === 'none');
    pages = DP.pagesFor(dash.pages, fmt, widgets);
    if (!pages.length) { pageTitle(null); renderNav(); return; }
    // Po uruchomieniu (i po zmianie strony głównej w edytorze) panel przechodzi na stronę główną.
    if (!ha.preview && homed !== (dash.home || '')) { homed = dash.home || ''; page = homeIndex(); back = null; }
    page = Math.max(0, Math.min(page, pages.length - 1));
    cleanup.forEach(f => f()); cleanup = [];
    const f = DP.FORMATS[fmt], grid = $('grid');
    pageTitle(dash.pages[pages[page].page], f);
    grid.style.gridTemplateColumns = 'repeat(' + f.cols + ',minmax(0,1fr))';
    grid.style.gridTemplateRows = DP.rowTracks(pages[page].placed, f.rows, widgets).map(v => 'minmax(0,' + v + 'fr)').join(' ');
    grid.replaceChildren(...pages[page].placed.map(p => {
      const t = p.tile, el = document.createElement('div'), def = widgets[t.type];
      el.className = 'tile ' + (p.h === 1 ? p.w === 1 ? 'mini' : 'row' : 'stack') + (def && def.plain ? ' plain' : '') + (t.text ? ' text-' + String(t.text).replace(/\W/g, '') : '');
      el.dataset.type = t.type; el.dataset.id = t.id;
      el.style.gridArea = (p.y + 1) + '/' + (p.x + 1) + '/span ' + p.h + '/span ' + p.w;
      // Układ treści, wyrównanie i wielkość ikony: z kafelka, a gdy brak, z motywu pulpitu.
      const th = dash.theme || {};
      if (def && !def.noIcon) {
        const lay = t.layout || th.layout, size = DP.ICON_SIZES[t.iconSize || th.iconSize];
        if (lay === 'row' || lay === 'center') el.classList.add('lay-' + lay);
        if (size) el.style.setProperty('--ic', size + 'px');
      }
      if (!(def && def.plain)) {
        const ah = t.align || th.align, av = t.valign || th.valign;
        if (['left', 'center', 'right'].includes(ah)) el.dataset.ah = ah;
        if (['top', 'center', 'bottom'].includes(av)) el.dataset.av = av;
      }
      if (t.type === 'section' && ['center', 'right'].includes(t.align)) el.dataset.align = t.align;
      // Stan pod nazwą („włączone”, „wyłączone”…): kafelek ma pierwszeństwo przed motywem.
      if (t.showState === false || (t.showState == null && th.state === 'hide')) el.classList.add('nost');
      el._tile = t;
      try { if (def && def.mount) { const stop = def.mount(el, t); if (stop) cleanup.push(stop); } } catch (e) { console.error(t.type, e); }
      updateTile(el);
      return el;
    }));
    renderNav();
    if (ha.online && !ha.preview) ha.watch(watched()).catch(e => console.warn(e));
  }

  /** Nagłówek strony nad kafelkami: wysokość połowy wiersza siatki (proporcje flex: 0.5 do liczby wierszy). */
  function pageTitle(p, f) {
    let hd = $('ptitle');
    if (!hd) { hd = document.createElement('div'); hd.id = 'ptitle'; $('grid').before(hd); }
    const title = p && p.title;
    hd.hidden = !title;
    hd.innerHTML = title ? '<span>' + esc(title) + '</span>' : '';
    hd.dataset.align = (p && p.titleAlign) || 'left';
    $('grid').style.flex = title && f ? f.rows + ' 1 0' : '';
  }

  function updateTile(el) {
    const t = el._tile, def = widgets[t.type];
    if (!def) { el.innerHTML = '<div class="lbl">Nieznany kafelek: ' + esc(t.type) + '</div>'; return; }
    const ids = entitiesOf(t);
    el.classList.toggle('missing', !!ids.length && ha.online && !ids.some(Panel.ok));
    try {
      // Spełniony warunek może podmienić ikonę, kolory, podświetlenie i animację.
      const rule = Panel.ruleOf(t), shown = rule && rule.icon ? Object.assign({}, t, { icon: rule.icon }) : t;
      styleTile(el, t, rule);
      if (def.update) def.update(el, shown); else el.innerHTML = def.html(shown);
      const on = rule && rule.lit != null ? !!rule.lit : !!(def.active && def.active(t));
      el.classList.toggle('on', on);
      el.classList.toggle('warn', !rule && !!(def.warn && def.warn(t)));
      const th = dash.theme || {}, anim = rule && rule.anim ? rule.anim : on ? t.anim || th.anim : '';
      ANIMS.forEach(a => el.classList.toggle('anim-' + a, anim === a));
    } catch (e) { console.error(t.type, e); el.innerHTML = '<div class="lbl">Błąd: ' + esc(e.message) + '</div>'; }
  }

  function onState(changed) {
    document.querySelectorAll('.tile').forEach(el => { if (entitiesOf(el._tile).some(id => changed.has(id))) updateTile(el); });
    if (coded()) Panel.code.update(changed);
    if (!ha.preview) Panel.hooks.forEach(f => f(changed));
    if (sleeping) renderSaver();
  }

  function renderNav() {
    // Kropki: sama pozycja strony, bez nazw. Przy jednej stronie nie ma czego pokazywać.
    const dots = navStyle() === 'dots';
    const list = dots && pages.length < 2 ? '' : pages.map((p, i) => '<button data-page="' + i + '"' + (i === page ? ' aria-current="page"' : '') + (dots ? ' class="dot" aria-label="' + esc(p.name) + '"><i></i>' : '>' + esc(p.name)) + '</button>').join('');
    $('nav').innerHTML = '<span class="pg">' + list + '</span><span class="off">Brak połączenia</span><button class="act" data-act="settings" aria-label="Ustawienia">' + icon('gear') + '</button>';
  }

  /* ---------- dotyk ---------- */
  function bindInput() {
    let down = null, swiped = false;
    const local = (dx, dy) => ({ 0: [dx, dy], 90: [dy, -dx], 180: [-dx, -dy], 270: [-dy, dx] }[$('root')._turn || 0]);
    addEventListener('pointerdown', e => {
      lastTouch = Date.now(); swiped = false;
      down = { x: e.clientX, y: e.clientY, grid: !!e.target.closest('#grid') && !e.target.closest('input,select') };
      const held = e.target.closest('.holdable:not(.tapnow),.tile[data-type=hold]');
      if (held) startHold(held);
    }, true);
    addEventListener('pointermove', e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 14) stopHold(); });
    addEventListener('pointerup', e => {
      stopHold();
      if (!down) return;
      const d = down; down = null;
      const [dx, dy] = local(e.clientX - d.x, e.clientY - d.y);
      if (!d.grid || sleeping) return;
      // Kierunek to strona, w którą jedzie palec.
      const dir = Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy) ? (dx < 0 ? 'left' : 'right')
        : Math.abs(dy) > 70 && Math.abs(dy) > 1.5 * Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : null;
      if (dir) swiped = gesture(dir);
    });
    addEventListener('pointercancel', () => { stopHold(); down = null; });
    addEventListener('contextmenu', e => { if (!e.target.closest('input')) e.preventDefault(); });
    $('grid').addEventListener('click', e => {
      const el = e.target.closest('.tile');
      if (swiped || !el || ha.preview) return;
      tap(el._tile, el, e);
    });
    $('nav').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      b.dataset.page ? Panel.openPage(+b.dataset.page) : ha.preview || openSettings();
    });
    // Pierwszy dotyk tylko budzi ekran i nie naciska niczego pod spodem.
    $('saver').addEventListener('click', e => { e.stopPropagation(); if (!ha.preview) wake(); });
  }

  /** Przesunięcie palcem; zwraca true, gdy coś się stało (wtedy dotknięcie kafelka się nie liczy). */
  /** Strona główna pulpitu (indeks na liście stron panelu); bez wyboru pierwsza. */
  const homeIndex = () => Math.max(0, pages.findIndex(p => !p.extra && p.name === dash.home));
  // Powrót tą samą drogą: po geście „w lewo” na wybraną stronę gest „w prawo” wraca tam, skąd przyszliśmy.
  let back = null;
  const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' };

  function gesture(dir) {
    const g = (dash.gestures || {})[dir] || {};
    let kind = g.kind || 'default';
    if (kind === 'default') kind = { left: 'next', right: 'prev' }[dir] || 'none';
    const go = n => { if (n < 0 || n >= pages.length) return false; Panel.openPage(n); return true; };
    const jump = n => {
      if (n < 0 || n === page) return false;
      const from = page;
      if (!go(n)) return false;
      back = { dir: OPPOSITE[dir], to: from, at: n };
      return true;
    };
    if (back && back.at === page && dir === back.dir) { const to = back.to; back = null; return go(to); }
    switch (kind) {
      case 'next': return go(page + 1);
      case 'prev': return go(page - 1);
      case 'page': return jump(pages.findIndex(p => p.name === g.page && !p.extra));
      case 'home': return jump(homeIndex());
      case 'saver': sleep(); return true;
      case 'bell': Panel.doorbell.open(); return true;
      case 'settings': openSettings(); return true;
      case 'service': if (g.service) Panel.service(g.service, g.data || {}).then(ok => ok && Panel.toast('Wysłano')); return !!g.service;
      default: return false;
    }
  }

  function tap(t, el, e) {
    const def = widgets[t.type] || {}, a = t.tap || {};
    if (def.controls && e.target.closest('button,input,select')) return;
    const run = () => {
      if (a.kind === 'none') return;
      if (a.kind === 'page') { const i = pages.findIndex(p => p.name === a.page); if (i >= 0) Panel.openPage(i); return; }
      if (a.kind === 'service') { Panel.service(a.service, a.data).then(ok => ok && Panel.toast((t.name || a.service) + ': wysłano')); return; }
      if (a.kind === 'toggle' && DP.isEntity(t.entity)) { Panel.service('homeassistant.toggle', { entity_id: t.entity }); return; }
      if (def.tap) def.tap(t, el);
    };
    t.confirm && (a.kind === 'service' || a.kind === 'toggle' || def.confirmable) ? Panel.confirm((t.name || Panel.name(t.entity)) + ': na pewno?', run) : run();
  }

  let hold = null;
  function startHold(el) {
    if (ha.preview || !ha.online || !Panel.ok(el._tile.entity)) return;
    stopHold();
    el.classList.add('holding');
    hold = { el, timer: setTimeout(() => { stopHold(); Panel.trigger(el._tile); }, 900) };
  }
  /** Otwiera/uruchamia encję bramy, furtki, zamka, przycisku albo skryptu. */
  Panel.trigger = async t => {
    const service = /^(lock)\./.test(t.entity) ? 'unlock' : /^(button|input_button)\./.test(t.entity) ? 'press' : /^cover\./.test(t.entity) ? 'toggle' : 'turn_on';
    if (await Panel.call(t.entity, service)) { Panel.toast((t.name || Panel.name(t.entity)) + ': wysłano'); if (t.done) t.done(); }
  };
  function stopHold() { if (hold) { clearTimeout(hold.timer); hold.el.classList.remove('holding'); hold = null; } }

  /* ---------- wygaszacz i jasność ---------- */
  function tick() {
    document.querySelectorAll('.tile[data-type=clock]').forEach(updateTile);
    if (ha.preview) return;
    // Co minutę: czy integracja nadal nas widzi? Po jej przeładowaniu stara subskrypcja jest martwa.
    if (ha.online && Date.now() - lastPing > 60000) {
      lastPing = Date.now();
      ha.send({ type: 'panelpilot/ping', device_id: ha.deviceId }).then(r => { if (r && r.subscribed === false) connectIntegration(); }, () => {});
    }
    const s = dash.saver || SAVER;
    // Dopóki ktoś stoi przy panelu, wygaszacz nie wchodzi.
    // Najwyżej 3 minuty: czujnik, który utknął na „blisko”, nie może blokować wygaszacza na zawsze.
    const held = sensors.proximity && nearSince && Date.now() - nearSince < HOLD_MAX;
    if (cfg.wakeOnProximity && cfg.proximityHold && held && !sleeping) lastTouch = Math.max(lastTouch, Date.now() - Math.max(0, s.seconds - 10) * 1000);
    if (!sleeping && !Panel.busy && $('sheet').hidden && s.seconds > 0 && Date.now() - lastTouch > s.seconds * 1000) sleep();
    if (sleeping) renderSaver();
    updateDark();
  }

  function updateDark(force) {
    if (ha.preview) return;
    const h = new Date().getHours(), lux = sensors.lux, a = +cfg.nightFrom, b = +cfg.nightTo;
    const hours = a > b ? h >= a || h < b : h >= a && h < b;
    // Histereza, żeby jasność nie migotała przy progu.
    const darkRoom = lux == null ? null : lux < cfg.darkLux ? true : lux > cfg.darkLux * 2.5 ? false : updateDark.room || false;
    updateDark.room = darkRoom;
    const mode = cfg.nightMode || 'both';
    // both: noc w godzinach nocnych albo gdy w pokoju ciemno; hours: tylko zegar; lux: tylko czujnik (bez czujnika zegar).
    const next = mode === 'hours' || darkRoom == null ? hours : mode === 'lux' ? darkRoom : hours || darkRoom;
    // Zmiana dzień/noc kasuje ręcznie ustawioną jasność, żeby noc zawsze przygaszała ekran.
    if (updateDark.key != null && next !== dark) manual = null;
    const auto = Math.round(Math.max(1, Math.min(100, next ? cfg.nightBrightness : cfg.dayBrightness)) * 2.55);
    const level = screenOff ? 0 : manual != null && !sleeping ? manual : auto;
    const key = level + '|' + next;
    if (!force && key === updateDark.key) return;
    updateDark.key = key; updateDark.level = level; dark = next;
    document.body.classList.toggle('dark', dark);
    if (native && native.setBrightness) native.setBrightness(level);
    report();
  }

  function sleep() { sleeping = true; $('saver').hidden = false; closeSheet(); page = homeIndex(); back = null; render(); renderSaver(true); updateDark(true); report(); }
  function wake() {
    lastTouch = Date.now();
    if (!sleeping && !screenOff) return;
    sleeping = false; screenOff = false;
    $('saver').hidden = true;
    render(); updateDark(true); report();
  }

  function renderSaver(force) {
    const s = dash.saver, el = $('saver'), now = new Date(), black = screenOff || s.style === 'czarny';
    el.className = black ? 'style-czarny' : 'style-' + String(s.style).replace(/\W/g, '') + ' sz-' + String(s.size || 'M').replace(/\W/g, '');
    if (black) { el.innerHTML = ''; renderSaver.last = ''; return; }
    const m = now.getHours() * 60 + now.getMinutes();
    // Co minutę lekkie przesunięcie treści, przeciw wypalaniu.
    const x = [0, 10, 18, 10, 0, -10, -18, -10][m % 8], y = [0, 14, 0, -14, 20, 0, -20][m % 7];
    const all = [].concat(...dash.pages.map(p => p.tiles));
    const items = (s.entities || []).map(id => {
      const t = all.find(k => k.entity === id), st = Panel.state(id), names = s.names || {}, icons = s.icons || {};
      let ic = icons[id] || t && t.icon || '', val = Panel.value(id), label = names[id] || t && t.name || Panel.name(id);
      // Pogoda: ikona warunków, temperatura i opis zamiast surowego „sunny”.
      if (/^weather\./.test(id) && st) {
        const c = CONDITIONS[st.state] || ['cloud', st.state], a = st.attributes;
        ic = icons[id] || c[0];
        val = a.temperature == null ? '–' : esc(Math.round(a.temperature)) + '<small> ' + esc(a.temperature_unit || '°C') + '</small>';
        label = names[id] || c[1];
      }
      return '<div>' + (ic ? icon(ic) : '') + '<b>' + val + '</b><span>' + esc(label) + '</span></div>';
    }).join('');
    const html = '<div class="sv" style="transform:translate(' + x + 'px,' + y + 'px)">' + alerts(all) + '<div class="sv-time">' + now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
      + '</div><div class="sv-date">' + now.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }) + '</div>' + saverWeather(s) + '<div class="sv-items">' + items + '</div></div>';
    if (force || renderSaver.last !== html || !el.firstChild) { el.innerHTML = html; renderSaver.last = html; }
  }

  /** Panel pogody na wygaszaczu: teraz (ikona, temperatura, opis) i prognoza dzienna. */
  let svWx = { id: '', stop: null, list: [] };
  function saverWeather(s) {
    const id = DP.isEntity(s.weather) ? s.weather : '', days = s.days == null ? 5 : +s.days;
    const want = days > 0 ? id : '';
    if (svWx.id !== want) {
      if (svWx.stop) svWx.stop();
      const me = svWx = { id: want, stop: null, list: [] };
      if (want) ha.forecast(want, list => { me.list = list || []; if (sleeping && me === svWx) renderSaver(); })
        .then(stop => { if (me !== svWx) { if (stop) stop(); } else me.stop = stop; }, () => { if (me === svWx) me.id = ''; });
    }
    const st = Panel.state(id);
    if (!id || !st) return '';
    const c = CONDITIONS[st.state] || ['cloud', st.state], a = st.attributes;
    const deg = n => n == null || isNaN(n) ? '–' : Math.round(n) + '°';
    const fc = svWx.list.slice(0, days).map((d, i) => '<div><span>' + (i ? new Date(d.datetime).toLocaleDateString('pl-PL', { weekday: 'short' }) : 'dziś') + '</span>'
      + icon((CONDITIONS[d.condition] || ['cloud'])[0]) + '<b>' + deg(d.temperature) + '</b><em>' + deg(d.templow) + '</em></div>').join('');
    return '<div class="sv-wx"><div class="sv-wx-now">' + icon(c[0]) + '<b>' + deg(a.temperature) + '</b><span>' + esc(c[1]) + '</span></div>'
      + (fc ? '<div class="sv-wx-fc">' + fc + '</div>' : '') + '</div>';
  }

  /** Ikony powiadomień nad zegarem: tylko encje, które są teraz „aktywne”. */
  const ALERT_ICONS = { door: 'window', window: 'window', opening: 'window', garage_door: 'garage', moisture: 'drop', smoke: 'bell', gas: 'bell', safety: 'shield', problem: 'bell', motion: 'eye', occupancy: 'eye', lock: 'shield' };
  function active(id) {
    if (!Panel.ok(id)) return false;
    const s = Panel.state(id).state, n = Number(s);
    return Panel.isOn(id) || ['detected', 'problem', 'triggered', 'pending', 'arming'].includes(s) || (s !== '' && !isNaN(n) && n > 0);
  }
  function alerts(all) {
    const list = (dash.saver.alerts || []).filter(active);
    if (!list.length) return '';
    return '<div class="sv-alerts">' + list.map(id => {
      const t = all.find(k => k.entity === id || (k.entities || []).includes(id)), dc = Panel.state(id).attributes.device_class;
      const ic = t && t.icon || ALERT_ICONS[dc] || ALERT_ICONS[id.split('.')[0]] || 'bell';
      return '<span>' + icon(ic) + '<em>' + esc((dash.saver.names || {})[id] || Panel.name(id)) + '</em></span>';
    }).join('') + '</div>';
  }

  /* ---------- raport stanu do HA ---------- */
  function report() {
    if (!ha || ha.preview || report.wait) return;
    report.wait = setTimeout(() => {
      report.wait = null;
      if (!ha.online || !pages.length) return;
      const s = {
        screen_on: !sleeping && !screenOff, brightness: updateDark.level == null ? 255 : updateDark.level, page: (pages[page] || {}).name || '',
        pages: pages.map(p => p.name), lux: sensors.lux, proximity: sensors.proximity == null ? null : !!sensors.proximity, format: fmt,
      };
      const key = JSON.stringify(s);
      if (key === report.last) return;
      report.last = key;
      ha.send(Object.assign({ type: 'panelpilot/state', device_id: ha.deviceId }, s)).catch(() => { report.last = ''; });
    }, 700);
  }

  /* ---------- okna ---------- */
  const btn = (act, text, cls) => '<button type="button" data-act="' + act + '" class="' + (cls || '') + '">' + text + '</button>';
  const on = (el, act, fn) => { const b = el.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener('click', fn); };
  function sheet(title, body, buttons) {
    const el = $('sheet');
    el.innerHTML = '<div class="box"><h2>' + esc(title) + '</h2><div class="body">' + body + '</div><div class="btns">' + buttons + '</div></div>';
    el.hidden = false;
    return el;
  }
  function closeSheet() { $('sheet').hidden = true; $('sheet').innerHTML = ''; lastTouch = Date.now(); }

  function message(c) {
    const el = sheet(c.title || 'Wiadomość', '<p>' + esc(c.message || '').replace(/\n/g, '<br>') + '</p>', btn('ok', 'OK', 'primary'));
    on(el, 'ok', closeSheet);
    if (c.seconds > 0) setTimeout(closeSheet, c.seconds * 1000);
  }

  function openSettings() {
    const now = Math.round((manual != null ? manual : updateDark.level == null ? 204 : updateDark.level) / 2.55);
    const el = sheet('Panel', '<div class="bright"><span>Jasność</span><input type="range" min="1" max="100" value="' + now + '" aria-label="Jasność"><b>' + now + '%</b>'
      + btn('auto', manual == null ? 'Automatycznie ✓' : 'Automatycznie') + '</div>'
      + '<p class="dim">Pulpit, jasność w dzień i w nocy oraz obrót ustawisz w Home Assistant: Ustawienia → Urządzenia oraz usługi → PanelPilot → Konfiguruj.</p><p class="dim">' + esc(info.name || 'Przeglądarka') + ' · ' + DP.FORMATS[fmt].name + ' ' + innerWidth + '×' + innerHeight + ' · ' + esc(info.version || 'web') + '</p>',
      (bell.entity || bell.camera ? btn('bell', 'Domofon') : '') + btn('reload', 'Odśwież') + btn('out', 'Wyloguj') + (native && native.openSetup ? btn('setup', 'Ustawienia aplikacji') : '') + btn('close', 'Zamknij', 'primary'));
    const range = el.querySelector('.bright input'), label = el.querySelector('.bright b');
    range.addEventListener('input', () => { manual = Math.max(3, Math.round(range.value * 2.55)); label.textContent = range.value + '%'; el.querySelector('[data-act=auto]').textContent = 'Automatycznie'; updateDark(true); });
    on(el, 'auto', () => { manual = null; updateDark(true); closeSheet(); });
    on(el, 'close', closeSheet);
    on(el, 'bell', () => { closeSheet(); Panel.doorbell.open(); });
    on(el, 'reload', () => native && native.reload ? native.reload() : location.reload());
    on(el, 'setup', () => native.openSetup());
    on(el, 'out', () => Panel.confirm('Wylogować panel?', () => ha.logout()));
  }
})();
