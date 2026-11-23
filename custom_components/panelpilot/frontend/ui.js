/* Drobne klocki interfejsu edytora. */
export const clone = o => JSON.parse(JSON.stringify(o));
export const uid = () => Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v == null || v === false) return;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'value' && !k.includes('-')) el[k] = v;
    else if (k !== 'value') el.setAttribute(k, v);
  });
  el.append(...kids.flat(9).filter(k => k != null && k !== false));
  // Wartość na końcu: zakres suwaka (min/max) i opcje listy muszą już istnieć.
  if (props && props.value != null) el.value = props.value;
  return el;
}
export const field = (label, ...c) => h('label', { class: 'f' }, h('span', {}, label), ...c);
export const group = (label, ...c) => h('div', { class: 'f' }, h('span', {}, label), ...c);
export const check = (label, value, fn) => h('label', { class: 'f chk' }, h('input', { type: 'checkbox', checked: !!value, onchange: e => fn(e.target.checked) }), h('span', {}, label));
export const text = (value, fn, props) => h('input', Object.assign({ value: value == null ? '' : value, oninput: e => fn(e.target.value) }, props));
export const select = (value, options, fn) => h('select', { value, onchange: e => fn(e.target.value) }, options.map(o => h('option', { value: o[0] }, o[1])));
