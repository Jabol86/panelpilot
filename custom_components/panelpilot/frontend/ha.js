/* Połączenie z Home Assistant: logowanie OAuth, WebSocket, subskrypcja tylko potrzebnych encji.
   Hasło wpisujesz wyłącznie na stronie logowania HA; panel trzyma tylko token. */
(function () {
  const KEY = 'panelpilot_tokens';
  const CLIENT = location.origin + '/';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) { /* brak pamięci */ } },
  };
  class AuthError extends Error {}

  async function token(params) {
    const r = await fetch('/auth/token', { method: 'POST', body: new URLSearchParams(Object.assign({ client_id: CLIENT }, params)) });
    if (r.status === 400 || r.status === 401 || r.status === 403) throw new AuthError('Logowanie odrzucone');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  class HA {
    constructor() {
      this.states = {}; this.online = false;
      this.onState = () => {}; this.onStatus = () => {}; this.onReady = async () => {};
      this.listeners = [];
      this._id = 0; this._pending = new Map(); this._subs = new Map(); this._delay = 1000;
    }

    onAuth() { this.login(); }

    /** Parowanie kodem: panel pokazuje kod, administrator zatwierdza go w HA. */
    async pair(details, show) {
      const post = body => fetch('/api/panelpilot/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      for (;;) {
        const r = await post(Object.assign({ client_id: CLIENT }, details));
        if (r.status === 404) throw new Error('Brak integracji PanelPilot');
        if (!r.ok) throw new Error(r.status === 403 ? 'Parowanie działa tylko w sieci lokalnej' : r.status === 429 ? 'Zbyt wiele prób parowania, odczekaj chwilę' : 'HTTP ' + r.status);
        const p = await r.json();
        show(p.code);
        for (let alive = true; alive;) {
          await new Promise(s => setTimeout(s, 2500));
          const q = await post({ secret: p.secret }).catch(() => null);
          if (!q) continue;
          if (q.status === 410) { alive = false; continue; }   // kod wygasł: pokaż nowy
          const a = q.ok ? await q.json() : {};
          if (a.refresh_token) { store.set({ refresh: a.refresh_token }); return; }
        }
      }
    }

    login() {
      const nonce = Math.random().toString(36).slice(2);
      sessionStorage.setItem('panelpilot_state', nonce);
      const u = new URL('/auth/authorize', location.origin);
      u.searchParams.set('client_id', CLIENT);
      u.searchParams.set('redirect_uri', location.origin + location.pathname + location.search);
      u.searchParams.set('state', nonce);
      location.assign(u);
    }

    async logout() {
      const saved = store.get();
      store.set(null);
      if (saved) await fetch('/auth/revoke', { method: 'POST', body: new URLSearchParams({ token: saved.refresh }) }).catch(() => {});
      location.reload();
    }

    async access() {
      const q = new URLSearchParams(location.search), code = q.get('code');
      if (code) {
        const ok = q.get('state') === sessionStorage.getItem('panelpilot_state');
        ['code', 'state', 'storeToken'].forEach(k => q.delete(k));
        history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
        if (ok) {
          const t = await token({ grant_type: 'authorization_code', code });
          store.set({ refresh: t.refresh_token });
          return t.access_token;
        }
      }
      const saved = store.get();
      if (!saved) throw new AuthError('Brak logowania');
      return (await token({ grant_type: 'refresh_token', refresh_token: saved.refresh })).access_token;
    }

    async connect() {
      try {
        await this._open(await this.access());
        this._delay = 1000; this.online = true; this.onStatus(true);
        this.send({ type: 'auth/current_user' }).then(u => { this.user = u; }, () => {});
        this.send({ type: 'get_config' }).then(c => { this.config = c; }, () => {});
        this.listeners.forEach(l => l[0] === 'ready' && l[1]());
        await this.onReady();
      } catch (e) {
        if (e instanceof AuthError) { store.set(null); this.onAuth(); return; }
        console.warn('HA:', e.message || e);
        if (!this.online) this._retry();
      }
    }

    _retry() {
      if (this.online) this.listeners.forEach(l => l[0] === 'disconnected' && l[1]());
      this.online = false; this.onStatus(false);
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.connect(), this._delay);
      this._delay = Math.min(this._delay * 2, 30000);
    }

    _open(accessToken) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/websocket');
        this._ws = ws;
        let ready = false;
        ws.onmessage = ev => {
          const m = JSON.parse(ev.data);
          if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
          else if (m.type === 'auth_ok') { ready = true; this._ping(); resolve(); }
          else if (m.type === 'auth_invalid') reject(new AuthError(m.message));
          else if (m.type === 'result' || m.type === 'pong') {
            const p = this._pending.get(m.id);
            if (!p) return;
            this._pending.delete(m.id); clearTimeout(p.timer);
            if (m.type === 'pong' || m.success) p.resolve(m.result);
            else { const e = new Error(m.error && m.error.message || 'Błąd HA'); e.code = m.error && m.error.code; p.reject(e); }
          } else if (m.type === 'event') { const s = this._subs.get(m.id); if (s) s(m.event); }
        };
        ws.onclose = () => {
          clearInterval(this._pinger);
          this._pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('Rozłączono')); });
          this._pending.clear(); this._subs.clear(); this._entitySub = null;
          if (ready) this._retry(); else reject(new Error('Brak połączenia'));
        };
      });
    }

    // Po zaniku Wi-Fi gniazdo potrafi „wisieć”, stąd ping.
    _ping() {
      clearInterval(this._pinger);
      this._pinger = setInterval(() => this.send({ type: 'ping' }, 8000).catch(() => this._ws.close()), 25000);
    }

    send(msg, timeout) {
      return new Promise((resolve, reject) => {
        if (!this._ws || this._ws.readyState !== 1) return reject(new Error('Brak połączenia z HA'));
        const id = ++this._id;
        const timer = setTimeout(() => { this._pending.delete(id); reject(new Error('HA nie odpowiada')); }, timeout || 10000);
        this._pending.set(id, { resolve, reject, timer });
        this._ws.send(JSON.stringify(Object.assign({ id }, msg)));
      });
    }

    async subscribe(msg, cb) {
      const id = this._id + 1;
      this._subs.set(id, cb);
      try { await this.send(msg); } catch (e) { this._subs.delete(id); throw e; }
      return () => { this._subs.delete(id); return this.send({ type: 'unsubscribe_events', subscription: id }).catch(() => {}); };
    }

    // Dla własnego kodu: dowolne polecenia WebSocket jak w hass.callWS / subscribeMessage.
    ws(msg) { return this.send(msg); }
    sub(msg, cb) { return this.subscribe(msg, cb); }

    call(domain, service, data) { return this.send({ type: 'call_service', domain, service, service_data: data || {} }); }

    /** Tylko encje użyte na pulpicie: znacznie mniej ruchu niż pełny frontend HA. */
    async watch(ids) {
      const all = ids === null, list = all ? [] : ids.slice().sort(), sig = all ? '*' : list.join();
      if (this._entitySub && this._entitySub.sig === sig) return;
      const old = this._entitySub, mine = this._entitySub = { sig };
      if (old && old.stop) await old.stop();
      if (!all && !list.length) return;
      const stop = await this.subscribe(all ? { type: 'subscribe_entities' } : { type: 'subscribe_entities', entity_ids: list }, ev => this._apply(ev));
      if (this._entitySub === mine) mine.stop = stop; else await stop();
    }

    _apply(ev) {
      const changed = new Set(), full = ev.a || {}, diff = ev.c || {};
      Object.keys(full).forEach(id => { this.states[id] = { state: full[id].s, attributes: full[id].a || {} }; changed.add(id); });
      Object.keys(diff).forEach(id => {
        const cur = this.states[id] || { state: 'unknown', attributes: {} }, plus = diff[id]['+'] || {};
        const attrs = Object.assign({}, cur.attributes, plus.a || {});
        ((diff[id]['-'] || {}).a || []).forEach(k => delete attrs[k]);
        this.states[id] = { state: plus.s !== undefined ? plus.s : cur.state, attributes: attrs };
        changed.add(id);
      });
      (ev.r || []).forEach(id => { delete this.states[id]; changed.add(id); });
      this.onState(changed);
    }

    forecast(entity, cb) { return this.subscribe({ type: 'weather/subscribe_forecast', forecast_type: 'daily', entity_id: entity }, e => cb(e.forecast || [])); }

    async history(entity, hours) {
      const r = await this.send({
        type: 'history/history_during_period', start_time: new Date(Date.now() - hours * 36e5).toISOString(),
        entity_ids: [entity], minimal_response: true, no_attributes: true, significant_changes_only: false,
      }, 20000);
      return (r[entity] || []).map(p => [(p.lu || p.lc) * 1000, parseFloat(p.s)]).filter(p => !isNaN(p[1]) && !isNaN(p[0]));
    }

    /** Własny go2rtc przez integrację (z dźwiękiem zwrotnym) albo wbudowana obsługa kamer HA. */
    async webrtc(sdp, camera, own) {
      if (own) return (await this.send({ type: 'panelpilot/webrtc', device_id: this.deviceId, sdp }, 15000)).sdp;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Kamera nie odpowiada')), 15000);
        this.subscribe({ type: 'camera/webrtc/offer', entity_id: camera, offer: sdp }, e => {
          if (e.type === 'answer') { clearTimeout(t); resolve(e.answer); }
          else if (e.type === 'error') { clearTimeout(t); reject(new Error(e.message)); }
        }).catch(reject);
      });
    }

    image(id) {
      const p = this.states[id] && this.states[id].attributes.entity_picture;
      return p ? p + (p.includes('?') ? '&' : '?') + 't=' + Date.now() : '';
    }
  }

  /* Podgląd w edytorze: stany podaje edytor, a naciśnięcia nic nie przełączają. */
  class PreviewHA extends HA {
    constructor() { super(); this.preview = true; this.online = true; this.bridge = null; }
    login() {} async logout() {} async connect() {} async watch() {}
    async call() { return null; }
    async forecast(entity, cb) { return this.bridge ? this.bridge.forecast(entity, cb) : () => {}; }
    async history(entity, hours) { return this.bridge ? this.bridge.history(entity, hours) : []; }
    async webrtc() { throw new Error('Podgląd'); }
    async ws(msg) { if (!this.bridge) throw new Error('Podgląd'); return this.bridge.ws(msg); }
    async sub(msg, cb) { return this.bridge ? this.bridge.sub(msg, cb) : () => {}; }
  }

  window.HAClient = HA;
  window.PreviewHAClient = PreviewHA;
})();
