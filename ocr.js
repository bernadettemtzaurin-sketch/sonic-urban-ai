// OCR local con Tesseract.js (español + inglés).
// Corre en un worker para no bloquear la UI.

export class OCR {

  constructor() {
    this.worker = null;
    this.cv = document.createElement('canvas');
  }

  async init() {
    this.worker =
      await Tesseract.createWorker('spa+eng');
  }

  async read(src, w, h) {

    // Mayor resolución para mejorar lectura de teléfonos,
    // precios y letras pequeñas.
    const W = Math.min(1200, w);

    const H =
      Math.round(h * W / w);

    this.cv.width = W;
    this.cv.height = H;

    const cx =
      this.cv.getContext('2d');

    // Preprocesamiento OCR
    cx.filter =
      'grayscale(1) contrast(1.5) brightness(1.05)';

    cx.drawImage(
      src,
      0,
      0,
      W,
      H
    );

    const { data } =
      await this.worker.recognize(this.cv);

    return {
      text: data.text || '',
      confidence:
        (data.confidence || 0) / 100
    };
  }
}
