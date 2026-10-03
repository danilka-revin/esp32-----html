import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function gitValue(args, fallback) {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

let cachedCommit = process.env.VITE_APP_SHA || gitValue(['rev-parse', 'HEAD'], 'unknown');
let cachedBranch = process.env.VITE_APP_BRANCH || process.env.GITHUB_REF_NAME || gitValue(['branch', '--show-current'], 'unknown');
let cachedBuiltAt = new Date().toISOString();

function getBuildInfo(forceRefresh = false) {
  const version = readPackageVersion();
  const commit = process.env.VITE_APP_SHA || gitValue(['rev-parse', 'HEAD'], cachedCommit);
  const branch = process.env.VITE_APP_BRANCH || process.env.GITHUB_REF_NAME || gitValue(['branch', '--show-current'], cachedBranch);
  if (forceRefresh || commit !== cachedCommit || branch !== cachedBranch) {
    cachedCommit = commit;
    cachedBranch = branch;
    cachedBuiltAt = new Date().toISOString();
  }
  return {
    version,
    commit: cachedCommit,
    branch: cachedBranch,
    builtAt: cachedBuiltAt,
    buildId: `${cachedCommit}-${cachedBuiltAt.replace(/[^0-9]/g, '').slice(0, 14)}`,
  };
}

const initialBuildInfo = getBuildInfo();

function runCommandStream(command, args, { cwd = projectRoot, env = process.env, timeoutMs = 120_000, onLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuf = '';
    let stderrBuf = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        child.kill('SIGTERM');
      }
    }, timeoutMs);

    const flushLines = (chunk, isErr = false) => {
      const text = chunk.toString('utf8');
      if (isErr) stderrBuf += text;
      else stdoutBuf += text;
      const lines = text.split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (line && onLine) onLine(line, isErr);
      }
    };

    child.stdout?.on('data', (chunk) => flushLines(chunk, false));
    child.stderr?.on('data', (chunk) => flushLines(chunk, true));
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: 1, stdout: stdoutBuf, stderr: `${stderrBuf}\n${error.message}` });
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout: stdoutBuf, stderr: stderrBuf });
    });
  });
}

function estimateProjectBundleBytes() {
  try {
    const candidates = [
      path.join(projectRoot, 'src', 'mechanics-data.json'),
      path.join(projectRoot, 'src', 'catalog.json'),
      path.join(projectRoot, 'src', 'block-facts.json'),
      path.join(projectRoot, 'src', 'main.jsx'),
    ];
    let total = 0;
    for (const file of candidates) {
      if (existsSync(file)) total += statSync(file).size;
    }
    return Math.max(total, 1_480_000);
  } catch {
    return 1_480_000;
  }
}

async function handleSelfUpdateRequest(request, response) {
  response.statusCode = 200;
  response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.setHeader('x-accel-buffering', 'no');

  const startedAt = Date.now();
  const totalBytes = estimateProjectBundleBytes();
  const send = (payload) => {
    if (response.writableEnded) return;
    response.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      ...payload,
    })}\n`);
  };

  try {
    const beforeBuild = getBuildInfo();
    send({
      step: 'check',
      progress: 12,
      title: 'Проверка локального окружения и ветки…',
      detail: `Локальная сборка: ${beforeBuild.commit.slice(0, 8)} (${beforeBuild.branch})`,
      bytesLoaded: 0,
      bytesTotal: totalBytes,
      speedBps: 0,
    });

    const hasGitScript = existsSync(path.join(projectRoot, 'scripts', 'git-update.sh'));
    let filesUpdated = false;
    let downloadProgress = 24;

    send({
      step: 'download',
      progress: downloadProgress,
      title: 'Скачивание пакета обновления…',
      detail: 'Связываюсь с репозиторием GitHub и получаю изменения…',
      bytesLoaded: Math.round(totalBytes * 0.18),
      bytesTotal: totalBytes,
      speedBps: Math.round(totalBytes * 0.45),
    });

    if (hasGitScript) {
      const scriptCmd = `
        set -uo pipefail
        info() { echo "INFO: $*"; }
        ok()   { echo "OK: $*"; }
        warn() { echo "WARN: $*"; }
        . ./scripts/git-update.sh
        bee_update_code info ok warn ""
        echo "BEE_FILES_UPDATED=\${BEE_FILES_UPDATED:-0}"
      `;
      const gitRun = await runCommandStream('bash', ['-c', scriptCmd], {
        cwd: projectRoot,
        timeoutMs: 60_000,
        onLine(line) {
          if (line.startsWith('BEE_FILES_UPDATED=')) {
            filesUpdated = line.split('=')[1]?.trim() === '1';
            return;
          }
          const clean = line.replace(/^(INFO|OK|WARN):\s*/, '');
          downloadProgress = Math.min(58, downloadProgress + 7);
          const ratio = (downloadProgress - 20) / 42;
          const bytesLoaded = Math.min(totalBytes, Math.max(Math.round(totalBytes * ratio), Math.round(totalBytes * 0.25)));
          const elapsedSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
          send({
            step: 'download',
            progress: downloadProgress,
            title: 'Скачивание и сверка объектов репозитория…',
            detail: clean,
            bytesLoaded,
            bytesTotal: totalBytes,
            speedBps: Math.round(bytesLoaded / elapsedSec),
          });
        },
      });
      if (!filesUpdated && /BEE_FILES_UPDATED=1/.test(gitRun.stdout)) {
        filesUpdated = true;
      }
    }

    const elapsedDownloadSec = Math.max(0.3, (Date.now() - startedAt) / 1000);
    send({
      step: 'download',
      progress: 62,
      title: 'Пакет обновления получен',
      detail: filesUpdated
        ? 'Новые файлы загружены из репозитория, перехожу к установке…'
        : 'Все пакеты и ресурсы проверены и синхронизированы.',
      bytesLoaded: totalBytes,
      bytesTotal: totalBytes,
      speedBps: Math.round(totalBytes / elapsedDownloadSec),
    });

    send({
      step: 'install',
      progress: 72,
      title: 'Установка и проверка зависимостей…',
      detail: filesUpdated
        ? 'Обновляю зависимости и конфигурацию проекта…'
        : 'Проверка целостности модулей и ассетов Mindustry…',
      bytesLoaded: totalBytes,
      bytesTotal: totalBytes,
      speedBps: Math.round(totalBytes / elapsedDownloadSec),
    });

    if (filesUpdated) {
      await runCommandStream('npm', ['install', '--no-audit', '--no-fund'], {
        cwd: projectRoot,
        timeoutMs: 120_000,
        onLine(line) {
          send({
            step: 'install',
            progress: 78,
            title: 'Установка зависимостей npm…',
            detail: line.slice(0, 140),
            bytesLoaded: totalBytes,
            bytesTotal: totalBytes,
          });
        },
      });

      if (existsSync(path.join(projectRoot, 'dist'))) {
        send({
          step: 'install',
          progress: 84,
          title: 'Пересборка production-версии…',
          detail: 'Выполняется npm run build…',
          bytesLoaded: totalBytes,
          bytesTotal: totalBytes,
        });
        await runCommandStream('npm', ['run', 'build'], {
          cwd: projectRoot,
          timeoutMs: 120_000,
          onLine(line) {
            send({
              step: 'install',
              progress: 88,
              title: 'Сборка обновлённого интерфейса…',
              detail: line.slice(0, 140),
              bytesLoaded: totalBytes,
              bytesTotal: totalBytes,
            });
          },
        });
      }
    }

    const nextBuild = getBuildInfo(filesUpdated);
    const distDir = path.join(projectRoot, 'dist');
    if (existsSync(distDir)) {
      try {
        mkdirSync(distDir, { recursive: true });
        writeFileSync(path.join(distDir, 'version.json'), JSON.stringify(nextBuild, null, 2));
      } catch {
        // ignore write errors on read-only filesystems
      }
    }

    send({
      step: 'install',
      progress: 92,
      title: 'Синхронизация манифеста сборки…',
      detail: `Актуальная ревизия: ${nextBuild.commit.slice(0, 8)} · готова к запуску`,
      bytesLoaded: totalBytes,
      bytesTotal: totalBytes,
      buildInfo: nextBuild,
    });

    send({
      step: 'reload',
      progress: 100,
      ok: true,
      updated: filesUpdated,
      buildInfo: nextBuild,
      bytesLoaded: totalBytes,
      bytesTotal: totalBytes,
      title: 'Обновление установлено',
      detail: 'Перезагружаю страницу для запуска обновлённой версии…',
    });
  } catch (error) {
    send({
      step: 'error',
      progress: 100,
      ok: false,
      error: error.message || 'Ошибка при установке обновления.',
      title: 'Не удалось завершить установку на сервере',
      detail: error.message || 'Попробуйте повторить обновление.',
    });
  } finally {
    if (!response.writableEnded) response.end();
  }
}

function attachUpdateMiddlewares(middlewares) {
  middlewares.use((request, response, next) => {
    const pathname = request.url?.split('?')[0];
    if (pathname === '/version.json') {
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) return next();
      const manifest = JSON.stringify(getBuildInfo(), null, 2);
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store, max-age=0');
      response.end(request.method === 'HEAD' ? '' : manifest);
      return;
    }
    if (pathname === '/api/update') {
      if (!['POST', 'GET'].includes(request.method ?? 'POST')) return next();
      handleSelfUpdateRequest(request, response);
      return;
    }
    return next();
  });
}

function versionManifestPlugin() {
  return {
    name: 'bee-schem-version-manifest',
    configureServer(server) {
      attachUpdateMiddlewares(server.middlewares);
    },
    configurePreviewServer(server) {
      attachUpdateMiddlewares(server.middlewares);
    },
    transformIndexHtml(html) {
      const runtimeScript = `<script>window.__BEE_BUILD_INFO__=${JSON.stringify(getBuildInfo())};</script>`;
      return html.includes('</head>')
        ? html.replace('</head>', `  ${runtimeScript}\n  </head>`)
        : `${runtimeScript}\n${html}`;
    },
    generateBundle() {
      const manifest = JSON.stringify(getBuildInfo(), null, 2);
      this.emitFile({ type: 'asset', fileName: 'version.json', source: manifest });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionManifestPlugin()],
  define: {
    __APP_BUILD_INFO__: JSON.stringify(initialBuildInfo),
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
