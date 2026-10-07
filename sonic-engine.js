// SONIC RULES: recibe detecciones YOLO + OCR + contexto y produce eventos. Sin DOM salvo la miniatura de evidencia.
import { makeEvent } from './events.js';

export function normalize(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
export function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Devuelve { confidence, key } o null. Tolera mayúsculas, acentos, guiones, signos y 1 error de OCR por palabra.
export function matchRent(text, ocrConf = 0.6) {
  const n = normalize(text), f = base => Math.min(1, base * (0.5 + 0.5 * ocrConf));
  if (/\bse ?(renta|alquila)\b/.test(n)) return { confidence: f(0.95), key: 'se renta' };
  if (/\bfor rent\b/.test(n)) return { confidence: f(0.95), key: 'for rent' };
  const tk = n.split(' ');
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i];
    for (const w of ['renta', 'alquila', 'alquiler']) if (t.length >= 5 && lev(t, w) <= 1)
      return { confidence: f(tk[i - 1] === 'se' ? 0.8 : 0.6), key: 'se renta' };
  }
  if (tk.includes('available')) return { confidence: f(0.4), key: 'available' };
  return null;
}
// Punto de extensión de privacidad: antes de persistir una evidencia se podrá
// aplicar aquí blur de rostros y placas. Hoy no identifica ni altera personas.
export function sanitizeEvidence(frame) { return frame; }
export function snapshot(frame) {
  if (!frame || typeof document === 'undefined' || !frame.getContext) return null;
  const safeFrame = sanitizeEvidence(frame);
  const c = document.createElement('canvas'); c.width = 320; c.height = Math.round(320 * safeFrame.height / safeFrame.width);
  c.getContext('2d').drawImage(safeFrame, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.6);
}

export class SonicEngine {
  constructor(cfg, detectors) { this.cfg = cfg; this.d = detectors; this.seen = new Map(); }
  moduleStatus() { return Object.values(this.d).map(x => ({ name: x.name, status: x.status })); }
  async analyze({ detections = [], ocr = null, frame = null, gps = null, timestamp = Date.now(), demo = false }) {
    const evs = [], base = { gps, timestamp, detections, demo };
    const mk = (type, o) => evs.push(makeEvent(type, { ...base, evidence: snapshot(frame), ...o }));
    // SE RENTA (OCR real)
    if (ocr?.text) { const m = matchRent(ocr.text, ocr.confidence); if (m) mk('RENT_SIGN', { confidence: m.confidence, ocrText: ocr.text.trim(), dedupKey: m.key }); }
    // OBSTÁCULO: objeto relevante dentro de la zona de circulación, con tamaño mínimo y persistencia
    const { obstacleZone: z, obstacleClasses, obstacleMinArea, obstaclePersistence } = this.cfg, W = frame?.width, H = frame?.height;
    const now = new Set();
    if (W && H) for (const d of detections) {
      if (!obstacleClasses.includes(d.label)) continue;
      const [x1, y1, x2, y2] = d.box, cx = (x1 + x2) / 2 / W, cy = (y1 + y2) / 2 / H;
      const inZone = cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
      if (!inZone || (x2 - x1) * (y2 - y1) / (W * H) < obstacleMinArea) continue;
      const track = `${d.label}:${Math.floor(cx * 5)}:${Math.floor(cy * 5)}`;
      now.add(track); const n = (this.seen.get(track) || 0) + 1; this.seen.set(track, n);
      if (n >= obstaclePersistence) mk('OBSTACLE', { confidence: d.conf, dedupKey: track });
    }
    for (const k of [...this.seen.keys()]) if (!now.has(k)) this.seen.delete(k);
    // Módulos experimentales (adaptadores)
    for (const [type, det] of [['POTHOLE', this.d.pothole], ['BROKEN_LAMP', this.d.lamp], ['FLOOD', this.d.flood]]) {
      try { const r = await det.analyze(frame, { detections, gps }); if (r?.detected) mk(type, { confidence: r.confidence, status: 'experimental' }); } catch (e) { console.warn(type, e); }
    }
    return evs;
  }
}
