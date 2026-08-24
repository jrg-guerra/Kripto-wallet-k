# Kripto Wallet — simulador local de paper trading

Dashboard local que compara tu **billetera real de Binance** (solo lectura)
contra una **billetera ficticia** que ejecuta una estrategia de momentum con
precios reales. **Nunca envía órdenes**: todas las operaciones son simuladas;
las órdenes reales siempre las ejecutas tú en Binance.

## Uso

Doble clic en `start.command`, o en Terminal:

```bash
/Users/kash/Documentos/htdocs/kripto-Wallet/run-server.sh
```

(`run-server.sh` resuelve solo la versión de Node: usa la más nueva instalada
por nvm, con fallback al `node` del PATH. Si el servidor ya está corriendo,
avisa y sale sin error.)

Abre http://localhost:8517. También hay `index.html` en la raíz como acceso
rápido (redirige al dashboard si el servidor está activo).

- **Actualizar mercado** (botón verde): refresca precios y el valor de ambas
  billeteras en segundos. Úsalo las veces que quieras.
- **Ejecutar análisis** (botón dorado): calcula momentum 7d de los 30 pares con
  más volumen y genera una **propuesta**. Nunca aplica nada por sí solo.
- **Aplicar propuesta** (botón dentro de la card): único acto que mueve la
  billetera ficticia, con confirmación previa. La card muestra el resumen
  (cuánto rota, comisiones) y **avisos de impacto**: si liquida una posición
  principal, si cierra una posición con stop vigente, si gasta la reserva en
  USDT o si recompra algo cortado hace menos de 3 días (cuarentena).

Modo consola: `node paper-trader.mjs`

## La interfaz

**Sala de control.** Franja superior con cinco cifras que responden antes de
leer cualquier card: **Marcador** (ficticia menos hold), **Alfa del modelo**
(lo que aporta la estrategia sobre BTC), **Vigilancia** (posiciones abiertas y
cruces), **Riesgo abierto** (cuánto se pierde si todos los stops pegan) y
**Hoy** (el estado accionable: analizar / aprobar / al día).

Los cinco son **botones que despliegan su detalle** a lo ancho de la fila, uno
a la vez:

| Tile | Al desplegarse |
|---|---|
| Marcador | De dónde sale la brecha: jugadas cerradas con su PnL y motivo de cierre |
| Alfa | Jugada por jugada contra BTC (rendimiento propio, benchmark, alfa) |
| Vigilancia | Barra roja→verde por posición: dónde está el precio entre su límite y su objetivo |
| **Riesgo abierto** | Pérdida si todos los stops pegan a la vez, capital expuesto, win rate, expectativa, comisiones pagadas y **brecha de los stops** |
| Hoy | La acción del día, con atajo — ejecuta el análisis o lleva a la card que corresponde |

El panel **persiste entre refrescos** (`ctAbierto`): el dashboard se actualiza
solo, y cerrarle el detalle al usuario cada vez lo haría inusable. Chevron que
rota como señal de despliegue (no solo el borde dorado), `aria-expanded` +
`aria-controls`, y **Escape cierra devolviendo el foco al tile** que lo abrió.

**Bento Grid.** 12 columnas con spans por importancia; el ancho máximo es
2400 px con padding fluido, así que aprovecha desde 4K y 21:9 hasta 1280 px.
Las filas suman 12 exactas:

| Fila | Cards |
|---|---|
| 1 | Billetera real · Billetera ficticia · Posiciones abiertas |
| 2 | Evolución real · Evolución ficticia · Alfa del modelo |
| 3 | Propuesta · Radar de mercado |
| 4 | Mercado real · Evolución comparada |
| 5 | Registro del sistema · Historial de movimientos |
| 6 | Hoja de ruta |
| 7 | Aprendizaje (card final, ancho completo) |

Bajo 768 px pasa a una columna con orden por prioridad de uso, y las cards de
consulta arrancan colapsadas para que el scroll no se dispare.

**Registro del sistema.** Card dedicada a lo que el motor ejecuta **sin
intervención**: auto-stops, tomas de objetivo y alertas detectadas. Tabla
agrupada por fecha local con hora exacta (hh:mm:ss), PnL de cada cierre y
cuánto entró a reserva. Responde "¿qué pasó mientras no estaba mirando?".

**Cards colapsables.** Clic (o Enter) en el título pliega la card; la
preferencia se recuerda por card en `localStorage`. El colapso usa altura
explícita, no el truco `grid-template-rows: 0fr` — ese patrón depende de que
el mínimo `auto` de la pista ceda y no todos los motores lo respetan.

**Billeteras.** La real muestra 7 filas y la ficticia 5 (sus bolsillos ocupan
arriba el alto de ~2 filas): así ambas cards terminan a la misma altura. El
resto de los activos se desplaza dentro de la lista — se muestra el espectro
completo, sin ocultar el polvo.

**Gráficos.** Los de billetera son de **área apilada**: cada cripto es una
banda y la altura total es el valor de la cartera, con curvas suaves y línea
del total. Los de mercado son de líneas (comparan trayectorias). Todos con
tooltip propio; las flechas ▲▼ de cada moneda muestran su variación 24 h y el
porqué (rango del día y volumen).

## Bolsillos de la billetera ficticia

`data/wallet.json` declara para qué sirve cada peso. El motor solo puede operar
uno de los cuatro bolsillos:

| Bolsillo | Quién lo mueve | Regla |
|---|---|---|
| **ancla** | solo Jorge | Convicción de largo plazo (BTC). El motor no la ve. |
| **sleeve** | la estrategia | Bolsillo táctico, techo `limiteSleevePct` (25%) del capital |
| **reserva** | stops, cosecha, Jorge | USDT: vía de retiro y resguardo |
| **polvo** | nadie | Residuos bajo 0,50 USDT |

El rebalanceo reparte el **presupuesto del sleeve** entre los picks; las ventas
van a reserva y las compras salen de ella. Si el sleeve supera su techo (porque
sus posiciones ganaron), el excedente se cosecha a reserva — así las ganancias
se convierten en plata retirable en vez de aumentar el riesgo.

## Cómo se mide el modelo (alfa del sleeve)

Como la estrategia opera solo el sleeve (25%), comparar la wallet total contra
el hold mide a BTC, no al modelo. La métrica correcta es el **alfa**:
`rendimientoSleeve()` compara cada jugada contra lo que ese mismo capital
habría rendido quieto en BTC durante el mismo período. Alfa positivo = el
modelo aporta valor; negativo = habría sido mejor no operar.

## Vigilancia de posiciones (auto-stop)

Cada posición con salida programada vive en `data/posiciones.json` y se vigila
en tres capas:

1. **En pantalla**: card "Posiciones abiertas" con entrada, precio actual, PnL
   y una barra que ubica el precio entre su límite y su objetivo.
2. **En vivo**: reevaluación tick a tick por WebSocket + banner de alerta
   cuando una posición cruza un nivel.
3. **De fondo**: el servidor chequea cada 3 minutos aunque el dashboard esté
   cerrado, notifica en macOS y registra en `data/alertas.jsonl`.

**Corte automático (solo billetera ficticia):** al cruzar el límite o alcanzar
el objetivo, la posición se vende **a USDT (reserva)** de inmediato, se cierra
y queda registrada en el historial de movimientos. El dinero real nunca se
opera: esas órdenes las ejecuta Jorge en Binance.

**Stops por volatilidad y estructura:** `stopsSugeridos(asset)` parte de la
volatilidad (≈1,5× la diaria, piso −4%, techo −15%). Un stop fijo del −8% en una
moneda que se mueve 17% diario salta por ruido — la lección de GPS.

Encima de eso, el **piso del retroceso en curso** (el mínimo desde que se marcó
el techo de 30 días) puede *apretar* el stop, nunca ensancharlo: si el soporte
está a −3%, no tiene sentido dejar correr la pérdida hasta −6%, tres puntos más
allá de donde la tesis ya murió. Al revés no aplica — un soporte lejano no
autoriza a arriesgar más.

No es el mínimo de 30 días. Medido contra los 12 activos del radar, el mínimo
del mes queda entre 23% y 184% abajo: como ancla no aprieta nunca, es inerte.

**Invalidación.** El piso mismo se guarda en la posición como `invalidacionPct`.
No es una salida más —el stop vive justo debajo y corta él primero— sino la
**lectura** del cierre: si el precio de salida quedó bajo el piso, la estructura
se rompió, el setup no era válido y el activo va a cuarentena. Incluso cuando
salió por plazo, que antes quedaba fuera del veto y podía reproponerse al día
siguiente.

## Reglas del modelo

- La ficticia nace como **copia exacta** de la real (mismos activos y montos).
  El primer día quedan idénticas; la estrategia opera desde el día siguiente.
- Estrategia: top 3 momentum 7 días (pares USDT de mayor volumen), pesos
  iguales, comisión 0,1% por operación, refugio en USDT si nada tiene
  momentum positivo.
- La frontera del "día" (para el rebalanceo diario y las fechas del historial)
  es la **hora local** (America/Santiago), no UTC.
- Universo de la estrategia = solo criptos: se excluyen stablecoins y los
  **valores tokenizados de bolsa** de Binance ADGM (lista `TOKENIZADOS` +
  detección automática: si el volumen de fin de semana de un activo es <10%
  del de un día hábil, se descarta por "horario bursátil").
- Valorización: stables de USD valen 1:1; las de EUR se valorizan por su par
  de mercado (EURUSDT…), nunca 1:1.
- Un símbolo con error de API se **omite** del análisis (no lo tumba).
- Cada análisis/refresco guarda un snapshot con desglose por cripto
  (`data/snapshots.jsonl`) — alimenta los gráficos de evolución.
- El encabezado muestra la frescura de cada capa: hora del snapshot de
  cantidades, hora de los últimos precios ("datos de las HH:MM") y hora del
  plan vigente ("precios de las HH:MM"). Si el snapshot tiene 3+ días,
  aparece una advertencia dorada.

## API local (127.0.0.1:8517)

| Método | Ruta                  | Qué hace                                        |
|--------|-----------------------|-------------------------------------------------|
| GET    | `/api/state`          | Último análisis + historial + snapshots         |
| POST   | `/api/run`            | Análisis: genera propuesta (NO aplica nada)     |
| POST   | `/api/aplicar-plan`   | Aplica la propuesta vigente a la ficticia       |
| POST   | `/api/jugada`         | Jugada manual en el sleeve (vender/comprar)     |
| GET    | `/api/alertas`        | Evalúa posiciones y devuelve cruces nuevos      |
| POST   | `/api/refresh`        | Refresco liviano de precios y billeteras        |
| GET    | `/api/market-history` | BTC/ETH/BNB/SOL/XRP, 7 días, velas 4h (caché 5m)|
| GET    | `/api/estado`         | Salud del motor: si vigiló, hace cuánto y con qué versión |
| GET    | `/api/radar24`        | Top por volumen: movimiento de 24 h y recorrido esperado (caché 5 min) |
| POST   | `/api/posicion/trailing` | Trailing sobre posiciones abiertas: `{ids, pct}` · `pct: null` lo quita |

**Dos comandos, dos tareas distintas:**

```bash
node src/test.mjs       # lógica: determinista, sin red, <1 s
node src/mercado.mjs    # mide el motor contra el mercado real y reporta
```

Estaban mezclados y ninguno quedaba bien: cuatro tests salían a Binance y
fallaban con la red caída —incluido el de la compuerta— mientras que las
mediciones contra el mercado se hacían a mano y se perdían.

`state`, `run` y `aplicar-plan` devuelven además el arreglo `alertas` (antes
solo lo hacía `state`), que es lo que alimenta el Registro del sistema: sin eso
la card se quedaba sin eventos tras operar, hasta el siguiente `state`.

**Rendimiento:** los refrescos, la vigilancia y las jugadas usan
`marketSnapshotLigero()`, que pide solo los símbolos de la cartera (~6 KB) en
vez de los 3.684 pares de Binance (~1,9 MB) — 321× menos. El barrido completo
queda solo para el análisis, que necesita el universo para rankear.

## Conectar tu cuenta de Binance (solo lectura)

**Conectada desde el 2026-08-19.** El encabezado muestra "Binance conectado vía
API (solo lectura)" y la billetera real se lee sola en cada refresco/análisis
(`real.fuente: "api"`), sin snapshots manuales.

1. Binance → Perfil → API Management → Create API.
2. Tipo **"Generada por el sistema"** (HMAC) — es la que firma `signedGet()`.
   La opción Ed25519/RSA no es compatible con este motor.
3. Habilita **únicamente "Enable Reading"** (sin trading, sin retiros, sin
   futuros ni préstamos). Sin permisos extra, no hace falta restringir por IP.
4. Copia `.env.example` como `.env` y pega **tú mismo** la key y el secret.

> Las credenciales las pega siempre el dueño de la cuenta. El asistente nunca
> escribe ni lee sus valores: solo verifica `conectadoBinance` y `real.fuente`.

Sin API key, la billetera real se valoriza desde `data/real-wallet.json`
(snapshot de cantidades leído desde la web de Binance) con precios en vivo.
El campo `actualizado` guarda fecha y hora de la lectura
(`"2026-08-18T16:44"`); el dashboard advierte cuando tiene 3 días o más.

**Los precios son los mismos para ambas billeteras.** `simSummary()` y
`realWalletValue()` reciben el mismo objeto `prices` del mismo snapshot: lo
único que las diferencia es la cantidad de cada activo. Eso es lo que hace
comparable el experimento.

## Integridad del estado

El registro es el producto del proyecto: si puede corromperse en silencio, la
validación no vale nada. Cinco garantías en el motor:

- **Sello de versión.** Cada posición y cada movimiento llevan un `m-xxxxxxxx`
  que identifica el motor que los produjo; `data/versiones.json` guarda qué
  parámetros y qué lógica significaba ese sello. Un resultado sin decir con qué
  reglas se obtuvo no es un registro, es una anécdota — y entre el 18 y el 23 de
  agosto el motor cambió cinco veces mientras las jugadas se anotaban todas
  iguales. El sello **no se escribe a mano**: sale de un hash de los parámetros
  vivos más la huella del código de las funciones que deciden, así que cambiar
  una fórmula lo mueve sola y olvidarse no es posible.

- **Nada al disco sin validar.** Una operación no escribe hasta terminar de
  validarse. `jugadaManual` encola cierres y aperturas y los ejecuta tras un
  punto de no retorno explícito: hasta ahí todo es memoria y puede abortar sin
  dejar rastro.
- **Escrituras atómicas.** `escribirEstado()` escribe a `.tmp` y hace
  `renameSync` — atómico en el mismo filesystem, así que el archivo real nunca
  existe a medias. La versión anterior queda en `.bak`. Un `writeFileSync`
  directo trunca el archivo antes de escribir: un Mac que se suspende a mitad
  de operación destruía el estado.
- **Candado compartido.** `conCandado()` vive en el **motor**, no en el server,
  porque el monitor de fondo (cada 3 min) y los endpoints HTTP escriben los
  mismos archivos. Sin él, una jugada y un auto-stop simultáneos se
  sobrescribían el saldo. Una operación en curso responde `409`; el monitor se
  pospone al siguiente ciclo.
- **Validación antes de tocar el estado.** `Number.isFinite` en montos y
  porcentajes: un `NaN` pasa cualquier comparación (`NaN < 0.01` es `false`) y
  dejaba la billetera con `null` sin forma de reconstruirla. Se valida antes de
  pedir precios, así que un dato malo no gasta una llamada a Binance.

- **Una sola declaración de los bolsillos.** `BOLSILLOS = ['ancla', 'legado',
  'sleeve', 'polvo']` es la única lista; valorización, migración, aplanado,
  resumen, clasificación y el front se derivan de ella. Antes estaba escrita a
  mano en **diez lugares** que debían coincidir sin que nada lo obligara — y una
  ya estaba mal (el wallet de respaldo nacía sin `legado`). Un bolsillo olvidado
  por un consumidor hacía desaparecer su plata de la vista sin error alguno:
  medido, 42,50 USDT. Agregar un bolsillo es agregarlo ahí y nada más.
  `reserva` queda fuera a propósito: es un número en USDT, no un mapa
  activo→cantidad.
- **Bolsillo no declarado = se cuenta y se denuncia.** `bolsillosNoDeclarados()`
  detecta una clave de activos que exista en los datos y no esté en la lista. Su
  plata **entra al total** (nunca desaparece) y el dashboard avisa. Es el único
  camino que queda para perder dinero de vista.

**`aplicarPlan` revalida.** Recalcula precios *y* avisos con el estado de ahora;
si apareció un aviso **alto nuevo** desde que revisaste la propuesta, responde
409 en vez de ejecutar algo distinto a lo que aprobaste. Usa las **mismas
ranuras** de presupuesto que viste al aprobar (`previo.ranuras`), no las
recalcula: si no, aprobabas una repartición y se ejecutaba otra.

## Tests

```bash
node src/test.mjs       # lógica: determinista, sin red, <1 s
node src/mercado.mjs    # mide contra el mercado real; sale 1 si hay alarmas
```

**Son dos tareas distintas y por eso son dos comandos.** Estaban mezclados y
ninguno servía: cuatro tests salían a Binance y fallaban con la red caída
—incluido el de la compuerta, el control de seguridad más importante— mientras
las mediciones contra el mercado se hacían a mano y se perdían.

51 tests de la matemática de dinero sobre un **sandbox** (`KW_DATA` apunta a una
copia del estado en `/tmp`): no tocan la billetera real, corren con el servidor
arriba y **no hacen una sola petición a Binance**. Cubren conservación de
capital, ancla y legado intactos, techo del sleeve, rechazo de `NaN`, candado,
respaldo atómico, coherencia del riesgo, congelado, troceo de mensajes, plazos,
reparto del presupuesto, sello de versión, stop estructural y paralelismo.

Lo que necesita red usa el **Binance de mentira** de `test.mjs` (`sinRed()`).
Sus precios por defecto son inertes por construcción: para los símbolos que la
prueba no nombra devuelve el precio de **entrada** de esa posición, así queda en
cero exacto y no cruza ningún nivel. Un valor inventado mandaba APT (entrada
0,63) a +15.000% y liquidaba media cartera del sandbox — el aislamiento se
volvía interferencia.

**Regla de la casa: todo test se verifica por mutación.** Escrito el test, se
inyecta el bug real y se confirma que se pone rojo. Un test que pasa y no puede
fallar no es un test — ya apareció uno así, y medía nada.

`src/mercado.mjs` es lo otro: mide el motor contra el mercado de hoy (señales,
niveles, R:B, estado de la compuerta con la cartera completa) y reporta números
para leer. Existe porque los mocks no alcanzan — TUT clasificando "pullback" a
−80% y la compuerta bloqueando todo con precios parciales solo aparecieron con
datos reales. **Sus números son del día, no del motor:** el stop estructural
apretaba en 2 de 12 activos por la mañana y en 7 por la tarde sin que cambiara
una línea de código.

**Los tests de bolsillos descubren, no enumeran.** La versión anterior construía
una billetera con los bolsillos que conocía y sumaba esos mismos a mano: era
estructuralmente incapaz de detectar un bolsillo nuevo que algún consumidor
olvidara (demostrado: perdía 42,50 USDT y pasaba en verde). Ahora la propiedad
central es *vaciar cualquier bolsillo debe bajar el total exactamente en su
valor* — si alguien lo ignora, vaciarlo no cambia nada y la prueba falla.

Verificado por mutación: inyectando los dos bugs reales (`walletValue` ignora
`legado`; el resumen olvida `polvo`) las pruebas se ponen rojas. Una prueba que
pasa y no puede fallar no sirve.

> Al tocar `walletValue` o `simSummary` —el camino del dinero— la verificación
> es **equivalencia numérica** sobre la billetera real con precios congelados,
> para aislar el código del mercado. Si cambia un centavo, se revierte.

**Prueba de contrato entre módulos.** Los `import` estáticos los valida Node al
cargar; el hueco son los `await import()` **dinámicos**, que fallan solo cuando
la línea se ejecuta — y si vive dentro de un `catch`, en silencio. Así estuvo
`tg.crearOferta` apuntando a una función movida al motor: el monitor la llamaba
cada 3 minutos durante semanas sin crear una sola oferta y sin síntoma visible.
El test escanea los `await import()` y verifica que cada símbolo usado exista
como export. **Quitar los comentarios antes de escanear no es cosmético:** el
propio `server.mjs` cita `tg.crearOferta` en un comentario que documenta el bug.

## Radar 24 horas — y la columna que no existe

Card con las 12 monedas de mayor volumen: cuánto se movieron hoy, cuánto se
mueven típicamente en 24 h, dónde está el precio dentro del rango del día y en
qué banda cae 2 de cada 3 veces.

**No tiene columna de dirección, y eso se decidió midiendo.** Con 1.000 velas
horarias de las 13 monedas de mayor volumen (~2.000 casos por señal):

| Señal | Acierto a 24 h | Retorno medio |
|---|---|---|
| momentum 6 h | 48,3% | +0,375% |
| momentum 24 h | 50,0% | +0,703% |
| reversión 24 h | 49,1% | −0,703% |
| posición en el rango 24 h | 51,5% | +0,588% |
| volumen relativo | 50,5% | −0,126% |
| **comprar cualquier cosa** | **51,1%** | **+0,893%** |

Ninguna le gana al azar. Una flecha de "va a subir" sería un número inventado
con cara de dato — y el riesgo no es que falle, es que se le crea.

**Lo que sí está calibrado es la magnitud.** La desviación de los retornos
horarios × √24 contiene el **68,5%** de los movimientos reales a 24 h, contra
68% teórico (n=2.015). Las colas son más gordas que la normal (89,8% dentro de
±2σ contra 95%), y por eso la banda se declara como "2 de cada 3 veces" y no
como un techo.

Para qué sirve entonces: **para dimensionar**. Un activo que se mueve ±19% al
día no admite el mismo tamaño de posición que uno de ±1,3%.

## Salud del motor

El `● en vivo` del encabezado es el **WebSocket del navegador**: puede estar
verde con el motor muerto hace horas. La línea de abajo dice si el motor —el que
ejecuta los stops— realmente corrió, y con qué reglas:

```
● motor al día · vigiló recién   m-6abe7991
```

Sale de `GET /api/estado`. El dato (`ultimaVigilada`) existía desde siempre y no
se mostraba en ningún lado, con 91% de ceguera medida en 48 h.

**El monitor también escribe la serie.** `appendSnapshot` se llamaba solo desde
el dashboard, y `drawdownActual` saca el pico de ahí: el freno de caída del 10%
medía contra *el máximo que alguien estuvo mirando*. Un techo de madrugada no
existía para la compuerta. Ahora el monitor deja su punto cada 15 min (96 líneas
al día, no 480) valorizando la real con cantidades ya conocidas — sin gastar una
llamada firmada ni tocar las claves.

## Sello de versión — que el registro signifique algo

Cada posición y cada movimiento nacen con un sello `m-xxxxxxxx`;
`data/versiones.json` guarda qué parámetros y qué lógica significaba.

Existe porque el registro de 14 días es el producto del proyecto, y un resultado
que no dice con qué reglas se obtuvo no es un registro: es una anécdota. Entre
el 18 y el 23 de agosto el motor cambió cinco veces mientras las jugadas se
anotaban todas iguales — **el alfa de +2,88 USDT medía un motor que ya no
existe**. Las 6 jugadas cerradas antes del 23-ago no llevan sello: al comparar
resultados, agrupar por sello.

**No se escribe a mano.** Escribirlo a mano es lo que dejó la tabla de versiones
del plan congelada en v2a. Se deriva por hash de los parámetros vivos **más la
huella del código** de las funciones que deciden (`planDeEntrada`,
`montoPorRiesgo`, `compuertaRiesgo` y los detectores de señales), normalizada
sin comentarios: cambiar una fórmula mueve el sello, reescribir un comentario no.

Esa segunda parte se agregó porque el sello falló en su primera prueba real: el
stop estructural entró como lógica nueva sin declarar ningún parámetro, y el
hash no se movió.

## Motor de aprendizaje

`src/aprendizaje.mjs` lee los registros del proyecto y acumula lo que hoy se
pierde — no opera ni toca la billetera:

- **Instrumentación.** `contextoEntrada(asset)` captura RSI (diario y 1h),
  momentum 7d/30d, volumen, distancia al máximo de 30d y **régimen de
  mercado** (`regimenMercado()`: ¿sube el 80%+ del universo — rally amplio —
  o solo el activo — pump aislado?). Se engancha en cada jugada manual; falla
  en silencio a propósito (perder el registro es malo, abortar la jugada por
  eso es peor).
- **Hipótesis.** `data/hipotesis.json`, sembrado con las afirmaciones que ya
  hicimos (RSI>80, ventana 30d, stops por volatilidad, brecha de los stops,
  cuarentena, sizing…). `deriva()` compara cada una contra el código real y
  señala lo que creemos respaldado pero el motor todavía no aplica.
- **Patrones.** Cruza resultados por stop/RSI/régimen/duración/veredicto con
  un **umbral de calidad obligatorio**: bajo n=20 reporta "es ruido, no
  señal", nunca un porcentaje suelto.
- **Veredictos.** `registrarVeredicto()`, 4 categorías (tesis-correcta /
  tesis-correcta-mala-ejecución / tesis-equivocada / ruido-de-mercado) — se
  capturan preguntándole a Jorge, no redactadas solas.

```bash
node src/aprendizaje.mjs        # informe legible
node src/aprendizaje.mjs --json # para integrarlo en otra herramienta
```

API: `GET /api/aprendizaje` (informe completo) · `POST /api/veredicto`.

## Bot de Telegram (opcional)

Notificaciones al móvil y consultas de **solo lectura**: `@kripto_wallet_k_bot`.

```bash
node src/telegram.mjs --setup   # valida el token y busca tu chat ID
node src/telegram.mjs           # manda un mensaje de prueba
```

| Comando | Responde |
|---|---|
| `/resumen` | **Todo en un mensaje**: día del ciclo, marcador, alfa, riesgo, reserva, posiciones y movimientos de hoy |
| `/estado` | Marcador, alfa y riesgo abierto |
| `/posiciones` | Cada posición y su distancia a los niveles |
| `/mercado` | Régimen y radar del último análisis |
| `/riesgo` | Cuánto se pierde si pegan todos los stops |
| `/oportunidades` | Candidatos que pasan los criterios |
| `/registro` | Qué ejecutó el sistema sin ti |

### Login

El bot **arranca bloqueado**: no responde nada —ni estado, ni saldos, ni ayuda—
hasta recibir `/login usuario clave`.

```bash
node src/telegram.mjs --login   # genera el hash para pegar en .env
```

En `.env` va `TELEGRAM_PASS=scrypt:salt:hash`, **nunca** el usuario ni la clave.
Se derivan juntos con **scrypt + salt**: si el archivo se filtra, no sirven
tablas precalculadas y probar cada candidato cuesta caro a propósito. El
generador los lee por *stdin*, así que no quedan en el historial de la shell.

| Medida | Por qué |
|---|---|
| El mensaje con credenciales **se borra** al instante | Los bots de Telegram no soportan cifrado E2E: el chat vive en sus servidores |
| Desbloqueo **vence a los 30 min** | Una sesión eterna anula la clave |
| **3 intentos** → congela todo | Corta la fuerza bruta de quien tenga el teléfono |
| El error no dice **cuál** campo falló | No regalar la mitad del problema |
| `timingSafeEqual` | La comparación no filtra por duración |

Esto protege el caso que la lista blanca no cubre: alguien con el teléfono
desbloqueado o la cuenta de Telegram tomada — para el bot, ese atacante *es*
Jorge. Es un **segundo secreto compartido, no un segundo factor**: ambos campos
viajan por el mismo canal. Un 2FA real sería un código TOTP de una app aparte.

`/seguridad` muestra el estado; `/congelar` corta toda la ejecución al instante
y **solo se reactiva desde la máquina** — si alguien tomó tu Telegram, no debe
poder revertirlo.

**Solo ejecuta ofertas que él mismo genera**, y solo si las apruebas por botón.
No existe un comando libre tipo "compra X": eso se decide en el dashboard, con
los avisos de impacto delante. Los criterios del motor son el filtro — no se
puede aprobar algo que el motor rechazó por RSI alto o por ser un pump.

| Salvaguarda | Por qué |
|---|---|
| Oferta vence en **15 min** | Pasado ese rato el precio se movió: aprobar una oferta vieja es aprobar otra cosa |
| Monto acotado a **5 USDT** | Una aprobación remota nunca compromete más |
| Ofertas **en memoria** | Si el servidor reinicia se pierden, que es lo correcto |
| Se verifica **quién** toca el botón | Un mensaje reenviado a otra persona no ejecuta nada |
| Se consume al aprobar | El mensaje se reescribe: no se puede tocar dos veces |
| La billetera **real** no se toca | Esas órdenes las haces tú en Binance |

Dos flujos con aprobación: **oportunidad** (ficha con RSI, salto de volumen,
niveles y riesgo → `🟢 APROBAR · 5 USDT` / `🔴 RECHAZAR`) y **peligro** (una
posición entra en `cerca-limite` → `🟢 SALIR AHORA`, para salir antes del
auto-stop si sabes algo que el sistema no).

Responde solo al `TELEGRAM_CHAT_ID` configurado (un bot de Telegram es público).
Usa polling, así que no hace falta puerto abierto ni túnel.

**Diseño de los mensajes (estilo A+C).** Los datos van en bloque monoespaciado
con columnas alineadas, y **antes del dato va una frase que dice qué significa**
— un número solo no comunica. Las listas largas usan `blockquote expandable`
para que el mensaje no sea un muro. Sin reglas horizontales: el `blockquote`
separa mejor. Glifos solo con significado (`▲▼` dirección, `──◆──` posición en
un rango, semáforo de RSI). La API de Telegram **no permite colorear botones**:
el color entra por emoji en el texto.

> **Hora local, no UTC.** Cortar el texto ISO (`ts.slice(11,16)`) devuelve UTC y
> en Chile son 4 horas de diferencia — el auto-stop de las 12:58 se mostraba
> como 16:58 y un corte de las 23:54 salía con fecha del día siguiente. Todo lo
> que se muestra pasa por el helper `hora()`, en 24 h y hora local, igual que
> `fechaLocal()` en el motor.

> Esto rompe una invariante: hasta ahora el servidor escuchaba solo en
> `127.0.0.1` y nada salía del Mac. Con el bot, los saldos viajan a los
> servidores de Telegram.

**Alertas automáticas** (van a macOS y al teléfono): auto-stop ejecutado,
objetivo cobrado, cruce sin ejecutar, vigilancia reanudada tras dormir, y
**posibles oportunidades** — estas últimas solo si se cumplen todos los
criterios: RSI14 < 70 (lección GPS), salto de volumen < 6x su propio promedio
(hallazgo RE), régimen no "débil", fuera de cuarentena y de la cartera, y sin
repetir el mismo activo en 12 h. Cada aviso queda registrado en el motor de
aprendizaje para poder probar después si los criterios sirven.

## Motor de oportunidades — fase, señales, score y watchlist

El screening pasa por cuatro capas. Cada una puede rechazar; ninguna puede
ablandar a la anterior.

**1 · Fase por activo.** Cada activo del radar lleva `tendencia / rango /
extendido / caída`, de precio vs su media de 20 días. Sale de las mismas velas
que el momentum: cero llamadas extra.

> "Extendido" **no** es estar lejos de la media — una tendencia siempre lo está,
> porque la media la persigue con ~10 días de rezago. Es el **exceso sobre lo
> que la propia deriva explica** (`distancia − deriva×9,5`), medido en
> volatilidades del activo. La primera versión usaba distancia cruda y marcaba
> extendida cualquier subida ordenada; el test lo cazó.

**2 · Señal con nombre.** Sin patrón reconocible no hay entrada, por bueno que
sea el score:

| Señal | Condición |
|---|---|
| Pullback | +10% en 30d · fase tendencia o rango · retroceso **entre −5% y −30%** del techo · RSI < 60 |
| Ruptura | a ≤1,5% de su techo de 30d · **volumen ≥1,5×** · no en caída |
| Momentum | momentum positivo · fase tendencia |

> El techo del retroceso del pullback lo puso la realidad: TUT clasificaba
> pullback con **−80%** desde su máximo (un pump colapsado). Sin ese límite,
> "pullback" significa "comprar lo que se desplomó".

*Continuación* y *reversión* no se implementan a propósito: la primera es
momentum con otro nombre a esta granularidad; la segunda es atrapar el cuchillo
y contradice la cuarentena.

**3 · Score de confianza 0-100** (umbral 65):

```
RSI diario 36 · Fase 24 · Régimen 12 · Volumen 14 · RSI-1h 14
```

> **Propiedad de diseño con test propio:** los cuatro componentes sin RSI suman
> **64**, bajo el umbral. Ningún alineamiento perfecto de fase, régimen y
> volumen puede comprar un activo sobrecomprado. Los pesos originales
> (30/25/15/15/15) sumaban 70 y sí podían.

Los **vetos duros no se negocian** y el score no los toca: cuarentena, ya en
cartera, régimen vetado, pump >6×, RSI ≥ 80. El score decide entre lo defendible.

Todas las señales comparten el mismo umbral. Bajárselo a la ruptura es tentador
—un activo en máximos tiene RSI alto por definición— pero ese es el perfil de
las peores operaciones del historial (ACE, GPS, RE). Con n=0 por señal, aflojar
ahí sería ajustar la regla al deseo.

**Plan de entrada: el objetivo se apoya en la resistencia.** El stop sale de la
volatilidad (1,5×); el **objetivo**, del techo de 30 días. Mientras fue
`|stop| × 2,5`, el R:B era una constante (2,50 en las cinco posiciones abiertas)
y no podía informar ninguna decisión. Ahora varía y es criterio: **R:B mínimo
1,5**.

> En una **ruptura** el precio ya está en su techo: no hay resistencia visible
> arriba y se vuelve a la proyección por volatilidad. Inventar un nivel que no
> existe sería peor. El objetivo se limita a 3× el stop para que un activo
> derrumbado no genere una meta absurda.

**4 · Watchlist** — lo que no pasa hoy queda vigilado, no se pierde.

```bash
curl -X POST localhost:8517/api/watchlist \
  -H 'Content-Type: application/json' -d '{"asset":"ENA"}'
```

La condición también acepta **zona de entrada** (`zonaPct`): "entrá si retrocede
un 6%". La zona se fija **al dar de alta** contra un precio de referencia que
pone el servidor, y se congela — si se recalculara sobre el precio del momento
perseguiría al mercado hacia abajo y nunca se alcanzaría. Lleva piso además de
techo: un retroceso del 6% no se cumple con una caída del 40%.

El monitor evalúa cada 15 min; al cumplirse la condición **crea la oferta** (que
sigue requiriendo tu aprobación). Tres reglas que la idea original no tiene:
toda entrada **caduca a los 7 días**, toda caducidad deja **autopsia** en el
aprendizaje, y el armado es **en dos fases** — la entrada se marca "armada" solo
después de que la oferta se creó, así que con la ejecución congelada sigue
vigilando en vez de quedar en un estado fantasma.

## Reconstrucción de cierres — que el registro mida la estrategia

El monitor mira cada 3 min y muere con el equipo dormido: en los primeros 5 días
el sistema estuvo **95 h ciego de 120 (79%)**, con huecos de hasta 11 h. Al
despertar, ejecutar al precio de *ahora* registra dónde estaba el mercado al
abrir los ojos, no dónde estaba cuando la regla se cumplió.

Ahora, si el nivel se cruzó mientras nadie miraba, el motor lo busca en velas de
1 minuto y ejecuta **a ese nivel** — lo que una OCO habría hecho sola.

> **No es ganar más.** HEMI se habría registrado en +30% en vez de +46,1%. El
> punto es que el registro mida la estrategia y no a qué hora despertó el Mac.

Tres candados, con test, contra el riesgo opuesto (inventar precios buenos):
ejecuta **en el nivel y nunca en la mecha**, solo **si la vela confirma** el
cruce, y solo si ocurrió **antes de esta revisión**. Falla hacia el
comportamiento anterior si Binance no responde o el hueco supera 24 h.

## Tres salidas para una oferta

| Botón | Qué hace |
|---|---|
| **Aprobar** | ejecuta en la ficticia con su plan (stop, objetivo, plazo) |
| **Vigilar** | la manda a la watchlist: vuelve sola cuando su condición se cumpla |
| **Rechazar** | la descarta; queda registrada en el aprendizaje |

> "Vigilar" es el puente que faltaba entre *"esto no me convence ahora"* y
> *"avisame cuando cambie"*. Antes rechazar borraba la idea para siempre.

## Compuerta de riesgo — un solo sí o no

`compuertaRiesgo(plan, prices, { wallet })` es el único lugar donde se pregunta
"¿puedo abrir esta posición?". La invocan **los dos** caminos que comprometen
plata: `nuevaOferta` (dashboard y Telegram) y `jugadaManual` (`/api/jugada`).

Durante un tiempo `/api/jugada` iba directo al estado y se saltaba los cinco
controles. Cerrar el R:B en las ofertas y dejarlo abierto en la puerta de al
lado no cierra nada: **una sola compuerta o ninguna.**

| Bloquea | Avisa |
|---|---|
| ejecución congelada | volatilidad >8% diaria |
| caída >10% desde el pico | sleeve al 80% de su techo |
| sleeve sobre su techo | caída a mitad del freno |
| reserva insuficiente | |
| riesgo >1,5× el objetivo | |
| R:B bajo el mínimo de 1,5 | |

**Riesgo sobre el objetivo.** Antes solo avisaba, y el aviso confesaba el
problema: "el mínimo de orden hará arriesgar más de lo objetivo". PUMP quedó con
0,70 USDT de riesgo contra un objetivo de 0,35. El tope no mira la volatilidad
sino el desvío que produce: arriba de ~4,67% diario, el piso de 5 USDT hace
imposible dimensionar bien.

**El parámetro `wallet`** deja juzgar la billetera en memoria. Sin él, "vender A
para comprar B" se bloquearía por reserva insuficiente mirando el saldo de antes
de la venta.

### Las tres fases de una jugada

Nada toca el disco hasta que todo está validado. Las fases son fronteras de
función, no comentarios:

```
validarEntrada()        se rechaza sin red ni billetera
validarContraCartera()  ancla, legado, par inexistente
aplicarVentas()         en memoria; el cierre en disco se encola
  ↓ compuerta por cada compra, con la billetera viva
confirmarJugada()       PUNTO DE NO RETORNO: solo escribe
```

Antes las ventas cerraban posiciones **en disco** y recién después se le pedían
los stops a Binance. Si esa llamada fallaba, quedaba la posición cerrada y la
billetera sin escribir: el activo contado dos veces.
| riesgo abierto >5% del capital | |

> La separación es deliberada: **bloquear por todo entrena a ignorar los
> bloqueos**. Los avisos viajan con la oferta al dashboard y a Telegram.

El **drawdown** sale de los snapshots ya guardados (sin estado nuevo) y funciona
como curva de equity limpia porque el capital es cerrado: mover plata entre
bolsillos no altera el total. El 10% es un juicio declarado — con −2,58% de peor
caída en 5 días no hay con qué calibrarlo, y el momento de fijar un freno es
cuando no duele.

`GET /api/riesgo` devuelve el estado sin plan concreto.

## Tamaño de posición por riesgo

El monto sale del riesgo, no al revés: `monto = riesgoObjetivo / |stop|`, con
objetivo **0,35 USDT** por jugada y el resultado acotado a **[5, 8] USDT**.

> **Lo que esto NO hace, y es aritmético:** igualar el riesgo. Con el mínimo de
> orden de Binance (~5 USDT) sobre una cartera de ~93, cubrir stops de −4% a
> −15% exigiría a la vez un objetivo ≥0,75 (por el piso) y ≤0,32 (por el techo).
> Se probaron cuatro valores y todos convergen a ~2,3× de dispersión. Baja de
> **8,1× a 2,0×** y **declara el residuo** en cada jugada. Un test fija ese
> límite para que nadie prometa después lo que no se puede.

## Plazos — liquidar lo que no rinde

Una posición puede llevar un **plazo**: si al vencer no rindió, el motor la
libera, aunque el precio no haya tocado ni el límite ni el objetivo.

**En rampa, no de golpe.** Antes el nivel de salida saltaba de −6% a la banda de
ruido (~+2,7%) en un instante, y una posición que sobrevivía en +3% quedaba
cortada en el primer bajón normal del día siguiente. Y cortar ganadores temprano
ya estaba medido como el defecto del sistema: de 6 cierres seguidos por el
seguimiento post-cierre, **los 6 siguieron subiendo** (TRUMP +68%, ACE +52%).

Ahora el stop sube gradualmente: al vencer el plazo arranca en su nivel original
y llega a la banda de ruido tras otro tanto de tiempo (`limitePctEfectivo`). La
intención se respeta —el capital que no rinde se libera— pero por apriete
progresivo, no por guillotina.

```bash
curl -X POST localhost:8517/api/posicion/horizonte \
  -H 'Content-Type: application/json' \
  -d '{"ids":["pos-0007"],"horas":48}'
```

Tres decisiones que no son obvias:

**El umbral no es cero.** Liquidar en el punto de equilibrio de un activo que
oscila 4-6% al día lo decide el ruido de los últimos minutos, no si la tesis
funcionó — la misma lección de GPS (−18,1 pp) y ACE (−4,3 pp) que ya rige los
stops en 1,5× la volatilidad. El umbral es:

```
comisión ida+vuelta (0,20%)  +  0,5 × volatilidad diaria
```

Para las posiciones actuales da +2,20% / +2,53% / +2,20%. La volatilidad se
guarda al abrir; las posiciones anteriores al campo la recuperan del `limitePct`
(÷1,5, error medido < 0,4 pp). **El `0,5×` es un juicio sin validar**: está como
hipótesis abierta `umbral-plazo-por-volatilidad` en el motor de aprendizaje.

**El precio manda sobre el plazo.** Si la posición ya cruzó su límite o su
objetivo, ese cierre gana. El plazo solo actúa cuando el precio no decidió nada.

**El reloj arranca cuando pones el plazo,** no en la apertura (`plazoDesde`).
Contándolo desde `abierto`, ponerle 48 h a una posición de 3 días la dejaba
vencida al instante y la liquidaba sola — una venta por sorpresa. Naciendo con
plazo son el mismo instante, así que el camino normal no cambia.

**Una salida por plazo no es un acierto de tesis.** Se registra con categoría
`horizonte` (no `stop` ni `objetivo`), sin brecha de nivel —no hubo nivel que
pasarse— y `estadisticaJugadas()` la reporta **aparte** (`porTiempo`). Contarla
como acierto inflaba la tasa con ganancias mínimas que no prueban nada.

## Trailing — proteger la ganancia sin ponerle techo

Una posición puede llevar un **trailing**: si sube y después se devuelve X%
desde su máximo, sale. Es lo contrario del objetivo fijo — no limita cuánto
puede subir, limita cuánto puede devolverse.

```bash
curl -X POST localhost:8517/api/posicion/trailing \
  -H 'Content-Type: application/json' -d '{"ids":["pos-0010"],"pct":25}'
```

**Solo aprieta, nunca ensancha.** El nivel efectivo es
`max(stop original, rampa del plazo, trailing)`. Un trailing que ensanchara el
stop convertiría una protección en un permiso para perder más.

**El pico sale de las VELAS, no de los precios observados.** Acumularlo tick a
tick daría el máximo de lo que alguien alcanzó a mirar — con el equipo dormido
el 95% del tiempo, el trailing protegería una ganancia que nunca existió. Es la
misma lección que la reconstrucción de cierres. `refrescarPicos()` lo recalcula
desde la apertura en cada ciclo del monitor, y el pico solo sube.

Falla hacia el comportamiento anterior: **sin pico medido no hay trailing**, ni
siquiera uno calculado desde la entrada — eso apretaría un stop ancho por un
máximo imaginario.

Nota sobre el tamaño: un trailing ajustado **empeora** el rendimiento. Medido
sobre 429 ventanas, 6% desde +8% rinde +0,289% contra +0,440% del objetivo
actual; 10% desde +10% rinde +1,157%. Si va a existir, tiene que ser amplio.

## Llamadas a Binance — de a seis, no de a una

`runAnalysis` pedía las velas de los 30 candidatos **una por una**. Medido
contra la API real: 10 símbolos tardan 3.564 ms en serie y 390 ms en paralelo.
El análisis completo pasó de ~21 s a **~3,6 s**.

`enParalelo(items, fn, limite)` lo resuelve en 15 líneas, sin dependencias, y lo
usan los cuatro sitios que salían en serie (candidatos, majors del gráfico,
precios sueltos y planes de compra).

El límite de **6** no es adorno: 60 peticiones de golpe pueden ganarse un 429 de
Binance y tumbar el análisis entero — el remedio sería peor que la lentitud.

Dos garantías que el bucle secuencial daba y no se podían perder:

1. **Orden de entrada, no de llegada.** El ranking se construye con ese arreglo;
   si el orden dependiera de qué respuesta vuelve primero, los empates de
   momentum se resolverían por latencia de red. El test lo prueba con latencia
   *inversa* al índice — con una latencia uniforme no se detectaría nada.
2. **Un fallo no tumba al resto.** Cada elemento devuelve su ranura
   `{ ok, valor, error }`; un símbolo delistado se omite sin desplazar a nadie.

Excepción deliberada: en los planes de compra el fallo **sí** aborta. Sin
niveles no hay plan que la compuerta pueda juzgar.

## Cadencia del modelo — v2d (30 días + semanal)

El modelo rankea por momentum de **30 días** y congela sus `picks` durante
**7 días** desde el último rebalanceo aplicado (`wallet.ultimoRebalanceo`).

Dos cosas que hay que respetar al tocar esto:

**`scored` se recalcula SIEMPRE; solo `picks` sigue la cadencia.** El mismo
ranking alimenta los picks del modelo *y* el radar `mercado` que usa el
screening de oportunidades — y ese necesita estar fresco en cada corrida, no una
vez por semana. Meter el cálculo dentro del condicional de la cadencia rompe el
radar con `scored is not defined`.

**Un pick vetado por cuarentena no se reemplaza: se queda en dos.** Y su parte
del presupuesto **queda sin usar** — por eso `rebalance()` recibe `ranuras`
aparte del largo de `picks`. Dividir entre los sobrevivientes concentraría más
plata en cada uno, lo contrario de reducir exposición.

> Con la lista de `picks` vacía, `rebalance` **vende todo el sleeve** a reserva.
> Eso es correcto cuando no hay momentum positivo (refugio en USDT, es la
> estrategia), pero **no** cuando la cuarentena vació la semana: una cuarentena
> dice "no vuelvas a comprar esto", no "vende lo que tienes". Hay un guardarraíl
> para ese caso. Mismo síntoma, causas opuestas.

## Ofertas — una decisión, dos accesos

Una **oferta** es una oportunidad concreta con monto y niveles ya fijados,
aprobable **desde el dashboard o desde Telegram**. Vive en `data/ofertas.json`,
así que sobrevive un reinicio y la ve cualquiera de las dos superficies.

```
POST /api/oferta            crea una y avisa al teléfono
GET  /api/ofertas           las vigentes
POST /api/oferta/tomar      { id, origen }
POST /api/oferta/descartar  { id, origen }
```

**Dos protecciones, ninguna basada en la memoria del proceso:**

| Protección | Por qué |
|---|---|
| Vence en **15 min** | Pasado ese rato lo que se aprobó ya no es lo mismo |
| **Tolerancia de precio del 2%** | Si el precio se movió más, se rechaza diciendo cuánto. El tiempo es solo un proxy del movimiento: acá se mide el movimiento |

`tomarOferta(id, origen)` vive en el **motor**; Telegram y el dashboard son
clientes. La primera superficie que la tome invalida la otra.

**El origen queda registrado.** Cada movimiento guarda `origen`
(`dashboard`|`telegram`|`motor`) y el historial lo muestra con insignia:
**✈ Telegram**, **⚙ automático**, **🖥 dashboard**. Los **rechazos** también se
registran (en el aprendizaje, no en movimientos: no mueven plata pero son una
decisión — sin eso, los casos donde Jorge se abstiene no dejan rastro).

> Nunca crear una oferta desde un proceso aparte (`node -e`): nace y muere con
> ese proceso. Se crea vía `POST /api/oferta`, dentro del servidor.

## Estructura

- `src/engine.mjs` — análisis, estrategia, billeteras, API de Binance
- `src/server.mjs` — servidor del dashboard, API local y vigilancia (puerto 8517)
- `BACKLOG.md` — lo que falta y por qué todavía no (con lo descartado y su razón)
- `src/backtest.mjs` — backtester sobre klines de Binance (`node src/backtest.mjs --dias 90`)
- `src/test.mjs` — 51 tests de lógica: deterministas, sin red, sandbox en `/tmp`
- `src/mercado.mjs` — mide el motor contra el mercado real (no es la suite)
- `public/` — interfaz (index.html + assets/css + assets/js)
- `data/` — estado generado:
  - `wallet.json` — billetera ficticia con sus bolsillos
  - `real-wallet.json` — snapshot de cantidades reales + hora de lectura
  - `posiciones.json` — posiciones con salida programada (abiertas y cerradas)
  - `movimientos.jsonl` — toda operación registrada, por evento
  - `history.csv` — un punto por día · `snapshots.jsonl` — serie intradía, la
    escriben el dashboard **y el monitor** (cada 15 min, aunque nadie mire)
  - `alertas.jsonl` — cruces de nivel detectados
  - `ofertas.json` — ofertas aprobables (vigentes, tomadas, vencidas)
  - `aprendizaje.jsonl` · `hipotesis.json` — motor de aprendizaje
  - `seguridad.json` — estado del congelado (sobrevive reinicios)
  - `versiones.json` — qué parámetros y qué lógica significaba cada sello
  - `watchlist.json` · `seguimiento.json` — candidatos armados y post-cierre
  - `last-run.json` — último análisis (sin duplicar historia/snapshots)
  - `servidor.log` — lo que el motor hizo sin nadie mirando, con hora local
    (rota sobre 2 MB a `.log.1`)
  - `genesis-2026-08-18.wallet.json` — **se conserva a propósito.** Estado de la
    billetera antes de la migración a bolsillos, con las **cantidades exactas**
    de cada activo. `snapshots.jsonl` guarda valores en USDT redondeados, así
    que esas cantidades no están en ningún otro lado — y son el punto de partida
    del registro de validación. No borrar.
- `paper-trader.mjs` — versión de consola
- `run-server.sh` — lanzador con resolución dinámica de Node
- `start.command` — arranque con doble clic

## Operación diaria

El ritual diario (análisis de mercado + operación de la ficticia + registro)
está definido en **PLAN-DE-ACCION.md**; cada día queda registrado en
**BITACORA.md**. Los ajustes al modelo siguen ciclos de 7 días, un cambio a
la vez, documentados en la tabla de versiones del plan.

Herramienta integrada: skill **`backtesting-trading-strategies`** (instalada
a nivel usuario en `~/.claude/skills/`) — toda variante del modelo se
backtestea contra datos históricos y solo entra a ciclo real si le gana al
modelo vigente.

## Hoja de ruta (peldaños)

1. **Validación** (~2 semanas): la estrategia debe ganarle al hold después de
   comisiones antes de cualquier paso con dinero real.
2. ~~**API key de solo lectura**: saldo real automático, sin snapshot manual.~~
   ✅ **hecho el 2026-08-19**.
3. **Módulo Movimientos**: ver especificación completa más abajo.
4. **Nunca automático**: las órdenes reales siempre son manuales, por diseño.

---

## Audit 2026-08-18

Los 13 hallazgos con su resolución viven en `BITACORA.md`, en la entrada
"2026-08-18 — Audit inicial". Acá quedaba duplicado: el README documenta **cómo
funciona el sistema hoy**, la bitácora **cómo llegó a ser así**.

---

## Especificación — Módulo Movimientos (peldaño 3, no construido aún)

> **Precondición para construirlo**: 14 días de historial donde la billetera
> ficticia le gane al hold (línea dorada sobre la violeta en el comparativo
> base 100) después de comisiones. Sin eso, este módulo no se implementa.

### Propósito

Convertir cada recomendación validada en una **orden concreta que el usuario
ejecuta manualmente en Binance** y luego registra en el dashboard, midiendo la
ganancia/pérdida real de cada movimiento y escalando el monto por operación
"de menos a más": las ganancias financian el crecimiento del riesgo, nunca el
capital base.

### Regla de escalado (el corazón del módulo)

- Escalera de montos por movimiento: **8 → 15 → 25 → 40 → 60 USDT** (se define
  al construir según el capital del momento; arranque ≈10% de la wallet).
- **Sube un escalón** tras 3 movimientos cerrados con ganancia neta acumulada
  positiva en el escalón actual.
- **Baja un escalón** tras 2 movimientos perdedores consecutivos (nunca por
  debajo del primero).
- El monto en riesgo simultáneo nunca supera el escalón vigente × 2.
- Cada movimiento lleva **objetivo de salida** (+X%) y **límite de pérdida**
  (−Y%) definidos al abrirlo; se cierran manualmente pero el dashboard avisa
  cuando el precio los cruza.

### Modelo de datos — `data/moves.jsonl` (un movimiento por línea)

```json
{
  "id": "mv-0001",
  "estado": "abierto | cerrado | cancelado",
  "asset": "ACE",
  "lado": "COMPRA",
  "abierto": { "ts": "ISO", "precio": 0.2289, "qty": 116.63, "usdt": 26.7 },
  "cerrado": { "ts": "ISO", "precio": 0.0, "usdt": 0.0 },
  "objetivoPct": 8, "limitePct": -4,
  "escalon": 1,
  "origen": "recomendacion | manual",
  "pnlUSDT": null, "pnlPct": null,
  "nota": ""
}
```

### API local (a agregar en `src/server.mjs`)

| Método | Ruta              | Qué hace                                          |
|--------|-------------------|---------------------------------------------------|
| GET    | `/api/moves`      | Lista movimientos + estado de la escalera         |
| POST   | `/api/moves`      | Registra un movimiento abierto (desde una reco)   |
| PATCH  | `/api/moves/:id`  | Cierra o cancela; calcula PnL con precio real     |

El servidor calcula PnL, mantiene el escalón vigente y expone alertas de
objetivo/límite cruzado usando los precios del refresco.

### UI — nueva tarjeta "Movimientos" en el dashboard

- Cada recomendación del Plan del día gana un botón **«La hice»** que abre el
  registro pre-llenado (asset, precio actual, monto del escalón vigente).
- Tabla de movimientos abiertos: asset, entrada, precio actual, PnL en vivo,
  distancia a objetivo/límite (con alerta visual al cruzarlos).
- Historial de cerrados con PnL acumulado y gráfico de la escalera en el
  tiempo (en qué escalón estuvo cada semana).
- Indicador del escalón vigente junto al título (ej. «Escalón 2 — 15 USDT»).

### Límites de diseño (no negociables)

- El módulo **registra** movimientos; jamás envía órdenes a Binance.
- Sin API key de trading: la única key aceptada es de solo lectura.
- Montos mínimos: respeta el mínimo de orden de Binance (~5 USDT) y avisa si
  el escalón vigente queda bajo ese mínimo tras una racha perdedora.
- Máximo 1 movimiento nuevo por día los primeros 30 días (anti-sobreoperación).
