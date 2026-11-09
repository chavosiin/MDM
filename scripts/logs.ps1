# logs.ps1 - acompanha os logs do servidor Headwind MDM em tempo real (Ctrl+C para sair)
Set-Location "$PSScriptRoot\.."
docker compose logs -f hmdm
