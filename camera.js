// Cámara trasera por defecto (facingMode ideal "environment"). Requiere HTTPS o localhost.
export class Camera {
  constructor(video) { this.v = video; this.stream = null; }
  async start() {
    if (!window.isSecureContext) throw new Error('La cámara requiere HTTPS o localhost');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no ofrece acceso a cámara');
    const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
    try { this.stream = await navigator.mediaDevices.getUserMedia(constraints); }
    catch (error) {
      // Algunos teléfonos rechazan una preferencia de resolución; mantener una ruta real de cámara.
      if (error.name !== 'OverconstrainedError') throw error;
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    }
    this.v.srcObject = this.stream; await this.v.play();
  }
  stop() { this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.v.srcObject = null; }
  get active() { return !!this.stream; }
}
