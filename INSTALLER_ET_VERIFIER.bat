@echo off
setlocal
cd /d "%~dp0"
for %%D in (Frosti_V1.3.1 Cellio_V1.2.1 Mealio_V1.3.1) do (
  pushd "%%D"
  call npm ci
  if errorlevel 1 goto :fail
  if "%%D"=="Mealio_V1.3.1" (call npm run verify:production) else (call npm run verify)
  if errorlevel 1 goto :fail
  popd
)
echo Verification terminee. Lire LIRE_EN_PREMIER.md pour les migrations SQL.
exit /b 0
:fail
echo Echec : corriger l'erreur affichee avant de continuer.
exit /b 1
