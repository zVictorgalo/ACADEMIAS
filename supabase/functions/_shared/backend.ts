import { hashPassword, randomToken, sameValue, sha256, verifyPassword } from './crypto.ts';

export type Payload = Record<string, unknown>;
export type Rpc = (operation: string, payload?: Payload) => Promise<any>;
type User = {id: number; is_admin: boolean; password_hash?: string};
type Options = {gatewayKey: string; rpc: Rpc};
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ['unpaid', 'overdue', 'expired', 'requested', 'other'];
const COOKIE = 'pulso_session';

function text(value: unknown, label: string, max = 150): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${label}: preencha um valor válido.`);
  return value.trim();
}
function pin(body: Payload): string {
  if (typeof body.pin !== 'string' || !/^[0-9]{4,32}$/.test(body.pin)) throw new HttpError(400, 'O PIN deve ter de 4 a 32 números.');
  if (body.pin !== body.confirm_pin) throw new HttpError(400, 'Os PINs precisam ser iguais.');
  return body.pin;
}
function positiveId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'ID inválido.');
  return id;
}
function uuid(value: string): string {
  if (!UUID.test(value)) throw new HttpError(400, 'QR Code inválido.');
  return value;
}
function cookieToken(request: Request): string {
  const value = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
  return /^[0-9a-f]{64}$/.test(value) ? value : '';
}
function sessionCookie(token: string, origin: string, logout = false): string {
  const secure = new URL(origin).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${logout ? 0 : 28800}${secure}`;
}
function json(data: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), {status, headers});
}

export function createHandler({gatewayKey, rpc}: Options) {
  return async function handle(request: Request): Promise<Response> {
    let setCookie: string | undefined;
    try {
      if (gatewayKey.length < 32 || !sameValue(request.headers.get('x-pulso-gateway') ?? '', gatewayKey)) throw new HttpError(403, 'Gateway não autorizado.');
      const origin = request.headers.get('x-pulso-origin') ?? '';
      let originUrl: URL;
      try { originUrl = new URL(origin); } catch { throw new HttpError(400, 'Origem inválida.'); }
      if (!['https:', 'http:'].includes(originUrl.protocol) || originUrl.origin !== origin) throw new HttpError(400, 'Origem inválida.');
      const url = new URL(request.url);
      const apiIndex = url.pathname.indexOf('/api/');
      const path = apiIndex >= 0 ? url.pathname.slice(apiIndex + 4) : '';
      if (!['GET', 'POST'].includes(request.method)) throw new HttpError(405, 'Método não permitido.');
      let body: Payload = {};
      if (request.method === 'POST') {
        const raw = await request.text();
        if (raw.length > 10000) throw new HttpError(413, 'Formulário muito grande.');
        try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Formulário inválido.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Formulário inválido.');
      }
      const token = cookieToken(request);
      let user: User | null = token ? await rpc('session_get', {token_hash: await sha256(token)}) : null;
      const requireUser = () => { if (!user) throw new HttpError(401, 'Entre na sua conta.'); return user; };
      const requireAdmin = () => { const actor = requireUser(); if (!actor.is_admin) throw new HttpError(403, 'Acesso restrito ao administrador.'); return actor; };
      const rate = async (key: string, limit: number, seconds: number) => {
        const result = await rpc('rate', {key: await sha256(key), limit, seconds});
        if (!result.allowed) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
      };
      const authenticate = async () => {
        let identifier = text(body.identifier, 'ID ou usuário');
        if (/^[0-9]+$/.test(identifier)) identifier = identifier.replace(/^0+(?=\d)/, '');
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password || password.length > 256) throw new HttpError(400, 'Informe o PIN ou senha.');
        await rate(`ip-login:${request.headers.get('x-pulso-ip') ?? 'local'}`, 50, 300);
        await rate(`login:${identifier.toLowerCase()}`, 5, 300);
        const account = await rpc('login_lookup', {identifier});
        // Executa um hash mesmo para ID inexistente, evitando resposta imediata distinta.
        const encoded = account?.password_hash ?? 'pbkdf2_sha256$1000000$dummy-pulso$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        const valid = await verifyPassword(password, encoded);
        if (!account || !valid) throw new HttpError(401, 'ID/usuário ou PIN/senha incorretos.');
        await rpc('rate_clear', {key: await sha256(`login:${identifier.toLowerCase()}`)});
        const newToken = randomToken();
        await rpc('session_create', {token_hash: await sha256(newToken), user_id: account.id});
        setCookie = sessionCookie(newToken, origin);
        user = {id: account.id, is_admin: account.is_admin};
        return user;
      };

      if (path === '/health' && request.method === 'GET') return json(await rpc('health'));
      if (path === '/auth/login' && request.method === 'POST') {
        await authenticate();
        return json(await rpc('me', {actor_id: requireUser().id}), 200, setCookie);
      }
      if (path === '/auth/logout' && request.method === 'POST') {
        if (token) await rpc('session_delete', {token_hash: await sha256(token)});
        return json({ok: true}, 200, sessionCookie('', origin, true));
      }
      if (path === '/signup' && request.method === 'POST') {
        await rate(`signup:${request.headers.get('x-pulso-ip') ?? 'local'}`, 10, 600);
        const name = text(body.name, 'Nome');
        const email = text(body.email, 'E-mail', 254);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
        return json(await rpc('signup', {name, email, password_hash: await hashPassword(pin(body))}), 201);
      }
      if (path === '/me' && request.method === 'GET') return json(await rpc('me', {actor_id: requireUser().id}));
      if (path === '/admin/members' && request.method === 'GET') {
        const actor = requireAdmin();
        return json(await rpc('management', {actor_id: actor.id, q: (url.searchParams.get('q') ?? '').slice(0,150), status: url.searchParams.get('status') ?? '', reason: url.searchParams.get('reason') ?? ''}));
      }
      if (path === '/admin/members' && request.method === 'POST') {
        const actor = requireAdmin();
        const role = body.role === 'employee' ? 'employee' : 'student';
        const email = text(body.email, 'E-mail', 254);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Informe um e-mail válido.');
        return json(await rpc('signup', {actor_id: actor.id, name: text(body.name, 'Nome'), email, role, password_hash: await hashPassword(pin(body))}), 201);
      }
      const memberAction = path.match(/^\/admin\/members\/(\d+)\/(status|pin)$/);
      if (memberAction && request.method === 'POST') {
        const actor = requireAdmin();
        const member_id = positiveId(memberAction[1]);
        if (memberAction[2] === 'pin') return json(await rpc('pin_reset', {actor_id: actor.id, member_id, password_hash: await hashPassword(pin(body))}));
        if (!['approved','blocked','rejected'].includes(String(body.status))) throw new HttpError(400, 'Situação inválida.');
        if (body.status === 'blocked' && !REASONS.includes(String(body.reason))) throw new HttpError(400, 'Selecione o motivo do bloqueio.');
        return json(await rpc('member_status', {actor_id: actor.id, member_id, status: body.status, reason: body.reason ?? '', notes: typeof body.notes === 'string' ? body.notes.slice(0,500) : ''}));
      }
      if (path === '/terminals' && request.method === 'POST') return json(await rpc('terminal_create', {actor_id: requireAdmin().id}), 201);
      const stateMatch = path.match(/^\/terminals\/([^/]+)$/);
      if (stateMatch && request.method === 'GET') {
        const state = await rpc('terminal_state', {actor_id: requireAdmin().id, terminal_id: uuid(stateMatch[1])});
        return json({...state, mobile_url: `${origin}/acesso/${state.ticket_id}/`});
      }
      const ticketMatch = path.match(/^\/tickets\/([^/]+)$/);
      if (ticketMatch && request.method === 'GET') return json(await rpc('ticket_info', {ticket_id: uuid(ticketMatch[1]), ...(user ? {actor_id: user.id} : {})}));
      if (path === '/entry' && request.method === 'POST') {
        const ticket_id = uuid(String(body.ticket_id ?? ''));
        if (!user) await authenticate();
        const result = await rpc('ticket_consume', {ticket_id, actor_id: requireUser().id});
        return json(result, 200, setCookie);
      }
      throw new HttpError(404, 'Endereço não encontrado.');
    } catch (error) {
      if (error instanceof HttpError) return json({error: error.message}, error.status, setCookie);
      // Nunca envia SQL, hashes, chaves ou detalhes internos ao navegador.
      console.error('Pulso: falha interna na operação.');
      return json({error: 'Não foi possível concluir. Tente novamente ou procure a recepção.'}, 500, setCookie);
    }
  };
}
