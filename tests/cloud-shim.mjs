// Test amaçlı Supabase taklidi: gerçek Postgres (PGlite, WASM) üzerinde
// şema + RLS + RPC fonksiyonlarını çalıştırır; PostgREST ve Auth uç noktalarının
// uygulamanın kullandığı alt kümesini sunar. Üretimde kullanılmaz.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const here = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = 'test-secret';
const NAME = /^[a-z_][a-z0-9_]*$/;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signJwt(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [head, body, sig] = String(token || '').split('.');
  if (!head || !body || !sig) return null;
  const want = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  if (want !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && payload.exp < Date.now() / 1000) return null;
  return payload;
}

export async function startShim({ port = 0, maxRows = 1000 } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text unique not null);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const migrations = path.join(here, '..', 'supabase', 'migrations');
  for (const f of fs.readdirSync(migrations).sort()) {
    await db.exec(fs.readFileSync(path.join(migrations, f), 'utf8'));
  }

  const users = new Map(); // email -> {id, email, password}
  const refreshTokens = new Map(); // refresh -> email
  const anonKey = signJwt({ role: 'anon', iss: 'shim' });

  function session(user) {
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now });
    const refresh = crypto.randomBytes(12).toString('hex');
    refreshTokens.set(refresh, user.email);
    return {
      access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
      refresh_token: refresh, user: publicUser(user),
    };
  }
  const publicUser = (u) => ({
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.created_at, app_metadata: { provider: 'email' }, user_metadata: {},
    created_at: u.created_at, updated_at: u.created_at,
  });

  async function auth(req, url, body, claims) {
    const p = url.pathname.replace('/auth/v1', '');
    if (p === '/signup' && req.method === 'POST') {
      const email = String(body.email || '').toLowerCase();
      if (!email || String(body.password || '').length < 6) return [422, { code: 422, msg: 'Password should be at least 6 characters' }];
      if (users.has(email)) return [422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }];
      const user = { id: crypto.randomUUID(), email, password: body.password, created_at: new Date().toISOString() };
      users.set(email, user);
      await db.query('insert into auth.users (id, email) values ($1, $2)', [user.id, email]);
      return [200, session(user)];
    }
    if (p === '/token' && req.method === 'POST') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const user = users.get(String(body.email || '').toLowerCase());
        if (!user || user.password !== body.password) return [400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }];
        return [200, session(user)];
      }
      if (grant === 'refresh_token') {
        const email = refreshTokens.get(body.refresh_token);
        if (!email) return [400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }];
        refreshTokens.delete(body.refresh_token);
        return [200, session(users.get(email))];
      }
    }
    if (p === '/user' && req.method === 'GET') {
      const user = claims && [...users.values()].find((u) => u.id === claims.sub);
      return user ? [200, publicUser(user)] : [401, { code: 401, msg: 'invalid JWT' }];
    }
    if (p === '/logout') return [204, null];
    return [404, { msg: 'not found' }];
  }

  function parseFilters(params, values) {
    const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
    const parts = [];
    for (const [k, raw] of params) {
      if (reserved.has(k)) continue;
      if (!NAME.test(k)) throw Object.assign(new Error(`bad column ${k}`), { status: 400 });
      const dot = raw.indexOf('.');
      const op = raw.slice(0, dot);
      const val = raw.slice(dot + 1);
      const simple = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
      if (simple) {
        values.push(val);
        parts.push(`${k}::text ${simple === '=' || simple === '<>' ? simple : simple} $${values.length}`);
      } else if (op === 'in') {
        const list = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
        values.push(list);
        parts.push(`${k}::text = any($${values.length}::text[])`);
      } else if (op === 'is' && val === 'null') {
        parts.push(`${k} is null`);
      } else {
        throw Object.assign(new Error(`unsupported filter ${k}=${raw}`), { status: 400 });
      }
    }
    return parts.length ? ` where ${parts.join(' and ')}` : '';
  }

  async function rest(req, url, body, claims) {
    const seg = url.pathname.replace('/rest/v1/', '').split('/');
    const prefer = String(req.headers.prefer || '');
    const wantRows = prefer.includes('return=representation');
    const wantObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
    const role = claims?.role === 'authenticated' ? 'authenticated' : 'anon';
    const claimJson = JSON.stringify(claims || {});

    return db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [claimJson]);
      await tx.exec(`set local role ${role}`);

      if (seg[0] === 'rpc') {
        const fn = seg[1];
        if (!NAME.test(fn)) return [404, { message: 'no function' }];
        const keys = Object.keys(body || {});
        const values = [];
        const args = keys.map((k) => {
          if (!NAME.test(k)) throw new Error('bad arg');
          const v = body[k];
          if (v !== null && typeof v === 'object') { values.push(JSON.stringify(v)); return `${k} => $${values.length}::jsonb`; }
          values.push(v === null ? null : String(v));
          return `${k} => $${values.length}::text`;
        });
        const r = await tx.query(`select to_jsonb(public.${fn}(${args.join(', ')})) as r`, values);
        return [200, r.rows[0].r];
      }

      const table = seg[0];
      if (!NAME.test(table)) return [404, { message: 'no table' }];
      const q = url.searchParams;
      const values = [];

      if (req.method === 'GET') {
        const where = parseFilters(q, values);
        let order = '';
        if (q.get('order')) {
          order = ' order by ' + q.get('order').split(',').map((o) => {
            const [col, dir] = o.split('.');
            if (!NAME.test(col)) throw new Error('bad order');
            return `${col} ${dir === 'desc' ? 'desc' : 'asc'}`;
          }).join(', ');
        }
        const limit = Math.min(Number(q.get('limit') ?? maxRows), maxRows);
        const offset = Number(q.get('offset') ?? 0);
        const r = await tx.query(
          `select to_jsonb(x) as j from (select * from public.${table}${where}${order} limit ${limit} offset ${offset}) x`, values);
        const rows = r.rows.map((x) => x.j);
        return [200, wantObject ? rows[0] : rows];
      }

      if (req.method === 'POST') {
        const rows = Array.isArray(body) ? body : [body];
        if (!rows.length) return [201, wantRows ? [] : null];
        const cols = (q.get('columns') ? q.get('columns').split(',').map((c) => c.replace(/"/g, '')) : Object.keys(rows[0]));
        if (!cols.every((c) => NAME.test(c))) throw new Error('bad columns');
        let conflict = '';
        if (prefer.includes('resolution=ignore-duplicates')) {
          conflict = q.get('on_conflict') ? ` on conflict (${q.get('on_conflict')}) do nothing` : ' on conflict do nothing';
        } else if (prefer.includes('resolution=merge-duplicates')) {
          const oc = q.get('on_conflict') || 'id';
          conflict = ` on conflict (${oc}) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`;
        }
        const r = await tx.query(
          `with ins as (insert into public.${table} (${cols.join(', ')})
             select ${cols.join(', ')} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)${conflict} returning *)
           select to_jsonb(ins) as j from ins`, [JSON.stringify(rows)]);
        const out = r.rows.map((x) => x.j);
        return [201, wantRows ? (wantObject ? out[0] : out) : null];
      }

      if (req.method === 'PATCH') {
        const cols = Object.keys(body || {});
        if (!cols.length || !cols.every((c) => NAME.test(c))) throw new Error('bad columns');
        values.push(JSON.stringify(body));
        const where = parseFilters(q, values);
        const r = await tx.query(
          `with upd as (update public.${table} set (${cols.join(', ')}) =
             (select ${cols.join(', ')} from jsonb_populate_record(null::public.${table}, $1::jsonb))${where} returning *)
           select to_jsonb(upd) as j from upd`, values);
        const out = r.rows.map((x) => x.j);
        return [wantRows ? 200 : 204, wantRows ? (wantObject ? out[0] : out) : null];
      }

      if (req.method === 'DELETE') {
        const where = parseFilters(q, values);
        if (!where) return [400, { message: 'DELETE requires a filter' }];
        const r = await tx.query(
          `with del as (delete from public.${table}${where} returning *) select to_jsonb(del) as j from del`, values);
        const out = r.rows.map((x) => x.j);
        return [wantRows ? 200 : 204, wantRows ? out : null];
      }
      return [405, { message: 'method not allowed' }];
    });
  }

  const server = http.createServer(async (req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-expose-headers': 'content-range',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer /i, '');
    const claims = verifyJwt(bearer);
    let status = 500, out = null;
    try {
      if (url.pathname.startsWith('/auth/v1')) [status, out] = await auth(req, url, body || {}, claims);
      else if (url.pathname.startsWith('/rest/v1/')) {
        if (!req.headers.apikey) [status, out] = [401, { message: 'No API key found in request' }];
        else [status, out] = await rest(req, url, body, claims);
      } else [status, out] = [404, { message: 'not found' }];
    } catch (e) {
      const code = e.code || 'XX000';
      status = e.status || (code === '42501' || code === '28000' ? 403 : code === '23505' ? 409 : 400);
      out = { code, message: e.message, details: e.detail || null, hint: e.hint || null };
    }
    res.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8' });
    res.end(out === null || out === undefined ? '' : JSON.stringify(out));
  });
  // port 0: işletim sistemi boş bir kapı seçer (sabit kapılar başka bağlantılarla çakışabiliyor).
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { db, server, url: `http://127.0.0.1:${server.address().port}`, anonKey, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shim = await startShim({ port: Number(process.env.PORT || 0), maxRows: Number(process.env.MAX_ROWS || 1000) });
  console.log(`shim ${shim.url}\nanon key: ${shim.anonKey}`);
}
