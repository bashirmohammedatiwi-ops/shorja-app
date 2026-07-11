@echo off
setlocal
cd /d "%~dp0"

echo === Shorja — بناء تطبيقات Windows EXE ===

call npm install
if errorlevel 1 exit /b 1

echo.
echo [1/2] بناء تطبيق الإدارة...
cd desktop-admin
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
cd ..

echo.
echo [2/2] بناء تطبيق الفرع...
cd desktop-branch
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
cd ..

echo.
echo تم البناء بنجاح:
echo   desktop-admin\dist\Shorja-Admin-Setup-1.0.0.exe
echo   desktop-branch\dist\Shorja-Branch-Setup-1.0.0.exe
endlocal
