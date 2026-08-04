import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import ToastContainer from '../shared/ToastContainer';
import AnnouncementBanner from '../shared/AnnouncementBanner';

export default function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <Header />
        <AnnouncementBanner />
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  );
}
