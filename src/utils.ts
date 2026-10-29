import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/*
 * True when nothing is listening on `port` at `host`. A machine without IPv6
 * can't have anything listening on ::1, so those errors count as free.
 */
export function isPortFree(port: number, host: string): Promise<boolean> {
    return new Promise((done) => {
        const probe = createServer()
            .once('error', (err: NodeJS.ErrnoException) => {
                done(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT');
            })
            .once('listening', () => probe.close(() => done(true)))
            .listen({ port, host, exclusive: true });
    });
}

/*
 * First port from `start` that's free on both 127.0.0.1 and ::1. Node 17+
 * often binds `localhost` to ::1 only, and Caddy dials `localhost`, so a
 * port in use on either address would route to the wrong app.
 */
export async function findFreePort(start: number, attempts = 100): Promise<number> {
    for (let port = start; port < start + attempts; port++) {
        if ((await isPortFree(port, '127.0.0.1')) && (await isPortFree(port, '::1'))) {
            return port;
        }
    }

    throw new Error(`[vhosty] No free port between ${start} and ${start + attempts - 1}`);
}

/*
 * The vhosty domain, from (in order): the plugin option, VHOSTY_DOMAIN,
 * the older VITE_HMR_DOMAIN, then ~/.vhosty/config. VHOSTY=false turns
 * the plugin off for one project.
 */
export function resolveDomain(
    env: Record<string, string>,
    option?: string,
    configPath = join(homedir(), '.vhosty', 'config'),
): string | undefined {
    if (env.VHOSTY === 'false' || env.VHOSTY === '0') {
        return undefined;
    }

    const domain = option || env.VHOSTY_DOMAIN || env.VITE_HMR_DOMAIN || readConfigDomain(configPath);

    return domain ? normalizeDomain(domain) : undefined;
}

export function readConfigDomain(configPath: string): string | undefined {
    try {
        const config = readFileSync(configPath, 'utf8');
        return config.match(/^\s*VHOSTY_DOMAIN=["']?([^"'\s]+)["']?\s*$/m)?.[1];
    } catch {
        return undefined; // not a vhosty machine
    }
}

export function normalizeDomain(domain: string): string {
    return domain
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^\*\./, '')
        .replace(/\/.*$/, '')
        .replace(/\.$/, '');
}

/*
 * Matches https://<one label>.<domain>, so every app and port on the vhosty
 * domain can load the dev server's assets. Only your tailnet can reach these.
 */
export function corsOrigin(domain: string): RegExp {
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^https://[a-z0-9-]+\\.${escaped}$`);
}

/*
 * laravel-vite-plugin caches font URLs in public/fonts-manifest.dev.json and
 * doesn't always rewrite it, which leaves fonts pointing at an old host.
 */
export function removeStaleFontsManifest(root: string, publicDirectory = 'public'): boolean {
    const file = resolve(root, publicDirectory, 'fonts-manifest.dev.json');

    if (!existsSync(file)) {
        return false;
    }

    rmSync(file, { force: true });
    return true;
}
