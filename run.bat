@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 18+ from https://nodejs.org first & pause & exit /b 1)
if not exist node_modules call npm install
call npm start
