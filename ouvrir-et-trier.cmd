@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0wishlist-local.ps1" -Full
set "code=%ERRORLEVEL%"
echo.
if not "%code%"=="0" echo Echec de l ouverture ou du tri.
pause
exit /b %code%
