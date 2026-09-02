// Where a new account lands: on the Command Center, like every other account.
//
// This used to ask the server "has this company ever started a run?" the first
// time someone reached /dashboard in a browsing session, and send a brand-new
// account to /apps if the answer was no. It was well meant — the Command Center
// on an empty company was a grid of zeroes — and it was a dead end: the owner
// clicked "Command Center" in the sidebar, watched a spinner, and arrived at a
// different screen. Nothing on either page said why. The screen a person asked
// for is the screen they get.
//
// The reason the redirect existed is gone too: the Command Center now renders
// its own empty states and leads with "Build your first app", which is the same
// hand-off the redirect was performing, on the page the person chose.
//
// The component survives as a pass-through because it is the route element in
// App.tsx, and `useFirstRunDeciding` survives because the training coach still
// asks whether a first-run hand-off is in flight. Nothing is any more, so the
// answer is always false and the coach is free to show itself.

import { useSyncExternalStore } from 'react';

/** True while a first-run hand-off is in flight. There is no longer any such
 *  hand-off, so this is always false — kept so the one consumer (the training
 *  coach) still has one question to ask about whose guide owns the screen. */
export function useFirstRunDeciding(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => false,
    () => false,
  );
}

export default function FirstRunLanding({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
