import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export interface MobileAccess {
  hostname: string;
  password: string;
}

const localNames = new Set(['127.0.0.1', 'localhost']);
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const digest = (value: string) => createHash('sha256').update(value).digest();

export function accessGuard(mobile?: MobileAccess): RequestHandler {
  const mobileHost = mobile?.hostname.toLowerCase();
  if (mobile && (!mobileHost || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(mobileHost) || mobile.password.length < 24)) {
    throw new Error('Mobile access requires an exact Tailscale DNS name and a strong access password.');
  }
  const expected = mobile && digest(`journal:${mobile.password}`);
  return (req, res, next) => {
    const host = req.get('host')?.toLowerCase() ?? '';
    const hostMatch = /^([a-z0-9.-]+)(?::\d{1,5})?$/.exec(host);
    const validHost = hostMatch && (localNames.has(hostMatch[1]) || hostMatch[1] === mobileHost);
    const origin = req.get('origin');
    const sameOrigin = origin === `http://${host}` || (mobileHost && origin === `https://${mobileHost}`);
    const externalSite = req.path.startsWith('/api/') && req.get('sec-fetch-site') === 'cross-site';
    const forwarded = req.get('x-forwarded-host') || req.get('tailscale-headers-info');
    if (!validHost || externalSite || (!mobile && forwarded) || (!safeMethods.has(req.method) && origin && !sameOrigin)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (expected) {
      res.set('Cache-Control', 'no-store');
      const basic = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(req.get('authorization') ?? '');
      if (!basic || !timingSafeEqual(digest(Buffer.from(basic[1], 'base64').toString('utf8')), expected)) {
        res.set('WWW-Authenticate', 'Basic realm="Trading Discipline OS", charset="UTF-8"').status(401).send('Sign in required');
        return;
      }
    }
    next();
  };
}
