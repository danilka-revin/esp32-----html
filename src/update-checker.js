export const UPDATE_REPOSITORY = 'danilka-revin/esp32-----html';
export const UPDATE_BRANCH = 'main';
export const UPDATE_REPOSITORY_URL = `https://github.com/${UPDATE_REPOSITORY}`;
export const UPDATE_COMMIT_API = `https://api.github.com/repos/${UPDATE_REPOSITORY}/commits/${UPDATE_BRANCH}`;

export function sourceArchiveUrl(ref = UPDATE_BRANCH) {
  const revision = String(ref ?? '').trim() || UPDATE_BRANCH;
  return `https://codeload.github.com/${UPDATE_REPOSITORY}/zip/${encodeURIComponent(revision)}`;
}

export const appBuildInfo = typeof __APP_BUILD_INFO__ === 'undefined'
  ? { version: '1.0.0', commit: 'dev', branch: 'dev', builtAt: null, buildId: 'dev' }
  : __APP_BUILD_INFO__;

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
  buildInfo = appBuildInfo,
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
