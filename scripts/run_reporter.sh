#!/bin/bash
# ARIS PC Status Reporter - Lancement Linux

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$HOME/.aris-reporter/config.json"

echo "===================================="
echo "  ARIS PC Status Reporter"
echo "===================================="
echo ""

# Vérifier si Python3 est installé
if ! command -v python3 &> /dev/null; then
    echo "ERREUR: Python3 n'est pas installé!"
    echo "Installez: sudo apt install python3"
    exit 1
fi

# Lancer le script
python3 "$SCRIPT_DIR/pc_status_reporter.py"
