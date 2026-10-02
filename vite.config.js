import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function gitValue(args, fallback) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const commit = process.env.VITE_APP_SHA || gitValue(['rev-parse', 'HEAD'], 'unknown');
const branch = process.env.VITE_APP_BRANCH || process.env.GITHUB_REF_NAME || gitValue(['branch', '--show-current'], 'unknown');
const builtAt = new Date().toISOString();
const buildInfo = {
  version: packageInfo.version,
  commit,
  branch,
  builtAt,
  buildId: `${commit}-${builtAt.replace(/[^0-9]/g, '').slice(0, 14)}`,
};
const manifest = JSON.stringify(buildInfo, null, 2);

function versionManifestPlugin() {
  return {
    name: 'bee-schem-version-manifest',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== '/version.json') return next();
        if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) return next();
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'no-store, max-age=0');
        response.end(request.method === 'HEAD' ? '' : manifest);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: manifest });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionManifestPlugin()],
  define: {
    __APP_BUILD_INFO__: JSON.stringify(buildInfo),
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
