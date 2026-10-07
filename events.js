// Evento SONIC estándar + registro con deduplicación. Para agregar un tipo nuevo basta añadirlo a EVENT_TYPES.
import { distM } from './gps.js';
export const EVENT_TYPES = {
  POTHOLE: { label: 'POSIBLE BACHE', icon: '🕳️' },
  BROKEN_LAMP: { label: 'POSIBLE LUMINARIA FUNDIDA', icon: '💡' },
  RENT_SIGN: { label: 'SE RENTA', icon: '🏠' },
  OBSTACLE: { label: 'OBSTÁCULO', icon: '🚧' },
  FLOOD: { label: 'POSIBLE INUNDACIÓN', icon: '💧' }
};
let seq = 0;
export function makeEvent(type, o) {
  return { id: `${Date.now().toString(36)}-${++seq}`, type, label: EVENT_TYPES[type].label, confidence: +(o.confidence ?? 0).toFixed(2),
    status: o.status ?? 'real', timestamp: o.timestamp ?? Date.now(), gps: o.gps ? { latitude: o.gps.latitude, longitude: o.gps.longitude, accuracy: o.gps.accuracy } : null,
    detections: o.detections ?? [], ocrText: o.ocrText ?? null, evidence: o.evidence ?? null, dedupKey: o.dedupKey ?? '', demo: !!o.demo };
}
export class EventStore {
  constructor({ dedupMs = 5000, onChange } = {}) { this.list = []; this.last = new Map(); this.dedupMs = dedupMs; this.onChange = onChange; }
  add(e) {
    const key = e.type + '|' + e.dedupKey, p = this.last.get(key);
    if (p) { // ventana deslizante: mientras el objeto siga visible no se generan eventos nuevos
      const near = p.gps && e.gps && distM(p.gps, e.gps) < 20;
      if (e.timestamp - p.seen < (near ? this.dedupMs * 6 : this.dedupMs)) { p.seen = e.timestamp; return false; }
    }
    this.last.set(key, { gps: e.gps, seen: e.timestamp }); this.list.unshift(e); this.onChange?.(); return true;
  }
  clear() { this.list = []; this.last.clear(); this.onChange?.(); }
}
