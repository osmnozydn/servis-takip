@echo off
chcp 65001 >nul
title READY LIVE - Yönetim Paneli
cd /d "%~dp0"

echo.
echo  ==========================================
echo    READY LIVE - Yönetim Paneli
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [HATA] Node.js kurulu değil.
  echo  https://nodejs.org adresinden LTS sürümünü kurup tekrar deneyin.
  echo.
  pause
  exit /b 1
)

echo  Paketler kontrol ediliyor (güncelleme varsa kurulur)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo  [HATA] Paketler kurulamadı. Yukarıdaki hatayı Claude'a iletin.
  pause
  exit /b 1
)
echo.

echo  Site başlatılıyor. Tarayıcı birkaç saniye içinde açılacak.
echo  Adres: http://localhost:5173
echo.
echo  KAPATMAK İÇİN bu pencereyi kapatın.
echo.

start "" /min cmd /c "timeout /t 5 /nobreak >nul & start "" http://localhost:5173"
call npm run web

echo.
echo  Site durdu. Bir hata varsa yukarıdaki yazıyı Claude'a iletin.
pause
