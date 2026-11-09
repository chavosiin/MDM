# iniciar.ps1 - sobe o Headwind MDM (Postgres + servidor) via Docker Compose
Set-Location "$PSScriptRoot\.."

if (-not (Test-Path .env)) {
    Write-Host "Arquivo .env não encontrado. Copiando .env.example -> .env" -ForegroundColor Yellow
    Copy-Item .env.example .env
    Write-Host "Edite o .env (BASE_DOMAIN, LOCAL_IP, ADMIN_EMAIL, senhas) e rode este script de novo." -ForegroundColor Yellow
    exit 1
}

docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha ao subir os containers. Verifique se o Docker Desktop está rodando." -ForegroundColor Red
    exit 1
}

Write-Host "Subindo... aguardando o servidor inicializar (primeira vez pode levar alguns minutos)." -ForegroundColor Cyan
Start-Sleep -Seconds 8
docker compose logs --tail=40 hmdm

Write-Host ""
Write-Host "Quando o log parar de mostrar erros de inicialização, acesse o painel em:" -ForegroundColor Green
Write-Host "  http://<IP_DO_SEU_PC>:8080/   (o mesmo IP configurado em BASE_DOMAIN no .env)" -ForegroundColor Green
Write-Host "Login inicial: admin / admin (o sistema pede para trocar a senha)." -ForegroundColor Green
Write-Host ""
Write-Host "Para acompanhar os logs em tempo real: .\scripts\logs.ps1" -ForegroundColor DarkGray
