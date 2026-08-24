@echo off
chcp 65001 >nul
title WikiMasters - Installer le runner GitHub
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-runner-github.ps1"
set "code=%ERRORLEVEL%"
echo.
if "%code%"=="0" (
  echo Installation terminee. Lancez demarrer-runner-github.cmd.
) else (
  echo Installation du runner echouee. Consultez le detail ci-dessus.
)
pause
exit /b %code%
