import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reloadWithCacheBust } from '../../utils/pageRecovery';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The application could not render:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const isPersian = document.documentElement.dir === 'rtl';

    return (
      <main className="app-error-screen" role="alert">
        <div className="app-error-card">
          <span className="app-error-icon" aria-hidden="true">!</span>
          <h1>{isPersian ? 'صفحه بارگذاری نشد' : 'The page could not load'}</h1>
          <p>
            {isPersian
              ? 'نسخه جدیدی از برنامه منتشر شده یا اتصال شبکه قطع شده است.'
              : 'A new app version may be available, or the network connection was interrupted.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={reloadWithCacheBust}>
            {isPersian ? 'بارگذاری دوباره' : 'Reload page'}
          </button>
        </div>
      </main>
    );
  }
}
