'use strict';

// Orden fijo de los botones de respuesta.
const PARQUES = ['Norte', 'Sur', 'Oeste', 'Campanar', 'Saler'];
const STORE_KEY = 'lucasbombero.v1';
const PREFS_KEY = 'lucasbombero.prefs';
// Tipos de vía del callejero municipal (el más largo primero para que «CAMÍ VELL» gane a «CAMÍ»).
const TIPOS_VIA = ['CAMÍ FONDO', 'CAMÍ VELL', 'CAMÍ NOU', 'GRAN VIA', 'CARRERÓ', 'CARRETERA', 'CARRERA', 'CARRER',
  'AVINGUDA', 'PLAÇA', 'CAMÍ', 'ENTRADOR', 'LLOC', 'PASSEIG', 'PASSATGE', 'PASSAGE', 'SENDA', 'PARTIDA', 'BARRI',
  'GRUP', 'TRAVESSERA', 'C/'];

const $ = (sel) => document.querySelector(sel);
const state = { data: null, zonas: [], calles: [], quiz: null, map: null };

// ---------- Persistencia (solo en este navegador) ----------
function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? v : fallback;
  } catch (e) { return fallback; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* almacenamiento no disponible */ }
}
let store = readJSON(STORE_KEY, null);
if (!store || !store.seen || !store.fails) store = { seen: {}, fails: {}, asked: 0, correct: 0 };
store.best = store.best || 0;
const prefs = Object.assign({ size: 10, parks: PARQUES.slice() }, readJSON(PREFS_KEY, {}));

// ---------- Utilidades ----------
const LOWER = new Set(['DE', 'DEL', 'DELS', 'LA', 'LES', 'EL', 'ELS', 'LO', 'I', 'Y', 'A', 'AL', 'EN', 'PER', 'LOS', 'LAS']);
function prettyName(raw) {
  return raw.toLowerCase().split(/(\s+|-|\(|\))/).map((w, idx) => {
    if (!w.trim() || /^[-()]$/.test(w)) return w;
    if (idx > 0 && LOWER.has(w.toUpperCase())) return w;
    const m = w.match(/^([dl])['´’](.+)$/i); // D'ALCEDO -> d'Alcedo
    if (m) return (idx > 0 ? m[1].toLowerCase() : m[1].toUpperCase()) + "'" + m[2].charAt(0).toUpperCase() + m[2].slice(1);
    if (/^[ivxlc]+$/i.test(w) && w.length <= 4 && w !== 'i') return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join('');
}
// «AVINGUDA PÉREZ GALDÓS» -> { tipo: 'Avinguda', nombre: 'Pérez Galdós' }
function splitNombre(raw) {
  const up = raw.trim();
  for (const t of TIPOS_VIA) {
    if (up.startsWith(t + ' ')) {
      return { tipo: t === 'C/' ? 'Carrer' : prettyName(t), nombre: prettyName(up.slice(t.length + 1)) };
    }
  }
  return { tipo: '', nombre: prettyName(up) };
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const randInt = (n) => Math.floor(Math.random() * n);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const parkVar = (p) => `--pc: var(--p-${p.toLowerCase()})`;
const parkColor = (p) => getComputedStyle(document.documentElement).getPropertyValue(`--p-${p.toLowerCase()}`).trim();
const pill = (p, label) => `<span class="pill" style="${parkVar(p)}"><span class="dot"></span>${label ? `<small>${label}</small>` : ''}${esc(p)}</span>`;
const vibrate = (pattern) => { try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) { /* no soportado */ } };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

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

function elegibles(parquesFiltro) {
  return state.calles.filter((c) => zonasDeCalle(c).some((z) => parquesFiltro.has(state.zonas[z].parque)));
}

function seleccionarCalles(n, modo, parquesFiltro) {
  const pool = elegibles(parquesFiltro);
  let orden;
  if (modo === 'fallos') {
    orden = shuffle(pool.filter((c) => store.fails[c.id]));
  } else {
    const nuevas = shuffle(pool.filter((c) => !store.seen[c.id]));
    const vistas = shuffle(pool.filter((c) => store.seen[c.id]));
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

// ---------- Navegación ----------
function show(view) {
  for (const v of ['home', 'quiz', 'result']) $(`#view-${v}`).hidden = v !== view;
  $('#btn-home').hidden = view === 'home';
  $('#bottom-bar').hidden = true;
  $('#top-right').textContent = '';
  window.scrollTo(0, 0);
}

function salirAlInicio() {
  const q = state.quiz;
  const enCurso = q && !$('#view-quiz').hidden && q.respuestas.length > 0 && q.respuestas.length < q.preguntas.length;
  if (enCurso && !confirm('¿Salir de la tanda? Lo que ya has respondido queda guardado.')) return;
  renderHome();
}

// ---------- Inicio ----------
function renderHome() {
  const filtro = new Set(prefs.parks);
  const pool = elegibles(filtro);
  const total = state.calles.length;
  const vistas = state.calles.filter((c) => store.seen[c.id]).length;
  const pct = total ? Math.round((vistas / total) * 100) : 0;
  const acierto = store.asked ? Math.round((store.correct / store.asked) * 100) : null;
  const nFails = Object.keys(store.fails).length;

  $('#stats').innerHTML = `
    <div class="stat"><div class="stat-value">${vistas}</div><div class="stat-label">de ${total} calles vistas</div>
      <div class="stat-bar"><div style="width:${pct}%"></div></div></div>
    <div class="stat"><div class="stat-value">${acierto === null ? '–' : acierto + '%'}</div><div class="stat-label">de acierto</div></div>
    <div class="stat"><div class="stat-value">${store.best}</div><div class="stat-label">mejor racha</div></div>`;

  $('#btn-start').textContent = vistas === 0 ? `Empezar · ${prefs.size} calles` : `Nueva tanda · ${prefs.size} calles`;
  $('#btn-start').disabled = pool.length === 0;
  const fb = $('#btn-fails');
  fb.hidden = nFails === 0;
  fb.innerHTML = `Repasar mis fallos <span class="count">${nFails}</span>`;

  // Opciones
  document.querySelectorAll('#opt-size button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.value) === prefs.size)));
  $('#opt-parks').innerHTML = PARQUES.map((p) =>
    `<button type="button" class="park-toggle" style="${parkVar(p)}" data-park="${p}" aria-pressed="${filtro.has(p)}"><span class="dot"></span>${p}</button>`).join('');
  $('#options-summary').textContent = `${prefs.size} calles · ${filtro.size === PARQUES.length ? 'todos los parques' : [...filtro].join(', ')}`;
  show('home');
}

function empezar(preguntas) {
  if (!preguntas.length) { toast('No hay calles con esos filtros.'); return; }
  state.quiz = { preguntas, i: 0, aciertos: 0, racha: 0, respuestas: [] };
  renderPregunta();
}

// ---------- Pregunta ----------
function renderParkButtons(container, step) {
  container.innerHTML = PARQUES.map((p, i) =>
    `<button type="button" class="park" style="${parkVar(p)}" data-value="${p}"><span class="dot"></span>${p}<kbd>${i + 1}</kbd></button>`).join('');
  container.querySelectorAll('.park').forEach((b) => b.addEventListener('click', () => elegir(step, b.dataset.value)));
}

function renderPregunta() {
  const q = state.quiz;
  const p = q.preguntas[q.i];
  q.sel = { parque: null, coopera: null };
  q.corregida = false;
  show('quiz');

  $('#q-progress').innerHTML = q.preguntas.map((_, i) => {
    const r = q.respuestas[i];
    return `<span class="${r ? (r.ok ? 'ok' : 'ko') : i === q.i ? 'cur' : ''}"></span>`;
  }).join('');
  $('#q-counter').textContent = `${q.i + 1} de ${q.preguntas.length}`;
  $('#top-right').textContent = `${q.aciertos} ✓`;
  $('#q-streak').hidden = q.racha < 3;
  $('#q-streak').textContent = `Racha de ${q.racha}`;

  const { tipo, nombre } = splitNombre(p.calle.n);
  $('#q-type').textContent = tipo;
  $('#q-street').textContent = nombre;
  $('#q-number').hidden = p.numero === null;
  $('#q-number').textContent = p.numero !== null ? `nº ${p.numero}` : '';
  $('#q-alt').textContent = p.calle.alt ? prettyName(p.calle.alt) : '';
  const card = $('#street-card');
  card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');

  renderParkButtons($('#ans-parque'), 'parque');
  renderParkButtons($('#ans-coopera'), 'coopera');
  $('#step-parque').className = 'step';
  $('#step-coopera').className = 'step dim';
  $('#feedback').hidden = true;
}

// Paso 1: parque. Paso 2: coopera (se corrige al elegirlo).
function elegir(step, value) {
  const q = state.quiz;
  if (!q || q.corregida) return;
  if (step === 'coopera' && !q.sel.parque) { step = 'parque'; }
  if (step === 'coopera' && value === q.sel.parque) return;
  q.sel[step] = value;
  document.querySelectorAll(`#ans-${step} .park`).forEach((b) => b.classList.toggle('selected', b.dataset.value === value));
  if (step === 'parque') {
    q.sel.coopera = null;
    $('#step-parque').className = 'step done';
    $('#step-coopera').className = 'step';
    // Un parque no coopera consigo mismo.
    document.querySelectorAll('#ans-coopera .park').forEach((b) => {
      b.classList.remove('selected');
      b.disabled = b.dataset.value === value;
    });
    vibrate(8);
  } else {
    $('#step-coopera').className = 'step done';
    comprobar();
  }
}

function marcar(container, elegido, correcto) {
  container.querySelectorAll('.park').forEach((o) => {
    o.classList.remove('selected');
    o.disabled = true;
    if (o.dataset.value === correcto) o.classList.add('correct');
    else if (o.dataset.value === elegido) o.classList.add('wrong');
  });
}

const ICON_OK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_KO = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function comprobar() {
  const q = state.quiz;
  const p = q.preguntas[q.i];
  const z = state.zonas[p.zona];
  const ok = q.sel.parque === z.parque && q.sel.coopera === z.coopera;
  q.corregida = true;
  if (ok) { q.aciertos++; q.racha++; } else { q.racha = 0; }
  q.respuestas.push({ p, sel: { ...q.sel }, ok });

  store.seen[p.calle.id] = 1;
  store.asked++;
  if (ok) { store.correct++; delete store.fails[p.calle.id]; } else { store.fails[p.calle.id] = (store.fails[p.calle.id] || 0) + 1; }
  store.best = Math.max(store.best, q.racha);
  writeJSON(STORE_KEY, store);

  marcar($('#ans-parque'), q.sel.parque, z.parque);
  marcar($('#ans-coopera'), q.sel.coopera, z.coopera);
  $('#q-progress').children[q.i].className = ok ? 'ok' : 'ko';
  $('#top-right').textContent = `${q.aciertos} ✓`;
  $('#q-streak').hidden = q.racha < 3;
  $('#q-streak').textContent = `Racha de ${q.racha}`;

  const fb = $('#feedback');
  fb.className = `feedback ${ok ? 'ok' : 'ko shake'}`;
  $('#fb-icon').innerHTML = ok ? ICON_OK : ICON_KO;
  $('#fb-title').textContent = ok ? (q.racha >= 3 ? `¡Correcto! Racha de ${q.racha}` : '¡Correcto!') : 'No es así';
  $('#fb-answer').innerHTML = pill(z.parque, 'Parque ') + pill(z.coopera, 'Coopera ');
  $('#fb-tramos').innerHTML = p.calle.t ? tablaTramos(p) : '';
  fb.hidden = false;
  vibrate(ok ? 15 : [60, 40, 60]);

  $('#btn-next').textContent = q.i + 1 < q.preguntas.length ? 'Siguiente' : 'Ver resultado';
  $('#bottom-bar').hidden = false;
  pintarMapa(p);
  requestAnimationFrame(() => fb.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function tablaTramos(p) {
  const filas = [...p.calle.t].sort((x, y) => (x[0] % 2) - (y[0] % 2) || x[0] - y[0]).map(([a, b, zi]) => {
    const z = state.zonas[zi];
    const hit = p.numero >= a && p.numero <= b && (p.numero - a) % 2 === 0;
    const rango = a === b ? `${a}` : `${a}–${b}`;
    return `<tr class="${hit ? 'hit' : ''}"><td>${rango} <span class="muted">${a % 2 ? 'impares' : 'pares'}</span></td>` +
      `<td><span class="dot" style="${parkVar(z.parque)}"></span>${z.parque}</td>` +
      `<td><span class="dot" style="${parkVar(z.coopera)}"></span>${z.coopera}</td></tr>`;
  }).join('');
  return `<div class="tramos-title">Esta calle cambia de zona según el número:</div>` +
    `<table class="tramos"><thead><tr><th>Números</th><th>Parque</th><th>Coopera</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function pintarMapa(p) {
  if (typeof L === 'undefined') { $('#map').hidden = true; $('#map-legend').hidden = true; return; }
  if (!state.map) {
    state.map = L.map('map', { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(state.map);
    state.capa = L.layerGroup().addTo(state.map);
  }
  state.capa.clearLayers();
  state.zonas.forEach((z, idx) => {
    const activa = idx === p.zona;
    const col = parkColor(z.parque);
    L.polygon(z.g.map((ring) => ring.map(([x, y]) => [y, x])), {
      color: col, weight: activa ? 3 : 1, opacity: activa ? 1 : 0.5,
      fillColor: col, fillOpacity: activa ? 0.25 : 0.06, interactive: false,
    }).addTo(state.capa);
  });
  const linea = L.polyline(p.calle.g.map((l) => l.map(([x, y]) => [y, x])), { color: '#0b57d0', weight: 7, opacity: 0.95 }).addTo(state.capa);
  const z = state.zonas[p.zona];
  $('#map-legend').innerHTML = `<span><span class="line"></span>La calle</span>` +
    `<span><span class="dot" style="${parkVar(z.parque)}"></span>Zona «${esc(z.zona)}»</span>`;
  setTimeout(() => {
    state.map.invalidateSize();
    state.map.fitBounds(linea.getBounds(), { padding: [28, 28], maxZoom: 15 });
  }, 60);
}

function siguiente() {
  const q = state.quiz;
  if (!q || !q.corregida) return;
  q.i++;
  if (q.i < q.preguntas.length) renderPregunta();
  else renderResultado();
}

// ---------- Resultado ----------
function renderResultado() {
  const q = state.quiz;
  const n = q.preguntas.length;
  const pct = Math.round((q.aciertos / n) * 100);
  show('result');

  const R = 62, C = 2 * Math.PI * R;
  $('#r-ring').innerHTML =
    `<svg viewBox="0 0 150 150"><circle class="track" cx="75" cy="75" r="${R}"/>` +
    `<circle class="val" cx="75" cy="75" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>` +
    `<div class="label"><div>${q.aciertos}/${n}<small>${pct}%</small></div></div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $('#r-ring .val').style.strokeDashoffset = String(C * (1 - q.aciertos / n));
  }));
  $('#r-title').textContent = pct === 100 ? '¡Tanda perfecta!' : pct >= 80 ? '¡Muy bien!' : pct >= 50 ? 'Vas bien, a seguir' : 'Toca repasar';
  const soloParque = q.respuestas.filter((r) => !r.ok && r.sel.parque === state.zonas[r.p.zona].parque).length;
  $('#r-detail').textContent = soloParque ? `En ${soloParque} de las falladas acertaste el parque pero no el que coopera.` : '';

  $('#r-list').innerHTML = q.respuestas.map((r) => {
    const z = state.zonas[r.p.zona];
    const nombre = prettyName(r.p.calle.n) + (r.p.numero !== null ? `, ${r.p.numero}` : '');
    const tu = r.ok ? '' : `<div class="yours">Marcaste: ${esc(r.sel.parque)} / ${esc(r.sel.coopera)}</div>`;
    return `<li><span class="mark ${r.ok ? 'ok' : 'ko'}">${r.ok ? '✓' : '✗'}</span><div>` +
      `<div class="rname">${esc(nombre)}</div><div class="ranswer">${pill(z.parque, 'Parque ')}${pill(z.coopera, 'Coopera ')}</div>${tu}</div></li>`;
  }).join('');
  $('#btn-retry').hidden = q.aciertos === n;
  $('#btn-again').className = q.aciertos === n ? 'btn btn-primary btn-lg' : 'btn btn-tonal btn-lg';
}

// ---------- Arranque ----------
function bind() {
  $('#btn-start').addEventListener('click', () => empezar(seleccionarCalles(prefs.size, 'nuevas', new Set(prefs.parks))));
  $('#btn-fails').addEventListener('click', () => empezar(seleccionarCalles(prefs.size, 'fallos', new Set(prefs.parks))));
  $('#btn-next').addEventListener('click', siguiente);
  $('#btn-home').addEventListener('click', salirAlInicio);
  $('#btn-home2').addEventListener('click', renderHome);
  $('#btn-again').addEventListener('click', () => empezar(seleccionarCalles(prefs.size, 'nuevas', new Set(prefs.parks))));
  $('#btn-retry').addEventListener('click', () => empezar(shuffle(state.quiz.respuestas.filter((r) => !r.ok).map((r) => r.p))));

  $('#opt-size').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    prefs.size = Number(b.dataset.value);
    writeJSON(PREFS_KEY, prefs);
    renderHome();
    $('#options').open = true;
  });
  $('#opt-parks').addEventListener('click', (e) => {
    const b = e.target.closest('.park-toggle');
    if (!b) return;
    const set = new Set(prefs.parks);
    if (set.has(b.dataset.park)) {
      if (set.size === 1) { toast('Deja al menos un parque.'); return; }
      set.delete(b.dataset.park);
    } else set.add(b.dataset.park);
    prefs.parks = PARQUES.filter((p) => set.has(p));
    writeJSON(PREFS_KEY, prefs);
    renderHome();
    $('#options').open = true;
  });
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('¿Borrar tu progreso (calles vistas, fallos y estadísticas)?')) return;
    store = { seen: {}, fails: {}, asked: 0, correct: 0, best: 0 };
    writeJSON(STORE_KEY, store);
    renderHome();
    toast('Progreso borrado');
  });

  // Teclado (ordenador): 1-5 para elegir, Enter/espacio para seguir.
  document.addEventListener('keydown', (e) => {
    if ($('#view-quiz').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const q = state.quiz;
    const n = Number(e.key);
    if (n >= 1 && n <= PARQUES.length && !q.corregida) {
      elegir(q.sel.parque ? 'coopera' : 'parque', PARQUES[n - 1]);
    } else if ((e.key === 'Enter' || e.key === ' ') && q.corregida) {
      e.preventDefault();
      siguiente();
    } else if (e.key === 'Backspace' && q.sel.parque && !q.corregida) {
      renderParkButtons($('#ans-coopera'), 'coopera');
      q.sel = { parque: null, coopera: null };
      document.querySelectorAll('#ans-parque .park').forEach((b) => b.classList.remove('selected'));
      $('#step-parque').className = 'step';
      $('#step-coopera').className = 'step dim';
    }
  });
}

async function init() {
  const res = await fetch('data/calles.json');
  state.data = await res.json();
  state.zonas = state.data.zonas;
  state.calles = state.data.calles;
  $('#sources').textContent =
    `Datos: ${state.data.fuentes.zonas}; ${state.data.fuentes.calles}. Generado el ${state.data.generado}. ` +
    `${state.calles.length} calles; ${state.data.excluidas.length} excluidas (puentes, autovías y vías sin numeración repartidas entre varias zonas). ` +
    `Tu progreso se guarda solo en este dispositivo.`;
  bind();
  renderHome();
}

init().catch((e) => {
  document.querySelector('main').innerHTML = `<div class="card" style="padding:16px">No se han podido cargar los datos (${esc(e.message)}). Comprueba la conexión y recarga.</div>`;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline */ });
}
