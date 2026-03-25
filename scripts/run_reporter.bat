@echo off
title ARIS PC Status Reporter
echo ====================================
echo   ARIS PC Status Reporter
echo ====================================
echo.

REM Vérifier si Python est installé
python --version >nul 2>&1
if errorlevel 1 (
    echo ERREUR: Python n'est pas installé!
    echo Veuillez installer Python 3
    pause
    exit /b 1
)

REM Lancer le script
python "%~dp0pc_status_reporter.py"

pause
