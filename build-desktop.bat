@echo off
setlocal
cd /d "%~dp0"

echo === Shorja — بناء تطبيقات Windows EXE ===

call npm install
if errorlevel 1 exit /b 1

echo.
echo [1/3] بناء تطبيق الشورجة...
cd desktop-admin
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
cd ..

echo.
echo [2/3] بناء تطبيق المندوبين...
cd desktop-delegate
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
cd ..

echo.
echo [3/3] بناء تطبيق نقطة البيع...
cd desktop-branch
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
cd ..

echo.
echo تم البناء بنجاح.
endlocal
