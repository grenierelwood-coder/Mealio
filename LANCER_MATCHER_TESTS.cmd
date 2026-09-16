@echo off
setlocal
cd /d "%~dp0"
call scripts\run-matcher-lab.cmd
exit /b %ERRORLEVEL%
