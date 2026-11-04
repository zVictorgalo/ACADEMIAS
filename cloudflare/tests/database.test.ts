import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createHandler} from '../../supabase/functions/_shared/backend.ts';
import {hashPassword,verifyPassword} from '../../supabase/functions/_shared/crypto.ts';
import worker from '../worker.ts';

const testUrl = process.env.PULSO_TEST_DATABASE_URL;
if (!testUrl) throw new Error('Defina PULSO_TEST_DATABASE_URL para o PostgreSQL local de testes.');
const parsed = new URL(testUrl);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/pulso_test') {
  throw new Error('Os testes exigem um banco local e exclusivo chamado pulso_test.');
}
const db = new pg.Client({connectionString: testUrl});
const key='test-gateway-key-for-local-verification-only';
const origin='https://pulso.example.test';
const rpc=async(operation:string,payload:Record<string,unknown>={})=>{
  const result=await db.query<{value:any}>('select public.pulso_api($1,$2::jsonb) as value',[operation,JSON.stringify(payload)]);
  return result.rows[0].value;
};
const handler=createHandler({gatewayKey:key,rpc});
async function api(path:string,body?:Record<string,unknown>,cookie='',gateway=key){
  const headers=new Headers({'x-pulso-gateway':gateway,'x-pulso-origin':origin,'content-type':'application/json'});
  if(cookie)headers.set('cookie',cookie);
  const response=await handler(new Request('https://supabase.test/functions/v1/pulso-api/api'+path,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)}));
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]??'',cookieHeader:response.headers.get('set-cookie')??''};
}

before(async()=>{
  await db.connect();
  await db.query('BEGIN');
  await db.query(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  end $$;`);
  await db.query(await readFile(new URL('../../supabase/migrations/202611030001_pulso.sql',import.meta.url),'utf8'));
  await db.query('insert into public.pulso_users(username,name,email,password_hash,is_admin) values($1,$2,$3,$4,true)', ['admin','Admin teste','admin@example.test',await hashPassword('SenhaAdmin!2026')]);
});
after(async()=>{await db.query('ROLLBACK');await db.end();});

test('gateway and browser origin reject unauthorized requests',async()=>{
  assert.equal((await api('/health',undefined,'','wrong')).status,403);
  const blocked=await worker.fetch(new Request(origin+'/api/auth/login',{method:'POST',headers:{origin:'https://outro.test','content-type':'application/json'},body:'{}'}),{
    ASSETS:{fetch:async()=>new Response('')},SUPABASE_FUNCTION_URL:'https://supabase.test/functions/v1/pulso-api',PULSO_GATEWAY_SECRET:key,
  });
  assert.equal(blocked.status,403);
  const grants=await db.query<{readable:boolean;callable:boolean}>("select has_table_privilege('anon','public.pulso_users','SELECT') as readable, has_function_privilege('authenticated','public.pulso_api(text,jsonb)','EXECUTE') as callable");
  assert.deepEqual(grants.rows[0],{readable:false,callable:false});
});

test('Django PBKDF2 hash is accepted without resetting the password',async()=>{
  const {pbkdf2Sync}=await import('node:crypto');
  const hash='pbkdf2_sha256$1000000$existingDjangoSalt$'+pbkdf2Sync('0017','existingDjangoSalt',1000000,32,'sha256').toString('base64');
  assert.equal(await verifyPassword('0017',hash),true);
  assert.equal(await verifyPassword('0018',hash),false);
});

test('signup, approval, QR, attendance, blocking and PIN reset work on PostgreSQL',async()=>{
  const signup=await api('/signup',{name:"Ana d'Ávila",email:'ana@example.test',pin:'0123',confirm_pin:'0123',is_admin:true,status:'approved'});
  assert.equal(signup.status,201);
  assert.equal(signup.data.status,'pending');
  assert.equal(signup.data.access_id,'000001');
  const memberId=signup.data.id;
  const student=await api('/auth/login',{identifier:signup.data.access_id,password:'0123'});
  assert.equal(student.status,200);
  assert.equal(student.data.user.is_admin,false);
  assert.equal('password_hash' in student.data.user,false);
  assert.match(student.cookieHeader,/HttpOnly.*Secure/);
  assert.equal((await api('/admin/members',undefined,student.cookie)).status,403);
  const admin=await api('/auth/login',{identifier:'admin',password:'SenhaAdmin!2026'});
  assert.equal(admin.data.user.is_admin,true);
  assert.equal((await api(`/admin/members/${memberId}/status`,{status:'approved'},admin.cookie)).status,200);
  const terminal=await api('/terminals',{},admin.cookie);
  const board=()=>api('/terminals/'+terminal.data.id,undefined,admin.cookie);
  const first=await board();
  assert.match(first.data.mobile_url,/^https:\/\/pulso\.example\.test\/acesso\//);
  assert.equal((await api('/tickets/'+first.data.ticket_id)).data.expired,false);
  assert.equal((await api('/me',undefined,student.cookie)).data.entries.length,0);
  const entry=await api('/entry',{ticket_id:first.data.ticket_id,identifier:signup.data.access_id,password:'0123'});
  assert.equal(entry.data.decision,'granted');
  const next=await board();
  assert.equal(next.data.decision,'granted');
  assert.notEqual(next.data.ticket_id,first.data.ticket_id);
  assert.equal((await api('/entry',{ticket_id:first.data.ticket_id},entry.cookie)).data.decision,'granted');
  assert.equal((await api('/entry',{ticket_id:next.data.ticket_id},entry.cookie)).data.decision,'granted');
  assert.equal((await api('/me',undefined,entry.cookie)).data.entries.length,1);
  const blocked=await api(`/admin/members/${memberId}/status`,{status:'blocked',reason:'overdue',notes:'Visível só para a equipe'},admin.cookie);
  assert.equal(blocked.status,200);
  const blockedQr=await board();
  assert.equal((await api('/entry',{ticket_id:blockedQr.data.ticket_id},entry.cookie)).data.decision,'denied');
  assert.equal((await board()).data.decision,'denied');
  const me=await api('/me',undefined,entry.cookie);
  assert.equal(me.data.member.block_reason,'overdue');
  assert.equal('block_notes' in me.data.member,false);
  assert.equal(me.data.entries.length,1);
  assert.equal((await api('/admin/members?reason=overdue',undefined,admin.cookie)).data.members.length,1);
  const expired=await board();
  await db.query("update public.pulso_tickets set expires_at=now()-interval '1 second' where id=$1",[expired.data.ticket_id]);
  assert.equal((await api('/entry',{ticket_id:expired.data.ticket_id},entry.cookie)).data.expired,true);
  assert.equal((await api(`/admin/members/${memberId}/pin`,{pin:'4321',confirm_pin:'4321'},admin.cookie)).status,200);
  assert.equal((await api('/me',undefined,entry.cookie)).status,401);
  assert.equal((await api('/auth/login',{identifier:signup.data.access_id,password:'0123'})).status,401);
  assert.equal((await api('/auth/login',{identifier:signup.data.access_id,password:'4321'})).status,200);
});
