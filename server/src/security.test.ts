import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { CLIENT_HEADER, localOnly } from './security.js';

/**
 * The CSRF guard, which is the whole of Scrub's defence against the user's own
 * browser.
 *
 * Binding to 127.0.0.1 keeps Scrub off the network and does nothing about a page
 * the user already has open. Any site can POST to a loopback port, and pointing
 * that at an editable command bar is arbitrary ffmpeg argv on their machine. So
 * these are not style tests: each one is a door that has to stay shut.
 */

type Call = {
  readonly status: number | null;
  readonly body: unknown;
  readonly nexted: boolean;
  readonly headers: Record<string, string>;
};

type Init = {
  readonly method?: string;
  readonly path?: string;
  /** `null` means send no Host header at all, which is a case of its own. */
  readonly host?: string | null;
  readonly origin?: string;
  readonly client?: boolean;
};

function run(init: Init = {}): Call {
  const headers: Record<string, string> = {};
  if (init.host !== null) headers.host = init.host ?? '127.0.0.1:5174';
  if (init.origin !== undefined) headers.origin = init.origin;
  if (init.client === true) headers[CLIENT_HEADER] = '1';

  const result = { status: null as number | null, body: undefined as unknown, nexted: false };
  const sent: Record<string, string> = {};

  const req = {
    method: init.method ?? 'GET',
    path: init.path ?? '/meta/abc',
    headers,
  } as unknown as Request;

  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      sent[name] = value;
    },
    end() {
      return this;
    },
  } as unknown as Response;

  const next = vi.fn(() => {
    result.nexted = true;
  }) as unknown as NextFunction;

  localOnly(req, res, next);
  return { ...result, headers: sent };
}

describe('who is allowed to talk to Scrub', () => {
  it('answers a loopback host', () => {
    expect(run({ host: '127.0.0.1:5174', client: true }).nexted).toBe(true);
    expect(run({ host: 'localhost:5174', client: true }).nexted).toBe(true);
  });

  /**
   * DNS rebinding: the attacker's domain resolves to 127.0.0.1 and the browser
   * treats it as a same-origin target. The Host header is what gives it away.
   */
  it('refuses a request addressed to somebody else’s hostname', () => {
    const call = run({ host: 'evil.example.com:5174', client: true });
    expect(call.status).toBe(403);
    expect(call.nexted).toBe(false);
  });

  it('refuses a request with no Host at all', () => {
    // Not a hypothetical: a raw socket client simply omits it, and "no host" must
    // not fall through to the same branch as "a host I recognise".
    const call = run({ host: null, client: true });
    expect(call.status).toBe(403);
    expect(call.nexted).toBe(false);
  });

  it('refuses a cross-origin request', () => {
    const call = run({ origin: 'https://evil.example.com', client: true });
    expect(call.status).toBe(403);
    expect(call.nexted).toBe(false);
  });

  it('allows the Vite dev server, which is a different origin on purpose', () => {
    expect(run({ origin: 'http://localhost:5173', client: true }).nexted).toBe(true);
  });

  it('allows a same-origin request, which carries no Origin at all', () => {
    expect(run({ client: true }).nexted).toBe(true);
  });
});

describe('the custom header', () => {
  /**
   * A custom header cannot be set on a simple cross-origin request, so requiring
   * one forces a preflight - and the preflight is refused above.
   */
  it('is required on anything that changes state', () => {
    for (const method of ['POST', 'DELETE', 'PUT', 'PATCH']) {
      const call = run({ method, path: '/run', client: false });
      expect(call.status, method).toBe(403);
    }
  });

  it('is required on an ordinary GET', () => {
    expect(run({ method: 'GET', path: '/meta/abc', client: false }).status).toBe(403);
  });

  it('lets a POST through when it is present', () => {
    expect(run({ method: 'POST', path: '/run', client: true }).nexted).toBe(true);
  });

  /**
   * These four exemptions are mechanical, not a relaxation: `<video src>`,
   * `<img src>`, `<a download>` and `EventSource` cannot set a request header at
   * all, so requiring one would make the preview, the filmstrip, the download
   * and the progress stream impossible rather than secure.
   */
  it('exempts the GETs that browser APIs cannot add a header to', () => {
    const exempt = [
      '/health',
      '/source/abc',
      '/download/abc',
      '/filmstrip/abc',
      '/waveform/abc',
      '/run/1234-5678/events',
    ];
    for (const path of exempt) {
      expect(run({ method: 'GET', path, client: false }).nexted, path).toBe(true);
    }
  });

  it('does not exempt those paths for anything but GET', () => {
    for (const path of ['/download/abc', '/run/1234/events']) {
      expect(run({ method: 'POST', path, client: false }).status, path).toBe(403);
    }
  });

  /** `/runaway` must not match the `/run/:id/events` exemption. */
  it('does not let a lookalike path slip through the exemption', () => {
    expect(run({ method: 'GET', path: '/run/a/b/events', client: false }).status).toBe(403);
    expect(run({ method: 'GET', path: '/healthcheck', client: false }).status).toBe(403);
    expect(run({ method: 'GET', path: '/sources/abc', client: false }).status).toBe(403);
  });
});
