// YOLO26 (ONNX, salida NMS integrada). Entrada RGB [1,3,640,640] 0..1.
// El archivo actualmente configurado se verificó como images:[1,3,640,640], output0:[1,300,6].
// Cada fila de salida es x1,y1,x2,y2,confidence,class (coordenadas del cuadro letterbox).
export const COCO = ['person','bicycle','car','motorcycle','airplane','bus','train','truck','boat','traffic light','fire hydrant','stop sign','parking meter','bench','bird','cat','dog','horse','sheep','cow','elephant','bear','zebra','giraffe','backpack','umbrella','handbag','tie','suitcase','frisbee','skis','snowboard','sports ball','kite','baseball bat','baseball glove','skateboard','surfboard','tennis racket','bottle','wine glass','cup','fork','knife','spoon','bowl','banana','apple','sandwich','orange','broccoli','carrot','hot dog','pizza','donut','cake','chair','couch','potted plant','bed','dining table','toilet','tv','laptop','mouse','remote','keyboard','cell phone','microwave','oven','toaster','sink','refrigerator','book','clock','vase','scissors','teddy bear','hair drier','toothbrush'];

export function decode(data, m, minConf) {
  if (!data || data.length % 6 !== 0) throw new Error('Salida YOLO inválida: se esperaban filas de 6 valores');
  const out = [], n = data.length / 6;
  for (let i = 0; i < n; i++) {
    const o = i * 6, conf = data[o + 4];
    if (conf < minConf) continue;
    const cl = (v, max) => Math.max(0, Math.min(max, v));
    const x1 = cl((data[o] - m.padX) / m.scale, m.w), y1 = cl((data[o + 1] - m.padY) / m.scale, m.h);
    const x2 = cl((data[o + 2] - m.padX) / m.scale, m.w), y2 = cl((data[o + 3] - m.padY) / m.scale, m.h);
    if (x2 - x1 < 2 || y2 - y1 < 2) continue;
    const c = Math.round(data[o + 5]);
    if (!Number.isFinite(conf) || !Number.isInteger(c) || c < 0) continue;
    out.push({ box: [x1, y1, x2, y2], conf, cls: c, label: COCO[c] ?? 'class_' + c });
  }
  return out;
}

export class Yolo {
  constructor(cfg, ort) { this.cfg = cfg; this.ort = ort; this.session = null; this.status = 'idle'; this.error = null; this.modelUrlUsed = null; this.lastTiming = null; }
  async load() {
    const { ort, cfg } = this;
    if (!ort?.InferenceSession) throw new Error('ONNX Runtime Web no se cargó');
    this.status = 'loading'; this.error = null;
    ort.env.wasm.wasmPaths = cfg.ortWasmPath;
    const urls = [...new Set([cfg.modelUrl, cfg.modelFallbackUrl].filter(Boolean))];
    const failures = [];
    for (const url of urls) try {
      this.session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
      this.modelUrlUsed = url; break;
    } catch (error) { failures.push(`${url}: ${error.message}`); }
    if (!this.session) { this.status = 'error'; this.error = failures.join(' | '); throw new Error('No se pudo abrir el modelo remoto ni el fallback local'); }
    try { this.validateModel(); } catch (error) { this.status = 'error'; this.error = error.message; throw error; }
    this.cv = document.createElement('canvas'); this.cv.width = this.cv.height = cfg.inputSize;
    this.cx = this.cv.getContext('2d', { willReadFrequently: true });
    this.status = 'loaded'; console.info('[SONIC] YOLO26 loaded', this.modelUrlUsed);
  }
  validateModel() {
    const input = this.session.inputNames[0], output = this.session.outputNames[0];
    const shape = meta => meta?.dimensions || meta?.dims || meta?.shape || [];
    const gotIn = shape(this.session.inputMetadata?.[input]);
    const gotOut = shape(this.session.outputMetadata?.[output]);
    const expectedIn = [1, 3, this.cfg.inputSize, this.cfg.inputSize], expectedOut = [1, 300, 6];
    const matches = (got, expected) => !got.length || got.every((v, i) => Number(v) === expected[i]);
    if (!matches(gotIn, expectedIn) || !matches(gotOut, expectedOut)) {
      this.status = 'error';
      throw new Error(`Modelo incompatible. Entrada ${JSON.stringify(gotIn)}; salida ${JSON.stringify(gotOut)}. Se esperaba [1,3,${this.cfg.inputSize},${this.cfg.inputSize}] y [1,300,6]`);
    }
  }
  async detect(src, w, h) {
    if (!this.session) throw new Error('YOLO26 no está cargado');
    const started = performance.now();
    const S = this.cfg.inputSize, scale = Math.min(S / w, S / h);
    const nw = Math.round(w * scale), nh = Math.round(h * scale), padX = (S - nw) >> 1, padY = (S - nh) >> 1;
    this.cx.fillStyle = 'rgb(114,114,114)'; this.cx.fillRect(0, 0, S, S);
    this.cx.drawImage(src, padX, padY, nw, nh);
    const px = this.cx.getImageData(0, 0, S, S).data, A = S * S, f = new Float32Array(3 * A);
    for (let i = 0; i < A; i++) { f[i] = px[i * 4] / 255; f[A + i] = px[i * 4 + 1] / 255; f[2 * A + i] = px[i * 4 + 2] / 255; }
    const prepared = performance.now();
    const res = await this.session.run({ [this.session.inputNames[0]]: new this.ort.Tensor('float32', f, [1, 3, S, S]) });
    const inferred = performance.now();
    const output = res[this.session.outputNames[0]];
    const detections = decode(output?.data, { scale, padX, padY, w, h }, this.cfg.confidenceThreshold);
    const ended = performance.now();
    this.lastTiming = { preprocess: prepared - started, inference: inferred - prepared, postprocess: ended - inferred, total: ended - started };
    return { detections, timing: this.lastTiming };
  }
  async selfTest() {
    if (!this.session) await this.load();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = this.cfg.inputSize;
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
    await this.detect(canvas, canvas.width, canvas.height);
    return this.lastTiming;
  }
}
