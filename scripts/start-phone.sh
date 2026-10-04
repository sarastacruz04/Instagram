#!/bin/bash
# Arranca Metro accesible desde el celular.
# WSL usa red NAT: el teléfono no ve la IP 172.x de WSL, por eso usamos --tunnel.
# Ejecutar DENTRO de WSL:  bash scripts/start-phone.sh
cd "$(dirname "$0")/.." || exit 1
npx expo start --tunnel --clear
