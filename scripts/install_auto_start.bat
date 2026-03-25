@echo off
title ARIS PC Status Reporter - Installation
echo ====================================
echo   ARIS PC Status Reporter - Auto-start
echo ====================================
echo.

REM Vérifier si le script est déjà dans le démarrage
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ARIS_PC_Reporter >nul 2>&1
if %errorlevel%==0 (
    echo L'auto-démarrage est déjà configuré!
    echo.
    echo Pour supprimer:
    echo   Windows + R ^> shell:startup ^> Supprimer "ARIS_PC_Reporter"
    goto :end
)

REM Ajouter au démarrage Windows
echo Ajout de l'auto-démarrage...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v ARIS_PC_Reporter /t REG_SZ /d "python \"%~dp0pc_status_reporter.py\"" /f >nul 2>&1

if %errorlevel%==0 (
    echo.
    echo Auto-démarrage configuré avec succès!
    echo Le script se lancera après chaque démarrage.
) else (
    echo.
    echo Erreur lors de la configuration!
)

:end
echo.
echo Pour tester maintenant: run_reporter.bat
pause
