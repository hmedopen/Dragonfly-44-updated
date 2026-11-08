@echo off
echo Stopping Folio Script background engine...
powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"
echo Stopped.
