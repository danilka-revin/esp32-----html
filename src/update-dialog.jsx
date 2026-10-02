import React from 'react';
import { sourceArchiveUrl } from './update-checker.js';

function Icon({ name, size = 16 }) {
  const paths = {
    close: <path d="m18 6-12 12M6 6l12 12" />,
    check: <path d="m5 12 4 4L19 6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-9h.01" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M20 12a8 8 0 1 0 2.2 5.5" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
    external: <><path d="M14 3h7v7m-1-6-9 9" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.info}</svg>;
}

const shortSha = (value) => value ? String(value).slice(0, 8) : '—';
const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function UpdateDialog({ state = {}, onCheck, onReload, onClose, repositoryUrl, branch }) {
  const local = state.localBuild ?? {};
  const deployed = state.deployedBuild ?? null;
  const latest = state.latestCommit ?? null;
  const isDeployed = state.status === 'deployed-update';
  const sourceAhead = state.status === 'source-ahead';
  const unavailable = state.status === 'unavailable';
  const hasUpdate = isDeployed || sourceAhead;
  const latestSha = state.latestSha || latest?.sha;
  const archiveRef = (isDeployed && deployed?.commit) || latestSha || branch;
  const title = hasUpdate ? 'Обновление доступно' : unavailable ? 'Проверка не удалась' : 'Обновления';
  const status = isDeployed ? 'Новая версия сайта'
    : sourceAhead ? 'Новая версия на GitHub'
      : unavailable ? 'Нет связи'
        : state.checking ? 'Идёт проверка…'
          : 'Актуально';
  const versionLabel = isDeployed && deployed?.version ? `v${deployed.version}` : shortSha(isDeployed ? deployed?.commit : latestSha);
  const stateClass = isDeployed ? 'deployed' : sourceAhead ? 'source-ahead' : unavailable ? 'unavailable' : 'current';
  const commitUrl = latestSha ? `${repositoryUrl}/commit/${latestSha}` : `${repositoryUrl}/commits/${branch}`;

  return <div className="modal-backdrop update-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="update-dialog-heading">
        <div><h2 id="update-title">{title}</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
      </div>

      <div className={`update-status-card ${stateClass}`}>
        <span className={`update-status-icon ${state.checking ? 'spinning' : ''}`}><Icon name={state.checking ? 'refresh' : isDeployed || sourceAhead ? 'download' : unavailable ? 'info' : 'check'} size={18} /></span>
        <div><b>{status}</b><small>{hasUpdate ? versionLabel : state.checkedAt ? formatDate(state.checkedAt) : ''}</small></div>
      </div>

      {hasUpdate && <p className="update-download-note">{isDeployed ? 'Скачать ZIP исходного кода или обновить сайт.' : 'Скачать ZIP проекта с последним кодом.'}</p>}
      {unavailable && state.error && <p className="update-error-copy">{state.error}</p>}

      <details className="update-details">
        <summary>Детали</summary>
        <div className="update-details-grid">
          <span>Текущая сборка</span><code>{shortSha(local.commit)}</code>
          <span>На сайте</span><code>{shortSha(deployed?.commit)}</code>
          <span>GitHub · {branch}</span><code>{shortSha(latestSha)}</code>
        </div>
        {state.checkedAt && <small className="update-checked-at">Проверено: {formatDate(state.checkedAt)}</small>}
        {state.warning && <small className="update-warning-copy">{state.warning}</small>}
        <a className="update-details-link" href={commitUrl} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> GitHub</a>
      </details>

      <div className="update-actions">
        {hasUpdate && <a className="button button-primary" href={sourceArchiveUrl(archiveRef)} download={`bee-schematic-lab-${shortSha(archiveRef)}.zip`} referrerPolicy="no-referrer" title={`Скачать ZIP коммита ${archiveRef}`}><Icon name="download" size={14} />Скачать ZIP</a>}
        {isDeployed && <button className="button button-outline" type="button" onClick={onReload}>Обновить сайт</button>}
        {!isDeployed && <button className="button button-outline" type="button" onClick={onCheck} disabled={state.checking}><Icon name="refresh" size={13} />{state.checking ? 'Проверка…' : hasUpdate ? 'Проверить' : 'Проверить снова'}</button>}
      </div>
    </section>
  </div>;
}
