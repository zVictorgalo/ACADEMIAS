import QRCode from 'qrcode';

// Nenhuma chave do Supabase vai para o navegador. Toda chamada passa pelo Worker.
const main = document.getElementById('conteudo');
const navigation = document.getElementById('navigation');
let account = null;
let epoch = 0;
let flash = '';
const statuses = {pending:'Aguardando aprovação',approved:'Aprovado',blocked:'Bloqueado',rejected:'Recusado'};
const reasons = {unpaid:'Falta de pagamento',overdue:'Pagamento atrasado',expired:'Cadastro vencido',requested:'Solicitação do usuário',other:'Outro motivo'};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const accessId = value => String(value).padStart(6,'0');
const date = value => new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo'}).format(new Date(value));
const time = value => new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
const selectOptions = (choices, selected='') => Object.entries(choices).map(([value,label])=>`<option value="${esc(value)}" ${selected===value?'selected':''}>${esc(label)}</option>`).join('');
const button = (label, href, kind='primary') => `<a class="button ${kind}" href="${esc(href)}">${esc(label)}</a>`;
const field = (name,label,attrs='') => `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" ${attrs} required></div>`;
const pinFields = () => field('pin','Crie seu PIN','type="password" inputmode="numeric" pattern="[0-9]{4,32}" minlength="4" maxlength="32" autocomplete="new-password"') + '<p class="help">Use de 4 a 32 números.</p>' + field('confirm_pin','Repita o PIN','type="password" inputmode="numeric" pattern="[0-9]{4,32}" maxlength="32" autocomplete="new-password"');
class ApiError extends Error { constructor(message,status){ super(message);this.status=status; } }
async function api(path, body) {
  const response = await fetch('/api'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data = await response.json().catch(()=>({error:'Resposta inesperada do servidor.'}));
  if(!response.ok) throw new ApiError(data.error || 'Não foi possível concluir.',response.status);
  return data;
}
function goto(path,replace=false){ history[replace?'replaceState':'pushState']({},'',path);render(); }
function showError(message){
  let notice=main.querySelector('[data-error]');
  if(!notice){notice=document.createElement('div');notice.dataset.error='';notice.className='notice error';notice.setAttribute('role','alert');main.prepend(notice);}
  notice.textContent=message;notice.scrollIntoView({block:'nearest'});
}
function bindForm(id,handler){
  const form=document.getElementById(id);
  form.addEventListener('submit',async event=>{
    event.preventDefault();const submit=form.querySelector('button[type="submit"]');
    submit.disabled=true;
    try { await handler(Object.fromEntries(new FormData(form)),form); }
    catch(error){ showError(error.message || 'Verifique sua conexão e tente novamente.'); }
    finally { submit.disabled=false; }
  });
}
function header(kiosk=false){
  navigation.innerHTML=kiosk?'<span class="muted small">Painel de entrada</span>':account?'<a href="/painel/">Meu painel</a><button class="quiet" id="logout" type="button">Sair</button>':'<a href="/entrar/">Já tenho uma conta</a>';
  document.getElementById('logout')?.addEventListener('click',async()=>{try{await api('/auth/logout',{});account=null;goto('/');}catch(error){showError(error.message);}});
}
function home(){
  main.innerHTML=`<section class="hero"><div><span class="eyebrow">SEU PRÓXIMO PASSO</span><h1>Seu ritmo.<br>Sua evolução.<br><em>Seu espaço.</em></h1><p class="lead">O treino começa com uma boa experiência. Acesse sua conta ou venha fazer parte da academia.</p><div class="actions">${button('Entrar na minha conta ↗','/entrar/')}${button('Sou novo na academia','/cadastro/','secondary')}</div><p class="muted small">ID automático · PIN numérico · Entrada pelo QR Code</p></div><div class="hero-art" aria-hidden="true"><span class="art-label">UM MOVIMENTO DE CADA VEZ</span><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit orbit-three"></div><span class="art-bottom">COMECE.<br>CONTINUE.<br><strong>EVOLUA.</strong></span><span class="art-index">01 / PULSO</span></div></section><section class="steps"><article><span>01</span><h3>Crie sua conta</h3><p>Receba seu ID e escolha um PIN.</p></article><article><span>02</span><h3>A equipe aprova</h3><p>Acompanhe sua situação no painel.</p></article><article><span>03</span><h3>Leia o QR Code</h3><p>Registre a presença na recepção.</p></article></section>`;
}
function login(){
  if(account)return goto('/painel/',true);
  main.innerHTML=`<section class="auth-layout"><div class="auth-intro"><span class="eyebrow">BOM TER VOCÊ DE VOLTA</span><h1>Vamos colocar<br>o corpo em<br><em>movimento?</em></h1><p class="lead">Entre para acompanhar sua situação e seus dias na academia.</p></div><div class="card auth-card"><h2>Entre na sua conta</h2><p class="muted">Aluno: ID e PIN. Administrador: usuário e senha.</p><form id="login-form">${field('identifier','ID ou usuário','autocomplete="username" maxlength="150"')}${field('password','PIN / senha','type="password" autocomplete="current-password" maxlength="256"')}<button class="button primary full" type="submit">Entrar →</button></form><p class="small">Primeira vez aqui? <a href="/cadastro/">Criar minha conta</a></p><p class="muted small">Esqueceu o PIN? Procure a recepção.</p></div></section>`;
  bindForm('login-form',async body=>{const data=await api('/auth/login',body);account=data.user;goto('/painel/');});
}
function signup(admin=false){
  main.innerHTML=`<section class="form-wrap"><a class="back" href="${admin?'/gestao/':'/'}">← Voltar</a><span class="eyebrow">${admin?'GESTÃO DE PESSOAS':'BOAS-VINDAS À PULSO'}</span><h1 class="smaller">${admin?'Uma nova pessoa no time.':'Seu primeiro passo começa aqui.'}</h1><p class="lead">${admin?'O cadastro já terá acesso aprovado.':'Seu ID será gerado automaticamente. A equipe aprova o acesso.'}</p><div class="card"><form id="signup-form">${field('name','Nome completo','autocomplete="name" maxlength="150"')}${field('email','E-mail','type="email" autocomplete="email" maxlength="254"')}${pinFields()}${admin?'<div class="field"><label for="role">Tipo de cadastro</label><select id="role" name="role"><option value="student">Aluno</option><option value="employee">Funcionário</option></select></div>':''}<button class="button primary full" type="submit">${admin?'Criar cadastro':'Enviar cadastro'} →</button></form></div></section>`;
  bindForm('signup-form',async body=>{
    const data=await api(admin?'/admin/members':'/signup',body);
    main.innerHTML=`<section class="result card"><div class="result-icon">✓</div><span class="eyebrow">CADASTRO ${admin?'APROVADO':'ENVIADO'}</span><h1 class="smaller">Tudo certo, ${esc(data.name)}!</h1><div class="student-id"><span>GUARDE O ID PARA ENTRAR</span><strong>${esc(data.access_id)}</strong></div><p>${admin?'Entregue o ID e o PIN definido à pessoa cadastrada.':'Entre com este ID e o PIN escolhido. Aguarde a aprovação da academia para registrar entradas.'}</p>${button(admin?'Voltar à gestão':'Entrar na minha conta',admin?'/gestao/':'/entrar/')}</section>`;
  });
}
async function dashboard(){
  const data=await api('/me');account=data.user;header();
  if(account.is_admin)return goto('/gestao/',true);
  const m=data.member;
  if(!m)throw new Error('Seu cadastro precisa ser revisado pela recepção.');
  const paid=m.status==='approved';
  main.innerHTML=`<section class="student-space"><div class="page-heading"><div><span class="eyebrow">MINHA ACADEMIA</span><h1 class="smaller">Olá, ${esc(account.name)}.</h1></div><div class="student-id"><span>SEU ID</span><strong>${accessId(m.id)}</strong></div></div><section class="card payment-card"><span class="eyebrow">SITUAÇÃO NA ACADEMIA</span><h2><span class="status ${esc(m.status)}">${paid?'Pago':m.status==='pending'?'Aguardando aprovação':'Bloqueado'}</span></h2><p>${paid?'Seu acesso está liberado. Leia o QR Code no painel da academia para registrar a entrada.':m.status==='pending'?'Recebemos seu cadastro. Aguarde a aprovação da recepção.':'Seu acesso está bloqueado. Procure a recepção.'}</p>${m.block_reason?`<p><strong>Motivo:</strong> ${esc(reasons[m.block_reason])}</p>`:''}<p class="muted small">Situação informada manualmente pela equipe.</p><button id="refresh-status" class="button secondary" type="button">Atualizar situação</button></section><section class="card recent"><span class="eyebrow">MINHA FREQUÊNCIA</span><h2>Dias em que fui à academia</h2><p class="muted small">Uma presença por dia, confirmada pelo QR Code.</p><div class="attendance-grid">${data.entries.map(e=>`<article class="attendance-day"><strong>${date(e.created_at)}</strong><span class="muted small">Entrada às ${time(e.created_at)}</span></article>`).join('')||'<div class="empty"><h3>Seu histórico começa aqui</h3><p>Leia o QR Code da academia para registrar a presença.</p></div>'}</div></section></section>`;
  document.getElementById('refresh-status').onclick=()=>render();
}
async function management(){
  const query=new URLSearchParams(location.search);
  const data=await api('/admin/members?'+query);
  main.innerHTML=`${flash?`<div class="notice" role="status">${esc(flash)}</div>`:''}<div class="page-heading"><div><span class="eyebrow">ADMINISTRADOR</span><h1 class="smaller">Tudo no seu ritmo.</h1><p class="muted">Cadastros, aprovações e entradas em um só lugar.</p></div><div class="actions"><a class="button secondary" href="/portaria/" target="_blank" rel="noopener">Abrir painel QR Code ↗</a>${button('+ Cadastrar pessoa','/gestao/novo/')}</div></div><section class="stats"><article><span>Pessoas cadastradas</span><strong>${data.stats.total}</strong></article><article class="highlight"><span>Aguardando aprovação</span><strong>${data.stats.pending}</strong></article><article><span>Acessos aprovados</span><strong>${data.stats.approved}</strong></article><article><span>Entradas hoje</span><strong>${data.stats.today}</strong></article></section><section class="card"><h2>Alunos e funcionários</h2><form id="filter-form" class="filters"><div><label for="q">Buscar pessoa</label><input id="q" name="q" placeholder="Nome, ID ou e-mail" value="${esc(query.get('q')||'')}"></div><div><label for="status">Situação</label><select id="status" name="status"><option value="">Todas</option>${selectOptions(statuses,query.get('status'))}</select></div><div><label for="reason">Motivo de bloqueio</label><select id="reason" name="reason"><option value="">Todos</option>${selectOptions(reasons,query.get('reason'))}</select></div><button class="button secondary" type="submit">Filtrar</button><a class="back" href="/gestao/">Limpar</a></form><div class="table-scroll"><table><thead><tr><th>Pessoa</th><th>Perfil</th><th>Situação / motivo</th><th>Ações</th></tr></thead><tbody>${data.members.map(m=>`<tr><td><strong>${esc(m.name)}</strong><span class="table-detail">ID ${accessId(m.id)} · ${esc(m.email)}</span></td><td>${m.role==='employee'?'Funcionário':'Aluno'}</td><td><span class="status ${esc(m.status)}">${esc(statuses[m.status])}</span>${m.block_reason?`<span class="table-detail">${esc(reasons[m.block_reason])}</span>`:''}${m.block_notes?`<span class="table-detail">Interno: ${esc(m.block_notes)}</span>`:''}</td><td><div class="row-actions"><a class="mini" href="/gestao/${m.id}/pin/">Redefinir PIN</a>${m.status==='approved'?`<button class="mini danger" data-id="${m.id}" data-status="blocked">Bloquear</button>`:`<button class="mini approve" data-id="${m.id}" data-status="approved">Aprovar / marcar pago</button>`}${m.status==='pending'?`<button class="mini danger" data-id="${m.id}" data-status="rejected">Recusar</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="4"><div class="empty"><h3>Nenhuma pessoa encontrada</h3><p>Cadastre uma pessoa ou ajuste os filtros.</p></div></td></tr>'}</tbody></table></div></section><section class="card recent"><h2>Histórico de alterações</h2>${data.events.map(e=>`<div class="history-row"><div><strong>${esc(e.member_name)}</strong> · ${esc(statuses[e.status])}${e.reason?`<span class="table-detail">${esc(reasons[e.reason])}</span>`:''}${e.notes?`<span class="table-detail">Interno: ${esc(e.notes)}</span>`:''}</div><span>${esc(e.actor_name)}<br>${date(e.created_at)} ${time(e.created_at)}</span></div>`).join('')||'<p class="muted">As alterações da equipe aparecerão aqui.</p>'}</section><p class="muted small">Aprovar / marcar pago é um registro manual. Não há cobrança automática.</p><dialog id="status-dialog" class="card"></dialog>`;
  flash='';
  document.getElementById('filter-form').onsubmit=event=>{event.preventDefault();goto('/gestao/?'+new URLSearchParams(new FormData(event.currentTarget)));};
  main.querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>{
    const dialog=document.getElementById('status-dialog');
    const member=data.members.find(m=>String(m.id)===b.dataset.id);
    const blocking=b.dataset.status==='blocked';
    dialog.innerHTML=`<h2>${blocking?'Bloquear':'Alterar acesso de'} ${esc(member.name)}?</h2><p>Nova situação: ${esc(statuses[b.dataset.status])}.</p><form id="status-form">${blocking?`<div class="field"><label for="block_reason">Motivo exibido ao aluno</label><select id="block_reason" name="reason" required><option value="">Selecione</option>${selectOptions(reasons)}</select></div><div class="field"><label for="notes">Observação interna (opcional)</label><textarea id="notes" name="notes" maxlength="500" rows="3"></textarea><p class="help">Visível apenas ao administrador.</p></div>`:'<p>A aprovação marca o cadastro como pago neste controle manual.</p>'}<div class="actions"><button class="button primary" type="submit">Confirmar alteração</button><button class="button secondary" id="cancel-dialog" type="button">Cancelar</button></div></form>`;
    document.getElementById('cancel-dialog').onclick=()=>dialog.close();
    bindForm('status-form',async body=>{await api(`/admin/members/${b.dataset.id}/status`,{...body,status:b.dataset.status});dialog.close();flash='Situação atualizada com sucesso.';await render();});
    dialog.showModal();
  });
}
function resetPin(id){
  main.innerHTML=`<section class="form-wrap"><a class="back" href="/gestao/">← Voltar à gestão</a><h1 class="smaller">Novo PIN · ID ${accessId(id)}</h1><p class="lead">O PIN anterior deixará de funcionar e as sessões do aluno serão encerradas.</p><div class="card"><form id="pin-form">${pinFields()}<button class="button primary full" type="submit">Salvar novo PIN</button></form></div></section>`;
  bindForm('pin-form',async body=>{await api(`/admin/members/${id}/pin`,body);flash='PIN atualizado. Informe o novo PIN ao aluno.';goto('/gestao/');});
}
function entryResult(result){
  const granted=result.decision==='granted';
  main.innerHTML=`<section class="result card mobile-entry">${granted?'<div class="result-icon">✓</div>':''}<span class="eyebrow">ENTRADA NA ACADEMIA</span><h1 class="smaller">${result.expired?'Leia o código novamente.':granted?'Acesso liberado!':'Acesso bloqueado.'}</h1><p>${result.expired?'Este QR Code venceu ou já foi utilizado. Leia o novo código no painel da academia.':granted?'Bom treino! O computador recebeu a confirmação e sua presença de hoje está registrada.':'Seu cadastro não está liberado. Procure a recepção. Nenhuma presença foi registrada.'}</p>${button(granted?'Ver meus dias de academia':'Ver minha situação','/painel/',granted?'primary':'secondary')}</section>`;
}
async function mobileEntry(ticketId){
  const ticket=await api('/tickets/'+ticketId);
  if(ticket.expired||ticket.decision)return entryResult(ticket);
  if(account?.is_admin){main.innerHTML='<section class="result card"><h1 class="smaller">Use sua conta de aluno.</h1><p>Saia da conta administrativa no celular e leia o QR novamente para entrar com ID e PIN.</p></section>';return;}
  main.innerHTML=`<section class="result card mobile-entry"><span class="eyebrow">ENTRADA NA ACADEMIA</span><h1 class="smaller">Vamos treinar?</h1><p>${account?`Olá, ${esc(account.name)}. Confirme sua entrada.`:'Informe seu ID e PIN para registrar a presença e avisar o painel do computador.'}</p><form id="entry-form">${account?'':field('identifier','Seu ID','inputmode="numeric" autocomplete="username" maxlength="18"')+field('password','Seu PIN','type="password" inputmode="numeric" autocomplete="current-password" maxlength="256"')}<button class="button primary full" type="submit">${account?'Confirmar minha entrada':'Entrar e registrar presença'} →</button></form><p class="muted small">Se o código vencer, leia novamente no painel.</p></section>`;
  bindForm('entry-form',async body=>{const result=await api('/entry',{...body,ticket_id:ticketId});try{account=(await api('/me')).user;}catch{}header();entryResult(result);});
}
async function kiosk(viewEpoch){
  header(true);
  main.innerHTML=`<section class="kiosk"><span class="eyebrow">RECEPÇÃO · PAINEL DE TESTE</span><h1 class="smaller">Seu treino começa aqui.</h1><p class="lead">Leia o QR Code com a câmera do celular.<br>Entre com ID e PIN para liberar o acesso.</p><div class="kiosk-grid"><div class="card qr-card"><div id="qr-placeholder" class="qr-placeholder">Preparando QR Code…</div><div id="entry-qr" hidden></div><p id="qr-countdown" class="muted small"></p><details><summary>Não consegue ler o código?</summary><p class="small">Abra este endereço no celular:</p><a id="mobile-link" class="small qr-link"></a></details></div><div id="gate-result" class="card gate-result" role="status" aria-live="polite"><div id="gate-icon" class="gate-icon">◎</div><h2 id="gate-title">Aguardando leitura</h2><p id="gate-message">O resultado aparecerá aqui após a confirmação no celular.</p><span class="badge">Simulação · sem catraca física</span></div></div><p id="connection-status" class="muted small">Conectando…</p><a class="back" href="/gestao/">← Voltar à gestão</a></section>`;
  const key=`pulso-terminal:${account.id}`;
  let terminal=sessionStorage.getItem(key);
  if(!terminal){terminal=(await api('/terminals',{})).id;sessionStorage.setItem(key,terminal);}
  let lastTicket='';let expiresAt=0;
  const clock=setInterval(()=>{if(epoch!==viewEpoch){clearInterval(clock);return;}document.getElementById('qr-countdown').textContent=`QR válido por ${Math.max(0,Math.ceil((expiresAt-Date.now())/1000))}s · renovação automática`;},1000);
  async function poll(){
    if(epoch!==viewEpoch)return;
    try{
      const state=await api('/terminals/'+terminal);if(epoch!==viewEpoch)return;
      if(state.ticket_id!==lastTicket){
        const svg=await QRCode.toString(state.mobile_url,{type:'svg',width:320,margin:4});
        if(epoch!==viewEpoch)return;
        document.getElementById('entry-qr').innerHTML=svg;lastTicket=state.ticket_id;
      }
      document.getElementById('entry-qr').hidden=false;document.getElementById('qr-placeholder').hidden=true;
      const link=document.getElementById('mobile-link');link.href=state.mobile_url;link.textContent=state.mobile_url;
      expiresAt=Date.parse(state.expires_at);
      const states={granted:['✓','Acesso liberado!','Entrada confirmada. Bom treino!'],denied:['×','Acesso bloqueado','Procure a recepção para verificar seu cadastro.'],'':['◎','Aguardando leitura','Leia o QR Code no celular e entre com ID e PIN.']};
      const value=states[state.decision]||states[''];
      document.getElementById('gate-result').className='card gate-result '+(state.decision||'');
      document.getElementById('gate-icon').textContent=value[0];document.getElementById('gate-title').textContent=value[1];document.getElementById('gate-message').textContent=value[2];
      document.getElementById('connection-status').textContent='● Painel conectado · atualização automática';
    }catch(error){if(epoch!==viewEpoch)return;document.getElementById('entry-qr').hidden=true;document.getElementById('qr-placeholder').hidden=false;document.getElementById('connection-status').textContent=error.message+' Atualize a página ou entre novamente.';}
    if(epoch===viewEpoch)setTimeout(poll,1500);
  }
  poll();
}
async function render(){
  const current=++epoch;header();main.innerHTML='<p class="muted">Carregando…</p>';
  const path=location.pathname;
  try{
    const needsLogin=path.startsWith('/gestao/')||path==='/painel/'||path==='/portaria/';
    if(needsLogin&&!account)return goto('/entrar/',true);
    if((path.startsWith('/gestao/')||path==='/portaria/')&&!account?.is_admin)throw new ApiError('Esta área é do administrador.',403);
    if(path==='/')return home();
    if(path==='/entrar/')return login();
    if(path==='/cadastro/')return signup();
    if(path==='/painel/')return await dashboard();
    if(path==='/gestao/')return await management();
    if(path==='/gestao/novo/')return signup(true);
    const reset=path.match(/^\/gestao\/(\d+)\/pin\/$/);if(reset)return resetPin(reset[1]);
    if(path==='/portaria/')return await kiosk(current);
    const entry=path.match(/^\/acesso\/([a-f0-9-]{36})\/$/i);if(entry)return await mobileEntry(entry[1]);
    main.innerHTML='<section class="result card"><h1 class="smaller">Página não encontrada.</h1><a class="button primary" href="/">Voltar ao início</a></section>';
  }catch(error){if(epoch!==current)return;if(error.status===401){account=null;return goto('/entrar/',true);}showError(error.message);}
}
document.addEventListener('click',event=>{
  const a=event.target.closest('a[href]');
  if(!a||event.ctrlKey||event.metaKey||event.shiftKey||a.target||a.hasAttribute('download'))return;
  const url=new URL(a.href,location.href);if(url.origin!==location.origin||url.hash)return;
  event.preventDefault();goto(url.pathname+url.search);
});
window.addEventListener('popstate',()=>render());
(async()=>{try{account=(await api('/me')).user;}catch{}await render();})();
