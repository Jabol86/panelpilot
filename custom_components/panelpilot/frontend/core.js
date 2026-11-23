/* Wspólne dla panelu i edytora: formaty ekranu, układ kafelków, ikony, motywy. */
(function () {
  const DP = window.DP = {};

  DP.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  DP.isEntity = id => typeof id === 'string' && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id);
  DP.isColor = c => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c);

  // Wymiary w pikselach CSS: NSPanel Pro 86 = 480×480, NSPanel Pro 120 = 750×1334 przy 240 dpi.
  DP.FORMATS = {
    square: { name: 'Kwadrat', w: 480, h: 480, cols: 6, rows: 5 },
    portrait: { name: 'Pion', w: 500, h: 889, cols: 6, rows: 10 },
    landscape: { name: 'Poziom', w: 889, h: 500, cols: 10, rows: 5 },
  };
  DP.BUILTIN = Object.keys(DP.FORMATS);
  /** Własne formaty z Home Assistanta (c_…): podmienia poprzednie, wbudowanych nie rusza. */
  DP.setFormats = custom => {
    Object.keys(DP.FORMATS).forEach(k => { if (!DP.BUILTIN.includes(k)) delete DP.FORMATS[k]; });
    Object.entries(custom || {}).forEach(([id, f]) => {
      if (/^c_[a-z0-9]{1,12}$/.test(id) && f && f.cols > 0 && f.rows > 0) DP.FORMATS[id] = { name: f.name, w: +f.w, h: +f.h, cols: +f.cols, rows: +f.rows, custom: true };
    });
  };
  DP.formatFor = (shape, w, h) => {
    const ratio = w / h;
    if (shape === 'square' || (shape !== 'rect' && ratio > 0.85 && ratio < 1.18)) return 'square';
    return ratio > 1 ? 'landscape' : 'portrait';
  };

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  DP.overlaps = overlaps;
  const fits = (r, f, taken) => r.x >= 0 && r.y >= 0 && r.x + r.w <= f.cols && r.y + r.h <= f.rows && !taken.some(t => overlaps(r, t));

  /** Pierwsze wolne miejsce (najbliżej „near”, jeśli podane). */
  DP.freeSpot = (w, h, f, taken, near) => {
    let best = null, score = Infinity;
    for (let y = 0; y + h <= f.rows; y++) for (let x = 0; x + w <= f.cols; x++) {
      const r = { x, y, w, h };
      if (!fits(r, f, taken)) continue;
      const s = near ? Math.hypot(x - near.x, y - near.y) : y * 100 + x;
      if (s < score) { score = s; best = r; }
    }
    return best;
  };

  /** Rozmiar kafelka w formacie bez własnego układu: z innego formatu albo domyślny. */
  DP.sizeOf = (tile, fmt, widgets) => {
    const f = DP.FORMATS[fmt], l = tile.l || {};
    const any = [l[fmt], l.portrait, l.landscape, l.square].find(Array.isArray);
    const def = (widgets[tile.type] || {}).size || [2, 1];
    const w = any ? any[2] : def[0], h = any ? any[3] : def[1];
    return [Math.max(1, Math.min(f.cols, w)), Math.max(1, Math.min(f.rows, h))];
  };

  /** Układ jednej listy kafelków: {placed:[{tile,x,y,w,h}], overflow:[tile]} */
  DP.layout = (tiles, fmt, widgets) => {
    const f = DP.FORMATS[fmt], placed = [], rest = [], overflow = [];
    tiles.forEach(tile => {
      const p = (tile.l || {})[fmt];
      if (p === false) return;                       // ukryty w tym formacie
      if (Array.isArray(p)) {
        const r = { x: p[0], y: p[1], w: p[2], h: p[3] };
        if (fits(r, f, placed)) { placed.push(Object.assign({ tile }, r)); return; }
      }
      rest.push(tile);
    });
    rest.forEach(tile => {
      const [w, h] = DP.sizeOf(tile, fmt, widgets);
      const r = DP.freeSpot(w, h, f, placed);
      r ? placed.push(Object.assign({ tile }, r)) : overflow.push(tile);
    });
    return { placed, overflow };
  };

  /** Wysokości wierszy (w fr): wiersz z samymi cienkimi kafelkami (sekcje, h=1) ma połowę wysokości. */
  DP.rowTracks = (placed, rows, widgets) => {
    const thin = new Array(rows).fill(null);
    placed.forEach(p => {
      const ok = !!(widgets[p.tile.type] || {}).thin && p.h === 1;
      for (let y = p.y; y < p.y + p.h; y++) thin[y] = ok ? thin[y] !== false : false;
    });
    return thin.map(t => t === true ? 0.5 : 1);
  };

  /** Strony do pokazania na panelu; nadmiar trafia na dodatkowe strony, nic nie ginie. */
  DP.pagesFor = (pages, fmt, widgets) => {
    const out = [];
    pages.forEach((p, i) => {
      let r = DP.layout(p.tiles, fmt, widgets), n = 1;
      out.push({ page: i, name: p.name, placed: r.placed });
      while (r.overflow.length && n < 8) {
        const left = r.overflow.map(t => Object.assign({}, t, { l: Object.assign({}, t.l, { [fmt]: undefined }) }));
        r = DP.layout(left, fmt, widgets);
        if (!r.placed.length) break;
        out.push({ page: i, extra: true, name: p.name + ' ' + (++n), placed: r.placed });
      }
    });
    return out;
  };

  /* ---------- ikony ---------- */
  const P = {
    temp: '<path d="M14 14.500V5a2 2 0 0 0-4 0v9.500a4 4 0 1 0 4 0z"/><path d="M12 10v7"/>',
    drop: '<path d="M12 3s6 6.500 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z"/>',
    window: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M4 12h16"/>',
    garage: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-9h10v9M7 15h10M7 18h10"/>',
    gate: '<path d="M4 21V6M20 21V6M4 9h16M4 18h16M8 9v9M12 9v9M16 9v9"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M8.500 15a6 6 0 1 1 7 0c-.6.5-.9 1.300-1 3h-5c-.1-1.700-.4-2.500-1-3z"/>',
    shield: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
    trash: '<path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    gauge: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 14l4-5"/>',
    bolt: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    home: '<path d="M3 11l9-8 9 8M5 10v11h14V10"/>',
    pylon: '<path d="M8 21l4-18 4 18M6 8h12M7 13h10M9 17l6-4M15 17l-6-4"/>',
    fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c-3-6 4-9 4-4 0 2-2 3-4 4zM14 12c6-3 9 4 4 4-2 0-3-2-4-4zM12 14c3 6-4 9-4 4 0-2 2-3 4-4zM10 12c-6 3-9-4-4-4 2 0 3 2 4 4z"/>',
    camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    cloud: '<path d="M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.500 2A3.500 3.500 0 0 1 18 18z"/>',
    rain: '<path d="M7 14a4 4 0 0 1 0-8 6 6 0 0 1 11.500 2A3.500 3.500 0 0 1 18 14z"/><path d="M8 17l-1 3M13 17l-1 3M18 17l-1 3"/>',
    snow: '<path d="M7 14a4 4 0 0 1 0-8 6 6 0 0 1 11.500 2A3.500 3.500 0 0 1 18 14z"/><path d="M8 18v.1M12 20v.1M16 18v.1" stroke-width="3"/>',
    moon: '<path d="M20 14A8 8 0 1 1 10 4a7 7 0 0 0 10 10z"/>',
    gear: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="3"/><circle cx="8" cy="17" r="3"/>',
    blind: '<path d="M4 4h16M6 4v13h12V4M6 8h12M6 12h12M12 17v3"/>',
    heat: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3-1-5 1-9z"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6v.1M4 12v.1M4 18v.1"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    graph: '<path d="M3 17l5-6 4 4 8-9"/><path d="M3 21h18"/>',
    touch: '<path d="M9 11V5a2 2 0 0 1 4 0v6l5 1.500c1 .4 1.500 1 1.200 2L18 20h-7l-4-5c-.7-1 .6-2.400 2-1z"/>',
    tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>',
    play: '<path d="M7 4l13 8-13 8z"/>', pause: '<path d="M8 5v14M16 5v14"/>', next: '<path d="M5 5l10 7-10 7zM19 5v14"/>',
    music: '<circle cx="7" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M10 18V5l11-2v13"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    speaker: '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', stop: '<rect x="7" y="7" width="10" height="10"/>',
  };
  DP.ICONS = Object.keys(P);

  // Ikony mdi:* pobierane z plików samego Home Assistanta (bez internetu).
  let meta = null;
  const parts = {};
  const json = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  DP.mdiMeta = () => meta || (meta = json('/static/mdi/iconMetadata.json').catch(e => { meta = null; throw e; }));
  const part = file => parts[file] || (parts[file] = json('/static/mdi/' + file + '.json').catch(e => { delete parts[file]; throw e; }));
  DP.mdiPath = async name => {
    const m = await DP.mdiMeta();
    let file = m.parts[0].file;
    m.parts.forEach(p => { if (p.start !== undefined && name >= p.start) file = p.file; });
    return (await part(file))[name];
  };
  DP.mdiNames = async () => {
    const m = await DP.mdiMeta();
    return [].concat(...await Promise.all(m.parts.map(async p => Object.keys(await part(p.file)))));
  };
  const paths = {};
  DP.icon = name => {
    const mdi = /^mdi:([a-z0-9-]+)$/.exec(name || '');
    if (!mdi) return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (P[name] || P.gauge) + '</svg>';
    const n = mdi[1];
    if (paths[n] === undefined) {
      paths[n] = null;
      DP.mdiPath(n).then(d => {
        paths[n] = d || '';
        document.querySelectorAll('svg[data-mdi="' + n + '"]').forEach(s => { s.innerHTML = '<path d="' + DP.esc(d || '') + '"/>'; });
      }, () => { delete paths[n]; });
    }
    return '<svg class="ic mdi" viewBox="0 0 24 24" aria-hidden="true" data-mdi="' + n + '">' + (paths[n] ? '<path d="' + DP.esc(paths[n]) + '"/>' : '') + '</svg>';
  };

  /** Wielkość ikony kafelka w pikselach (S, M, L, XL, XXL). */
  DP.ICON_SIZES = { S: 20, M: 30, L: 42, XL: 56, XXL: 76 };

  /* ---------- motywy ---------- */
  DP.THEME_FIELDS = { bg: 'Tło', tile: 'Kafelek', tile2: 'Przycisk', ink: 'Tekst', ink2: 'Tekst pomocniczy', accent: 'Akcent', on: 'Włączone', good: 'W porządku', warn: 'Ostrzeżenie' };
  DP.THEMES = {
    Grafit: { bg: '#11161a', tile: '#1c2328', tile2: '#2a343b', ink: '#eef2f4', ink2: '#a9b6be', accent: '#6db3f2', on: '#f2b84b', good: '#7ccf9a', warn: '#ff8f6b' },
    Czerń: { bg: '#000000', tile: '#121212', tile2: '#222222', ink: '#f2f2f2', ink2: '#9b9b9b', accent: '#62d0c4', on: '#ffc857', good: '#79d68c', warn: '#ff7a66' },
    Granat: { bg: '#0b1426', tile: '#15223b', tile2: '#223454', ink: '#eaf0fb', ink2: '#9db0cf', accent: '#7aa7ff', on: '#ffcf70', good: '#7fd8b0', warn: '#ff8c82' },
    Las: { bg: '#0f1a14', tile: '#1a2a20', tile2: '#27402f', ink: '#edf5ee', ink2: '#a3bba8', accent: '#8fcf7e', on: '#f0c860', good: '#7ad0a5', warn: '#ff9366' },
    Jasny: { bg: '#e9edf0', tile: '#ffffff', tile2: '#dde4e9', ink: '#17202a', ink2: '#566472', accent: '#1769c4', on: '#b06a00', good: '#1c7d46', warn: '#c2401c' },
  };
  DP.applyTheme = (root, theme) => {
    const t = Object.assign({}, DP.THEMES.Grafit, theme);
    Object.keys(DP.THEME_FIELDS).forEach(k => { if (DP.isColor(t[k])) root.style.setProperty('--' + k, t[k]); });
    root.style.setProperty('--radius', (Number(t.radius) >= 0 && t.radius !== '' && t.radius != null ? Math.min(40, +t.radius) : 16) + 'px');
    root.style.setProperty('--scale', Math.max(0.8, Math.min(1.5, +t.scale || 1)));
    root.style.setProperty('--alpha', Math.max(20, Math.min(100, +t.opacity || 100)) + '%');
    const url = typeof t.image === 'string' && /^(\/|https?:\/\/)[^"'()\\\s]+$/.test(t.image) ? 'url("' + t.image + '")' : 'none';
    root.style.setProperty('--image', url);
    // Ikony na kolorowym kółku: dla całego pulpitu (motyw) albo pojedynczego kafelka (tile.iconBg).
    root.dataset.icons = t.icons === 'circle' ? 'circle' : '';
    // Włączony kafelek: wypełnienie kolorem (domyślnie) albo świecąca ramka.
    root.dataset.on = t.onStyle === 'outline' ? 'outline' : '';
    if (DP.isColor(t.icbg)) root.style.setProperty('--icbg', t.icbg); else root.style.removeProperty('--icbg');
  };
})();
