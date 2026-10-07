# SONIC Urban AI

Cámara → percepción con IA → eventos urbanos → GPS. Solo percepción: no controla el vehículo ni toca el CAN bus.

## Arquitectura
`camera.js` (cámara trasera) → `yolo.js` (YOLO26 en ONNX Runtime Web) + `ocr.js` (Tesseract.js) → `sonic-engine.js` (reglas) → `events.js` (evento estándar, deduplicación, bitácora) + `gps.js`. Todo se configura en `SONIC_CONFIG` al inicio de `app.js`.

## Cómo correrlo (no se puede abrir con doble clic)
La cámara exige **HTTPS o localhost**, y los módulos ES exigen un servidor.
- **En tu Pixel:** sube la carpeta a Netlify Drop, GitHub Pages o Cloudflare Pages y abre la URL https en Chrome.
- **En la laptop:** `python3 -m http.server 8000` y abre `http://localhost:8000`.
Al tocar INICIAR SONIC, Chrome pedirá permiso de cámara y de ubicación. Si niegas la ubicación, los eventos se guardan como "GPS NO DISPONIBLE" (nunca se inventan coordenadas).

## Modelo
- YOLO26n ONNX, entrada `images: [1,3,640,640]`, salida `output0: [1,300,6]`, filas `x1,y1,x2,y2,confidence,class`; el artefacto descargado declara **opset 20**. Ya integra las 300 predicciones finales, por lo que no se aplica un NMS adicional.
- El 2026-10-06 se verificó que `https://huggingface.co/besit/yolo-onnx/resolve/main/yolo26n.onnx` existe, descarga 9.9 MB y el archivo final entrega `Access-Control-Allow-Origin: *`. Es una conversión pública **de terceros**, no un repositorio oficial de Ultralytics.
- En tiempo de carga SONIC valida la forma esperada. Si el origen remoto falla, intenta un fallback real: `./assets/yolo26n.onnx`. Consulta [assets/README.md](assets/README.md) para preparar esa copia local reproducible.
- Sin API keys. ONNX Runtime Web y Tesseract.js se cargan desde jsDelivr; Tesseract descarga además los datos de idioma español/inglés la primera vez.

## Estado del prototipo

| Componente | Estado |
|---|---|
| Cámara trasera Android/Chrome | ✓ Solicita `facingMode: environment`, libera los tracks al detener y exige HTTPS/localhost |
| YOLO26 | ✓ URL, CORS, tensor y decoder validados; fallback ONNX local documentado |
| OCR / SE RENTA | ✓ Tesseract local `spa+eng`, normalización y tolerancia a un error; se ejecuta cada 2.5 s, no por frame |
| GPS | ✓ Estados SEARCHING / READY / DENIED / UNAVAILABLE; nunca inventa coordenadas |
| Motor de eventos | ✓ Estructura uniforme, evidencia en memoria y deduplicación temporal/GPS |
| Evidencia | ✓ Frame, tiempo, GPS disponible y texto OCR; función `sanitizeEvidence()` preparada |
| Bache / luminaria / inundación | ⚠ Adaptadores `model_not_connected`: no producen detecciones ficticias |

## Diagnóstico y rendimiento

El botón **⚙ DIAGNÓSTICO** comprueba contexto HTTPS, cámara, GPS, WebAssembly, ONNX Runtime, descarga del modelo, una inferencia real sobre un cuadro vacío y el worker OCR. La interfaz muestra preprocesamiento, inferencia, postprocesamiento y tiempo total. El loop espera a que una inferencia termine antes de iniciar la siguiente; ajusta su intervalo entre 250 y 1500 ms.

## Pruebas

Sirve la carpeta y abre `http://localhost:8000/test.html`. Cubre normalización y matching OCR, decoder/threshold YOLO, deduplicación, fallback GPS y persistencia de obstáculos. La prueba de dispositivo real se realiza desde **DIAGNÓSTICO** y con el flujo de Pixel siguiente.

## PRUEBA EN GOOGLE PIXEL

1. Aloja la carpeta mediante HTTPS (Netlify Drop, GitHub Pages o Cloudflare Pages). No uses `file://` ni una IP local sin HTTPS.
2. Abre la URL con Chrome Android y toca **⚙ DIAGNÓSTICO**. Deben aparecer READY para Browser/HTTPS, WebAssembly y ONNX Runtime; espera las comprobaciones de modelo y OCR.
3. Toca **INICIAR SONIC** y concede cámara y ubicación. Verifica `Camera READY`, `GPS READY` (o el estado exacto del permiso) y `YOLO26 LOADED`.
4. Prueba primero **DEMO** para validar el OCR real del texto `SE RENTA`; los eventos conservan la marca DEMO y no se mezclan con cámara.
5. Para una prueba sin conexión a Hugging Face, copia el ONNX verificado a `assets/yolo26n.onnx` antes de publicar.

## Qué es real y qué es experimental
| Módulo | Estado |
|---|---|
| Objetos YOLO26 (80 clases COCO: person, car, truck…) | Real |
| 🏠 SE RENTA (OCR + normalización + tolerancia a 1 error) | Real |
| 🚧 OBSTÁCULO (YOLO + zona `obstacleZone` + tamaño + persistencia) | Real, heurístico: no distingue si el vehículo está detenido |
| 🕳️ Bache · 💡 Luminaria fundida · 💧 Inundación | **Adaptadores sin modelo** (`model_not_connected`). YOLO26 base no tiene esas clases |
| DEMO | Imagen sintética con el texto "SE RENTA": prueba el OCR de verdad, pero NO es una captura de cámara y sus eventos salen marcados DEMO |

## Conectar tus modelos propios
Entrena (por ejemplo YOLO26n ajustado con fotos locales de baches/luminarias), expórtalo a ONNX y en `pothole-detector.js` / `lamp-detector.js` / `flood-detector.js` implementa `load()` y `analyze(frame, ctx)` devolviendo `{ detected, confidence, status: "experimental" }`. El motor ya los invoca y los marca EXPERIMENTAL.

## Privacidad
Todo corre en el navegador. Las imágenes de evidencia viven en memoria y se pierden al cerrar la página.

## Limitaciones conocidas
- Se verificaron URL, CORS, pesos y tensores desde desarrollo, pero el rendimiento y permisos finales todavía necesitan una prueba en tu Pixel físico. El panel muestra la medición real; no usa una estimación como resultado.
- Sin difuminado de rostros/placas todavía. `sanitizeEvidence()` es el punto de extensión previsto antes de persistir evidencia fuera de memoria.
- ONNX Runtime Web usa WASM/CPU. Si el teléfono tarda, el loop reduce automáticamente la frecuencia sin lanzar inferencias simultáneas.
