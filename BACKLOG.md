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

### Control de versiones (git) — ACORDADO PARA EL 2026-08-24

**Estado:** el `.gitignore` está escrito y listo (excluye `.env` y `data/`); el
repositorio nunca se inicializó.

**Plan de Jorge (24-ago):** subir el proyecto completo a git y ponerlo a correr
en el iMac 24/7, para fortalecer el motor y la validación, con la expectativa de
ver un cambio sustancial hacia el día 10-15.

Checklist para ese día:

1. `git init` + primer commit (no necesita cuenta remota).
2. Verificar que `.env` y `data/` quedan fuera: `git status` no debe listarlos.
3. Crear el remoto y `git remote add` + push.
4. En el iMac: clonar, `nvm` con Node 22+, crear su propio `.env`
   (**Jorge pega la key, nunca el asistente**), y arrancar con `run-server.sh`.
5. `caffeinate` en el arranque para que no se duerma.
6. Decidir qué pasa con `data/`: NO se versiona, así que el iMac empieza con
   estado vacío salvo que se copie a mano. **Copiar `data/` es parte de la
   migración o se pierde el registro de la validación.**

**Por qué importa:** no hay historial del código, no se puede revertir un cambio
malo ni ver qué cambió entre dos días. Los `.bak` respaldan **datos**, no
código, y guardan una sola versión anterior. El 2026-08-23 se tocó el camino del
dinero cinco veces con los 51 tests como única red.

**Nota:** `git init` local ya da historial y revert sin necesidad de cuenta. El
remoto puede llegar después con `git remote add` sin perder nada.

### iMac 24/7

**Estado:** acordado, pospuesto por Jorge.

**Medido:** 95,3 h ciegas de 120 en los primeros 5 días (79%); en las últimas
48 h de esa medición, 91%. Los peores huecos son de madrugada, con el Mac
durmiendo.

**Mitigaciones ya aplicadas:** reconstrucción de cierres desde velas de 1 minuto
(repara el registro), detección de despertar con aviso, y el monitor escribiendo
la serie cada 15 min.

**Pendiente asociado:** `caffeinate` en `run-server.sh` reduciría la ceguera
mientras tanto — se dejó para hacerlo junto con la migración.

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
