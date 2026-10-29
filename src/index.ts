import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { corsOrigin, findFreePort, removeStaleFontsManifest, resolveDomain } from './utils.js';

export interface VhostyOptions {
    /**
     * The vhosty domain, e.g. "vhosty.link". Defaults to VHOSTY_DOMAIN in .env,
     * then ~/.vhosty/config. Without one, the plugin does nothing.
     */
    domain?: string;

    /** First port to try. Defaults to server.port, or 5173. */
    port?: number;

    /** Delete a stale public/fonts-manifest.dev.json on start. Default: true. */
    cleanFontsManifest?: boolean;

    /** Path to the vhosty config. Default: ~/.vhosty/config */
    configPath?: string;
}

/**
 * Serves the Vite dev server through vhosty at https://<port>.<domain>, which
 * vhosty's Caddy proxies to localhost:<port>. Picks a free port, so several
 * projects can run side by side.
 *
 * Runs before laravel() so the hot file picks up the https origin.
 */
export default function vhosty(options: VhostyOptions = {}): Plugin {
    let url: string | undefined;

    return {
        name: 'vhosty',
        enforce: 'pre',

        async config(userConfig, { command, mode, isPreview }) {
            if (command !== 'serve' || isPreview) {
                return;
            }

            const root = userConfig.root ? resolve(userConfig.root) : process.cwd();
            const envDir = typeof userConfig.envDir === 'string' ? resolve(root, userConfig.envDir) : root;
            const env = loadEnv(mode, envDir, '');
            const domain = resolveDomain(env, options.domain, options.configPath);

            if (!domain) {
                return;
            }

            const port = await findFreePort(options.port ?? userConfig.server?.port ?? 5173);
            const host = `${port}.${domain}`;
            url = `https://${host}`;

            return {
                server: {
                    host: '127.0.0.1',
                    port,
                    strictPort: true,
                    origin: url,
                    allowedHosts: [host],
                    cors: { origin: corsOrigin(domain) },
                    hmr: { host, protocol: 'wss', clientPort: 443 },
                },
            };
        },

        configResolved(config) {
            if (url && options.cleanFontsManifest !== false) {
                const publicDir = config.publicDir ? config.publicDir : 'public';
                removeStaleFontsManifest(config.root, publicDir);
            }
        },

        configureServer(server) {
            if (!url) {
                return;
            }

            const printUrls = server.printUrls.bind(server);
            server.printUrls = () => {
                printUrls();
                server.config.logger.info(`  \x1b[32m➜\x1b[0m  \x1b[1mvhosty\x1b[0m:  \x1b[36m${url}/\x1b[0m`);
            };
        },
    };
}

export { vhosty };
export { corsOrigin, findFreePort, resolveDomain } from './utils.js';
