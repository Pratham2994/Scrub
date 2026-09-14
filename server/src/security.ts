import type { NextFunction, Request, Response } from 'express';

import { config } from './config.js';

/**
 * Header the client must send on anything that is not a plain health check.
 *
 * This is the actual CSRF defence, and it is not paranoia. Binding to 127.0.0.1
 * keeps Scrub off the network; it does nothing about the user's own browser. Any
 * page they have open can `fetch('http://127.0.0.1:5174/run', { method: 'POST' })`,
 * and with a simple content type there is no preflight to stop it. Point that at an
 * editable command bar and a random website gets arbitrary ffmpeg argv — which
 * means arbitrary file reads and writes — on the user's machine.
 *
 * A custom header cannot be set on a simple cross-origin request, so requiring one
 * forces a preflight, and the preflight is refused below. Host and Origin checks
 * close DNS rebinding, where the attacker's domain resolves to 127.0.0.1 and the
 * browser happily treats it as a same-origin target.
 */
export const CLIENT_HEADER = 'x-scrub-client';

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  `127.0.0.1:${String(config.port)}`,
  `localhost:${String(config.port)}`,
  `[::1]:${String(config.port)}`,
]);

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  ...config.devClientOrigins,
  `http://127.0.0.1:${String(config.port)}`,
  `http://localhost:${String(config.port)}`,
]);

function deny(res: Response, reason: string): void {
  res.status(403).json({ error: { code: 'FORBIDDEN', message: reason } });
}

/**
 * Which routes must carry the custom header.
 *
 * A few GETs are exempt, and the reason is mechanical rather than a relaxation:
 * the browser APIs that reach them cannot set a request header at all.
 * `<video src>`, `<img src>` and `<a download>` cannot, and neither can
 * `EventSource` — so requiring one would make the preview, the filmstrip, the
 * download and the progress stream impossible rather than secure.
 *
 * Every exempt route is side-effect free and needs an unguessable uuid, and the
 * Host and Origin checks above still apply to all of them. Everything that
 * changes state — uploading, running, cancelling — keeps the requirement, and
 * those are the routes a hostile page would actually want.
 */
function requiresClientHeader(method: string, path: string): boolean {
  if (method !== 'GET') return true;
  if (path === '/health') return false;
  if (/^\/(source|download|filmstrip)\//.test(path)) return false;
  // The SSE progress stream, opened by EventSource.
  return !/^\/run\/[^/]+\/events$/.test(path);
}

export function localOnly(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host;
  if (host === undefined || !ALLOWED_HOSTS.has(host.toLowerCase())) {
    deny(res, 'Scrub only answers requests addressed to its loopback host.');
    return;
  }

  const origin = req.headers.origin;
  if (origin !== undefined && !ALLOWED_ORIGINS.has(origin.toLowerCase())) {
    deny(res, 'Cross-origin requests are refused. Scrub is a local tool.');
    return;
  }

  if (origin !== undefined) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', `content-type, ${CLIENT_HEADER}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!requiresClientHeader(req.method, req.path)) {
    next();
    return;
  }

  if (req.headers[CLIENT_HEADER] === undefined) {
    deny(res, `Missing ${CLIENT_HEADER} header.`);
    return;
  }

  next();
}
