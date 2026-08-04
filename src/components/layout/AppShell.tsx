import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import ToastContainer from '../shared/ToastContainer';
import AnnouncementBanner from '../shared/AnnouncementBanner';
import UpdateBanner from '../shared/UpdateBanner';

export default function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <Header />
        <UpdateBanner />
        <AnnouncementBanner />
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  );
}
