/* Kafelki. Definicja: name, icon, size:[szer,wys], fields, html(t) albo mount(el,t)+update(el,t), tap(t), active(t), warn(t).
   fields: { k: klucz, l: etykieta, t: entity|entities|number|text|area|select|stations|bool, d: domeny, o: opcje } */
(function () {
  const P = Panel, esc = P.esc, ic = P.icon;
  const nm = t => esc(t.name || P.name(t.entity));
  const tx = (...rows) => '<div class="tx">' + rows.join('') + '</div>';
  const val = v => '<div class="val">' + v + '</div>';
  const lbl = v => '<div class="lbl">' + v + '</div>';
  const st = v => '<div class="st">' + v + '</div>';
  const name = v => '<div class="nm">' + v + '</div>';
  const deg = n => n == null || isNaN(n) ? '–' : Number(n).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + '°';
  const E = (l, d, k) => ({ k: k || 'entity', l, t: 'entity', d });
  const attr = (id, a) => P.ok(id) ? P.state(id).attributes[a] : undefined;
  const missing = t => { P.toast('Encja niedostępna: ' + (t.entity || 'brak'), true); };

  P.widget('clock', {
    name: 'Zegar', icon: 'gauge', group: 'Podstawowe', size: [3, 2], fields: [{ k: 'date', l: 'Pokaż datę', t: 'bool', def: true }], noEntity: true, plain: true,
    html(t) {
      const d = new Date();
      return '<div class="clock">' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) + '</div>'
        + (t.date === false ? '' : lbl(d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })));
    },
  });

  // Sekcja: cienki pasek z napisem, dzieli stronę na działy (Kuchnia, Salon…). Wiersz z samymi sekcjami ma pół wysokości.
  P.widget('section', {
    name: 'Sekcja (nagłówek)', icon: 'text', group: 'Podstawowe', size: [24, 1], noEntity: true, noIcon: true, plain: true, thin: true,
    fields: [{ k: 'align', l: 'Położenie napisu', t: 'select', o: [['', 'Do lewej'], ['center', 'Na środku'], ['right', 'Do prawej']] }, { k: 'line', l: 'Linia obok napisu', t: 'bool', def: true },
      { k: 'thin', l: 'Wysokość paska (część zwykłego wiersza)', t: 'select', o: [['', 'Niski (0,35)'], ['S', 'Bardzo niski (0,25)'], ['L', 'Połowa (0,5)']] }],
    html: t => '<span class="sec-t">' + esc(t.name || 'Sekcja') + '</span>' + (t.line === false ? '' : '<i class="sec-l"></i>'),
  });

  P.widget('sensor', {
    name: 'Czujnik', icon: 'temp', group: 'Podstawowe', size: [2, 1], fields: [E('Encja'), { k: 'digits', l: 'Miejsca po przecinku', t: 'number' }, { k: 'max', l: 'Ostrzegaj powyżej', t: 'number' }, { k: 'min', l: 'Ostrzegaj poniżej', t: 'number' }],
    warn: t => { const n = P.num(t.entity); return t.max !== '' && t.max != null && n > +t.max || t.min !== '' && t.min != null && n < +t.min; },
    html: t => ic(t.icon || 'gauge') + tx(val(P.value(t.entity, t.digits)), lbl(nm(t))),
  });

  P.widget('toggle', {
    name: 'Przełącznik', icon: 'bulb', group: 'Sterowanie', size: [2, 1], confirmable: true,
    fields: [E('Encja', ['switch', 'light', 'input_boolean', 'fan', 'automation', 'group', 'media_player', 'siren', 'humidifier'])],
    active: t => P.isOn(t.entity),
    html: t => ic(t.icon || 'bulb') + tx(name(nm(t)), st(!P.ok(t.entity) ? 'niedostępne' : P.isOn(t.entity) ? 'włączone' : 'wyłączone')),
    tap: t => P.ok(t.entity) ? P.service('homeassistant.toggle', { entity_id: t.entity }) : missing(t),
  });

  P.widget('light', {
    name: 'Światło ze ściemniaczem', icon: 'bulb', group: 'Sterowanie', size: [3, 2], controls: true, fields: [E('Światło', ['light'])],
    active: t => P.isOn(t.entity),
    mount(el, t) {
      el.innerHTML = ic(t.icon || 'bulb') + '<div class="tx"><div class="nm"></div><div class="st"></div></div><input type="range" min="1" max="100" aria-label="Jasność">';
      const r = el.querySelector('input');
      let timer;
      r.addEventListener('input', () => {
        el._drag = true; clearTimeout(timer);
        timer = setTimeout(() => P.service('light.turn_on', { entity_id: t.entity, brightness_pct: +r.value }), 180);
      });
      r.addEventListener('change', () => setTimeout(() => { el._drag = false; }, 1500));
    },
    update(el, t) {
      const b = attr(t.entity, 'brightness'), on = P.isOn(t.entity), pct = on ? Math.round((b == null ? 255 : b) / 2.55) : 0;
      el.querySelector('.nm').textContent = t.name || P.name(t.entity);
      el.querySelector('.st').textContent = !P.ok(t.entity) ? 'niedostępne' : on ? pct + ' %' : 'wyłączone';
      if (!el._drag) el.querySelector('input').value = pct || 1;
    },
    tap: t => P.ok(t.entity) ? P.service('light.toggle', { entity_id: t.entity }) : missing(t),
  });

  P.widget('cover', {
    name: 'Roleta', icon: 'blind', group: 'Sterowanie', size: [3, 2], controls: true, fields: [E('Roleta / brama', ['cover'])],
    mount(el, t) {
      el.innerHTML = ic(t.icon || 'blind') + '<div class="tx"><div class="nm"></div><div class="st"></div></div><div class="cbs">'
        + [['open_cover', 'up', 'Otwórz'], ['stop_cover', 'stop', 'Zatrzymaj'], ['close_cover', 'down', 'Zamknij']].map(b => '<button class="cb" data-s="' + b[0] + '" aria-label="' + b[2] + '">' + ic(b[1]) + '</button>').join('') + '</div>';
      el.addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) P.ok(t.entity) ? P.call(t.entity, b.dataset.s) : missing(t); });
    },
    update(el, t) {
      const p = attr(t.entity, 'current_position'), s = P.ok(t.entity) ? P.state(t.entity).state : '';
      el.querySelector('.nm').textContent = t.name || P.name(t.entity);
      el.querySelector('.st').textContent = ({ open: 'otwarte', closed: 'zamknięte', opening: 'otwieranie…', closing: 'zamykanie…' }[s] || '–') + (p != null ? ' · ' + p + ' %' : '');
    },
  });

  P.widget('climate', {
    name: 'Termostat', icon: 'heat', group: 'Sterowanie', size: [3, 2], controls: true, fields: [E('Termostat', ['climate'])],
    active: t => ['heating', 'cooling'].includes(attr(t.entity, 'hvac_action')),
    mount(el, t) {
      el.innerHTML = ic(t.icon || 'heat') + '<div class="tx"><div class="val"></div><div class="lbl"></div></div><div class="cbs"><button class="cb" data-d="-1" aria-label="Chłodniej">' + ic('minus') + '</button><button class="cb" data-d="1" aria-label="Cieplej">' + ic('plus') + '</button></div>';
      let target = null, timer;
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-d]'), now = attr(t.entity, 'temperature');
        if (!b) return;
        if (now == null) return missing(t);
        const step = attr(t.entity, 'target_temp_step') || 0.5;
        target = (target == null ? now : target) + step * b.dataset.d;
        target = Math.max(attr(t.entity, 'min_temp') || 5, Math.min(attr(t.entity, 'max_temp') || 35, target));
        el.querySelector('.lbl').textContent = 'cel ' + deg(target);
        clearTimeout(timer);
        timer = setTimeout(() => { P.service('climate.set_temperature', { entity_id: t.entity, temperature: target }); target = null; }, 800);
      });
    },
    update(el, t) {
      el.querySelector('.val').textContent = deg(attr(t.entity, 'current_temperature'));
      el.querySelector('.lbl').textContent = (t.name || P.name(t.entity)) + ' · cel ' + deg(attr(t.entity, 'temperature'));
    },
  });

  P.widget('hold', {
    name: 'Przytrzymaj (brama)', icon: 'gate', group: 'Sterowanie', size: [2, 1],
    fields: [E('Co uruchomić', ['switch', 'button', 'input_button', 'script', 'scene', 'cover', 'lock', 'input_boolean', 'light']), E('Skąd brać stan', null, 'state_entity')],
    html: t => '<i class="fill"></i>' + ic(t.icon || 'gate') + tx(name(nm(t)), st(P.ok(t.state_entity) ? P.value(t.state_entity) : 'przytrzymaj')),
    tap: () => P.toast('Przytrzymaj, aby uruchomić'),
  });

  P.widget('button', {
    name: 'Przycisk akcji', icon: 'touch', group: 'Sterowanie', size: [2, 1], fields: [E('Skrypt / scena / przycisk', ['script', 'scene', 'button', 'input_button', 'automation'])], confirmable: true,
    html: t => ic(t.icon || 'touch') + tx(name(nm(t))),
    tap(t) {
      if (!DP.isEntity(t.entity)) return P.toast('Wybierz encję albo akcję w edytorze', true);
      const d = t.entity.split('.')[0];
      P.call(t.entity, d === 'automation' ? 'trigger' : /button$/.test(d) ? 'press' : 'turn_on').then(ok => ok && P.toast((t.name || P.name(t.entity)) + ': wysłano'));
    },
  });

  P.widget('opening', {
    name: 'Okna i drzwi', icon: 'window', group: 'Podstawowe', size: [2, 1], fields: [{ k: 'entities', l: 'Czujniki', t: 'entities', d: ['binary_sensor', 'group', 'cover', 'lock'] }], noEntity: true,
    warn: t => (t.entities || []).some(P.isOn),
    html(t) {
      const ids = t.entities || [], open = ids.filter(P.isOn);
      const text = open.length === 1 ? esc(P.name(open[0])) : open.length ? 'Otwarte: ' + open.length : ids.length && ids.every(P.ok) ? 'Zamknięte' : '–';
      return ic(t.icon || 'window') + tx(val(text), lbl(esc(t.name || 'Okna i drzwi')));
    },
  });

  P.widget('weather', {
    name: 'Pogoda', icon: 'cloud', group: 'Podstawowe', size: [3, 2], fields: [E('Pogoda', ['weather'])], noIcon: true,
    html(t) {
      if (!P.ok(t.entity)) return tx(val('–'), lbl('Pogoda'));
      const s = P.state(t.entity), c = CONDITION(s.state), w = s.attributes.wind_speed;
      return '<div class="wx">' + ic(c[0]) + val(deg(s.attributes.temperature)) + '</div>' + tx(st(esc(c[1])), lbl('Wiatr ' + (w == null ? '–' : Math.round(w) + ' ' + esc(s.attributes.wind_speed_unit || 'km/h'))));
    },
  });
  function CONDITION(s) { return P.CONDITIONS[s] || ['cloud', s]; }

  P.widget('forecast', {
    name: 'Prognoza', icon: 'rain', group: 'Podstawowe', size: [6, 2], fields: [E('Pogoda', ['weather']), { k: 'days', l: 'Liczba dni', t: 'number' }], noIcon: true,
    mount(el, t) {
      let stop, dead = false, pending = false;
      const go = () => {
        if (stop || pending || dead || !P.ha.online || !DP.isEntity(t.entity)) return;
        pending = true;
        P.ha.forecast(t.entity, list => { el._fc = list; this.update(el, t); }).then(s => { pending = false; if (dead) s(); else stop = s; }, () => { pending = false; });
      };
      go();
      const timer = setInterval(() => { if (!P.ha.online) stop = null; go(); }, 10000);
      return () => { dead = true; clearInterval(timer); if (stop) stop(); };
    },
    update(el, t) {
      const list = (el._fc || []).slice(0, Math.max(1, Math.min(7, +t.days || 5)));
      el.innerHTML = list.length ? '<div class="fc">' + list.map((d, i) => '<div><span>' + (i ? new Date(d.datetime).toLocaleDateString('pl-PL', { weekday: 'short' }) : 'dziś') + '</span>' + ic(CONDITION(d.condition)[0])
        + '<b>' + deg(d.temperature) + '</b><em>' + deg(d.templow) + '</em></div>').join('') + '</div>' : lbl('Prognoza…');
    },
  });

  P.widget('graph', {
    name: 'Wykres', icon: 'graph', group: 'Podstawowe', size: [3, 2], fields: [E('Czujnik', ['sensor', 'input_number', 'number']), { k: 'hours', l: 'Ile godzin', t: 'number' }], noIcon: true,
    mount(el, t) {
      let dead = false;
      const load = () => {
        if (!P.ha.online || P.sleeping || !DP.isEntity(t.entity)) return;
        P.ha.history(t.entity, Math.max(1, Math.min(168, +t.hours || 24))).then(p => { if (!dead) { el._pts = p; this.update(el, t); } }, () => {});
      };
      load();
      const timer = setInterval(load, 300000), first = setInterval(() => { if (el._pts) clearInterval(first); else load(); }, 4000);
      return () => { dead = true; clearInterval(timer); clearInterval(first); };
    },
    update(el, t) {
      const pts = el._pts || [];
      let svg = '';
      if (pts.length > 1) {
        const t0 = pts[0][0], t1 = pts[pts.length - 1][0], vs = pts.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), n = Math.ceil(pts.length / 120);
        const line = pts.filter((p, i) => i % n === 0 || i === pts.length - 1).map((p, i) => (i ? 'L' : 'M') + ((p[0] - t0) / (t1 - t0 || 1) * 100).toFixed(1) + ' ' + (36 - (p[1] - lo) / (hi - lo || 1) * 32).toFixed(1)).join('');
        svg = '<svg class="gr" viewBox="0 0 100 40" preserveAspectRatio="none"><path class="a" d="' + line + 'L100 40L0 40Z"/><path class="l" d="' + line + '"/></svg>';
      }
      el.innerHTML = svg + tx(val(P.value(t.entity)), lbl(nm(t)));
    },
  });

  P.widget('gauge', {
    name: 'Wskaźnik', icon: 'gauge', group: 'Podstawowe', size: [2, 2], fields: [E('Czujnik', ['sensor', 'input_number', 'number']), { k: 'from', l: 'Od', t: 'number' }, { k: 'to', l: 'Do', t: 'number' }, { k: 'max', l: 'Ostrzegaj powyżej', t: 'number' }], noIcon: true,
    warn: t => t.max !== '' && t.max != null && P.num(t.entity) > +t.max,
    html(t) {
      const a = +t.from || 0, b = t.to === '' || t.to == null ? 100 : +t.to, n = P.num(t.entity), k = isNaN(n) ? 0 : Math.max(0, Math.min(1, (n - a) / (b - a || 1)));
      const arc = f => { const g = Math.PI * (0.75 + 1.5 * f); return (50 + 40 * Math.cos(g)).toFixed(1) + ' ' + (50 + 40 * Math.sin(g)).toFixed(1); };
      return '<div class="gg"><svg viewBox="0 0 100 92"><path d="M' + arc(0) + 'A40 40 0 1 1 ' + arc(1) + '"/>' + (k > 0.005 ? '<path class="v" d="M' + arc(0) + 'A40 40 0 ' + (k > 2 / 3 ? 1 : 0) + ' 1 ' + arc(k) + '"/>' : '') + '</svg>' + val(P.value(t.entity)) + '</div>' + lbl(nm(t));
    },
  });

  P.widget('camera', {
    name: 'Kamera', icon: 'camera', group: 'Podgląd', size: [6, 4], fields: [E('Kamera', ['camera', 'image']), { k: 'stream', l: 'Adres strony z podglądem na żywo (opcjonalnie)', t: 'text' }, { k: 'every', l: 'Odświeżaj co (s)', t: 'number' }], noIcon: true,
    mount(el, t) {
      const body = document.createElement('div'), live = /^https?:\/\//.test(t.stream || '') && !P.ha.preview, img = document.createElement('img'), note = document.createElement('div');
      body.className = 'cam'; img.alt = ''; note.className = 'cam-note';
      if (live) { if (!P.sleeping) { const f = document.createElement('iframe'); f.src = t.stream; f.allow = 'autoplay'; body.append(f); } } else body.append(img);
      note.innerHTML = ic('camera') + '<span></span>';
      note.lastChild.textContent = t.name || P.name(t.entity) || 'Kamera';
      body.append(note); el.append(body);
      let busy = false;
      const load = () => {
        // Podczas wygaszacza obraz nie jest pobierany.
        if (live || busy || P.sleeping || !P.ha.online) return;
        const src = P.ha.image(t.entity);
        if (!src) return;
        busy = true;
        const n = new Image();
        n.onload = () => { img.src = src; busy = false; el.classList.add('has-img'); };
        n.onerror = () => { busy = false; el.classList.remove('has-img'); };
        n.src = src;
      };
      const timer = setInterval(load, Math.max(1, +t.every || 2) * 1000);
      load();
      return () => clearInterval(timer);
    },
    update() {},
    tap: t => { if (t.entity && t.entity === P.doorbellConfig.camera) P.doorbell.open(); },
  });

  P.widget('energy', {
    name: 'Przepływ energii', icon: 'bolt', group: 'Podgląd', size: [6, 2], fields: [E('Produkcja PV', ['sensor'], 'pv'), E('Zużycie domu', ['sensor'], 'home'), E('Sieć (+ pobór, − oddawanie)', ['sensor'], 'grid')], noIcon: true, noEntity: true,
    html(t) {
      // Przeliczenie na waty według jednostki encji.
      const w = id => P.num(id) * ({ kW: 1000, MW: 1e6 }[attr(id, 'unit_of_measurement')] || 1);
      const show = n => isNaN(n) ? '–' : Math.abs(n) >= 1000 ? (n / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + '<small> kW</small>' : Math.round(n) + '<small> W</small>';
      const pv = w(t.pv), home = w(t.home), grid = w(t.grid);
      const node = (i, v, l, c) => '<div class="en ' + c + '">' + ic(i) + '<b>' + v + '</b><span>' + l + '</span></div>';
      return '<div class="enrow">' + node('sun', show(pv), 'fotowoltaika', pv > 20 ? 'good' : '') + '<i class="flow ' + (pv > 20 ? 'go' : '') + '"></i>' + node('home', show(home), 'dom', '')
        + '<i class="flow ' + (isNaN(grid) ? '' : grid < 0 ? 'go' : 'back') + '"></i>' + node('pylon', show(Math.abs(grid)), isNaN(grid) ? 'sieć' : grid < 0 ? 'oddawanie' : 'pobór', grid > 0 ? 'cost' : grid < 0 ? 'good' : '') + '</div>';
    },
  });

  P.widget('list', {
    name: 'Lista encji', icon: 'list', group: 'Podgląd', size: [3, 3], fields: [{ k: 'entities', l: 'Encje', t: 'entities' }], noEntity: true, noIcon: true,
    html: t => '<div class="ls">' + (t.name ? '<div><b>' + esc(t.name) + '</b></div>' : '') + (t.entities || []).map(id => '<div><span>' + esc(P.name(id)) + '</span><b class="' + (P.isOn(id) ? 'hot' : '') + '">' + P.value(id).replace(/^on$/, 'wł.').replace(/^off$/, 'wył.') + '</b></div>').join('') + '</div>',
  });

  P.widget('text', {
    name: 'Napis', icon: 'text', group: 'Podstawowe', size: [3, 1], fields: [{ k: 'content', l: 'Treść', t: 'area' }], noEntity: true, noIcon: true, plain: true,
    html: t => '<div class="note">' + esc(t.content || t.name || 'Napis') + '</div>',
  });

  P.widget('music', {
    name: 'Muzyka / radio', icon: 'music', group: 'Sterowanie', size: [6, 4], controls: true, noIcon: true,
    fields: [E('Odtwarzacz', ['media_player']), E('Wyjście (puste = źródła odtwarzacza)', ['select', 'input_select'], 'output'),
      { k: 'vol', l: 'Głośność', t: 'select', o: [['', 'Przyciski − i + ze wskaźnikiem'], ['slider', 'Suwak'], ['none', 'Bez regulacji']] },
      { k: 'volStep', l: 'Krok przycisków głośności (%)', t: 'number' },
      { k: 'perRow', l: 'Stacji w rzędzie (puste = tyle, ile się zmieści)', t: 'number' },
      { k: 'stations', l: 'Przyciski stacji', t: 'stations' }],
    mount(el, t) {
      const vol = t.vol === 'slider' ? '<input type="range" min="0" max="100" aria-label="Głośność">'
        : t.vol === 'none' ? '' : volBox();
      el.innerHTML = '<div class="mu"><div class="mu-top"><div class="mu-title"></div><select aria-label="Wyjście dźwięku"></select></div><div class="mu-ctl"><button class="cb" data-m="play" aria-label="Odtwarzaj lub wstrzymaj"></button><button class="cb" data-m="next" aria-label="Następny">' + ic('next') + '</button><span class="mu-sp"></span>' + vol + '</div><div class="mu-st">'
        + (t.stations || []).map((s, i) => '<button data-s="' + i + '">' + (/^(\/|https?:)/.test(s.image || '') ? '<img src="' + esc(s.image) + '" alt="' + esc(s.name) + '">' : esc(s.name)) + '</button>').join('') + '</div></div>';
      // Ile stacji w rzędzie: reszta przechodzi do kolejnych rzędów, które dzielą wysokość kafelka.
      const per = Math.max(0, Math.min(12, parseInt(t.perRow, 10) || 0));
      if (per) el.querySelector('.mu-st').style.gridTemplateColumns = 'repeat(' + per + ',minmax(0,1fr))';
      const range = el.querySelector('input'), sel = el.querySelector('select');
      let timer;
      const setVol = v => { clearTimeout(timer); timer = setTimeout(() => P.service('media_player.volume_set', { entity_id: t.entity, volume_level: v / 100 }), 250); };
      if (range) {
        range.addEventListener('input', () => { el._drag = true; setVol(+range.value); });
        range.addEventListener('change', () => setTimeout(() => { el._drag = false; }, 1500));
      }
      sel.addEventListener('change', () => t.output ? P.service(t.output.split('.')[0] + '.select_option', { entity_id: t.output, option: sel.value }) : P.service('media_player.select_source', { entity_id: t.entity, source: sel.value }));
      el.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.v) return volClick(el, t, +b.dataset.v);
        if (P.ha.preview) return;
        if (b.dataset.m) return P.service(b.dataset.m === 'play' ? 'media_player.media_play_pause' : 'media_player.media_next_track', { entity_id: t.entity });
        const s = t.stations[+b.dataset.s];
        s.service ? P.service(s.service, s.data) : P.toast('Stacja „' + s.name + '” nie ma jeszcze akcji', true);
      });
    },
    update(el, t) {
      const s = P.state(t.entity), a = s ? s.attributes : {}, o = P.state(t.output);
      const list = t.output ? o && o.attributes.options || [] : a.source_list || [], now = t.output ? o && o.state : a.source;
      el.querySelector('.mu-title').textContent = a.media_title || t.name || 'Radio';
      el.querySelector('[data-m=play]').innerHTML = ic(s && s.state === 'playing' ? 'pause' : 'play');
      const range = el.querySelector('input'), sel = el.querySelector('select');
      if (range && !el._drag && a.volume_level != null) range.value = Math.round(a.volume_level * 100);
      if (el.querySelector('.mu-meter') && el._vol == null) meter(el, a.volume_level == null ? null : Math.round(a.volume_level * 100));
      sel.hidden = !list.length;
      if (document.activeElement !== sel) sel.innerHTML = list.map(x => '<option' + (x === now ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
      el.querySelectorAll('[data-s]').forEach((b, i) => b.classList.toggle('active', !!a.media_title && a.media_title === t.stations[i].name));
    },
  });

  /** Przyciski głośności: od razu pokazują nową wartość, do HA idzie jedna zmiana po serii dotknięć. */
  function volClick(el, t, dir) {
    const a = (P.state(t.entity) || {}).attributes || {}, step = Math.max(1, Math.min(25, +t.volStep || 5));
    const cur = el._vol != null ? el._vol : Math.round((a.volume_level || 0) * 100);
    el._vol = Math.max(0, Math.min(100, Math.round((cur + step * dir) / step) * step));
    meter(el, el._vol);
    clearTimeout(el._volT); el._volT = setTimeout(() => { el._vol = null; }, 3000);
    if (P.ha.preview) return;
    const v = el._vol;
    clearTimeout(el._volS);
    el._volS = setTimeout(() => P.service('media_player.volume_set', { entity_id: t.entity, volume_level: v / 100 }), 250);
  }
  const volBox = () => '<div class="mu-vol"><div class="mu-meter" aria-hidden="true">' + '<i></i>'.repeat(10) + '<span></span></div>'
    + '<div class="mu-vb"><button class="cb" data-v="-1" aria-label="Ciszej">' + ic('minus') + '</button><button class="cb" data-v="1" aria-label="Głośniej">' + ic('plus') + '</button></div></div>';

  // Telewizor (np. Philips przez integrację „Philips TV”). Tło: obraz bieżącego źródła albo aplikacji.
  // Źródła i aplikacje to przyciski z logo; pilot (strzałki, OK) chowa się pod przyciskiem „Pilot”.
  const TV_KEYS = { up: 'CursorUp', down: 'CursorDown', left: 'CursorLeft', right: 'CursorRight', ok: 'Confirm', back: 'Back', home: 'Home' };
  const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  /** Które źródło z listy kafelka jest teraz włączone (po aplikacji, źródle albo tytule). */
  const tvNow = (t, a) => {
    // Najpierw aplikacja (Netflix działa „na” HDMI 1, ale ważniejsza jest aplikacja), potem kanał i tytuł, na końcu wejście.
    for (const x of [a.app_name, a.media_channel, a.media_title, a.source]) {
      const i = x ? (t.sources || []).findIndex(s => same(x, s.name) || same(x, s.match)) : -1;
      if (i >= 0) return i;
    }
    return -1;
  };
  P.widget('tv', {
    name: 'Telewizor', icon: 'tv', group: 'Sterowanie', size: [6, 4], controls: true, noIcon: true,
    fields: [E('Telewizor', ['media_player']), E('Pilot (opcjonalnie, np. remote.philips_tv)', ['remote'], 'remote'),
      { k: 'sources', l: 'Źródła i aplikacje (przyciski)', t: 'sources' },
      { k: 'perRow', l: 'Przycisków w rzędzie (puste = tyle, ile się zmieści)', t: 'number' },
      { k: 'bg', l: 'Tło z obrazu bieżącego źródła lub aplikacji', t: 'bool', def: true },
      { k: 'ch', l: 'Przyciski kanałów', t: 'bool', def: false },
      { k: 'volStep', l: 'Krok przycisków głośności (%)', t: 'number' },
      { k: 'keys', l: 'Kody klawiszy pilota (JSON, puste = Philips)', t: 'text' }],
    mount(el, t) {
      const b = (k, i, l, c) => '<button class="cb' + (c ? ' ' + c : '') + '" data-k="' + k + '" aria-label="' + l + '">' + ic(i) + '</button>';
      const list = (t.sources || []).length ? t.sources : null;
      const remote = DP.isEntity(t.remote);
      el.innerHTML = '<div class="tv-bg"></div><div class="tv">'
        + '<div class="tv-top"><div class="tv-hd"><div class="tv-name"></div><div class="tv-sub"></div></div>'
        + (remote ? '<button class="tv-chip" data-k="pad">' + ic('touch') + '<span>Pilot</span></button>' : '') + b('mute', 'mute', 'Wycisz') + b('power', 'power', 'Włącz lub wyłącz', 'pw') + '</div>'
        + '<div class="tv-src"' + (+t.perRow ? ' style="grid-template-columns:repeat(' + Math.min(12, +t.perRow) + ',minmax(0,1fr))"' : '') + '>'
        + (list || []).map((s, i) => '<button data-s="' + i + '">' + (/^(\/|https?:)/.test(s.image || '') ? '<img src="' + esc(s.image) + '" alt="' + esc(s.name) + '">' : '<span>' + esc(s.name) + '</span>') + '</button>').join('') + '</div>'
        + (remote ? '<div class="tv-pad" hidden>' + b('home', 'home', 'Menu główne') + b('up', 'up', 'W górę') + b('back', 'back', 'Wstecz') + b('left', 'left', 'W lewo') + '<button class="cb ok" data-k="ok">OK</button>' + b('right', 'right', 'W prawo') + '<i></i>' + b('down', 'down', 'W dół') + '<i></i></div>' : '')
        + '<div class="tv-bot">' + (t.ch ? '<div class="tv-ch">' + b('chdown', 'down', 'Poprzedni kanał') + '<span>CH</span>' + b('chup', 'up', 'Następny kanał') + '</div>' : '')
        + '<span class="mu-sp"></span>' + volBox() + '</div></div>';
      el.addEventListener('click', e => {
        const x = e.target.closest('button');
        if (!x) return;
        if (x.dataset.v) return volClick(el, t, +x.dataset.v);
        if (x.dataset.k === 'pad') { const pad = el.querySelector('.tv-pad'); pad.hidden = !pad.hidden; el.classList.toggle('pad-open', !pad.hidden); return; }
        if (P.ha.preview) return;
        if (!DP.isEntity(t.entity)) return missing(t);
        const k = x.dataset.k, a = P.state(t.entity) ? P.state(t.entity).attributes : {}, on = P.isOn(t.entity);
        if (k === 'power') return P.service(on ? 'media_player.turn_off' : 'media_player.turn_on', { entity_id: t.entity });
        if (x.dataset.s != null) {
          const s = t.sources[+x.dataset.s];
          const go = () => s.service ? P.service(s.service, s.data || {}) : P.service('media_player.select_source', { entity_id: t.entity, source: s.name });
          // Wyłączony telewizor najpierw się włącza.
          if (!on) { P.service('media_player.turn_on', { entity_id: t.entity }); setTimeout(go, 4000); } else go();
          el._pick = +x.dataset.s; clearTimeout(el._pickT); el._pickT = setTimeout(() => { el._pick = null; this.update(el, t); }, 6000);
          return this.update(el, t);
        }
        if (!P.ok(t.entity)) return missing(t);
        if (k === 'mute') return P.service('media_player.volume_mute', { entity_id: t.entity, is_volume_muted: !a.is_volume_muted });
        if (k === 'chup' || k === 'chdown') return P.service('media_player.media_' + (k === 'chup' ? 'next' : 'previous') + '_track', { entity_id: t.entity });
        let keys = TV_KEYS;
        try { if (t.keys) keys = Object.assign({}, TV_KEYS, JSON.parse(t.keys)); } catch (err) { /* zostają domyślne */ }
        if (keys[k]) P.service('remote.send_command', { entity_id: t.remote, command: keys[k] });
      });
    },
    update(el, t) {
      const s = P.state(t.entity), a = s ? s.attributes : {}, on = P.isOn(t.entity) || (!!s && s.state === 'paused');
      const now = el._pick != null ? el._pick : on ? tvNow(t, a) : -1, src = now >= 0 ? t.sources[now] : null;
      const what = on ? (src && src.name) || a.app_name || a.source || '' : '';
      el.querySelector('.tv-name').textContent = t.name || P.name(t.entity) || 'Telewizor';
      el.querySelector('.tv-sub').textContent = !P.ok(t.entity) ? 'niedostępny' : !on ? 'wyłączony' : [what, a.media_channel || (a.media_title !== what ? a.media_title : '')].filter(Boolean).join(' · ') || 'włączony';
      el.classList.toggle('tv-off', !on);
      el.querySelector('[data-k=power]').classList.toggle('lit', on);
      el.querySelector('[data-k=mute]').classList.toggle('lit', !!a.is_volume_muted);
      el.querySelectorAll('.tv-src [data-s]').forEach((x, i) => x.classList.toggle('active', i === now));
      // Tło: obraz źródła z listy, a gdy go nie ma, obrazek aplikacji/kanału z Home Assistanta.
      const img = t.bg === false || !on ? '' : src && /^(\/|https?:)/.test(src.image || '') ? src.image : a.entity_picture || '';
      const bg = el.querySelector('.tv-bg');
      if (bg._img !== img) { bg._img = img; bg.style.backgroundImage = img ? 'url("' + img.replace(/["\\]/g, '') + '")' : ''; }
      if (el._vol == null) meter(el, on && a.volume_level != null ? Math.round(a.volume_level * 100) : null);
    },
  });

  // Licznik: ile z wybranych encji jest włączonych, np. „7 włączonych” na kafelku Oświetlenie.
  const plural = n => n === 1 || (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'włączone' : 'włączonych';
  P.widget('count', {
    name: 'Licznik włączonych (np. światła)', icon: 'bulb', group: 'Podstawowe', size: [3, 1], noEntity: true,
    fields: [{ k: 'entities', l: 'Co liczyć', t: 'entities', d: ['light', 'switch', 'fan', 'media_player', 'cover', 'binary_sensor', 'input_boolean', 'climate'], quick: [['light', '+ Wszystkie światła']] },
      { k: 'none', l: 'Napis, gdy nic nie jest włączone', t: 'text' }],
    active: t => (t.entities || []).some(P.isOn),
    html(t) {
      const ids = t.entities || [], n = ids.filter(P.isOn).length;
      const text = !ids.length ? 'wybierz encje' : n ? n + ' ' + plural(n) : esc(t.none || 'wszystkie wyłączone');
      return ic(t.icon || 'bulb') + tx(name(esc(t.name || 'Oświetlenie')), '<div class="st keep">' + text + '</div>');
    },
  });

  /** Wskaźnik głośności: 10 kresek rosnącej wysokości i procent. */
  function meter(el, v) {
    const m = el.querySelector('.mu-meter');
    if (!m) return;
    m.querySelectorAll('i').forEach((b, i) => b.classList.toggle('on', v != null && v > i * 10));
    m.querySelector('span').textContent = v == null ? '–' : v + ' %';
  }

  P.widget('device', {
    name: 'Czujniki panelu', icon: 'tablet', group: 'Podgląd', size: [6, 3], fields: [], noIcon: true, noEntity: true,
    html() {
      const s = P.sensors, row = (i, l, v) => '<div>' + ic(i) + '<span>' + l + '</span><b>' + v + '</b></div>';
      return '<div class="ls">' + row('sun', 'Światło', s.lux == null ? '–' : Math.round(s.lux) + ' lx') + row('eye', 'Zbliżenie', s.proximity == null ? '–' : s.proximity ? 'ktoś jest' : 'nikogo')
        + row('home', 'Home Assistant', P.ha.preview ? 'podgląd' : P.ha.online ? 'połączono' : 'brak połączenia') + row('tablet', 'Ekran', DP.FORMATS[P.format].name + ' ' + innerWidth + '×' + innerHeight) + '</div>';
    },
  });
})();
