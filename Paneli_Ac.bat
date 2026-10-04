@echo off
chcp 65001 >nul
title Servis Takip - Yönetim Paneli
cd /d "%~dp0"

echo.
echo  ==========================================
echo    Servis Takip - Yönetim Paneli
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

if not exist "node_modules\" (
  echo  İlk çalıştırma: gerekli paketler kuruluyor, birkaç dakika sürebilir...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [HATA] Paketler kurulamadı. Yukarıdaki hatayı Claude'a iletin.
    pause
    exit /b 1
  )
)

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
