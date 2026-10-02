import React from 'react';

function Icon({ name, size = 16 }) {
  const paths = {
    close: <path d="m18 6-12 12M6 6l12 12" />,
    check: <path d="m5 12 4 4L19 6" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-9h.01" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M20 12a8 8 0 1 0 2.2 5.5" /></>,
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
  const latestSha = state.latestSha || latest?.sha;
  const commitMessage = latest?.commit?.message?.split('\n')[0] ?? '';
  const title = isDeployed ? 'Обновление опубликовано'
    : sourceAhead ? 'Доступен новый исходный код'
      : unavailable ? 'Проверка не удалась'
        : state.checking ? 'Проверяем обновления'
          : 'Приложение актуально';
  const summary = isDeployed
    ? 'Новая веб-сборка уже доступна на сервере. Перезагрузи страницу, чтобы загрузить её.'
    : sourceAhead
      ? 'Ветка проекта на GitHub обновилась, но новая версия сайта ещё не развёрнута. Перезагрузка сейчас не установит исходный код.'
      : unavailable
        ? state.error || 'Не получилось получить манифест сборки или ответ GitHub. Проверь соединение и повтори запрос.'
        : 'Сейчас сервер обслуживает ту же сборку, что открыта в браузере.';
  const stateClass = isDeployed ? 'deployed' : sourceAhead ? 'source-ahead' : unavailable ? 'unavailable' : 'current';
  const commitUrl = latestSha ? `${repositoryUrl}/commit/${latestSha}` : `${repositoryUrl}/commits/${branch}`;

  return <div className="modal-backdrop update-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="update-modal" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="modal-heading">
        <div><span className="section-kicker"><span className="kicker-line" /> WEB UPDATE / GITHUB</span><h2 id="update-title">{title}</h2><p>{summary}</p></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
      </div>
      <div className={`update-status-card ${stateClass}`}>
        <span className={`update-status-icon ${state.checking ? 'spinning' : ''}`}><Icon name={state.checking ? 'refresh' : isDeployed || !unavailable && !sourceAhead ? 'check' : 'info'} size={18} /></span>
        <div><b>{state.checking ? 'Идёт проверка…' : isDeployed ? 'Новая сборка развёрнута' : sourceAhead ? 'Ожидается публикация сайта' : unavailable ? 'Нет ответа от сервера' : 'Новых сборок не найдено'}</b>
          <small>{state.checkedAt ? `Проверено ${formatDate(state.checkedAt)}` : 'Сверяем version.json и GitHub main'}</small></div>
      </div>
      <div className="update-build-list">
        <div><span>В браузере</span><b>{shortSha(local.commit)}</b><small>{local.version ? `v${local.version}` : 'текущая сборка'}</small></div>
        <div><span>На сервере</span><b>{shortSha(deployed?.commit)}</b><small>{deployed?.version ? `v${deployed.version}` : state.manifestReachable ? 'манифест найден' : 'нет манифеста'}</small></div>
        <div><span>GitHub · {branch}</span><b>{shortSha(latestSha)}</b><small>{state.githubReachable ? 'последний коммит' : 'нет ответа'}</small></div>
      </div>
      {commitMessage && <p className="update-commit-message"><span>Последнее изменение</span>{commitMessage}</p>}
      {state.warning && <div className="update-warning"><Icon name="info" size={13} />{state.warning}</div>}
      <div className="update-limit-note"><Icon name="info" size={13} /><span>Браузер не может сам заменить файлы сайта. Эта проверка сравнивает опубликованную сборку с GitHub и предлагает перезагрузку после деплоя.</span></div>
      <div className="modal-footer update-modal-footer">
        <a className="update-repository-link" href={commitUrl} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Репозиторий</a>
        <div>
          {isDeployed && <button className="button button-primary" type="button" onClick={onReload}>Перезагрузить сайт</button>}
          {sourceAhead && <a className="button button-outline" href={commitUrl} target="_blank" rel="noreferrer">Открыть коммит <Icon name="external" size={13} /></a>}
          <button className="button button-outline" type="button" onClick={onCheck} disabled={state.checking}><Icon name="refresh" size={13} />{state.checking ? 'Проверка…' : 'Проверить'}</button>
          <button className="button button-outline" type="button" onClick={onClose}>Позже</button>
        </div>
      </div>
    </section>
  </div>;
}
