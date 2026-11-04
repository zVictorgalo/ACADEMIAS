# Entendendo os arquivos do Pulso

Este guia explica o que cada arquivo faz e onde mexer para alterar o projeto. A pasta principal é `academia`: é nela que ficam `manage.py`, `Dockerfile` e `README.md`, e é ela que deve ser a raiz do seu repositório no GitHub.

## Comece por estes arquivos

| O que você quer fazer | Onde olhar |
| --- | --- |
| Aprender a instalar, executar e testar | `README.md` |
| Entender o acesso pelo Wi-Fi | `REDE-LOCAL.md` e `iniciar-rede.ps1` |
| Alterar cores, tamanhos e aparência | `static/style.css` |
| Alterar textos e organização das telas | `templates/` |
| Alterar cadastro, PIN e validação de formulários | `gym/forms.py` |
| Alterar os dados guardados no banco | `gym/models.py` |
| Alterar a decisão de liberar ou bloquear entrada | `gym/access.py` |
| Alterar o painel QR ou o fluxo do telefone | `gym/kiosk.py` e `static/kiosk.js` |
| Alterar testes automáticos no GitHub | `.github/workflows/ci.yml` |

## Como as partes se conectam

Quando você abre um endereço no navegador, `config/urls.py` escolhe a função Python que vai atender o pedido. Essa função consulta os dados definidos em `gym/models.py` e normalmente monta uma tela usando um arquivo de `templates/`. O navegador aplica as cores de `static/style.css` e, no painel QR, executa `static/kiosk.js` para atualizar o resultado sem recarregar a página.

No cadastro, `gym/forms.py` valida o PIN e cria a conta com a senha em hash. O cadastro de aluno recebe um ID numérico automático. No login, `gym/backends.py` encontra a conta correspondente a esse ID. O administrador continua usando seu usuário e senha.

Na entrada, `gym/kiosk.py` gera o QR e recebe o formulário do celular. `gym/access.py` consome o código uma única vez, verifica a situação atual do cadastro e, se aprovado, registra a presença. O JavaScript do painel consulta o resultado e exibe “Acesso liberado” ou “Acesso bloqueado”.

## Arquivos da pasta principal

| Arquivo | Para que serve |
| --- | --- |
| `manage.py` | Executa os comandos do Django: iniciar servidor, migrar banco, criar administrador, coletar arquivos estáticos e rodar testes. Não contém as regras da academia. |
| `requirements.txt` | Lista as bibliotecas Python e as versões usadas: Django, Gunicorn, WhiteNoise, gerador de QR Code e dependências. É usado na instalação local, Docker e CI. |
| `iniciar-rede.ps1` | Inicia o teste pelo PowerShell. Verifica a porta, configura o IP permitido, a URL do QR e a proteção dos formulários; prepara o banco e os arquivos estáticos e inicia o servidor. Tem comentários explicando cada configuração de rede. |
| `.env.example` | Exemplo das variáveis de ambiente. No Docker, copie para `.env` e configure chave, endereços permitidos e URL pública do QR. Não contém uma chave real de produção. |
| `.gitignore` | Diz ao Git quais arquivos locais não devem ir para o GitHub, como `.env`, banco, chaves locais e cache do Python. Não protege arquivos já enviados anteriormente ao Git. |
| `.dockerignore` | Evita copiar banco, credenciais, ambiente virtual e outros arquivos locais para a imagem Docker. |
| `Dockerfile` | Define como construir a imagem da aplicação: instala Python/dependências, coleta CSS e JavaScript, configura usuário sem privilégios e inicia migrações e Gunicorn. Também define a verificação de saúde do container. |
| `compose.yaml` | Configura o serviço Docker e o volume persistente do SQLite. Por padrão, publica a porta somente no próprio computador (`127.0.0.1:8000`). |
| `compose.lan.yaml` | Complemento opcional que adiciona acesso pela rede local na porta 8001. Só é usado quando você o informa junto do Compose principal. Não altera o roteador nem o firewall. |
| `README.md` | Guia principal: funcionalidades, comandos, teste com PC e celular, instalação, Docker e envio para o GitHub. |
| `REDE-LOCAL.md` | Explica o IP da rede, as portas, `PUBLIC_BASE_URL`, acesso pelo telefone e o que verificar quando a conexão não abre. |
| `VERIFICACAO.md` | Registra os testes feitos e os limites da verificação, incluindo o que não foi executado, como Docker neste ambiente. |
| `GUIA-ARQUIVOS.md` | Este documento: mapa de todos os arquivos e orientação sobre o que editar. |

O ponto inicial de `.env.example`, `.gitignore`, `.dockerignore` e `.github` faz parte do nome. São arquivos e pasta de configuração; não são arquivos sem uso.

## Pasta `config`: configuração do Django

| Arquivo | Para que serve |
| --- | --- |
| `config/__init__.py` | Identifica `config` como um pacote Python tradicional. Contém apenas uma explicação do pacote. |
| `config/settings.py` | Configura banco SQLite, aplicativos, autenticação, sessões, proteção CSRF, fuso horário, templates, arquivos estáticos e variáveis de ambiente. Segredos são lidos do ambiente, não escritos no código. |
| `config/urls.py` | Lista as rotas: início, login, cadastro, painel do aluno, gestão, portaria QR e verificação de saúde. Se quiser adicionar uma página, normalmente ela precisa de uma rota aqui. |
| `config/wsgi.py` | Expõe a aplicação para o servidor WSGI, usado pelo Gunicorn no Docker. É o ponto de ligação entre o servidor e o Django. |

## Pasta `gym`: regras da academia

| Arquivo | Para que serve |
| --- | --- |
| `gym/__init__.py` | Identifica a aplicação `gym` como pacote Python. Contém uma explicação curta da aplicação. |
| `gym/models.py` | Define os dados: aluno/funcionário (`Member`), presença (`Entry`), histórico de alterações (`StatusEvent`), tentativas de login (`LoginAttempt`), painel de entrada (`Terminal`) e códigos temporários (`AccessTicket`). O usuário e o hash da senha ficam no modelo de usuário do Django. |
| `gym/forms.py` | Define e valida os formulários de login, cadastro, criação pelo administrador, redefinição de PIN e bloqueio com motivo. O cadastro exige PIN de 4 a 32 números, confirmado duas vezes. |
| `gym/backends.py` | Permite autenticar com o ID numérico do aluno, encontrando a conta interna correspondente. Também mantém o login normal do administrador e a compatibilidade com contas anteriores. |
| `gym/views.py` | Atende as páginas de início, cadastro, confirmação, painel do aluno e gestão. Também contém aprovação, bloqueio, redefinição de PIN e a rota de saúde. A função `admin_required` restringe as ações administrativas. |
| `gym/access.py` | Concentra o processamento da entrada: cria QR com validade de 3 minutos, impede consumir o mesmo código novamente, consulta o status do aluno e grava no máximo uma presença diária. |
| `gym/kiosk.py` | Controla a tela de QR do PC, fornece o estado consultado pelo JavaScript, gera a imagem SVG e processa o login/entrada pelo celular. Usa `PUBLIC_BASE_URL` para o QR funcionar no telefone mesmo que o PC abra `localhost`. |
| `gym/tests.py` | Testa cadastro, PIN, ID, permissões, bloqueios, privacidade, expiração e repetição do QR, presença diária e o resultado consultado pelo painel do PC. Não é necessário editar para usar o sistema, mas deve acompanhar mudanças nas regras. |

O arquivo `gym/views.py` mantém a rota antiga `/entrada/` por compatibilidade, mas ela apenas orienta a ler o QR; não registra presença. A rota `/gestao/proposta-entrada/` também continua ativa como explicação do fluxo atual e da integração futura com catraca, por isso seu template não está sem uso.

## Pasta `gym/migrations`: evolução do banco

| Arquivo | Para que serve |
| --- | --- |
| `gym/migrations/__init__.py` | Permite ao Django reconhecer a pasta como o pacote de migrações da aplicação. Não deve ser removido. |
| `gym/migrations/0001_initial.py` | Cria as tabelas iniciais de cadastro, presença e histórico de alterações. |
| `gym/migrations/0002_member_block_notes_member_block_reason_and_more.py` | Adiciona motivo e observação interna aos bloqueios e ao histórico. |
| `gym/migrations/0003_accessticket_loginattempt_terminal_entry_day_and_more.py` | Adiciona tentativas de login, terminais, tickets QR e o dia da presença com restrição de unicidade por aluno. Preenche os dias das presenças antigas a partir da data original, preservando os registros. |

As migrações precisam continuar no GitHub, mesmo que você não vá alterar o banco agora. Uma instalação nova precisa delas para criar a estrutura, e uma instalação existente precisa delas para atualizar sem perder dados.

Depois de alterar os modelos, o fluxo normal é `python manage.py makemigrations` para gerar uma nova migração e `python manage.py migrate` para aplicá-la. Não apague migrações já usadas no banco para “limpar a pasta”.

## Pasta `templates`: telas HTML

| Arquivo | Tela / função |
| --- | --- |
| `templates/base.html` | Estrutura compartilhada: cabeçalho, navegação, mensagens, rodapé e importação do CSS. As outras telas reutilizam essa base. |
| `templates/home.html` | Página inicial com entrar, cadastrar-se e explicação resumida do processo. |
| `templates/login.html` | Login normal com ID/PIN do aluno ou usuário/senha do administrador. |
| `templates/form.html` | Layout reutilizado pelos formulários de cadastro, criação pelo administrador e redefinição de PIN. Os campos e textos vêm da função Python que abre a página. |
| `templates/signup_done.html` | Confirma o cadastro, mostra o ID gerado e explica que o acesso depende da aprovação. |
| `templates/dashboard.html` | Tela única do aluno: ID, situação e dias de presença. Não mostra observações internas. |
| `templates/management.html` | Gestão de pessoas, filtros, aprovações, bloqueios, redefinição de PIN, histórico de ações e botão para abrir o painel QR. |
| `templates/confirm.html` | Confirma mudanças de acesso; no bloqueio, pede motivo e observação interna opcional. |
| `templates/kiosk.html` | Painel de entrada do computador: QR, validade e resultado automático da autorização. Importa `kiosk.js`. |
| `templates/mobile_access.html` | Página aberta pela leitura do QR no telefone: login ou confirmação de entrada, acesso liberado/bloqueado e aviso de código inválido ou vencido. |
| `templates/entry_plan.html` | Explica o fluxo QR implementado e a possibilidade futura de integração com catraca. Está ligada a uma rota existente. |
| `templates/403.html` | Mensagem amigável quando a pessoa não tem permissão para abrir uma área. |
| `templates/404.html` | Mensagem amigável quando um endereço não existe. |

## Pasta `static`: aparência e comportamento no navegador

| Arquivo | Para que serve |
| --- | --- |
| `static/style.css` | Define cores, fontes, espaçamento, campos, botões, visual do QR, estados de liberação/bloqueio e adaptação para celular. É o arquivo-fonte do layout. |
| `static/kiosk.js` | Consulta o estado da portaria aproximadamente a cada 1,5 segundo, troca o QR quando necessário, atualiza a contagem de validade e mostra o resultado no computador. Não decide sozinho quem entra; a autorização acontece no Python. |

## Pasta `.github/workflows`: automação

| Arquivo | Para que serve |
| --- | --- |
| `.github/workflows/ci.yml` | A cada push ou pull request, instala dependências, verifica configuração e migrações, coleta estáticos e roda testes. Depois constrói a imagem Docker, testa a rota de saúde e verifica se os dados sobrevivem à recriação do container. |
| `.github/workflows/publish.yml` | Ao enviar uma tag começando com `v`, repete as verificações/testes e publica a imagem Docker no GitHub Container Registry. Usa o token fornecido pelo GitHub Actions. |

Esses arquivos só serão executados quando o projeto estiver no GitHub com Actions habilitado. O deploy em um servidor ainda não foi definido: publicar uma imagem não coloca o site automaticamente na internet.

## Arquivos gerados durante o uso

Estes arquivos aparecem localmente, mas ficam fora do ZIP e do GitHub:

| Arquivo / pasta | Para que serve e como tratar |
| --- | --- |
| `data/academia.sqlite3` | Banco local com contas, hashes de senha, cadastros, presenças e tickets. Preserve e faça backup. Não é arquivo descartável. |
| `data/lan-secret.txt` | Chave local gerada pelo script de teste para as sessões e proteções do Django. Não deve ser publicada. Apagá-la troca a chave na próxima execução e pode encerrar sessões existentes. |
| `staticfiles/` | Saída do comando `collectstatic`: cópias de CSS/JS, nomes versionados, versões comprimidas `.gz` e manifesto `staticfiles.json`. Não edite aqui; edite `static/` e gere novamente. A aplicação usa essa pasta ao servir os arquivos. |
| `__pycache__/` e arquivos `.pyc` | Cache gerado pelo Python ao importar módulos. Não é código-fonte e é recriado automaticamente. |
| `.venv/`, se você criar | Ambiente local das bibliotecas Python. Pode ser recriado usando `requirements.txt`. |
| `.env`, se você criar | Configuração local do Docker, que pode conter a chave real. Não deve ir para o GitHub. |

No Docker, o banco usa o volume `academia_data`. Ele não fica salvo dentro da imagem. Apagar o volume apaga os dados daquela instalação.

## Sobre os arquivos que estavam vazios

Foram encontrados três arquivos vazios: `config/__init__.py`, `gym/__init__.py` e `gym/migrations/__init__.py`. Eles identificam pacotes Python; o último também é necessário para o reconhecimento das migrações pelo Django.

Por isso foram mantidos e receberam uma explicação curta no próprio código. Nenhum deles é um arquivo temporário sem função. Após a revisão, não há arquivo-fonte vazio na entrega.

## Ordem sugerida para estudar

1. Execute o roteiro do `README.md` e observe as telas.
2. Abra `config/urls.py` para relacionar cada endereço à sua função.
3. Leia `gym/models.py` para entender o que o sistema guarda.
4. Leia `gym/forms.py` e `gym/backends.py` para entender ID e PIN.
5. Leia `gym/views.py` junto dos arquivos HTML correspondentes.
6. Leia `gym/access.py`, `gym/kiosk.py` e `static/kiosk.js` para entender o QR.
7. Leia os testes e, depois, Docker e os workflows do GitHub.
