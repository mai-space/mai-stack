import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api.js';

interface Props {
  onAuthenticated: () => void;
}

export default function Login({ onAuthenticated }: Props) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(secret);
      onAuthenticated();
      navigate('/');
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">mai</div>
        <div className="login-subtitle">Enter your dashboard secret to continue</div>
        <input
          type="password"
          placeholder="Dashboard secret"
          value={secret}
          onChange={e => setSecret(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn-primary login-btn" disabled={busy || !secret.trim()}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div className="error-msg">{error}</div>}
      </form>
    </div>
  );
}
