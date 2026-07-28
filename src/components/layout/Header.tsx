import { useLanguageStore } from '../../store';
import type { Language } from '../../types';

export default function Header() {
  const { language, setLanguage } = useLanguageStore();

  const handleLangChange = (lang: Language) => {
    setLanguage(lang);
  };

  return (
    <header className="header">
      <div className="header-left">
        {/* Breadcrumb can be added dynamically per page */}
      </div>
      <div className="header-right">
        <div className="header-lang-toggle">
          <button
            className={`header-lang-btn ${language === 'en' ? 'active' : ''}`}
            onClick={() => handleLangChange('en')}
            aria-pressed={language === 'en'}
            aria-label="Use English"
          >
            EN
          </button>
          <button
            className={`header-lang-btn ${language === 'fa' ? 'active' : ''}`}
            onClick={() => handleLangChange('fa')}
            aria-pressed={language === 'fa'}
            aria-label="Use Persian"
            style={{ fontFamily: 'var(--font-fa)' }}
          >
            فا
          </button>
        </div>
      </div>
    </header>
  );
}
