@echo off
chcp 65001 >nul
title WikiMasters - Synchroniser les échanges
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0wishlist-local.ps1"
set "code=%ERRORLEVEL%"
echo.
if "%code%"=="0" (
  echo Résultat : succès.
  echo Appuyez sur une touche pour fermer.
) else (
  echo Résultat : échec ^(code %code%^).
  echo L'étape et la cause sont affichées ci-dessus.
)
pause >nul
exit /b %code%
