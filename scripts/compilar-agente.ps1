# compilar-agente.ps1 - compila o agente Android personalizado (pasta agente-android).
#
# Personalizações em relação ao app oficial do Headwind MDM:
#   - sem os 3 botões laterais (chave, info, atualização)
#   - envia a localização ao portal a cada ~1 minuto
#
# Lê do .env: APK_KEYSTORE, APK_KEYSTORE_PASS, PORTAL_SECRET e (opcional) MDM_LOCATION_URL.
# Gera: apk\mdm-agente.apk
#
# Uso:
#   .\scripts\compilar-agente.ps1

$ErrorActionPreference = "Stop"
$raiz = Split-Path $PSScriptRoot -Parent

$cfg = @{}
Get-Content (Join-Path $raiz ".env") -Encoding UTF8 | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $p = $_ -split '=', 2
    $cfg[$p[0].Trim()] = $p[1].Trim()
}
foreach ($n in "APK_KEYSTORE", "APK_KEYSTORE_PASS", "PORTAL_SECRET") {
    if (-not $cfg[$n]) { throw "Variável $n não definida no .env" }
}

$env:APK_KEYSTORE = Join-Path $raiz $cfg["APK_KEYSTORE"]
$env:APK_KEYSTORE_PASS = $cfg["APK_KEYSTORE_PASS"]
$env:PORTAL_SECRET = $cfg["PORTAL_SECRET"]
$env:MDM_LOCATION_URL = $cfg["MDM_LOCATION_URL"]
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = "C:\Program Files\Java\jdk-23" }

Push-Location (Join-Path $raiz "agente-android")
try {
    & .\gradlew.bat --no-daemon assembleOpensourceRelease
    if ($LASTEXITCODE -ne 0) { throw "Falha na compilação (código $LASTEXITCODE)" }
}
finally { Pop-Location }

$saida = Join-Path $raiz "apk"
New-Item -ItemType Directory -Force $saida | Out-Null
$apk = Get-ChildItem (Join-Path $raiz "agente-android\app\build\outputs\apk\opensource\release\*.apk") | Select-Object -First 1
Copy-Item $apk.FullName (Join-Path $saida "mdm-agente.apk") -Force

# Checksum exigido no QR code de cadastro (SHA-256 da assinatura, em Base64 URL-safe)
$jks = $env:APK_KEYSTORE
$keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
$sha = (& $keytool -list -v -keystore $jks -alias mdm -storepass $env:APK_KEYSTORE_PASS |
        Select-String "SHA256:").ToString().Split(":", 2)[1].Trim().Replace(":", "")
$bytes = [byte[]]::new($sha.Length / 2)
for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($sha.Substring($i * 2, 2), 16) }
$checksum = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

Write-Host ""
Write-Host "APK gerado: $saida\mdm-agente.apk" -ForegroundColor Green
Write-Host "Checksum da assinatura (para o QR code): $checksum" -ForegroundColor Cyan
