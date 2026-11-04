import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';

// DATABASE_URL deve ser a conexão PostgreSQL do Supabase, não a URL HTTP do projeto.
// Nenhuma credencial é recebida pela linha de comando ou escrita no repositório.
if(!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL no ambiente ou em .env.supabase (ignorado pelo Git).');
const file=process.argv[2] || 'private-exports/pulso-import.sql';
const sql=await readFile(file,'utf8');
const manifest=JSON.parse(await readFile(file.replace(/\.sql$/,'.manifest.json'),'utf8'));
if(createHash('sha256').update(sql).digest('hex')!==manifest.sha256)throw new Error('O SQL difere do manifesto. Exporte novamente antes de importar.');
const database=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:true}});
try{
  await database.connect();
  // O SQL contém BEGIN/COMMIT e recusa um destino já preenchido, sem sobrescrever dados.
  await database.query(sql);
  const {rows}=await database.query(`select 'pulso_users' as table_name,count(*)::int as count from public.pulso_users union all select 'pulso_members',count(*)::int from public.pulso_members union all select 'pulso_entries',count(*)::int from public.pulso_entries union all select 'pulso_events',count(*)::int from public.pulso_events`);
  for(const row of rows)if(row.count!==manifest.counts[row.table_name])throw new Error('Contagem inesperada após importar. Verifique o banco antes de publicar.');
  console.log('Importação concluída; contagens de contas, cadastros, presenças e histórico conferidas.');
}catch(error){
  await database.query('ROLLBACK').catch(()=>{});
  console.error('A importação não foi concluída. O destino deve estar vazio e a conexão deve usar SSL válido.');
  process.exitCode=1;
}finally{await database.end().catch(()=>{});}
