@echo off
REM TestSnapper - Create Chrome Web Store Release ZIP
REM Run this after npm run build

echo ========================================
echo TestSnapper v1.1.4 - Release Packager
echo ========================================
echo.

REM Check if dist folder exists
if not exist "dist\" (
    echo ERROR: dist/ folder not found!
    echo Please run: npm run build
    pause
    exit /b 1
)

REM Check if libs are downloaded
if not exist "dist\libs\docx.min.js" (
    echo ERROR: Libraries not found in dist/libs/
    echo Please run: npm run setup-libs
    pause
    exit /b 1
)

echo Verifying dist/ contents...
echo.

REM Check required files
set "MISSING=0"

if not exist "dist\manifest.json" (
    echo   [MISSING] manifest.json
    set "MISSING=1"
) else (
    echo   [OK] manifest.json
)

if not exist "dist\src\background\background.js" (
    echo   [MISSING] src/background/background.js
    set "MISSING=1"
) else (
    echo   [OK] src/background/background.js
)

if not exist "dist\libs\docx.min.js" (
    echo   [MISSING] libs/docx.min.js
    set "MISSING=1"
) else (
    echo   [OK] libs/docx.min.js
)

if not exist "dist\libs\html2pdf.bundle.min.js" (
    echo   [MISSING] libs/html2pdf.bundle.min.js
    set "MISSING=1"
) else (
    echo   [OK] libs/html2pdf.bundle.min.js
)

if "%MISSING%"=="1" (
    echo.
    echo ERROR: Required files are missing!
    echo Please run: npm run build
    pause
    exit /b 1
)

echo.
echo All required files present!
echo.

REM Create release folder name with timestamp
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YMD=%dt:~0,8%"
set "HMS=%dt:~8,6%"
set "RELEASE_NAME=testsnapper-v1.1.4-%YMD%-%HMS%"
set "RELEASE_ZIP=%RELEASE_NAME%.zip"

echo Creating ZIP: %RELEASE_ZIP%
echo.

REM Remove old zip if exists
if exist "%RELEASE_ZIP%" (
    del "%RELEASE_ZIP%"
)

REM Create ZIP using PowerShell (built-in on Windows)
powershell -Command "Compress-Archive -Path 'dist\*' -DestinationPath '%RELEASE_ZIP%' -Force"

if exist "%RELEASE_ZIP%" (
    echo.
    echo ========================================
    echo SUCCESS! Release package created:
    echo %RELEASE_ZIP%
    echo ========================================
    echo.
    echo File location: %CD%\%RELEASE_ZIP%
    echo.
    echo Next steps:
    echo 1. Go to: https://chrome.google.com/webstore/devconsole
    echo 2. Click "Upload new package"
    echo 3. Select: %RELEASE_ZIP%
    echo 4. Fill in store listing details
    echo 5. Submit for review
    echo.
) else (
    echo.
    echo ERROR: Failed to create ZIP file
    pause
    exit /b 1
)

pause
