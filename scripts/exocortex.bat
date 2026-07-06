@echo off
rem Exocortex launcher for Windows.
rem Starts the daemon in the background, launches the TUI,
rem and kills that daemon instance (by PID) when the TUI exits.

pushd "%~dp0"

set DAEMON_PID=
for /f %%i in ('powershell -NoProfile -Command "(Start-Process -FilePath '.\exocortexd.exe' -WindowStyle Hidden -PassThru).Id"') do set DAEMON_PID=%%i

timeout /t 2 /nobreak >nul

exocortex.exe

if defined DAEMON_PID (
    rem Graceful first; hidden console apps usually need the forced kill.
    taskkill /PID %DAEMON_PID% >nul 2>&1
    taskkill /F /PID %DAEMON_PID% >nul 2>&1
)

popd
