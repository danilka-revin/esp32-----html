import React, { useEffect, useMemo, useState } from 'react';
import {
  formatBytes,
  formatSpeed,
  UPDATE_STAGES,
} from './update-checker.js';

function Icon({ name, size = 16, className = '' }) {
  const paths = {
    close: <path d="m18 6-12 12M6 6l12 12" />,
    check: <path d="m5 12 4 4L19 6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-9h.01" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M20 12a8 8 0 1 0 2.2 5.5" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
    external: <><path d="M14 3h7v7m-1-6-9 9" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
    spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></>,
    pause: <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>,
    play: <path d="m6 4 14 8-14 8V4Z" />,
    bolt: <path d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z" />,
    terminal: <><path d="m4 17 6-5-6-5" /><path d="M12 19h8" /></>,
  };
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}

const shortSha = (value) => (value ? String(value).slice(0, 8) : '—');
const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
};

function stageFillPercent(stage, overallProgress) {
  const [start, end] = stage.range;
  if (overallProgress <= start) return 0;
  if (overallProgress >= end) return 100;
  return Math.round(((overallProgress - start) / Math.max(1, end - start)) * 100);
}

function stageFromPercent(percent) {
  for (const stage of UPDATE_STAGES) {
    if (percent <= stage.range[1]) return stage;
  }
  return UPDATE_STAGES[UPDATE_STAGES.length - 1];
}

export default function UpdateDialog({
  state = {},
  installState = {},
  onCheck,
  onInstall,
  onTogglePause,
  onReload,
  onCancelReload,
  reloadCountdownMs = null,
  autoInstall = true,
  setAutoInstall,
  autoReload = true,
  setAutoReload,
  onClose,
  repositoryUrl,
  branch,
}) {
  const local = state.localBuild ?? {};
  const deployed = state.deployedBuild ?? null;
  const latest = state.latestCommit ?? null;
  const isDeployed = state.status === 'deployed-update';
  const sourceAhead = state.status === 'source-ahead';
  const unavailable = state.status === 'unavailable';
  const hasUpdate = isDeployed || sourceAhead;
  const latestSha = state.latestSha || latest?.sha;
  const targetRevision = (isDeployed && deployed?.commit) || latestSha || local.commit || branch;
  const commitMessage = latest?.commit?.message?.split('\n')[0]?.trim() || '';

  const isInstalling = Boolean(installState?.active);
  const isCompleted = Boolean(installState?.completed);
  const isFailed = Boolean(installState?.failed);
  const isPaused = Boolean(installState?.paused);
  const isReloadCountingDown = isCompleted && reloadCountdownMs !== null && reloadCountdownMs > 0;

  const displayProgress = isInstalling || isCompleted || isFailed
    ? Math.max(0, Math.min(100, Number(installState.progress) || 0))
    : state.checking
      ? 14
      : hasUpdate
        ? 0
        : 100;

  const activeStageId = isInstalling || isCompleted || isFailed
    ? (installState.step || 'check')
    : state.checking
      ? 'check'
      : hasUpdate
        ? 'download'
        : 'reload';

  const [inspectedStageId, setInspectedStageId] = useState(null);
  const [followActiveStage, setFollowActiveStage] = useState(true);
  const [hoverPercent, setHoverPercent] = useState(null);
  const [logFilter, setLogFilter] = useState('all');

  useEffect(() => {
    if (followActiveStage) {
      setInspectedStageId(activeStageId);
    }
  }, [activeStageId, followActiveStage]);

  const currentInspectedStage = useMemo(
    () => UPDATE_STAGES.find((stage) => stage.id === (inspectedStageId || activeStageId)) ?? UPDATE_STAGES[0],
    [inspectedStageId, activeStageId],
  );

  const hoverStage = useMemo(
    () => (hoverPercent !== null ? stageFromPercent(hoverPercent) : null),
    [hoverPercent],
  );

  const title = isInstalling
    ? (isPaused ? 'Обновление на паузе' : 'Установка обновления…')
    : isCompleted
      ? 'Обновление установлено'
      : hasUpdate
        ? 'Доступно обновление'
        : unavailable
          ? 'Проверка не удалась'
          : 'Центр автообновления';

  const statusHeadline = isInstalling
    ? (installState.title || 'Скачивание и установка обновления…')
    : isCompleted
      ? (isReloadCountingDown
          ? `Перезагрузка страницы через ${(reloadCountdownMs / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} с…`
          : 'Обновление установлено и готово к перезагрузке')
      : isFailed
        ? (installState.title || 'Не удалось установить обновление')
        : isDeployed
          ? 'Доступна новая сборка приложения'
          : sourceAhead
            ? 'Доступен новый коммит на GitHub'
            : unavailable
              ? 'Нет связи с сервером обновлений'
              : state.checking
                ? 'Сверка версий с GitHub…'
                : 'Установлена актуальная версия';

  const statusSubline = isInstalling || isCompleted || isFailed
    ? (installState.detail || '')
    : hasUpdate
      ? `Ревизия ${shortSha(local.commit)} → ${shortSha(targetRevision)}${commitMessage ? ` · ${commitMessage}` : ''}`
      : state.checkedAt
        ? `Ревизия ${shortSha(local.commit)} · проверено ${formatDate(state.checkedAt)}`
        : `Ревизия ${shortSha(local.commit)}`;

  const stateClass = isFailed
    ? 'unavailable'
    : isCompleted || (!hasUpdate && !unavailable && !isInstalling)
      ? 'deployed'
      : isInstalling || hasUpdate
        ? 'source-ahead'
        : unavailable
          ? 'unavailable'
          : 'current';

  const commitUrl = latestSha ? `${repositoryUrl}/commit/${latestSha}` : `${repositoryUrl}/commits/${branch}`;
  const logs = Array.isArray(installState?.logs) ? installState.logs : [];
  const filteredLogs = logFilter === 'stage'
    ? logs.filter((entry) => entry.step === currentInspectedStage.id)
    : logs;

  const handleTrackMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setHoverPercent(Math.round(ratio * 100));
  };

  const handleTrackClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const clickedStage = stageFromPercent(Math.round(ratio * 100));
    setFollowActiveStage(false);
    setInspectedStageId(clickedStage.id);
  };

  const selectStageCard = (stageId) => {
    setFollowActiveStage(false);
    setInspectedStageId(stageId);
  };

  const elapsedLabel = installState?.elapsedMs
    ? `${(installState.elapsedMs / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} с`
    : '0,0 с';

  return (
    <div
      className="modal-backdrop update-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isInstalling) onClose?.();
      }}
    >
      <section className="update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <div className="update-dialog-heading">
          <div>
            <span className="section-kicker">
              <span className="kicker-line" /> AUTO UPDATE / LIVE INSTALLER
            </span>
            <h2 id="update-title">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </button>
        </div>

        <div className={`update-status-card ${stateClass}`}>
          <span className={`update-status-icon ${state.checking || (isInstalling && !isPaused) ? 'spinning' : ''}`}>
            <Icon
              name={
                state.checking || (isInstalling && !isPaused)
                  ? 'refresh'
                  : isPaused
                    ? 'pause'
                    : isCompleted
                      ? 'check'
                      : hasUpdate
                        ? 'bolt'
                        : unavailable || isFailed
                          ? 'info'
                          : 'check'
              }
              size={18}
            />
          </span>
          <div className="update-status-copy">
            <b>{statusHeadline}</b>
            <small>{statusSubline}</small>
          </div>
          <span className={`update-state-pill ${isInstalling ? (isPaused ? 'paused' : 'active') : isCompleted ? 'done' : hasUpdate ? 'ready' : 'ok'}`}>
            {isInstalling
              ? (isPaused ? 'ПАУЗА' : 'УСТАНОВКА')
              : isCompleted
                ? 'ГОТОВО'
                : hasUpdate
                  ? 'ДОСТУПНО'
                  : state.checking
                    ? 'ПРОВЕРКА'
                    : 'АКТУАЛЬНО'}
          </span>
        </div>

        {/* Интерактивный блок прогресс-бара и этапов */}
        <div className={`update-progress-shell ${isInstalling ? 'is-running' : ''} ${isPaused ? 'is-paused' : ''} ${isCompleted ? 'is-completed' : ''}`}>
          <div className="update-progress-header">
            <div className="update-progress-meta">
              <span className="update-stage-kicker">
                <Icon name="bolt" size={12} />
                {isInstalling
                  ? `Этап: ${currentInspectedStage.label}`
                  : isCompleted
                    ? 'Все этапы завершены'
                    : hasUpdate
                      ? 'Готово к автоматической установке'
                      : 'Система обновлений готова'}
              </span>
              {(isInstalling || isCompleted) && installState?.bytesTotal > 0 && (
                <span className="update-transfer-stats">
                  <code>{formatBytes(installState.bytesLoaded)} / {formatBytes(installState.bytesTotal)}</code>
                  {installState.speedBps > 0 && <i>{formatSpeed(installState.speedBps)}</i>}
                  <i>{elapsedLabel}</i>
                </span>
              )}
            </div>
            <div className="update-progress-percent" aria-live="polite">
              <strong>{displayProgress}%</strong>
            </div>
          </div>

          {/* Интерактивная дорожка прогресс-бара */}
          <div
            className="update-progress-track-wrap"
            onMouseMove={handleTrackMouseMove}
            onMouseLeave={() => setHoverPercent(null)}
            onClick={handleTrackClick}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={displayProgress}
            aria-label="Прогресс скачивания и установки обновления"
            title="Нажмите на участок шкалы, чтобы посмотреть подробности этапа"
          >
            <div className="update-progress-track">
              <div
                className={`update-progress-fill ${isInstalling && !isPaused ? 'shimmer' : ''} ${isCompleted ? 'completed' : ''}`}
                style={{ width: `${displayProgress}%` }}
              >
                {displayProgress > 2 && displayProgress < 100 && <span className="update-progress-glow-head" />}
              </div>
              {UPDATE_STAGES.map((stage) => {
                const milestone = stage.range[1];
                const reached = displayProgress >= milestone;
                const isSelected = currentInspectedStage.id === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    className={`update-track-milestone ${reached ? 'reached' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{ left: `${milestone}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectStageCard(stage.id);
                    }}
                    title={`${stage.label} (${milestone}%)`}
                    aria-label={`Этап ${stage.label}: ${milestone}%`}
                  />
                );
              })}
            </div>
            {hoverStage && hoverPercent !== null && (
              <div
                className="update-track-tooltip"
                style={{ left: `${Math.max(12, Math.min(88, hoverPercent))}%` }}
              >
                <b>{hoverStage.label}</b> · {hoverPercent}%
              </div>
            )}
          </div>

          {/* 4 интерактивные карточки этапов */}
          <div className="update-stage-grid" role="tablist" aria-label="Этапы обновления">
            {UPDATE_STAGES.map((stage, index) => {
              const rawStatus = installState?.stageStatus?.[stage.id];
              const stageState = isInstalling || isCompleted || isFailed
                ? (rawStatus || 'pending')
                : hasUpdate
                  ? 'pending'
                  : 'done';
              const stagePct = stageFillPercent(stage, displayProgress);
              const isSelected = currentInspectedStage.id === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`update-stage-card ${stageState} ${isSelected ? 'selected' : ''}`}
                  onClick={() => selectStageCard(stage.id)}
                >
                  <div className="update-stage-top">
                    <span className="update-stage-index">0{index + 1}</span>
                    <span className="update-stage-dot">
                      {stageState === 'done' ? (
                        <Icon name="check" size={11} />
                      ) : stageState === 'active' ? (
                        <Icon name="refresh" size={11} className={isPaused ? '' : 'spinning'} />
                      ) : (
                        <i />
                      )}
                    </span>
                  </div>
                  <strong className="update-stage-name">{stage.label}</strong>
                  <div className="update-stage-minibar">
                    <i style={{ width: `${stagePct}%` }} />
                  </div>
                  <small className="update-stage-caption">
                    {stageState === 'done'
                      ? 'Готово'
                      : stageState === 'active'
                        ? (isPaused ? 'На паузе' : `${stagePct}%`)
                        : 'Ожидание'}
                  </small>
                </button>
              );
            })}
          </div>

          {/* Интерактивный инспектор выбранного этапа и живой журнал */}
          <div className="update-inspector-panel">
            <div className="update-inspector-top">
              <div>
                <b>{currentInspectedStage.title}</b>
                <p>{currentInspectedStage.description}</p>
              </div>
              <div className="update-inspector-tabs">
                <button
                  type="button"
                  className={`update-mini-pill ${logFilter === 'all' ? 'active' : ''}`}
                  onClick={() => {
                    setLogFilter('all');
                    setFollowActiveStage(true);
                  }}
                >
                  Все шаги {logs.length > 0 ? `(${logs.length})` : ''}
                </button>
                <button
                  type="button"
                  className={`update-mini-pill ${logFilter === 'stage' ? 'active' : ''}`}
                  onClick={() => setLogFilter('stage')}
                >
                  Только «{currentInspectedStage.label}»
                </button>
              </div>
            </div>

            {filteredLogs.length > 0 ? (
              <div className="update-live-log" role="log" aria-live="polite">
                {filteredLogs.slice(-5).map((entry) => (
                  <div key={entry.id} className={`update-log-line ${entry.level || 'info'}`}>
                    <span className="update-log-time">{entry.time}</span>
                    <span className="update-log-tag">{entry.step}</span>
                    <span className="update-log-text">{entry.text}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="update-log-empty">
                <Icon name="terminal" size={13} />
                <span>
                  Архив качать вручную не нужно: приложение само скачивает пакет обновления, устанавливает файлы и перезагружает страницу.
                </span>
              </div>
            )}
          </div>

          {/* Полоса обратного отсчёта автоперезагрузки */}
          {isReloadCountingDown && (
            <div className="update-reload-banner">
              <div className="update-reload-banner-copy">
                <Icon name="refresh" size={14} className="spinning" />
                <span>
                  Автоматическая перезагрузка через <b>{Math.ceil(reloadCountdownMs / 1000)} сек</b> (схема сохранена)
                </span>
              </div>
              <div className="update-reload-banner-actions">
                <button type="button" className="update-mini-pill" onClick={onCancelReload}>
                  Отложить
                </button>
                <button type="button" className="update-mini-pill active" onClick={onReload}>
                  Перезагрузить сейчас
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Интерактивные переключатели автоматизации */}
        <div className="update-preferences-row">
          <button
            type="button"
            className={`update-pref-chip ${autoInstall ? 'on' : ''}`}
            onClick={() => setAutoInstall?.(!autoInstall)}
            aria-pressed={autoInstall}
          >
            <span className="update-pref-indicator" />
            <span>Автоустановка обновлений</span>
          </button>
          <button
            type="button"
            className={`update-pref-chip ${autoReload ? 'on' : ''}`}
            onClick={() => setAutoReload?.(!autoReload)}
            aria-pressed={autoReload}
          >
            <span className="update-pref-indicator" />
            <span>Автоперезагрузка страницы</span>
          </button>
        </div>

        {unavailable && state.error && <p className="update-error-copy">{state.error}</p>}
        {isFailed && installState?.error && <p className="update-error-copy">{installState.error}</p>}

        <details className="update-details">
          <summary>Детали версий и репозитория</summary>
          <div className="update-details-grid">
            <span>Текущая сборка</span>
            <code>{shortSha(local.commit)}</code>
            <span>На сервере</span>
            <code>{shortSha(deployed?.commit || local.commit)}</code>
            <span>GitHub · {branch}</span>
            <code>{shortSha(latestSha || local.commit)}</code>
          </div>
          {state.checkedAt && <small className="update-checked-at">Проверено: {formatDate(state.checkedAt)}</small>}
          {state.warning && <small className="update-warning-copy">{state.warning}</small>}
          <a className="update-details-link" href={commitUrl} target="_blank" rel="noreferrer">
            <Icon name="external" size={12} /> Открыть коммит на GitHub
          </a>
        </details>

        <div className="update-actions">
          {isInstalling ? (
            <>
              <button className="button button-outline" type="button" onClick={onTogglePause}>
                <Icon name={isPaused ? 'play' : 'pause'} size={13} />
                {isPaused ? 'Продолжить' : 'Пауза'}
              </button>
              <button className="button button-primary" type="button" disabled>
                <Icon name="refresh" size={14} className={isPaused ? '' : 'spinning'} />
                {isPaused ? `Пауза · ${displayProgress}%` : `Установка… ${displayProgress}%`}
              </button>
            </>
          ) : isCompleted ? (
            <>
              <button className="button button-outline" type="button" onClick={() => onInstall?.(targetRevision)}>
                <Icon name="refresh" size={13} />
                Проверить ещё раз
              </button>
              <button className="button button-primary" type="button" onClick={onReload}>
                <Icon name="check" size={14} />
                Перезагрузить страницу
              </button>
            </>
          ) : (
            <>
              <button
                className="button button-outline"
                type="button"
                onClick={onCheck}
                disabled={state.checking}
              >
                <Icon name="refresh" size={13} />
                {state.checking ? 'Проверка…' : 'Проверить'}
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={() => onInstall?.(targetRevision)}
                disabled={state.checking}
              >
                <Icon name="bolt" size={14} />
                {hasUpdate ? 'Установить и перезагрузить' : 'Обновить и перезагрузить'}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
