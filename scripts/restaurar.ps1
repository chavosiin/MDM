# restaurar.ps1 - restaura um backup gerado por backup.ps1
# Uso: .\scripts\restaurar.ps1 -Pasta ".\backups\20260911-093000"
# ATENÇÃO: isso sobrescreve o banco de dados atual. Confirme a pasta antes de rodar.
param(
    [Parameter(Mandatory = $true)]
    [string]$Pasta
)

Set-Location "$PSScriptRoot\.."

if (-not (Test-Path $Pasta)) {
    Write-Host "Pasta de backup não encontrada: $Pasta" -ForegroundColor Red
    exit 1
}
$dump = Join-Path $Pasta "hmdm.sql"
if (-not (Test-Path $dump)) {
    Write-Host "Arquivo hmdm.sql não encontrado em $Pasta" -ForegroundColor Red
    exit 1
}

Get-Content .env | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
    $parts = $_ -split '=', 2
    Set-Item -Path "env:$($parts[0].Trim())" -Value $parts[1].Trim() -ErrorAction SilentlyContinue
}

Write-Host "Isso vai SOBRESCREVER o banco de dados atual com o conteúdo de: $dump" -ForegroundColor Yellow
$confirma = Read-Host "Digite CONFIRMAR para continuar"
if ($confirma -ne "CONFIRMAR") {
    Write-Host "Cancelado." -ForegroundColor Yellow
    exit 0
}

Write-Host "Parando o servidor hmdm (mantendo o banco no ar)..." -ForegroundColor Cyan
docker compose stop hmdm

Write-Host "Restaurando dump..." -ForegroundColor Cyan
# Copia o arquivo para dentro do container e restaura com psql -f (sem passar pelo pipe do
# PowerShell, que corromperia acentos). ON_ERROR_STOP interrompe no primeiro erro.
docker compose cp $dump postgresql:/tmp/restore.sql
docker compose exec -T postgresql psql -v ON_ERROR_STOP=1 -U $env:SQL_USER -d $env:SQL_BASE -f /tmp/restore.sql
if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha na restauração (veja o erro acima). O servidor hmdm continua parado." -ForegroundColor Red
    exit 1
}

$pastaWork = Join-Path $Pasta "work"
if (Test-Path $pastaWork) {
    Write-Host "Restaurando arquivos enviados (volumes\work)..." -ForegroundColor Cyan
    Copy-Item -Recurse -Force "$pastaWork\*" ".\volumes\work\"
}

Write-Host "Subindo o servidor novamente..." -ForegroundColor Cyan
docker compose up -d hmdm

Write-Host "Restauração concluída." -ForegroundColor Green
