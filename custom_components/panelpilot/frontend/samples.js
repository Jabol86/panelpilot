/* Przykłady wstawiane w edytorze. */
export const SAMPLE = {
  html: `<main>
  <h1 id="clock"></h1>
  <section>
    <p>Na zewnątrz</p>
    <b data-text="sensor.temperatura_zewnetrzna"></b>
  </section>
  <button data-toggle="light.salon" data-state="light.salon">Salon</button>
</main>`,
  css: `main { height: 100%; display: grid; gap: 16px; place-content: center; text-align: center; background: #101820; color: #fff; font-size: 24px; }
h1 { margin: 0; font-size: 96px; font-weight: 200; }
button { font: inherit; padding: 18px 40px; border: 0; border-radius: 16px; background: #223040; color: #fff; }
button.is-on { background: #f2b84b; color: #201500; }`,
  js: `const clock = root.querySelector('#clock');
const tick = () => clock.textContent = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
tick();
const timer = setInterval(tick, 1000);

// Każda zmiana stanu z WebSocketu HA:
panel.onState((hass, zmienione) => {
  // hass.states['sensor.x'].state
});

// Bezpośredni WebSocket:
// hass.callWS({ type: 'get_config' }).then(dane => console.log(dane));

return () => clearInterval(timer);   // sprzątanie przy zmianie pulpitu`,
  widget: `Panel.widget('moj_kafelek', {
  name: 'Mój kafelek', icon: 'gauge', group: 'Własne', size: [2, 1],
  fields: [{ k: 'entity', l: 'Encja', t: 'entity' }],
  html: t => Panel.icon('gauge') + '<div class="tx"><div class="val">' + Panel.value(t.entity) + '</div><div class="lbl">' + Panel.esc(t.name || '') + '</div></div>',
  tap: t => Panel.toast('Dotknięto ' + t.entity),
});`,
};
