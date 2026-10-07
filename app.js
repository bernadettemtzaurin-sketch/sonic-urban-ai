import { Camera } from './camera.js';
import { GPS } from './gps.js';
import { Yolo } from './yolo.js';
import { OCR } from './ocr.js';
import { SonicEngine } from './sonic-engine.js';
import { EventStore, EVENT_TYPES } from './events.js';
import { PotholeDetector } from './pothole-detector.js';
import { LampDetector } from './lamp-detector.js';
import { FloodDetector } from './flood-detector.js';

// ===== CONFIGURACIÓN (todo lo ajustable vive aquí) =====
export const SONIC_CONFIG = {
  // Verificado el 2026-10-06: CORS: *, entrada [1,3,640,640], salida [1,300,6].
  modelUrl: 'https://huggingface.co/besit/yolo-onnx/resolve/main/yolo26n.onnx',
  // Fallback reproducible: descarga el mismo ONNX a assets/yolo26n.onnx (ver README).
  modelFallbackUrl: './assets/yolo26n.onnx',
  modelType: 'yolo26',
  inputSize: 640,
  confidenceThreshold: 0.35,
  ortWasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
  inferenceIntervalMs: 400, minIntervalMs: 250, maxIntervalMs: 1500,
  ocrIntervalMs: 2500, ocrMaxAgeMs: 6000,
  dedupWindowMs: 5000,
  obstacleZone: { x: 0.25, y: 0.45, w: 0.5, h: 0.55 }, // fracción del cuadro: trayectoria frente a la cámara
  obstacleClasses: ['person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'dog'],
  obstacleMinArea: 0.03, obstaclePersistence: 3
};
const C = SONIC_CONFIG, $ = id => document.getElementById(id);
const video = $('video'), demoCv = $('demo'), ov = $('overlay'), octx = ov.getContext('2d');
const cam = new Camera(video), gps = new GPS(), yolo = new Yolo(C, window.ort), ocr = new OCR();
const detectors = { pothole: new PotholeDetector(), lamp: new LampDetector(), flood: new FloodDetector() };
const engine = new SonicEngine(C, detectors);
const store = new EventStore({ dedupMs: C.dedupWindowMs, onChange: renderLog });
let running = false, demo = false, dets = [], interval = C.inferenceIntervalMs, pendingOcr = null, ocrBusy = false, ocrReady = false, yoloReady = false, frames = 0;
const frameCv = document.createElement('canvas');

const src = () => demo ? demoCv : video;
const size = () => demo ? [demoCv.width, demoCv.height] : [video.videoWidth, video.videoHeight];
const say = (t, isError = false) => { $('msg').textContent = t; $('error').hidden = !isError; $('error').textContent = isError ? t : ''; };

function renderMods() {
  const row = (n, state, detail = '') => {
    const ok = ['READY', 'LOADED'].includes(state), bad = ['ERROR', 'DENIED', 'UNAVAILABLE'].includes(state);
    return `<div><span>${n}</span><b class="${ok ? 'ok' : bad ? 'no' : 'wait'}">${ok ? '●' : bad ? '✕' : '○'} ${state}</b>${detail ? `<small>${detail}</small>` : ''}</div>`;
  };
  const yoloState = yoloReady ? 'LOADED' : yolo.status === 'error' ? 'ERROR' : yolo.status === 'loading' ? 'LOADING' : 'PENDING';
  const gpsState = gps.state === 'ready' ? 'READY' : gps.state === 'denied' ? 'DENIED' : gps.state === 'unavailable' ? 'UNAVAILABLE' : gps.state === 'searching' ? 'SEARCHING' : 'PENDING';
  $('mods').innerHTML = row('Camera', cam.active ? 'READY' : 'PENDING') + row('GPS', gpsState) + row('YOLO26', yoloState, yolo.modelUrlUsed ? (yolo.modelUrlUsed.startsWith('./') ? 'modelo local' : 'modelo remoto') : '') + row('OCR', ocrReady ? 'READY' : 'PENDING') +
    engine.moduleStatus().map(m => row(`${m.name} experimental`, 'UNAVAILABLE', m.status)).join('');
}
function renderGps() {
  const p = gps.get();
  $('gps').innerHTML = p ? `● GPS READY<br>Lat: ${p.latitude.toFixed(5)}<br>Lng: ${p.longitude.toFixed(5)} <span style="color:var(--mu)">±${p.accuracy} m</span>`
    : (gps.state === 'searching' ? '○ GPS SEARCHING…' : gps.state === 'denied' ? '✕ GPS DENIED — los eventos seguirán sin coordenadas' : '✕ GPS UNAVAILABLE — los eventos seguirán sin coordenadas');
  renderMods();
}
function renderLog() {
  $('count').textContent =
    'Eventos: ' + String(store.list.length).padStart(2, '0');

  $('log').innerHTML = store.list.slice(0, 30).map(e => {

    const T = EVENT_TYPES[e.type];

    const t =
      new Date(e.timestamp).toLocaleTimeString('es-MX');

    const g = e.gps
      ? `📍 ${e.gps.latitude.toFixed(5)}, ${e.gps.longitude.toFixed(5)}`
      : 'GPS NO DISPONIBLE';

    // Datos estructurados de propiedad
    const p = e.property;

    const propertyInfo = p
      ? `
        <div class="property-data">

          ${p.operation
            ? `<div class="m">🔑 <strong>${p.operation}</strong></div>`
            : ''}

          ${p.propertyType
            ? `<div class="m">🏠 ${p.propertyType}</div>`
            : ''}

          ${p.phone
            ? `<div class="m">📞 ${p.phone}</div>`
            : ''}

          ${p.price
            ? `<div class="m">💰 ${p.price}</div>`
            : ''}

          ${p.area
            ? `<div class="m">📐 ${p.area}</div>`
            : ''}

        </div>
      `
      : '';

    return `
      <li>
        ${
          e.evidence
            ? `<img src="${e.evidence}" alt="evidencia">`
            : '<img alt="">'
        }

        <div>

          <div class="t">
            ${T.icon} ${e.label}

            ${
              e.status === 'experimental'
                ? '<span class="tag">EXPERIMENTAL</span>'
                : ''
            }

            ${
              e.demo
                ? '<span class="tag">DEMO</span>'
                : ''
            }
          </div>

          ${propertyInfo}

          ${
            e.ocrText
              ? `
                <div class="m">
                  OCR:
                  "${e.ocrText
                    .replace(/\s+/g, ' ')
                    .slice(0, 120)
                    .replace(/</g, '&lt;')}"
                </div>
              `
              : ''
          }

          <div class="m">
            ${Math.round(e.confidence * 100)}% · ${t}
          </div>

          <div class="m">
            ${g}
          </div>

        </div>
      </li>
    `;
  }).join('');
}
function draw() {
  const [w, h] = size();
  if (running && w) {
    if (ov.width !== ov.clientWidth) { ov.width = ov.clientWidth; ov.height = ov.clientHeight; }
    const scale = Math.max(ov.width / w, ov.height / h), ox = (ov.width - w * scale) / 2, oy = (ov.height - h * scale) / 2;
    const point = (x, y) => [ox + x * scale, oy + y * scale];
    octx.clearRect(0, 0, ov.width, ov.height); octx.lineWidth = 2; octx.font = '12px sans-serif';
    const z = C.obstacleZone, [zx, zy] = point(z.x * w, z.y * h); octx.setLineDash([6, 5]); octx.strokeStyle = 'rgba(232,163,61,.7)'; octx.strokeRect(zx, zy, z.w * w * scale, z.h * h * scale); octx.setLineDash([]);
    for (const d of dets) { const [x1, y1, x2, y2] = d.box, [dx, dy] = point(x1, y1); octx.strokeStyle = '#8DBF6F'; octx.strokeRect(dx, dy, (x2 - x1) * scale, (y2 - y1) * scale);
      octx.fillStyle = '#8DBF6F'; octx.fillText(`${d.label} ${Math.round(d.conf * 100)}%`, dx + 3, Math.max(12, dy - 4)); }
    frames++;
  }
  requestAnimationFrame(draw);
}
setInterval(() => { $('fps').textContent = frames; frames = 0; }, 1000);

function grab() { const [w, h] = size(); frameCv.width = w; frameCv.height = h; frameCv.getContext('2d').drawImage(src(), 0, 0, w, h); return frameCv; }

async function tick() {
  if (!running) return;
  const t0 = performance.now(), [w, h] = size();
  try {
    if (w && yoloReady) {
      const result = await yolo.detect(src(), w, h); dets = result.detections;
      const t = result.timing; $('timing').textContent = `Pre: ${Math.round(t.preprocess)} ms · Inferencia: ${Math.round(t.inference)} ms · Post: ${Math.round(t.postprocess)} ms`;
    }
    // El fallback OCR sigue siendo real aunque la descarga de YOLO falle.
    const o = pendingOcr && Date.now() - pendingOcr.timestamp < C.ocrMaxAgeMs ? pendingOcr : null; pendingOcr = null;
    if (w) (await engine.analyze({ detections: yoloReady ? dets : [], ocr: o, frame: grab(), gps: gps.get(), timestamp: Date.now(), demo })).forEach(e => {
      if (store.add(e)) console.info('[SONIC] Event created:', e.type);
    });
  } catch (e) { console.error('[SONIC ERROR] inference', e); say('Error de IA: ' + e.message, true); }
  const ms = performance.now() - t0; $('inf').textContent = Math.round(ms);
  interval = yoloReady ? Math.max(C.minIntervalMs, Math.min(C.maxIntervalMs, ms > interval * 0.8 ? interval * 1.25 : interval * 0.95)) : C.ocrIntervalMs;
  if (running) setTimeout(tick, interval);
}
async function ocrLoop() {
  if (!running) return;
  const [w, h] = size();
  if (w && ocrReady && !ocrBusy) { ocrBusy = true; try { pendingOcr = { ...await ocr.read(src(), w, h), timestamp: Date.now() }; console.info('[SONIC] OCR:', pendingOcr.text.trim().slice(0, 60)); } catch (e) { console.error('[SONIC ERROR] OCR', e); } ocrBusy = false; }
  if (running) setTimeout(ocrLoop, C.ocrIntervalMs);
}
async function boot() {
  if (!yoloReady) { say('Cargando YOLO26…'); renderMods(); try { await yolo.load(); yoloReady = true; } catch (e) { say('YOLO26 no pudo cargar. SONIC continuará con OCR real; revisa modelo/CORS.', true); console.error('[SONIC ERROR] YOLO model failed to load', e); } }
  renderMods();
  if (!ocrReady) { try { await ocr.init(); ocrReady = true; console.info('[SONIC] OCR initialized'); } catch (e) { console.error('[SONIC ERROR] OCR initialization failed', e); } renderMods(); }
}
async function go() {
  running = true; $('start').disabled = true; $('stop').disabled = false; $('btnDemo').disabled = true;
  $('live').textContent = '● LIVE'; $('live').className = 'live on'; $('ai').textContent = 'ACTIVE'; $('banner').hidden = !demo;
  gps.start(renderGps); console.info('[SONIC] GPS initialized'); await boot();
  if (!running) return;
  $('ai').textContent = yoloReady ? 'ACTIVE' : ocrReady ? 'OCR FALLBACK' : 'ERROR';
  if (yoloReady) say(demo ? 'DEMO' : 'SONIC activo'); tick(); ocrLoop();
}
$('start').onclick = async () => {
  demo = false; demoCv.style.display = 'none'; video.style.display = 'block';
  try { await cam.start(); console.info('[SONIC] Camera initialized'); } catch (e) { say('No se pudo abrir la cámara: ' + e.message + ' (¿HTTPS y permiso?)', true); renderMods(); return; }
  await go();
};
$('btnDemo').onclick = () => { // Imagen sintética con el letrero "SE RENTA": el OCR sobre ella SÍ corre; no es cámara
  demo = true; demoCv.width = 800; demoCv.height = 1000; const x = demoCv.getContext('2d');
  x.fillStyle = '#6b7a80'; x.fillRect(0, 0, 800, 1000); x.fillStyle = '#f2f2f2'; x.fillRect(120, 380, 560, 240);
  x.fillStyle = '#c0392b'; x.font = 'bold 120px sans-serif'; x.textAlign = 'center'; x.fillText('SE RENTA', 400, 530); x.font = '48px sans-serif'; x.fillStyle = '#222'; x.fillText('Tel. 867 000 0000', 400, 595);
  video.style.display = 'none'; demoCv.style.display = 'block'; go();
};
$('stop').onclick = () => { running = false; cam.stop(); gps.stop(); dets = []; octx.clearRect(0, 0, ov.width, ov.height); demoCv.style.display = 'none'; video.style.display = 'block';
  $('start').disabled = false; $('stop').disabled = true; $('btnDemo').disabled = false; $('live').textContent = '● OFF'; $('live').className = 'live off'; $('ai').textContent = 'OFF'; $('banner').hidden = true; say('Detenido'); renderGps(); };
$('clear').onclick = () => store.clear();
function diagRow(name, state, detail = '') {
  const cls = state === 'READY' ? 'ok' : state === 'ERROR' ? 'no' : 'wait';
  const icon = state === 'READY' ? '✓' : state === 'ERROR' ? '✕' : '○';
  return `<div>${name}<b class="${cls}">${icon} ${state}</b><small>${detail.replace(/</g, '&lt;')}</small></div>`;
}
$('diagnose').onclick = async () => {
  const panel = $('diagnostics'), button = $('diagnose'); panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden));
  if (panel.hidden) return;
  const browser = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
  const fixed = [
    ['Browser / HTTPS', browser ? 'READY' : 'ERROR', browser ? 'contexto seguro y MediaDevices disponibles' : 'abre desde HTTPS o localhost'],
    ['Camera', cam.active ? 'READY' : 'PENDING', cam.active ? 'cámara activa' : 'toca INICIAR SONIC para pedir permiso'],
    ['GPS', gps.state === 'ready' ? 'READY' : ['denied', 'unavailable'].includes(gps.state) ? 'ERROR' : 'PENDING', gps.state],
    ['WebAssembly', typeof WebAssembly === 'object' ? 'READY' : 'ERROR', ''],
    ['ONNX Runtime', window.ort?.InferenceSession ? 'READY' : 'ERROR', '']
  ];
  $('diagResults').innerHTML = fixed.map(x => diagRow(...x)).join('') + diagRow('Model download', 'PENDING', 'comprobando…') + diagRow('Model inference', 'PENDING', 'comprobando…') + diagRow('OCR', 'PENDING', 'comprobando…');
  await boot();
  let modelTest = null, modelError = '';
  if (yoloReady) try { modelTest = await yolo.selfTest(); } catch (e) { modelError = e.message; }
  $('diagResults').innerHTML = [...fixed,
    ['Model download', yoloReady ? 'READY' : 'ERROR', yoloReady ? yolo.modelUrlUsed : yolo.error || 'no disponible'],
    ['Model inference', modelTest ? 'READY' : 'ERROR', modelTest ? `${Math.round(modelTest.total)} ms (cuadro de prueba)` : modelError || 'no disponible'],
    ['OCR', ocrReady ? 'READY' : 'ERROR', ocrReady ? 'worker spa+eng listo' : 'no disponible']
  ].map(x => diagRow(...x)).join('');
  renderMods();
};
renderMods(); renderGps(); renderLog(); requestAnimationFrame(draw);
