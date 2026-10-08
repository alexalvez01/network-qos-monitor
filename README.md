# Network QoS Monitor

Aplicación React Native (CLI) que mide la calidad de la red móvil — latencia,
jitter, pérdida de paquetes y throughput —, georreferencia cada medición con
GPS, la guarda en SQLite en el dispositivo y muestra la cobertura como mapa de
calor, gráficos de series temporales e historial filtrable. Trabajo práctico
de Desarrollo de Aplicaciones Móviles (FCyT, Concepción del Uruguay).

**Estado: las 7 etapas están implementadas y verificadas de punta a punta en
el emulador de Android 17 (API 37)** — mediciones en primer plano, recorridos
en el mapa, gráficos del historial, exportación y muestreo en segundo plano con
la app cerrada. El video demo y el APK release se generan en `entregables/`
(no versionado en git). Pendiente: un recorrido con un celular real en 4G/5G.
Ver [Limitaciones](#limitaciones).

## Inicio rápido

```bash
git clone https://github.com/alexalvez01/network-qos-monitor.git
cd network-qos-monitor/app
npm install
npm run android            # o: npx react-native run-android
```

Requisitos (verificados en la máquina del autor, PLAN.md §1):

| Componente | Valor |
|---|---|
| Node / npm | v24.14.0 / 11.11.0 |
| JDK | JBR incluido en Android Studio (OpenJDK 25.0.2) — `JAVA_HOME` apuntando a `<Android Studio>\jbr` |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk` — definir `ANDROID_HOME` ahí; `app/android/local.properties` también fija `sdk.dir` para que el build no dependa de variables de entorno |
| Plataforma SDK | `android-37` (coincide con `compileSdk 37` de RN 0.87); `minSdk 24`, `targetSdk 36` |
| Build | Hermes y New Architecture activados; un `assembleDebug` en frío tarda ~6,5 minutos |

Verificar el proyecto antes de modificar nada:

```bash
cd app
npm test            # Jest — capas en TS puro, no requiere dispositivo
npm run lint        # ESLint
npx tsc --noEmit    # TypeScript
```

## Qué mide

| RF | Funcionalidad | Dónde |
|---|---|---|
| RF-01 | Tipo de conexión + subtipo de radio, operador, dBm, identidad de celda | `src/store/networkStore.ts`, `src/telemetry/`, `src/specs/` (spec del TurboModule) |
| RF-02 | RTT mín/prom/máx, jitter y pérdida con sondas TCP connect a ≥3 hosts configurables | `src/screens/MeasureScreen.tsx`, `src/measurement/probe.ts`, `stats.ts`, `engine.ts`, `settingsStore.ts` |
| RF-03 | Throughput de descarga / subida contra el backend de referencia | `src/measurement/throughput.ts`, `foregroundPass.ts` |
| RF-04 | Recorridos (sesiones) + muestras con GPS, tipo de red y dBm en SQLite | `src/measurement/measureController.ts`, `src/data/` |
| RF-05 | Mapa de calor de cobertura (latencia / throughput / señal) sobre tiles OSM | `src/visualization/heat/`, `heatLayer/` |
| RF-06 | Lista de recorridos + gráficos de latencia y throughput | `src/screens/HistoryScreen.tsx`, `visualization/charts/` |
| RF-07 | Muestreo periódico en segundo plano + alerta de degradación | `src/background/`, `src/notifications/` |
| RF-08 | Exportación CSV / JSON mediante el menú de compartir | `src/export/` |
| RF-09 | Filtros del historial: tipo de red, rango de fechas, zona | `src/visualization/history/history.ts` |

## Arquitectura

Cuatro capas. Las dependencias apuntan hacia adentro; ninguna capa importa
detalles internos de otra. Versión completa: `docs/architecture.md`.

```
Medición (motor, sondas, throughput — TS puro)
    │ publica resultados
    ▼
Estado (stores Zustand — el ÚNICO contrato entre capas, ADR-9)
    ▲ se suscribe             ▲ lee mediante hooks
Visualización (pantallas, mapa, gráficos)   Persistencia (op-sqlite vía repositorio)
    └── el muestreo en segundo plano y la exportación también hablan con los stores, nunca con las pantallas
```

- **Zustand como punto de unión (ADR-9).** `networkStore`,
  `visualizationStore`, `backgroundStore`, `measurementStore` y `walkStore`
  guardan solo estado de UI. El trabajo asíncrono (lecturas del repositorio,
  pasadas de sockets) vive en motores y controladores. Ningún store importa
  código nativo, así que todos cargan bajo Jest.
- **Inyección de dependencias (testeable sin dispositivo).** Cada componente
  recibe su dependencia por parámetro: el motor recibe un `TcpTransport`, el
  repositorio una `Database`, las pasadas de medición reciben transporte,
  repositorio, localizador, notificador y reloj. Los tests inyectan fakes; en
  el dispositivo se inyectan `react-native-tcp-socket`, `op-sqlite` y el GPS
  del sistema. Ninguno de estos módulos importa código nativo al cargarse.
- **Núcleo en TS puro.** Planificación de sondas, jitter RFC 3550, pérdida,
  cálculo de Mbps, percentiles, construcción de SQL, agregación del mapa de
  calor, proyección de tiles, series de gráficos, resúmenes y filtros del
  historial son TypeScript sin imports de React/React Native — 176 tests de
  Jest corren en Windows sin emulador.
- **Capa nativa (delgada a propósito).** El spec del TurboModule
  (`src/specs/NativeNetworkTelemetry.ts`) está implementado en Kotlin/Swift
  para los datos de radio; `HeatMapView` dibuja las celdas ya agregadas; el
  background fetch delega la cadencia a WorkManager. Toda la lógica de
  decisión queda en TS.

## Decisiones de diseño (ADR-1…ADR-10, resumidas)

| ADR | Decisión |
|---|---|
| 1 | La telemetría nativa es un TurboModule con codegen, orientado a eventos (métodos para lecturas puntuales, eventos nativos para cambios de señal/red) — no un módulo del bridge legacy. |
| 2 | iOS expone **solo el tipo de red**. El operador está ofuscado desde iOS 16.4 y el RSSI nunca fue público; la UI muestra "no disponible en esta plataforma", nunca valores inventados. Android arma el heatmap con dBm, iOS con latencia/throughput. |
| 3 | El muestreo en segundo plano está garantizado en Android (WorkManager) y es **oportunista en iOS** (`BGAppRefreshTask` según el presupuesto energético del sistema). Es un alcance declarado, no una falencia. |
| 4 | Latencia = **tiempo de TCP connect() al puerto 443** (un round trip): sin ICMP (bloqueado en redes móviles e inaccesible desde JS), sin TLS (los round trips extra contaminan la muestra). Hosts por defecto `1.1.1.1`, `8.8.8.8`, `9.9.9.9`. |
| 5 | El throughput se calcula **en el cliente sobre sockets crudos** contra un backend simple, así la latencia del servidor y el overhead de `fetch` no distorsionan los Mbps. |
| 6 | Persistencia en SQLite con **`@op-engineering/op-sqlite`** (JSI, New Architecture): escaneos por rango de tiempo, filtros por red y consultas por zona son justamente para lo que sirven los índices SQL. Se descartaron `react-native-sqlite-storage` (bridge legacy) y WatermelonDB (sincronización innecesaria). |
| 7 | Mapa de calor = círculos translúcidos con radio ponderado sobre **tiles raster de OSM**, dibujados por un mapa propio (Images + SVG) — sin tokens de proveedores de mapas. Se quitó `react-native-maps`: sin una key de Google la app se cierra en Android, y con una key de relleno no dibuja nada. |
| 8 | Los gráficos se dibujan **directamente con `react-native-svg`** — `victory-native` arrastraría Skia + Reanimated para dos gráficos de línea. |
| 9 | **Zustand es el único punto reactivo** entre el trabajo en segundo plano y la UI; sockets y timers quedan fuera del ciclo de render. |
| 10 | **Android es el entorno de desarrollo** (builds locales) e **iOS el dispositivo de validación**; el TypeScript compartido es el grueso del producto y sirve a ambos. Android cubre todos los RF; iOS cubre RF-02…RF-09 y un RF-01 deliberadamente reducido. |

## Backend de referencia

El throughput necesita un servidor de payload. Está en `backend/` (entregable
aparte): un servicio Fastify con exactamente los dos endpoints que usa la app:

- `GET /download?bytes=N` — entrega un buffer fijo de N bytes.
- `POST /upload` — devuelve la cantidad de bytes recibidos.

La app solo calcula `mbps = bytes / tiempo` en el dispositivo (ADR-5);
cualquier servidor que respete ese contrato funciona. Se configura desde
**Measure → Test settings → Reference backend** (queda guardado en el
dispositivo). Por defecto es `127.0.0.1:3000`, que llega a la PC mediante
`adb reverse tcp:3000 tcp:3000` (emulador o celular por USB); en una red local
usar la IP de la PC. Instrucciones de despliegue (incluye Docker):
`backend/README.md`.

## Limitaciones

La consigna las pide explícitamente. Versión detallada: `docs/limitations.md`.

1. **El muestreo en segundo plano en iOS es oportunista, no garantizado**
   (ADR-3). El sistema decide cuándo se ejecuta `BGAppRefreshTask`; "cada 15
   minutos con la app cerrada" no es alcanzable en iOS tal como está escrito.
2. **iOS expone solo el tipo de red** (ADR-2). El operador devuelve valores de
   relleno desde iOS 16.4 y el RSSI nunca fue público; el heatmap usa
   latencia/throughput y los campos faltantes se muestran como "Not available".
3. **`@notifee/react-native` (9.1.8) no tiene mantenimiento activo.** Funciona
   en RN 0.87 / Android 17 (alertas verificadas en el emulador, en primer plano
   y con la app cerrada), pero no publica versiones desde 2024-12.
4. **El mapa es un renderizador propio mínimo** (arrastrar + botones de zoom,
   sin pinch) que descarga tiles de tile.openstreetmap.org con un User-Agent
   identificatorio y la atribución requerida; para uso intensivo hace falta
   otro servidor de tiles.
5. **Para una demo creíble hay que medir en 4G/5G real, no en el Wi-Fi de la
   facultad.** Los números de Wi-Fi no representan la calidad de red móvil que
   plantea la consigna.
6. **Las pasadas en segundo plano solo hacen sondas (sin throughput)** para
   respetar el tiempo y la batería disponibles — el historial de segundo plano
   cubre latencia, pérdida y jitter.

## Video demo

`entregables/NetworkQoSMonitor-demo.mp4` (4:52, grabado desde el emulador de
Android con su propio grabador de pantalla, reproducido a 1,3×). Muestra la
detección de red pasando de Wi-Fi a 5G NR (operador, dBm), los hosts
configurables, dos recorridos reales (uno sobre el enlace 5G del emulador y
otro sobre Wi-Fi) con RTT / jitter / pérdida / throughput en cada prueba, la
repetición automática con alerta de degradación, el mapa de calor por métrica,
los filtros y gráficos del historial y el estado del muestreo en segundo plano.
**Todos los números son mediciones reales; las posiciones GPS son simuladas**
(`adb emu geo fix`) y el módem 5G del emulador reporta un dBm fijo. Para la
defensa conviene grabar además un recorrido con un celular real en 4G/5G.

## Ejecución en el emulador

```bash
cd backend && npm install && npm start          # backend de referencia en :3000
adb reverse tcp:3000 tcp:3000                   # 127.0.0.1:3000 de la app → PC
adb install -r entregables/NetworkQoSMonitor-release.apk
adb emu geo fix -58.2320 -32.4840               # GPS simulado (lng lat)
adb shell svc wifi disable                      # pasar al enlace celular
```

Forzar una pasada en segundo plano sin esperar 15 minutos (con la app en
segundo plano o cerrada — no con force-stop, que cancela los jobs):

```bash
adb shell cmd jobscheduler run -f com.networkqosmonitor 999
```

## Estructura del repositorio

```
network-qos-monitor/
├── PLAN.md                 # plan de implementación, etapas, registro de riesgos
├── README.md               # este documento
├── docs/
│   ├── architecture.md     # capas, puntos de inyección, módulos, estrategia de testing
│   └── limitations.md      # limitaciones de plataforma y dependencias, en detalle
├── app/                    # aplicación React Native CLI (RN 0.87.1)
│   └── src/
│       ├── measurement/    # motor, sondas, throughput, estadísticas, controlador de recorridos (TS puro)
│       ├── data/           # esquema SQLite, consultas, repositorio, geo (puro + capa nativa delgada)
│       ├── telemetry/      # consumo del módulo nativo, composición con NetInfo
│       ├── store/          # store Zustand de red
│       ├── visualization/  # mapa de calor, tiles, gráficos, filtros del historial, tema, stores
│       ├── background/     # pasadas con WorkManager, detección de degradación, store
│       ├── notifications/  # wrapper de Notifee
│       ├── export/         # serializadores CSV/JSON + menú de compartir
│       ├── permissions/    # flujo de permisos en tiempo de ejecución
│       └── screens/        # Status, Measure, Map, History, Export
└── backend/                # servidor de referencia Fastify (entregable aparte)
```

## Checklist de revisión

- [ ] `npm test` en verde (23 suites, 176 tests), `npx tsc --noEmit` sin errores
- [ ] Los filtros se combinan (red + fecha + zona) y "Clear" restaura la lista completa
- [ ] Cada pantalla indica explícitamente carga / error / vacío — nunca una pantalla en blanco
- [ ] Ninguna pantalla inventa operador o dBm cuando la plataforma no los provee
- [ ] Los datos de demo siempre están rotulados como "demo" (capa del mapa, nombre del recorrido de ejemplo)
