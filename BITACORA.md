# Bitácora — Kripto Wallet

---

## 2026-08-19 (noche) — Jugada B: rotación XRP → HEMI + ZEC

- **Contexto:** real 83,68 vs ficticia 81,10 (−2,50). La brecha es el costo ya
  pagado de GPS (−1,31) y ACE (−0,81) + reserva parada en el rally (~−0,35).
  Meta declarada: recortarla en 48 h. El ancla no genera alfa; toda la
  diferencia debe salir del sleeve (~20 USDT) → necesita +12,5 pp sobre los
  alts de la real. Se presentaron 4 propuestas (A disciplina, B rotación,
  C plan del modelo con 3 avisos altos, D romper el techo del sleeve).
- **Elegida por Jorge: B** — vender el único sleeve sin tesis y abrir 2
  momentum fuera de cuarentena:
  - VENDER 9,276 XRP @ 1,0549 → 9,79 USDT
  - COMPRAR 555 HEMI @ 0,009 ← 5,00 · salida +30% / −12% · horizonte 2 días
  - COMPRAR 0,00876 ZEC @ 547,2 ← 4,80 · salida +12% / −6% · horizonte 2 días
- **Aviso registrado:** ZEC 4,80 queda bajo el mínimo real de Binance (~5).
- **Sin tocar:** SOL (+5,5%, a 0,44% de su auto-take +6%), ETH (−0,2%),
  ancla BTC, reserva (quedó en 10,17 — la jugada pasó por ella sin gastarla).
- **Dos bugs corregidos durante la jugada:**
  1. **Cuarentena ciega a auto-stops:** `diasDesdeCorte()` solo reconocía
     `"corte por límite"`; los cierres del monitor (`"auto-stop: ..."`) eran
     invisibles y el modelo proponía recomprar ACE sin aviso. Regex ampliada;
     verificado: la propuesta ahora levanta 3 avisos altos.
  2. **Imposible comprar activos nuevos:** `jugadaManual()` usaba el snapshot
     ligero (solo símbolos de la cartera) → "HEMI no tiene par USDT".
     `marketSnapshotLigero(extra)` ahora acepta los activos de la jugada.
     ETH ayer pasó de casualidad (estaba en la wallet real).
- **Riesgo de la tarde (RSI 1h al momento de la jugada):** ETH 91 y SOL 84
  (mercado caliente tras el rally), ZEC 81, HEMI 67 con velas de ±6%/hora.
  Escenarios: si sigue el rally, SOL toma su +6% y el sleeve suma ~+0,9;
  si el mercado se enfría, ETH es la más expuesta (entró cerca del techo,
  stop −4% = 2000) y el sleeve puede devolver ~−0,8. La vigilancia (cada
  3 min) corta sola **solo con el Mac despierto**.

## 2026-08-19 — BUG: la cuarentena no veía los auto-stops

- **Hallazgo (durante el análisis de la tarde):** `diasDesdeCorte()` filtraba
  movimientos con `/corte por límite/`, pero los cierres del monitor se
  registran como `"auto-stop: ..."` — resultado: ACE (cortada hoy a −16,3%)
  era invisible para la cuarentena y el modelo proponía **recomprarla sin
  aviso**. GPS sí avisaba solo porque su corte manual usó el texto antiguo.
- **Fix:** regex ampliada a `/corte por límite|auto-stop/i` en `src/engine.mjs`.
- **Verificado:** análisis regenerado → 3 avisos altos (cierra SOL con stop
  vigente · recompra ACE en cuarentena · recompra GPS en cuarentena).
- **Lección:** cuando dos caminos del código registran el mismo concepto
  (corte por stop), el tipo del evento debe ser un dato estructurado, no un
  texto a parsear. Candidato a mejora: campo `categoria: 'stop'` en el evento.

## 2026-08-19 — AUDIT (Opus 5) · Crítico 1 resuelto

- **Hallazgo:** el botón dorado iba a rebalancear automáticamente hoy
  (`wallet.lastRun` = 18 ≠ hoy). Simulación previa: liquidaba **69,84 USDT
  (89% de la wallet)** — ancla BTC/XRP incluida, gastaba la reserva USDT,
  cerraba SOL ignorando su stop, y **recompraba GPS** (cortada anoche a −26%)
  y EDEN (−28% desde su techo). Causa raíz: `rebalance()` asume que toda la
  wallet es su cancha; el modelo táctico (ancla + reserva + stops) vivía en
  las reglas pero nunca entró al código.
- **Solución elegida por Jorge (opción B + card desplegable):**
  - `runAnalysis()` **nunca aplica**: siempre calcula sobre una copia y
    devuelve una PROPUESTA. Verificado: MD5 de `wallet.json` idéntico antes y
    después de ejecutar el análisis.
  - Nuevo endpoint `POST /api/aplicar-plan` — acto explícito, con confirmación
    en el dashboard.
  - Card "Propuesta del modelo" con resumen (cuánto rota, comisiones) y
    **avisos de impacto** en rojo/dorado.
  - Los stops (`salidas`) ya no se pierden al analizar (arregla también el
    hallazgo #4 del audit).
- **Avisos funcionando en la propuesta de hoy** (ACE · GPS · ALPINE):
  liquida BTC (61% del capital), cierra SOL con stop vigente, gasta la
  reserva, **recompra GPS en cuarentena**, rota el 89% de la wallet.
- **Decisión operativa:** la propuesta de hoy NO se aplicó — los avisos la
  desaconsejan. Pendiente el rediseño de bolsillos (ancla / reserva / sleeve),
  que es el crítico 3 del audit.

## 2026-08-19 — Card "Registro del sistema"

Jorge notó que la reserva USDT había subido a ~15 y pidió ver qué ejecuta el
sistema cuando nadie opera. Trazabilidad del incremento:

| Origen | Monto | Tipo |
|---|---|---|
| Corte de GPS (18-08, 23:54 local) | +3,69 | automático (stop) |
| Cosecha de excedente del sleeve (19-08) | +7,33 | manual (Jorge) |
| Auto-stop de ACE (19-08, 12:58 local) | +4,18 | **automático, laptop cerrado** |

**Nueva card "Registro del sistema"** (`b-auto` en el bento, junto al
historial): tabla agrupada por **fecha local** con **hora exacta**, insignia
por tipo de evento (AUTO-STOP / OBJETIVO / ALERTA), el detalle de la operación,
el PnL del cierre y cuánto entró a reserva. El encabezado resume:
*"2 evento(s) · 7,87 USDT movidos sin ti"*.

Incluye también las alertas de cruce que **no** derivaron en operación, para
que no quede ningún evento del sistema invisible. Las `alertas` se agregaron a
las tres respuestas de la API (antes solo estaban en `/api/state`).

Detalle de correctitud: la agrupación usa **fecha local**, no UTC — por eso el
corte de GPS (03:54 UTC) aparece bajo el 18 de agosto (23:54 hora de Chile) y
no bajo el 19.

**Archivos tocados:** `src/engine.mjs` (`alertas` en las 3 respuestas de la
API), `public/index.html` (card `b-auto`), `public/assets/js/app.js`
(`esAutomatico()` + `renderRegistroAuto()`), `public/assets/css/app.css`
(`.tabla-auto`, `.badge-auto` y los spans del bento en los 4 breakpoints:
6/12 col en desktop, 6 en ≤1279, 12 en ≤1023, orden 10 en móvil).

**Documentación sincronizada:** el bento del README pasó de 5 a 6 filas
(fila 5 = Registro del sistema · Historial, fila 6 = Hoja de ruta) y el ritual
diario del plan incorpora **leer el registro antes de operar** — si la reserva
cambió sin que Jorge operara, la respuesta está ahí y debe verse antes de
tomar cualquier decisión del día.

## 2026-08-19 (tarde) — Jugada: ETH, y hallazgo de un tokenizado que se filtró

- **Contexto:** rally amplio de mercado (BTC +5,5%), no un pump aislado como
  ACE/GPS/HEMI — volumen subiendo pareja 2-7x en todo el universo.
- **Skills usados:** `trading-expert` (principios: nunca sin stop, dimensionar
  por volatilidad, evitar sobre-optimización) + `finance-expert` cargados
  para enmarcar el análisis; el análisis de mercado en sí se hizo con datos
  reales de Binance (radar + RSI + tendencia de volumen), no con las skills.
- **Hallazgo de auditoría — CRCLB casi se cuela:** apareció en el radar con
  buen momentum y volumen. Volumen de fin de semana: 11,1% del de un día
  hábil (vs RE, comparable, en 70% — comportamiento cripto normal). Mismo
  patrón que las acciones tokenizadas ya excluidas; es casi seguro CRCL
  (Circle) tokenizada. Se filtró por estar apenas sobre el umbral del 10%.
  **Agregada a `TOKENIZADOS`** en el motor; servidor reiniciado para aplicar
  el cambio.
- **Decisión sobre SOL** (a $0,10 de su objetivo +6%): se deja correr hacia
  el auto-stop, sin adelantarse — el rally sigue en curso.
- **Jugada ejecutada — ETH, 5 USDT** (`POST /api/jugada`): elegida sobre LINK
  y RE por ser la más líquida del radar (938M vol 24h) con RSI sano (65),
  parte del rally legítimo del mercado. Límite −4% / objetivo +10% (por
  volatilidad real: 2,4% diaria). Sleeve quedó en 20,11 USDT (24,7% — justo
  bajo el techo del 25%).
- **Resultado:** real 84,15 · ficticia 81,55 · alfa −1,08 (sin cambios
  significativos, la jugada recién abre).
- **Lección:** tercer día seguido evaluando candidatas de "momentum puro" y
  la tercera vez que una resulta sospechosa (ACE microcap pump, GPS microcap
  pump, hoy CRCLB tokenizada). El filtro de volumen finde (10%) funciona pero
  su margen es estrecho — vigilar si aparecen más casos límite.

## 2026-08-19 (tarde) — Auto-stop de ACE mientras el laptop estaba cerrado

- **Contexto de mercado:** rally fuerte, BTC +5,6% (64.335 → 68.386), casi todo
  el universo en verde (XRP +6,1%, ETH +8,9%, SOL +5,9%).
- **16:58 — AUTO-STOP ejecutado en ACE** (sin intervención): cruzó su límite
  de −12% (entrada 0,227) y el monitor la vendió a 0,19 → **4,18 USDT a
  reserva**. PnL final: **−16,3%** (algo más abajo del límite exacto: el
  monitor chequea cada 3 min, no tick a tick, y cayó rápido entre chequeos).
- **Lectura:** ACE cayó CON el mercado subiendo — no fue un desplome general,
  fue la corrección de su propio pump insostenible (venía de +130%
  momentum/+63% 24h). Mismo patrón que GPS: comprar el techo de un pump.
- **El sistema hizo su trabajo:** el ancla (BTC) capturó el rally intacta
  mientras el sleeve absorbía el golpe táctico — para esto existen los
  bolsillos.
- **Resultado:** real 84,23 USDT (+5,07% del día) · ficticia 81,61 USDT ·
  **alfa −1,09 USDT** (se dio vuelta: el ancla se llevó todo el rally, el
  sleeve el golpe).
- **Pendiente de decisión de Jorge:** SOL en +5,97%, a un pelo de su objetivo
  (+6%) — puede cruzarlo solo con el rally en curso.
- Snapshot real re-verificado desde Chrome (05:15): cantidades sin cambios.

## 2026-08-19 (día 3) — Jugada: cosecha de excedente del sleeve

- **Contexto de mercado:** BTC +0,27%, ETH +0,91%, mercado tranquilo. ACE lideraba
  ganadoras en Binance (+41,85% 24h), confirmando la posición abierta.
- **Propuesta automática del modelo (NO aplicada):** quería recomprar GPS
  (todavía en cuarentena tras el corte de ayer a −26%) y cerrar SOL sin
  necesidad. Dos avisos en rojo — se descartó.
- **HEMI evaluado y descartado:** momentum 7d +70,9% pero volumen cayendo de
  31M a 2,76M USDT/día tras el pump — mismo patrón que GPS antes de
  desplomarse. Ofrecido como opción, Jorge eligió no arriesgar.
- **Jugada ejecutada — cosecha de excedente (vía `POST /api/jugada`):**
  el sleeve estaba en 34% (techo 25%, 7,33 USDT de excedente). Se vendieron
  7,325605 XRP → 7,33 USDT a reserva. Sin comprar nada nuevo.
  - XRP no tenía stop registrado (no es posición táctica con salida) — la
    cosecha no tocó a ACE ni SOL, que siguen corriendo intactas.
- **Resultado:** sleeve 19,65 USDT (25,0% exacto) · reserva 11,01 USDT (antes
  3,69) · ficticia 78,87 USDT.
- **Posiciones al cierre de la jugada:** ACE +7,71% (objetivo +25%/−12%),
  SOL −0,12% (objetivo +6%/−4%). Ninguna cerca de su nivel.
- **Alfa del modelo:** +0,44 USDT — el sleeve sigue por sobre lo que esa
  plata habría hecho quieta en BTC.
- **Lección del día:** la disciplina "no aplicar la propuesta automática
  ciegamente" ya evitó un segundo golpe tipo GPS (recompra en cuarentena) y
  una entrada tardía a un pump (HEMI). La regla de avisos está funcionando.

## 2026-08-19 (cierre) — Documentación sincronizada

Al revisar los documentos contra lo que el sistema realmente hace aparecieron
**tres reglas desfasadas** en PLAN-DE-ACCION.md, ya corregidas:

1. El ritual decía que el análisis "aplica" el rebalanceo. Desde el crítico 1
   del audit **el análisis solo propone**; aplicar es un acto explícito. Se
   reescribió el paso 2 incluyendo los avisos de impacto y las jugadas propias
   por `POST /api/jugada`.
2. El paso 5 mandaba backtestear con el skill instalado, que **no puede traer
   pares de Binance**. Ahora apunta a `src/backtest.mjs`.
3. La métrica principal era "ficticia vs hold" — que con el sleeve acotado al
   25% mide a bitcoin, no al modelo. Ahora manda el **alfa del sleeve**.

También se agregaron dos reglas de la casa que existían en el código pero no
estaban escritas: **toda posición nace con salida dimensionada por
volatilidad** (con auto-stop en la ficticia) y **el motor propone, Jorge
dispone**. Y v2a (filtro RSI<75) quedó en la tabla de versiones como candidata
pendiente de decisión.

README actualizado con la interfaz (sala de control, bento, colapsables,
billeteras 7/5, gráficos de área), la nota de rendimiento del snapshot ligero
y la estructura completa de `data/`.

**Snapshot real re-verificado desde Chrome (01:40):** 79,93 USDT, sin cambios
de cantidades — la variación es solo de precios.

## 2026-08-19 — Rendimiento del motor y sala de control

**Payload: de 1,9 MB a 5,9 KB por refresco (321× menos).** `marketSnapshot()`
descargaba los **3.684 pares** de Binance para leer los precios de 11 monedas —
en cada refresco, cada vigilancia de 3 minutos y cada análisis. Ahora existe
`marketSnapshotLigero()`, que pide solo los símbolos de la cartera
(`/api/v3/ticker/24hr?symbols=[…]`). El barrido completo queda solo para el
análisis, que sí necesita el universo para rankear. Con fallback automático al
modo completo si la llamada ligera falla, y una caché de símbolos válidos para
no pedir pares inexistentes (ETHW).

Verificado tras el cambio: 11 activos valorizados, 11 tendencias 24h, 2
posiciones vigiladas y el alfa calculado — todo idéntico, 321 veces más liviano.

**Sala de control.** Franja superior con cuatro cifras que responden, antes de
leer cualquier card, "¿cómo voy?" y "¿debo actuar?":

| Tarjeta | Qué responde |
|---|---|
| **Marcador** | ficticia menos hold, la pregunta del proyecto |
| **Alfa del modelo** | lo que aporta la estrategia, limpio de mercado |
| **Vigilancia** | posiciones abiertas y si alguna cruzó su nivel |
| **Hoy** | el estado accionable: analizar / aprobar / al día |

Se actualiza también con los ticks del WebSocket. Jerarquía por tamaño (30-36px
en el número, 11,5px en la etiqueta), no por color; el color solo refuerza.
Responsive 4 → 2 → 1 columnas.

## 2026-08-19 — Audit de diseño y correcciones

Auditoría del dashboard renderizado (mediciones en el DOM, no lectura de código).

**Pasaba bien:** contraste de textos (0 bajo el mínimo WCAG), números tabulares
(30/30), jerarquía de encabezados, `prefers-reduced-motion`, cero desborde
horizontal en 375–3840 px.

**Corregido:**

| # | Hallazgo | Fix |
|---|---|---|
| 1 | 13 elementos interactivos bajo 44 px (los títulos colapsables medían 20) | min-height 44 px (48 en móvil) con márgenes negativos: el área crece sin mover el diseño |
| 2 | Textos de interfaz en 9,5–10,5 px (chips, notas, insignias) | piso de 11 px; solo los ejes de gráficos quedan en 10,5 (convención de dataviz) |
| 3 | Móvil: 10,2 pantallas de scroll | las 7 cards de consulta arrancan colapsadas la primera vez; quedan abiertas las 5 de operación → **6,6 pantallas** |

**Bug encontrado al medir el efecto del punto 3:** el colapso de cards **nunca
redujo la altura**. Usaba `grid-template-rows: 0fr`, que depende de que el
mínimo `auto` de la pista ceda, y este motor no lo respeta (medido: la pista
computaba 319 px; `minmax(0, 0fr)` tampoco servía; `height: 0` sí). Reemplazado
por altura explícita + desvanecido del contenido. Cards plegadas: de 435-956 px
a **92-116 px**.

Lección: mis verificaciones anteriores comprobaban que la clase CSS se aplicara,
no que la altura bajara. **Verificar el efecto, no el mecanismo.**

## 2026-08-19 — Rediseño: Bento Grid + gráficos de área apilada

**Bento Grid.** El dashboard estaba clavado en 1200px con 12 cards apiladas en
columna: en un monitor 21:9 o 4K quedaban dos tercios de pantalla vacíos. Ahora
es una grilla de 12 columnas con spans por importancia, y el `max-width` subió a
2400px con padding fluido (`clamp`).

Disposición en pantallas anchas (cada fila suma 12):

| Fila | Cards |
|---|---|
| 1 | Billetera real (4) · Billetera ficticia (5) · Posiciones (3) |
| 2 | Evolución real (4) · Evolución ficticia (4) · Alfa del modelo (4) |
| 3 | Propuesta (7) · Radar de mercado (5) |
| 4 | Mercado real (6) · Evolución comparada (6) |
| 5 | Historial (8) · Hoja de ruta (4) |

- **DOM reordenado** para que coincida con la disposición visual: mismo orden
  para la vista, el teclado y los lectores de pantalla.
- **Sin `grid-auto-flow: dense`**: en un dashboard la posición predecible vale
  más que el empaquetado perfecto.
- Verificado sin desbordes en **3840, 2560, 1440, 1280, 768 y 375 px**. En
  móvil todo pasa a una columna con `order` por prioridad de uso (billeteras →
  propuesta → posiciones → alfa → gráficos → registro).

**Gráficos de evolución: de líneas planas a área apilada.** Seis líneas
horizontales paralelas no comunicaban nada. Ahora cada cripto es una banda
apilada con degradado, la altura total es el valor de la billetera, hay curvas
suaves (Catmull-Rom → Bézier), línea punteada del total con su valor etiquetado
y tooltip que muestra total + composición. En la ficticia, los escalones marcan
visualmente cada jugada.

**Bug corregido:** las etiquetas del eje X se superponían ("08-1908199"); ahora
se descartan las que quedarían a menos de 58 px de la anterior.

**Billeteras: espectro completo.** Se eliminó el umbral de 0,01 USDT que ocultaba
el polvo y se agregó FDUSD (0,03) que faltaba en el snapshot. Ambas billeteras
muestran 5 filas y el resto con scroll contenido (`overscroll-behavior: contain`,
máscara degradada, contador "N activos · M más al desplazar", navegable por
teclado).

## 2026-08-19 — Métrica del sleeve (alfa vs BTC)

Último pendiente técnico del audit. Con la estrategia operando solo el 25% del
capital, comparar "ficticia total vs hold total" medía a BTC, no al modelo: una
jugada de +20% en el sleeve mueve la wallet apenas +5%, ahogada por el ruido de
bitcoin.

**Solución:** `rendimientoSleeve()` mide **cada jugada contra lo que esa misma
plata habría rendido quieta en BTC durante exactamente el mismo período**
(precio de BTC a la hora de entrada vs cierre/ahora). La diferencia es el
**alfa**: lo que aporta el modelo, limpio de mercado.

Nueva card "Rendimiento del modelo (sleeve)" con capital desplegado, PnL, alfa,
tasa de acierto y desglose por jugada. Estado actual:

| Jugada | PnL | BTC igual período | Alfa |
|---|---|---|---|
| ACE | −3,00% | −0,42% | **−2,58 pp** |
| SOL | −0,01% | −0,56% | **+0,55 pp** |
| **Total** | **−0,15 USDT (−1,50%)** | | **−0,10 USDT (−1,02 pp)** |

Lectura: el modelo va 1 punto por debajo de haber dejado esa plata en bitcoin.
SOL aporta alfa positivo (cae menos que el mercado); ACE resta. Dos días y dos
jugadas no son muestra — pero ahora la medición existe y es honesta.

## 2026-08-19 — AUDIT · Hallazgos 5 al 8 resueltos

**#5 · Historial diario congelado.** La fila del día se escribía una sola vez y
quedaba con la PRIMERA medición: el día 0 marcaba 80,10 cuando cerró en 78,51.
Corregido el dato histórico y reemplazada la lógica por `upsertHistoria()`, que
reescribe la fila del día en cada análisis y refresco (siempre el último valor
conocido). Verificado en vivo.

**#6 · Plan de día anterior.** Ya resuelto al implementar el crítico 1 (la
etiqueta muestra «⚠ de un día anterior»).

**#7 · Jugadas manuales fuera del producto.** Las tres jugadas del día 0 se
ejecutaron con scripts temporales en `/tmp` — irrepetibles. Ahora existe
`POST /api/jugada` con `jugadaManual()`: opera solo dentro del sleeve, abre
posiciones con stops dimensionados por volatilidad si no se especifican,
registra el movimiento y actualiza el dashboard. Pruebas de seguridad:
- tocar BTC → `"BTC está en el ancla: no se opera desde una jugada"` ✓
- activo inexistente → `"NOEXISTE no tiene par USDT en Binance"` ✓

**#8 · Backtester propio (`src/backtest.mjs`).** El skill instalado usa
yfinance/coingecko y no puede traer los pares de Binance donde operamos, así
que la regla «backtest obligatorio» era inejecutable. Ahora se corre con
`node src/backtest.mjs --dias 90` sobre datos reales de Binance.

### Primer backtest — 90 días, 28 activos

| Variante | Retorno | Drawdown | Sharpe | Comisiones |
|---|---|---|---|---|
| v1 actual (top3, 7d, diario) | **−11,8%** | −43,7% | 0,12 | 16,0% |
| **v2a sin sobrecompra (RSI<75)** | **+17,9%** | **−31,5%** | **1,15** | 19,1% |
| v2b ventana 30d | +2,5% | −43,0% | 0,68 | 20,0% |
| v2c rebalanceo semanal | −3,1% | −37,0% | 0,31 | 2,1% |
| v2d 30d + semanal | −7,7% | −43,1% | 0,33 | 2,0% |
| v2e 2 picks | −36,3% | −61,8% | −0,44 | 14,7% |
| *benchmark* hold BTC | −14,8% | −24,2% | — | 0% |

**Conclusiones:**
1. **El filtro RSI<75 es la mejora más clara.** Corrí el backtest dos veces con
   universos levemente distintos: v2a ganó en ambas (+58,3% y +17,9%), siempre
   con el mejor drawdown y el mejor Sharpe. Valida cuantitativamente la lección
   de GPS: entrar en sobrecompra extrema tiene castigo estadístico.
2. **El v1 actual no le gana al hold de forma convincente** (−11,8% vs −14,8%
   de BTC, con casi el doble de drawdown).
3. **Las comisiones del rebalanceo diario son brutales**: 16-20% del capital en
   90 días. El rebalanceo semanal las baja a 2% pero también el retorno.
4. **Los resultados son frágiles**: cambiar el filtro de historia mínima movió
   el v1 de +1,8% a −11,8%. Sesgo de supervivencia importante (el universo es
   el de mayor volumen HOY). Leer como comparación entre variantes, nunca como
   rendimiento esperado.

**Pendiente de decisión:** promover v2a (RSI<75) a modelo vigente para el
próximo ciclo de 7 días.

## 2026-08-19 — AUDIT · Crítico 3 resuelto (arquitectura de bolsillos)

- **Decisiones de Jorge:** ancla = **solo BTC** · sleeve = **25%** del capital ·
  el excedente del sleeve **se cosecha a reserva USDT**.
- **`wallet.json` migrada** de bolsa plana a bolsillos declarados:

  | Bolsillo | Valor | Regla |
  |---|---|---|
  | Ancla | 47,87 (61%) | BTC — el motor **no puede tocarla** |
  | Sleeve | 26,44 (34%) | XRP + SOL + ACE — aquí opera la estrategia |
  | Reserva | 3,69 | USDT — retiro y resguardo |
  | Polvo | 0,38 | MTL/RONIN/LUNA — residual |

- **`rebalance()` ahora opera solo sobre el sleeve**, con presupuesto = 25% del
  total; las ventas van a reserva y las compras salen de ella.
- **Efecto verificado en la propuesta de hoy:** antes quería liquidar 69,84 USDT
  (89%, ancla incluida); ahora mueve **21,61 USDT (27,6%)** y **BTC no aparece
  en ninguna operación** — el ancla es invisible para el motor por diseño, no
  por advertencia.
- **XRP quedó en el sleeve** (decisión implícita de sacarlo del ancla): eso puso
  el sleeve en 34%, sobre su techo, con **6,85 USDT de excedente por cosechar**.
  La primera propuesta ya lo recorta.
- **Dashboard:** tarjeta de la ficticia con los tres bolsillos, barra de
  ocupación del sleeve y chip de bolsillo en cada activo.
- **Bonus:** al reemplazar el bloque inline por `simSummary()` se cerró también
  el hallazgo #11 del audit (duplicación).
- **Pendiente que esto destapa:** con la estrategia operando solo el 25%, la
  métrica "ficticia total vs hold total" mide a BTC, no al modelo. Falta medir
  **rendimiento del sleeve vs esa misma plata quieta** (hallazgo nuevo).

## 2026-08-19 — AUDIT · Crítico 2 resuelto (vigilancia de salidas, niveles 1-3)

- **Implementado:**
  - Los stops migraron de `last-run.json` a **`data/posiciones.json`** (estado
    de posición con su propio ciclo de vida: abierta/cerrada, PnL, motivo).
  - **Card "Posiciones abiertas"**: por cada posición muestra entrada, precio
    actual, PnL en USDT y una barra que ubica el precio entre su límite (rojo)
    y su objetivo (verde), con cuánto falta para cada uno.
  - **Banner de alerta** arriba del dashboard cuando una posición cruza un
    nivel, reevaluado **tick a tick por WebSocket** (detección instantánea).
  - **Monitor de fondo** en el servidor cada 3 minutos + **notificación nativa
    de macOS**, para el caso real de anoche: dashboard cerrado, mercado abierto.
    Registro de cruces en `data/alertas.jsonl` (sin re-alertar lo ya avisado).
- **Estado al implementar:** ACE −2,7% (progreso 25% entre límite y objetivo),
  SOL +0,2% (progreso 42%). Ninguna cerca de cruzar.

### Prueba ficticia del nivel 4 (corte automático) — velas de 1 min reales

Replay del caso GPS y control de falsos positivos en ACE/SOL. **No se movió nada.**

| Posición | Mínimo alcanzado | Resultado |
|---|---|---|
| **GPS** (límite −8%) | −26,7% | cruzó a las 21:39, 168 min tras la entrada |
| ACE (límite −12%) | −6,7% | **nunca se acercó** — cero falsos positivos |
| SOL (límite −4%) | −0,4% | **nunca se acercó** — cero falsos positivos |

Salidas simuladas para GPS:
- **Auto-stop inmediato:** 0,016490 → **−8,6% (−0,43 USD)**
- Auto-stop con 2 chequeos de confirmación: 0,015220 → −15,6% (−0,78 USD)
- Corte manual real (tardío): 0,013330 → −26,1% (−1,30 USD)

**Conclusiones:**
1. El auto-stop inmediato habría ahorrado **0,87 USD** en una sola operación —
   el 17% de una posición de 5 USDT.
2. La confirmación de 2 chequeos **costó 0,35 USD extra**: en una caída
   vertical, esperar confirmación es caro. La confirmación protege de mechas
   pero cobra peaje en derrumbes reales.
3. **Cero falsos positivos** en las otras dos posiciones: sus stops estaban
   bien dimensionados (ACE −12% con mínimo en −6,7%).
4. Lección de diseño: **no hace falta retrasar el disparo si el stop está
   puesto a una distancia que el ruido no alcanza.** La confirmación es un
   parche para un stop demasiado ceñido; la solución real es dimensionarlo a
   la volatilidad del activo.

### Nivel 4 ACTIVADO (autorizado por Jorge tras ver la prueba)

- **Corte automático en la billetera ficticia**: cuando una posición cruza su
  límite o alcanza su objetivo, el monitor la vende **a USDT (reserva)** sin
  esperar, registra el movimiento, cierra la posición y notifica en macOS.
  Disparo inmediato, sin confirmación — la evidencia mostró que la demora
  cuesta más de lo que protege. **Solo la ficticia; el dinero real jamás.**
- **Prueba en seco superada**: con una posición de prueba con objetivo ya
  cruzado, el motor calculó la venta exacta a reserva y **no tocó la wallet**
  (MD5 idéntico antes y después). Archivo de posiciones restaurado.
- **Stops por volatilidad** (`stopsSugeridos()`) para posiciones nuevas —
  límite ≈ 1,5× volatilidad diaria (piso −4%, techo −15%), objetivo 2,5× el
  riesgo. Medición real:

  | Activo | Volatilidad diaria | Límite sugerido | Objetivo |
  |---|---|---|---|
  | BTC | 0,9% | −4% | +10% |
  | SOL | 1,3% | −4% | +10% |
  | GPS | 17% | **−15%** | +38% |
  | ACE | 36% | **−15%** | +38% |

  Confirma cuantitativamente la lección de GPS: se le puso un stop de −8% a
  una moneda con 17% de volatilidad diaria — el ruido normal se lo comía.
- **Aviso pendiente sobre ACE:** su stop vigente (−12%) es más ceñido que el
  que sugiere su volatilidad (−15%). No se modificó por principio (no se
  mueve la portería con el partido en juego), pero **puede saltar por ruido**.
  Decisión de Jorge si se ajusta o se deja correr.

Registro diario del ritual (ver PLAN-DE-ACCION.md). Una entrada por día.

Formato: valores en USDT al momento del registro. "Δ vs hold" = rendimiento
acumulado de la ficticia menos el del hold desde el 2026-08-18.

---

## 2026-08-18 — Audit inicial: 13 hallazgos y su resolución

*(Vivía en el README hasta el 2026-08-23; se movió acá porque es historia, no
documentación de uso. Varias entradas de esta bitácora citan estos hallazgos por
número — "el crítico 3", "el #11" — así que las referencias ahora resuelven.)*

Auditoría completa de código, datos y flujos. 13 hallazgos: 10 resueltos y
verificados, 3 descartados por decisión consciente.

### Resueltos

| # | Hallazgo | Fix |
|---|----------|-----|
| 1 🔴 | Frontera del día en UTC: después de las 20:00 de Chile permitía un segundo rebalanceo el mismo día | `fechaLocal()` en hora local para el rebalanceo diario y el historial |
| 2 🔴 | La estrategia elegía valores tokenizados de bolsa (SNXXB, SNDKB…) como si fueran criptos | Lista `TOKENIZADOS` + detección automática por volumen de fin de semana <10% |
| 3 🔴 | Un símbolo caído (delistado/error de API) tumbaba el análisis completo | try/catch por candidato; el símbolo se omite y queda en el log |
| 4 🟡 | Stables de EUR valoradas 1:1 con USDT | `STABLES_USD` (1:1) separada de las de EUR (valorizadas por su par) |
| 5 🟡 | Tras un refresco, el plan mostraba precios viejos sin indicarlo | El plan lleva su propia hora ("precios de las HH:MM") que el refresco no pisa |
| 6 🟡 | `last-run.json` embebía historia y snapshots (crecía duplicando datos) | `persistLastRun()` guarda la versión sin arrays embebidos |
| 7 🟡 | Puerto ocupado terminaba en stacktrace `EADDRINUSE` | Mensaje amable "ya está corriendo" y salida limpia |
| 8 🟡 | Ruta de Node hardcodeada a v20.20.2 (se rompía al actualizar nvm) | `run-server.sh` resuelve la versión más nueva de nvm dinámicamente |
| 10 🟢 | La Hoja de ruta contaba filas, no días calendario | Muestra "X/14 días con datos" y marca en rojo los días sin ejecutar |
| 11 🟢 | Sin aviso si el snapshot de la billetera real quedaba viejo | Advertencia dorada cuando tiene 3+ días |

### Descartados (decisión consciente, no olvido)

- **9** — Cash residual `-7e-15` en `wallet.json`: cosmético; el dashboard ya
  lo muestra correcto.
- **12** — Tooltips táctiles en gráficos: el dashboard se usa con mouse.
- **13** — Escape de tickers en innerHTML + guard de rutas más estricto: el
  servidor solo escucha en 127.0.0.1 y los datos vienen de Binance; riesgo
  práctico nulo. Retomar si el proyecto se expone fuera de localhost.

## 2026-08-18 — Día 0 (nacimiento del sistema)

- **Ficticia:** 80,08 · **Real (hold):** 80,08 · **BTC:** 64.632
- **Δ vs hold:** 0,00% (nacen idénticas por diseño)
- **Operaciones:** ninguna aplicada — la ficticia nació como copia exacta de
  la real; el primer rebalanceo será mañana.
- **Plan vigente para mañana:** vender la composición actual y entrar a
  ACE / GPS / EDEN (top momentum 7d tras excluir valores tokenizados).
- **Mercado:** BTC lateral (~64.700, +1,7% en 7d). Momentum fuerte concentrado
  en ACE (+126%) y GPS (+87%) — magnitudes así suelen venir con volatilidad
  brutal de vuelta. EDEN (+18%) más moderado.
- **Observación del día:** el audit descubrió que el radar incluía acciones
  tokenizadas (SNXXB era pick); se filtraron antes de que la ficticia llegara
  a comprarlas. El modelo v1 parte limpio.

## 2026-08-18 (tarde) — PRIMER NEGOCIO FICTICIO · Jugada A-mini

- **Decisión de Jorge** entre 3 escenarios mini presentados tras análisis
  profundo (5d + indicadores 30d + tablas exactas de conversión).
- **Conversiones ejecutadas (vía USDT):**
  - VENDER 0,449865 XRP → 0,45 USDT (completar 10,00 con el cash de 9,55)
  - COMPRAR 21,999 ACE @ 0,227 ← 5,00 USDT
  - COMPRAR 276,821 GPS @ 0,01804 ← 5,00 USDT
- **Ancla intacta:** BTC 48,03 + XRP 19,33 (+ SHIB/PEPE/polvo) = 70 USDT sin tocar.
- **Salidas programadas:** ACE +25% (obj 0,284) / −12% (corte 0,200) ·
  GPS +15% (obj 0,0207) / −8% (corte 0,0166). Se revisan en cada jugada.
- **Riesgo máximo de la jugada:** −1,00 USD si ambos límites cruzan.
- **Racional:** ACE entra tras corregir −11% desde su techo (RSI 66); GPS es
  la tendencia más limpia del mercado (4/5 días positivos, en máximos,
  volumen x1,8) pero RSI 90 → límite más ceñido. EDEN vetada (−28% en 5d).
  Se descartó liquidar el portafolio completo: jugada acotada a 10 USDT por
  regla de Jorge ("porción baja, USDT como moneda de conversión").
- **Ficticia post-jugada:** 80,00 USDT · comisiones pagadas: 0,011 USDT.

## 2026-08-18 (noche) — Jugada 2 · Limpieza de polvo + SOL

- **Regla actualizada por Jorge antes de esta jugada:** cadencia libre — se
  puede operar muchas veces al día (queda en PLAN-DE-ACCION.md).
- **Análisis previo:** consolidadas top-cap, últimos 5 días + proyección 3d.
  Mejores setups: BTC +2,4% 3d (descartada: ya es 60% de la wallet),
  **SOL +2,1% 3d, RSI 64, tendencia alcista** ← elegida por Jorge,
  ETH +1,6%, LINK proyección alta pero RSI 82. XRP/ADA/DOT/AVAX en rojo.
- **Conversiones (origen elegido: limpieza de polvo + XRP):**
  - VENDER 374.449,78 SHIB → 1,65 USDT
  - VENDER 247.235,66 PEPE → 0,64 USDT
  - VENDER 2,72 XRP → 2,72 USDT
  - COMPRAR 0,064921 SOL @ 76,94 ← 5,00 USDT
- **Salidas SOL:** objetivo +6% (81,56) / límite −4% (73,86) · horizonte 3 días.
- **Efecto colateral positivo:** la wallet quedó más limpia (sin SHIB ni PEPE).
- **Ficticia post-jugada:** 80,00 USDT · posiciones activas: ACE, GPS, SOL
  (14,96 USDT en juego, 18,7% del capital) + ancla BTC/XRP (64,7 USDT).

## 2026-08-18 (cierre del día) — Estado y mejoras del sistema

- **Marcador al cierre:** ficticia **80,06** vs hold **80,07** — empate
  técnico (−0,01): las comisiones del día ya casi se recuperaron.
- **Posiciones activas vs su entrada:**
  - ACE: 0,227 → 0,2275 (**+0,22%**) · salida +25%/−12%
  - SOL: 76,94 → 76,95 (**+0,01%**) · salida +6%/−4% · horizonte 3 días
  - GPS: 0,01804 → 0,01803 (**−0,06%**) · salida +15%/−8%
- **Mejoras del sistema hechas hoy** (además de las 2 jugadas):
  - Historial de movimientos persistente en el dashboard (bloques por día,
    `data/movimientos.jsonl`).
  - Precios en **tiempo real** vía WebSocket de Binance (badge "en vivo"),
    con incorporación automática de monedas nuevas al stream.
  - Flechas de tendencia 24h por moneda (▲/▼) en ambas billeteras, con
    tooltip informativo (variación, rango 24h, volumen).
  - Precio unitario del día visible en cada moneda.
  - Regla de cadencia actualizada por Jorge: operar libre, varias veces/día.
- **Pendiente para mañana:** revisar niveles de salida de las 3 posiciones
  al abrir el día; rebalanceo v1 disponible (hoy no se usó el automático).
## 2026-08-18 (23:50) — ⚠ CORTE DE GPS por límite de salida

- **Qué pasó:** GPS se desplomó tras el cierre — de +10,5% en 24h a cruzar el
  límite de −8% (0,0166) sin escala, llegando a −25%. La advertencia del
  análisis de entrada ("RSI 90, sobrecomprada, comprar aquí es comprar caro")
  se cumplió con brutalidad.
- **Ejecución (autorizada por Jorge):** VENDER 276,821 GPS @ 0,01333 →
  **3,69 USDT netos**. PnL de la posición: 5,00 → 3,69 = **−26,1%** (−1,31 USD).
- **Regla nueva de Jorge:** **USDT es la cripto de reserva** — todo corte o
  ganancia se convierte a USDT (vía de salida a dólares/retiro). Queda en
  PLAN-DE-ACCION.md como regla de la casa #3.
- **Posiciones activas restantes:** ACE (−1,0%, corte 0,200) y SOL (+0,2%,
  corte 73,86) — ambas sanas. Reserva USDT: 3,69.
- **Marcador:** ficticia 78,51 vs hold 79,91 (−1,75%). La brecha es GPS.
- **Lecciones (para el modelo y para nosotros):**
  1. El límite −8% en una moneda con volatilidad diaria del 20% era estrecho:
     el mercado lo saltó de largo. Los stops deben dimensionarse a la
     volatilidad del activo (ya lo hicimos con ACE −12%; GPS merecía similar
     o más).
  2. RSI 90 no era "detalle": comprar en sobrecompra extrema tiene castigo
     estadístico. Candidata a regla de modelo v2: no entrar con RSI > 80.
  3. El corte se ejecutó tarde (no monitoreamos la noche) pero se ejecutó —
     la disciplina de la regla evitó que −26% siguiera creciendo sin plan.

- **Ajustes de UI posteriores al cierre:**
  - Tooltip de tendencia reemplazado: el nativo del navegador (lento, solo
    mostraba el cursor "?") pasó a tooltip propio estilo glass — aparece al
    instante con hover o clic/toque, y se reposiciona solo.
  - Gráfico "Evolución — billetera ficticia": las posiciones nuevas
    (ACE/GPS/SOL) eran casi invisibles porque sus líneas parten a mitad del
    gráfico y se superponen en ~5 USDT. Ahora cada posición nueva marca su
    **punto de entrada con un anillo** y sus puntos con marcadores; las
    series largas marcan inicio y último valor. Verificado: 3 anillos de
    entrada visibles (uno por jugada).

## 2026-08-19 (noche) — Decisión: no perseguir el rally

- **Contexto:** rally amplio en Binance (BTC +7,6%, ETH +18,5%, SOL +11,7%,
  XRP +12,9%, LINK +12%, RE +33%). Se pidió una jugada nueva de inversión.
- **RSI 1h de todo el radar candidato: 80-92** (ETH 92, RE 89, SOL 88, XRP 83,
  LINK 81) — sobrecompra extrema simultánea. Mismo patrón que el corte de GPS
  (RSI 90, compró la cima, −26% en horas).
- **Decisión de Jorge: opción A — no hacer nada.** HEMI (RSI 53, ya enfriada)
  y ZEC (RSI 80, ya en cartera) siguen corriendo solas; SOL y ETH ya se
  cobraron automático hoy (+6% y +11,3%). Reserva 21,01 queda esperando un
  retroceso en vez de comprar la cima.
- **Regla aplicada:** no entrar con RSI > 80 en activos nuevos (candidata a
  regla de modelo v2, pendiente de convertir en filtro del motor).

## 2026-08-19 (noche) — API de Binance conectada (solo lectura)

- Jorge creó la API key en Binance (HMAC, "Generada por el sistema") con
  **únicamente "Habilitar lectura"** — trading, retiros, futuros y préstamos
  quedaron desmarcados. Sin restricción de IP (válido: esa restricción solo
  es obligatoria si se habilita algún permiso más allá de lectura).
- Pegó él mismo la key/secret en `.env` (nunca se compartieron en texto
  plano hacia el asistente, salvo la Clave API una vez por error — se dejó
  a criterio de Jorge no rotarla al ser de solo lectura).
- **Verificado tras reiniciar el servidor:** `conectadoBinance: true`,
  `real.fuente: "api"` (antes `"snapshot"`), sin `realError`. La billetera
  real ahora se lee directo de Binance en cada refresco/análisis — ya no
  depende de abrir Chrome y leer la pantalla a mano.

## 2026-08-19 (noche) — Sala de control interactiva

Jorge pidió que los 4 tiles de arriba dejaran de ser solo números y pudieran
desplegar su detalle. Cada tile pasó de `<div>` a `<button>` con un panel
desplegable a lo ancho de la fila (acordeón: uno abierto a la vez).

| Tile | Qué muestra al desplegarse |
|---|---|
| **Marcador** | Por qué existe la brecha: ficticia vs real, y la tabla de jugadas ya cerradas con su PnL y motivo de cierre |
| **Alfa** | Jugada por jugada contra BTC: rendimiento propio, benchmark y alfa de cada una |
| **Vigilancia** | Cada posición abierta con una **barra roja→verde** que ubica el precio entre su límite y su objetivo, más entrada, actual y horizonte |
| **Hoy** | La acción concreta del día: si falta análisis lo ejecuta; si hay propuesta la lista con sus avisos; si no, atajo al registro del sistema |

**Decisiones de UX (skill `ui-ux-pro-max`):**
- **Affordance sin depender del color:** cada tile lleva un chevron que rota
  180° al abrirse — la señal no es solo el borde dorado.
- **El panel sobrevive al refresco:** `ctAbierto` persiste, así un refresco de
  precios cada pocos minutos no le cierra el detalle en la cara al usuario.
  Verificado: se dispara `/api/refresh` con Vigilancia abierta y sigue abierta.
- **Teclado y lectores de pantalla:** `aria-expanded` + `aria-controls`,
  `role="region"`, foco visible de 2 px, y **Escape cierra devolviendo el foco
  al tile que lo abrió** (verificado: `document.activeElement` vuelve al tile).
- **Táctil:** botones de atajo con 44 px de alto exactos (mínimo Apple HIG);
  sin scroll horizontal a 375 px.
- **Movimiento:** transiciones de 180-200 ms con `ease-out`, y
  `prefers-reduced-motion` las desactiva por completo.
- **Atajos que llevan al detalle completo:** los botones del panel o disparan
  el botón real de la cabecera (Ejecutar análisis) o hacen scroll a la card
  correspondiente y la resaltan 1,6 s.

## 2026-08-19 (cierre) — Día 3 de la validación

**Marcador:** ficticia 82,79 vs real (hold) 85,77 → **−2,98**. BTC 69.259.

**Alfa del sleeve: −0,68 USDT (−2,74 pp vs BTC) en 5 jugadas.** El detalle
importa más que el total, porque el día tuvo dos historias opuestas:

| Jugada | Estado | PnL | BTC en el mismo lapso | Alfa |
|---|---|---|---|---|
| ACE | cerrada (stop) | −16,3% | +5,5% | **−21,8** |
| SOL | cerrada (objetivo) | +6,0% | +5,7% | +0,4 |
| ETH | cerrada (objetivo) | +11,3% | +2,2% | **+9,1** |
| HEMI | abierta | −1,2% | +1,3% | −2,5 |
| ZEC | abierta | +2,6% | +1,3% | +1,4 |

**Lectura honesta:** sin ACE el alfa sería claramente positivo. Una sola
posición mal dimensionada (stop −12% en un activo que se desplomó −16% de
golpe) se comió el aporte de las otras cuatro. Es la misma lección de GPS
repetida: el problema no fue elegir mal el activo, fue **cuánto dolor podía
absorber antes de cortar**.

**Cartera al cierre:** ancla BTC intacta · sleeve HEMI + ZEC · reserva 21,01
(subió con los tres cierres del día, dos de ellos automáticos).

**Decisión del día:** con todo el radar en RSI 80-92, no se abrió posición
nueva. La reserva queda como pólvora seca esperando un retroceso.

**Pendientes reales del sistema:**
- Convertir "no entrar con RSI > 80" en un filtro del motor (hoy es criterio
  aplicado a mano en cada análisis).
- Dimensionar los stops por volatilidad **también en las jugadas manuales**
  cuando se pasan niveles explícitos — hoy `stopsSugeridos()` solo actúa si
  no se especifican.
- El evento de corte debería llevar `categoria: 'stop'` estructurada, en vez
  de que la cuarentena parsee el texto del tipo.

## 2026-08-19 (noche) — AUDIT completo del sistema · 5 arreglos aplicados

Tercera auditoría (motor + datos + riesgo). **Datos íntegros:** sleeve ↔
posiciones sin descalces de cantidad, historial sin días duplicados, archivos
livianos, ancla intacta, propuestas nunca auto-aplican.

**Arreglos aplicados en esta pasada:**

| # | Hallazgo | Arreglo |
|---|---|---|
| 1 | El ranking de picks proponía activos en cuarentena (ACE/GPS hoy): el aviso llegaba recién al aplicar, y el modelo quemaba sus 3 picks en activos incomprables | `enCuarentena()` veta **antes** del ranking. Verificado: picks pasaron de HEMI/ACE/GPS a HEMI/TRUMP/RE y los avisos de 3 a 1 |
| 2 | Jugadas manuales con niveles explícitos saltaban la vara de volatilidad — así murieron GPS (−8% en activo de 17% vol) y ACE (−12% → −16,3%) | `stopsSugeridos()` se calcula siempre; si el límite explícito es más estrecho, la jugada devuelve aviso (no bloquea: la cadencia es de Jorge) |
| 3 | La cuarentena parseaba el texto del tipo de evento (regex frágil, ya falló una vez con "auto-stop") | Campo estructurado `categoria: 'jugada'\|'stop'\|'objetivo'\|'plan'` en cada movimiento; los eventos viejos se reconocen por texto (fallback) |
| 4 | Vigilancia ciega con el Mac dormido, sin rastro de cuánto tiempo | Al reanudar, si pasaron >3 intervalos avisa "estuvo N min sin ojos" (log + notificación macOS) |
| 5 | `.env` con permisos 644 (legible por cualquier proceso local) | `chmod 600` |

**Decisión estratégica pendiente (es de Jorge, no técnica):** el modelo vivo
sigue siendo **v1 sin filtro RSI** — el backtest 90d mostró que v2a (RSI14<75)
le gana por ~30 pp, y las propuestas de v1 esta semana confirmaron el patrón
(comprar cimas). Las reglas de la casa piden cambios de modelo **al cierre del
ciclo de 7 días** (≈2026-08-25), un parámetro a la vez — promover v2a ese día
es la candidata obvia.

**Deuda restante (conocida, no urgente):** tests automatizados de la matemática
de dinero · UI para jugadas manuales (hoy van por curl/asistente) · campo
"tesis" por posición.

## 2026-08-19 (noche) — AUDIT técnico: 6 correcciones (3 bugs de integridad)

Auditoría de código, no de estrategia. Tres de los hallazgos eran **bugs que
podían corromper el registro en silencio** — grave, porque toda la finalidad
del proyecto es generar un registro confiable.

### 1 · Condición de carrera entre el monitor y los endpoints (bug)
`corriendo` vivía en `server.mjs` y solo protegía los 4 endpoints entre sí.
`vigilar()` corre en `setInterval` cada 3 min y escribe `wallet.json` sin
consultarlo: una jugada y un auto-stop simultáneos podían leer el mismo saldo
y sobrescribirse — **la compra desaparece y el dinero se materializa**.
**Fix:** candado `conCandado()` en el **motor** (lo único que ambos comparten);
el monitor lo respeta y si está ocupado se pospone 3 min.
**Verificado:** dos POST simultáneos → el segundo responde
`409 {"error":"Hay otra operación en curso (run)"}`.

### 2 · Escrituras no atómicas, sin respaldo (bug)
9 `writeFileSync` directos: `writeFileSync` trunca antes de escribir, así que
un Mac que se suspende a mitad de escritura dejaba el estado destruido y
`loadWallet()` sin fallback.
**Fix:** `escribirEstado()` escribe a `.tmp` y hace `renameSync` (atómico en el
mismo filesystem), guardando la versión previa en `.bak`. `leerJSON()` explica
cómo recuperar si el archivo no se puede parsear.
**Verificado:** `.bak` creados, cero `.tmp` huérfanos.

### 3 · Un NaN corrompía la billetera para siempre (bug)
`NaN < 0.01` es `false`, así que un monto `NaN` pasaba todas las guardas,
llegaba a `wallet.sleeve[activo]` y `JSON.stringify` lo dejaba como `null`.
**Fix:** `montoValido()` / `activoValido()` con `Number.isFinite`, y la
validación corre **antes** de pedir precios (no gasta llamada a Binance).

### 4 · `aplicarPlan` no revalidaba los avisos
Recalculaba precios (bien) pero no volvía a correr `evaluarPropuesta()`:
aprobabas viendo unos avisos y se ejecutaban otros. Una posición abierta en el
intermedio se habría cerrado sin advertencia.
**Fix:** revalida sobre una copia con precios de ahora; si aparece un aviso
**alto nuevo**, responde 409 y pide reejecutar el análisis.

### 5 · Riesgo abierto y brecha de los stops, ahora visibles
Faltaba el número más importante para decidir: **cuánto se pierde si todos los
stops pegan a la vez**. Nuevo tile "Riesgo abierto" (5º de la sala de control)
con panel que muestra pérdida potencial, capital expuesto, desglose por
posición, win rate, expectativa, comisiones **realmente pagadas** (desde el
ledger, no estimadas) y la **brecha de los stops**.

La brecha también entró como columna del Registro del sistema, con tooltip
"nivel fijado X% · salida real Y%". Rellenada en las 3 posiciones ya cerradas:

| Activo | Nivel fijado | Salida real | Brecha |
|---|---|---|---|
| ETH | +10% | +11,3% | +1,3 pp |
| SOL | +6% | +6,0% | 0,0 pp |
| ACE | −12% | −16,3% | **−4,3 pp** |

El patrón queda a la vista: **los objetivos se cumplen, los stops se pasan de
largo** — porque el monitor es discreto (3 min) y muere con el equipo dormido.
En Binance real una orden OCO ejecuta en el nivel; el simulador enseña una
lección más pesimista de la que aplicaría en real.

Además, el panel avisa cuando la estadística **no es significativa**:
con n=3, "esto es ruido, no señal: hacen falta 30+ jugadas".

### 6 · Tests de la matemática de dinero
`src/test.mjs` — **8 tests, todos pasando**, sobre un sandbox (`KW_DATA` apunta
a una copia en `/tmp`): jamás tocan la billetera real, corren con el servidor
arriba. Cubren: conservación de capital en una venta, bolsillos que suman el
total, el rebalanceo que no toca el ancla, el techo del sleeve, el rechazo del
NaN, el candado, el respaldo atómico y la coherencia del riesgo.

```
node src/test.mjs
```

**Deuda restante:** formulario de jugada en el dashboard (hoy pasan por curl —
es lo que falta para que Jorge opere sin el asistente) y campo "tesis" por
posición.

## 2026-08-19/20 (noche) — Motor de aprendizaje

Jorge pidió un motor adicional que lea los registros y acumule la evolución
de cómo vamos creando, mejorando y operando. Se presentaron 3 alcances (A
instrumentación, B hipótesis, C patrones) con la advertencia explícita de que
con n=3 cualquier motor "que aprenda solo" sería una máquina de superstición.
**Decisión de Jorge: los tres**, y captura de tesis/veredicto **preguntando**
en vez de que el asistente la redacte sola.

**Nuevo módulo `src/aprendizaje.mjs`** (no toca la billetera, solo lee/escribe
sus propios registros):

- **A · Instrumentación** — `contextoEntrada(asset)` captura RSI diario y 1h,
  momentum 7d/30d, volumen, distancia al máximo de 30d y **régimen de mercado**
  (`regimenMercado()`: mide si sube el 80%+ del universo de referencia = rally
  amplio, o solo el activo = pump aislado — la distinción que separó ETH de
  GPS). Se engancha en `jugadaManual()`: cada compra queda con su contexto en
  `data/aprendizaje.jsonl`, y si no se pasa tesis, un aviso lo señala.
- **B · Hipótesis** — `data/hipotesis.json`, sembrado con **9 afirmaciones**
  que ya habíamos hecho y solo vivían en la bitácora (RSI>80, ventana 30d,
  frecuencia, stops por volatilidad, brecha de los stops, tokenizados,
  cuarentena, sizing por riesgo, "el modelo nunca operó"). Cada una con
  estado, evidencia a favor/en contra, y **dónde debería estar en el código**.
  `deriva()` compara eso contra el código real de `engine.mjs`/`server.mjs` —
  hoy las 9 muestran deriva porque acaban de sembrarse; según se implementen
  (algunas ya lo están, falta declarar su patrón) la lista baja.
- **C · Patrones** — cruza resultados por ancho de stop, RSI de entrada,
  régimen, quién decidió, duración y veredicto, con un umbral de calidad
  obligatorio: bajo n=20 dice "es ruido, no señal" en vez de un número.
- **Veredictos**: `registrarVeredicto()` con 4 categorías (tesis-correcta /
  tesis-correcta-mala-ejecución / tesis-equivocada / ruido-de-mercado) — la
  distinción que importa, porque se corrigen de formas opuestas.

**Backfill:** `categoria` en los 9 movimientos existentes (antes solo los 3
más nuevos la tenían) y veredicto registrado en las 3 jugadas ya cerradas,
decidido junto a Jorge:

| Activo | Veredicto |
|---|---|
| ACE | tesis-correcta-mala-ejecución (momentum real, stop −12% estrecho para su volatilidad) |
| SOL | tesis-correcta (rally amplio, RSI sano, salida exacta en el objetivo) |
| ETH | tesis-correcta (elegida por liquidez sobre alternativas especulativas, +9,1 pp de alfa) |

**Endpoints:** `GET /api/aprendizaje` (informe completo) · `POST /api/veredicto`.

**Card "Aprendizaje"** — última del bento, **ancho completo** (a pedido de
Jorge, dos veces movida: primero junto al historial, luego al final; y el
Historial/Registro del sistema también pasaron a ancho completo por ser
tablas). Muestra primero la calidad de la muestra (para leer todo lo demás con
eso en mente), luego deriva (lo más accionable), hipótesis y patrones en dos
columnas, y las 3 pistas de evolución (trading/modelo/sistema) al pie.
Verificado en 1600px: las 4 cards de tabla a 1521px de ancho, sin overflow-x.

**Uso desde consola:** `node src/aprendizaje.mjs` (o `--json`).

## 2026-08-20 — Decisión: esperar datos frescos (régimen "débil")

- **Contexto:** régimen de mercado "débil" (solo 20% del universo sube en 24h,
  BTC plano). Se buscaron candidatos sin patrón de pump para una jugada de
  corto plazo.
- **Hallazgo:** todo el radar saltó el 19-08 (día del rally amplio) — no hay
  forma de aislar tendencia orgánica de pump ese día. Normalizando el salto de
  volumen contra su propio promedio: BTC/LINK/TRUMP/SOL/ZEC en 3,4-5,4× (en
  línea con un rally de mercado), **RE en 12,3×** (fuera de línea, pump
  idiosincrático encima del rally).
- **Decisión de Jorge: esperar a mañana con datos frescos.** Ninguna opción
  ofrecía la relación riesgo/confianza buscada — el régimen "débil" es la
  resaca del rally, no una entrada fresca.

## 2026-08-20 — Motion del dashboard revisado y reconstruido

Se instalaron las skills `animate` y `review-animations` (emilkowalski/skills,
30.8k estrellas — autor de Sonner y Vaul) y se corrió el par revisar/construir.
El review dio **Block**: había regresiones de sensación reales.

**El hallazgo que explicaba la sensación de "salta":** el colapso de cards
**no tenía transición de altura**. `.card-body` solo llevaba `overflow: hidden`
y el fade era del interior — la altura cambiaba de golpe. Es la interacción más
repetida del dashboard.

Arreglarlo tuvo dos causas encadenadas, ninguna obvia:

1. **`height: 0 !important`** en `.card.collapsed .card-body` **le ganaba al
   estilo inline**, así que el punto de partida de la transición se perdía y
   saltaba igual. El `!important` venía de la sesión donde se arregló el
   colapso con altura explícita; con el JS manejando el alto ya no hacía falta.
2. **`scrollHeight` del interior miente**: medía **126 px en una card de 597**,
   porque adentro hay listas con scroll propio. La solución es soltar la card
   un instante (`height: ''`), medir el alto natural, y recién entonces animar
   entre dos números concretos.

**Los 9 arreglos aplicados:**

| Antes | Ahora | Por qué |
|---|---|---|
| Colapso sin transición | `height` 200ms + alto medido en JS | La interacción más usada saltaba |
| Panel de tiles con `translateY(-6px)` | `transform-origin` en el tile + `scale(0.97)` | Un desplegable sale **de lo que clickeaste**, no del aire |
| `* { transition-duration: 0.01ms !important }` | Solo se quitan desplazamientos y escalas | Reduced motion es *más suave*, no cero: el fade ayuda a entender |
| `.banner { animation: aparecer 320ms }` | `transition` + `@starting-style`, 200ms | Keyframes reinician desde cero: dos alertas seguidas se cortaban |
| `.pos-marker { transition: left 400ms }` | `left: var(--pos)` con 200ms | `left` es layout y se disparaba **en cada tick del WebSocket** |
| 6 `:hover` con transform sin gate | `@media (hover: hover) and (pointer: fine)` | En táctil el hover queda pegado tras el toque |
| `.18s ease-out` mezclado con `var(--ease)` | Tokens `--ease-out`, `--dur-ui`, `--dur-press` | Las curvas nativas son débiles; y había dos sistemas conviviendo |
| `.ct:active { scale(.99) }` | `scale(0.97)` | 0,99 está fuera del rango perceptible |
| Chevron 260ms | 200ms | Debe durar lo mismo que el colapso que acompaña |

**Verificado:** `CSSTransition` activa sobre `height` (estado `running`, 200 ms,
`cubic-bezier(0.23, 1, 0.32, 1)`), origen del panel calculado desde el tile
(16,3% con la franja en 3 columnas, donde "Riesgo" abre la segunda fila),
`--pos` en el marcador, cero patrones prohibidos (`transition: all`, `scale(0)`,
`ease-in`, keyframes en alertas, props de layout).

**Pendiente de ojo humano:** la sensación fina del colapso y del escalado del
panel no se pudo medir en movimiento — la pestaña del panel de previsualización
quedaba oculta (`visibilityState: "hidden"`), y con la pestaña en segundo plano
el compositor no avanza: `currentTime` se queda en 0. Vale mirarlo en vivo y,
si algo se siente lento, bajar `--dur-ui` de 200 a 180 ms.

## 2026-08-20 — Sincronización: faltaba la billetera Funding

- **Síntoma:** Binance mostraba 85,8754 y el dashboard 85,77. Jorge pidió
  sincronizar mejor.
- **Primer descarte:** el WebSocket estaba sano — abierto, con los 9 activos
  reales suscritos y ninguno sin precio en vivo. Los totales ya se recalculaban
  cada segundo. No era un problema de frescura de precios.
- **Causa real:** `realWalletValue()` leía solo `/api/v3/account`, que es
  **únicamente la billetera Spot**. Binance reparte el saldo en varias
  billeteras, y su "Valor total est." las suma todas. Consulta de auditoría:
  **Funding tenía 3 activos** (BOME, FDUSD, LINEA) por 0,0324 USDT; Earn vacío.
  Chico hoy, pero era un desfase **sistemático** que crecería si mueve plata ahí.
- **Fix:** `realWalletValue()` consolida **spot + funding + earn** por activo.
  `signedGet()` acepta método porque el endpoint de Funding solo admite POST
  (aunque sea de lectura). Cada billetera va en su propio `try`: perder Funding
  es un desfase chico, quedarse sin total es peor. La respuesta expone
  `billeteras: ['spot','funding']` y el dashboard lo muestra en la etiqueta de
  la card, para que sea auditable.
- **Verificado:** 13 activos (antes 10). Reconstruyendo el total con los precios
  exactos de la captura de Jorge (BTC 69.309,23 · XRP 1,1024) da **85,8755**
  contra los **85,8754** de Binance — 0,0001 de diferencia, o sea redondeo.
  El resto del desfase era deriva de precio entre la captura y la medición.
- Tests: 8/8 pasando.

## 2026-08-20 — Aprendizaje y memoria sincronizados

- **3 hipótesis nuevas** en el registro (12 en total):
  - `binance-varias-billeteras` → **confirmada**: el saldo real vive en Spot +
    Funding + Earn y leer solo Spot subestima el total. Al declarar su patrón,
    la detección de deriva la sacó sola de la lista.
  - `motion-verificar-efecto` → **confirmada**: una animación puede estar bien
    cableada (`CSSTransition` en `running`) y no correr, porque en pestaña
    oculta el compositor no avanza.
  - `volumen-relativo-detecta-pump` → abierta (registrada ayer).
- **Mejora del motor de aprendizaje:** `deriva()` daba un falso positivo con las
  hipótesis que no se traducen en código (una regla de verificación no es
  implementable). Ahora `implementacion: null` marca ese caso y no cuenta como
  brecha. La lista quedó en las **3 brechas reales**: ventana 30d, cadencia de
  rebalanceo y el sub-bolsillo para que el modelo opere solo.
- **Memoria:** nueva entrada *"Verificar el efecto, no el mecanismo"* con los
  tres casos donde falló medir el intermediario, y la regla de revisar
  `visibilityState`/`innerWidth` antes de diagnosticar un bug. Se agregaron a la
  memoria del proyecto los tokens y reglas de motion, para no romperlos después.

## 2026-08-20 — Decisión: no operar (rally amplio ya extendido)

- **Contexto:** régimen "rally amplio" (100% del universo sube, BTC +3,3%/24h
  +12,8%/7d). HEMI +2,78%, ZEC +3,4%, ambas sanas, sin stop activado.
- **Propuesta del modelo (sin avisos):** vender HEMI+ZEC para comprar
  ETH+XRP+PUMP. Se descartó — los tres candidatos están a centavos de su
  máximo de 30d con RSI de sobrecompra (XRP 1h en 85,4, ETH diario en 80,9):
  mismo patrón que GPS/ACE, comprar la cima de un movimiento que ya corrió 7
  días.
- **Decisión de Jorge: no hacer nada.** Se dejan correr las posiciones sanas
  en vez de rotar hacia activos ya extendidos.

## 2026-08-20 — Bot de Telegram (@kripto_wallet_k_bot)

Notificaciones al móvil y consultas de solo lectura. Los 6 pasos completos.

**Decisiones de diseño:**
- **Solo lectura, sin excepción.** Ningún comando mueve la billetera, ni la
  ficticia. Un atajo de ejecución desde el teléfono, sin la pantalla de avisos
  de impacto delante, sería justo lo que las reglas de la casa previenen.
- **Polling, no webhook:** el Mac sale a buscar los mensajes (`getUpdates`), así
  que no hace falta puerto abierto, túnel ni dominio.
- **Lista blanca por chat ID:** un bot de Telegram es público, cualquiera que
  adivine el username puede escribirle.
- **Telegram nunca tumba la vigilancia:** su error se registra y se sigue.
- **Lo que cambia:** hasta hoy nada salía del Mac (el servidor escucha solo en
  127.0.0.1). Ahora los saldos viajan a los servidores de Telegram. Jorge lo
  decidió sabiéndolo.

**Comandos:** `/estado` `/posiciones` `/mercado` `/riesgo` `/registro`
`/oportunidades` `/ayuda`. Dos decisiones de eficiencia: el bot poletea cada
20 s (no cada 3 min como la vigilancia, para que una consulta no espere), y
`/mercado` lee el radar del último análisis guardado — un mensaje desde el
teléfono no puede disparar el barrido de 3.684 pares.

**Motor de oportunidades.** Los criterios que veníamos aplicando a mano, ahora
en código. Cada uno viene de algo que costó dinero o quedó como hipótesis:

| Criterio | Origen |
|---|---|
| RSI14 < 70 | lección GPS (RSI 90 → −26%) y ACE |
| Salto de volumen < 6× su propio promedio | hallazgo RE (12,3× era pump propio, no rally) |
| Régimen no "débil" ni "caída amplia" | la resaca de rally no es entrada fresca |
| Fuera de cuarentena y fuera de cartera | no repetir cortes ni avisar de lo que ya tenemos |
| No repetir el mismo activo en 12 h | Jorge eligió sin tope diario; esto no es un tope, es no repetir |

**Cada aviso se registra en el aprendizaje** (`tipo: 'oportunidad'`). Es el dato
que faltaba: hoy los criterios los aplicaba yo a mano y los casos donde NO
operamos no dejaban rastro. Ahora se puede probar si los criterios sirven.

**Dos bugs encontrados al probar, ambos silenciosos:**
1. **El filtro de volumen daba 0× para todo** — comparaba la vela de HOY (en
   curso) contra días completos. Resultado: el filtro nunca disparaba y **RE
   pasaba limpio**, justo el activo que el criterio existía para descartar.
   Fix: pedir un día extra y descartar la vela en curso. Verificado: ahora
   descarta PEPE (6,8×) y RE aparece con su 5,1× real.
2. **El polling del servidor se comía los mensajes** durante la configuración,
   así que `--setup` nunca encontraba el chat ID. Se detiene el servidor para
   configurar.

**Fricción de configuración documentada:** el chat ID es **numérico**
(2078928169), no el username (`@jKasch`) — se confundieron dos veces. Se agregó
`node src/telegram.mjs --setup`, que valida el token con `getMe`, detecta
webhooks que bloquearían el polling, y busca el chat ID imprimiendo la línea
exacta para pegar. Reemplaza el paso del navegador, que fue el que falló.

**Verificado:** mensaje de prueba entregado · 0 mensajes pendientes tras los
comandos (el bot los procesó) · 3 oportunidades detectadas, notificadas y
registradas · tests 8/8.

## 2026-08-20 — Aprobación desde Telegram + rediseño visual

Jorge pidió poder aprobar desde el teléfono, pero acotado: **solo ante una
oportunidad o un peligro**. Y de paso, que los mensajes no se vieran tan planos.
Las dos cosas se resolvieron con **botones inline**: se aprueba tocando, no
escribiendo un código (menos fricción, sin errores de tipeo) y el mensaje se
reescribe después, así no se puede aprobar dos veces.

**El modelo de seguridad — qué hace que esto sea aceptable:**
- **No hay comando libre.** No existe "compra X". El bot solo puede ejecutar una
  **oferta que él mismo generó**, con monto y niveles ya fijados. Aprobar es
  aceptar *eso*, no abrir la puerta a improvisar desde el teléfono.
- **Los criterios son el filtro.** No se puede aprobar algo que el motor rechazó
  por RSI ≥ 70, por pump idiosincrático o por cuarentena. Esto es lo que más
  cambia el riesgo respecto a "operar desde el móvil" a secas: el impulso no
  puede saltarse las reglas que nos costaron GPS y ACE.
- **Vence en 15 min.** No es solo seguridad: a los 15 minutos el precio se movió
  y los niveles sugeridos ya no corresponden. Aprobar una oferta vieja es
  aprobar otra cosa. Las ofertas viven **en memoria** a propósito — si el
  servidor reinicia se pierden, que es el comportamiento correcto.
- **Monto acotado (5 USDT).** Una aprobación remota nunca puede comprometer más.
- **Se verifica quién toca el botón** (`callback_query.from.id`), no solo el
  chat: un mensaje reenviado a otra persona no puede ejecutar nada.
- **La billetera real no se toca.** Esa regla no se movió.

**Dos flujos:**
1. **Oportunidad** → ficha con RSI, salto de volumen, techo de 30d, niveles
   sugeridos, monto y riesgo en USDT → `✓ Aprobar 5 USDT` / `✕ Descartar`.
2. **Peligro** → una posición entra en `cerca-limite` → se ofrece `🚪 Salir
   ahora` para salir **antes** del auto-stop, si Jorge sabe algo que el sistema
   no. Se avisa una sola vez por posición, y vuelve a ser avisable si se
   recupera.

**Rediseño visual.** Capa de formato nueva: barras de bloques (`█░`), barra con
marcador (`──◆──`) para ubicar el precio entre stop y objetivo, semáforo de RSI
por zona (🔴 ≥80 · 🟠 ≥70 · 🟢 45-70 · 🟡 · 🔵), y tablas en `<pre>` para que
las columnas se alineen en monoespaciado. Bug de layout encontrado al previsar:
la etiqueta "Del techo" (9 caracteres) pisaba su valor en una columna de 9 →
columna a 11 y etiqueta acortada a "Techo 30d".

**Aclaración para Jorge, que preguntó:** el bot **no consume tokens de Claude**.
Es código Node en su Mac — polling, alertas, detección de oportunidades y
auto-stops son aritmética y comparaciones, cero llamadas a un modelo. Puede
usarlo todo el día sin costo. Los tokens se gastan solo en la conversación
conmigo, donde el valor agregado es el análisis interpretativo (notar que un
volumen es delgado, que un patrón se parece al de GPS) — no el dato.

## 2026-08-20 — Rediseño de los mensajes del bot (estilo A+C)

**Los skills de Telegram no servían.** Los dos con más instalaciones
(`claude-office-skills@telegram-bot`, `sickn33@telegram-bot-builder`) tratan de
*construir* bots: API, arquitectura, monetización, escalar a miles de usuarios.
Ninguno toca el diseño visual de los mensajes. No se instalaron.

**El diagnóstico real de por qué se veía plano** no era falta de adornos, era
falta de estructura: las 8 filas de descartadas tenían el mismo peso visual (un
muro), no había contenedores, la línea `━━━━` era un separador crudo, y no se
estaban usando las dos primitivas que más aire dan: **`blockquote`** (barra
vertical, agrupa) y **`blockquote expandable`** (colapsa listas largas).

**Se propusieron 3 estilos y se enviaron renderizados** al teléfono para poder
compararlos de verdad, no por descripción. Jorge eligió el híbrido **A+C**:

- **A · ficha técnica** — datos en bloque monoespaciado con columnas alineadas.
  Sobrio, denso, sin emoji decorativo.
- **C · editorial** — antes del dato, una frase que dice qué significa. Un
  número solo no comunica; "el mercado está caro: 6 quedaron fuera por
  sobrecompra" sí.

Se descartó B (tarjeta con emoji por fila): los emoji funcionan como ancla
cuando son pocos y semánticos, pero repetidos se vuelven ruido y le quitan
seriedad a una herramienta de plata.

**Lenguaje visual aplicado a los 7 mensajes:**
- `titulo()` — título + contexto en cursiva
- `ficha()` — columnas alineadas en `<pre>`
- `cita()` / `plegable()` — blockquote y blockquote expandable
- `barraMarcador()` — `──◆──` ubica el precio entre stop y objetivo, y el RSI
  en su escala. Es la única visualización y se lee de un vistazo.
- Glifos solo con significado: `▲▼` dirección, `◆` posición, semáforo de RSI
- **Sin reglas horizontales**: el blockquote separa mejor
- Cada mensaje abre con una **lectura interpretada**, no con el dato crudo

Los 7 comandos verificados renderizando sin error y enviados al teléfono.
`_comandos` queda exportado para poder previsualizar sin enviar.

**Botones (estilo 1, elegido por Jorge).** La API de Telegram **no permite
colorear botones** — no hay campo de color en `InlineKeyboardButton`; se
renderizan con el color del tema del cliente. El color solo entra por **emoji
dentro del texto**. Quedó `🟢 APROBAR · 5,00 USDT` / `🔴 RECHAZAR`, **apilados
en dos filas y no en una**: en un teléfono, con una mano, aprobar y rechazar
pegados invitan al toque impreciso — y acá un toque impreciso ejecuta una
compra. El monto va dentro del botón como última defensa: si el mensaje se leyó
hace rato o se llegó desde una notificación, esa cifra es lo único que se ve
antes de tocar.

## 2026-08-20 — Decisión: el 24/7 va a un iMac local, no a un servidor online

- **Se evaluó subir el motor a un servidor online.** Descartado: pondría la API
  key de Binance y el token del bot en una máquina expuesta a internet, con
  superficie de ataque y mantenimiento propios — y por diseño de Jorge las
  órdenes reales las hace él a mano, así que el servidor no operaría nada real.
  Riesgo de seguridad concreto a cambio de fidelidad en un experimento simulado.
- **Decisión de Jorge: migrar a un iMac que nunca apaga**, después de cerrar el
  bot de Telegram. Es mejor que un VPS en todos los ejes: siempre encendido,
  red local, cero exposición a internet, sin credenciales fuera de casa.
- **Pendiente propuesto y no implementado (queda para cuando se retome):**
  *reconstrucción de cierres*. Al despertar, en vez de ejecutar el stop al
  precio del momento, pedir las velas del rato dormido, encontrar cuándo cruzó
  el nivel y ejecutar **a ese nivel** — lo que una OCO habría hecho. Corrige la
  distorsión medida: GPS registró −26,1% con stop en −8% (−18,1 pp) y ACE
  −16,3% con stop en −12% (−4,3 pp). Con el iMac siempre encendido el problema
  casi desaparece, así que baja de prioridad — pero sigue siendo el arreglo
  correcto para los huecos que queden.
- **Para dinero real la respuesta no es infraestructura:** es una **OCO en
  Binance**, que vive en el exchange y ejecuta sin que exista ninguna
  computadora encendida.

## 2026-08-20 (noche) — /resumen y BUG de zona horaria en el bot

**Comando `/resumen`** (a pedido de Jorge, por consulta y no programado): el
mensaje que se manda cuando hay diez segundos. Reúne lo que serían cinco
comandos — marcador, alfa, riesgo, reserva, posiciones y movimientos de hoy —
con el día del ciclo de validación en el encabezado y la lectura del estado en
una frase antes de los números. Posiciones y movimientos van en bloques
colapsables.

**BUG encontrado y corregido: las horas se mostraban en UTC.** Los mensajes
cortaban el texto ISO (`ts.slice(11,16)`), que devuelve UTC — en Chile son 4
horas de diferencia, así que el auto-stop de ACE (12:58 local) aparecía como
16:58, y el corte de GPS (23:54 del día 18) salía con fecha del 19. Es la misma
clase de error que ya nos había mordido en el rebalanceo diario: **el proyecto
usa fecha y hora LOCAL como frontera del día**, y el bot no lo respetaba.
Corregido con un helper `hora()` que convierte de verdad. De paso, pasó todo a
formato 24 h — `'p. m.'` ocupa espacio y en un mensaje compacto se lee peor.
Verificado: el registro ahora muestra 12:58, 13:47, 17:07 y 23:54, que
coinciden con los eventos reales.

**Y una confusión propia, digna de anotar:** al calcular el día del ciclo creí
que había un error porque marcaba "día 3" y yo pensaba que era el 21. Era el
20 en hora local (el 21 es UTC) — el cálculo estaba bien y el equivocado era
yo. Cuatro entradas de esta bitácora habían quedado fechadas en UTC; se
corrigieron a fecha local. Misma lección de nuevo, ahora aplicada a la
documentación: **verificar contra la hora local del proyecto, no contra la del
reloj del sistema en UTC.**

## 2026-08-20 — Seguridad del bot de Telegram

Modelo de amenazas y refuerzos. Se encontró **una vulnerabilidad explotable**.

**🔴 IDs de oferta predecibles (corregido).** Se generaban con
`Date.now().toString(36) + contador` — adivinables. El ataque: quien obtuviera
el token puede enviar un mensaje **haciéndose pasar por el bot**, con botones
cuyo `callback_data` sea `ok:<id-adivinado>`. Jorge toca creyendo que es una
alerta legítima, Telegram entrega el callback a *nuestro* servidor con **su**
`from.id` real, y la lista blanca **no protege** porque el toque sí es suyo.
Daño hoy: 5 USDT ficticios; pero el mecanismo escala mal.
**Fix:** `randomBytes(16).toString('base64url')` — 128 bits, no adivinable.

**🟠 Sin `.gitignore` (corregido).** Un `git init` metería `.env` (key de
Binance + token del bot) y `data/` (saldos) al historial, de donde no salen
fácil. Creado, ignorando `.env`, `data/`, `*.bak` y `*.tmp`.

**🟠 Interpolación HTML sin escapar (corregido).** Los nombres de activo vienen
de Binance y se insertaban en mensajes con `parse_mode: HTML`. Un nombre con
`<` o `&` rompería el mensaje completo (Telegram lo rechaza). Helper `esc()`.

**🆕 Interruptor de pánico.** `/congelar` corta **toda** capacidad de ejecución
y anula las ofertas vivas al instante. Diseño deliberado: **solo se reactiva
desde la máquina**, no desde Telegram — si alguien tomó control del Telegram de
Jorge, no debe poder revertirlo. No pide confirmación: si lo estás usando, es
urgente. `/seguridad` muestra el estado, ofertas vivas, tope y vigencia.
Con la ejecución congelada las alertas siguen llegando, pero sin botones.

**Amenazas evaluadas y su respuesta:**

| Amenaza | Protección |
|---|---|
| Otro usuario escribe al bot | Lista blanca por chat ID (ya existía) |
| Mensaje reenviado a un tercero | Se verifica `callback_query.from.id`, no solo el chat |
| Token filtrado → suplantación del bot | IDs aleatorios + `/congelar` + revocar en @BotFather |
| Teléfono perdido/desbloqueado | Vigencia de 15 min, tope de 5 USDT, `/congelar` |
| Cuenta de Telegram comprometida | **Requiere acción de Jorge: activar contraseña en la nube (2FA) en Telegram.** La lista blanca no protege si el atacante *es* él |
| Credenciales en el repo | `.gitignore` + `.env` en 600 |
| Inyección por texto del mensaje | Solo se aceptan comandos de un mapa fijo |

**La regla dura para cuando se pase a real:** la key de Binance del servidor
**nunca** debe tener permiso de trading. Hoy es de solo lectura y eso acota
todo el radio de daño: incluso con el servidor comprometido, nadie puede mover
dinero real. Habilitar trading en esa key cambiaría por completo el modelo de
seguridad — las órdenes reales las hace Jorge a mano, por diseño.

## 2026-08-20 — Login del bot: usuario + clave con scrypt

Jorge pidió que el bot **pida credenciales al entrar**, no solo para aprobar.
Ahora el bot **arranca bloqueado y no responde nada** —ni el estado, ni los
saldos, ni la ayuda— hasta recibir `/login usuario clave`.

**Qué problema resuelve.** La lista blanca por chat ID no cubre el único caso
que quedaba: alguien con el teléfono desbloqueado o con la cuenta de Telegram
tomada. Para el bot, ese atacante **es** Jorge. El login es un secreto que no
está en el dispositivo.

**Y qué NO resuelve, dicho con claridad:** es un **segundo secreto compartido,
no un segundo factor**. Ambos campos viajan por el mismo canal. Un 2FA real
sería un código TOTP de una app aparte (implementable sin dependencias, queda
como opción).

**Decisiones de diseño:**

| Decisión | Por qué |
|---|---|
| **scrypt con salt** (`scrypt:salt:hash`), no SHA-256 | Si el hash se filtra, no sirven tablas precalculadas y probar cada candidato cuesta caro a propósito |
| Usuario y clave **hasheados juntos** (separados por `\0`) | Un solo derivado valida ambos y ninguno queda legible en `.env` |
| El error **no dice cuál campo falló** | Decirlo le regala la mitad del problema a un atacante |
| `timingSafeEqual` | La comparación no filtra información por su duración |
| **El mensaje con las credenciales se borra** al instante | Los bots de Telegram **no** soportan cifrado E2E: el chat queda en sus servidores. Borrar es la mitigación real, no un adorno |
| Desbloqueo **vence a los 30 min** | Una sesión eterna anula la clave: bastaría usar la ya abierta |
| **3 intentos** → congela todo y anula ofertas vivas | Corta la fuerza bruta de quien tenga el teléfono |
| El usuario ignora mayúsculas y espacios; la clave no | Se escribe en un teléfono cada 30 min: tolerancia donde no cuesta seguridad |
| Generador lee por **stdin** | No queda en el historial de la shell ni visible con `ps` |

**Verificado en copia aislada** (sin tocar el `.env` real): arranca bloqueado ·
credenciales correctas desbloquean · clave mala rechaza · usuario malo rechaza ·
`KASH` en mayúsculas acepta · espacios alrededor aceptan · 3 fallos congelan ·
`minutosRestantes()` devuelve 30 tras el login.

**Dos fricciones encontradas y resueltas:**
1. **`/pass` respondía "no conozco el comando"** — Node **cachea los módulos
   ESM**, así que el `await import('./telegram.mjs')` del servidor seguía
   sirviendo la versión vieja. Todo cambio en el módulo exige reiniciar.
2. **El generador se colgaba** al recibir las dos líneas en un solo chunk de
   stdin: el segundo `leer()` esperaba datos ya consumidos. Se reemplazó por
   una cola de líneas.

**Incidente de seguridad menor.** Al probar `/pass` antes de reiniciar, Jorge
envió al chat un texto que incluía lo que parecía un PIN personal. El bot no lo
borró porque el comando aún no existía en el proceso corriendo, y además quedó
en una captura compartida. Se le indicó no usar ese valor como clave y
eliminar el mensaje. **Lección: ordenar el reinicio ANTES de pedirle probar un
comando nuevo que reciba secretos.**

**Comandos de seguridad ahora:** `/login` (entrar) · `/seguridad` (estado del
login, ofertas vivas, tope y vigencia) · `/congelar` (corta toda ejecución al
instante; se reactiva solo desde la máquina).

**Verificación en dos pasos de Telegram activada por Jorge (2026-08-20).** Era
la última pieza que no dependía del código: protege la cuenta misma contra SIM
swap o sesión robada. Con esto el modelo de seguridad del bot queda cerrado en
las cuatro capas: la cuenta (2FA de Telegram), el canal (lista blanca por chat
ID + verificación de `from.id`), el acceso (login scrypt con vencimiento y
límite de intentos) y la ejecución (solo ofertas propias, tope de 5 USDT,
vigencia de 15 min, `/congelar`).

## 2026-08-21 — Motor de interacción (A) + logout con limpieza

Jorge pidió un bot "más vivo": que responda a frases, que siempre lo lleve a
algo, y logout. Se descartó por ahora la opción de un modelo local (Ollama):
con **8 GB de RAM en un M2**, un modelo de 1-3 B ocuparía ~2 GB para cubrir
apenas el 10% de casos que las reglas no atienden. Queda como upgrade.

**Regla que se fijó para si algún día entra un modelo:** el modelo **nunca
produce cifras**, solo clasifica intención; los números salen siempre del motor
determinista. Un LLM alucinando un saldo en una herramienta de plata es
inaceptable, y los modelos chicos alucinan números con facilidad.

**Las 5 piezas de A:**
1. **Teclado permanente** (6 botones fijos sobre el teclado del teléfono). Solo
   aparece con sesión abierta — un botón visible antes del login revelaría qué
   puede hacer el bot. Los botones llegan como texto y se mapean a comandos.
2. **Menú nativo** vía `setMyCommands`: el botón `/` de Telegram lista los 9
   comandos con descripción. Descubrimiento gratis.
3. **Frases por palabras clave**, sin modelo: hola · cómo va · gracias · cuánto
   tengo · qué compro · posiciones · riesgo · mercado · ayuda. Lo que no matchea
   cae en "no te seguí" **con la sugerencia del momento**, así nunca es un
   callejón sin salida.
4. **Ruteo proactivo** (`loMasUrgente()`): cada respuesta cierra con **una sola**
   sugerencia, por jerarquía — posición que cruzó > posición cerca > riesgo
   sobre 3% > análisis viejo > ofertas vivas > todo en rango. Una sola a
   propósito: sugerir cinco cosas es no sugerir nada.
5. **`/salir`**: cierra sesión, esconde el teclado y **limpia el chat**.

**Limpieza de la conversación.** Se registran los IDs de todo lo que pasa por el
chat —los cuatro caminos de envío y también los mensajes de Jorge— y al salir se
borran de más nuevo a más viejo. Un chat con saldos, posiciones y órdenes
aprobadas es información sensible a la vista de quien tome el teléfono; `/salir`
ahora corta el acceso **y** borra el rastro. Límite de la plataforma: Telegram
no permite borrar mensajes de más de **48 h** — se cuentan y se avisa cuántos
quedaron, en vez de fingir que se limpió todo.

**Bug encontrado al implementarlo:** de las cuatro funciones de envío,
`enviarConBotones` **no registraba sus IDs** — justo la de las ofertas, que son
los mensajes que más conviene limpiar porque muestran montos y niveles. Se
detectó contando `recordar()` por función en vez de asumir que el reemplazo
había aplicado en todas.

**Estado: Jorge en línea desde Telegram, todo funcionando.** Tests 8/8.

## 2026-08-21 — Ofertas en el core: aprobables desde Telegram o el dashboard

**PRIMERA OPERACIÓN EJECUTADA DESDE EL TELÉFONO.** Compra de **2,994604 TRUMP
@ 1,668 = 5,00 USDT**, stop −12% / objetivo +30%, con desvío de precio de
−0,24%. Reserva 21,01 → 16,01. Registrada con `origen: 'telegram'`.

**El bug de fondo que había que resolver.** Las ofertas vivían en un `Map` en
memoria de `telegram.mjs`. Consecuencias, todas sufridas en vivo:
- cualquier reinicio del servidor las borraba;
- el dashboard no las veía;
- **una oferta creada desde un proceso aparte (`node -e`) no existía para el
  servidor**, así que el botón no encontraba nada — eso explicó los dos "no
  pasó nada" de Jorge.

Mi razonamiento original —"una oferta vieja tiene precios viejos"— era correcto,
pero lo resolví mal: usé la volatilidad del proceso como reloj.

**La corrección.** Las ofertas son estado del proyecto (`data/ofertas.json`) con
**dos protecciones reales** en vez de la volatilidad del proceso:
1. **vencimiento explícito** (15 min);
2. **validación de precio al ejecutar**: si el precio se movió más que la
   tolerancia (**2%**), la oferta ya no es la que se aprobó y se rechaza
   diciendo cuánto se movió. El tiempo era solo un proxy del movimiento de
   precio; ahora se mide el movimiento directamente.

Verificado: la oferta **sobrevive un reinicio** del servidor.

**Una sola superficie, dos accesos.** `tomarOferta(id, origen)` vive en el motor;
Telegram y el dashboard son clientes. Endpoints: `GET /api/ofertas`,
`POST /api/oferta`, `/api/oferta/tomar`, `/api/oferta/descartar`. Card nueva
**"Ofertas vigentes"** en el dashboard con botones Aprobar/Rechazar. La que se
tome primero invalida la otra.

**Origen visible en el historial.** Campo `origen` estructurado
(`dashboard`|`telegram`|`motor`) en cada movimiento, en vez de inferirlo del
texto de la etiqueta. Insignia en el historial: **✈ Telegram** (azul),
**⚙ automático** (dorado), **🖥 dashboard**. Sirve además para el aprendizaje:
se puede preguntar si las decisiones desde el teléfono salen distinto que las
tomadas frente al dashboard.

**Los rechazos también se registran** (`tipo: 'oferta-descartada'` en el
aprendizaje). No mueven plata, así que no son un movimiento — pero sí son una
decisión, y sin registrarlas los casos donde Jorge se abstiene no dejan rastro.

### Cuatro bugs corregidos en el camino

1. **La oferta se mostraba completa sin login.** Activo, montos, RSI y niveles
   visibles antes de autenticarse — contradecía todo el modelo ("bloqueado no
   muestra nada"). Ahora sin sesión solo dice *"hay una oferta esperando"*.
2. **La hora mostraba `24:58`.** `hour12: false` en `es-CL` devuelve 24 en vez
   de 00 a la medianoche. Correcto: **`hourCycle: 'h23'`**.
3. **`str.replace()` de Python borró el bloque del login.** El marcador de
   comentario existía en dos versiones —una corta y otra larga que la
   contenía— y Python reemplaza **todas** las apariciones: insertó el bloque
   duplicado y en el proceso se perdió el original. Se restauraron los 12
   exports, `/congelar` y `/seguridad`. **Lección: al insertar por marcador de
   texto, verificar cuántas veces aparece antes de reemplazar.**
4. **"No se pudo tomar: la oferta está tomada" al tocar dos veces.** No era un
   error: era la protección contra el doble toque, mal redactada — daba a
   entender que la compra no se había hecho, cuando sí. Ahora dice *"Ya estaba
   ejecutada — el segundo toque no volvió a comprar"*. Y si entrás a
   Oportunidades sin ofertas vigentes pero resolviste una hace menos de 30 min,
   te lo recuerda en vez de mostrar un vacío que parece falla.

## 2026-08-21 (noche) — Por qué la real crece y la ficticia no: XRP, y dos correcciones al modelo

Jorge notó que la billetera real sigue subiendo mientras la ficticia se
queda atrás, pese a que el alfa del sleeve es positivo. La causa principal
tiene número exacto: el día 1 de la simulación el motor liquidó **toda** la
posición de XRP heredada de la billetera real (19,77 XRP) en cuatro ventas
entre el 18 y 19 de agosto, a un precio promedio de 1,026 USDT, y rotó ese
dinero hacia ACE y GPS — las dos peores jugadas del historial (−16,3% y
−26,1%). Esa misma XRP hoy vale 1,4446 USDT: sostenerla habría valido 28,56
USDT en vez de los 20,29 USDT recibidos — **8,28 USDT de costo de
oportunidad, más que toda la brecha actual (−6,71 USDT)**. Si esa sola
decisión hubiera sido distinta, la ficticia estaría hoy arriba de la real.

Presenté tres opciones (promover el modelo a 30d, no estacionar la ganancia
100% en efectivo durante un rally, proteger las posiciones heredadas).
Jorge eligió **A y C**.

### A · El modelo pasa de 7 días a 30 días, con rebalanceo semanal

Es la promoción de variante que el backtest ya había validado hace días
(v2d: +54,1%/90d y +60,4%/180d, Sharpe 1,40, vs v1: −29,5%/−35,4%) y que
había quedado pendiente. La ventana de 7 días es la que empujaba a rotar
rápido — la misma lógica que sacó a XRP del sleeve a las 32 horas, justo
antes de que corriera +40%.

Implementado en `engine.mjs`:
- `momentum7d()` → `momentumModelo()`, ventana configurable
  (`VENTANA_MODELO_DIAS = 30`, antes 8 velas/7 días → ahora 31 velas/30 días).
- `REBALANCEO_CADA_DIAS = 7`: dentro de los 7 días del último rebalanceo
  *aplicado* (`wallet.ultimoRebalanceo`), la propuesta reusa los mismos
  `picks` en vez de recalcularlos. `aplicarPlan()` estampa esa fecha al
  aplicar.
- **Cuidado al implementarlo:** `scored` (el ranking momentum) alimenta dos
  cosas distintas — los `picks` del modelo (con cadencia semanal) y el
  radar `mercado` que usa el screening de oportunidades de
  `aprendizaje.mjs` (que necesita estar fresco SIEMPRE, no una vez por
  semana). La primera versión metió el cálculo de `scored` dentro del
  bloque condicional de la cadencia y rompió el radar con
  `ReferenceError: scored is not defined` en la primera corrida contra el
  servidor real. Se separó: `scored` siempre se recalcula fresco, solo
  `picks` sigue la cadencia.
- Las etiquetas de movimiento pasan de "modelo v1" a "modelo v2d (30d +
  semanal)".
- Sigue siendo una PROPUESTA que Jorge debe aplicar a mano
  (`POST /api/aplicar-plan`) — el modelo codificado sigue en 0 de N
  jugadas aplicadas; esto no cambia.

### C · Las posiciones heredadas ya no caen al sleeve como capital fresco

Nuevo bolsillo `legado`, protegido igual que el `ancla` (`jugadaManual`
rechaza comprar o vender de él). En `migrarWallet()` (que solo corre una
vez, al nacer la billetera ficticia desde un snapshot de la real): todo lo
que no sea BTC ni quede bajo el umbral de polvo (0,5 USDT) va a `legado`
en vez de a `sleeve`. Es exactamente lo que le faltó a XRP el día 1: pasar
por esa clasificación la habría protegido de la rotación inmediata.

**No afecta a la billetera actual** — ya migró hace días, `wallet.json` no
tiene el campo `legado` y no lo va a tener hasta el próximo reset con un
snapshot real nuevo. Es una corrección estructural para la próxima vez,
no una reversión de lo que ya pasó con XRP (eso ya no se puede deshacer sin
que sea, en sí, una decisión de trading).

13 pruebas (antes 10): además de las de plazo/troceo de mensajes, se
sumó una que verifica que una tenencia heredada por encima del umbral cae en
`legado` y no en `sleeve`, y que `jugadaManual` la rechaza. Se detectó y
corrigió un fallo de diseño de la prueba en el camino: sin precios para
XRP/MTL en el mapa de prueba, `migrarWallet` clasificaba todo como polvo por
defecto (precio ausente → valor 0 → bajo el umbral) — silenciosamente
correcto en apariencia, pero probando la rama equivocada.

## 2026-08-22 — Auditoría del motor: 6 puntos, y los 5 bugs que aparecieron al arreglarlos

Jorge pidió auditar el motor sin mover monedas y evaluar punto por punto. La
auditoría corrió entera en copias del estado (`KW_DATA` apuntando a `/tmp`):
ninguna verificación tocó la billetera real. Salieron 6 hallazgos. Lo que no
esperaba: **arreglarlos destapó 5 bugs más**, varios peores que el original.

Resultado: 21 pruebas (antes 15). Todo verificado contra la billetera real.

### 1 · El dashboard escondía el 39% de una cartera migrada

El panel de bolsillos dibujaba tres fijos —Ancla, Sleeve, Reserva— y `legado`
(agregado el día anterior) más `polvo` no aparecían nunca. Medido con una
billetera migrada: **28,80 USDT invisibles de un total de 73,30**.

Ahora se dibujan todos los que tienen saldo. Y se agregó un guardián: si los
bolsillos no cuadran con el total, el dashboard lo dice.

**Bug extra que el guardián destapó al instante:** `aplicarPreciosVivos()`
recalculaba `r.sim.valor` con los precios del WebSocket pero **no los
bolsillos**. El encabezado iba en vivo y las tarjetas se quedaban en la foto del
servidor; el desfase crecía con el mercado (medido: 0,31 USDT) y llevaba ahí
desde siempre — invisible porque no había con qué compararlo. Ahora se
recalculan juntos, incluido el techo del sleeve, que también es un % del total.

### 2 · El plazo se decidía por ruido, no por la tesis

El plazo liquidaba con `pnlPct <= 0`. Dos problemas: no descontaba la comisión
de ida y vuelta (0,20%), así que entre 0% y +0,20% una posición sobrevivía
perdiendo plata; y sobre todo, **un umbral en cero sobre un activo que oscila
4-6% al día lo cruza el ruido de los últimos minutos**.

Esa es exactamente la lección de GPS (−18,1 pp) y ACE (−4,3 pp) que ya rige los
stops en 1,5× la volatilidad — y que el plazo se escribió ignorando.

Nuevo umbral: `2×FEE + 0,5 × volatilidad diaria`. Para las 3 posiciones vivas
da +2,20% / +2,53% / +2,20%. **No hace falta un campo nuevo para ellas:** la
volatilidad se recupera del `limitePct` guardado (÷1,5), con error < 0,4 pp
medido. Las nuevas la guardan explícita, del momento de entrar.

El `0,5×` es un **juicio, no un dato**: quedó como hipótesis abierta
`umbral-plazo-por-volatilidad` con su contraevidencia escrita ("con n=0 cierres
por plazo no hay un solo caso para saber si separa bien").

**Dos bugs extra:**
- `leerHipotesis()` devolvía el archivo guardado tal cual si ya tenía contenido,
  así que **una hipótesis nueva en la semilla no llegaba nunca** a una
  instalación ya sembrada: se ignoraba en silencio para siempre. Por eso la del
  `0,5×` no aparecía. Ahora se fusiona: lo guardado gana (lleva la evidencia
  acumulada), solo se añade lo que falta.
- `estadisticaJugadas()` contaba un cierre por plazo en +1,5% como **acierto de
  tesis**. Eso infla la tasa de aciertos con salidas que no prueban nada — y es
  la estadística con la que se va a juzgar el modelo. Ahora los números
  principales son solo los cierres por nivel; las salidas por tiempo se
  reportan aparte (`porTiempo`), no se esconden.

### 3 · La cuarentena no alcanzaba a los picks congelados

Con la cadencia semanal, `enCuarentena()` solo corría al recalcular: un pick
cortado por stop seguía en la propuesta durante días. No era agujero de
ejecución (`aplicarPlan` avisa y Jorge es la compuerta), pero la propuesta
recomendaba algo que el propio sistema había vetado.

Jorge eligió: **un pick vetado no se reemplaza, se queda en dos.** La cadencia
existe para no rotar por impulso; buscar sustituto a mitad de semana sería
recalcular por la puerta de atrás.

**Los dos bugs de mi propio "arreglo de una línea":**
- **Concentraba plata en vez de liberarla.** El presupuesto se divide entre
  `picks.length`; al quitar uno de tres, los dos sobrevivientes pasaban a
  recibir la mitad cada uno en vez de un tercio — más exposición por posición,
  lo contrario de lo elegido. Se separó el concepto: `rebalance(w, picks,
  prices, ranuras)` con las ranuras de la semana fijas. La del vetado queda sin
  usar.
- **Podía liquidar todo el sleeve.** Con la lista de picks vacía, `rebalance`
  vende todo a reserva (verificado: VENDER APT/FET/FIL, sleeve → {}). Si los
  tres cayeran en cuarentena la misma semana, la propuesta habría sido liquidar
  la cartera táctica completa. Pero una cuarentena dice *"no vuelvas a comprar
  esto"*, no *"vende lo que tienes"*. Guardarraíl: si el veto vacía la semana,
  no se propone nada.

Ojo con la distinción, que es sutil y el dashboard la confundía: **vacío por
falta de momentum sí es refugio en USDT** (la estrategia funcionando, llega por
el camino del recálculo). Vacío por cuarentena no. Mismo síntoma, causas
opuestas — y el mensaje decía "sin momentum positivo" en los dos casos.

`aplicarPlan` usa las **mismas ranuras** que Jorge vio al aprobar (`previo.
ranuras`), no las recalcula: si no, se aprobaba una repartición y se ejecutaba
otra.

### 4 · La prueba de conservación de dinero era ciega por diseño

El hallazgo real no era que faltara `legado` en el test: era que **la lista de
bolsillos estaba escrita a mano en diez lugares** que debían coincidir sin que
nada lo obligara (valorización, migración ×2, aplanado, resumen, clasificación,
wallet de respaldo, y dos veces en el front). El bug de `legado` no fue un
olvido suelto: fue la consecuencia previsible de eso. Y **el wallet de respaldo
ya estaba naciendo sin `legado`**.

Demostrado: con un quinto bolsillo que un consumidor olvida, `walletValue`
perdía **42,50 USDT** y el test pasaba en verde — porque construye su propia
billetera con los bolsillos que conoce y suma esos mismos a mano.

**La lista ahora existe una vez:** `const BOLSILLOS = ['ancla', 'legado',
'sleeve', 'polvo']`. Las diez enumeraciones se derivan de ella. `reserva` queda
fuera a propósito: es un número en USDT, no un mapa activo→cantidad, y aplanar
esa diferencia sería esconderla.

**La prueba ahora descubre en vez de enumerar.** La propiedad central: *vaciar
cualquier bolsillo debe bajar el total exactamente en su valor*. Si un consumidor
lo ignora, vaciarlo no cambia nada y la prueba falla. Verificado con mutación:
inyecté los dos bugs reales (walletValue ignora `legado`; el resumen olvida
`polvo`) y las pruebas se pusieron rojas — no son decorativas.

**La invariante quedó en el motor, y cambió de forma.** El plan era que
`simSummary` devolviera un `descuadre` numérico. Pero derivando todo de la misma
lista, ese descuadre es **0 por construcción** y no probaría nada. El riesgo que
sobrevive al refactor es otro: **un bolsillo que existe en los datos y nadie
declaró**. `bolsillosNoDeclarados()` lo detecta, su plata **se suma al total** en
vez de desaparecer, y se denuncia. El dashboard dejó de rearmar su propia suma:
lee el reporte del motor (eran tres copias del mismo cómputo).

**Autorización del refactor:** toca `walletValue`, el camino del dinero. La
verificación fue equivalencia numérica sobre la billetera real, con precios
congelados para aislar el código del mercado: **95.1723346644 antes y después,
diferencia 0.00e+0, idéntico bit a bit.**

### 5 · El techo del sleeve: me equivoqué en la recomendación

Había recomendado cambiar el techo de "25% del total" a "25% de lo operable".
Medido contra la billetera real:

```
25% del TOTAL (hoy)        = 23,78  ->  sleeve al 46% de su techo
25% de lo OPERABLE (36,19) =  9,05  ->  EXCEDIDO en 1,90 USDT
```

Mi propuesta **habría mandado a vender 1,90 USDT de las posiciones ese mismo
día**, presentada como una decisión de contabilidad. Y el razonamiento tampoco
aguanta: el 25% es un **peso de cartera** ("como máximo un cuarto del patrimonio
en la estrategia táctica"), y por eso ancla/sleeve/reserva se miden todos contra
el total. "25% de lo operable" sería una regla que inmoviliza el 75% del efectivo
desplegable por definición, sin razón de riesgo detrás.

La preocupación original —que el legado infla el total y agranda el techo—
tampoco resiste: el sleeve solo se fondea desde la reserva, así que el efectivo
se agota antes de que el techo importe. **Sin cambios; queda documentado en el
código para que la ambigüedad no vuelva.**

### 6 · El reloj del plazo arrancaba en el lugar equivocado

`horasAbierta` se contaba desde `abierto`, así que ponerle 48 h a una posición
abierta hace 3 días la dejaba **vencida al instante** y el motor la liquidaba
solo: una venta por sorpresa, lo contrario de lo que uno espera al escribir
"48 h".

Nuevo campo `plazoDesde`, estampado por `fijarHorizonte` y por `abrirPosicion`
cuando la posición nace con plazo (ahí son el mismo instante, así que no cambia
nada en el camino normal). Las posiciones anteriores al campo caen al respaldo
`abierto` — **las 3 vivas no cambiaron su plazo**.

Los 3 tests del plazo se pusieron rojos con este cambio, y fue buena señal:
retrasaban `abierto` para simular el paso del tiempo y ahora el reloj es otro
campo. Actualizados. Telegram dejó de restar por su cuenta (`horizonteHoras -
horasAbierta`, el campo equivocado) y lee `horasRestantesPlazo` del motor.

### Lo que enseña esta auditoría

De 6 hallazgos, **4 eran bugs reales, 1 era ambigüedad y 1 era una
recomendación mía equivocada**. Y arreglarlos produjo 5 bugs nuevos, tres de
ellos en código que escribí el día anterior.

El patrón que se repite: **el error nunca estaba donde parecía**. El test no
fallaba por falta de `legado` sino porque enumeraba; el plazo no fallaba por la
comisión sino por el ruido; la cuarentena no fallaba en el veto sino en cómo se
reparte el presupuesto que deja libre. En los tres casos el arreglo obvio habría
tapado el síntoma dejando intacto el mecanismo.

## 2026-08-22 — ¿Java (Spring Boot) para el motor? Evaluación, y la prueba de contrato en dos versiones

Jorge preguntó si conviene implementar Java con Spring Boot para mejorar el
motor, la lógica, los movimientos y el análisis. La respuesta fue **no**, con
dos mediciones y un argumento sacado del propio historial del proyecto.

### Las mediciones

**Aritmética decimal** — el argumento técnico más fuerte a favor de Java
(`BigDecimal` contra el float64 de JS). Simulé 10.000 compraventas, unos 1.400
años al ritmo actual (19 operaciones en 5 días):

```
deriva acumulada:  2,2 × 10⁻¹² USDT
```

Dos billonésimas de dólar. Con saldos de ~95 USDT, el float64 tiene 15-16
dígitos significativos de margen. **El problema que BigDecimal resuelve no
existe a esta escala.**

**Huella** — el servidor Node lleva horas en pie con **16 MB** y arranca en
0,67 s. Una app Spring Boot típica parte en 200-400 MB y varios segundos.

### El argumento que decidió: nuestro propio historial de bugs

Revisé los **11 bugs reales** encontrados esta semana preguntando "¿lo habría
cazado un compilador?". Resultado: **uno de once**.

El único que sí (`tg.crearOferta is not a function`) es real e importante. Los
otros diez —umbral del plazo en cero, cuarentena sin aplicar a picks congelados,
ranuras que concentraban el presupuesto, picks vacíos liquidando el sleeve,
reloj del plazo en el campo equivocado, el test que enumeraba, `leerHipotesis`
ignorando la semilla, la estadística mezclando categorías, bolsillos ocultos,
precios vivos sin tocar bolsillos— fueron errores de **pensar mal el problema**.
Ningún lenguaje protege contra eso.

### Dónde Java sí tendría sentido (registrado para el futuro)

Si el proyecto pasara a ser multiusuario, con base de datos y transacciones
ACID, ejecutando órdenes reales con requisitos de auditoría, o de alto volumen.
Nada de eso aplica: un usuario, una máquina, 200 KB de datos, y las órdenes
reales las hace Jorge a mano en Binance **por diseño**.

El costo específico que más pesa: Spring Boot trae **178 jars transitivos** a un
código que lee la API key de Binance. Hoy el proyecto tiene **cero
dependencias** — su propiedad de seguridad más fuerte, porque no hay cadena de
suministro que auditar.

Y el momento: día 5 de una validación de 14. Una reescritura reinicia el
registro que es el producto entero del ejercicio.

### La prueba de contrato — el bug que sí valía atacar

De los 11, el único type-catchable tenía una solución de 25 líneas y cero
dependencias. Ahora es el test **22** de la suite.

**Qué cubre:** los `import` estáticos ya los valida Node al cargar (un export
inexistente revienta al arrancar). El hueco son los `await import()`
**dinámicos**, que se resuelven al ejecutarse la línea — y si esa línea vive
dentro de un `catch`, el fallo es mudo. Fue exactamente `tg.crearOferta`: el
monitor lo llamaba cada 3 minutos y el `TypeError` moría en su propio catch,
semanas sin crear una oferta automática y sin síntoma visible.

**Detalle que no es cosmético:** hay que quitar los comentarios antes de
escanear. El propio `server.mjs` documenta el bug **citando** `tg.crearOferta`
en un comentario; sin limpiar, esa cita se cuenta como uso real y el test
reporta un fallo inexistente.

Verificado por mutación: reintroduje el bug y el test se puso rojo con
`server.mjs: llama tg.crearOferta() y telegram.mjs no lo exporta`.

### La versión Spring Boot (Jorge la pidió igual)

Vive en **`../kripto-contract-java/`**, deliberadamente **fuera** de la
billetera para no destruir su cero-dependencias. El toolchain (JDK 21 Temurin +
Maven 3.9.16) está dentro de `toolchain/`: **nada instalado en el sistema**,
borrar la carpeta lo elimina sin rastro.

**El límite que confirmó al construirla:** la JVM no tiene motor JS desde que
**Nashorn se eliminó en el JDK 15**. `VerificadorDeExports` termina haciendo
`new ProcessBuilder("node", "--input-type=module", "-e", script)` — **el chequeo
real lo sigue haciendo Node**. Spring Boot aporta la inyección de dependencias,
el `CommandLineRunner` y el modelo tipado (`record Llamada`), pero no el trabajo
central.

| | Java + Spring Boot | Node (test integrado) |
|---|---|---|
| Líneas | 154 | **25** |
| Tiempo | 6.684 ms | **200 ms** |
| Disco | 361 MB toolchain + 73 MB Maven + 10 MB jar | **0** |
| Dependencias | 178 jars | **0** |
| Detecta el bug | sí | sí |

### El bug que solo apareció por construir las dos

El informe en Java reportaba la misma llamada rota **tres veces**: `server.mjs`
declara `const tg = await import(...)` en tres lugares y cada declaración
reescaneaba el archivo entero. **La versión en Node tenía el mismo defecto** —
su salida lo ocultaba mejor. Los conteos estaban inflados: decía 63 llamadas
donde hay 32. Corregido en ambas con deduplicación.

Vale como recordatorio de que escribir la misma lógica dos veces es una forma
barata de revisarla — aunque la segunda implementación no se use.

## 2026-08-23 — Láminas 2 y 3 del póster: fase, watchlist, score y motor de señales

Jorge encontró un póster de arquitectura de un "trader IA 24/7" hecho con Fable
5 y pidió extraer lo aprovechable, lámina por lámina. Tras tres pasadas de
análisis, la conclusión fue que el póster **valida** nuestra pieza central (el
humano aprueba/vigila/rechaza, que ya son las ofertas) y aporta cuatro cosas que
no teníamos. Se implementaron las de las láminas 2 y 3.

Resultado: 27 pruebas (antes 23). Todo verificado contra el mercado real.

### Fase de tendencia por activo

El régimen global decía si el mercado respira; ningún activo decía en qué fase
estaba. Ahora cada uno lleva `tendencia / rango / extendido / caída`, calculado
de precio vs su media de 20 días. **Cero llamadas extra**: sale de las mismas 31
velas que `momentumModelo` ya baja para el momentum. De paso, el RSI diario
también (misma fuente), que ahora es columna del radar.

**El defecto que el test cazó antes de salir a producción:** mi primera versión
marcaba "extendido" a *cualquier* tendencia fuerte, porque medía la distancia
cruda a la media — y una tendencia siempre está lejos de su media, que la
persigue con ~10 días de rezago. El test sintético lo detectó de inmediato
("subida suave debe ser tendencia, dio extendido").

La corrección: extendido no es estar lejos, es el **exceso por encima de lo que
la propia deriva del activo explica** (`distancia − deriva×9,5`), medido en
volatilidades propias (2×, piso 0,5%). El caso que lo demuestra: TUT, +327% en
30 días, tiene exceso **negativo** — su distancia a la media es menor de lo que
su deriva explica, así que es tendencia, no pico.

Diez de doce activos del radar clasificaron "extendido" el día de la
implementación: la semana de RSI>80 dicha con otra vara.

### Watchlist: candidatos esperando su punto de entrada

Un candidato rechazado se evaporaba. Ahora queda vigilado con una condición de
armado explícita (`RSI < 70 · fase tendencia · régimen no vetado · fuera de
cuarentena`); el monitor la evalúa cada 15 min y, si se cumple, **crea la
oferta** — que Jorge aprueba o rechaza como siempre. La watchlist arma, nunca
ejecuta.

Tres correcciones sobre la idea del póster, que no las tiene:

1. **Toda entrada caduca (7 días).** Una watchlist que solo crece es una lista
   de deseos rancia.
2. **Toda caducidad deja autopsia** en el aprendizaje (`watchlist-caducada`):
   qué condición nunca se cumplió también es dato.
3. **Armado en dos fases.** La entrada se marca "armada" solo DESPUÉS de que la
   oferta se creó con éxito. Con la ejecución congelada sigue vigilando y
   reintenta, en vez de quedar en un estado fantasma. Y si el activo entró a la
   cartera por otra vía, se autocancela.

Estado del proyecto (`data/watchlist.json`), no memoria de proceso — la lección
de las ofertas.

**Lección:** un clasificador que mide distancia cruda a una media marca "extendido" toda tendencia sana; hay que medir el exceso sobre la deriva que el propio activo explica.

**Lección 2:** un detector se valida contra el mercado real antes de aceptarlo — TUT clasificaba pullback con −80% desde su máximo y el test sintético no lo veía.

Probado en vivo con ENA: `falta: régimen "débil" vetado · RSI 85,9 (necesita
< 70) · fase "extendido"`. No se armó, y dice exactamente qué le falta.

### Score de confianza 0-100: se acabó el filtro binario

El filtro trataba igual a RSI 70,1 y a RSI 86: fuera los dos. Ahora gradúa:

```
RSI diario 36 · Fase 24 · Régimen 12 · Volumen 14 · RSI-1h 14   → umbral 65
```

**El RSI de 1 hora por fin se usa.** Se capturaba en cada entrada desde el día
uno y nadie lo leía: el diario dice si está caro, el horario si estás comprando
el pico intradía.

**Un test fijó una propiedad de diseño que mis pesos originales violaban.** Con
30/25/15/15/15, los otros cuatro componentes sumaban 70 y podían comprar un
activo con el RSI muerto (RSI 79 con todo lo demás perfecto pasaba con 70).
Rebalanceado a 36/24/12/14/14: **los cuatro sin RSI suman 64, bajo el umbral de
65** — ningún alineamiento perfecto compra sobrecompra. Esa propiedad tiene su
test.

Los vetos de seguridad siguen DUROS y el score no los toca: cuarentena, ya en
cartera, régimen vetado, pump >6×, y RSI ≥ 80 como techo de cordura. El score
decide entre lo defendible.

Pesos registrados como hipótesis abierta `score-de-confianza` con su
contraevidencia escrita ("son un juicio, no medidos; n=0 ofertas puntuadas").

### Motor de señales: tres patrones con nombre

El sistema tenía UNA forma de ver el mercado. Por eso no encontró nada en toda
la semana: un detector de momentum, en un mercado que ya corrió, solo sabe
señalar lo que ya subió.

- **Pullback** — tendencia intacta (+10%/30d) que retrocedió entre 5% y 30% de
  su techo, con RSI bajo 60. La señal que habría servido esta semana.
- **Ruptura** — rompe su techo de 30d **con volumen ≥1,5×**. Sin volumen, un
  máximo nuevo es una mecha.
- **Momentum** — lo que ya hacía, ahora con nombre propio.

Y un cambio de fondo: **sin patrón reconocible no hay entrada**, por bueno que
sea el score. Antes bastaba "momentum positivo y RSI aceptable", que no es una
tesis: es la ausencia de motivos para no entrar.

**El defecto que solo apareció con datos reales:** la primera versión daba
Pullback a TUT con **−79,93% desde su techo**. Con las reglas escritas era
correcto (tendencia, RSI 55, +337% en 30d) pero eso no es un retroceso: es el
derrumbe de un pump (volumen 1,1×, el perfil de RE). Se le puso **techo al
retroceso: entre −5% y −30%**. Sin ese límite, "pullback" significaba "comprar
lo que se desplomó". El caso quedó en un test con su historia.

**Dos señales del póster que NO se implementaron, y por qué:**

- *Continuación* — con velas diarias es indistinguible de momentum. Ponerle otro
  nombre a la misma medición es inventar precisión.
- *Reversión* — comprar un giro es atrapar el cuchillo, y contradice la
  cuarentena que ya existe ("el impulso que lo cortó suele seguir"). Con capital
  cerrado y 80 USDT, ese no es el experimento a correr.

**Una decisión que se resistió a propósito:** era tentador bajarle el umbral a
la ruptura, porque un activo en máximos tiene el RSI alto por definición y el
score lo castiga — casi nunca pasará. Pero ese es exactamente el perfil de
nuestras peores operaciones (ACE, GPS, RE: todas comprando fuerza). Con n=0
entradas por señal, aflojar el filtro justo para el patrón que históricamente
costó plata es ajustar la regla al deseo. **Todas comparten umbral.**

### Lo que el póster valida, y lo que se descartó de él

Valida: la decisión final humana (nuestras ofertas), la separación
escáner→señales→score, los stops por trade (los nuestros son por volatilidad,
mejores que su % fijo) y los límites de exposición (techo del sleeve).

Descartado: **noticias/on-chain** (sin fuente seria sin dependencias, y para
retail operar titulares es ser la liquidez de salida de quien los recibió 400 ms
antes) y **24/7 real** (ya decidido: iMac; para dinero real la respuesta es una
OCO en Binance, no infraestructura).

### Nota de higiene

`rsi()` vivía en `aprendizaje.mjs` y la watchlist también lo necesitaba: se
movió al motor. Una copia, dos consumidores — en vez de repetir el error de las
diez listas de bolsillos.

## 2026-08-23 (cont.) — Lámina 4: el plan de entrada deja de ser aritmética

La lámina 4 del póster ("arma el plan de trading") expuso algo que estaba a la
vista y nadie miraba: **nuestro R:B era una constante por construcción.**

```
activo  stop  objetivo  R:B
APT     -6%     +15%    2.50
FET     -7%     +18%    2.57
FIL     -6%     +15%    2.50
PUMP   -13%     +33%    2.54
ZEC    -12%     +30%    2.50
```

Con `objetivo = |stop| × 2,5`, la relación riesgo/beneficio da lo mismo siempre.
Mostrarla como criterio de decisión era teatro: nunca podía informar nada.

### A · Objetivo estructural y R:B real

El stop sigue saliendo de la volatilidad (1,5×) — esa es la lección de GPS y ACE
y no se toca. El **objetivo** ahora se apoya en el techo de 30 días, que ya
calculábamos y no usábamos para esto.

El dato que lo motivó, del seguimiento post-cierre: **3 de 3 salidas dejaron
dinero** (TRUMP tocó +68% sobre su precio de salida). Un objetivo de `2,5 × vol`
no sabe nada de hasta dónde puede llegar el precio.

Y algo que el dato reveló de paso: **el objetivo fijo estaba sistemáticamente
por encima del techo de 30d** (+15% a +25% contra +7,6% a +12,4% de recorrido
real). Cada operación pedía implícitamente romper máximos nuevos — mucho pedir
para una entrada por retroceso.

Resultado contra el mercado real:

```
activo  stop   techo30d  objetivo  R:B    veredicto
APT     -6%    +11,3%    +11%      1,83   pasa
ADA     -7%    +12,5%    +12%      1,71   pasa
FIL     -7%    +11,4%    +11%      1,57   pasa
FET    -10%    +12,4%    +12%      1,20   RECHAZADO por R:B
LINK    -6%     +7,5%     +8%      1,33   RECHAZADO por R:B
```

**Antes los cinco daban 2,50.** Ahora FET y LINK se caen solos: arriesgar 10%
para ganar 12% es mal negocio y el sistema por fin puede decirlo. R:B mínimo
1,5, como criterio.

Tres decisiones:

- **Excepción de la ruptura.** Si el precio ya está en su techo no hay
  resistencia visible arriba: ahí se vuelve a la proyección por volatilidad.
  Inventar un nivel inexistente sería peor que proyectar.
- **Techo al objetivo (3× el stop).** Sin él, TUT —a 79,5% de su máximo— daba un
  objetivo absurdo.
- **Compatibilidad intacta.** Sin dato de techo (jugadas manuales), sigue la
  proyección 2,5× de siempre. Tiene test.

Para poder probarlo hubo que extraer `planDeEntrada()`: el cálculo estaba atado
a la llamada HTTP y no se podía verificar sin red. Mejor diseño, además de
testeable. La prueba central fija la propiedad que motivó todo: **dos setups con
el mismo stop y distinta resistencia no pueden dar el mismo R:B.**

### B · Zona de entrada, reusando la watchlist

"Entrá si retrocede a X" no necesitó un sistema nuevo: **el mecanismo de espera
ya existía**. Es un campo más en la condición de armado (`precioMax`), más
azúcar (`zonaPct`) para pedirlo en porcentaje.

Probado en vivo con ADA:

```
referencia (la pone el SERVIDOR): 0,2263
entra si baja a: 0,212722 (-6%)   piso: 0,199144
falta: precio 0.2263 sobre la zona (entra en 0.212722, falta bajar 6,4%)
```

Tres cuidados, todos con test:

- **El blanco móvil** es el error fácil de esta función: si la zona se
  recalculara sobre el precio del momento, perseguiría al precio hacia abajo y
  nunca se alcanzaría. Se fija AL DAR DE ALTA contra una referencia y se congela.
- **Piso de la zona** (`precioMin`, al doble del retroceso pedido). Sin él,
  "esperá un retroceso del 6%" se cumpliría también con una caída del 40% — que
  ya no es descuento. Misma lección que el techo del pullback con TUT.
- **El precio de referencia lo pone el servidor**, no el cliente: la zona queda
  anclada a un precio real y verificable.

En el radar cada fila tiene ahora dos botones: `vigilar` (solo indicadores) y
`−6%` (además, esperar el retroceso).

### C · Invalidación — pospuesta a propósito

Salir porque la razón de entrada murió (nivel estructural roto), no porque el
precio cayó X%. Es la pieza más fina de la lámina y la que más se beneficia de
tener datos: el seguimiento post-cierre está acumulando evidencia sobre si los
stops de % nos cortan recuperaciones (ACE: +52% después de salir) o nos
protegen. Se implementa cuando ese n sea decible, no antes.

### Verificación de camino

Apareció una oferta de TUT que **el monitor creó solo** a las 23:46 con
`score: 75`. Venció sin atender, pero confirma la cadena completa funcionando:
detecta → puntúa → crea oferta → avisa. Es exactamente lo que estuvo roto
semanas por `tg.crearOferta`.

29 tests (antes 27).

**Lección:** un objetivo calculado como múltiplo del stop es una constante disfrazada de análisis — no puede informar ninguna decisión hasta que se apoye en un nivel real del mercado.

## 2026-08-23 (cont.) — Lámina 5: el riesgo deja de estar regado

La lámina 5 ("el sistema de riesgo revisa todo") tiene cinco verificaciones con
un veredicto único. Medidas contra lo nuestro: 1 existía bien, 2 se medían pero
no bloqueaban, y 2 no existían. Pero el hallazgo grande fue el primero.

### A · Tamaño por riesgo, y el límite que el análisis reveló

Medición que abrió el tema:

```
FIL   arriesga 0,13 USDT
PUMP  arriesga 1,02 USDT   ← 8,1 veces más
```

Nadie eligió que PUMP pesara ocho veces más: es el efecto secundario de
combinar **monto fijo** con **stop por volatilidad**. El sistema optimizaba
cuánto invertía y dejaba el riesgo al azar.

**Antes de codificar, el análisis cambió lo que había que construir.** La
hipótesis `sizing-riesgo-fijo` tenía escrita desde el 19-08 una contra-evidencia
que yo iba a ignorar: *"con sleeve de 20 USDT y mínimo de orden de 5, el riesgo
fijo choca con el piso del exchange"*. Al medirla resultó ser aritmética, no un
detalle:

> Para igualar el riesgo de −4% a −15% haría falta a la vez un objetivo **≥0,75**
> (por el piso de 5 USDT) y **≤0,32** (por el techo de 8). Es imposible.

Se probaron cuatro valores de riesgo objetivo y **todos convergen a ~2,3×**.

Jorge eligió *acotar y avisar*. Resultado real:

```
activo  stop   ideal  monto  riesgo  tope
APT     -6%    5,83   5,83   0,35    —
FIL     -7%    5,00   5,00   0,35    —
FET    -10%    3,50   5,00   0,50    mínimo de orden
ZEC    -12%    2,92   5,00   0,60    mínimo de orden
PUMP   -14%    2,50   5,00   0,70    mínimo de orden

dispersión: 8,1× → 2,0×
```

El residuo **se declara** en dashboard y Telegram ("el mínimo de orden obliga a
arriesgar más que el objetivo: el ideal era 2,50"). Y el límite quedó **fijado
en un test**: si algún día la dispersión diera 1,00× exacto, es que alguien tocó
los topes sin entender por qué estaban.

Dos cosas del camino:

- **Bug de punto flotante en el borde exacto.** `0,35/0,07 = 4,999999999999999`,
  así que un ideal de exactamente 5,00 disparaba el piso y la salida decía
  "ideal 5,00 · acotado por el mínimo de 5" — una contradicción visible. Se
  redondea antes de comparar.
- **`MONTO_OFERTA = 5` quedó huérfana** al calcularse el monto. En vez de
  borrarla se reconvirtió en `TOPE_OFERTA_USDT = 8`: ya no es "el monto" sino el
  **límite duro** que ninguna oferta puede pasar, venga de donde venga.

### B · La compuerta única

Un solo lugar donde preguntar "¿puedo abrir esta posición?" y recibir sí o no,
invocado desde el único punto donde nacen las ofertas. Antes los controles
existían pero estaban **regados**: el techo del sleeve en un lado, el congelado
en otro, el riesgo abierto solo como número informativo que nadie consultaba. Un
control disperso que falla en silencio no detiene nada — ya pasó con
`tg.crearOferta`.

**Dos niveles a propósito.** Bloqueos: congelado · caída >10% desde el pico ·
sleeve sobre su techo · reserva insuficiente · riesgo abierto >5% del capital.
Avisos: volatilidad >8% diaria · sleeve al 80% del techo · caída a mitad de
camino del freno. *Bloquear por todo entrena a ignorar los bloqueos.*

**El drawdown no necesitó estado nuevo:** el pico sale de los snapshots ya
guardados. Y funciona como curva de equity limpia porque el **capital es
cerrado** — mover plata entre bolsillos no altera el total.

El umbral de 10% es un juicio declarado en el código: con −2,58% de peor caída
en 5 días no hay datos para calibrarlo. Se define ahora, cuando no duele, que es
el único momento honesto para fijar un freno.

Estado real al implementarlo: caída −2,14% desde el pico de 95,30 · riesgo
abierto 2,00% del capital · sin bloqueos ni avisos.

**El test destapó un fallo de aislamiento con contenido:** la primera corrida dio
"caída del 17,84% desde el pico de 95,30" porque la billetera sintética del test
(78 USDT) se comparaba contra el pico REAL heredado en el sandbox. Es aislamiento
—el test ahora escribe su propia historia— pero confirma que la compuerta lee
historia real, que es lo que debe hacer.

### C · Tope de volatilidad: aviso, no bloqueo

PUMP entró con 8,5% diaria sin objeción. Pero rechazar por volatilidad habría
excluido **HEMI (+46,1%)**, el mejor cierre del historial. Y el R:B mínimo que
puso la lámina 4 ya filtra esos casos indirectamente. Queda como aviso dentro de
la compuerta.

32 tests (antes 29).

**Lección:** calcular la consecuencia de una recomendación ANTES de proponerla; el techo del sleeve al 25% habría mandado a vender 1,90 USDT ese mismo día.

## 2026-08-23 (cont.) — Lámina 6: el 24/7 que no teníamos, medido

La lámina 6 vende un bucle "sin pausas, sin botón de apagado". Medir cuánto de
eso teníamos cambió la conversación:

```
huecos >10 min en la vigilancia:   36
total ciego:                       95,3 h de ~120 (79%)
peor hueco:                        11,2 h (19-ago 05:49)
```

Los cinco peores son de madrugada: el Mac durmiendo.

**Acá corrijo mi propio análisis.** En las tres pasadas sobre el póster clasifiqué
el 24/7 como "ya decidido, iMac más adelante, descartado por ahora". Con 95 horas
ciegas medidas, esa clasificación era cómoda: **el 24/7 no es una mejora
pendiente, es el defecto más caro del sistema hoy** — y lo veníamos midiendo sin
mirarlo (la columna "brecha" existe desde hace días).

Sostengo, eso sí, la conclusión de fondo: la solución no es infraestructura.

### Reconstrucción de cierres (implementada)

Cuando el motor detecta un cruce ocurrido mientras nadie miraba, busca en velas
de **1 minuto** cuándo se cruzó el nivel y ejecuta **a ese nivel** — lo que una
OCO habría hecho sola. Estaba propuesta en la bitácora desde el 20-ago.

Efecto sobre los cierres ya registrados:

```
activo  registrado  nivel  brecha     con reconstrucción
ACE       -16,3%    -12%   -4,3 pp    →  -12%  (brecha 0)
HEMI      +46,1%    +30%  +16,1 pp    →  +30%  (brecha 0)
TRUMP     +31,3%    +30%   +1,3 pp    →  +30%  (brecha 0)
ETH       +11,3%    +10%   +1,3 pp    →  +10%  (brecha 0)
```

**Cuidado con cómo se lee: no es ganar más.** HEMI pasaría de +46,1% a +30% —
*menos* ganancia registrada. El punto no es el resultado sino que el registro
mida la estrategia y no a qué hora despertó el Mac. Un +46% que solo ocurrió
porque nadie miró durante horas no es evidencia de nada, y contamina el registro
de 14 días que es el producto del proyecto.

**El riesgo de esta función es el opuesto al que arregla:** convertirse en
licencia para inventar precios convenientes. Tres candados, todos con test:

1. **Ejecuta en el nivel, nunca en la mecha.** Registrar el extremo sería
   regalarse un relleno imposible.
2. **Solo si la vela confirma el cruce.** Un nivel que nunca se alcanzó no se
   reconstruye.
3. **Solo si el cruce fue antes de esta revisión** (margen 4 min). Si acaba de
   ocurrir, el precio de ahora ya es el correcto.

Falla hacia el comportamiento anterior: sin respuesta de Binance o con más de
24 h de hueco (las velas de 1m ya no están), ejecuta al precio de ahora como
siempre. Cada cierre reconstruido queda marcado en el movimiento
(`[reconstruido: cruzó hace N min]`) y guarda el precio que habría usado, para
que la diferencia sea auditable.

### iMac 24/7 — pendiente acordado, anotado en memoria

Jorge pidió dejarlo anotado para aplicarlo pronto. Queda en la memoria del
proyecto con su justificación medida y la instrucción de **recordárselo** en vez
de esperar a que lo pida. Mientras tanto: `caffeinate` en `run-server.sh`
reduciría la ceguera futura, y la reconstrucción repara el dato.

Y el recordatorio que la lámina no da: **para dinero real nada de esto hace
falta — una OCO en Binance ejecuta sin ninguna computadora encendida.**

33 tests (antes 32).

**Lección:** una columna que mide algo desde hace días no sirve si nadie la mira — la brecha existía y el 24/7 se seguía clasificando como mejora pendiente en vez de defecto caro.

## 2026-08-23 (cont.) — Láminas 7 y 8: la tercera salida, y un bug que casi vuelve a dejar el motor mudo

### Lámina 7 · El memo de decisión y el botón que faltaba

Las cinco secciones del memo del póster (resumen, fuerza de señal, riesgo, plan,
estado) **ya existían como datos** — se fueron construyendo en las láminas 3, 4
y 5. Lo genuinamente nuevo era el **tercer botón**.

Hasta acá una oferta solo podía aprobarse o rechazarse, y rechazar la borraba
para siempre: una buena idea que llegaba en mal momento se perdía. Ahora
`vigilarOferta()` la manda a la watchlist con su condición y vuelve sola cuando
el momento sea el correcto.

Es el puente que faltaba: el motor **ya sabía esperar** (watchlist) y **ya sabía
proponer** (ofertas), pero las dos capacidades no se tocaban.

```
Dashboard   ✓ Aprobar 5,00 USDT  ·  ◉ Vigilar  ·  ✕ Rechazar
Telegram    🟢 APROBAR / 🔵 VIGILAR / 🔴 RECHAZAR   (filas separadas)
```

En Telegram "Vigilar" va en el medio a propósito: es la respuesta más común a
una oferta inoportuna, y un toque impreciso no debe ejecutar una compra. La
decisión deja rastro (`oferta-a-vigilancia`): no operar también es dato. Si el
activo ya estaba vigilado, la oferta se resuelve igual y **enlaza con la
vigilancia existente** en vez de duplicarla.

### El bug crítico que solo apareció probando de verdad

Al crear una oferta real de ADA para verificar el circuito:

```
ERROR: caída del 81,9% desde el pico de 95,30 · el sleeve quedaría en 5,00
       sobre su techo de 4,31
```

**La compuerta de la lámina 5 estaba bloqueando TODAS las ofertas automáticas.**
Se le pasaba `refreshPrecio(asset)`, que devuelve **un único símbolo**, así que
`walletValue` valoraba BTC, APT, FET, FIL, PUMP y ZEC en **cero**: la cartera
parecía de 17 USDT en vez de 93.

Los 34 tests estaban en verde y no lo vieron, porque prueban la compuerta con un
mapa de precios completo. Solo apareció al ejercitar el camino real punta a
punta, creando una oferta de verdad.

Queda anotado en el código: **un control alimentado con datos parciales es peor
que no tener control** — bloquea lo bueno y da confianza falsa. Sin esa prueba
en vivo, el sistema habría quedado mudo otra vez, exactamente como con
`tg.crearOferta`.

### Lámina 8 (portada) · No agrega features: es el índice

`INVESTIGA → SEÑALES → RIESGO → 24/7`. En vez de construir algo, se usó para
verificar el conjunto — y destapó que `clasificarTendencia` no estaba exportada
(funcionaba solo por vivir dentro del módulo).

Se agregó una **prueba de arquitectura** que verifica que la cadena completa
—investiga → señales → riesgo → 24/7 → decisión— tenga todos sus eslabones.
Existe porque el sistema creció por partes, y la forma en que se rompe no es que
una pieza falle sino que **un eslabón desaparezca sin ruido**.

### Cierre del póster

Siete láminas analizadas, cuatro con implementación (2, 3, 4, 5, 6, 7), dos
piezas descartadas con razones escritas (noticias/on-chain, reversión y
continuación) y una pospuesta con criterio (invalidación, espera datos del
seguimiento post-cierre).

35 tests (antes 33).

**Lección:** un control alimentado con datos parciales es peor que no tener control — bloquea lo bueno y da confianza falsa; 34 tests en verde no lo vieron y solo apareció ejercitando el camino real punta a punta.

## 2026-08-23 (cont.) — Las seis piezas que faltaban del póster, y un sello que se quedó quieto

Con las 8 láminas completas (texto + imagen) quedó una lista cerrada de seis
cosas por implementar. Se implementaron las seis. Cuatro salieron como estaban
pensadas; **dos se cayeron al medirlas y hubo que rehacerlas**.

### 1 · Sello de versión — el registro deja de ser una anécdota

Las 6 jugadas cerradas terminaron entre el 19 y el 22-ago; el stop, el objetivo,
el score, la compuerta y el plazo cambiaron el 22 y el 23. **El alfa de +2,88
USDT medía un motor que ya no existe**, y nada en los datos lo decía.

Ahora cada posición y cada movimiento nacen con un sello (`m-xxxxxxxx`), y
`data/versiones.json` guarda qué significaba cada uno. El sello **no se escribe
a mano** — eso es justo lo que dejó la tabla de PLAN-DE-ACCION.md congelada en
v2a: se deriva por hash de los parámetros vivos.

**El sello se quedó quieto en su primera prueba real.** El stop estructural
entró como lógica nueva dentro de `planDeEntrada` sin declarar ningún parámetro
propio, y el hash no se movió: la mentira por omisión que el mecanismo tenía que
evitar. Se corrigió incluyendo la **huella del código** de las tres funciones
donde vive una decisión (`planDeEntrada`, `montoPorRiesgo`, `compuertaRiesgo`) y
de los detectores de señales, normalizada sin comentarios — cambiar una fórmula
mueve el sello, reescribir un comentario no.

### 2 · Estado del motor visible

`ultimaVigilada` existía desde siempre y **no salía a ningún lado**. El `● en
vivo` del dashboard es el WebSocket del NAVEGADOR: puede estar verde con el
motor muerto hace horas. Nuevo `/api/estado` y una línea bajo el encabezado:
`motor al día · vigiló recién · m-046223f1`. Con 91% de ceguera medida en 48 h,
es el indicador que más faltaba.

### 3 · El check de volatilidad bloquea (antes solo avisaba)

El aviso confesaba el problema en su propio texto —"el mínimo de orden hará
arriesgar más de lo objetivo"— y seguía adelante. PUMP quedó con **0,70 USDT de
riesgo contra un objetivo de 0,35**.

Peor: el aviso saltaba a 8% de volatilidad diaria, pero la cuenta se rompe en
**4,67%** (arriba de ahí el piso de 5 USDT impide dimensionar). Entre medio nos
pasábamos sin decir nada. El bloqueo ahora no mira la volatilidad sino el
**desvío real sobre el riesgo objetivo**: tope 1,5x.

### 4 · Stop estructural — la primera versión no servía y se midió antes de dejarla

El objetivo se apoyaba en el techo de 30 días desde hace días; el stop seguía
siendo pura volatilidad, así que el R:B dividía una distancia estructural por
una estadística.

Primera versión: piso = mínimo de 30 días. **Medido contra los 12 activos del
radar, apretó en 0 de 12** — el mínimo del mes está entre 23% y 184% abajo. La
regla era inerte.

La referencia correcta es el **piso del retroceso en curso** (mínimo desde que
se marcó el techo de 30 días): entre 3% y 11% en los mismos 12 activos, que es
la vecindad donde vive el stop. Aprieta en 2 de 12 (ETH −8→−7, DOT −6→−5).

Regla de una sola dirección: la estructura **solo puede apretar** el stop, nunca
ensancharlo — ensanchar rompería el presupuesto de riesgo y la lección de GPS.
El piso duro de −4% sigue vigente.

### 5 · Invalidación — separada del stop, y a cuarentena

La lámina 4 la dibuja como un nivel **distinto** del stop, no como el mismo. Es
la corrección de un análisis previo que los había fundido en uno.

Acá nos apartamos del dibujo: el póster pone el stop POR ENCIMA de la
invalidación, y un stop por encima del soporte se barre en cada toque del
soporte. El stop va debajo. Lo que la invalidación aporta no es otra salida
—quien corta siempre es el stop— sino **la lectura del cierre**: si el precio de
salida quedó bajo el piso, la estructura se rompió, el setup no era válido y el
activo va a cuarentena. Incluso cuando salió por plazo, que antes quedaba fuera
del veto y podía reproponerse al día siguiente.

### 6 · El plazo deja de ser un acantilado

A la hora 48 el nivel de salida saltaba de −6% a la banda de ruido (~+2,7%) **de
golpe**. Una posición que sobrevivía en +3% quedaba cortada en el primer bajón
normal del día siguiente.

Y cortar ganadores temprano ya estaba medido como EL defecto de este sistema:

```
después de que cerramos:  TRUMP +68%  ACE +52%  ZEC +39%  HEMI +22%  SOL +14%  ETH +10%
```

6 de 6 siguieron subiendo. El plazo agregaba una séptima manera de hacer lo
mismo. Ahora el stop **sube en rampa**: al vencer arranca en su nivel original y
llega a la banda tras otro tanto de tiempo. La intención se respeta —el capital
que no rinde se libera— pero por apriete gradual.

### Verificación

- **Equivalencia numérica** en el camino del dinero: con precios congelados, las
  5 posiciones abiertas dan `limite`, `objetivo`, `pnl`, `progreso` y `señal`
  **idénticos** antes y después.
- **41 tests** (antes 35), y los nuevos verificados por mutación: se inyectaron
  los cuatro bugs reales (estructura que ensancha, volatilidad que solo avisa,
  acantilado del plazo, huella insensible al código) y cada uno los puso rojos.
- **Oferta real punta a punta** (LINK, la prueba que destapó el bug de ADA):
  creada con `tipoStop`, `alPisoPct` e `invalidacionPct` poblados, y descartada
  después. El test de arquitectura cazó de paso un binding `a` que colisionaba
  con los acumuladores de `reduce`.

Fuera de lista y decidido: noticias, on-chain, continuación, reversión, pérdida
máxima (redundante con el drawdown a esta escala) y las etiquetas cualitativas
del memo. Pendiente real: el 24/7 del iMac.

### 7 · El R:B mínimo también en las ofertas manuales (Jorge lo pidió al cierre)

El mínimo de 1,5 se aplicaba en el screening automático pero **no** en una oferta
pedida a mano: LINK se creó con 1,17 — arriesgar 6% para ganar 8%. El objetivo
ahora viaja a `compuertaRiesgo`, así que la puerta es una sola venga la oferta de
donde venga.

Medido antes de aplicarlo, sobre los 12 activos del radar con el objetivo
estructural puesto:

```
pasan:     APT 2,00 · DOT 2,00 · NEAR 2,00 · AVAX 1,80 · FIL 1,57
bloquean:  BTC 0,75 · ETH 0,71 · SOL 1,20 · FET 1,30 · LINK 1,33 · ZEC 0,58 · PUMP 0,29
```

7 de 12 quedan fuera, y cortan lo correcto: son activos pegados a su techo de 30
días, donde queda poco recorrido arriba y el stop sigue midiendo lo mismo abajo.
No es un filtro que bloquee todo — deja pasar 5.

Verificado en vivo: LINK responde `R:B 1.33 bajo el mínimo de 1.5`; APT se crea
normal con R:B 2,0. 42 tests, el nuevo verificado por mutación.

**Lección:** una regla nueva se mide contra el mercado real antes de darla por buena — el stop con piso de 30 días apretaba en 0 de 12 activos y era inerte.

**Lección 2:** un identificador de versión que se escribe a mano miente por omisión; si se deriva del código y de los parámetros, olvidarse deja de ser posible.

## 2026-08-23 (cont.) — Los dos controles que daban confianza sin ejercerla

Al preguntar "¿queda algo?" aparecieron dos agujeros. Ninguno estaba en el
póster: los dos son nuestros.

### 1 · El botón de jugada manual se saltaba la compuerta entera

```
/api/oferta   → nuevaOferta() → compuertaRiesgo()   ✓ todos los controles
/api/jugada   → jugadaManual()                      ✗ ninguno
```

Se saltaba el freno de caída del 10%, el techo del sleeve, el tope de riesgo
abierto, el desvío de riesgo y el R:B mínimo — este último **recién agregado a
las ofertas ese mismo día**. Cerramos una puerta y dejamos abierta la de al
lado.

Arreglarlo obligó a tocar el orden de escritura, y ahí apareció un bug latente
que nadie había visto: **las ventas cerraban posiciones en disco ANTES de que se
le pidieran los stops a Binance.** Si esa llamada fallaba, quedaba la posición
cerrada y la billetera sin escribir — el activo contado dos veces. La estructura
nueva encola cierres y aperturas y las ejecuta después de un punto de no
retorno explícito: hasta ahí todo es memoria y puede abortar sin rastro.

Tres decisiones del diseño:

- **La compuerta recibe la billetera EN MEMORIA** (`compuertaRiesgo(plan,
  prices, { wallet })`). Con la del disco, "vender A para comprar B" se
  bloquearía por reserva insuficiente mirando el saldo de antes de la venta.
- **Los planes se calculan una sola vez, antes de tocar nada.** Antes se pedía
  `stopsSugeridos` dentro del bucle; con dos llamadas, la compuerta podía juzgar
  un plan y ejecutarse otro con la volatilidad ya movida.
- **Las ventas nunca se bloquean.** Solo se juzgan las compras: poder salir no
  puede depender de un control de riesgo, menos en una caída.

Lo que NO se tocó: `congelar()` sigue sin bloquear la jugada manual. La
congelación protege el teléfono, no el teclado — y quien está en el Mac es quien
puede descongelar.

Verificado en vivo: una jugada de SOL con R:B 0,50 responde `riesgo en SOL: R:B
0.50 bajo el mínimo de 1.5`, y `posiciones.json` y `wallet.json` quedan **byte a
byte idénticos**.

### 2 · El freno de caída medía contra un pico que alguien tenía que estar mirando

`appendSnapshot` se llamaba desde `aplicarPlan`, `refreshMarket` y `runAnalysis`
— o sea, cuando el dashboard estaba abierto. Y `drawdownActual` saca el pico de
esa serie.

**El freno del 10% no medía la caída desde el máximo real, sino desde el máximo
que quedó registrado porque había alguien mirando.** Un techo alcanzado de
madrugada no existía, y la caída desde él nunca activaba el freno. Con 91% de
ceguera medida en 48 h, el control estaba mayormente ciego.

Ahora el monitor deja su punto cada 15 min (no cada 3: alcanza para capturar el
pico sin inflar el archivo — 96 líneas al día en vez de 480). La billetera real
se valoriza con las cantidades ya conocidas y precios en vivo: **no gasta una
llamada firmada ni toca las claves**.

Verificado: con el dashboard cerrado, `snapshots.jsonl` pasó de 156 a 157 líneas
sola.

### Estado

45 tests (antes 42). Los cuatro nuevos verificados por mutación: sin compuerta
en la jugada manual, compuerta que ignora la billetera dada, y monitor que no
escribe — cada mutación los pone rojos.

**Lección:** un control aplicado en una ruta y no en la de al lado da confianza falsa — el R:B se cerró en las ofertas y quedó abierto en la jugada manual el mismo día.

**Lección 2:** ninguna operación puede escribir a disco antes de terminar de validarse; las ventas cerraban posiciones antes de una llamada de red que podía fallar.

## 2026-08-23 (cont.) — Documentar con el método, y descubrir que el método no leía

Registrar el día en el sistema de aprendizaje —en vez de solo narrarlo acá—
destapó que **las tres piezas del método estaban rotas en silencio**. Habíamos
escrito mucho y el sistema no recogía casi nada.

### El extractor se cortaba en la primera letra "Z"

```js
/^## (\d{4}-\d{2}-\d{2})([^\n]*)\n([\s\S]*?)(?=^## |\Z)/gm
```

`\Z` **no existe en JavaScript**: es la letra Z literal. El cuerpo de cada
entrada se cortaba en el primer "ZEC" del texto, y las lecciones —que van al
final— quedaban invisibles. Siete entradas del día, **cero lecciones leídas**.
Con `$(?![\s\S])`: 7 entradas, 10 lecciones.

### El detector de deriva gritaba en falso 3 de 4 veces

`VENTANA_DIAS` se había renombrado a `VENTANA_MODELO_DIAS`, `REBALANCE_CADA` a
`REBALANCEO_CADA_DIAS`, y `hora-local-no-utc` buscaba en engine y server un
helper que vive en telegram.mjs — módulo que el detector ni leía.

El arreglo de fondo no fue actualizar los patrones. **Buscar un substring prueba
presencia, nunca ausencia de implementación**: que el patrón no aparezca admite
dos lecturas opuestas —el motor dejó de cumplir, o el nombre cambió— y llamarlo
"brecha" afirmaba la primera sin poder distinguirla de la segunda. Ahora se
declara lo único cierto: `sinVerificar`, con el motivo nombrando las dos
posibilidades.

### La tabla de versiones no tenía nada que la contrastara

Estaba en v1/v2a mientras el código etiquetaba los movimientos como "modelo
v2d". Ahora declara las 12 versiones reales (v1 → v3f) con su sello, y
`sellosNoDeclarados()` cruza la tabla contra `data/versiones.json`, que escribe
el motor solo: cualquier sello que haya operado sin estar documentado aparece
como deuda. Arreglarla a mano sin ese cruce era repetir el error que la pudrió.

### Lo registrado

8 hipótesis nuevas, todas verificadas contra el código: `sello-de-version`,
`stop-estructural`, `invalidacion-a-cuarentena`, `plazo-progresivo`,
`desvio-de-riesgo-bloquea`, `una-sola-puerta`, `serie-la-escribe-el-motor`,
`nada-al-disco-sin-validar`. Dos nacen con contraevidencia propia: el stop
estructural aprieta solo en 2 de 12 activos, y la invalidación casi siempre
llega después del stop.

48 tests (antes 45). Los tres nuevos verificados por mutación.

**Lección:** un mecanismo de registro que nadie ejercita se pudre igual que el código — el extractor llevaba días sin leer una sola lección y nada lo delataba.

**Lección 2:** buscar un substring prueba presencia, nunca ausencia: un detector que reporta "no implementado" cuando en realidad no pudo verificar, miente con la misma cara con que acierta.

## 2026-08-23 (cont.) — Auditoría técnica: el análisis pedía las velas de a una

Auditar el motor con dos guías externas (`modern-javascript-patterns` y
`javascript-testing-patterns`) confirmó que **no hay deuda de sintaxis**: cero
`var`, cero callbacks de error, 123 usos de `?.` y 206 de `??`, y los tres
`.then()` que quedan son avisos fire-and-forget legítimos. De las 15 buenas
prácticas de la guía, 13 ya se cumplían.

Lo que sí apareció fue de arquitectura, y medible.

### Las llamadas a Binance iban en serie

`runAnalysis` recorría los 30 candidatos con `await momentumModelo()` uno por
uno. Medido contra la API real antes de tocar nada:

```
10 símbolos    secuencial 3.564 ms    paralelo 390 ms    → 9,1x
```

Resultado del cambio, con el análisis completo de verdad:

```
antes (estimado en serie)   ~21 s
después, corrida 1          3,94 s
después, corrida 2          3,59 s
```

### El límite de concurrencia no es adorno

`Promise.all` sobre 60 peticiones puede ganarse un 429 de Binance y tumbar el
análisis entero: el remedio sería peor que la lentitud. `enParalelo` corre de a
**6** — captura casi toda la ganancia sin acercarse al techo de peso.

### Las dos garantías que el bucle secuencial daba y no se podían perder

1. **Orden de entrada, no de llegada.** `scored` construye el ranking; si el
   orden dependiera de qué respuesta vuelve primero, los empates de momentum se
   resolverían por latencia de red. El test lo prueba con latencia INVERSA al
   índice: el último en pedirse es el primero en llegar.
2. **Un fallo no tumba al resto.** Cada elemento devuelve su propia ranura
   `{ ok, valor, error }`, igual que el try/catch por candidato de antes.

Excepción deliberada: en los planes de compra de `jugadaManual` el fallo **sí**
aborta. Sin niveles no hay plan que la compuerta pueda juzgar, y comprar a
ciegas es justo lo que no se quiere.

### Verificación

Dos corridas consecutivas dieron el ranking **idéntico**, y los picks no
cambiaron (TUT, PUMP, ENA). Sin 429 ni errores en el log. 51 tests (antes 48);
las tres mutaciones —devolver por orden de llegada, quitar el tope de
concurrencia, dejar que un fallo se propague— ponen rojos los tests nuevos.

**Lección:** paralelizar un cálculo que alimenta un ranking solo es seguro si el orden de salida no depende de la latencia; probarlo exige una latencia adversaria, no una uniforme.

## 2026-08-23 (cont.) — Punto 2: separar probar la lógica de medir el mercado

Cuatro tests salían a Binance. Con `fetch` bloqueado fallaban los cuatro, y uno
era **el test de la compuerta** — el control de seguridad más importante del
motor. Un test de seguridad que depende de que Binance esté arriba no es un test
de seguridad: con la red lenta falla con un mensaje indistinguible de un fallo
real.

```
antes:  51 tests · 4 con red · 8 peticiones · 3,18 s · 4 fallan sin red
ahora:  51 tests · 0 con red · 0 peticiones · 0,82 s · 51 pasan sin red
```

### Lo que NO se hizo: mockear y olvidarse

Probar contra el mercado real cazó dos bugs que ningún mock habría cazado (TUT
clasificando pullback a −80%, la compuerta bloqueando todo con precios
parciales). Eliminar esa práctica habría sido cambiar un problema por otro.

Lo que estaba mal era tenerlas **mezcladas**: los tests prueban LÓGICA
—deterministas, sin red, sí o no— y `src/mercado.mjs` MIDE contra el mercado y
reporta números. Son dos tareas y ahora son dos comandos.

### El Binance de mentira es inerte por construcción

Un precio inventado de 100 mandaba APT (entrada 0,63) a +15.000% y liquidaba
media cartera del sandbox: el mock habría cambiado el comportamiento del resto
de la suite en vez de aislarlo. Para los símbolos que la prueba no nombra, el
precio por defecto es el de **entrada de esa posición** — cero exacto, no cruza
ningún nivel.

### El script de mercado se equivocó dos veces antes de servir

Las dos valen como advertencia sobre los diagnósticos:

1. Reportó **0 señales de 12**. `contextoEntrada` no trae `fase`, y dos de los
   tres detectores la exigen: el script la calculaba mal, no el motor. Un
   diagnóstico que grita "el motor no encuentra nada" cuando el motor está bien
   es peor que no tener diagnóstico.
2. Levantó alarma por **SOL con señal y RSI 80,2**. El veto de sobrecompra vive
   en el screening, no en el detector — el detector solo dice "hay patrón". La
   condición correcta es que un sobrecomprado llegue a ser *ofertable*, o sea
   que además supere el umbral de score.

Corregidas las dos: 10/12 con señal, 5 sobre el umbral, sin alarmas.

### Medición del día (varía con la volatilidad)

```
10/12 pasan el R:B mínimo · 7 con stop estructural
cartera 95,30 pico · caída −3,28% · riesgo abierto 1,22 (1,32% de 5%)
```

Nota: el stop estructural apretaba en **2 de 12** al implementarlo esta mañana y
ahora en 7. No cambió el código: bajó la volatilidad, los stops se estrecharon y
el ancla estructural muerde más seguido. El número no es una propiedad del
motor, es del mercado del día.

Las cuatro pruebas migradas siguen cazando sus bugs: mutar el R:B, el plazo, la
reconstrucción y la protección del legado las pone rojas.

**Lección:** mockear la red no puede cambiar el comportamiento de lo que no se está probando; un valor por defecto inventado convierte el aislamiento en interferencia.

## 2026-08-23 (cont.) — Puntos 3 y 4: fixtures y las tres fases de una jugada

Los dos son de forma, sin cambio de comportamiento. Se exigió equivalencia igual.

### 3 · Una factory en vez de diez billeteras a mano

`capitalInicial: 80` aparecía doce veces y `ancla: {` diez. Agregar un bolsillo
obligaba a tocar diez sitios: la duplicación ES el bug, no el olvido de mañana.
Ahora `billetera({ ... })` da la forma completa y cada prueba declara solo lo
que le importa. De 12 literales quedaron 3.

**Excepción escrita en el código:** las dos pruebas que construyen los bolsillos
recorriendo `BOLSILLOS` NO usan la factory. Su trabajo es *descubrir* los
bolsillos; darles una lista fija reintroduciría el bug que perdió 42,50 USDT en
silencio. Sin esa nota, alguien lo "arregla" en tres meses.

### 4 · `jugadaManual`: 188 → 147 líneas

El "punto de no retorno" estaba marcado solo con un comentario. Ahora las fases
son fronteras de función, que es más difícil de cruzar por accidente al editar:

```
validarEntrada()        lo que se rechaza sin red ni billetera
validarContraCartera()  ancla, legado, par inexistente
aplicarVentas()         en memoria; el cierre en disco se encola
confirmarJugada()       el punto de no retorno: solo escribe
registrarContexto()     instrumentación, fuera del camino del dinero
```

**Hasta acá y no más.** El bucle de compras se queda adentro: extraerlo exigiría
pasarle billetera, precios, planes, sello, trades, avisos y las dos colas —una
función de siete parámetros no es una mejora, es mover el problema de lugar.

### Equivalencia verificada con jugadas reales

Compra sola: DOT 5 USDT, stop −4% (estructural, protegido por el piso duro),
objetivo +10%, invalidación −1,03%, sellada.

Venta + compra en la misma jugada —el caso que obligó a pasarle la billetera
viva a la compuerta— con aritmética exacta:

```
20,38 + 3,19×(1−0,001) − 5,00 = 18,57
FET cerrada · DOT abierta · 4 posiciones antes y después · sin avisos
```

51 tests en verde, sin red, en 0,82 s.

**Lección:** al extraer funciones, la frontera correcta es la que reduce parámetros; si extraer obliga a pasar siete argumentos, la cohesión estaba donde estaba.

## 2026-08-23 (cont.) — El log deja de perderse y el motor muere avisando

Dos de infraestructura, no de lógica. La auditoría técnica dejó seis pendientes;
git y los puntos 4-6 quedaron en el nuevo `BACKLOG.md`, estos dos se hicieron.

### El log se perdía entero

`run-server.sh` terminaba en `exec node src/server.mjs` sin redirección: los
`[AUTO-STOP]`, `[ALERTA]` y `avisarFalla` iban a la ventana de Terminal y al
cerrarla no quedaba nada. Era la mitad que faltaba del trabajo de hoy — el
dashboard ya podía decir **si** el motor corrió, pero no **qué hizo**.

Ahora `tee -a data/servidor.log`: quien arranca desde Terminal sigue viendo todo
y además queda escrito. Rota sobre 2 MB a `.log.1` — una sola generación alcanza,
el histórico de verdad son `movimientos.jsonl` y `alertas.jsonl`.

**Y con hora.** Salía sin timestamp, y "AUTO-STOP ejecutado" sin hora no sirve
para auditar nada: la pregunta siempre es *cuándo*. Se envuelven `console.log`,
`error` y `warn` con la marca en hora local — la misma frontera del día que usa
el resto del proyecto.

### Muerte ruidosa

No había `uncaughtException` ni `unhandledRejection`: un error inesperado mataba
el proceso en silencio y Jorge se enteraba horas después.

**No se traga el error.** Un motor que maneja plata con el estado a medio
escribir es peor que uno caído: si algo llegó hasta ahí, ninguna de las defensas
de arriba supo qué hacer con ello. Registra el stack, avisa por macOS y Telegram,
y sale con código 1. Salir es seguro porque el candado garantiza que no había
dos escrituras en vuelo y la escritura atómica que ningún archivo quedó a medias.

Verificado con una promesa rechazada de verdad contra el servidor real:

```
[01:25:39] FATAL · promesa rechazada sin catch: Error: fallo simulado para la prueba
código de salida: 1
```

**Lo que NO se hizo:** reiniciar solo. Un bucle de reinicio enmascara un crash
repetido; la forma correcta es un supervisor con tope de reintentos, y su lugar
es junto con la migración al iMac, cuando el proceso pase a ser desatendido de
verdad. Queda en el backlog.

De paso, `.claude/launch.json` ahora arranca por `run-server.sh` en vez de
llamar a node directo: lo que se prueba tiene que ser lo que Jorge corre.

**Lección:** un registro sin hora no es un registro; y una caída silenciosa cuesta más que una ruidosa, porque el costo no es el error sino las horas que tarda en notarse.

## 2026-08-23 (cont.) — Movimientos del día y la watchlist aprende a esperar la calma

Régimen **débil** (BTC −1,1%, solo 1 de 5 majors sube): el motor propuso **cero**
entradas. Es un resultado, no una falla — el veto de régimen es el filtro que
más pérdidas evitó.

### Lo ejecutado (billetera ficticia)

```
VENDER ZEC   3,01 USDT @ 790,85    fin del experimento de 13,6 h
VENDER FIL   3,16 USDT @ 0,7419    salida adelantada, estaba a 1,5 pp del stop
```

PUMP queda hasta mañana por decisión de Jorge (+4,83%). FET sigue con su plazo.

### Primera reconstrucción en una posición real

APT se cortó sola a **−6,0% exacto**, y el nivel se había cruzado **22,5 horas
antes**. Sin reconstrucción habría vendido al precio de esta mañana y el registro
habría medido a qué hora despertó el Mac. Brecha 0 pp.

### TUT: la compuerta hizo su trabajo el primer día

Jorge pidió comprar 5 USDT de TUT. La compuerta bloqueó:

```
TUT · volatilidad 27,2%/día · stop −15% (el techo duro) · R:B 3,0
con 5 USDT → riesgo 0,75 USDT = 2,1x el objetivo (tope 1,5x)
```

El problema no es la salida automática —ya existe— sino que **el stop no se
puede poner donde debería**: −15% en un activo que se mueve 27% al día es medio
día de ruido. Es la lección de GPS con otro nombre. Y no hay tamaño válido: para
respetar el riesgo harían falta 2,33 USDT, bajo el mínimo de orden de 5.

### La watchlist no sabía esperar por volatilidad

Agregar TUT con la condición por defecto habría sido peor que no agregarlo:
armaría cada 15 minutos una oferta que la compuerta rechaza, para siempre.

Había un hueco conceptual: la watchlist sabía esperar **indicadores** y
**precio**, pero no que el activo **se calmara**. Hay activos que no se rechazan
por caros sino por *indimensionables*.

Nueva condición `volMaxPct`, con el umbral derivado y no inventado: riesgo =
5 × 1,5×vol ≤ 1,5 × 0,35 → **vol ≤ 7%**.

```
TUT · vence en 7 d · {rsiMax: 70, fasesOk: [tendencia, rango], volMaxPct: 7}
     falta: volatilidad 27,2%/día (necesita <= 7%)
```

**Una sola copia de la volatilidad.** Se extrajo `volatilidadDiaria()` porque el
sizing y la condición tienen que dar el MISMO número: si la watchlist midiera
sobre 31 velas y el stop sobre 15, armaría justo cuando el tamaño todavía no da.

53 tests (antes 51). Dos correcciones sobre mis propias pruebas en el camino: la
primera versión del test de la ventana **no se ponía roja al mutarla** —llamaba
al helper directo y nunca tocaba el `slice(-15)` real— y hubo que rehacerla como
prueba de contrato sobre la fuente; la segunda falló por un regex que cortaba en
el primer paréntesis.

**Lección:** un activo puede ser inoperable por tamaño y no por precio; esperar "a que baje" no alcanza si lo que sobra es volatilidad.

## 2026-08-23 (cont.) — Radar 24 h: la columna "profit" que se midió y no se construyó

Jorge pidió una card tipo radar para las próximas 24 h con una columna **profit**:
si va a ganar o perder en ese rango corto.

Se probó **antes** de construirla, con 1.000 velas horarias de las 13 monedas de
mayor volumen (~2.000 casos por señal):

```
señal                       acierto   retorno medio 24 h
momentum 6h                  48,3%         +0,375%
momentum 24h                 50,0%         +0,703%
reversión 24h                49,1%         −0,703%
posición en el rango 24h     51,5%         +0,588%
volumen relativo             50,5%         −0,126%
─────────────────────────────────────────────────────
comprar cualquier cosa       51,1%         +0,893%
```

**Ninguna le gana a comprar al azar** — y las mejores incluso restan valor
frente a la base. Poner una flecha de dirección habría sido fabricar un número
con cara de dato. El riesgo no es que falle: es que se le crea y se opere con él.

### Lo que sí se pudo medir

La MAGNITUD está calibrada. σ de los retornos horarios × √24:

```
movimiento dentro de ±1σ:  68,5%   (teórico 68%)
movimiento dentro de ±2σ:  89,8%   (teórico 95%)
|movimiento| / σ promedio: 0,97    (teórico 0,80)
```

Casi perfecta en ±1σ. Las colas son más gordas que la normal — típico de cripto
— así que la banda se declara como "2 de cada 3 veces" y nunca como un techo.

### La card

Seis columnas: activo con su flecha 24 h, cambio, volumen, **recorrido ±24 h**
(en % y en USDT sobre una posición de 5), posición dentro del rango del día y
zona probable. La barra del rango es **gris a propósito**: un color direccional
invitaría a leerla como señal.

El pie de la card explica en dos líneas qué es el recorrido y por qué no hay
columna de dirección — la explicación va donde se lee el dato, no en el README.

Para qué sirve de verdad: **para dimensionar**. TRUMP se mueve ±19,1% al día y
BTC ±1,3%; no admiten el mismo tamaño de posición. Es el mismo dato que hoy hizo
que la compuerta rechazara TUT.

**Lección:** cuando alguien pide un número que no se puede estimar, la respuesta útil no es negarse ni inventarlo: es medir qué SÍ se puede estimar de esa misma pregunta y entregar eso, diciendo por qué.

## 2026-08-23 (cont.) — El historial deja de recortar en silencio

`renderMovimientos` hacía `.slice(-5)`: **los días anteriores desaparecían sin
decirlo**. Con 5 días de proyecto no se notaba; a los 14 de la validación se
habría perdido más de la mitad del registro sin que nada lo indicara — y el
registro es el producto del proyecto.

Ahora: **4 días por página**, con paginador que dice cuántos días hay en total,
y scroll acotado a 520 px.

**El scroll va DENTRO de la lista, no en la card.** Si estuviera en la card, el
paginador quedaría al final del documento y habría que recorrer los cuatro días
enteros solo para pasar de página. Con el scroll interno el paginador está
siempre a la vista.

Verificado en el navegador: página 1 muestra 23, 22, 21 y 19-ago con la lista
scrolleando (1.168 px de contenido en 520 de alto); página 2 muestra el 18-ago;
los botones se desactivan en los extremos y volver atrás restituye la primera
página. El contador dice "5 días con actividad", así que nunca hay registro
oculto sin anunciar.

**Lección:** un `slice()` en una vista de registro no es un recorte visual, es una omisión — o se anuncia lo que falta, o el dato miente.

## 2026-08-23 (cont.) — Salir temprano, medido en plata: cuesta casi el alfa entero

Jorge pidió que el seguimiento post-cierre alimente el aprendizaje y el cálculo,
para no repetir el error de cobrar antes de tiempo.

### El porcentaje decía que la regla falla; los USDT dicen cuánto cuesta

Se agregó `costoUSDT` y `maximoUSDT` al seguimiento: el mismo dato al tamaño que
de verdad se operó. Un "+68%" sobre 5 USDT y sobre 50 son la misma cifra y dos
hechos distintos.

```
activo  tipo      pnl%    costo%   costoUSDT  máxUSDT
TRUMP   objetivo  +31.3     +3.5      +0.23     4.46
HEMI    objetivo  +46.1    -22.3      -1.63     1.57   ← única salida acertada
ZEC     objetivo  +12.6    +28.5      +1.54     2.11
ETH     objetivo  +11.3     +8.8      +0.49     0.55
SOL     objetivo   +6.0    +12.2      +0.65     0.77
ACE     stop      -16.3    +24.0      +1.00     2.18
────────────────────────────────────────────────────
TOTAL dejado en la mesa a 48 h: 2,28 USDT · techo con salida perfecta: 11,64
```

**2,28 USDT es casi el alfa completo del proyecto (+2,88).** Salir temprano ha
costado tanto como todo lo que la estrategia ganó. Ese número —y no el
porcentaje— es el que justifica cambiar la regla.

### Backtest: el arreglo intuitivo es el peor

429 ventanas sobre 13 pares, 41 días, stop −6%, máximo 7 días por operación:

```
regla                       ret. medio   ganadoras
objetivo fijo +15%            +0,440%      45,5%
objetivo fijo +25%            +1,124%      45,2%
trailing 6% desde +8%         +0,289%      46,6%   ← PEOR que hoy
trailing 10% desde +10%       +1,157%      44,5%   ← mejor
mitad a +15% + trail 8%       +0,673%      45,5%
```

Lo importante no es cuál gana: es que **"ponerle un trailing" —el arreglo que
uno escribiría sin medir— rinde peor que el objetivo actual.** Un trailing
ajustado no deja correr al ganador: lo corta con otro nombre. Solo el trailing
*amplio* o el objetivo *más ancho* mueven la aguja.

### Lo que NO se hizo: cambiar el modelo hoy

Las reglas de la casa lo prohíben y con razón: n=6 en cierres reales está bajo el
umbral orientativo de 8; el backtest usa ventanas **solapadas** (paso 24 h,
operación de hasta 168 h) así que el n efectivo es ~1/7 del nominal; cubre 41
días de mercado mayormente alcista; y nuestro objetivo no es fijo sino
estructural, así que el backtest no mapea 1:1.

Queda registrado como **hipótesis `objetivo-corta-temprano`** con su evidencia Y
su contraevidencia, y como **v4a candidata** en la tabla de versiones, a decidir
al cierre del ciclo (25-ago) con backtest propio.

**Lección:** medir en porcentaje dice si una regla falla; medirla en plata dice si vale la pena cambiarla. Son dos preguntas distintas y la segunda es la que decide.

## 2026-08-23 (cont.) — Lectura de los 5 días y el plan para el iMac

Jorge observó que al día 5 la ficticia (92,26) no supera a la real (98,79) y
planteó, con razón, que eso no era lo que esperaba.

### La brecha entera tiene un dueño: XRP

```
brecha real            −6,31 USDT
solo XRP               −8,26 USDT
todo lo demás junto    +1,95 USDT
```

La ficticia vendió 19,77 XRP por 20,29 USDT los días 18 y 19 a ~1,00. Hoy XRP
está en 1,4438: la real, que las conserva, tiene 28,55 USDT ahí. **Sin XRP la
ficticia estaría por encima.** Tres de las cuatro ventas fueron discrecionales de
Jorge; la cuarta fue la regla del techo del sleeve.

Mientras tanto el alfa del sleeve —cada jugada contra esa misma plata en BTC— da
**+2,52 USDT (+5,27 pp)** con 67% de acierto en 9 cerradas. Las dos cosas son
ciertas a la vez y no se contradicen: la brecha viene de haber soltado XRP, no de
que las jugadas pierdan.

### El punto metodológico que hay que decidir ANTES de encender el iMac

```
vigilancia actual: 5% del tiempo · ciego 100 h de 105
```

Todo el registro de estos 5 días se produjo con el motor mirando el **5%** del
tiempo. Encender el iMac 24/7 no es "más de lo mismo con más datos": es **otro
sistema**. Los stops van a ejecutar en su nivel en vez de horas después, la
watchlist va a armar cuando la condición se cumple y no cuando alguien abre el
laptop, y las oportunidades nocturnas van a existir.

Eso significa que **el día 1 del iMac es el día 1 de la medición que vale**. Los
días 18-23 sirven para depurar el motor, no como muestra de rendimiento —
mezclarlos con los siguientes produce un promedio de dos sistemas distintos, que
es exactamente lo que el sello de versión existe para evitar.

Propuesta registrada: al migrar, marcar el corte en el registro y contar los
14 días de validación **desde ahí**. La expectativa de "cambio sustancial al día
10-15" hay que leerla sobre ese reloj nuevo, no sobre el actual.

**Lección:** cambiar la infraestructura de observación cambia el experimento, no solo su comodidad; el registro anterior y el posterior no son la misma muestra.

## 2026-08-23 (cont.) — Trailing en PUMP: "si se devuelve un 25%, rescatar"

Jorge lo pidió para PUMP. Va en la dirección que el backtest de hoy respalda —
el trailing **amplio** rinde (+1,157% con 10% desde +10%) y el **ajustado**
empeora (+0,289% con 6% desde +8%, peor que el objetivo actual). 25% es amplio.

### El pico sale de las velas, no de los ticks

La decisión de diseño que importa. Acumular el máximo tick a tick habría dado
*el máximo de lo que alguien alcanzó a mirar*: con vigilancia del 5% del tiempo,
el trailing protegería una ganancia que nunca existió. `refrescarPicos()` lo
recalcula de velas horarias desde la apertura, en cada ciclo del monitor, y el
pico solo sube. Misma lección que la reconstrucción de cierres.

### Solo aprieta

El nivel efectivo es `max(stop original, rampa del plazo, trailing)`. Hoy en
PUMP eso significa que **todavía no muerde**:

```
PUMP entrada 0,004654 · pico 0,005145 (+10,6%)
trailing 25% del pico → 0,00385875 = −17,1% sobre la entrada
stop original −13% → MANDA el original
```

Empieza a proteger recién cuando PUMP supere **+16%**: ahí el 25% del pico sube
por encima del −13%. Que no haga nada hoy es la respuesta correcta, no una
falla.

### Falla hacia atrás

Sin pico medido no hay trailing — ni siquiera uno calculado desde la entrada. Ese
atajo apretaría un stop ancho por un máximo imaginario: una posición con stop
−40% quedaría recortada a −25% sin que el precio hubiera subido nunca. El test
lo fija con ese caso exacto, porque el caso fácil (stop −13%) hace la mutación
inocua y la prueba pasaba igual.

55 tests (antes 53). Tres mutaciones verificadas: trailing que ensancha, pico
inventado y trailing que no corta.

**Lección:** un máximo observado y un máximo real son cosas distintas cuando el observador duerme; cualquier regla que dependa de un extremo tiene que reconstruirlo, no recordarlo.

## 2026-08-23 (tarde) — Rally amplio, nada barato, y la rampa cobra su primer caso

### El mercado subió y por eso no hay nada que comprar

```
RÉGIMEN: rally amplio · BTC +0,41% 24 h · +23,04% en 7 días · amplitud 100%
oportunidades: 0

7 de 12 descartados por RSI ≥ 80 (sobrecompra extrema)
   ENA 87,6 · ZEC 89,1 · TRUMP 85,3 · XRP 86,6 · DOGE 85,2 · AAVE 84,4 · PEPE 81,7
1 a tres puntos:  ETH score 62/65 (lo que pesa en contra: RSI)
3 en anti-spam:   TUT, LINK, ADA (avisados en las últimas 12 h)
```

El régimen mejoró (ayer era «débil») y aun así no entra nada: después de +23% en
una semana **todo quedó caro a la vez**. Es el filtro que evitó GPS (−26%) y ACE
(−16%). Jorge eligió no forzar nada y dejar correr lo abierto.

Se descartó bajar el umbral de score a 60 para que ETH entrara: mover la vara
porque no pasa nadie es ajustar el criterio al resultado.

### La rampa del plazo salvó a FET

```
ayer 23:30   −2,44%   umbral de la banda +2,53%
hoy          +3,94%   plazo vencido hace 2,3 h, stop efectivo −6,54%
```

Con el acantilado viejo, FET se liquidaba **en pérdida** al vencer el plazo esta
mañana. La rampa lo dejó respirar y se dio vuelta: +0,21 USDT sobre 3,33. Chico
en plata, pero es el primer caso real y confirma el diagnóstico de ayer.

### Trailing a FET: por qué 15% y no 10%

Jorge pidió replicar en FET lo de PUMP. El porcentaje **no** se copió, y menos
mal:

```
FET · pico +15,53% · ahora +3,94%   → YA se devolvió 10,2% desde el máximo
  trail  8% → nivel +6,29%   cortaría AHORA MISMO
  trail 10% → nivel +3,98%   cortaría AHORA MISMO
  trail 15% → nivel −1,80%   aprieta y no corta
  trail 25% → nivel −13,35%  no muerde (manda la rampa)
```

Aplicar el 10% que el backtest de ayer coronó como mejor **habría liquidado FET
en el acto**, porque el retroceso ya ocurrió. Un trailing es una regla hacia
adelante; ponerlo sobre un máximo pasado es cerrar la posición con otro nombre.

15% también es el proporcional: Jorge eligió 25% para PUMP, que es 2,7× su
volatilidad diaria (9,3%). FET tiene 6,5% → 17,5% equivalente, y 15% queda cerca
mordiendo desde hoy.

```
FET   +3,94%  stop efectivo  −1,80%  trail 15% desde 0,1845  ACTIVO
PUMP +11,99%  stop efectivo −12,22%  trail 25% desde 0,005447 ACTIVO
```

**Lección:** un porcentaje bueno en promedio puede ser destructivo en un caso concreto; antes de aplicar una regla de salida hay que preguntarle qué haría HOY con la posición que ya existe.

## 2026-08-23 (noche) — Primera revisión de plazo con la rampa en vivo, y Jorge la deja trabajar

SUI y ORDI vencieron su plazo de 10 h a las 22:55, justo cuando Jorge pidió
revisarlas a las 23:00. Ninguna rindió:

```
SUI    entrada 0,8248 → 0,8233   −0,18%
ORDI   entrada 4,175  → 4,049    −3,02%
```

La rampa ya estaba apretando sola al minuto 27 de vencido el plazo (4% de
avance): stop de SUI en −6,57% (era −7%), de ORDI en −7,51% (era −8%). Faltan
9,6 h para llegar al 100% y liberarse solas si siguen planas.

Se le presentaron tres opciones, no dos — "liquidar o continuar" tal como lo
pidió Jorge, más la que la rampa ya estaba haciendo: dejarla trabajar. **Jorge
eligió esa tercera.** Es la primera vez que alguien usa la rampa como
mecanismo de decisión en vez de decidir a mano en el momento del vencimiento —
exactamente para lo que se construyó ayer.

**Lección:** cuando el usuario pide "decidir en el momento X", primero preguntar si ya existe un mecanismo automático corriendo esa decisión — forzarla a mano puede tirar por la ventana algo que ya se construyó para eso.

## 2026-08-24 — La arquitectura de la migración, decidida antes de clonar

Jorge preguntó cómo iban a reflejarse en el iMac los movimientos hechos con
Claude, dashboard y Telegram, sin abrir el Mac — y separó eso de "actualizar el
repo con git" para cambios de código. La pregunta destapó algo que había que
decidir antes de clonar, no después.

**El motor no es un sistema distribuido.** Dashboard, Telegram y las jugadas que
ejecuta Claude son tres puertas al mismo proceso y al mismo `data/`, no tres
sistemas sincronizados. Git sincroniza SOLO código — `data/` está excluido a
propósito. Eso significa que no pueden correr dos instancias vivas a la vez: si
el Mac sigue con su servidor después de migrar, se crean dos billeteras
ficticias divergiendo en paralelo, exactamente lo que el sello de versión y las
escrituras atómicas existen para evitar.

**Decisión:** Claude sigue operando desde el Mac — no hace falta correr Claude
Code en el iMac. El iMac es el único motor vivo: ahí corre el servidor, ahí
vive `data/`, ahí escucha Telegram, y el dashboard se ve desde la red de casa.
Cuando Claude ejecute una jugada, apunta a la dirección del iMac en la LAN en
vez de `127.0.0.1`. Sin acceso remoto fuera de casa, por simplicidad.

**Verificado antes de escribir el plan:** el bot de Telegram está activo ahora
mismo en el Mac. Si el iMac arranca el suyo con el mismo token sin apagar antes
el del Mac, los dos compiten por los mismos mensajes de forma impredecible —
quedó como paso obligatorio de la migración, no opcional.

Actualizado el checklist del backlog con la arquitectura completa: qué apunta a
dónde, y el paso de apagar el servidor del Mac antes de prender el del iMac.

**Lección:** antes de "prender un segundo lugar" para cualquier sistema con estado propio, preguntar explícitamente cuál de los dos manda — la pregunta de Jorge lo forzó a decidirse hoy en vez de descubrirlo con dos billeteras divergentes mañana.

## 2026-08-24 (cont.) — La rampa cobra su primer caso real, y el screening se queda corto dos días seguidos

### El plazo progresivo funcionó exactamente como se diseñó

SUI y ORDI, comprados ayer con revisión a las 23:00, vencieron su plazo de 10 h
durante la noche. La rampa los liberó sola, sin que nadie decidiera en el
momento:

```
SUI    entrada 0,8248 → salida 0,8068   -2,18%   liberado 08:25
ORDI   entrada 4,175  → salida 4,053    -2,92%   liberado 07:39
```

Sin drama, sin salto brusco de −7% a la banda de ruido: el stop subió gradual
mientras nadie miraba y cortó cuando correspondía. Es la primera confirmación
real del mecanismo construido el 23-ago — hasta ahora solo se había probado con
mutación y con FET, que no llegó a vencer del todo.

### El screening automático se quedó corto dos días seguidos

```
23-ago: 0 oportunidades del top-30 · ampliando a 90 pares (vol>3M): 10 candidatos sanos
24-ago: 0 oportunidades del top-30 · misma ampliación: 15 candidatos, 6 pasaron todo
```

Los dos días con el mismo patrón: rally amplio, BTC +20%+ en 7 días, y **todo**
el top-30 por volumen sobrecomprado a la vez (RSI>80). Los candidatos sanos —
RSI bajo 70, volatilidad dimensionable, momentum real — vivían más abajo en
volumen, fuera de lo que el screener automático mira. Registrado como hipótesis
abierta (`universo-30-no-alcanza`); con n=2 y ambos días en el mismo régimen, no
alcanza para tocar el código todavía.

### GIGGLE: la capa de patrón hizo su trabajo, no la de score

GIGGLE pasó la compuerta (score 69, R:B 3,0) pero **sin patrón reconocible**
—ni pullback, ni ruptura, ni momentum— y quedó afuera. Es el diseño de las
cuatro capas funcionando como se pensó: "sin patrón reconocible no hay entrada,
por bueno que sea el score."

### Corrección propia antes de ejecutar: "importante" no es lo mismo que "buen score"

Jorge pidió invertir en "las más importantes" de seis candidatos válidos. La
primera lectura fue por score (ICP el más alto). Verificar el volumen real
mostró que ICP, con 6M, es tan delgado como los descartados — el criterio
correcto para "importantes" era liquidez: SUI (86M) y WLD (29M) eran los dos
verdaderos "majors" del lote. Se corrigió antes de ejecutar, no después.

### El límite del todo-o-nada, evitado por poco

3 compras de 5 USDT (15) contra 14,82 USDT libres en el sleeve — 18 centavos de
sobra. Como una jugada con varias compras es atómica (si una rebota en la
compuerta, se cae la jugada completa, ni las que sí pasaban se ejecutan),
intentar las tres habría comprado CERO. Se verificó la capacidad en vivo antes
de mandar la orden y se redujo a dos.

### SUI, liberado y recomprado el mismo día, más barato

```
08:25  liberado por plazo    0,8068
15:54  re-entrada            0,8029   (2,6% más barato)
```

Registrado como hipótesis abierta con n=1 (`plazo-libera-en-descuento`): un
activo liberado por plazo vencido puede ser una entrada más barata poco
después, si la tesis seguía sana. Insuficiente para actuar, suficiente para
vigilar si se repite.

**Lección:** un mecanismo nuevo no está probado hasta que actúa solo, sin que nadie lo mire en el momento — la mutación y el backtest dicen que DEBERÍA funcionar; el primer caso real dice si funciona.

**Lección 2:** "importante" es ambiguo entre score y liquidez, y son criterios que pueden apuntar a activos distintos; verificar cuál pidió el usuario antes de ejecutar, no asumir el más fácil de calcular.

## 2026-08-28 — El log persistente dejó de escribir 5 días, y nadie lo notó hasta ahora

Al retomar el proyecto tras varios días, `/api/estado` decía "al día" — el motor
vigilaba con normalidad. Pero `data/servidor.log` tenía como última línea el
**23-ago 07:47**, cinco días atrás.

**La causa:** el proceso corriendo (PID 84000) se había arrancado con
`node src/server.mjs` directo, no con `run-server.sh`. El motor funcionaba
perfecto —vigilaba, cerraba posiciones, escribía `data/`— pero su salida de
consola nunca pasaba por el `tee` que arma el log persistente. Exactamente el
problema que ese mecanismo se construyó para resolver el 23-ago, reapareciendo
por la puerta de al lado: **el arreglo protege un solo camino de arranque, y
había otro**.

Se cortó el proceso viejo y se reinició por `run-server.sh` (vía el
`launch.json` que ya apunta ahí). El log vuelve a escribir desde las 18:57.

**Efecto real, no solo el síntoma:** durante esos 5 días el sistema decidió sin
dejar rastro diagnosticable — los `[AUTO-STOP]`, `[ALERTA]` y `[OPORTUNIDAD]` de
esos días no están en ningún lado. `data/movimientos.jsonl` y
`data/alertas.jsonl` sí quedaron completos (son el registro que de verdad
importa), así que no se perdió el dato financiero — se perdió el diagnóstico
de POR QUÉ decidió cada cosa en el momento.

### Lo que pasó en esos 5 días, reconstruido desde los datos que sí persistieron

```
FET    +2,19%   trailing protegió la ganancia
DASH   +1,97%   plazo vencido, sin rentar lo suficiente
WLD    -1,85%   plazo vencido
SUI    -5,48%   estructura rota → CUARENTENA
XPL    -8,00%   estructura rota → CUARENTENA
```

**ADA y ENA se armaron 6 veces entre watchlist y screening automático — las 6
expiraron sin aprobar.** Nadie estuvo presente en la ventana de 15 minutos
durante 4 días. El bot de Telegram tiene el token configurado, así que las
alertas debieron llegar al teléfono; que no se hayan tomado es de este lado,
no una falla del sistema — es exactamente lo que "vence en 15 min" está
diseñado para hacer cuando nadie responde: no ejecutar nada.

### El rendimiento se diluyó, no se rompió

```
24-ago:  17 jugadas · 9 cerradas · acierto 67% (6/9)  · alfa +2,52 USDT
28-ago:  17 jugadas · 16 cerradas · acierto 50% (8/16) · alfa +1,32 USDT
```

Con n=16 sigue bajo el umbral de 20 para ser señal. La caída de acierto y alfa
es del período, no una alarma — coincide con el giro de régimen de rally amplio
a caída amplia.

**Lección:** un arreglo que depende de CÓMO se arranca el proceso no está completo si existe otra forma de arrancarlo — verificar que el mecanismo de logging sea inevitable (por ejemplo, dentro del propio server.mjs) en vez de depender de que siempre se invoque por el script correcto.

## 2026-09-01 — Auditoría de engine.mjs: seis mecanismos con hueco (v3g, sello `m-cc3e9dcf`)

Se auditó el archivo completo (3.156 líneas) contra los datos reales. Un bug
que crasheaba y cinco controles con hueco — tres de ellos del tipo que ya
conocemos: seguían diciendo OK sin controlar nada.

1. **`aplicarPlan` crasheaba con la billetera migrada.** Filtraba las salidas
   con `wallet.holdings[...]`, clave que la billetera migrada no tiene — y las
   salidas viejas (ACE y SOL, cerradas el 19-ago) seguían vivas en el last-run
   porque nadie más las podaba. El TypeError saltaba DESPUÉS de escribir la
   billetera y los movimientos: estado a medio actualizar, el mismo patrón que
   jugadaManual ya había corregido. Ahora filtra contra todos los bolsillos.
2. **Carrera en la watchlist.** `evaluarWatchlist` leía el archivo, esperaba a
   la red por cada entrada (segundos) y escribía lo leído — fuera del candado.
   Una entrada agregada desde el dashboard en esa ventana desaparecía en
   silencio. Ahora son dos fases: toda la red primero, y la lectura+escritura
   después, síncrona — sin await en el medio nada puede intercalarse.
3. **El corte de la rampa se disfrazaba de stop.** Con trailing y plazo vencido
   a la vez, la señal salía `cruzo-limite` aunque el nivel que cortó fuera la
   rampa del plazo: cierre por tiempo clasificado como stop → cuarentena
   injusta. La señal ahora la pone el nivel que de verdad manda.
4. **El tope de riesgo abierto (5%) no veía el propio lote.** Las compras
   anteriores de una misma jugada aún no están en posiciones.json, así que se
   sumaban en cero. La compuerta recibe ahora `riesgoExtraUSDT` acumulado.
5. **La venta parcial cerraba la posición entera** en el registro: la mitad no
   vendida quedaba en el sleeve sin stop ni vigilancia. Ahora reduce la
   posición (`reducirPosicion`); solo la venta completa cierra.
6. **El clamp silencioso neutralizaba un bloqueo.** `min(pedido, reserva)`
   compraba menos de lo pedido sin avisar, y con el monto ya recortado el
   bloqueo "reserva insuficiente" de la compuerta no podía dispararse nunca.
   La compuerta juzga ahora el monto pedido; si no alcanza, la jugada rebota
   entera con el motivo a la vista.

Los seis con test verificado por mutación: 6/6 en rojo contra el motor
anterior, 61/61 en verde con los arreglos.

**Lección:** los tres controles muertos (2, 4 y 6) tenían la misma anatomía —
el dato que el control necesitaba llegaba recortado, tarde o de otro archivo, y
el control aprobaba con la mano vacía. Auditar un control no es leer su `if`:
es perseguir de dónde viene cada operando hasta el disco o la red.

## 2026-09-01 (cont.) — Bloque A: el replay de salidas, y el sello que no vigilaba la salida (v3h, `m-bd93867e`)

Primer bloque del plan de evolución del motor. El objetivo no era hacerlo "más
neuronal" sino contestar con números dónde está la fuga — y resultó estar donde
nadie estaba mirando.

### El diagnóstico que ordenó todo

16 cierres, 72,73 USDT desplegados, +3,32 de resultado. Descompuesto por salida:
las 5 jugadas que llegaron a objetivo aportaron +5,34 (+21,5%); las otras 11
restaron. Y el seguimiento post-cierre midió que **salir temprano costó +3,48
USDT — más que todo lo que el motor ganó**. Las comisiones, en cambio, suman
0,19: no son el problema.

Conclusión que reorienta el trabajo: la entrada no es el cuello de botella
(acierto 50%, alfa +1,5% sobre BTC). **La salida sí.**

### Paso 1 · El score se guardaba como frase, no como dato

`score-de-confianza` pedía correlacionar score con resultado a partir de n≥20.
Era **inejecutable por construcción**: el score solo existía embebido en el
texto de la tesis ("score 74"), nunca como campo. Aunque llegaran 200 jugadas,
la comprobación no habría podido correr. Es el mismo defecto que la auditoría
encontró en tres controles: falta el operando, no la lógica.

Arreglado: `contextoEntrada` ahora mide también fase y salto de volumen (de las
MISMAS velas, sin llamadas nuevas — y verificado que da idéntico a
`saltoVolumen()`), y `registrarDecision` guarda `score`, `desglose` y `senal`.
Con `scoreOrigen` distinguiendo el score que **de verdad gateó** la entrada del
reconstruido después: mezclarlos arruinaría el análisis que justifica el campo.

### Paso 2 · El replay no reimplementa las reglas

`replay-salidas.mjs` toma cada posición real y replaya políticas alternativas
sobre las velas posteriores. Para no repetir la duplicación de siempre —dos
copias de las reglas que deben coincidir sin que nada lo obligue— se extrajo
`evaluarNiveles` como función pura y **el replay llama a la misma función que
corre en producción**. El tiempo entra como parámetro; ese era el único lazo
con el reloj.

Validación honesta: replayar la política actual da +2,45 contra +3,32 real. La
diferencia (−0,87) es el efecto NETO de haber ejecutado tarde — perjudicó los
stops (ACE salió a −16% con stop en −12%) pero benefició a los ganadores, que
se pasaron de largo su objetivo (HEMI cerró en +46% con objetivo en +30%). El
saldo confirma la tesis: **el techo del objetivo cuesta más que el
deslizamiento de los stops.**

### Paso 3 · Las cinco políticas, medidas

Resultado REALIZADO (excluyendo posiciones que no cerraron dentro del horizonte,
porque valorizarlas a una fecha arbitraria premia a la política más paciente):

| política | realizado | vs actual |
|---|---|---|
| Trailing 10% desde +10% | +3,16 | +40% |
| Trailing 20% desde +10% | +3,10 | +37% (deja 4 abiertas) |
| Objetivo +25% | +2,84 | +26% |
| Actual sin plazo | +2,54 | +12% |
| Actual | +2,26 | — |

**Las cinco alternativas le ganan a la política vigente.** Esa dirección es
robusta aunque los montos no lo sean con n=16.

Trampa evitada: por TOTAL, el trailing 20% marcaba +8,25 y parecía triplicar a
todo. El 62% de esa ventaja eran 4 posiciones sin cerrar, valorizadas 30 días
después. El script elegía "la mejor" por ese número — se corrigió para que
ordene por realizado. Un backtest que premia a la política que deja todo
abierto mide paciencia, no rendimiento.

Matiz que el detalle revela: el trailing 10% gana sobre todo **cortando
perdedoras antes** (ACE +0,59, APT, FET, FIL), y PIERDE en las dos ganadoras
grandes (TRUMP −1,18, HEMI −0,70). Es decir: funciona como mejor stop, no como
mejor dejador-correr. No es la mecánica que se buscaba arreglar, así que la
elección de política no queda cerrada por estos números.

### El hueco que apareció de paso

Verificando el sello después del refactor: **la lógica de salida no entraba en
él por ningún lado**. Las huellas eran plan, sizing y compuerta. Cambiar el
objetivo o el trailing —la mayor palanca que acabábamos de medir— habría dejado
el sello quieto y las jugadas nuevas atribuidas al motor viejo. Se agregó
`salida: huellaDeFuncion(evaluarNiveles)` y se verificó contra su modo de
fallar: tocando un umbral de salida, el sello se mueve (`m-bd93867e` →
`m-beb4631d`).

**Lección:** el sello se diseñó para que ninguna regla cambie en silencio, pero
solo vigilaba las funciones que existían el día que se escribió. Un mecanismo
de vigilancia también tiene cobertura, y la suya no se revisa sola. La pregunta
correcta no es "¿el sello funciona?" sino "¿qué NO está mirando?".

Nota de higiene: la prueba de mutación del sello dejó registrado `m-beb4631d`
en `versiones.json` — un sello que nunca operó. Lo detectó el test de sellos no
declarados y se eliminó a mano. Experimentar contra el estado real deja rastro.

### Paso 3 (ampliado) · El replay sobre 221 ventanas históricas

Con n=16 no se podía elegir política, solo saber que había que cambiarla. Se
agregó el modo `--historico`: genera entradas sintéticas sobre ~166 días y 40
activos aplicando **los criterios reales del screener** (importa
`detectarSenales`, `scoreSetup`, `CRITERIOS`, `planDeEntrada` de los módulos que
operan — copiarlos habría medido salidas sobre las entradas de otro sistema).
De 4.700 días-activo evaluados pasaron 221: el resto lo frenaron el régimen
vetado (2.525), la falta de patrón reconocible (1.733) y el score (202).

Resultado NETO de comisiones, por operación:

| política | medio | mediana | acierto | horas | %/100h | sin top 5% |
|---|---|---|---|---|---|---|
| Actual | **−0,205%** | −1,26% | 42% | 38 | −0,534 | −1,123% |
| Objetivo +25% | +0,326% | −1,26% | 41% | 47 | +0,697 | −0,843% |
| Trailing 10% desde +10% | +0,482% | −1,20% | 41% | 50 | **+0,965** | −0,967% |
| Trailing 20% desde +10% | +0,272% | −1,26% | 41% | 61 | +0,448 | −1,463% |
| Actual sin plazo | +0,521% | −4,19% | 35% | 104 | +0,502 | −0,781% |
| Trailing 10% sin plazo | **+0,968%** | −4,19% | 35% | 116 | +0,836 | **−0,720%** |

**Hallazgo principal: la política de salida vigente pierde plata.** −0,205% por
operación neto de comisiones, sobre 221 ventanas. No es que rinda poco: la
comisión de ida y vuelta se come lo que la regla deja sobre la mesa. Las cinco
alternativas son positivas.

Dos correcciones que cambiaron la conclusión mientras se medía:

1. **Los porcentajes estaban brutos.** Con la media de la política actual pegada
   a cero, los 0,2% del ida y vuelta eran la diferencia entre "no gana nada" y
   "pierde". Se pasó todo a neto (`pnlPctNeto`).
2. **El cociente contra la actual daba múltiplos absurdos** (−139x) por dividir
   por una media casi cero. Se eliminó: solo se muestran puntos porcentuales.

### Lo que la prueba de robustez obliga a admitir

**Quitando el 5% mejor, TODAS las políticas quedan negativas.** El borde entero
—de las seis— vive en ~11 operaciones de 221. Eso no invalida el resultado: es
el perfil normal de seguir tendencias, donde se pierde poco muchas veces y se
gana mucho pocas. Pero sí obliga a leer la tabla distinto: **lo informativo es
el ORDEN, no las magnitudes**, y con este n las medias son frágiles.

El orden sí es estable. `Trailing 10% sin plazo` es la mejor con la media
completa Y con la podada; `Trailing 20%` se revela como artefacto de un solo
acierto (+133% su mejor operación, y la PEOR de todas al podar).

### La métrica que reconcilia los dos conjuntos de datos

Sobre las 16 posiciones reales ganó `Trailing 10% desde +10%`; sobre las 221
ventanas gana `Trailing 10% sin plazo`. No se contradicen: miden cosas
distintas. Por hora de capital comprometido, la de plazo rinde +0,965 %/100h
contra +0,836 de la otra — retiene menos tiempo la plata.

Cuál manda depende de cuál es el recurso escaso:
  · Si sobran oportunidades y falta capital → gana la de plazo (más rotación).
  · Si sobra capital y faltan entradas → gana la sin plazo (más por operación).

**Hoy el sleeve va al 21% de su presupuesto: sobran 18,21 USDT sin desplegar.**
El recurso escaso son las entradas, no la plata. Con eso, `Trailing 10% sin
plazo` es la candidata — pero paga con una mediana de −4,19% y 35% de acierto:
más rachas perdedoras seguidas, y capital retenido 5 días por jugada.

**Lección:** medir en bruto lo que se cobra en neto invierte conclusiones cuando
el efecto es del tamaño de la comisión. Y una media positiva sin la prueba del
recorte no distingue una política de un golpe de suerte con formato de tabla.

**Decisión pendiente (Bloque B):** adoptar `Trailing 10% sin plazo` exige que el
motor sepa activar el trailing recién a partir de cierta renta —hoy `trailPct`
rige desde la apertura— y que el plazo pase a ser opcional. Ninguna de las dos
cosas está implementada: esto midió, no cambió nada.

## 2026-09-01 (cont.) — v4a adoptada: trailing 10% armado en +10%, sin plazo (`m-a90cf77b`)

Jorge eligió la política que midió mejor. Bloque B del plan de evolución.

### Qué cambió

La política de salida vigente pasa a ser: **trailing del 10% que se ARMA recién
a partir de +10% de renta, sin plazo, y con el objetivo degradado a
referencia**. Medida sobre 221 ventanas: +0,968% por operación neto de
comisiones, contra −0,205% de la anterior. Es la mejor tanto con media completa
como con media podada del 5% mejor.

Lo que se paga por eso, y está medido: mediana −4,19% contra −1,26%, acierto 35%
contra 42%, capital retenido 116 h contra 38. Se gana menos veces y se pierde
más grande; el borde está en la cola.

### Tres decisiones de diseño que no eran obvias

**1. La activación del trailing es una regla, no un detalle.** Un trailing del
10% puesto al abrir pone el stop en −10% desde el primer minuto: eso no es
proteger ganancia, es un stop más estrecho — otra política, con otro resultado.
El umbral (`activarTrailEnPct`) vive en `evaluarNiveles` y no en
`refrescarPicos` porque el pico es un HECHO del mercado; lo que la activación
decide es si ese hecho manda.

**2. El objetivo no se borró: se degradó.** Sigue calculándose y guardándose
porque es el numerador del R:B, que es un criterio de ENTRADA — la compuerta
rechaza con R:B bajo 1,5. Borrarlo habría desarmado ese filtro sin que nada lo
dijera. Ahora se mide si hay recorrido hasta la resistencia, y después se deja
correr sin cobrar ahí.

**3. La política se GRABA EN LA POSICIÓN, no se lee de una global.** Si se
leyera global, adoptar v4a le habría cambiado las reglas a PUMP a mitad de
vuelo: se abrió con objetivo +33% y trailing 25% desde la apertura, y esa es la
apuesta que se hizo. Cambiarle el trato después corrompe justo lo que el sello
existe para poder auditar. Las posiciones sin `politicaSalida` conservan el
comportamiento anterior, y no se migran a propósito.

### Dos paneles que habrían mentido

Al terminar el motor quedaban dos superficies anunciando cosas que ya no iban a
pasar:

· El dashboard mostraba `objetivo X (+20%) · falta Y%` para posiciones que
  nunca venderían ahí, y el stop original en vez del nivel que de verdad va a
  ejecutar. Ahora muestra el límite EFECTIVO (el trailing cuando manda) y
  etiqueta el techo como `referencia, no vende`.
· `evaluarNiveles` marcaba `cerca-objetivo` a una posición en +50% con techo en
  +10%. Se suprime bajo política de trailing: el estado que importa ahí es si
  el trailing armó, y ese ya viaja en `trailActivo`.

**Lección:** cambiar una regla de decisión no termina en el motor. Cada lugar
que muestra o explica esa regla es un control que empieza a mentir en el mismo
commit, y ninguno falla ruidosamente — siguen mostrando un número con toda
confianza. Buscar las superficies es parte del cambio, no una tarea aparte.

### El backtest también tenía que moverse

`replay-salidas.mjs` construía sus entradas históricas con el plazo fijo a 24 h.
Con la política nueva habría seguido comparando contra un "actual" que dejó de
existir — el instrumento de medición desincronizado del sistema medido. Ahora
las entradas nacen de `POLITICA_SALIDA`, la misma constante que usa el motor, y
la política anterior quedó como variante nombrada (`pre-v4a`) para poder
comprobar más adelante si el cambio valió la pena.

También se explicitaron TODOS los campos de cada variante: heredar con
`{...p, objetivoPct: 25}` habría arrastrado `politicaSalida: 'trailing'` y la
variante "Objetivo +25%" no habría cortado nunca en su objetivo. Una prueba que
dice una cosa y mide otra.

### Verificación

66 tests, tres mutaciones probadas: quitar la activación del trailing (2 rojos),
hacer que el objetivo corte siempre (2 rojos), y dejar que la política global
pise a las posiciones viejas (1 rojo). Sello nuevo `m-a90cf77b`, movido solo.

Higiene: `m-10968d66` se registró entre dos ediciones y nunca operó — eliminado
de `versiones.json`, como el `m-beb4631d` de la sesión anterior. Calcular el
sello sobre el estado real deja rastro aunque el código no llegue a correr.

### Lo que queda por ver

Ninguna posición vive todavía bajo v4a: PUMP es anterior. La primera entrada
nueva estrena la política, y hay dos cosas que mirar con datos y no con
expectativa: si el capital se queda retenido más de lo tolerable sin plazo que
lo libere, y si las rachas perdedoras (35% de acierto) se sostienen sin que la
regla se abandone por incomodidad. La segunda es el riesgo real de esta
política, y no es técnico.

## 2026-09-01 (cont.) — Bloque C: el contrafactual, y el paso que resultó no hacer falta (v4b, `m-9ca711c2`)

### Por qué el bloque quedó en un solo paso

El plan tenía cuatro. Al llegar cambiaron de valor:

· **Paso 7 (seguir a los rechazados) — hecho.** Captura datos que de otro modo
  **se pierden para siempre**: nadie puede reconstruir después qué candidatos
  evaluó el screener un martes ni por qué los descartó.
· **Paso 6 (publicar el vector de estado) — descartado, no pospuesto.** Su dato
  SÍ es reconstruible: PnL, horas, progreso, caída desde el pico, volatilidad,
  fase y régimen salen todos de las velas, que es exactamente lo que hace
  `replay-salidas.mjs`. Guardarlo en vivo sería una segunda copia de algo que
  ya se puede derivar — y este proyecto ya sabe cómo terminan las segundas
  copias. **El criterio no es "¿sirve el dato?" sino "¿se pierde si no lo
  guardo ahora?".**
· **Pasos 8 y 9 (política adaptativa) — bloqueados por falta de datos.** v4a se
  adoptó hoy y ninguna posición corrió aún bajo ella. Construir una política
  condicional encima de una fija que no produjo un solo dato es adivinar con
  más maquinaria.

### El contrafactual

El screener evalúa ~12 candidatos por corrida y compra 0 o 1. Los otros
desaparecían, así que el sistema solo podía aprender de sus 16 jugadas — con el
RSI aplastado entre 58 y 69 **porque su propia compuerta no deja pasar otra
cosa**. Un termómetro que solo mide entre 36 y 37 grados.

Ahora cada candidato juzgado queda registrado en `data/candidatos.jsonl` con su
contexto y —lo que importa— **el filtro que lo rechazó como etiqueta**, no solo
como frase. El texto sirve para leerlo; la etiqueta sirve para agrupar cientos
de casos y contestar la pregunta que hoy es incontestable: *cada filtro, ¿nos
ahorra plata o nos la cuesta?* `seguimientoCandidatos()` mide desde velas qué
hizo el precio a 24 y 48 h, con la misma maquinaria del seguimiento
post-cierre, y agrega por filtro.

**El veto de régimen era el caso más ciego.** Salía sin mirar un solo
candidato: hoy 1-sep vetó los 12 y no habría quedado rastro de qué se dejó
pasar. Ahora se registran desde el radar YA calculado — cero llamadas extra
para medir lo que igual íbamos a descartar.

Una observación por activo y por día: los criterios se calculan sobre velas
diarias, así que registrar cada 3 minutos guardaría 480 copias del mismo juicio.
El tope vive en memoria y la lectura deduplica por (activo, fecha), para que un
reinicio no ensucie la serie.

### El mismo hueco del sello, en otro sitio

Revisando el sello después del cambio: **`CRITERIOS` no estaba adentro**. El
veto de régimen, el techo de RSI 80, el máximo de salto de volumen — las reglas
que hoy rechazaron los 12 candidatos— podían cambiar sin mover la versión.
Es el mismo hallazgo que el de la política de salida, encontrado el mismo día en
otro módulo. Agregado a `parametrosDeSenales` y verificado contra su modo de
fallar: tocando `regimenesVetados`, el sello se mueve (`m-9ca711c2` →
`m-4d4f1b26`).

**Lección:** el sello se revisó una vez y pareció completo. No lo estaba, y no
lo estuvo dos veces seguidas. Un mecanismo de vigilancia no se audita
preguntando "¿funciona?" sino enumerando qué decisiones existen y cuáles de
ellas mira — y esa lista crece cada vez que se agrega una regla.

### Verificación

67 tests. El del contrafactual verificado por mutación: quitando el tope diario
falla, y quitando la deduplicación al leer también. Los 12 candidatos del día
quedaron registrados por el monitor; `/api/candidatos` responde con 0 medidos
porque la ventana de 24 h todavía no pasó — a partir de mañana empieza a
acumular sin arriesgar un peso.

## 2026-09-01 (cont.) — La reconstrucción no seguía al trailing (v4c, `m-8d51a8b5`)

Tres pendientes que quedaron abiertos al cerrar el bloque C, y uno de ellos le
quitaba valor a la política recién adoptada.

### 1 · La reconstrucción buscaba el stop original

`reconstruirCruce` existe porque el monitor muere con el equipo dormido (79-91%
del tiempo ciego en los días medidos): al despertar reconstruye desde velas de
1 minuto cuándo se cruzó el nivel y ejecuta ahí, como habría hecho una OCO.

Pero buscaba **siempre el stop original**. Con v4a el trailing es la salida
principal, así que el caso más común dejó de reconstruirse: una posición con
pico en +30% y trailing en +17% que de madrugada cae a +5% cruza su trailing,
pero acá se buscaba el cruce de −8%, nunca se encontraba, y se vendía al precio
del despertar. **Doce puntos porcentuales — justo la ventaja que la política
venía a capturar.**

La dificultad real: el nivel del trailing **no es fijo, sube con el pico**. Hay
que recorrer las velas llevando el máximo y recalcular el nivel en cada minuto.
Dos decisiones finas:

· **El pico se DERIVA de las velas, no se siembra con `picoDesdeApertura`.** Ése
  es el máximo de toda la vida de la posición; si se formó DESPUÉS del inicio de
  la ventana, sembrar con él pondría el nivel demasiado arriba desde el primer
  minuto y detectaría un cruce que en ese momento no existía — inventando una
  venta a un precio que el mercado nunca disparó.
· Para posiciones más viejas que la ventana de 24 h se pide el pico previo
  (`picoAntesDe`), una llamada acotada y solo cuando hace falta.

El test necesitó un mock propio: el Binance falso genera series PLANAS, y con
ellas el pico nunca se forma. Un trailing solo se puede probar con un camino que
suba primero. Verificado por mutación en sus dos sentidos — volver al nivel fijo
falla, y armar el trailing ignorando su umbral también.

### 2 · Telegram seguía mostrando lo que el dashboard ya no

`/posiciones` mostraba `Límite (limitePct)` —el stop original, no el efectivo— y
`Objetivo` como si fuera a vender ahí. Ahora muestra el nivel que de verdad
ejecuta, etiqueta el techo como referencia bajo política de trailing, y avisa a
qué renta se arma el trailing cuando todavía no armó.

**Lo incómodo:** ayer escribí la lección de que cada superficie que muestra una
regla empieza a mentir en el mismo commit, y la apliqué en UNA de las dos
superficies. Escribir la lección no es aplicarla; hay que enumerar las
superficies, no recordarlas.

### 3 · Las hipótesis quedaron desalineadas por nuestro propio trabajo

Cuatro cambiaron de estado sin que nadie las tocara:

| hipótesis | antes | ahora |
|---|---|---|
| `objetivo-corta-temprano` | abierta | **confirmada** y actuada (v4a) |
| `umbral-plazo-por-volatilidad` | abierta | **obsoleta**: el plazo salió de la política |
| `plazo-libera-en-descuento` | abierta | **obsoleta**, con la contraevidencia de SUI del 28-ago por fin registrada |
| `score-de-confianza` | abierta (inevaluable) | abierta y **por fin evaluable** |

La de `score-de-confianza` ganó además una vía nueva: contrastar el score de los
candidatos RECHAZADOS contra su resultado a 24/48 h es lo único que rompe el
aplastamiento del rango de RSI (58-69) que produce la propia compuerta.

### El mismo hueco del sello, POR TERCERA VEZ

`reconstruirCruce` decide **a qué precio** se ejecuta una salida. Es una regla
de dinero —vale 12 pp en el caso medido— y no estaba sellada. Van tres en un
día: la política de salida, los criterios del screener, y ahora ésta.

**Lección reforzada:** el sello cubre lo que alguien se acordó de agregar, y
"acordarse" no es un mecanismo. La cobertura hay que derivarla de una
enumeración de las decisiones del motor, no de la memoria de quien la revisa.
Tres hallazgos seguidos en el mismo día no son mala suerte: son la prueba de que
el método de auditarlo estaba mal.

## 2026-09-01 (cont.) — El sello tenía un punto ciego estructural (v4d, `m-3944ea1d`)

Al construir el test que Jorge pidió —uno que enumere las funciones de dinero y
falle si alguna no está sellada— apareció algo peor que los tres huecos del día.

### El punto ciego

La huella es `String(fn)`: **el cuerpo de ESA función y nada más**. Sellar
`evaluarNiveles` no sella `umbralPlazoPct`, que ella llama.

Demostrado antes de arreglarlo: cambiando `BANDA_RUIDO_VOL` por 0,9 dentro del
helper —una regla que mueve el nivel de salida de toda posición con plazo— el
sello **no se movió**. Los tres hallazgos anteriores (política de salida,
criterios del screener, reconstrucción) eran olvidos de enumeración. Éste no:
el mecanismo solo veía el primer nivel de la llamada.

Ahora el sello cubre la cadena causal completa: **34 funciones en vez de 5**.
Los helpers que calculan niveles, los que alimentan la compuerta, los que
valorizan la cartera, los que producen operaciones y los que vetan. Además
entró `CANDIDATOS` (el tamaño del universo del screener), que tampoco estaba.

**Se prefiere pasarse.** Incluir de más hace que un refactor sin cambio de
conducta mueva el sello: molesto. Incluir de menos deja una regla cambiando en
silencio: el error exacto que el mecanismo existe para no cometer.

### El test invierte el modo de fallar

Antes, una función nueva que decidiera algo quedaba fuera del sello **en
silencio**. Ahora tiene que estar clasificada: o decide —y va sellada— o alguien
declara por qué no, con motivo. Una función sin clasificar **rompe la suite**.

La clasificación se escribe a mano (no hay forma de deducir "esto decide dinero"
del código), pero **su completitud no depende de nadie**: se contrasta contra las
funciones que de verdad existen en el archivo. Las 113 del motor quedaron
repartidas entre las 34 selladas y siete categorías con su razón: io, red,
validación, estado, consulta, orquestación, formato.

Verificado por mutación en los dos sentidos: agregando una función nueva sin
clasificar la suite falla nombrándola y diciendo qué hacer; sacando
`umbralPlazoPct` del sello fallan tres tests.

Un tropiezo propio en el camino: la primera versión comprobaba la cobertura con
`JSON.stringify(logica).includes(huella)` y fallaba en una sola función. No era
el motor — era que las comillas del código van escapadas en el JSON. Comparar la
propiedad directamente es exacto; buscar substrings dentro de un serializado es
comparar dos cosas distintas y creer que son la misma.

**Lección:** un mecanismo de vigilancia tiene dos formas de fallar, y sólo
pensamos en una. Que se olvide de mirar algo (cobertura) se arregla enumerando.
Que **no pueda** ver algo por cómo está construido (alcance) no se arregla
mirando más fuerte: hay que cambiar el mecanismo. Tres auditorías a ojo
encontraron lo primero y ninguna encontró lo segundo — lo encontró el intento de
automatizarlo. **Escribir el test fue más informativo que las tres revisiones
manuales juntas.**

## 2026-09-01 (cont.) — El mismo arreglo, en el módulo que faltaba (v4e, `m-c9006559`)

v4d selló la cadena causal de `engine.mjs` y escribió el test que la exige.
Media hora después, revisando qué faltaba: **`aprendizaje.mjs` seguía igual de
ciego**. Cambiar los umbrales de `regimenMercado` —los que ESE MISMO DÍA vetaron
los 12 candidatos del screening— no movía el sello.

Es el tercer caso del mismo patrón en dos días:
- La lección "cada superficie que muestra una regla empieza a mentir" se aplicó
  al dashboard y no a Telegram.
- La lección "el sello no ve los helpers" se aplicó a `engine.mjs` y no a
  `aprendizaje.mjs`.

**Aplicar una lección en el sitio donde se descubrió no es aplicarla.** Hay que
enumerar dónde más vive el mismo patrón, en el mismo momento, o queda a medias
con la sensación de estar completo — que es peor que no haber empezado.

Ahora el sello cubre también `regimenMercado`, `contextoEntrada`, `saltoVolumen`,
`saltoVolumenDe`, `detectarSenales`, `scoreSetup`, `buscarOportunidades` y
`avisadosRecientes`. Y el test enumera los DOS módulos: 143 funciones que tienen
que estar clasificadas.

### El test encontró tres funciones que yo no sabía que existían

`calidad`, `jugadasConContexto` y `segmentar` — helpers del informe de patrones.
Ninguna decide, así que quedaron exentas con su motivo. Pero el punto no es el
veredicto: es que **una revisión a ojo nunca las habría listado**, y ahora
cualquier función futura aparece sola. El test hizo su trabajo en su primera
corrida contra código que nadie había mirado con esa pregunta.

## 2026-09-01 (cont.) — Bloque D: el consejero que aconseja y no autoriza

13 de 16 cierres seguían sin veredicto. No por falta de criterio: escribirlos a
mano es tedioso y siempre hay algo más urgente. Eso mantenía muerto el bucle de
aprendizaje — el motor registraba el contexto de cada entrada y nadie cerraba
el ciclo diciendo qué se aprendió.

`src/consejero.mjs` hace tres cosas, todas sobre hechos YA OCURRIDOS:
veredictos de jugadas cerradas, contradicciones entre hipótesis, y el argumento
en contra de una oferta antes de aprobarla.

### La frontera, que es lo único que importa acá

**El consejero no entra al camino del dinero.** La compuerta sigue siendo
JavaScript determinista. La razón no es prudencia genérica: un modelo de
lenguaje falla EXACTAMENTE como fallaron los tres controles podridos que
auditamos esta semana — **sigue diciendo OK, con mejor prosa**. Es la peor
clase posible de control, porque su modo de fallar es el más convincente.

Tres propiedades lo sostienen, y las tres tienen test:
1. **No escribe.** Devuelve borradores; el veredicto lo registra Jorge por el
   endpoint de siempre. Verificado comparando el registro antes y después.
2. **Lista cerrada.** Si el modelo inventa una categoría de veredicto, el
   borrador queda marcado inválido con el texto crudo a la vista. Las cuatro
   categorías se corrigen de formas opuestas; aceptar una quinta sería aceptar
   cualquier cosa.
3. **Inerte sin key.** Sin `ANTHROPIC_API_KEY` los endpoints responden 503
   explicando qué falta y el resto del sistema no se entera.

**Tampoco predice precios.** Ya está medido dos veces que no hay señal de
dirección: pedirle un pronóstico sería fabricar un número con cara de dato,
que es justo lo que el radar 24 h se negó a mostrar.

### Lo que sí aporta

La distinción cara del sistema es entre *tesis correcta* y *tesis correcta mal
ejecutada*: se corrigen al revés, y confundirlas lleva a cambiar el criterio de
entrada cuando el problema estaba en la salida. Esa distinción se resuelve
mirando **qué hizo el precio DESPUÉS de vender**, que es dato que el motor ya
tenía y nadie estaba leyendo. La evidencia que se le pasa lo incluye siempre —
hay un test que falla si se quita, porque sin eso la pregunta se haría a ciegas.

### El texto que lee es dato, no instrucción

Las tesis y los motivos los escribe Jorge, pero un nombre de activo o una nota
podrían contener cualquier cosa. La respuesta se valida contra la lista cerrada
y nada de lo que diga se ejecuta. Es la misma postura que con cualquier fuente
externa.

### Nota de método

Las dos primeras pruebas fallaron por depender del estado que dejaban otras
—varias vacían `posiciones.json`— así que se les dio datos propios y
deterministas. Un test que lee lo que otro dejó no prueba lo que dice probar:
prueba el orden en que corrieron.

`consejero.mjs` entró además a la enumeración del sello. No sella nada (no
decide), pero sus funciones quedan declaradas: si mañana alguien le agrega
lógica que decida, el test lo obliga a clasificarla en vez de dejarla pasar.

**Pendiente para Jorge:** pegar su `ANTHROPIC_API_KEY` en el `.env` (la saca de
console.anthropic.com). Hasta entonces todo esto está construido y probado pero
inerte.

## 2026-09-01 (cont.) — El panel se quedaba en blanco y no lo decía

Jorge mandó una captura: la tarjeta «Billetera ficticia» vacía, con su
cabecera y nada debajo.

### El diagnóstico

En el navegador que yo tenía abierto todo estaba bien —las 19 tarjetas con
contenido, el DOM completo— así que no era un error de render. La causa
estaba en `cargarEstado()`:

```js
try {
  const st = await (await fetch('/api/state')).json();
  if (st.lastRun) renderAll(...);
} catch { /* primer uso sin datos */ }
```

Ese `catch` vacío tragaba **dos causas muy distintas**: que todavía no haya
análisis guardado, y que el servidor no haya contestado. Hoy reinicié el motor
ocho veces; con el panel de Jorge abierto, un refresco cayó justo en una de
esas ventanas, el fetch falló, y el panel se quedó vacío **y mudo para
siempre** — hasta recargar a mano.

**El comentario era la trampa.** «primer uso sin datos» nombra una sola causa
posible para un catch que atrapa varias: no es documentación, es una conclusión
sin comprobar escrita en el único lugar donde nadie la va a cuestionar. Es la
misma familia que los controles auditados esta semana, pero al revés: en vez de
un control que dice OK sin mirar, un error que se presenta como estado normal.

### El arreglo

Se distinguen las dos causas, se avisa, y se reintenta con espera creciente
(2, 4, 8, 15 s) porque un reinicio del servidor dura segundos y el panel tiene
que volver solo. Tras varios intentos el mensaje cambia de «reintentando» a
«¿está corriendo? arráncalo con run-server.sh», que es lo accionable.

Verificado en vivo, no por inspección: simulando el fetch caído aparece el
aviso con su cuenta atrás; devolviendo el fetch, el panel se recupera solo y el
aviso desaparece sin recargar.

**Deuda declarada:** `app.js` no tiene pruebas automáticas. Montarlas exigiría
un DOM de mentira, y este proyecto es de cero dependencias a propósito. Se
verificó a mano y se dice acá en vez de dejarlo parecer cubierto.

## 2026-09-01 (cont.) — La caché sin validar, y un diagnóstico que mintió

Jorge volvió a ver la tarjeta «Billetera ficticia» vacía, esta vez con una
captura que mostraba lo decisivo: **las demás tarjetas SÍ tenían datos** — la
billetera real con sus filas, el capital en riesgo, las 3 ofertas esperando.

### Lo que NO era

Se descartó por medición, no por intuición:
· No era el render: en mi navegador la tarjeta pintaba entera (91,28 USDT,
  bolsillos, 6 filas de activos) a 534, 1024 y 1440 px de ancho.
· No era el dato: `renderWallets` con el payload real de ese momento no lanza.
· No era un error de JS: consola limpia.

### El diagnóstico que mintió por el camino

Buscando, `curl -I` devolvió **404** en la raíz y en `app.js`, y por un momento
pareció que el servidor no servía nada. No era cierto: `-I` manda un HEAD, y el
handler estático solo atendía GET, así que caía al 404 de JSON. **Un
diagnóstico que reporta un fallo inexistente cuesta más tiempo que el bug que
se busca** — la misma lección que el script de mercado que gritaba "0 señales"
por no pasarle un campo. Ahora HEAD se atiende.

### El defecto real

El servidor no mandaba **ninguna** cabecera de caché: ni `Cache-Control`, ni
`ETag`, ni `Last-Modified`. Sin ellas el navegador aplica caché heurística —
reusa la respuesta un rato **sin preguntar**. En un proyecto donde `app.js`
cambia varias veces al día, eso deja el dashboard corriendo código viejo contra
datos nuevos, y el síntoma no se parece en nada a la causa: "se perdió con los
últimos cambios".

Ahora se manda `Cache-Control: no-cache` + `ETag` + `Last-Modified`. `no-cache`
no significa "no guardes" sino "guarda, pero pregunta antes de usarlo": con el
ETag la respuesta habitual es un **304 sin cuerpo**, así que revalidar sale
gratis y nunca se sirve una versión vieja. Verificado: 200 con ETag, 304 con 0
bytes al repetir, y ETag distinto en cuanto el archivo cambia.

**Alcance, y su cierre.** Al publicar el arreglo no se podía reproducir la
tarjeta vacía, así que la caché quedó anotada como la explicación más probable
pero NO confirmada, con un criterio de refutación escrito por adelantado: si
volvía a pasar con el arreglo puesto, la hipótesis caía.

**Confirmada el mismo día:** con una recarga forzada la tarjeta volvió y no
reapareció. La causa era la caché sin validar.

Vale más el método que el resultado: la hipótesis se publicó con su condición
de refutación ANTES de saber si era cierta. Sin eso, cualquier arreglo que
coincida con la desaparición del síntoma se lleva el crédito, y se archiva como
causa algo que fue una casualidad.

**Lección:** cuando el síntoma aparece en una máquina y no en otra con el mismo
código y los mismos datos, lo que difiere no es el programa: es lo que cada
navegador tenía guardado. Buscarlo en el render fue mirar donde había luz.

## 2026-09-03 — Primera entrada bajo v4a, y el bucle que se moría con el primer rechazo

### El régimen se dio vuelta

Tras tres días vetado (`caída amplia` 0%, luego `débil` 20%), amaneció en
**rally amplio con amplitud 100%**: las cinco referencias suben, BTC +1,95% en
24 h. Primera vez que el veto se levanta desde que se instrumentó.

### PROM: la primera posición con la política nueva

Score 82/100 —el más alto registrado— con el mejor perfil que hemos visto:
RSI 57,3 diario y 43,7 horario (ni cara ni comprando el pico intradía), +137%
en 30 días pero −6,3% en la semana, y **42,6% de recorrido hasta su techo de
30 días**. El stop estructural apretó el −15% de volatilidad a −10% apoyándose
en el piso del retroceso; R:B 3,0, el doble del mínimo.

`pos-0018` abrió con `politicaSalida: trailing`, trailing 10% que se arma en
+10%, sin plazo, y el +30% degradado a referencia. Es la primera jugada que
estrena v4a — hasta ahora todas las abiertas eran anteriores.

Aviso que viajó con ella, y hay que mirarlo cuando cierre: volatilidad 14,2%
diaria, así que el mínimo de orden de 5 USDT deja el riesgo en 0,50 contra el
objetivo de 0,35 (1,43x, justo bajo el tope de 1,5x que bloquearía).

### El bug: un rechazo legítimo mataba a los siguientes

Revisando por qué solo había UNA oferta con cinco candidatos aprobados
(PROM 82, PUMP 74, TRUMP 72, ENA 68, LINK 66), el log lo dijo:

```
[09:57:41] [OPORTUNIDAD] PROM ...
[09:57:46] [OPORTUNIDAD] PUMP ...
[09:57:48] oportunidades: riesgo: arriesga 0.65 USDT, 1.9x el objetivo ...
```

El `try` envolvía el **bucle entero**. PROM creó su oferta, PUMP rebotó en la
compuerta —correctamente— y esa excepción abortó el bucle: **TRUMP, ENA y LINK
nunca se evaluaron**. Ya había pasado el 2-sep a las 16:59 (TRUMP bloqueó) y a
las 20:03 (HEMI). Tres ocurrencias en dos días, invisibles porque el síntoma es
una ausencia: no aparece un error, aparecen *menos ofertas*.

Es exactamente la lección que ya rige el barrido de candidatos —"un símbolo
caído nunca debe tumbar el análisis completo"— sin aplicar en este bucle. Otra
vez: la lección estaba escrita, y aplicada en un solo sitio.

Ahora cada candidato tiene su propio `try`. Y se distingue el bloqueo del
fallo: un 423 de la compuerta es **el control haciendo su trabajo**, así que se
registra y se sigue; avisar por macOS cada vez que el riesgo rechaza algo
entrena a ignorar los avisos, y entonces el que importa tampoco se lee.

**Verificación, honestamente:** el arreglo es estructural y se comprobó
leyéndolo; el filtro anti-repetición de 12 h impide reproducir el ciclo en vivo
ahora mismo. La firma observable llega en el próximo ciclo con varios
candidatos: los rechazados deben salir como `[OPORTUNIDAD] X descartada — …` en
vez de matar el bucle. Queda anotado para mirarlo, no dado por hecho.

**Deuda:** `server.mjs` arranca el listener al importarse, así que su lógica no
es testeable desde `test.mjs`. Este bug habría sido un test de tres líneas si el
bucle viviera en una función pura. Se declara en vez de dejarlo parecer cubierto.
