#!/bin/bash
# Derkenar Mac uygulamasını derler (macOS gerekir). Çıktı: mac-app/build/Derkenar.app ve Derkenar-mac.zip
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build && mkdir -p build

for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12.0" main.swift -o "build/Derkenar-$arch"
done
lipo -create build/Derkenar-arm64 build/Derkenar-x86_64 -output build/Derkenar

echo "== kendi kendini sınama =="
build/Derkenar --self-test

APP=build/Derkenar.app
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp build/Derkenar "$APP/Contents/MacOS/Derkenar"
cp Info.plist "$APP/Contents/Info.plist"

# Simge: web uygulamasının simgesinden üretilir (başarısız olursa simgesiz devam eder).
if ICON=../web/public/icon-512.png && [ -f "$ICON" ]; then
  SET=build/Derkenar.iconset && mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICON" --out "$SET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d "$ICON" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/Derkenar.icns" || echo "simge üretilemedi"
fi

codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$APP"
(cd build && ditto -c -k --keepParent Derkenar.app Derkenar-mac.zip)
ls -la build/Derkenar-mac.zip
lipo -archs build/Derkenar
