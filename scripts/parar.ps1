# parar.ps1 - para os containers sem apagar dados (volumes ficam intactos)
Set-Location "$PSScriptRoot\.."
docker compose stop
