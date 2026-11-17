// Bulut kullanımı: Supabase (Postgres + Auth). Satır güvenliği sunucuda; burada yalnızca sorgular var.
import { createClient } from '@supabase/supabase-js';

const PAGE = 1000; // Supabase tek istekte en fazla 1000 satır döndürür.
const CHUNK = 400;

const fail = (error) => {
  if (error) throw new Error(error.message || String(error));
};

export function createCloudDriver({ url, key }) {
  const client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'derkenar.auth' },
  });

  return {
    kind: 'cloud',
    client,

    async all(table) {
      // Sunucunun satır sınırı PAGE'den küçük olabilir; boş sayfa gelene dek devam edilir.
      const out = [];
      for (;;) {
        const { data, error } = await client.from(table).select('*')
          .order('created_at', { ascending: true }).order('id', { ascending: true })
          .range(out.length, out.length + PAGE - 1);
        fail(error);
        if (!data.length) break;
        out.push(...data);
      }
      return out;
    },

    // Eklenen satırları döndürür. Parmak izi çakışan satırlar sessizce atlanır.
    async insert(table, rows) {
      const out = [];
      const dedupe = table === 'sources' || table === 'quotes';
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const query = dedupe
          ? client.from(table).upsert(chunk, { onConflict: 'user_id,fingerprint', ignoreDuplicates: true })
          : client.from(table).insert(chunk);
        const { data, error } = await query.select();
        fail(error);
        out.push(...data);
      }
      return out;
    },

    async update(table, id, patch) {
      const { data, error } = await client.from(table).update(patch).eq('id', id).select();
      fail(error);
      return data[0] || null;
    },

    async remove(table, id) {
      const { error } = await client.from(table).delete().eq('id', id);
      fail(error);
    },

    // --- oturum ---
    async session() {
      const { data } = await client.auth.getSession();
      return data.session;
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      fail(error);
      return data.session;
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({
        email, password, options: { emailRedirectTo: location.origin + location.pathname },
      });
      fail(error);
      return data.session; // E-posta onayı gerekiyorsa null döner.
    },
    async signOut() {
      await client.auth.signOut({ scope: 'local' });
    },

    // --- bağlantı kodları (eklenti ve kısayol için) ---
    async listTokens() {
      const { data, error } = await client.from('api_tokens')
        .select('id,label,created_at,last_used_at').order('created_at', { ascending: false });
      fail(error);
      return data;
    },
    async createToken(label) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const token_hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const { error } = await client.from('api_tokens').insert({ token_hash, label });
      fail(error);
      return token;
    },
    async revokeToken(id) {
      const { error } = await client.from('api_tokens').delete().eq('id', id);
      fail(error);
    },
  };
}
