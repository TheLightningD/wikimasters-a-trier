@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0wishlist-local.ps1"
set "code=%ERRORLEVEL%"
echo.
if not "%code%"=="0" echo Echec de la synchronisation.
pause
exit /b %code%
