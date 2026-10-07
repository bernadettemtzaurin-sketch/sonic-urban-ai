// ADAPTADOR experimental de luminaria fundida (BROKEN_LAMP). Sin modelo conectado: NO detecta nada y lo reporta como "model_not_connected".
// Para conectar un modelo propio: cargarlo en load() y, en analyze(frame, ctx), devolver
//   { detected: true, confidence: 0..1, status: "experimental" }
// frame = canvas con el cuadro actual; ctx = { detections (YOLO26), gps }.
export class LampDetector {
  constructor() { this.name = 'lamp'; this.status = 'model_not_connected'; }
  async load(/* modelUrl */) { /* ej.: cargar un ONNX entrenado con imágenes locales */ }
  async analyze(frame, ctx) { return { detected: false, confidence: 0, status: this.status }; }
}
