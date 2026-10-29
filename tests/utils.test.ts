import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    corsOrigin,
    findFreePort,
    isPortFree,
    normalizeDomain,
    readConfigDomain,
    removeStaleFontsManifest,
    resolveDomain,
} from '../src/utils.js';

const servers: Server[] = [];

function occupy(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const server = createServer().once('error', reject).listen(port, host, () => resolve());
        servers.push(server);
    });
}

async function ipv6Available(): Promise<boolean> {
    return new Promise((resolve) => {
        const s = createServer()
            .once('error', () => resolve(false))
            .listen(0, '::1', () => s.close(() => resolve(true)));
    });
}

// A random high base so parallel runs don't collide
const base = () => 40000 + Math.floor(Math.random() * 20000);

afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
});

describe('isPortFree / findFreePort', () => {
    it('returns the start port when it is free', async () => {
        const start = base();
        expect(await isPortFree(start, '127.0.0.1')).toBe(true);
        expect(await findFreePort(start)).toBe(start);
    });

    it('skips ports in use on 127.0.0.1', async () => {
        const start = base();
        await occupy(start, '127.0.0.1');
        await occupy(start + 1, '127.0.0.1');
        expect(await isPortFree(start, '127.0.0.1')).toBe(false);
        expect(await findFreePort(start)).toBe(start + 2);
    });

    it('skips ports in use only on ::1 (Node binds localhost to IPv6)', async (ctx) => {
        if (!(await ipv6Available())) ctx.skip();
        const start = base();
        await occupy(start, '::1');
        expect(await isPortFree(start, '127.0.0.1')).toBe(true);
        expect(await findFreePort(start)).toBe(start + 1);
    });

    it('treats ::1 as free on machines without IPv6', async () => {
        if (await ipv6Available()) return; // only meaningful without IPv6
        expect(await isPortFree(base(), '::1')).toBe(true);
    });

    it('throws when every port in the range is taken', async () => {
        const start = base();
        await occupy(start, '127.0.0.1');
        await occupy(start + 1, '127.0.0.1');
        await expect(findFreePort(start, 2)).rejects.toThrow(/No free port/);
    });
});

describe('resolveDomain', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vhosty-'));
    const config = join(dir, 'config');
    writeFileSync(config, '# vhosty config\nVHOSTY_DOMAIN="vhosty.link"\nVHOSTY_PARKED="/Users/z/Dev"\n');
    const missing = join(dir, 'nope');

    it('prefers the plugin option', () => {
        expect(resolveDomain({ VHOSTY_DOMAIN: 'env.dev' }, 'option.dev', config)).toBe('option.dev');
    });

    it('then VHOSTY_DOMAIN, then VITE_HMR_DOMAIN', () => {
        expect(resolveDomain({ VHOSTY_DOMAIN: 'env.dev', VITE_HMR_DOMAIN: 'old.dev' }, undefined, config)).toBe('env.dev');
        expect(resolveDomain({ VITE_HMR_DOMAIN: 'old.dev' }, undefined, config)).toBe('old.dev');
    });

    it('then ~/.vhosty/config', () => {
        expect(resolveDomain({}, undefined, config)).toBe('vhosty.link');
    });

    it('is undefined on machines without vhosty', () => {
        expect(resolveDomain({}, undefined, missing)).toBeUndefined();
    });

    it('can be turned off per project with VHOSTY=false', () => {
        expect(resolveDomain({ VHOSTY: 'false' }, undefined, config)).toBeUndefined();
        expect(resolveDomain({ VHOSTY: 'false', VHOSTY_DOMAIN: 'env.dev' }, 'x.dev', config)).toBeUndefined();
    });

    it('normalizes what people paste', () => {
        expect(normalizeDomain(' https://*.VHOSTY.link/ ')).toBe('vhosty.link');
        expect(normalizeDomain('box.example.com.')).toBe('box.example.com');
    });

    it('reads unquoted and single-quoted config values', () => {
        const f = join(dir, 'c2');
        writeFileSync(f, "VHOSTY_PHP=on\nVHOSTY_DOMAIN='box.example.com'\n");
        expect(readConfigDomain(f)).toBe('box.example.com');
        writeFileSync(f, 'VHOSTY_DOMAIN=plain.dev\n');
        expect(readConfigDomain(f)).toBe('plain.dev');
    });
});

describe('corsOrigin', () => {
    const re = corsOrigin('vhosty.link');

    it.each([
        'https://escrow.vhosty.link',
        'https://5173.vhosty.link',
        'https://octane.vhosty.link',
    ])('allows %s', (origin) => expect(re.test(origin)).toBe(true));

    it.each([
        'http://escrow.vhosty.link',
        'https://vhosty.link',
        'https://a.b.vhosty.link',
        'https://evilvhosty.link',
        'https://escrow.vhosty.link.evil.com',
        'https://escrow.vhostyxlink',
    ])('rejects %s', (origin) => expect(re.test(origin)).toBe(false));

    it('escapes subdomain-style domains', () => {
        const sub = corsOrigin('box.example.com');
        expect(sub.test('https://app.box.example.com')).toBe(true);
        expect(sub.test('https://app.boxxexample.com')).toBe(false);
    });
});

describe('removeStaleFontsManifest', () => {
    it('deletes public/fonts-manifest.dev.json when present', () => {
        const root = mkdtempSync(join(tmpdir(), 'vhosty-'));
        mkdirSync(join(root, 'public'));
        const file = join(root, 'public', 'fonts-manifest.dev.json');
        writeFileSync(file, '{"stale":"http://remote-imac.local:5173"}');

        expect(removeStaleFontsManifest(root)).toBe(true);
        expect(existsSync(file)).toBe(false);
        expect(removeStaleFontsManifest(root)).toBe(false);
    });
});
