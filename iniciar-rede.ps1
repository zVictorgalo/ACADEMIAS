param(
    [string]$PythonExe = 'python',
    [Parameter(Mandatory = $true)][string]$LanIp,
    [int]$Port = 8000
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Este script inicia APENAS um servidor de teste na rede local, sem Docker.
# LanIp deve ser o IPv4 do computador mostrado em ipconfig (ex.: 192.168.18.103).
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($LanIp, [ref]$parsedAddress) -or
    $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'Informe um endereço IPv4 válido em -LanIp.'
}
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Use uma porta entre 1024 e 65535.' }

# Evita abrir uma segunda versão na mesma porta e acabar vendo o servidor antigo.
& $PythonExe -c "import socket,sys; s=socket.socket(); s.settimeout(1); busy=s.connect_ex(('127.0.0.1',int(sys.argv[1])))==0; s.close(); sys.exit(3 if busy else 0)" $Port
if ($LASTEXITCODE -eq 3) {
    throw "A porta $Port já está em uso. Pare o servidor anterior no terminal com Ctrl+C e execute novamente."
}
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível verificar a porta. Confira o caminho do Python.' }

# A chave permanece entre reinícios em data/, que está fora do Git e do ZIP de entrega.
# Não use esta configuração HTTP de demonstração como configuração de produção.
$runtimeDir = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$secretFile = Join-Path $runtimeDir 'lan-secret.txt'
if (-not (Test-Path -LiteralPath $secretFile)) {
    $secretValue = & $PythonExe -c 'import secrets; print(secrets.token_hex(32))'
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível executar o Python.' }
    [System.IO.File]::WriteAllText($secretFile, $secretValue.Trim())
}
$env:SECRET_KEY = [System.IO.File]::ReadAllText($secretFile).Trim()
$env:DEBUG = '0'
$env:PYTHONUNBUFFERED = '1'
# Lista explícita dos nomes/IPs aceitos: evitamos usar ALLOWED_HOSTS=*.
$env:ALLOWED_HOSTS = "localhost,127.0.0.1,$LanIp"
# O QR precisa apontar para o IP da rede, nunca para localhost do telefone.
$env:PUBLIC_BASE_URL = "http://${LanIp}:$Port"
# Incluímos o endereço da rede na validação CSRF para aceitar login e formulários do celular.
$env:CSRF_TRUSTED_ORIGINS = "http://localhost:$Port,http://127.0.0.1:$Port,http://${LanIp}:$Port"
# HTTP apenas para o teste local. Produção precisa de HTTPS e cookies seguros.
$env:SECURE_COOKIES = '0'
$env:SECURE_SSL_REDIRECT = '0'
& $PythonExe manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar o banco.' }
# Gera também o CSS com nome versionado usado nos templates quando DEBUG=0.
# Sem esta coleta, a página pode solicitar style.<hash>.css e ficar sem estilo.
& $PythonExe manage.py collectstatic --noinput
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar o CSS e os arquivos estáticos.' }
Write-Host "No celular, conectado ao mesmo roteador: http://${LanIp}:$Port"
Write-Host 'Mantenha esta janela aberta. Use Ctrl+C para encerrar.'
# 0.0.0.0 faz o processo ouvir nas interfaces IPv4, além de localhost.
# --nostatic deixa o WhiteNoise servir os arquivos coletados, inclusive o CSS versionado.
# O servidor estático de desenvolvimento procuraria o nome versionado na pasta-fonte.
# --noreload evita processos extras. O script não altera o firewall nem o roteador.
& $PythonExe manage.py runserver "0.0.0.0:$Port" --noreload --nostatic
