import { createHandler } from '../_shared/backend.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
// Esta chave fica somente no ambiente da função, nunca no Worker ou no navegador.
const injectedKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
const serviceKey = injectedKeys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const gatewayKey = Deno.env.get('PULSO_GATEWAY_SECRET') ?? '';

Deno.serve(createHandler({
  gatewayKey,
  rpc: async (operation, payload = {}) => {
    if (!supabaseUrl || !serviceKey) throw new Error('Credencial interna do Supabase indisponível.');
    const headers = new Headers({'Content-Type': 'application/json', apikey: serviceKey});
    if (!serviceKey.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${serviceKey}`);
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/pulso_api`, {
      method: 'POST',
      headers,
      body: JSON.stringify({op: operation, p: payload}),
    });
    if (!response.ok) throw new Error('Falha na operação do banco.');
    return response.json();
  },
}));
