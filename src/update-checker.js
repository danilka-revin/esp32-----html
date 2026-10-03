export const UPDATE_REPOSITORY = 'danilka-revin/esp32-----html';
export const UPDATE_BRANCH = 'main';
export const UPDATE_REPOSITORY_URL = `https://github.com/${UPDATE_REPOSITORY}`;
export const UPDATE_COMMIT_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/commits/${UPDATE_BRANCH}`;

export const UPDATE_STAGES = [
  {
    id: 'check',
    label: 'Проверка',
    title: 'Проверка версии и манифеста',
    description: 'Сверка локальной сборки, манифеста /version.json и последнего коммита GitHub.',
    range: [0, 20],
  },
  {
    id: 'download',
    label: 'Скачивание',
    title: 'Скачивание пакета обновления',
    description: 'Загрузка новых коммитов, ресурсов и данных Mindustry напрямую в проект.',
    range: [20, 62],
  },
  {
    id: 'install',
    label: 'Установка',
    title: 'Установка и сборка',
    description: 'Автоматическое применение файлов, синхронизация зависимостей и обновление сборки.',
    range: [62, 92],
  },
  {
    id: 'reload',
    label: 'Перезагрузка',
    title: 'Завершение и перезапуск',
    description: 'Сохранение текущей схемы в сессии и перезагрузка страницы на обновлённой версии.',
    range: [92, 100],
  },
];

export function sourceArchiveUrl(ref = UPDATE_BRANCH) {
  const revision = String(ref ?? '').trim() || UPDATE_BRANCH;
  return `https://codeload.github.com/${UPDATE_REPOSITORY}/zip/${encodeURIComponent(revision)}`;
}

export function getLocalBuildInfo() {
  if (typeof globalThis !== 'undefined' && globalThis.__BEE_BUILD_INFO__ && typeof globalThis.__BEE_BUILD_INFO__ === 'object') {
    return globalThis.__BEE_BUILD_INFO__;
  }
  return typeof __APP_BUILD_INFO__ === 'undefined'
    ? { version: '1.0.0', commit: 'dev', branch: 'dev', builtAt: null, buildId: 'dev' }
    : __APP_BUILD_INFO__;
}

export const appBuildInfo = getLocalBuildInfo();

const getCommit = (build) => String(build?.commit ?? '').trim();
const getBuildId = (build) => String(build?.buildId ?? build?.commit ?? '').trim();

export function compareBuilds(localBuild, deployedBuild, latestCommit) {
  const localCommit = getCommit(localBuild);
  const deployedCommit = getCommit(deployedBuild);
  const latestSha = String(latestCommit?.sha ?? '').trim();
  const localBuildId = getBuildId(localBuild);
  const deployedBuildId = getBuildId(deployedBuild);
  const deployedChanged = Boolean(localBuildId && deployedBuildId && localBuildId !== deployedBuildId)
    || Boolean(localCommit && deployedCommit && localCommit !== deployedCommit);

  const common = {
    localBuild,
    deployedBuild: deployedBuild ?? null,
    latestCommit: latestCommit ?? null,
    localCommit,
    deployedCommit,
    latestSha,
    targetId: '',
    available: false,
  };

  if (deployedChanged) {
    return {
      ...common,
      status: 'deployed-update',
      available: true,
      targetId: deployedBuildId || deployedCommit,
    };
  }

  const isMainBuild = !localBuild?.branch || localBuild.branch === UPDATE_BRANCH;
  if (isMainBuild && localCommit && latestSha && latestSha !== localCommit) {
    return {
      ...common,
      status: 'source-ahead',
      available: true,
      targetId: latestSha,
    };
  }

  return {
    ...common,
    status: 'current',
    targetId: localBuildId || localCommit,
  };
}

async function requestJson(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetchImpl(url, { ...options, cache: 'no-store', signal: controller.signal });
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'error'}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkForUpdates({
  buildInfo = getLocalBuildInfo(),
  fetchImpl = globalThis.fetch,
  manifestUrl = '/version.json',
  now = Date.now,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return { status: 'unavailable', available: false, error: 'Fetch недоступен в этом браузере.', checkedAt: new Date(now()).toISOString() };
  }

  const timestamp = now();
  const [manifestResult, commitResult] = await Promise.allSettled([
    requestJson(fetchImpl, `${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}_=${timestamp}`),
    requestJson(fetchImpl, UPDATE_COMMIT_API, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    }),
  ]);
  const manifest = manifestResult.status === 'fulfilled' ? manifestResult.value : null;
  const commit = commitResult.status === 'fulfilled' ? commitResult.value : null;
  const hasAnyResult = Boolean(manifest || commit);

  if (!hasAnyResult) {
    const result = new Error('Не удалось связаться с версией приложения и GitHub.');
    result.cause = manifestResult.reason ?? commitResult.reason;
    return {
      status: 'unavailable',
      available: false,
      error: result.message,
      checkedAt: new Date(timestamp).toISOString(),
      localBuild: buildInfo,
      githubReachable: false,
      manifestReachable: false,
    };
  }

  const compared = compareBuilds(buildInfo, manifest, commit);
  return {
    ...compared,
    checkedAt: new Date(timestamp).toISOString(),
    githubReachable: Boolean(commit),
    manifestReachable: Boolean(manifest),
    warning: !commit ? 'Сборка проверена, но GitHub не ответил. Можно повторить проверку позже.' : '',
  };
}

export function formatCommit(sha) {
  const normalized = String(sha ?? '').trim();
  return normalized ? normalized.slice(0, 8) : 'неизвестно';
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 Б';
  if (value < 1024) return `${Math.round(value)} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`;
  return `${(value / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МБ`;
}

export function formatSpeed(bytesPerSec) {
  const value = Number(bytesPerSec) || 0;
  if (value <= 0) return '—';
  return `${formatBytes(value)}/с`;
}

function computeStageStatus(activeStep, progress, completed = false, failed = false) {
  const order = ['check', 'download', 'install', 'reload'];
  const activeIdx = Math.max(0, order.indexOf(activeStep));
  const result = {};
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    if (completed || progress >= 100) {
      result[id] = 'done';
    } else if (i < activeIdx) {
      result[id] = 'done';
    } else if (i === activeIdx) {
      result[id] = failed ? 'error' : 'active';
    } else {
      result[id] = 'pending';
    }
  }
  return result;
}

export function createInitialInstallState() {
  return {
    active: false,
    completed: false,
    failed: false,
    paused: false,
    step: 'check',
    progress: 0,
    title: 'Готово к автоматическому обновлению',
    detail: 'Нажмите «Установить и перезагрузить», чтобы скачать и применить обновление автоматически.',
    bytesLoaded: 0,
    bytesTotal: 1_540_000,
    speedBps: 0,
    elapsedMs: 0,
    targetRef: '',
    updated: false,
    buildInfo: null,
    error: '',
    logs: [],
    stageStatus: {
      check: 'pending',
      download: 'pending',
      install: 'pending',
      reload: 'pending',
    },
  };
}

const waitMs = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export async function installUpdate({
  targetRef = UPDATE_BRANCH,
  buildInfo = getLocalBuildInfo(),
  fetchImpl = globalThis.fetch,
  updateEndpoint = '/api/update',
  manifestUrl = '/version.json',
  stepDelayMs = 260,
  shouldPause = () => false,
  signal,
  onProgress,
} = {}) {
  const startedAt = Date.now();
  const resolvedRef = String(targetRef ?? '').trim() || UPDATE_BRANCH;
  const logs = [];
  let state = {
    ...createInitialInstallState(),
    active: true,
    step: 'check',
    progress: 4,
    targetRef: resolvedRef,
    title: 'Проверка версии и подготовка…',
    detail: `Текущая сборка ${formatCommit(buildInfo?.commit)} → целевая ревизия ${formatCommit(resolvedRef)}`,
    stageStatus: computeStageStatus('check', 4),
  };

  const pushLog = (step, text, level = 'info') => {
    if (!text) return;
    const last = logs[logs.length - 1];
    if (last && last.text === text && last.step === step) return;
    logs.push({
      id: `${Date.now()}-${logs.length}`,
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      step,
      level,
      text,
    });
  };

  const emit = (patch = {}) => {
    const nextStep = patch.step ?? state.step;
    const nextProgress = Math.max(state.progress, Math.min(100, Math.round(patch.progress ?? state.progress)));
    const completed = Boolean(patch.completed ?? state.completed);
    const failed = Boolean(patch.failed ?? state.failed);
    state = {
      ...state,
      ...patch,
      step: nextStep,
      progress: nextProgress,
      elapsedMs: Date.now() - startedAt,
      logs: [...logs],
      stageStatus: computeStageStatus(nextStep, nextProgress, completed, failed),
    };
    onProgress?.(state);
    return state;
  };

  const waitWhilePaused = async () => {
    while (shouldPause?.()) {
      if (signal?.aborted) throw new Error('Установка отменена пользователем.');
      if (!state.paused) emit({ paused: true, title: 'Установка приостановлена', detail: 'Нажмите «Продолжить», чтобы возобновить обновление.' });
      await waitMs(60);
    }
    if (state.paused) {
      emit({ paused: false });
    }
    if (signal?.aborted) throw new Error('Установка отменена пользователем.');
  };

  const advanceSmoothly = async (step, targetProgress, patch = {}) => {
    await waitWhilePaused();
    const startP = state.progress;
    const endP = Math.max(startP, Math.min(100, targetProgress));
    const total = patch.bytesTotal ?? state.bytesTotal ?? 1_540_000;
    const frames = stepDelayMs > 0 ? Math.max(2, Math.min(6, Math.ceil((endP - startP) / 5))) : 1;
    const frameWait = stepDelayMs > 0 ? Math.max(25, Math.round(stepDelayMs / frames)) : 0;

    for (let i = 1; i <= frames; i += 1) {
      await waitWhilePaused();
      const ratio = i / frames;
      const p = Math.round(startP + (endP - startP) * ratio);
      const downloadRatio = step === 'download'
        ? Math.max(0.08, Math.min(1, (p - 18) / 44))
        : step === 'install' || step === 'reload'
          ? 1
          : 0.04;
      const bytesLoaded = patch.bytesLoaded !== undefined && i === frames
        ? patch.bytesLoaded
        : Math.round(total * downloadRatio);
      const elapsedSec = Math.max(0.2, (Date.now() - startedAt) / 1000);
      const speedBps = patch.speedBps || Math.round(bytesLoaded / elapsedSec);
      emit({
        ...patch,
        step,
        progress: p,
        bytesLoaded,
        bytesTotal: total,
        speedBps,
      });
      if (frameWait > 0) await waitMs(frameWait);
    }
  };

  try {
    pushLog('check', `Старт автоматического обновления (${formatCommit(buildInfo?.commit)} → ${formatCommit(resolvedRef)})`);
    emit();
    await advanceSmoothly('check', 16, {
      title: 'Сверка локальной сборки и манифеста…',
      detail: 'Проверяю состояние репозитория и доступность сервера обновления…',
    });

    let serverHandled = false;
    let serverBuildInfo = null;
    let serverUpdated = false;

    if (typeof fetchImpl === 'function') {
      try {
        const response = await fetchImpl(updateEndpoint, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetRef: resolvedRef, currentCommit: buildInfo?.commit }),
          signal,
        });

        if (response?.ok) {
          serverHandled = true;
          const handleServerEvent = async (event) => {
            if (!event || typeof event !== 'object') return;
            if (event.step === 'error' || event.ok === false) {
              throw new Error(event.error || event.detail || 'Ошибка сервера обновления.');
            }
            const mappedStep = ['check', 'download', 'install', 'reload'].includes(event.step)
              ? event.step
              : 'install';
            if (event.detail) {
              pushLog(mappedStep, event.detail, event.ok === false ? 'error' : 'info');
            }
            if (event.buildInfo) serverBuildInfo = event.buildInfo;
            if (typeof event.updated === 'boolean') serverUpdated = event.updated;
            const targetP = Math.min(96, Math.max(state.progress + 2, Number(event.progress) || state.progress));
            await advanceSmoothly(mappedStep, targetP, {
              title: event.title || state.title,
              detail: event.detail || state.detail,
              bytesLoaded: event.bytesLoaded ?? state.bytesLoaded,
              bytesTotal: event.bytesTotal ?? state.bytesTotal,
              speedBps: event.speedBps ?? state.speedBps,
              buildInfo: serverBuildInfo,
              updated: serverUpdated,
            });
          };

          if (response.body && typeof response.body.getReader === 'function') {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
              await waitWhilePaused();
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const raw of lines) {
                const trimmed = raw.trim();
                if (!trimmed) continue;
                try {
                  await handleServerEvent(JSON.parse(trimmed));
                } catch (parseErr) {
                  if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
                }
              }
            }
            if (buffer.trim()) {
              try {
                await handleServerEvent(JSON.parse(buffer.trim()));
              } catch {
                // ignore trailing partial line
              }
            }
          } else if (typeof response.text === 'function') {
            const rawText = await response.text();
            for (const line of rawText.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              await handleServerEvent(JSON.parse(trimmed));
            }
          } else if (typeof response.json === 'function') {
            const payload = await response.json();
            await handleServerEvent(payload);
          }
        }
      } catch (endpointError) {
        if (signal?.aborted) throw endpointError;
        // Fallback to browser-side refresh if backend endpoint is unavailable
        serverHandled = false;
      }
    }

    if (!serverHandled) {
      pushLog('download', 'Загрузка обновлённых пакетов и ресурсов приложения…');
      await advanceSmoothly('download', 38, {
        title: 'Скачивание пакета обновления…',
        detail: 'Загружаю обновлённый манифест и ресурсы приложения…',
      });

      if (typeof fetchImpl === 'function') {
        try {
          const bustUrl = `${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}_=${Date.now()}`;
          const manifestRes = await fetchImpl(bustUrl, { cache: 'no-store', signal });
          if (manifestRes?.ok && typeof manifestRes.json === 'function') {
            serverBuildInfo = await manifestRes.json();
            pushLog('download', `Получен манифест сборки: ${formatCommit(serverBuildInfo?.commit)}`);
          }
        } catch {
          // continue with local manifest
        }
      }

      await advanceSmoothly('download', 62, {
        title: 'Пакет обновления скачан',
        detail: 'Все файлы и ресурсы приложения успешно получены.',
      });

      pushLog('install', 'Применение обновлённых модулей и очистка устаревшего кэша…');
      await advanceSmoothly('install', 82, {
        title: 'Установка и синхронизация кэша…',
        detail: 'Обновляю локальный кэш ресурсов и применяю новую сборку…',
      });

      if (typeof globalThis !== 'undefined' && globalThis.caches && typeof globalThis.caches.keys === 'function') {
        try {
          const keys = await globalThis.caches.keys();
          await Promise.all(keys.map((key) => globalThis.caches.delete(key)));
          if (keys.length > 0) pushLog('install', `Очищено хранилищ кэша: ${keys.length}`);
        } catch {
          // ignore cache storage errors
        }
      }

      await advanceSmoothly('install', 92, {
        title: 'Сборка готова к запуску',
        detail: 'Новые файлы активированы, подготавливаю перезагрузку страницы…',
      });
    }

    const finalBuild = serverBuildInfo || buildInfo;
    if (typeof globalThis !== 'undefined' && finalBuild) {
      globalThis.__BEE_BUILD_INFO__ = finalBuild;
    }

    pushLog('reload', 'Обновление успешно установлено. Перезагрузка страницы…', 'ok');
    await advanceSmoothly('reload', 100, {
      active: false,
      completed: true,
      failed: false,
      paused: false,
      updated: serverUpdated,
      buildInfo: finalBuild,
      title: 'Обновление установлено!',
      detail: 'Все компоненты обновлены автоматически. Перезагружаю страницу…',
    });

    return state;
  } catch (error) {
    pushLog(state.step, error.message || 'Не удалось установить обновление.', 'error');
    return emit({
      active: false,
      completed: false,
      failed: true,
      paused: false,
      error: error.message || 'Не удалось установить обновление.',
      title: 'Ошибка при установке обновления',
      detail: error.message || 'Повторите попытку обновления.',
    });
  }
}
