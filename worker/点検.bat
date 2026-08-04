@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo AIアプリの点検を開始します。1分ほどかかります。
echo.
node health-check.mjs
echo.
pause
