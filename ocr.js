// OCR local con Tesseract.js (español + inglés). Corre en un worker, sin bloquear la UI.
export class OCR {
  constructor() { this.worker = null; this.cv = document.createElement('canvas'); }
  async init() { this.worker = await Tesseract.createWorker('spa+eng'); }
  async read(src, w, h) {
    const W = Math.min(1000, w), H = Math.round(h * W / w); this.cv.width = W; this.cv.height = H;
    const cx = this.cv.getContext('2d'); cx.filter = 'grayscale(1) contrast(1.4)'; cx.drawImage(src, 0, 0, W, H);
    const { data } = await this.worker.recognize(this.cv);
    return { text: data.text || '', confidence: (data.confidence || 0) / 100 };
  }
}
