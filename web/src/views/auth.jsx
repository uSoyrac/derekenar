import { useState } from 'preact/hooks';
import { signIn, enterLocal } from '../state.js';

const MESSAGES = [
  [/invalid login/i, 'E-posta ya da şifre hatalı'],
  [/already registered|already exists/i, 'Bu e-postayla bir hesap zaten var; giriş yapmayı dene'],
  [/at least 6/i, 'Şifre en az 6 karakter olmalı'],
  [/email not confirmed/i, 'E-postandaki onay bağlantısına tıkladıktan sonra giriş yap'],
  [/failed to fetch|network/i, 'Sunucuya ulaşılamadı; bağlantını kontrol et'],
];
const translate = (msg) => (MESSAGES.find(([re]) => re.test(msg)) || [null, msg])[1];

export function AuthView() {
  const [isNew, setIsNew] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [working, setWorking] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setWorking(true); setStatus(null);
    try {
      const ok = await signIn(email.trim(), password, isNew);
      if (!ok) { setStatus({ kind: 'info', text: 'Hesabın oluşturuldu. E-postana gelen onay bağlantısına tıkla, sonra buradan giriş yap.' }); setIsNew(false); }
    } catch (err) {
      setStatus({ kind: 'error', text: translate(err.message) });
    }
    setWorking(false);
  };

  return (
    <main class="auth">
      <div class="auth-card">
        <h1 class="brand">Derkenar</h1>
        <p class="lead">Okurken altını çizdiklerin, bütün cihazlarında tek bir hafızada.</p>
        <form onSubmit={submit} class="quote-form">
          <label>E-posta<input type="email" required autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} /></label>
          <label>Şifre<input type="password" required minLength={6} autocomplete={isNew ? 'new-password' : 'current-password'} value={password} onInput={(e) => setPassword(e.currentTarget.value)} /></label>
          {status && <p class={`status ${status.kind}`} role="alert">{status.text}</p>}
          <button class="btn primary block" type="submit" disabled={working}>{working ? 'Bekle…' : isNew ? 'Hesap oluştur' : 'Giriş yap'}</button>
        </form>
        <button class="link-btn" onClick={() => { setIsNew(!isNew); setStatus(null); }}>
          {isNew ? 'Zaten hesabım var, giriş yap' : 'Hesabım yok, oluştur'}
        </button>
        <hr />
        <button class="btn block" onClick={enterLocal}>Hesapsız dene (yalnızca bu cihazda saklanır)</button>
      </div>
    </main>
  );
}
