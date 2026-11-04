# Pulso · Academia com ID, PIN e entrada por QR Code

Aplicação em Python/Django, interface responsiva em português, banco SQLite e Docker. Uma academia por instalação. Sem cobrança ou integração financeira.

Para entender a função de cada arquivo, leia **[GUIA-ARQUIVOS.md](GUIA-ARQUIVOS.md)**.

Para publicar a versão online, configurar secrets e importar seus cadastros, siga **[DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md)**.

## Como funciona agora

- O aluno se cadastra com nome, e-mail e **PIN de 4 a 32 números**. Não escolhe nome de usuário: o sistema gera um **ID numérico único**, exibido na confirmação e na lista administrativa.
- O administrador aprova/marca pago, bloqueia com motivo e observações internas, cadastra funcionários e redefine PINs.
- **Aprovar / marcar pago** significa situação regular informada manualmente. Bloquear impede entrada e mostra o motivo ao aluno. Não há consulta bancária nem controle financeiro automático.
- No computador da recepção, o administrador abre o **Painel QR Code**. No telefone, o aluno lê o código usando a câmera do celular e entra com ID e PIN. Ao enviar o formulário, o sistema registra a presença, se aprovada, e o computador mostra **Acesso liberado** ou **Acesso bloqueado** automaticamente.
- Se o aluno já estiver conectado no celular, basta confirmar a entrada, evitando registrar presença ao apenas abrir um link.
- A área do aluno tem uma única tela: ID, situação e dias em que foi à academia. O botão antigo de registro remoto deixou de registrar presença.
- Cada QR dura 3 minutos e só pode ser usado uma vez. O painel renova o código após uso ou vencimento. O resultado fica em destaque por 8 segundos.
- Uma presença por aluno por dia, protegida também por restrição no banco. Ler outro QR no mesmo dia libera o acesso se o aluno estiver aprovado, sem duplicar a presença.
- PINs permanecem como hash. Há bloqueio temporário de login após 5 erros por ID em uma janela de 5 minutos. Administradores mantêm usuário e senha fortes; não alteramos suas credenciais existentes.

O QR é um teste de autorização, sem comando para catraca física. Alguém pode compartilhar um QR enquanto ele for válido: ele não comprova sozinho a presença física.

## Primeiro teste no VS Code / PowerShell

Nesta máquina, foi preparado um Python portátil em `work/python/python.exe`, fora da pasta de entrega. Para rodar a cópia atual:

```powershell
cd C:\Users\Victor\Documents\Codex\2026-11-01\gos\outputs\academia
powershell -NoProfile -ExecutionPolicy Bypass -File ".\iniciar-rede.ps1" -PythonExe "C:\Users\Victor\Documents\Codex\2026-11-01\gos\work\python\python.exe" -LanIp 192.168.18.103
```

Deixe o terminal aberto. PC: **http://localhost:8000**. Celular: **http://192.168.18.103:8000**. Ambos precisam estar na mesma rede do roteador. O IP pode mudar; confira com `ipconfig`.

O script migra o banco, coleta CSS/JS e inicia o servidor de desenvolvimento sem afetar o firewall ou roteador. Ele tem comentários explicando a rede. Detalhes em [REDE-LOCAL.md](REDE-LOCAL.md).

### Roteiro PC + telefone

1. No telefone, acesse o endereço da rede e use “Sou novo na academia”. Escolha um PIN, por exemplo de 4 números, e anote o ID gerado.
2. No PC, entre como administrador. A conta administrativa existente continua com a mesma senha.
3. Encontre o ID e clique em “Aprovar / marcar pago”. Confirme.
4. No PC, clique em **Abrir painel QR Code**. Deixe essa aba aberta. Ela mostra somente o código e o resultado de acesso.
5. No telefone, abra a câmera e leia o QR. Abra o link e informe ID e PIN. Se já estiver conectado, toque em “Confirmar minha entrada”.
6. Confira “Acesso liberado!” no PC e no telefone. No telefone, abra “Ver meus dias de academia”.
7. No administrador, bloqueie o aluno com motivo “Pagamento atrasado”. Leia o novo QR e repita: aparece “Acesso bloqueado” e não é criada uma presença.
8. Use “Desbloquear / marcar pago” para liberar novamente.

Você pode expandir “Não consegue ler o código?” para obter o link de teste no painel. O código aponta para o IP da rede mesmo que o PC esteja usando localhost. Essa configuração vem de `PUBLIC_BASE_URL`.

### Cadastros antigos

Os IDs são derivados do cadastro existente: não apagamos contas, históricos nem senhas. Na gestão, o ID aparece junto de cada nome. Senhas antigas não podem ser convertidas em PIN porque são hashes: use **Redefinir PIN** para escolher um PIN numérico novo. O administrador não consegue consultar o PIN salvo.

## Instalação normal sem Docker

Use Python 3.12. Na pasta do projeto:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
powershell -NoProfile -ExecutionPolicy Bypass -File ".\iniciar-rede.ps1" -PythonExe ".\.venv\Scripts\python.exe" -LanIp 192.168.18.103
```

Em outro terminal, crie o administrador se esta instalação ainda não tiver um:

```powershell
$env:SECRET_KEY = Get-Content .\data\lan-secret.txt -Raw
.\.venv\Scripts\python.exe manage.py createsuperuser
```

Nenhuma senha padrão está no repositório. Para parar o servidor use Ctrl+C. Se a porta já estiver em uso, não abra um segundo servidor: utilize o existente ou encerre o anterior antes de reiniciar.

## Docker

Requer Docker Desktop com containers Linux e Docker Compose.

```powershell
Copy-Item .env.example .env
```

Gere uma chave e cole-a em `SECRET_KEY` no `.env`:

```powershell
docker run --rm python:3.12-slim python -c "import secrets; print(secrets.token_hex(32))"
```

Para o QR no telefone, configure no `.env` o IP atual e a porta exposta:

```dotenv
ALLOWED_HOSTS=localhost,127.0.0.1,192.168.18.103
CSRF_TRUSTED_ORIGINS=http://localhost:8000,http://127.0.0.1:8000,http://localhost:8001,http://127.0.0.1:8001,http://192.168.18.103:8001
PUBLIC_BASE_URL=http://192.168.18.103:8001
```

Inicie o modo de rede:

```powershell
docker compose -f compose.yaml -f compose.lan.yaml up --build -d
docker compose exec web python manage.py createsuperuser
```

PC e telefone: **http://192.168.18.103:8001**. Sem o complemento LAN, `docker compose up --build -d` expõe somente localhost:8000; nesse caso o telefone não acessa. A variável `PUBLIC_BASE_URL` só determina o link do QR, não abre a porta por si.

```powershell
docker compose exec web python manage.py test
docker compose logs -f web
docker compose -f compose.yaml -f compose.lan.yaml down
```

Os dados sobrevivem à recriação do container no volume `academia_data`. `down -v` apaga o volume e os cadastros.

## Verificações

Com dependências instaladas e `SECRET_KEY` definida no ambiente:

```powershell
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py collectstatic --noinput
python manage.py test
```

## GitHub e CI / entrega da imagem

Na pasta deste README, substitua a URL pela sua:

```powershell
git init
git add .
git commit -m "feat: controle de academia com PIN e QR Code"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/pulso-academia.git
git push -u origin main
```

O `.gitignore` exclui banco, chaves locais e `.env`. Revise antes de enviar.

- `ci.yml`: verificações, testes, build Docker, teste HTTP e persistência do banco após recriar o container.
- `publish.yml`: ao enviar uma tag `v*`, repete os testes e publica a imagem no GitHub Container Registry com `GITHUB_TOKEN`.

```powershell
git tag v0.2.0
git push origin v0.2.0
```

Imagem: `ghcr.io/SEU-USUARIO/pulso-academia:v0.2.0` (nome em minúsculas). O GitHub precisa permitir publicação de pacotes. **Deploy em hospedagem não está configurado**: o destino não foi definido. Publicar a imagem não coloca o site online.

## Estrutura

```text
config/                 Configuração, rotas e URL pública do QR
gym/models.py           Pessoas, entradas, tickets QR e tentativas de login
gym/forms.py            ID / PIN, cadastro e bloqueios
gym/backends.py         Autenticação pelo ID do aluno
gym/access.py           Consumo único do QR e autorização de entrada
gym/kiosk.py            Painel, QR SVG, atualização e login pelo telefone
gym/views.py            Gestão e painel do aluno
gym/tests.py            Fluxos e permissões
templates/              Telas responsivas
static/                 CSS e atualização do painel QR
.github/workflows/      CI e publicação de imagem
```

## Antes de oferecer a clientes

Este é um MVP de baixo volume com PIN curto por escolha do projeto. Para disponibilizar comercialmente, configure HTTPS, domínio, backups testados, monitoramento, recuperação de acesso e política de privacidade; revise os controles de tentativas e a facilidade de compartilhar o QR. Escolha o equipamento e sua API antes de integrar uma catraca. Não foi definida uma licença de distribuição.

Em produção, ajuste `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `PUBLIC_BASE_URL`, `SECURE_COOKIES=1` e redirecionamento HTTPS conforme o proxy. Faça backup seguro do SQLite e não envie banco ou credenciais ao GitHub.
