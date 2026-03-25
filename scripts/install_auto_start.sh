#!/bin/bash
# Installation automatique au démarrage - Linux

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/pc_status_reporter.py"
CRON_CMD="@reboot sleep 10 && /usr/bin/python3 $PYTHON_SCRIPT >> $HOME/.aris-reporter/reporter.log 2>&1"

echo "========================================"
echo "  ARIS PC Status Reporter - Auto-start"
echo "========================================"
echo ""

# Vérifier si déjà configuré
if crontab -l 2>/dev/null | grep -q "pc_status_reporter.py"; then
    echo "L'auto-démarrage est déjà configuré!"
    echo "Pour supprimer: crontab -e (et supprimez la ligne)"
else
    # Ajouter au crontab
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
    echo "Auto-démarrage configuré avec succès!"
    echo ""
    echo "Le script se lancera automatiquement après chaque redémarrage."
    echo ""
    echo "Logs: $HOME/.aris-reporter/reporter.log"
fi

echo ""
echo "Pour tester maintenant: ./run_reporter.sh"
