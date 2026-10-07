import { normalize, matchRent, SonicEngine } from './sonic-engine.js';
import { decode } from './yolo.js';
import { EventStore, makeEvent } from './events.js';
import { GPS } from './gps.js';

const results = document.querySelector('#results'); let passed = 0, total = 0;
async function test(name, fn) { total++; try { await fn(); passed++; results.insertAdjacentHTML('beforeend', `<li class="ok">✓ ${name}</li>`); } catch (error) { results.insertAdjacentHTML('beforeend', `<li class="bad">✕ ${name}: ${error.message}</li>`); } }
const equal = (got, want) => { if (got !== want) throw new Error(`esperado ${want}; recibido ${got}`); };

await test('normaliza acentos, puntuación y espacios', () => equal(normalize('  Sé- RENTA! '), 'se renta'));
await test('detecta SE RENTA con variación OCR', () => equal(matchRent('SE R3NTA', 0.9).key, 'se renta'));
await test('detecta FOR RENT', () => equal(matchRent('FOR RENT', 1).key, 'for rent'));
await test('decoder YOLO aplica letterbox, clase y threshold', () => { const out = decode(new Float32Array([64, 128, 320, 384, .8, 2, 0, 0, 5, 5, .2, 0]), { scale: .5, padX: 0, padY: 0, w: 1280, h: 1280 }, .35); equal(out.length, 1); equal(out[0].label, 'car'); equal(out[0].box[2], 640); });
await test('deduplica el mismo evento dentro de la ventana', () => { const s = new EventStore({ dedupMs: 5000 }); equal(s.add(makeEvent('RENT_SIGN', { timestamp: 1000, confidence: .9, dedupKey: 'se renta' })), true); equal(s.add(makeEvent('RENT_SIGN', { timestamp: 3000, confidence: .9, dedupKey: 'se renta' })), false); });
await test('GPS sin fix devuelve null', () => equal(new GPS().get(), null));
await test('obstáculo requiere persistencia', async () => { const d = { pothole: { analyze: async () => ({ detected: false }) }, lamp: { analyze: async () => ({ detected: false }) }, flood: { analyze: async () => ({ detected: false }) } }; const e = new SonicEngine({ obstacleZone: { x: .25, y: .45, w: .5, h: .55 }, obstacleClasses: ['car'], obstacleMinArea: .03, obstaclePersistence: 3 }, d); const frame = document.createElement('canvas'); frame.width = frame.height = 1000; const input = { detections: [{ label: 'car', conf: .9, box: [350, 600, 650, 900] }], frame }; equal((await e.analyze(input)).length, 0); equal((await e.analyze(input)).length, 0); equal((await e.analyze(input)).length, 1); });

document.querySelector('#summary').textContent = `${passed}/${total} pruebas aprobadas`;
