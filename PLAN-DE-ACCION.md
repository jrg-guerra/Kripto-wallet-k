# Plan de Acción — Kripto Wallet

**Objetivo:** incrementar la billetera ficticia día a día operando con datos
reales (comprar, vender, convertir criptos simuladamente), ajustar el modelo de
incremento con lo aprendido, y llegar con evidencia — no con fe — al punto de
tomar acciones reales de menos a más.

**Cómo se usa:** cada día, Jorge lo solicita en una sesión ("hagamos el día",
"análisis diario", o similar) y se ejecuta el ritual completo de abajo.
Una vez por día; si se pide de nuevo el mismo día, solo se refresca y analiza
(el rebalanceo diario ya quedó aplicado).

---

## Reglas de la casa (base del juego — no se negocian a mitad de partida)

1. **Capital cerrado.** El capital de inversión es la wallet actual (~80 USD
   al 2026-08-18) y NADA más. Con eso nos damos vuelta, para bien o para mal.
   No se agrega dinero nuevo — ni para "promediar a la baja", ni para
   "recuperar", ni porque "ahora sí viene la buena". Si la wallet crece, se
   juega con más; si cae, se juega con menos. Esta regla es la que garantiza
   que el peor escenario posible ya está acotado de antemano.

2. **Cadencia de juego: libre — se puede operar muchas veces al día**
   (regla actualizada por Jorge el 2026-08-18; reemplaza el límite anterior
   de 1 operación/día).
   - Analizar/mirar: sin límite, cuando se quiera.
   - Operar la ficticia: las veces que Jorge decida. Las jugadas chicas
     (5-10 USDT) tienen comisiones despreciables en absoluto (~0,01 USDT por
     ida y vuelta), así que operar seguido con montos acotados es viable.
   - **Salvaguarda de fricción (aviso, no bloqueo):** si las comisiones
     acumuladas del día superan el 0,5% del capital (~0,40 USDT), se advierte
     en el reporte de la jugada — porque la rotación del portafolio COMPLETO
     varias veces al día sí es un agujero (~0,2% por rotación total).
   - El rebalanceo automático del modelo v1 (botón dorado) mantiene su ritmo
     de 1 vez/día; las jugadas adicionales son manuales, elegidas por Jorge.

3. **Toda posición nace con salida programada.** Objetivo y límite se
   dimensionan a la volatilidad del activo (`stopsSugeridos()`: límite ≈ 1,5×
   la volatilidad diaria, piso −4%, techo −15%; objetivo 2,5× el riesgo).
   Nunca stops fijos: un −8% en una moneda que se mueve 17% diario salta por
   ruido — lección GPS, 2026-08-18.
   El sistema **ejecuta el corte solo en la ficticia** al cruzar el nivel, y
   avisa por notificación de macOS. En real, las órdenes las ejecuta Jorge.

4. **El motor propone, Jorge dispone.** El análisis nunca aplica nada por sí
   solo; aplicar la propuesta es un acto explícito con confirmación. El ancla
   es intocable por diseño, no por advertencia.

5. **USDT es la cripto de reserva** (fijada por Jorge el 2026-08-18).
   Todo corte, toma de ganancia o refugio se convierte a USDT — porque USDT
   es la vía de salida a dólares y de retiro. El cash en USDT no es "plata
   ociosa": es pólvora seca para la siguiente oportunidad o el peldaño hacia
   un retiro real.

---

## El ritual diario (≈5 minutos)

### 1 · Actualizar y mirar el mercado
- Refrescar precios y billeteras (`POST /api/refresh`).
- **Leer el "Registro del sistema"** antes de decidir nada: qué ejecutó el
  motor solo desde la última sesión (auto-stops, tomas de objetivo, alertas de
  cruce). Si la reserva cambió sin que tú operaras, ahí está el porqué.
- Leer el contexto: criptos principales 7 días (BTC/ETH/BNB/SOL/XRP), movers
  de 24 h y el radar de momentum.
- **Salida:** 2-3 frases honestas de cómo se mueve el mercado hoy y dónde están
  las mejores oportunidades (y si NO hay oportunidades, decirlo — "hoy no hay
  momentum decente" es un análisis válido).

### 2 · Operar la billetera ficticia
- Ejecutar el análisis (`POST /api/run`): la estrategia vigente **propone**
  qué comprar y vender dentro del sleeve. **No aplica nada por sí solo.**
- Leer la propuesta con sus **avisos de impacto** (si cierra una posición con
  stop vigente, si recompra algo en cuarentena, si el sleeve quedó sobre su
  techo, si una compra queda bajo el mínimo real de Binance).
- Aplicarla es un acto explícito (`POST /api/aplicar-plan` o el botón), con
  confirmación. Si los avisos la desaconsejan, **no aplicarla es una decisión
  válida y se registra igual**.
- Las jugadas propias van por `POST /api/jugada`: operan solo el sleeve, abren
  posición con stops por volatilidad y quedan en el historial.

### 3 · Medir
Registrar en la bitácora (`BITACORA.md`) la línea del día:
- Valor ficticia / valor real (hold) / BTC como benchmark.
- Rendimiento acumulado de la estrategia vs hold desde el inicio.
- Operaciones del día y picks vigentes.
- Observación del día (1 línea: qué se aprendió o qué llamó la atención).

### 4 · Ajustar (solo cuando toca — ver reglas)
El modelo NO se toca a diario. Los ajustes siguen las reglas de evolución de
abajo. Si hoy no toca ajuste, este paso se salta.

### 5 · Backtest (al cierre de cada ciclo, o cuando surja una idea)
Con el backtester propio **`src/backtest.mjs`** (`node src/backtest.mjs --dias 90`).
El skill `backtesting-trading-strategies` quedó descartado para esto: usa
yfinance/coingecko y no puede traer los pares de Binance donde operamos.
- Toda variante candidata del modelo se corre primero contra datos históricos
  de Binance (90 días mínimo) antes de ganarse un ciclo real de 7 días.
- Se comparan contra el modelo vigente con las mismas métricas del plan:
  retorno vs hold, Sharpe/Sortino, drawdown máximo y costo en comisiones.
- **Regla de promoción:** solo pasa a ciclo real la variante que le gane al
  modelo vigente en el backtest. Las ideas malas mueren en minutos, no en
  semanas — y sin costarnos rendimiento simulado.

---

## Reglas de evolución del modelo

El modelo actual es **v1**: top 3 momentum 7 días, pesos iguales, pares USDT
de mayor volumen (sin stables ni tokenizados), refugio en USDT sin momentum
positivo.

1. **Ciclos de 7 días.** El modelo vigente corre 7 días sin tocarse. Al cierre
   de cada ciclo se evalúa: ¿le ganó al hold? ¿le ganó a BTC? ¿cuánto costó en
   comisiones? ¿cuál fue la peor caída (drawdown)?
2. **Un cambio a la vez.** Si el ciclo sugiere un ajuste, se cambia UN solo
   parámetro (número de picks, ventana de momentum, filtro de volumen, umbral
   de refugio…) y se corre otro ciclo completo. Nunca dos cambios juntos — si
   no, no se sabe qué funcionó.
   **Antes de tocar nada: backtest obligatorio** (paso 5 del ritual). Ningún
   cambio entra a ciclo real sin haberle ganado al modelo vigente contra
   datos históricos.
3. **Todo cambio se registra** en la tabla de versiones de abajo, con su
   motivo y su resultado al cierre del ciclo siguiente.
4. **Retroceso sin drama.** Si una versión nueva rinde peor que la anterior,
   se vuelve a la anterior. El modelo evoluciona por evidencia, no por apego.

### Historial de versiones del modelo

La columna **Sello** es el identificador que el motor calcula solo
(`versionMotor()`) y que queda estampado en cada jugada. Las versiones
anteriores al 2026-08-23 no lo tienen: el mecanismo no existía, y por eso esta
tabla pudo quedarse en v2a mientras el motor cambiaba cinco veces debajo.

| Versión | Desde | Cambio | Motivo | Resultado del ciclo | Sello |
|---------|-------|--------|--------|---------------------|-------|
| v1 | 2026-08-18 | (base) top 3 momentum 7d, pesos iguales, rebalanceo diario | punto de partida | superado por v2d | — |
| v2a | *descartada* | filtro: no entrar con RSI14 > 75 | backtest 90d: +17,9% vs −11,8% de v1 | reemplazado por el score de confianza, que gradúa en vez de vetar | — |
| v2b | *probada* | ventana de momentum 30d en vez de 7d | 7d compra pumps recientes, 30d compra tendencias | backtest 90d +34,6% vs v1 −29,5%; absorbida en v2d | — |
| v2c | *probada* | rebalanceo semanal en vez de diario | v1 quemaba 26,1% del capital en comisiones a 180d | comisiones a 5,5%; absorbida en v2d | — |
| v2d | 2026-08-19 | 30d + semanal (v2b + v2c juntas) | las dos mejoras se sostienen combinadas | **aplicada** — es la etiqueta que llevan los movimientos del plan | — |
| v2e | *descartada* | bajar a 2 picks | concentrar en las mejores señales | backtest −36,3% y Sharpe −0,44: peor que v2d. `PICKS` sigue en 3 | — |
| v3a | 2026-08-22 | stops por volatilidad, objetivo estructural, señales, score, compuerta, plazo | las siete piezas del póster (láminas 2-7) | en curso | *(pre-sello)* |
| v3b | 2026-08-23 | sello de versión derivado de los parámetros | el registro de 14 días no era atribuible a ningún motor | en curso | `m-6c20b7f6` |
| v3c | 2026-08-23 | el check de volatilidad bloquea en vez de avisar | PUMP quedó con 2x el riesgo objetivo pasando con un aviso | en curso | `m-636488c5` |
| v3d | 2026-08-23 | stop estructural, invalidación a cuarentena, plazo en rampa; el sello pasa a incluir la huella del código | el stop no tenía ancla estructural y el plazo cortaba ganadores | en curso | `m-046223f1` |
| v3e | 2026-08-23 | R:B mínimo también en las ofertas manuales | LINK se creó con R:B 1,17 sin pasar por el filtro | en curso | `m-f9fa0d1f` |
| v4a | 2026-09-01 | **política de salida: trailing 10% armado en +10%, sin plazo ni objetivo que corte** | medido sobre 221 ventanas: la política anterior perdía −0,205%/operación neta de comisiones; ésta rinde +0,968%, la mejor con media completa Y con media podada del 5% mejor | cerrado 2026-09-01 | `m-a90cf77b` |
| v4b | 2026-09-01 | bloque C: se registran los candidatos RECHAZADOS con su filtro y se mide qué hicieron después; los criterios del screener entran al sello | el sistema solo aprendía de las 16 jugadas que hizo, con el RSI aplastado entre 58 y 69 por su propia compuerta; y el veto de régimen podía cambiar sin mover la versión | cerrado 2026-09-01 | `m-9ca711c2` |
| v4c | 2026-09-01 | la reconstrucción de cierres sigue al TRAILING (nivel móvil, no fijo); Telegram muestra el nivel efectivo; `reconstruirCruce` entra al sello | con v4a el trailing es la salida principal, y la reconstrucción buscaba el stop original: un trailing cruzado de madrugada vendía al precio del despertar — 12 pp en el caso medido | cerrado 2026-09-01 | `m-8d51a8b5` |
| v4d | 2026-09-01 | el sello cubre la CADENA CAUSAL completa (34 funciones, no 5) y un test exige que toda función del motor esté clasificada | la huella es del cuerpo de una función, no de las que llama: cambiar `BANDA_RUIDO_VOL` dentro de `umbralPlazoPct` no movía el hash aunque `evaluarNiveles` estuviera sellada | cerrado 2026-09-01 | `m-3944ea1d` |
| v4e | 2026-09-01 | el sello y su test cubren TAMBIÉN `aprendizaje.mjs` | v4d selló la cadena del motor y dejó el otro módulo igual de ciego: los umbrales de `regimenMercado` —que ese día vetaron los 12 candidatos— cambiaban sin mover el sello | **vigente** | `m-c9006559` |
| v3f | 2026-08-23 | compuerta en la jugada manual + el monitor escribe la serie | `/api/jugada` se saltaba los cinco controles; el freno de caída medía contra un pico observado | cerrado 2026-09-01 | `m-6abe7991` |
| v3g | 2026-09-01 | auditoría de engine.mjs: seis arreglos de mecanismo (aplicarPlan ya no crashea con la wallet migrada; watchlist en dos fases sin carrera; el corte por rampa con trailing ya no se etiqueta stop; el tope de riesgo abierto ve el propio lote; la venta parcial reduce en vez de cerrar; la compuerta juzga el monto pedido sin clamp) | tres controles decían OK sin controlar y un TypeError dejaba el estado a medio escribir | cerrado 2026-09-01 | `m-cc3e9dcf` |
| v3h | 2026-09-01 | bloque A del plan de evolución: el score se guarda como campo, la lógica de salida se extrae como función pura (`evaluarNiveles`) y ENTRA AL SELLO, y nace `replay-salidas.mjs` | la hipótesis del score era inejecutable porque el dato nunca se guardó, y la política de salida —la mayor palanca medida— no estaba sellada por ningún lado | cerrado 2026-09-01 | `m-bd93867e` |

**Cómo se corre el backtest** (`src/backtest.mjs`, sobre klines reales de
Binance porque el skill instalado usa yfinance y no alcanza nuestro universo):

```bash
node src/backtest.mjs --dias 90
```

Leer siempre como comparación ENTRE variantes, nunca como rendimiento
esperado: el universo son los pares de mayor volumen de HOY, así que arrastra
sesgo de supervivencia.

---

## Métricas que mandan (en este orden)

1. **Alfa del sleeve** — cada jugada contra lo que ESA MISMA plata habría
   rendido quieta en BTC el mismo período. Es LA métrica desde que el sleeve
   quedó acotado al 25%: comparar los totales mide a bitcoin, no al modelo
   (una jugada de +20% en el sleeve mueve la wallet apenas +5%).
   Si tras 2 ciclos el alfa no es positivo, el modelo cambia.
2. **Ficticia vs Hold** — el marcador general, útil como contexto pero
   dominado por el ancla.
3. **Costo de fricción** — comisiones acumuladas como % del capital. Si las
   comisiones se comen la ganancia, el modelo rota demasiado.
4. **Drawdown máximo** — la peor caída desde un máximo. Define cuánto dolor
   habría que tolerar con dinero real.

---

## Cierre de la fase ficticia y paso a lo real

**El cierre de la fase ficticia lo declara Jorge, explícitamente.** No hay
fecha automática ni métrica que dispare el paso a lo real por sí sola: las
puertas de abajo son la **evidencia mínima recomendada** para que ese cierre
sea informado, pero la decisión es suya y solo suya. La fase ficticia dura lo
que Jorge diga — el objetivo primero es **generar experiencia**.

Cuando Jorge declare el cierre ("cerramos la fase ficticia", "vamos a real" o
similar), antes de tocar un peso real se produce el **Informe de Cierre**
(análisis profundo de toda la experiencia):

1. Rendimiento total de la ficticia vs hold vs BTC, día a día.
2. Cada operación revisada: cuáles ganaron, cuáles perdieron y por qué.
3. Comisiones totales pagadas y su peso en el resultado.
4. Drawdown máximo vivido — el "dolor" que habría que tolerar en real.
5. Historia de versiones del modelo: qué se probó, qué quedó, qué se descartó.
6. Backtest final del modelo vigente contra ≥90 días de históricos.
7. Lecciones aprendidas y riesgos conocidos.
8. **La propuesta concreta para la parte 2**: con qué modelo, con qué escalera
   de montos y con qué reglas de salida se parte en real.

Solo con ese informe sobre la mesa arranca la parte 2 (acciones reales).

### Evidencia mínima recomendada (las puertas, como referencia)

- **Puerta 1 — Validación:** 14 días con datos y la ficticia por sobre el
  hold después de comisiones.
- **Puerta 2 — Consistencia:** 2 ciclos consecutivos ganándole al hold con el
  mismo modelo, sin cambios.
- **Puerta 3 — Acciones reales de menos a más:** movimientos reales manuales
  con la escalera de montos (≈10% de la wallet por movimiento, sube tras 3
  ganadores netos, baja tras 2 perdedores). Las órdenes las ejecuta Jorge en
  Binance, siempre.

Si Jorge decide cerrar antes de cumplir las puertas, el Informe de Cierre lo
dirá con claridad ("se cierra con X días de evidencia, faltó Y") — la decisión
se respeta, pero el informe no maquilla lo que falta.

**Regla de honestidad:** si la ficticia va perdiendo contra el hold, el
reporte diario lo dice sin suavizarlo. El objetivo del proyecto es aprender
cuál modelo funciona — descubrir que uno NO funciona en simulado es un éxito
del sistema (dinero real que no se perdió), no un fracaso.

---

## Qué NO hace este plan

- No ejecuta órdenes reales ni maneja credenciales — nunca, en ninguna fase.
- No promete rendimientos: el mercado puede caer y la mejor estrategia del
  mundo cae con él. El plan controla el proceso, no el resultado.
- No se opera más de una vez al día ni se persiguen velas: la disciplina del
  ritual ES el modelo.
