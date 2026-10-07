// GPS real vía navigator.geolocation. Nunca inventa coordenadas: si no hay fix reciente, get() devuelve null.
export class GPS {
  constructor() { this.pos = null; this.err = null; this.id = null; this.state = 'unavailable'; }
  start(onChange) {
    if (!navigator.geolocation) { this.err = 'unsupported'; this.state = 'unavailable'; onChange?.(); return; }
    this.state = 'searching'; this.err = null; onChange?.();
    this.id = navigator.geolocation.watchPosition(
      p => { this.pos = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), t: Date.now() }; this.err = null; this.state = 'ready'; onChange?.(); },
      e => { this.err = e.code === 1 ? 'denied' : 'unavailable'; this.state = this.err; this.pos = null; onChange?.(); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  }
  stop() { if (this.id != null) navigator.geolocation.clearWatch(this.id); this.id = null; this.pos = null; this.state = 'stopped'; }
  get() { return this.pos && Date.now() - this.pos.t < 30000 ? { ...this.pos } : null; }
}
export function distM(a, b) {
  const t = Math.PI / 180, dl = (b.latitude - a.latitude) * t, dn = (b.longitude - a.longitude) * t;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.latitude * t) * Math.cos(b.latitude * t) * Math.sin(dn / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}
