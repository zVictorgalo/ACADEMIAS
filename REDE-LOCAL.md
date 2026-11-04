# Testar no celular pela mesma rede

O computador pode estar por cabo e o celular no Wi-Fi, desde que ambos estejam na mesma rede do roteador.

## O que foi alterado e por quê

- `iniciar-rede.ps1` inicia o servidor em `0.0.0.0:8000`. Isso permite conexões pelas interfaces IPv4 do computador; antes, um servidor ligado apenas a `127.0.0.1` aceitaria somente o próprio computador.
- O IPv4 informado entra em `ALLOWED_HOSTS` e `CSRF_TRUSTED_ORIGINS`. Assim o Django aceita esse endereço e os formulários enviados pelo celular, mantendo a proteção CSRF.
- `PUBLIC_BASE_URL` recebe o IP e a porta da rede para que o QR Code nunca aponte para o localhost do telefone.
- `DEBUG=0` evita páginas técnicas de erro. O script executa `collectstatic` e usa `--nostatic`: o WhiteNoise entrega o CSS versionado que os templates solicitam, mesmo com DEBUG desligado.
- O script usa HTTP na rede local. Use contas e dados de teste. Para disponibilizar comercialmente, configure HTTPS.
- A chave de sessão fica em `data/lan-secret.txt`, fora do Git. Nenhuma senha padrão foi adicionada ao código.
- O script não abre portas no roteador, não publica o site na internet e não altera o firewall.
- O modo Docker permanece restrito ao computador por padrão. O complemento `compose.lan.yaml` adiciona a porta 8001 nas interfaces de rede, somente quando escolhido explicitamente.

## Sem Docker, com Python instalado

Instale as dependências conforme o README. Descubra seu IPv4 com `ipconfig` e execute na pasta do projeto:

```powershell
.\iniciar-rede.ps1 -PythonExe .\.venv\Scripts\python.exe -LanIp 192.168.18.103
```

Substitua o IP pelo endereço atual do computador. O endereço identificado nesta sessão foi **192.168.18.103**, mas ele pode mudar ao reconectar à rede.

No celular: **http://192.168.18.103:8000**. Use “Sou novo na academia” para testar como aluno.

Para criar um administrador, em outro terminal, com a mesma chave:

```powershell
$env:SECRET_KEY = Get-Content .\data\lan-secret.txt -Raw
.\.venv\Scripts\python.exe manage.py createsuperuser
```

Para parar: `Ctrl+C` na janela do servidor. Para voltar a testar, execute o script novamente.

## Com Docker

No `.env`, configure o IP atual e a porta **8001**:

```dotenv
PUBLIC_BASE_URL=http://192.168.18.103:8001
ALLOWED_HOSTS=localhost,127.0.0.1,192.168.18.103
CSRF_TRUSTED_ORIGINS=http://localhost:8000,http://127.0.0.1:8000,http://localhost:8001,http://127.0.0.1:8001,http://192.168.18.103:8001
```

Depois:

```powershell
docker compose -f compose.yaml -f compose.lan.yaml up --build -d
```

No celular: **http://192.168.18.103:8001**.

Para encerrar o modo de rede:

```powershell
docker compose -f compose.yaml -f compose.lan.yaml down
```

Para voltar ao acesso exclusivo no computador, inicie apenas `docker compose up -d`, sem o complemento.

## Se o celular não abrir

1. Confirme o IP com `ipconfig` e se o computador continua ligado com o servidor ativo.
2. Teste o mesmo endereço no navegador do computador.
3. Verifique se o celular está no mesmo roteador, sem rede de convidados, VPN ou isolamento de clientes.
4. Se o Windows solicitar permissão para o Python, autorize apenas em sua rede privada confiável. Se houver bloqueio, crie nas configurações do Firewall uma regra de entrada TCP para a porta de teste (8000 sem Docker; 8001 com Docker), perfil privado e escopo de sub-rede local. Remova a regra quando terminar. O projeto não altera essas regras automaticamente.

O acesso HTTP verificado no computador não comprova, sozinho, que o firewall ou o roteador permitem o celular. A confirmação final é abrir a página no telefone.
