import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Compass, ArrowLeft, LayoutDashboard } from 'lucide-react';

/**
 * Shown for a URL inside the management shell that matches no screen.
 *
 * This route used to bounce to the Command Center, which quietly told people
 * their typo, stale bookmark or renamed link had worked. It renders inside the
 * normal shell, so the sidebar is still there and the two buttons below cover
 * the rest: back where they came from, or the screen everyone starts on.
 *
 * Signed-out visitors never reach this page — the shell's auth guard sends them
 * to the login screen first, so a wrong URL doesn't hand out a 404 from behind
 * the wall.
 */
export default function NotFound() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-16">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
          <Compass size={26} className="text-gray-400" strokeWidth={1.75} />
        </div>

        <p className="mt-5 text-xs font-semibold tracking-widest text-gray-400 uppercase">Error 404</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 tracking-tight">
          This page doesn’t exist
        </h1>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">
          Nothing in HartMonitor lives at this address. It may have been renamed, or the link
          that brought you here may be out of date.
        </p>
        <code className="mt-3 inline-block px-2 py-1 rounded bg-gray-100 text-gray-600 text-xs break-all">
          {pathname}
        </code>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <button onClick={() => navigate(-1)} className="btn-secondary inline-flex items-center gap-1.5">
            <ArrowLeft size={15} /> Go back
          </button>
          <Link to="/dashboard" className="btn-primary inline-flex items-center gap-1.5">
            <LayoutDashboard size={15} /> Command Center
          </Link>
        </div>
      </div>
    </div>
  );
}
