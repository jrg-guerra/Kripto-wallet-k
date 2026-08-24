# Backlog técnico

Lo que está identificado, medido y **decidido posponer**. No es una lista de
deseos: cada línea tiene por qué se dejó y qué la destraba.

Los tres documentos del proyecto se reparten así:

| Archivo | Qué contiene |
|---|---|
| `README.md` | Cómo funciona el sistema **hoy** |
| `BITACORA.md` | Cómo llegó a ser así (historia, con sus lecciones) |
| `BACKLOG.md` | Lo que falta y por qué todavía no |
| `PLAN-DE-ACCION.md` | Estrategia, versiones del modelo y hoja de ruta |

---

## Bloqueado por algo externo

### Control de versiones (git) — HECHO el 2026-08-23

**Estado:** repo creado en `github.com/jrg-guerra/Kripto-wallet-k`, primer
commit subido (21 archivos, `.env` y `data/` verificados fuera). Pasos 1-3
del checklist original, completados.

**Plan de Jorge:** clonar en el iMac y dejarlo 24/7, para fortalecer el motor y
la validación, con la expectativa de ver un cambio sustancial hacia el día
10-15 **contados desde que el iMac arranca**, no desde el día 1 del proyecto
(ver la nota metodológica del 23-ago sobre la vigilancia del 5%).

**Por qué importa:** no hay historial del código, no se puede revertir un cambio
malo ni ver qué cambió entre dos días. Los `.bak` respaldan **datos**, no
código, y guardan una sola versión anterior. El 2026-08-23 se tocó el camino del
dinero cinco veces con los 51 tests como única red.

### Migración al iMac — POSPUESTA por Jorge al próximo fin de semana / la semana que viene

**Estado el 2026-08-24:** el repo ya está listo para clonar (ver arriba) y la
arquitectura de la migración quedó decidida (abajo) — lo que falta es que
Jorge prepare el iMac físicamente. Sin fecha exacta todavía; "la próxima
semana o el próximo fin de semana".

**Antes de ese día, del lado del código no falta nada** — verificado el
24-ago: cero rutas de este Mac hardcodeadas en `src/`, `public/` ni en los
scripts; `run-server.sh` resuelve todo de forma relativa y busca Node vía
`nvm` genéricamente; cero dependencias (`npm install` no aplica); la única
feature de Node algo reciente es `structuredClone` (Node 17+, cualquier nvm
actual la tiene). El repo es público, así que clonar no pide token — solo
subir cambios lo pide.

**Lo que Jorge tiene que tener a mano ESE día** (no antes, no hace falta
prepararlo hoy):

1. Su API key de Binance de solo lectura, para pegarla él mismo en el `.env`
   del iMac.
2. El nombre de red del iMac (`scutil --get LocalHostName` parado frente al
   iMac) — define la dirección del dashboard: `http://ese-nombre.local:8517`.
3. Un método para pasar `data/` del Mac al iMac (AirDrop es lo más simple).

### Arquitectura de la migración — decidido el 2026-08-24, ANTES de clonar

**El motor no es un sistema distribuido: es un solo proceso con un solo
`data/`.** Dashboard, Telegram y las jugadas que ejecuta Claude no son tres
sistemas sincronizados — son tres puertas al mismo servidor. Eso significa que
**no pueden correr dos instancias vivas a la vez**: si el Mac sigue corriendo su
propio servidor después de migrar, se crean dos billeteras ficticias
divergiendo en paralelo, y se pierde exactamente la integridad que el sello de
versión y las escrituras atómicas existen para proteger.

**Decisión de Jorge:** Claude sigue operando desde el Mac (esta máquina, estas
sesiones) — no hace falta correr Claude Code en el iMac. El iMac es el único
**motor vivo**: ahí corre `run-server.sh`, ahí vive `data/`, ahí escucha el bot
de Telegram, y el dashboard se ve en la red de casa apuntando a su dirección.
Sin acceso remoto fuera de la red de casa (descartado por simplicidad; si hace
falta más adelante, Tailscale es la opción a evaluar).

Lo que cambia en la práctica:

| Actor | Antes (todo en el Mac) | Después de migrar |
|---|---|---|
| Dashboard | `http://localhost:8517` | `http://iMac.local:8517` (o su IP en la LAN) |
| Telegram bot | corre en el Mac | corre **solo** en el iMac |
| Jugadas que ejecuta Claude | `curl 127.0.0.1:8517` | `curl` a la dirección del iMac en la LAN |
| Código (logic/front) | se edita y prueba acá | se edita acá → `git push` → en el iMac `git pull` **+ reiniciar el proceso** (Node no recarga código solo) |

**Confirmado el 24-ago antes de migrar:** el bot de Telegram está activo ahora
mismo en el Mac (`TELEGRAM_BOT_TOKEN` configurado y el servidor corriendo). Si
el iMac arranca su propio bot con el mismo token sin apagar antes el del Mac,
**los dos van a competir por los mismos mensajes** de forma impredecible.
**Apagar el servidor del Mac es un paso obligatorio de la migración, no
opcional.**

Checklist actualizado para clonar:

1. ~~`git init` + commit + push~~ — hecho.
2. En el iMac: clonar, `nvm` con Node 22+, crear su propio `.env` (**Jorge pega
   la key, nunca el asistente**).
3. Copiar `data/` del Mac al iMac a mano (AirDrop/USB) — **no viaja con git**;
   sin este paso se pierde el registro de 5 días de validación.
4. **Apagar el servidor del Mac** (`Ctrl-C` o cerrar la Terminal que lo corre)
   ANTES de arrancar el del iMac, para que el bot de Telegram no quede
   duplicado.
5. En el iMac: arrancar con `run-server.sh`.
6. `caffeinate` en el arranque para que no se duerma.
7. Confirmar el nombre de red del iMac (`iMac.local` suele funcionar por
   Bonjour en la misma WiFi) para poder apuntar el dashboard y las jugadas de
   Claude ahí.

**Nota:** `git init` local ya daba historial y revert sin necesidad de cuenta
remota — quedó demostrado el mismo día: se pudo revisar `git status` antes de
cada commit para verificar qué se subía.

**Por qué vale la pena (medido):** 95,3 h ciegas de 120 en los primeros 5 días
(79%); en las últimas 48 h de esa medición, 91%. Los peores huecos son de
madrugada, con el Mac durmiendo. Mitigaciones ya aplicadas mientras tanto:
reconstrucción de cierres desde velas de 1 minuto (repara el registro),
detección de despertar con aviso, y el monitor escribiendo la serie cada
15 min — así que la ceguera actual no está destruyendo datos, solo dejando
huecos que ya se corrigen solos.

**El recordatorio que no hay que perder:** para dinero real nada de esto hace
falta. Una OCO en Binance ejecuta sin ninguna computadora encendida.

---

## Decidido posponer (sin bloqueo externo)

### Watchdog del stream de precios

El `● en vivo` del dashboard es el WebSocket del navegador. Si el stream se
congela **sin cerrar** —típico al despertar el Mac o al cambiar de red—
`onclose` nunca dispara: el badge sigue verde y los precios quedan congelados
pareciendo vivos. Peor, `aplicarPreciosVivos()` recalcula la señal de cada
posición, así que el banner puede decir "cruzó el límite" con un precio viejo.

**Arreglo:** guardar la marca del último mensaje; sin datos por 15 s, apagar el
badge y forzar reconexión. ~10 líneas en `app.js`.

**Por qué se pospuso:** es cosmético al lado de los controles de riesgo que se
arreglaron el mismo día. Sube de prioridad si Jorge empieza a decidir mirando el
dashboard en vivo.

### Backoff en la reconexión del WebSocket

`setTimeout(conectarStream, 5000)` fijo, para siempre. Con la red caída son 720
intentos por hora. Menor, pero para algo pensado como 24/7 es ruido.

### WebSocket en el motor (no solo en el navegador)

**El hallazgo:** el tiempo real solo pinta la pantalla. El motor decide cada
3 minutos, y la reconstrucción de cierres tiene un piso de 5 minutos
(`engine.mjs`, `minutos < 5` no reconstruye). **Entre 0 y 5 minutos de retraso
no hay corrección de ninguna clase:** ejecuta al precio de ahora y la diferencia
se la come el registro en silencio.

No tiene nada que ver con el 24/7 — pasa con el Mac despierto.

**Arreglo propuesto:** abrir el stream en el servidor **solo** para los activos
con posición abierta cerca de un nivel. Node 22 trae WebSocket nativo, cero
dependencias, y solo se conecta cuando importa.

**Estado:** Jorge nunca lo decidió. Necesita una decisión antes de construirse.

### Reinicio supervisado

El servidor ahora muere ruidosamente (avisa por macOS y Telegram, sale con
código 1), pero **nada lo levanta de nuevo**. `start.command` hace
`wait $SERVER_PID` y termina.

Se dejó a propósito fuera del arreglo de "muerte ruidosa": reiniciar en bucle
puede enmascarar un crash repetido. La forma correcta es un supervisor con tope
de reintentos y aviso al segundo fallo — y su lugar natural es junto con la
migración al iMac, que es cuando el proceso pasa a ser desatendido de verdad.

---

## Esperando datos, no trabajo

### Invalidación estructural — medir antes de tocar

`invalidacionPct` ya se guarda en cada posición y clasifica el cierre. Lo que
falta es **comprobar que no se dispara de más**.

Observado el 2026-08-23 en una compra de prueba: DOT dio invalidación a −1,03%
con stop a −4%. Entrar 1% sobre el soporte es la entrada ideal de un pullback,
pero implica que casi cualquier stop-out marcará "estructura rota" y mandará el
activo a cuarentena.

**Qué lo destraba:** cierres reales con invalidación registrada. Revisar cuando
el seguimiento post-cierre llegue a n≥20.

### Plazo progresivo — primera ejecución real

La rampa reemplazó al acantilado el 2026-08-23. APT, FET y FIL son las primeras
posiciones que la van a estrenar. **Mirar qué hace de verdad** en vez de asumir
que funciona.

### Score de confianza — pesos sin validar

Los pesos (RSI 36 / fase 24 / régimen 12 / volumen 14 / RSI-1h 14) son un juicio,
no un resultado medido. La hipótesis `score-de-confianza` pide correlacionar
score con resultado cuando haya n≥20.

---

## Descartado con razón (no es pendiente)

No volver a proponerlos sin evidencia nueva:

| Ítem | Por qué no |
|---|---|
| Noticias y datos on-chain | Sin fuente confiable gratuita; el ruido superaría la señal |
| Señales de continuación y reversión | Solapan con momentum y pullback; reversión contradice la estrategia |
| Tope de pérdida máxima | Redundante con el freno de caída a esta escala (posiciones de 5-8 USDT sobre ~93) |
| Etiquetas cualitativas del memo ("riesgo MODERADO") | Una palabra sobre un número que ya se entiende; puede desalinearse del dato |
| Jest o Vitest | Cientos de paquetes en un proyecto de cero dependencias; el runner propio son 30 líneas |
| Cobertura ≥80% | No distingue una línea *ejercitada* de una *verificada*; la disciplina de mutación es más fuerte |
| Partir `engine.mjs` en módulos | El proyecto ya pagó el precio de los imports dinámicos (`tg.crearOferta` falló semanas en silencio) |
| Extraer el bucle de compras de `jugadaManual` | Exigiría una función de siete parámetros: mueve el problema, no lo resuelve |
| Migrar a TypeScript | Beneficio real, pero es una migración, no un arreglo |
