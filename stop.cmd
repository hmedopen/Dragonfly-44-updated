@echo off
echo Stopping Dragonfly 44 background engine...
powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force"
echo Stopped.
