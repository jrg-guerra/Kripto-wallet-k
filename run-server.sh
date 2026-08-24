#!/bin/zsh
# Lanza el servidor resolviendo Node dinámicamente: usa la versión más nueva
# instalada por nvm (sobrevive a actualizaciones), con fallback al node del PATH.
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
[ -x "$NODE" ] || NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  echo "No se encontró Node.js — instálalo con nvm y vuelve a intentar." >&2
  exit 1
fi

# --- LOG PERSISTENTE ---------------------------------------------------------
#
# La salida se perdía al cerrar la ventana de Terminal. Los auto-stops, las
# alertas y las fallas del motor eran la única traza de lo que pasó mientras
# nadie miraba — y no quedaba ninguna. Ahora el dashboard puede decir SI el
# motor corrió (`/api/estado`); esto dice QUÉ hizo.
#
# `tee` en vez de solo redirigir: quien arranca desde Terminal sigue viendo
# todo en pantalla, y además queda escrito.
#
# Vive en data/ porque ya está en .gitignore: el log menciona activos y montos.
LOG="$DIR/data/servidor.log"
mkdir -p "$DIR/data"

# Rotación simple: sobre 2 MB, la corrida anterior pasa a .1 y se empieza de
# cero. Una sola generación alcanza — el histórico de verdad son movimientos.jsonl
# y alertas.jsonl, esto es diagnóstico.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2097152 ]; then
  mv -f "$LOG" "$LOG.1"
fi

echo "--- arranque $(date '+%Y-%m-%d %H:%M:%S') ---" >> "$LOG"
"$NODE" "$DIR/src/server.mjs" 2>&1 | tee -a "$LOG"
