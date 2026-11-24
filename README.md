# SatTracker 📡

PWA (single page app instalable) para trabajar satélites de radioaficionados con una antena Yagi.

- **Pasadas**: horario de aparición (AOS), punto más alto y puesta (LOS) según tu lat/long, con dirección de entrada/salida y elevación máxima.
- **Guía de apuntado**: pasos concretos para la Yagi (hacia dónde esperar, cómo seguirlo, volteo en pasadas cenitales, polarización), tabla minuto a minuto de azimut/elevación y carta del cielo.
- **Apuntar en vivo**: azimut/elevación en tiempo real, Doppler instantáneo y brújula con el teléfono apoyado sobre el boom ("girá 20° a la derecha · subí 10°").
- **Frecuencias** de cada satélite (subida, bajada, modo, tono CTCSS) y tabla Doppler AOS/máx/LOS.
- **Grabación y log**: grabá el audio de la pasada (micrófono del teléfono o cable), marcá cada QSO con un toque (queda la hora UTC y una marca en el audio), completá indicativo/grid/RST escuchando de nuevo, y exportá un **ADIF** listo para **LoTW** (firmar con TQSL) y **QRZ Logbook** (Settings → ADIF Import). El nombre de satélite va como lo exige LoTW (ISS → `ARISS`). Si la app se cierra grabando, el audio se recupera al reabrirla. Todo queda guardado en el teléfono.
- **Imagen para redes**: desde el Log, cada pasada genera una imagen 1080×1350 con el satélite, un mapa con tu estación, los corresponsales, la traza y la huella del satélite, la trayectoria en el cielo con la posición de cada QSO, cantidad de QSOs y grids, ODX en km y la lista de contactos, lista para compartir en Instagram, WhatsApp, X o Facebook.
- Funciona **sin conexión** una vez instalada. Los TLE se bajan de CelesTrak cada 12 h (trae una copia incluida).

Sin build: HTML + CSS + JS (módulos ES). Órbitas con SGP4 vía [satellite.js](https://github.com/shashwatak/satellite-js) (incluido en `vendor/`).

## Probar en la compu

```bash
python3 -m http.server 8765
```

Abrir http://localhost:8765

## Instalar en el teléfono

El GPS, la brújula y la instalación como app **requieren HTTPS**. Opciones:

1. **Publicarla gratis** en GitHub Pages, Netlify o Cloudflare Pages (subir la carpeta tal cual).
2. Abrir la URL en el teléfono:
   - **iPhone**: Safari → Compartir → *Agregar a pantalla de inicio*.
   - **Android**: Chrome → menú ⋮ → *Instalar app*.

## Estructura

| Archivo | Qué hace |
|---|---|
| `js/sats.js` | Lista de satélites y frecuencias (editala para agregar/corregir) |
| `js/orbit.js` | Propagación, predicción de pasadas, Doppler |
| `js/app.js` | Interfaz |
| `sw.js` | Cache offline (subir `CACHE` de versión al cambiar archivos) |
| `data/amateur.tle` | Copia inicial de TLE (grupo *amateur* de CelesTrak) |

Las frecuencias y el estado de los satélites cambian: verificá en [AMSAT Live Status](https://www.amsat.org/status/) antes de transmitir.
