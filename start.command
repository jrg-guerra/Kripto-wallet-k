#!/bin/zsh
# Kripto Wallet — doble clic para arrancar el dashboard
cd "$(dirname "$0")"
./run-server.sh &
SERVER_PID=$!
sleep 1
open "http://localhost:8517"
echo "Kripto Wallet corriendo en http://localhost:8517 — cierra esta ventana para detenerlo."
wait $SERVER_PID
