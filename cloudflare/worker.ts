export interface Env {
  ASSETS: {fetch(request: Request): Promise<Response>};
  SUPABASE_FUNCTION_URL: string;
  PULSO_GATEWAY_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const reply = (message: string, status: number) => Response.json({error: message}, {status, headers: {'Cache-Control':'no-store'}});
    if (!['GET','POST'].includes(request.method)) return reply('Método não permitido.', 405);
    if (!env.SUPABASE_FUNCTION_URL || !env.PULSO_GATEWAY_SECRET || env.PULSO_GATEWAY_SECRET.length < 32) return reply('Configuração do servidor pendente.', 503);
    if (request.method === 'POST') {
      // Formulários externos não podem enviar ações usando a sessão do navegador.
      if (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json')) return reply('Origem ou formulário não autorizado.', 403);
      if (Number(request.headers.get('content-length') ?? 0) > 10000) return reply('Formulário muito grande.', 413);
    }
    let target: URL;
    try { target = new URL(env.SUPABASE_FUNCTION_URL.replace(/\/$/,'') + url.pathname + url.search); }
    catch { return reply('Configuração do servidor pendente.',503); }
    if (target.protocol !== 'https:' && target.hostname !== '127.0.0.1' && target.hostname !== 'localhost') return reply('Configuração do servidor inválida.',503);
    const headers = new Headers({
      'Content-Type':'application/json', 'Accept':'application/json',
      'X-Pulso-Gateway': env.PULSO_GATEWAY_SECRET,
      'X-Pulso-Origin': url.origin,
      'X-Pulso-IP': request.headers.get('cf-connecting-ip') ?? 'local',
    });
    const cookie = request.headers.get('cookie');
    if (cookie) headers.set('Cookie',cookie);
    const body = request.method === 'POST' ? await request.text() : undefined;
    if (body && body.length > 10000) return reply('Formulário muito grande.',413);
    try {
      const upstream = await fetch(target, {method:request.method, headers, body, redirect:'error', signal:AbortSignal.timeout(20000)});
      const responseHeaders = new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      const setCookie = upstream.headers.get('set-cookie');
      if (setCookie) responseHeaders.set('Set-Cookie',setCookie);
      return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
    } catch { return reply('O servidor está temporariamente indisponível. Tente novamente.',502); }
  },
};
