# Verificação da versão ID / PIN / QR

- Python 3.12.10, Django 5.2.19 e dependências de `requirements.txt`.
- `manage.py check`: sem problemas.
- `manage.py makemigrations --check --dry-run`: nenhuma alteração pendente.
- `manage.py collectstatic --noinput`: CSS e JavaScript coletados com nomes versionados.
- `manage.py test gym --verbosity 1`: 29 testes aprovados.

## Fluxos cobertos pelos testes

Cadastro com ID automático e PIN numérico de pelo menos 4 dígitos, validação e confirmação do PIN, senhas com hash, login pelo ID com zeros à esquerda, limitação de tentativas, redefinição pelo administrador e preservação das credenciais existentes.

Gestão restrita ao administrador, motivo obrigatório de bloqueio, observações privadas, histórico mantido após desbloqueio e filtro por motivo.

QR temporário em SVG, URL apontando para o IP da rede, isolamento entre painéis de administradores, login pelo telefone, confirmação de entrada, resultado no estado do painel, expiração, rejeição de repetição, situação consultada no momento da entrada, proteção CSRF e restrição de uma presença por dia no banco. Abrir o link por GET não registra presença; o botão antigo de entrada direta não cria registros.

## Verificação visual e de ponta a ponta

Executado em Chrome headless por Playwright, com contextos de navegador separados para PC e telefone (viewport móvel de 390 × 844):

1. Administrador abre painel; QR SVG é exibido e a URL usa o IP da rede.
2. Aluno entra por ID/PIN no telefone; aparece Acesso liberado no telefone e automaticamente no PC.
3. Aluno abre sua tela única e vê a data da presença e a situação Pago.
4. Administrador bloqueia com Pagamento atrasado e observação interna.
5. Aluno usa o novo QR; aparece Acesso bloqueado no telefone e no PC.
6. O painel do aluno mostra o motivo, sem a observação interna.

As capturas do painel de PC e da tela móvel foram inspecionadas visualmente. CSS e JavaScript carregaram corretamente. Esse teste usa emulação de viewport móvel; a leitura pela câmera de um telefone físico ainda deve ser confirmada no aparelho.

## Execução e dados

A porta 8000 ainda tinha uma instância anterior durante a verificação; o teste de navegador usou temporariamente 8003. Reinicie o servidor antigo para carregar os novos arquivos na porta 8000. O script agora detecta uma porta ocupada e não inicia uma segunda instância.

Foi feito backup local antes de aplicar a migração. Contas existentes não foram apagadas nem tiveram suas senhas alteradas. A migração preenche o dia das presenças antigas com a data original; eventuais duplicatas históricas são preservadas com dia nulo. As contas temporárias criadas apenas para verificar o navegador foram removidas após o teste.

Docker não está instalado neste ambiente e não foi executado. O CI continua preparado para build, teste HTTP do container e persistência do volume. Nenhum repositório, imagem ou deploy externo foi publicado.
