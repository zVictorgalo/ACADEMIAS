// Consulta somente o estado desta portaria; o servidor decide quem pode entrar.
const kiosk = document.querySelector('[data-kiosk-state]');
const qr = document.getElementById('entry-qr');
const placeholder = document.getElementById('qr-placeholder');
const result = document.getElementById('gate-result');
let lastQr = '';
let expiresAt = 0;
async function updateGate() {
  try {
    const response = await fetch(kiosk.dataset.kioskState, {cache: 'no-store', headers: {'Accept': 'application/json'}});
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('session');
    const data = await response.json();
    if (data.qr !== lastQr) {
      qr.onload = () => { qr.hidden = false; placeholder.hidden = true; };
      qr.onerror = () => { lastQr = ''; qr.hidden = true; placeholder.hidden = false; placeholder.textContent = 'Atualizando QR Code…'; };
      qr.src = data.qr;
      lastQr = data.qr;
    }
    expiresAt = Date.parse(data.expires_at);
    const link = document.getElementById('mobile-link');
    link.href = data.mobile_url; link.textContent = data.mobile_url;
    const states = {
      granted: ['✓', 'Acesso liberado!', 'Entrada confirmada. Bom treino!'],
      denied: ['×', 'Acesso bloqueado', 'Procure a recepção para verificar seu cadastro.'],
      '': ['◎', 'Aguardando leitura', 'Leia o QR Code no celular e entre com seu ID e PIN.']
    };
    const state = states[data.decision] || states[''];
    result.classList.toggle('granted', data.decision === 'granted');
    result.classList.toggle('denied', data.decision === 'denied');
    document.getElementById('gate-icon').textContent = state[0];
    document.getElementById('gate-title').textContent = state[1];
    document.getElementById('gate-message').textContent = state[2];
    document.getElementById('connection-status').textContent = '● Painel conectado · atualização automática';
  } catch (error) {
    qr.hidden = true; lastQr = ''; placeholder.hidden = false;
    placeholder.textContent = 'Sem conexão com o sistema';
    document.getElementById('connection-status').textContent = 'Verifique a conexão e se a conta de administrador continua conectada. Tentando novamente…';
  } finally { window.setTimeout(updateGate, 1500); }
}
window.setInterval(() => {
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  document.getElementById('qr-countdown').textContent = seconds ? `QR válido por ${seconds}s · renovação automática` : 'Renovando QR Code…';
}, 1000);
updateGate();
