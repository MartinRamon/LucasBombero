'use strict';

// Orden fijo de los botones de respuesta.
const PARQUES = ['Norte', 'Sur', 'Oeste', 'Campanar', 'Saler'];
const STORE_KEY = 'lucasbombero.v1';

const $ = (sel) => document.querySelector(sel);
const state = {
  data: null,
  zonas: [],
  calles: [],
  quiz: null,   // { preguntas, i, aciertos, respuestas }
  map: null,
};

// ---------- Persistencia (solo en este navegador) ----------
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.seen && s.fails) return s;
  } catch (e) { /* almacenamiento no disponible */ }
  return { seen: {}, fails: {}, asked: 0, correct: 0 };
}
function saveStore(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* ignorar */ }
}
let store = loadStore();

// ---------- Utilidades ----------
const LOWER = new Set(['DE', 'DEL', 'DELS', 'LA', 'LES', 'EL', 'ELS', 'LO', 'I', 'Y', 'A', 'AL', 'EN', 'PER', 'LOS', 'LAS']);
function prettyName(raw) {
  return raw.toLowerCase().split(/(\s+|-|\(|\))/).map((w, idx) => {
    if (!w.trim() || /^[-()]$/.test(w)) return w;
    if (idx > 0 && LOWER.has(w.toUpperCase())) return w;
    // D'ALCEDO / L'ESTACIÓ -> d'Alcedo / l'Estació
    const m = w.match(/^([dl])['´’](.+)$/i);
    if (m) return (idx > 0 ? m[1].toLowerCase() : m[1].toUpperCase()) + "'" + m[2].charAt(0).toUpperCase() + m[2].slice(1);
    if (/^[ivxlc]+$/i.test(w) && w.length <= 4 && w !== 'i') return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const randInt = (n) => Math.floor(Math.random() * n);
const zonaLabel = (z) => `Parque ${z.parque} · Coopera ${z.coopera}`;

// Zonas en las que puede caer una calle.
function zonasDeCalle(c) {
  return c.t ? [...new Set(c.t.map((t) => t[2]))] : [c.z];
}
// Zona(s) que corresponden a un número de portal concreto.
function zonasDeNumero(c, num) {
  return [...new Set(c.t.filter(([a, b]) => num >= a && num <= b && (num - a) % 2 === 0).map((t) => t[2]))];
}

// ---------- Generación de preguntas ----------
function crearPregunta(c, parquesFiltro) {
  if (!c.t) return { calle: c, numero: null, zona: c.z };
  const tramos = c.t.filter((t) => parquesFiltro.has(state.zonas[t[2]].parque));
  for (let intento = 0; intento < 40; intento++) {
    const [a, b] = tramos[randInt(tramos.length)];
    const num = a + 2 * randInt(Math.floor((b - a) / 2) + 1);
    const zs = zonasDeNumero(c, num);
    if (zs.length === 1) return { calle: c, numero: num, zona: zs[0] };
  }
  return null; // numeración ambigua en los datos: se descarta
}

function seleccionarCalles(n, modo, parquesFiltro) {
  const elegibles = state.calles.filter((c) => zonasDeCalle(c).some((z) => parquesFiltro.has(state.zonas[z].parque)));
  let orden;
  if (modo === 'fallos') {
    orden = shuffle(elegibles.filter((c) => store.fails[c.id]));
  } else {
    const nuevas = shuffle(elegibles.filter((c) => !store.seen[c.id]));
    const vistas = shuffle(elegibles.filter((c) => store.seen[c.id]));
    orden = nuevas.concat(vistas);
  }
  const preguntas = [];
  for (const c of orden) {
    if (preguntas.length >= n) break;
    const p = crearPregunta(c, parquesFiltro);
    if (p) preguntas.push(p);
  }
  return preguntas;
}

// ---------- Vistas ----------
function show(view) {
  for (const v of ['home', 'quiz', 'result']) $(`#view-${v}`).hidden = v !== view;
  $('#btn-home').hidden = view === 'home';
  window.scrollTo(0, 0);
}

function renderHome() {
  const nFails = Object.keys(store.fails).length;
  $('#fail-count').textContent = `(${nFails})`;
  const failRadio = document.querySelector('input[name=mode][value=fallos]');
  failRadio.disabled = nFails === 0;
  if (nFails === 0 && failRadio.checked) document.querySelector('input[name=mode][value=nuevas]').checked = true;

  const total = state.calles.length;
  const vistas = state.calles.filter((c) => store.seen[c.id]).length;
  const pct = total ? Math.round((vistas / total) * 100) : 0;
  const acierto = store.asked ? Math.round((store.correct / store.asked) * 100) : null;
  $('#progress').innerHTML =
    `<div><strong>${vistas}</strong> de ${total} calles preguntadas (${pct} %)` +
    (acierto !== null ? ` · acierto global ${acierto} %` : '') + `</div>` +
    `<div class="progress-bar"><div style="width:${pct}%"></div></div>`;
  show('home');
}

function renderOptions(container, name) {
  container.innerHTML = '';
  for (const p of PARQUES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.textContent = p;
    b.dataset.value = p;
    b.addEventListener('click', () => {
      if (state.quiz.corregida) return;
      container.querySelectorAll('.opt').forEach((o) => o.classList.toggle('selected', o === b));
      state.quiz.sel[name] = p;
      $('#btn-check').disabled = !(state.quiz.sel.parque && state.quiz.sel.coopera);
    });
    container.appendChild(b);
  }
}

function renderPregunta() {
  const q = state.quiz;
  const p = q.preguntas[q.i];
  q.sel = { parque: null, coopera: null };
  q.corregida = false;
  $('#q-counter').textContent = `Pregunta ${q.i + 1} de ${q.preguntas.length}`;
  $('#q-score').textContent = `Aciertos: ${q.aciertos}`;
  $('#q-street').textContent = prettyName(p.calle.n);
  $('#q-number').hidden = p.numero === null;
  $('#q-number').textContent = p.numero !== null ? `nº ${p.numero}` : '';
  $('#q-alt').textContent = p.calle.alt ? `(${prettyName(p.calle.alt)})` : '';
  renderOptions($('#ans-parque'), 'parque');
  renderOptions($('#ans-coopera'), 'coopera');
  $('#btn-check').disabled = true;
  $('#btn-check').hidden = false;
  $('#feedback').hidden = true;
  show('quiz');
}

function marcar(container, elegido, correcto) {
  container.querySelectorAll('.opt').forEach((o) => {
    o.classList.remove('selected');
    if (o.dataset.value === correcto) o.classList.add('correct');
    else if (o.dataset.value === elegido) o.classList.add('wrong');
  });
}

function comprobar() {
  const q = state.quiz;
  const p = q.preguntas[q.i];
  const z = state.zonas[p.zona];
  const okParque = q.sel.parque === z.parque;
  const okCoopera = q.sel.coopera === z.coopera;
  const ok = okParque && okCoopera;
  q.corregida = true;
  if (ok) q.aciertos++;
  q.respuestas.push({ p, sel: { ...q.sel }, ok });

  store.seen[p.calle.id] = 1;
  store.asked++;
  if (ok) { store.correct++; delete store.fails[p.calle.id]; } else { store.fails[p.calle.id] = (store.fails[p.calle.id] || 0) + 1; }
  saveStore(store);

  marcar($('#ans-parque'), q.sel.parque, z.parque);
  marcar($('#ans-coopera'), q.sel.coopera, z.coopera);
  $('#btn-check').hidden = true;
  $('#q-score').textContent = `Aciertos: ${q.aciertos}`;

  const fb = $('#feedback');
  fb.className = `card feedback ${ok ? 'ok' : 'ko'}`;
  $('#fb-title').textContent = ok ? 'Correcto' : 'Incorrecto';
  $('#fb-detail').innerHTML = `<strong>${zonaLabel(z)}</strong><br><span class="muted small">Zona «${z.zona}»</span>`;
  $('#fb-tramos').innerHTML = p.calle.t ? tablaTramos(p) : '';
  $('#btn-next').textContent = q.i + 1 < q.preguntas.length ? 'Siguiente' : 'Ver resultado';
  fb.hidden = false;
  pintarMapa(p);
  fb.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function tablaTramos(p) {
  const filas = [...p.calle.t].sort((x, y) => (x[0] % 2) - (y[0] % 2) || x[0] - y[0]).map(([a, b, zi]) => {
    const z = state.zonas[zi];
    const hit = p.numero >= a && p.numero <= b && (p.numero - a) % 2 === 0;
    const lado = a % 2 ? 'impares' : 'pares';
    const rango = a === b ? `${a}` : `${a}–${b}`;
    return `<tr class="${hit ? 'hit' : ''}"><td>${rango} <span class="muted">(${lado})</span></td><td>${z.parque}</td><td>${z.coopera}</td></tr>`;
  }).join('');
  return `<div class="small muted">Esta calle cambia de zona según el número:</div>` +
    `<table class="tramos"><thead><tr><th>Números</th><th>Parque</th><th>Coopera</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function pintarMapa(p) {
  if (typeof L === 'undefined') { $('#map').hidden = true; return; }
  if (!state.map) {
    state.map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(state.map);
    state.capa = L.layerGroup().addTo(state.map);
  }
  state.capa.clearLayers();
  state.zonas.forEach((z, idx) => {
    const activa = idx === p.zona;
    L.polygon(z.g.map((ring) => ring.map(([x, y]) => [y, x])), {
      color: activa ? '#b3261e' : '#555',
      weight: activa ? 2 : 1,
      fillOpacity: activa ? 0.18 : 0.03,
      interactive: false,
    }).addTo(state.capa);
  });
  const linea = L.polyline(p.calle.g.map((l) => l.map(([x, y]) => [y, x])), { color: '#0b57d0', weight: 6 }).addTo(state.capa);
  setTimeout(() => {
    state.map.invalidateSize();
    state.map.fitBounds(linea.getBounds(), { padding: [30, 30], maxZoom: 16 });
  }, 50);
}

function siguiente() {
  const q = state.quiz;
  q.i++;
  if (q.i < q.preguntas.length) renderPregunta();
  else renderResultado();
}

function renderResultado() {
  const q = state.quiz;
  const n = q.preguntas.length;
  $('#r-score').textContent = `${q.aciertos} / ${n}`;
  const soloParque = q.respuestas.filter((r) => !r.ok && r.sel.parque === state.zonas[r.p.zona].parque).length;
  $('#r-detail').textContent = soloParque ? `En ${soloParque} de las falladas acertaste el parque pero no el que coopera.` : '';
  $('#r-list').innerHTML = q.respuestas.map((r) => {
    const z = state.zonas[r.p.zona];
    const nombre = prettyName(r.p.calle.n) + (r.p.numero !== null ? `, ${r.p.numero}` : '');
    const tu = r.ok ? '' : `<br><span class="muted small">Tu respuesta: ${r.sel.parque} / ${r.sel.coopera}</span>`;
    return `<li><span class="${r.ok ? 'ok' : 'ko'}">${r.ok ? '✓' : '✗'}</span> ${nombre}<br>${zonaLabel(z)}${tu}</li>`;
  }).join('');
  $('#btn-retry').hidden = q.aciertos === n;
  show('result');
}

function empezar(preguntas) {
  if (!preguntas.length) {
    alert('No hay calles que cumplan esos filtros.');
    return;
  }
  state.quiz = { preguntas, i: 0, aciertos: 0, respuestas: [] };
  renderPregunta();
}

function filtroParques() {
  return new Set([...document.querySelectorAll('#opt-zones input:checked')].map((i) => i.value));
}

// ---------- Arranque ----------
async function init() {
  const res = await fetch('data/calles.json');
  state.data = await res.json();
  state.zonas = state.data.zonas;
  state.calles = state.data.calles;

  $('#opt-zones').innerHTML = PARQUES.map((p) =>
    `<label class="chip"><input type="checkbox" value="${p}" checked> ${p}</label>`).join('');
  $('#sources').innerHTML =
    `Datos: ${state.data.fuentes.zonas}; ${state.data.fuentes.calles}. Generado el ${state.data.generado}. ` +
    `${state.calles.length} calles; ${state.data.excluidas.length} excluidas (puentes, autovías y vías sin numeración repartidas entre varias zonas).`;

  $('#btn-start').addEventListener('click', () => {
    const n = parseInt($('#opt-size').value, 10);
    const modo = document.querySelector('input[name=mode]:checked').value;
    const filtro = filtroParques();
    if (!filtro.size) { alert('Marca al menos un parque.'); return; }
    empezar(seleccionarCalles(n, modo, filtro));
  });
  $('#btn-check').addEventListener('click', comprobar);
  $('#btn-next').addEventListener('click', siguiente);
  $('#btn-home').addEventListener('click', renderHome);
  $('#btn-again').addEventListener('click', renderHome);
  $('#btn-retry').addEventListener('click', () => {
    empezar(shuffle(state.quiz.respuestas.filter((r) => !r.ok).map((r) => r.p)));
  });
  renderHome();
}

init().catch((e) => {
  document.querySelector('main').innerHTML = `<div class="card">No se han podido cargar los datos (${e.message}).</div>`;
});
