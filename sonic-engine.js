// SONIC RULES: detecciones YOLO + OCR + contexto -> eventos.
import { makeEvent } from './events.js';

export function normalize(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9$%+.-]+/g, ' ')
    .trim();
}

export function lev(a, b) {
  const d = Array.from(
    { length: a.length + 1 },
    (_, i) => [i, ...Array(b.length).fill(0)]
  );

  for (let j = 1; j <= b.length; j++) d[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }

  return d[a.length][b.length];
}

// ======================================================
// CAPTURA DE PROPIEDADES MEDIANTE OCR
// Detecta:
// RENTA / VENTA
// CASA / DEPARTAMENTO / LOCAL / TERRENO / OFICINA...
// TELÉFONO
// PRECIO
// SUPERFICIE
// ======================================================
export function matchProperty(text, ocrConf = 0.6) {
  const raw = String(text || '');
  const n = normalize(raw);

  const f = base =>
    Math.min(1, base * (0.5 + 0.5 * ocrConf));

  // -------------------------
  // OPERACIÓN
  // -------------------------
  let operation = null;

  if (
    /\b(se\s+)?(renta|alquila|alquiler)\b/.test(n) ||
    /\bfor\s+rent\b/.test(n)
  ) {
    operation = 'RENTA';
  }

  if (
    /\b(se\s+)?(vende|venta)\b/.test(n) ||
    /\bfor\s+sale\b/.test(n)
  ) {
    operation = 'VENTA';
  }

  // Tolerancia a errores típicos del OCR
  if (!operation) {
    for (const t of n.split(/\s+/)) {
      if (
        t.length >= 5 &&
        ['renta', 'alquila', 'alquiler'].some(w => lev(t, w) <= 1)
      ) {
        operation = 'RENTA';
        break;
      }

      if (
        t.length >= 5 &&
        ['vende', 'venta'].some(w => lev(t, w) <= 1)
      ) {
        operation = 'VENTA';
        break;
      }
    }
  }

  if (!operation) return null;

  // -------------------------
  // TIPO DE PROPIEDAD
  // -------------------------
  const typeRules = [
    ['CASA', /\bcasa\b|\bhouse\b/],
    [
      'DEPARTAMENTO',
      /\b(departamento|depa|apto|apartamento|apartment)\b/
    ],
    ['LOCAL', /\b(local|comercial|comercio|shop|store)\b/],
    ['TERRENO', /\b(terreno|lote|lot)\b/],
    ['OFICINA', /\b(oficina|office)\b/],
    ['BODEGA', /\b(bodega|warehouse)\b/],
    ['EDIFICIO', /\bedificio\b|\bbuilding\b/]
  ];

  const propertyType =
    typeRules.find(([, re]) => re.test(n))?.[0] || 'INMUEBLE';

  // -------------------------
  // TELÉFONOS
  // -------------------------
  const phoneCandidates =
    raw.match(
      /(?:\+?52[\s.-]?)?(?:\(?\d{2,3}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}/g
    ) || [];

  const phones = [
    ...new Set(
      phoneCandidates
        .map(p => p.replace(/\D/g, ''))
        .filter(
          p =>
            p.length === 10 ||
            (p.length === 12 && p.startsWith('52'))
        )
        .map(p =>
          p.length === 12 && p.startsWith('52')
            ? p.slice(2)
            : p
        )
    )
  ];

  // -------------------------
  // PRECIOS
  // Ej:
  // $12,000
  // $1,500,000
  // MXN 15,000
  // -------------------------
  const priceMatches =
    raw.match(
      /(?:MXN|MN|M\.N\.|\$)\s*\d[\d,]*(?:\.\d{1,2})?/gi
    ) || [];

  const prices = [
    ...new Set(priceMatches.map(p => p.trim()))
  ];

  // -------------------------
  // SUPERFICIES
  // Ej:
  // 120 m2
  // 250 m²
  // 500 metros cuadrados
  // -------------------------
  const areaMatches =
    raw.match(
      /\b\d[\d,.]*\s*(?:m2|m²|mts2|metros?\s+cuadrados)\b/gi
    ) || [];

  const areas = [
    ...new Set(areaMatches.map(a => a.trim()))
  ];

  // -------------------------
  // CONFIANZA
  // -------------------------
  const confidence = f(
    phones.length || prices.length || areas.length
      ? 0.96
      : 0.90
  );

  return {
    confidence,

    operation,

    propertyType,

    phones,
    phone: phones[0] || null,

    prices,
    price: prices[0] || null,

    areas,
    area: areas[0] || null,

    key: [
      operation,
      propertyType,
      phones[0] || '',
      prices[0] || ''
    ].join('|')
  };
}

// Compatibilidad con el código anterior
export const matchRent = matchProperty;


// ======================================================
// EVIDENCIA
// ======================================================

export function sanitizeEvidence(frame) {
  return frame;
}

export function snapshot(frame) {
  if (
    !frame ||
    typeof document === 'undefined' ||
    !frame.getContext
  ) {
    return null;
  }

  const safeFrame = sanitizeEvidence(frame);

  const c = document.createElement('canvas');

  c.width = 320;
  c.height = Math.round(
    320 * safeFrame.height / safeFrame.width
  );

  c.getContext('2d').drawImage(
    safeFrame,
    0,
    0,
    c.width,
    c.height
  );

  return c.toDataURL('image/jpeg', 0.6);
}


// ======================================================
// MOTOR SONIC
// ======================================================

export class SonicEngine {

  constructor(cfg, detectors) {
    this.cfg = cfg;
    this.d = detectors;
    this.seen = new Map();
  }

  moduleStatus() {
    return Object.values(this.d).map(x => ({
      name: x.name,
      status: x.status
    }));
  }

  async analyze({
    detections = [],
    ocr = null,
    frame = null,
    gps = null,
    timestamp = Date.now(),
    demo = false
  }) {

    const evs = [];

    const base = {
      gps,
      timestamp,
      detections,
      demo
    };

    const mk = (type, o) =>
      evs.push(
        makeEvent(type, {
          ...base,
          evidence: snapshot(frame),
          ...o
        })
      );


    // ==================================================
    // PROPIEDAD DETECTADA POR OCR
    // ==================================================

    if (ocr?.text) {

      const property = matchProperty(
        ocr.text,
        ocr.confidence
      );

      if (property) {

        mk('PROPERTY_CAPTURE', {

          confidence: property.confidence,

          ocrText: ocr.text.trim(),

          dedupKey: property.key,

          property

        });
      }
    }


    // ==================================================
    // OBSTÁCULOS
    // ==================================================

    const {
      obstacleZone: z,
      obstacleClasses,
      obstacleMinArea,
      obstaclePersistence
    } = this.cfg;

    const W = frame?.width;
    const H = frame?.height;

    const now = new Set();

    if (W && H) {

      for (const d of detections) {

        if (!obstacleClasses.includes(d.label))
          continue;

        const [x1, y1, x2, y2] = d.box;

        const cx =
          (x1 + x2) / 2 / W;

        const cy =
          (y1 + y2) / 2 / H;

        const inZone =
          cx >= z.x &&
          cx <= z.x + z.w &&
          cy >= z.y &&
          cy <= z.y + z.h;

        const area =
          ((x2 - x1) * (y2 - y1)) /
          (W * H);

        if (!inZone || area < obstacleMinArea)
          continue;

        const track =
          `${d.label}:${Math.floor(cx * 5)}:${Math.floor(cy * 5)}`;

        now.add(track);

        const n =
          (this.seen.get(track) || 0) + 1;

        this.seen.set(track, n);

        if (n >= obstaclePersistence) {

          mk('OBSTACLE', {
            confidence: d.conf,
            dedupKey: track
          });

        }
      }
    }

    // Limpiar tracks que desaparecieron
    for (const k of [...this.seen.keys()]) {

      if (!now.has(k))
        this.seen.delete(k);

    }


    // ==================================================
    // MÓDULOS EXPERIMENTALES
    // ==================================================

    for (
      const [type, det] of [
        ['POTHOLE', this.d.pothole],
        ['BROKEN_LAMP', this.d.lamp],
        ['FLOOD', this.d.flood]
      ]
    ) {

      try {

        const r =
          await det.analyze(
            frame,
            {
              detections,
              gps
            }
          );

        if (r?.detected) {

          mk(type, {
            confidence: r.confidence,
            status: 'experimental'
          });

        }

      } catch (e) {

        console.warn(type, e);

      }
    }

    return evs;
  }
}
