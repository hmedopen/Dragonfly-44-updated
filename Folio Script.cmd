@echo off
title Folio Script Launcher
cd /d "%~dp0"

:: Start the background core server quietly
powershell -Command "if (!(Test-NetConnection -ComputerName 127.0.0.1 -Port 5173 -InformationLevel Quiet)) { Start-Process -FilePath 'node' -ArgumentList 'server.cjs' -WindowStyle Hidden }"

timeout /t 1 /nobreak >nul

:: Launch borderless native App Window
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app="http://127.0.0.1:5173/?v=fs5" --window-size=1280,820
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --app="http://127.0.0.1:5173/?v=fs5" --window-size=1280,820
) else if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="http://127.0.0.1:5173/?v=fs5" --window-size=1280,820
) else (
    start "" "http://127.0.0.1:5173/?v=fs5"
)
exit