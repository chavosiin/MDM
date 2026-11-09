# backup.ps1 - gera um backup do banco (dump PostgreSQL) e dos arquivos enviados
# (APKs, ícones, etc. em volumes\work). Uso: .\scripts\backup.ps1
param(
    [string]$Destino = "$PSScriptRoot\..\backups"
)

Set-Location "$PSScriptRoot\.."

if (-not (Test-Path .env)) {
    Write-Host ".env não encontrado - rode scripts\iniciar.ps1 primeiro." -ForegroundColor Red
    exit 1
}

# Carrega variáveis do .env (SQL_USER, SQL_BASE) para esta sessão
Get-Content .env | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $parts = $_ -split '=', 2
    Set-Item -Path "env:$($parts[0].Trim())" -Value $parts[1].Trim() -ErrorAction SilentlyContinue
}

$carimbo = Get-Date -Format "yyyyMMdd-HHmmss"
$pasta = Join-Path $Destino $carimbo
New-Item -ItemType Directory -Force -Path $pasta | Out-Null

Write-Host "Gerando dump do banco PostgreSQL..." -ForegroundColor Cyan
# Gera o dump dentro do container e copia com docker cp: evita que o pipe do PowerShell
# altere a codificação (BOM/CRLF/acentos) do arquivo.
# --clean --if-exists: o restore apaga e recria os objetos, em vez de duplicar dados.
docker compose exec -T postgresql pg_dump --clean --if-exists -U $env:SQL_USER -f /tmp/hmdm.sql $env:SQL_BASE
if ($LASTEXITCODE -eq 0) { docker compose cp postgresql:/tmp/hmdm.sql "$pasta\hmdm.sql" }
if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha ao gerar o dump. Os containers estão rodando? (docker compose ps)" -ForegroundColor Red
    exit 1
}

Write-Host "Copiando arquivos enviados (volumes\work)..." -ForegroundColor Cyan
if (Test-Path ".\volumes\work") {
    Copy-Item -Recurse -Force ".\volumes\work" "$pasta\work"
}

# Chave que assina o agente personalizado: sem ela não dá para atualizar o app nos celulares
if (Test-Path ".\assinatura-apk") {
    Write-Host "Copiando chave de assinatura do agente (assinatura-apk)..." -ForegroundColor Cyan
    Copy-Item -Recurse -Force ".\assinatura-apk" "$pasta\assinatura-apk"
    Copy-Item -Force ".\.env" "$pasta\.env"
}

Write-Host "Backup salvo em: $pasta" -ForegroundColor Green
