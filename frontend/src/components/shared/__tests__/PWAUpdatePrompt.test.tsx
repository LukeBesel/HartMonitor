import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import PWAUpdatePrompt from '../PWAUpdatePrompt';

/** A service worker container just real enough for the prompt's logic: it can
 *  be controlled or not, and it can fire `controllerchange`. */
function installServiceWorker({ controlled }: { controlled: boolean }) {
  const listeners = new Set<() => void>();
  const registration = {
    waiting: null,
    addEventListener: vi.fn(),
  };
  const container = {
    controller: controlled ? {} : null,
    ready: Promise.resolve(registration),
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'controllerchange') listeners.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      if (type === 'controllerchange') listeners.delete(fn);
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
    writable: true,
  });
  return {
    /** The worker takes control of the page — fired on a first install too. */
    takeControl() {
      container.controller = {};
      listeners.forEach(fn => fn());
    },
  };
}

async function settle() {
  // Let `navigator.serviceWorker.ready` resolve before asserting.
  await waitFor(() => expect(true).toBe(true));
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('PWAUpdatePrompt', () => {
  it('stays quiet when the worker first takes control of an uncontrolled page', async () => {
    // A first-ever visit: nothing was controlling the page when it loaded, so
    // the worker claiming it is an install, not an update. There is no earlier
    // version to offer to move off.
    const sw = installServiceWorker({ controlled: false });
    render(<PWAUpdatePrompt />);
    await settle();

    sw.takeControl();

    await settle();
    expect(screen.queryByText('Update available')).not.toBeInTheDocument();
  });

  it('offers the update when the controller changes on an already-controlled page', async () => {
    // A return visit: the page loaded under a worker, so a controller swap
    // means new code really did arrive.
    const sw = installServiceWorker({ controlled: true });
    render(<PWAUpdatePrompt />);
    await settle();

    sw.takeControl();

    await waitFor(() => expect(screen.getByText('Update available')).toBeInTheDocument());
  });

  it('renders nothing at all before an update exists', async () => {
    installServiceWorker({ controlled: true });
    const { container } = render(<PWAUpdatePrompt />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });
});
