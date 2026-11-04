# Publicar o Pulso no Cloudflare Workers com Supabase

A versão online usa Cloudflare Workers para as telas e o encaminhamento da API. A Edge Function `pulso-api` executa o login, a gestão e a portaria no Supabase, com PostgreSQL como banco. A versão Django/SQLite continua disponível para rodar no computador ou com Docker.

## O que vai em cada serviço

| Valor | Onde configurar | Exemplo ou origem |
| --- | --- | --- |
| `SUPABASE_FUNCTION_URL` | Cloudflare → Worker → Settings → Variables and Secrets → Secret | `https://SEU-PROJECT-REF.supabase.co/functions/v1/pulso-api` |
| `PULSO_GATEWAY_SECRET` | Cloudflare → mesmo Worker → Secret | Gere um valor aleatório com 64 caracteres hexadecimais. |
| `PULSO_GATEWAY_SECRET` | Supabase → Edge Functions → Secrets | Use exatamente o mesmo valor configurado no Cloudflare. |
| Chaves Public e Secret do Supabase | Permanecem no Supabase | A Edge Function lê a credencial interna injetada pelo Supabase. O navegador e o Worker usam a comunicação descrita acima. |
| `DATABASE_URL` | Ambiente local durante a importação | String PostgreSQL da conexão direta ou do Session Pooler. Use `.env.supabase`, ignorado pelo Git. |

O Project Ref é o identificador do projeto, visível no Supabase. Exemplo de formato `abcdefghijklmnopqrst`. A URL da função é pública, mas este projeto a configura como Secret para exigir que esteja presente antes do deploy. O segredo de gateway deve ser gerado separadamente das chaves do Supabase.

Documentação oficial de [Secrets do Cloudflare Workers](https://developers.cloudflare.com/workers/configuration/secrets/) e [Secrets das Edge Functions](https://supabase.com/docs/guides/functions/secrets).

## 1. Preparar o Supabase e criar as tabelas

Use Node.js 24 no terminal do VS Code. Abra a pasta do repositório, que contém `package.json` e `wrangler.jsonc`.

```powershell
npm ci
npx supabase login
$pulsoProjectRef = Read-Host 'Project Ref do Supabase'
npx supabase link --project-ref $pulsoProjectRef
npx supabase db push --linked
```

A migração em `supabase/migrations/` cria tabelas `pulso_*` e restringe a API do banco à Edge Function. A tabela `auth.users` do Supabase fica independente. O login próprio preserva PINs de quatro dígitos e hashes PBKDF2 do Django. Confira a [documentação de migrações do Supabase](https://supabase.com/docs/guides/deployment/database-migrations).

## 2. Preservar os cadastros do SQLite

No momento de transferir os dados, pare de registrar novas entradas na instância local. Gere um snapshot atualizado na mesma pasta do projeto.

```powershell
python .\scripts\export-supabase.py
```

Nesta máquina, o Python portátil também serve para a exportação:

```powershell
& 'C:\Users\Victor\Documents\Codex\2026-11-01\gos\work\python\python.exe' .\scripts\export-supabase.py
```

O arquivo `private-exports/pulso-import.sql` preserva contas, hashes, IDs dos alunos, permissões, bloqueios, presenças e histórico administrativo. Sessões e QR Codes são temporários e serão recriados. O manifesto registra as contagens para conferência. Esses arquivos contêm dados pessoais e hashes, por isso ficam fora do Git e do ZIP.

No Supabase, abra **Connect** e copie a string **Session pooler** ou **Direct connection**. A conexão precisa usar o usuário administrativo do banco. Configure `DATABASE_URL` em um arquivo `.env.supabase` com base no exemplo, usando o valor real apenas localmente. Depois execute:

```powershell
node --env-file=.env.supabase scripts/import-supabase.mjs
```

O importador verifica o manifesto e exige que as tabelas do Pulso estejam vazias. O SQL é aplicado em uma transação e as contagens são conferidas depois. Uma segunda tentativa após uma importação bem-sucedida é recusada. As contas usam os mesmos IDs e senhas ou PINs compatíveis do SQLite. Será preciso fazer login novamente na versão online.

## 3. Configurar os secrets nos dois serviços

Abra no Cloudflare o Worker **`academias`**, igual ao `name` do `wrangler.jsonc`. Se for o primeiro Worker, você pode criá-lo com o exemplo inicial do painel e depois publicar os arquivos do projeto.

### Pelo terminal

Com `$pulsoProjectRef` ainda definido na mesma janela, execute:

```powershell
$pulsoGateway = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
Set-Content -LiteralPath 'supabase/.env.functions' -Value "PULSO_GATEWAY_SECRET=$pulsoGateway" -Encoding ascii
npx supabase secrets set --env-file supabase/.env.functions --project-ref $pulsoProjectRef
npx supabase functions deploy pulso-api --project-ref $pulsoProjectRef --use-api

npx wrangler login
"https://$pulsoProjectRef.supabase.co/functions/v1/pulso-api" | npx wrangler secret put SUPABASE_FUNCTION_URL
$pulsoGateway | npx wrangler secret put PULSO_GATEWAY_SECRET
npx wrangler secret list
```

Esses comandos geram o segredo sem exibi-lo no terminal e passam os valores ao Wrangler pela entrada padrão. Ao retomar uma configuração já iniciada, reutilize o valor salvo em `supabase/.env.functions` para manter os dois serviços sincronizados. `wrangler secret list` confere os nomes configurados.

### Pelo painel

1. No Supabase, abra **Edge Functions → Secrets**. Adicione `PULSO_GATEWAY_SECRET` com um valor aleatório de 64 caracteres hexadecimais.
2. No Cloudflare, abra **Workers & Pages → academias → Settings → Variables and Secrets**.
3. Adicione `SUPABASE_FUNCTION_URL` como **Secret** com a URL completa da função.
4. Adicione `PULSO_GATEWAY_SECRET` como **Secret** com o mesmo valor do Supabase.

## 4. Publicar e verificar

Se o Worker já estiver conectado ao GitHub, abra **Configurações → Builds** e confira a branch `main`, o diretório raiz `/` (onde está `package.json`), o comando de build `npm run build` e o comando de implantação `npx wrangler deploy`. O build gera `dist/cloudflare` antes do deploy. Envie um commit com os arquivos novos e confira se o log do Cloudflare usa esse commit. Uma tentativa que só instala `requirements.txt` e não encontra os estáticos está usando uma revisão anterior ou um diretório incorreto. Consulte a [configuração do Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

```powershell
npm run check
npm run deploy:dry-run
npm run deploy:cloudflare
```

Abra a URL `workers.dev` exibida pelo Wrangler. Acrescente `/api/health` e confira a resposta `{"status":"ok"}`. Depois, entre com seu administrador, confira a lista de alunos e presenças, abra **Abrir painel QR Code** e teste com o telefone. Use o endereço HTTPS do Worker para que o QR aponte para o mesmo site.

Se a página abrir e a API retornar `503`, confira os dois secrets do Worker. Se a API retornar `403`, confira se `PULSO_GATEWAY_SECRET` coincide nos dois serviços. Um erro `502` indica falha de comunicação com a URL da função. Um erro `500` exige conferir os logs da Edge Function e se a migração foi aplicada. Use somente nomes e mensagens de erro ao pedir ajuda.

## 5. Automatizar pelo GitHub

O workflow `.github/workflows/cloudflare.yml` verifica o TypeScript, executa testes com PostgreSQL e prepara o Worker em cada PR. O job de produção aplica as migrações, publica a função e publica o Worker, depois que você ativa o deploy.

Envie os novos arquivos ao repositório `zVictorgalo/ACADEMIAS`. Antes do commit, confira `git status --short` e veja se `.env.supabase`, `.dev.vars`, `supabase/.env.functions`, `private-exports/` e `data/` estão fora da lista.

No GitHub, abra **Settings → Secrets and variables → Actions**:

| Tipo | Nome | Valor |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Token da conta Cloudflare com permissão de editar Workers. |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | ID da conta Cloudflare. |
| Secret | `SUPABASE_ACCESS_TOKEN` | Token pessoal do Supabase para o CLI. |
| Secret | `SUPABASE_DB_PASSWORD` | Senha do banco do projeto Supabase. |
| Variable | `SUPABASE_PROJECT_REF` | Identificador do projeto Supabase. |
| Variable | `ENABLE_CLOUDFLARE_DEPLOY` | `true` após o primeiro deploy e a conferência dos dados. |

Os secrets de runtime ficam nos painéis do Cloudflare e do Supabase. As credenciais do GitHub acima servem para o workflow publicar novas versões. A importação de cadastros é feita uma vez no passo 2.

Para iniciar pela primeira vez, execute o workflow **Cloudflare Workers + Supabase** em **Actions → Run workflow → main**. Depois, novos pushes para `main` podem publicar automaticamente. Use essa automação ou o deploy automático do Cloudflare Git Integration para a mesma aplicação.

## Arquivos desta versão

| Arquivo | Função |
| --- | --- |
| `wrangler.jsonc` e `cloudflare/worker.ts` | Configuração do Worker e comunicação protegida com a Edge Function. |
| `cloudflare/frontend/index.html` e `app.js` | Telas online, gestão, QR do PC e entrada pelo telefone. |
| `scripts/build-cloudflare.mjs` | Empacota o JavaScript e reutiliza o CSS do projeto Django. |
| `supabase/config.toml` | Configura a Edge Function com validação própria do gateway. |
| `supabase/functions/pulso-api/index.ts` | Liga a Edge Function ao PostgreSQL usando a chave interna do Supabase. |
| `supabase/functions/_shared/backend.ts` e `crypto.ts` | Autorização, login, sessões, validação e compatibilidade com hashes do Django. |
| `supabase/migrations/202611030001_pulso.sql` | Cria tabelas e operações transacionais de cadastro, bloqueio e entrada. |
| `scripts/export-supabase.py` e `scripts/import-supabase.mjs` | Migração de dados privados com preservação dos IDs e conferência das contagens. |
| `package.json`, `package-lock.json` e `tsconfig.json` | Comandos, dependências fixadas e configuração do TypeScript. |
| `.dev.vars.example`, `.env.supabase.example` e `supabase/.env.functions.example` | Exemplos de configuração local e de secrets. |
| `cloudflare/tests/database.test.ts` | Teste integrado de login, cadastro, QR e bloqueio com PostgreSQL. |
| `.github/workflows/cloudflare.yml` | CI e deploy para a versão online. |
