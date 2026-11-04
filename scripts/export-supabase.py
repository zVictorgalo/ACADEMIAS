"""Exporta um snapshot SQLite do Django para o esquema PostgreSQL do Pulso.

O resultado contém hashes e dados pessoais: permanece em private-exports/, fora do Git.
Não exporta sessões de login nem QR Codes temporários.
"""
import argparse
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, int):
        if abs(value) > 9007199254740991:
            raise ValueError('ID maior que o limite seguro da versão web.')
        return str(value)
    value = str(value)
    if '\x00' in value:
        raise ValueError('Dado contém caractere NUL; revise o registro antes de migrar.')
    return "'" + value.replace("'", "''") + "'"


def timestamp(value):
    parsed = datetime.fromisoformat(str(value))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def export(database, output):
    if not database.is_file():
        raise ValueError(f'Banco não encontrado: {database}')
    # O backup em memória produz um snapshot consistente, sem alterar o banco-fonte.
    snapshot = sqlite3.connect(':memory:')
    with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as source:
        source.backup(snapshot)
    snapshot.row_factory = sqlite3.Row
    counts = {}
    statements = [
        '-- Dados privados do Pulso: não publicar no GitHub.',
        'BEGIN;',
        'LOCK TABLE public.pulso_users, public.pulso_members, public.pulso_entries, public.pulso_events IN SHARE ROW EXCLUSIVE MODE;',
        "DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.pulso_users) OR EXISTS(SELECT 1 FROM public.pulso_members) OR EXISTS(SELECT 1 FROM public.pulso_entries) OR EXISTS(SELECT 1 FROM public.pulso_events) THEN RAISE EXCEPTION 'O destino já tem dados. Importe somente em um banco Pulso vazio.'; END IF; END $$;",
    ]

    def write(table, columns, rows):
        counts[table] = len(rows)
        for row in rows:
            statements.append(f"INSERT INTO public.{table} ({','.join(columns)}) VALUES ({','.join(literal(v) for v in row)});")

    users = []
    for row in snapshot.execute('SELECT * FROM auth_user ORDER BY id'):
        encoded = row['password']
        if not encoded.startswith(('pbkdf2_sha256$', 'pbkdf2_sha1$', '!')):
            raise ValueError(f"Conta ID {row['id']} usa hash não suportado. Redefina sua senha/PIN no Django antes de exportar.")
        users.append((row['id'], row['username'], row['first_name'] or row['username'], row['email'], encoded,
                      bool(row['is_superuser']), bool(row['is_active']), timestamp(row['date_joined'])))
    write('pulso_users', ['id','username','name','email','password_hash','is_admin','is_active','created_at'], users)
    write('pulso_members', ['id','user_id','role','status','block_reason','block_notes','created_at'], [
        (r['id'],r['user_id'],r['role'],r['status'],r['block_reason'],r['block_notes'],timestamp(r['created_at']))
        for r in snapshot.execute('SELECT * FROM gym_member ORDER BY id')])
    write('pulso_entries', ['id','member_id','created_at','day'], [
        (r['id'],r['member_id'],timestamp(r['created_at']),r['day'])
        for r in snapshot.execute('SELECT * FROM gym_entry ORDER BY id')])
    write('pulso_events', ['id','member_id','actor_id','status','reason','notes','created_at'], [
        (r['id'],r['member_id'],r['actor_id'],r['status'],r['reason'],r['notes'],timestamp(r['created_at']))
        for r in snapshot.execute('SELECT * FROM gym_statusevent ORDER BY id')])
    for table in counts:
        statements.append(f"SELECT setval(pg_get_serial_sequence('public.{table}','id'),COALESCE((SELECT MAX(id) FROM public.{table}),0)+1,false);")
    statements.append('COMMIT;')
    content = '\n'.join(statements) + '\n'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(content.encode('utf-8'))
    manifest = {'source': database.name, 'counts': counts, 'sha256': hashlib.sha256(content.encode()).hexdigest(),
                'passwords': 'Hashes existentes preservados. Nenhuma senha em texto puro.',
                'temporary_data': 'Sessões, tentativas de login, terminais e QR Codes não são migrados.'}
    output.with_suffix('.manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    snapshot.close()
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database',type=Path,default=ROOT/'data'/'academia.sqlite3')
    parser.add_argument('--output',type=Path,default=ROOT/'private-exports'/'pulso-import.sql')
    args = parser.parse_args()
    manifest = export(args.database,args.output)
    print('Exportação concluída. Guarde o SQL em local privado; ele não deve ir ao GitHub.')
    print(json.dumps(manifest['counts'], ensure_ascii=False))
