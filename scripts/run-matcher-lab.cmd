@echo off
setlocal
cd /d "%~dp0.."
echo.
echo ========================================
echo   MEALIO - MATCHER TEST LAB V33.1
echo ========================================
echo.
call npx --yes tsx scripts/run-matcher-lab.ts
set EXITCODE=%ERRORLEVEL%
echo.
echo ========================================
if %EXITCODE% EQU 0 (
  echo TESTS TERMINES : PASS
) else (
  echo TESTS TERMINES : ECHEC - voir test-reports\
)
echo ========================================
echo.
pause
exit /b %EXITCODE%
