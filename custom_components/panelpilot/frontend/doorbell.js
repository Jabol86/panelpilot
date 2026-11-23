/* Okno domofonu: wyskakuje na dzwonek, obraz i dźwięk przez WebRTC.
   Sygnalizacja idzie przez Home Assistant, więc panel nie potrzebuje dostępu do adresu go2rtc.
   Mikrofon działa w aplikacji (adres localhost jest „bezpieczny”) albo przez https. */
(function () {
  const P = Panel, esc = P.esc;
  let el = null, peer = null, ticker = null, snap = null, endAt = 0, ring = null, talking = false, listening = false;

  P.hooks.push(changed => {
    const d = P.doorbellConfig;
    if (!d.entity || !changed.has(d.entity) || !P.ok(d.entity)) return;
    const s = P.state(d.entity).state;
    // Encje event.* zmieniają znacznik czasu, pozostałe przechodzą na „on”. Pierwszy odczyt nic nie otwiera.
    const hit = /^event\./.test(d.entity) ? ring !== null && s !== ring : s === 'on' && ring !== null && ring !== 'on';
    ring = s;
    if (hit) { open(true); if (d.chime !== false) chime(); }
  });

  function chime() {
    try {
      const a = new AudioContext();
      [[880, 0], [660, 0.35]].forEach(([f, at]) => {
        const o = a.createOscillator(), g = a.createGain();
        o.frequency.value = f; o.connect(g); g.connect(a.destination);
        g.gain.setValueAtTime(0.0001, a.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.4, a.currentTime + at + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + 0.9);
        o.start(a.currentTime + at); o.stop(a.currentTime + at + 1);
      });
      setTimeout(() => a.close(), 2500);
    } catch (e) { /* bez dźwięku */ }
  }

  function open(rang) {
    const d = P.doorbellConfig;
    endAt = Date.now() + (+d.seconds || 60) * 1000;
    if (!P.ha.preview) P.wake();
    if (el) { if (rang) el.classList.add('ringing'); return; }
    P.busy = true;
    el = document.createElement('div');
    el.id = 'bell';
    // Dzwonek (albo podgląd w edytorze) = pulsujący czerwony znacznik „Ktoś dzwoni”.
    if (rang || P.ha.preview) el.classList.add('ringing');
    el.innerHTML = '<div class="bell-video"><video autoplay playsinline muted></video><img alt=""><div class="bell-msg">Łączenie z kamerą…</div>'
      + '<div class="bell-tag"><i></i>Ktoś dzwoni</div><div class="bell-done" hidden></div></div>'
      + '<div class="bell-bar"><div class="bell-title"><b>' + esc(d.name || 'Domofon') + '</b><span id="bell-left"></span></div><div class="bell-actions"></div>'
      + '<div class="bell-audio"><button data-b="listen">' + P.icon('speaker') + '<span>Słuchaj</span></button>' + (d.talk ? '<button data-b="talk">' + P.icon('mic') + '<span>Rozmawiaj</span></button>' : '') + '<button data-b="close">' + P.icon('close') + '<span>Zamknij</span></button></div></div>';
    (d.actions || []).forEach(a => {
      // Przytrzymanie chroni przed przypadkowym otwarciem; „tap” otwiera od razu.
      const tap = a.mode === 'tap', b = document.createElement(tap ? 'button' : 'div');
      b.className = tap ? 'holdable tapnow' : 'holdable';
      b.innerHTML = (tap ? '' : '<i class="fill"></i>') + P.icon(a.icon || 'gate') + '<b>' + esc(a.name) + '</b><span>' + (tap ? 'dotknij' : 'przytrzymaj') + '</span>';
      b._tile = Object.assign({ type: 'hold', done: () => opened(a) }, a);
      if (tap) b.addEventListener('click', () => { if (P.ha.preview) opened(a); else P.trigger(b._tile); });
      el.querySelector('.bell-actions').append(b);
    });
    el.addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b && !P.ha.preview) ({ listen, talk, close })[b.dataset.b](); });
    document.getElementById('root').append(el);
    connect(null);
    ticker = setInterval(() => {
      let left = Math.ceil((endAt - Date.now()) / 1000);
      // W trakcie rozmowy okno nie zamyka się samo.
      if (talking && left < 5 && left > -1) { endAt = Date.now() + 10000; left = 10; }
      if (left <= 0 && !P.ha.preview) return close();
      const s = document.getElementById('bell-left');
      if (s) s.textContent = talking ? 'rozmowa trwa' : 'zamknie się za ' + Math.max(0, left) + ' s';
    }, 500);
  }

  /** Po otwarciu furtki lub bramy okno zostaje jeszcze chwilę z wyraźnym potwierdzeniem. */
  function opened(a) {
    if (!el) return;
    const after = P.doorbellConfig.after == null ? 10 : +P.doorbellConfig.after;
    if (!talking) endAt = Date.now() + Math.max(2, after) * 1000;
    const box = el.querySelector('.bell-done');
    box.innerHTML = P.icon(a.icon || 'gate') + '<b>Otwarto</b><span>' + esc(a.name || P.name(a.entity)) + '</span>';
    box.hidden = false;
    el.classList.add('opened');
    clearTimeout(box._t);
    box._t = setTimeout(() => { box.hidden = true; }, Math.max(2, Math.min(after, 6)) * 1000);
  }

  function close() {
    if (!el) return;
    clearInterval(ticker); clearInterval(snap);
    talking = listening = false;
    disconnect();
    el.remove(); el = null;
    P.busy = false;
    if (!P.ha.preview) P.wake();
  }

  function msg(t) { const m = el && el.querySelector('.bell-msg'); if (m) { m.textContent = t; m.hidden = !t; } }

  function disconnect() {
    if (!peer) return;
    const p = peer; peer = null;
    clearTimeout(p.timer);
    p.pc.close();
    if (p.mic) p.mic.getTracks().forEach(t => t.stop());
  }

  async function connect(mic) {
    const d = P.doorbellConfig;
    disconnect();
    if (P.ha.preview || !window.RTCPeerConnection || !(d.own || DP.isEntity(d.camera))) {
      if (mic) mic.getTracks().forEach(t => t.stop());
      return snapshots(P.ha.preview ? 'Podgląd' : '');
    }
    const pc = new RTCPeerConnection(), me = peer = { pc, mic }, video = el.querySelector('video'), media = new MediaStream();
    const fail = e => {
      if (me !== peer || !el) return;
      console.warn('domofon', e);
      disconnect(); stopTalk(); snapshots('Obraz zastępczy (brak połączenia na żywo)');
    };
    pc.ontrack = e => { media.addTrack(e.track); video.srcObject = media; };
    pc.onconnectionstatechange = () => {
      if (me !== peer) return;
      if (pc.connectionState === 'connected') { clearTimeout(me.timer); clearInterval(snap); el.classList.add('live'); msg(''); }
      if (pc.connectionState === 'failed') fail('połączenie zerwane');
    };
    me.timer = setTimeout(() => fail('brak odpowiedzi'), 15000);
    try {
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
      if (mic) mic.getAudioTracks().forEach(t => pc.addTransceiver(t, { direction: 'sendonly' }));
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const sdp = await P.ha.webrtc(pc.localDescription.sdp, d.camera, !!d.own);
      if (me === peer) await pc.setRemoteDescription({ type: 'answer', sdp });
    } catch (e) { fail(e); }
  }

  const gathered = pc => new Promise(done => {
    if (pc.iceGatheringState === 'complete') return done();
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && done());
    setTimeout(done, 1500);
  });

  // Zapas, gdy WebRTC nie działa: zdjęcia z kamery przez HA.
  function snapshots(text) {
    if (!el) return;
    el.classList.remove('live');
    msg(text);
    clearInterval(snap);
    const load = () => { const src = P.ha.image(P.doorbellConfig.camera); if (src && el) el.querySelector('img').src = src; };
    load();
    snap = setInterval(load, 1500);
  }

  function mark(name, on, text) {
    const b = el && el.querySelector('[data-b=' + name + ']');
    if (b) { b.classList.toggle('active', on); b.querySelector('span').textContent = text; }
  }
  function setListen(v) {
    listening = v;
    const video = el && el.querySelector('video');
    if (video) { video.muted = !v; if (v && video.srcObject) video.play().catch(() => {}); }
    mark('listen', v, v ? 'Wycisz' : 'Słuchaj');
  }
  const listen = () => setListen(!listening);

  async function talk() {
    if (talking) { stopTalk(); connect(null); return; }
    if (!navigator.mediaDevices) return P.toast('Mikrofon działa w aplikacji PanelPilot albo przez https', true);
    let mic;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { return P.toast('Brak dostępu do mikrofonu', true); }
    if (!el) return mic.getTracks().forEach(t => t.stop());
    talking = true;
    connect(mic);
    setListen(true);
    mark('talk', true, 'Zakończ');
  }
  function stopTalk() { talking = false; mark('talk', false, 'Rozmawiaj'); }

  P.doorbell = { open, close };
})();
