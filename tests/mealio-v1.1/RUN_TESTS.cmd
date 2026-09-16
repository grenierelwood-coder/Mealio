@echo off
setlocal
cd /d "%~dp0\..\.."

echo ============================================================
echo MEALIO V1.1 - CAMPAGNES DE TESTS
echo ============================================================
echo.

if "%MEALIO_BASE_URL%"=="" set MEALIO_BASE_URL=http://localhost:3000

echo [2] Agregation / unites
call npx vitest run tests/mealio-v1.1/02_aggregation_unit_safety.test.ts
if errorlevel 1 goto :fail

echo.
echo [3] Stock multi-lignes
call npx vitest run tests/mealio-v1.1/03_stock_multiline.test.ts
if errorlevel 1 goto :fail

if "%MEALIO_COOKIE%"=="" (
  echo.
  echo [1] et [6] ignorees : MEALIO_COOKIE absent.
  echo Definissez MEALIO_COOKIE pour les tests HTTP.
  goto :done
)

echo.
echo [1] Matcher Lab
powershell -NoProfile -ExecutionPolicy Bypass -File tests/mealio-v1.1/01_matcher_lab.ps1
if errorlevel 1 goto :fail

echo.
echo [6] Reapprovisionnement
powershell -NoProfile -ExecutionPolicy Bypass -File tests/mealio-v1.1/06_replenishment.ps1
if errorlevel 1 goto :fail

:done
echo.
echo ============================================================
echo CAMPAGNES NON DESTRUCTIVES TERMINEES
echo ============================================================
echo.
echo Pour la campagne Courses :
echo   RUN_TESTS.cmd -IntegrationCourses
echo.
echo Pour la consommation :
echo   RUN_TESTS.cmd -IntegrationConsumption
echo.
exit /b 0

:fail
echo.
echo ============================================================
echo ECHEC D'UNE CAMPAGNE
echo ============================================================
exit /b 1
