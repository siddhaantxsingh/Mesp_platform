@echo off
setlocal
rem Double-click to run the MESP platform on this computer (website + server at http://localhost:8000).
cd /d "%~dp0"
if not exist "scripts\local\run_local.py" cd /d "%~dp0..\.."
title MESP platform - keep this window open

set PY=python
where py >nul 2>&1 && set PY=py -3

if not exist ".venv\installed.ok" (
  echo.
  echo  First start: installing what the platform needs. This needs internet and takes a few minutes.
  echo.
  if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv || goto :nopython
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -e packages\protocol\python -e replay -e simulator -e services\gateway -e apps\api || goto :fail
  echo ok> ".venv\installed.ok"
)

set MESP_NO_BROWSER=1
rem open Chrome once the server has had a few seconds to start (Bluetooth/USB buttons need Chrome or Edge)
start "" /min cmd /c "timeout /t 6 >nul & start chrome http://localhost:8000/login"
".venv\Scripts\python.exe" scripts\local\run_local.py
echo.
echo The platform has stopped.
pause
exit /b

:nopython
echo.
echo Python was not found. Install Python 3.11 or newer from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then double-click this file again.
pause
exit /b 1

:fail
echo.
echo Installing failed. Check the internet connection and double-click this file again.
pause
exit /b 1
