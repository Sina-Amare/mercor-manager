import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguageStore } from '../store';
import { login as apiLogin } from '../api/auth';
import type { Language } from '../types';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { t, language, setLanguage } = useLanguageStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await apiLogin(username, password);
      navigate('/');
    } catch {
      setError(t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">A</div>
          <h1>{t('app_name')}</h1>
          <p>{t('login.subtitle')}</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              {t('login.username')}
            </label>
            <input
              id="username"
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              {t('login.password')}
            </label>
            <input
              id="password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg login-submit"
            disabled={loading}
          >
            {loading ? t('common.loading') : t('login.submit')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 'var(--space-6)' }}>
          <div className="header-lang-toggle" style={{ display: 'inline-flex' }}>
            <button
              className={`header-lang-btn ${language === 'en' ? 'active' : ''}`}
              onClick={() => setLanguage('en' as Language)}
            >
              EN
            </button>
            <button
              className={`header-lang-btn ${language === 'fa' ? 'active' : ''}`}
              onClick={() => setLanguage('fa' as Language)}
              style={{ fontFamily: 'var(--font-fa)' }}
            >
              فا
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
