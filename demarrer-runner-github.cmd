@echo off
chcp 65001 >nul
title WikiMasters - Runner GitHub
set "runner=%LOCALAPPDATA%\WikiMasters-A-Trier\actions-runner\run.cmd"
if not exist "%runner%" (
  echo Runner absent. Lancez d abord installer-runner-github.ps1.
  pause
  exit /b 1
)
echo Runner GitHub WikiMasters actif.
echo Laissez cette fenetre ouverte pour les executions planifiees.
echo.
call "%runner%"
set "code=%ERRORLEVEL%"
echo.
echo Runner arrete avec le code %code%.
pause
exit /b %code%
