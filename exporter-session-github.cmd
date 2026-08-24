@echo off
chcp 65001 >nul
title WikiMasters - Exporter la session GitHub
cd /d "%~dp0"
if not exist "node_modules\playwright-core" (
  echo Installation des dependances...
  call npm.cmd ci --omit=dev
  if errorlevel 1 goto :error
)
node.exe exporter-session-github.js
if errorlevel 1 goto :error
start "" "https://github.com/TheLightningD/wikimasters-a-trier/settings/secrets/actions/new"
echo.
echo Nom du secret : WIKIMASTERS_SESSION_B64
echo Sa valeur est deja dans le presse-papiers : collez-la dans GitHub.
pause
exit /b 0
:error
echo.
echo Export de session echoue.
pause
exit /b 1
