import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { isStaleChunkError, takeStaleChunkReload } from './utils/staleChunk'

// Every deploy replaces the hashed chunk filenames. A tab that was already open
// across that deploy — an operator with the player up mid-shift, or a phone
// restoring from bfcache — then asks for a file that no longer exists, the
// dynamic import rejects, and the route never mounts: "Something went wrong,
// Unable to preload CSS for /assets/AppPlayer-<hash>.css". Vite fires
// `vite:preloadError` for precisely this case, so take the new build instead of
// showing the operator a dead screen.
window.addEventListener('vite:preloadError', event => {
  if (takeStaleChunkReload()) {
    event.preventDefault();   // don't let it surface as a crash; we're reloading
    window.location.reload();
  }
});

// The same failure can arrive as a plain unhandled rejection (a dynamic import
// whose JS chunk is gone, rather than its CSS).
window.addEventListener('unhandledrejection', event => {
  if (isStaleChunkError(event.reason) && takeStaleChunkReload()) {
    event.preventDefault();
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
