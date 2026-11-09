# publicar-agente.ps1 - publica o apk\mdm-agente.apk no servidor Headwind como nova versão
# do app "Headwind MDM" (com.hmdm.launcher) e coloca essa versão em todas as políticas.
# Os celulares com o agente personalizado se atualizam sozinhos na próxima sincronização.
#
# Passos (mesmas chamadas que o painel faz ao "adicionar versão"):
#   1. Envia o APK (POST /rest/private/web-ui-files)
#   2. Cria a versão (PUT /rest/private/applications/versions)
#   3. Instala a versão em todas as políticas que já têm o app
#   4. Grava o checksum do APK em Base64 URL-safe (o painel deixa vazio, e o QR code precisa dele)
#   5. Com -RemoverAnteriores, apaga as versões antigas do app no servidor
#
# Uso:
#   .\scripts\compilar-agente.ps1
#   .\scripts\publicar-agente.ps1 -RemoverAnteriores

param([switch]$RemoverAnteriores)

$ErrorActionPreference = "Stop"
$raiz = Split-Path $PSScriptRoot -Parent

$cfg = @{}
Get-Content (Join-Path $raiz ".env") -Encoding UTF8 | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $p = $_ -split '=', 2
    $cfg[$p[0].Trim()] = $p[1].Trim()
}
$url = $cfg["MDM_API_URL"].TrimEnd('/')
$apk = Join-Path $raiz "apk\mdm-agente.apk"
if (-not (Test-Path $apk)) { throw "APK não encontrado: rode antes .\scripts\compilar-agente.ps1" }

# --- Login ---
$md5 = [Security.Cryptography.MD5]::Create()
$hash = -join ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($cfg["MDM_API_PASS"])) | ForEach-Object { $_.ToString("X2") })
$token = (Invoke-RestMethod -Uri "$url/rest/public/jwt/login" -Method Post -ContentType "application/json" `
        -Body (@{ login = $cfg["MDM_API_USER"]; password = $hash } | ConvertTo-Json)).id_token
$headers = @{ Authorization = "Bearer $token" }

function Api($metodo, $caminho, $corpo) {
    $req = @{ Uri = "$url/rest$caminho"; Method = $metodo; Headers = $headers; ContentType = "application/json; charset=utf-8" }
    if ($null -ne $corpo) { $req.Body = [Text.Encoding]::UTF8.GetBytes(($corpo | ConvertTo-Json -Depth 10 -Compress)) }
    $r = Invoke-RestMethod @req
    if ($r.status -ne "OK") { throw "API $caminho retornou $($r.status): $($r.message)" }
    return $r.data
}

# --- 1. Envio do arquivo ---
# O nome precisa ser único: ao apagar uma versão antiga, o servidor apaga o arquivo dela, e se
# o nome fosse o mesmo, apagaria junto o APK da versão nova (aconteceu em 20/10/2026).
$nomeArquivo = "mdm-agente-$(Get-Date -Format 'yyyyMMdd-HHmmss').apk"
Add-Type -AssemblyName System.Net.Http
$cliente = New-Object System.Net.Http.HttpClient
$cliente.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $token)
$conteudo = New-Object System.Net.Http.MultipartFormDataContent
$bytes = [IO.File]::ReadAllBytes($apk)
$arquivo = New-Object System.Net.Http.ByteArrayContent(, $bytes)
$conteudo.Add($arquivo, "file", $nomeArquivo)
$resposta = $cliente.PostAsync("$url/rest/private/web-ui-files", $conteudo).Result
$envio = $resposta.Content.ReadAsStringAsync().Result | ConvertFrom-Json
if ($envio.status -ne "OK") { throw "Falha no envio do APK: $($envio.message)" }
$det = $envio.data.fileDetails
if ($det.pkg -ne "com.hmdm.launcher") { throw "O APK não é do pacote com.hmdm.launcher ($($det.pkg))" }
$appId = $envio.data.application.id
Write-Host "APK enviado: versão $($det.version) (código $($det.versionCode))" -ForegroundColor Cyan

# --- 2. Cria a versão ---
$versao = Api Put "/private/applications/versions" @{
    system = $false; applicationId = $appId; arch = $null; pkg = $det.pkg; name = "Headwind MDM"
    version = $det.version; versionCode = $det.versionCode; filePath = $envio.data.serverPath
}
Write-Host "Versão criada no servidor (id $($versao.id))" -ForegroundColor Cyan

# --- 3. Coloca a versão em todas as políticas ---
$links = Api Get "/private/applications/version/$($versao.id)/configurations" $null
foreach ($l in $links) { $l.action = 1; $l.notify = $true }
Api Post "/private/applications/version/configurations" @{ applicationVersionId = $versao.id; configurations = @($links) } | Out-Null
Write-Host "Versão aplicada em $(@($links).Count) política(s)" -ForegroundColor Cyan

# --- 4. Checksum URL-safe para o QR code ---
$sha = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
$checksum = [Convert]::ToBase64String($sha).TrimEnd('=').Replace('+', '-').Replace('/', '_')
docker exec mdm-postgresql-1 psql -U $cfg["SQL_USER"] -d $cfg["SQL_BASE"] -q -c "UPDATE applicationversions SET apkhash = '$checksum' WHERE id = $($versao.id)"
if ($LASTEXITCODE -ne 0) { throw "Falha ao gravar o checksum no banco" }

# --- 5. Remove versões anteriores ---
if ($RemoverAnteriores) {
    $todas = Api Get "/private/applications/$appId/versions" $null
    # Nunca apaga uma versão que aponte para o mesmo arquivo da nova
    foreach ($v in $todas | Where-Object { $_.id -ne $versao.id -and $_.url -ne $versao.url }) {
        Api Delete "/private/applications/versions/$($v.id)" $null | Out-Null
        Write-Host "Versão antiga removida: $($v.version)" -ForegroundColor Yellow
    }
}

# --- 6. Confere se o APK publicado pode ser baixado (é o que os celulares fazem) ---
$urlApk = if ($versao.url) { $versao.url } else { "$url/files/$nomeArquivo" }
$baixar = Invoke-WebRequest -Uri $urlApk -Method Head -UseBasicParsing
if ($baixar.StatusCode -ne 200) { throw "O APK publicado não pode ser baixado em $urlApk" }

Write-Host "Publicado: Headwind MDM $($det.version). Os celulares atualizam na próxima sincronização." -ForegroundColor Green
