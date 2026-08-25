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
window.addEventListener('vite:preloadError', () => {
  // Deliberately NOT event.preventDefault(). Vite's helper only rethrows the
  // error when the event is un-cancelled; cancelling it makes __vitePreload
  // RESOLVE with undefined, so React.lazy then reads `.default` off undefined
  // and the boundary shows "Cannot read properties of undefined" — a worse
  // message than the one we set out to remove, for the whole duration of the
  // reload navigation. Letting the real error through means the boundary can
  // recognise it and show "A new version is available" while we reload.
  if (takeStaleChunkReload()) window.location.reload();
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
