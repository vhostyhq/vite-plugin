import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer as createNetServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import laravel from 'laravel-vite-plugin';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import vhosty from '../src/index.js';

const NO_CONFIG = '/nonexistent/vhosty/config';
const base = () => 40000 + Math.floor(Math.random() * 20000);

// fetch() can't override the Host header, so use node:http for these checks
function get(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, any> }> {
    return new Promise((resolve, reject) => {
        request({ host: '127.0.0.1', port, path, headers }, (res) => {
            res.resume();
            resolve({ status: res.statusCode ?? 0, headers: res.headers });
        }).once('error', reject).end();
    });
}

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'vhosty-app-'));
    mkdirSync(join(root, 'public'));
    mkdirSync(join(root, 'resources', 'js'), { recursive: true });
    writeFileSync(join(root, 'resources', 'js', 'app.js'), 'console.log("hi")\n');
    writeFileSync(join(root, 'index.html'), '<!doctype html><html><body>vhosty test</body></html>');
    return root;
}

async function start(root: string, plugins: any[]): Promise<ViteDevServer> {
    const server = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', plugins });
    cleanup.push(() => server.close());
    await server.listen();
    return server;
}

function callConfig(plugin: ReturnType<typeof vhosty>, env: { command: 'serve' | 'build'; isPreview?: boolean }, user = {}) {
    const hook = plugin.config as any;
    return hook.call({}, user, { mode: 'development', isPreview: false, ...env });
}

describe('config hook', () => {
    it('does nothing for builds', async () => {
        expect(await callConfig(vhosty({ domain: 'vhosty.link' }), { command: 'build' })).toBeUndefined();
    });

    it('does nothing for vite preview', async () => {
        expect(await callConfig(vhosty({ domain: 'vhosty.link' }), { command: 'serve', isPreview: true })).toBeUndefined();
    });

    it('does nothing without a domain (teammates without vhosty)', async () => {
        expect(await callConfig(vhosty({ configPath: NO_CONFIG }), { command: 'serve' })).toBeUndefined();
    });

    it('returns the proxied server config', async () => {
        const port = base();
        const result = await callConfig(vhosty({ domain: 'vhosty.link', port, configPath: NO_CONFIG }), { command: 'serve' });
        const host = `${port}.vhosty.link`;

        expect(result.server).toMatchObject({
            host: '127.0.0.1',
            port,
            strictPort: true,
            origin: `https://${host}`,
            allowedHosts: [host],
            hmr: { host, protocol: 'wss', clientPort: 443 },
        });
        expect(result.server.cors.origin.test('https://escrow.vhosty.link')).toBe(true);
    });

    it('starts from server.port in the user config', async () => {
        const port = base();
        const result = await callConfig(vhosty({ domain: 'vhosty.link', configPath: NO_CONFIG }), { command: 'serve' }, { server: { port } });
        expect(result.server.port).toBe(port);
    });

    it('moves to the next port when the start port is busy', async () => {
        const port = base();
        const busy: Server = await new Promise((r) => { const s = createNetServer().listen(port, '127.0.0.1', () => r(s)); });
        cleanup.push(() => new Promise((r) => busy.close(r)));

        const result = await callConfig(vhosty({ domain: 'vhosty.link', port, configPath: NO_CONFIG }), { command: 'serve' });
        expect(result.server.port).toBe(port + 1);
        expect(result.server.origin).toBe(`https://${port + 1}.vhosty.link`);
    });
});

describe('real Vite dev server', () => {
    it('listens on 127.0.0.1 and accepts the vhosty hostname', async () => {
        const port = base();
        const server = await start(project(), [vhosty({ domain: 'vhosty.link', port, configPath: NO_CONFIG })]);

        expect(server.httpServer?.address()).toMatchObject({ address: '127.0.0.1', port });
        expect(server.config.server.origin).toBe(`https://${port}.vhosty.link`);

        const ok = await get(port, '/@vite/client', { Host: `${port}.vhosty.link` });
        expect(ok.status).toBe(200);

        const blocked = await get(port, '/@vite/client', { Host: 'evil.example.com' });
        expect(blocked.status).toBe(403);
    });

    it('sends CORS headers to apps on the domain, and not to others', async () => {
        const port = base();
        await start(project(), [vhosty({ domain: 'vhosty.link', port, configPath: NO_CONFIG })]);
        const headers = (origin: string) => ({ Host: `${port}.vhosty.link`, Origin: origin });

        const app = await get(port, '/@vite/client', headers('https://escrow.vhosty.link'));
        expect(app.headers['access-control-allow-origin']).toBe('https://escrow.vhosty.link');

        const other = await get(port, '/@vite/client', headers('https://evil.example.com'));
        expect(other.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('runs two projects side by side on different ports', async () => {
        const port = base();
        const a = await start(project(), [vhosty({ domain: 'vhosty.link', port, configPath: NO_CONFIG })]);
        const b = await start(project(), [vhosty({ domain: 'vhosty.link', port, configPath: NO_CONFIG })]);

        expect(a.config.server.port).toBe(port);
        expect(b.config.server.port).toBe(port + 1);
        expect(b.config.server.origin).toBe(`https://${port + 1}.vhosty.link`);
    });

    it('leaves Vite alone without a domain', async () => {
        const server = await start(project(), [vhosty({ configPath: NO_CONFIG })]);
        expect(server.config.server.origin).toBeUndefined();
        expect(server.config.server.strictPort).toBe(false);
    });
});

describe('with laravel-vite-plugin', () => {
    it('writes the https origin to the hot file and clears a stale fonts manifest', async () => {
        const root = project();
        const port = base();
        const hotFile = join(root, 'public', 'hot');
        const fonts = join(root, 'public', 'fonts-manifest.dev.json');
        writeFileSync(fonts, '{"url":"http://remote-imac.local:5173"}');

        // laravel-vite-plugin skips the hot file when it detects Vitest
        const vitest = process.env.VITEST;
        delete process.env.VITEST;
        cleanup.push(async () => { process.env.VITEST = vitest; });

        // ...and refuses to start a dev server when CI is set (GitHub Actions)
        process.env.LARAVEL_BYPASS_ENV_CHECK = '1';
        cleanup.push(async () => { delete process.env.LARAVEL_BYPASS_ENV_CHECK; });

        await start(root, [
            vhosty({ domain: 'vhosty.link', port, configPath: NO_CONFIG }),
            laravel({ input: ['resources/js/app.js'], hotFile, refresh: false }),
        ]);

        await expect.poll(() => existsSync(hotFile)).toBe(true);
        expect(readFileSync(hotFile, 'utf8').trim()).toBe(`https://${port}.vhosty.link`);
        expect(existsSync(fonts)).toBe(false);
    });
});
