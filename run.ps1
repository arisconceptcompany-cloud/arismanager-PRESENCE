# PresenceAris - Script de demarrage (contourne la politique d'execution)
$nodePath = "C:\Program Files\nodejs"
if (-not $env:Path.StartsWith("$nodePath;")) { $env:Path = "$nodePath;$env:Path" }
# Utiliser npm.cmd au lieu de npm pour eviter npm.ps1 bloque
& "$nodePath\npm.cmd" @args
