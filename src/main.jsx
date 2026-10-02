import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  buildableBlocks, categories, categoryById, directionMeta, gameBlocks, gameCatalog,
  getPlanetLabel, getStageLabel, getProductsForDirection, itemById, visibleMaterials, stageMeta, typeLabels,
} from './catalog.js';
import { blockFits, blockRect, canvasPresets, generateLayout, generateLayoutVariants, initialSettings, supplyModes, tileAtCell } from './generator.js';
import { buildLogicProgram, getLogicLinkInstructions, getTransportItem, needsLogicProgram } from './logic.js';
import { appBuildInfo, checkForUpdates, formatCommit, UPDATE_BRANCH, UPDATE_REPOSITORY_URL } from './update-checker.js';
import UpdateDialog from './update-dialog.jsx';
import { decodeSchematicFile, decodeSchematic, downloadSchematic, schematicToBase64 } from './schematic-io.js';
import './styles.css';
import sprites from './sprite-manifest.json';
import { analyzeMechanics, blockFacts } from './mechanics.js';
import { GAME_VERSION } from './game-version.js';

const iconPaths = {
  spark: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /><path d="m5 3 .6 1.4L7 5l-1.4.6L5 7l-.6-1.4L3 5l1.4-.6L5 3Z" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 0 1 0 14h-2" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9h-9a7 7 0 0 0 0 14h2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
  moon: <path d="M20.7 13.1A8.6 8.6 0 0 1 10.9 3.3 8.6 8.6 0 1 0 20.7 13.1Z" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5m5-5v12" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  grid: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>,
  cursor: <path d="m5 3 14 10-6 1.5L10 21 5 3Z" />,
  eraser: <><path d="m7 21 10-10" /><path d="m5.1 12.9 7.8-7.8a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8l-7.8 7.8H7l-1.9-1.9a2 2 0 0 1 0-2.8Z" /></>,
  rotate: <><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" /><path d="M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16" /><path d="M3 21v-5h5" /></>,
  zoomIn: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M11 8v6m-3-3h6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4m-8-5h6" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6" /></>,
  close: <path d="m18 6-12 12M6 6l12 12" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-9h.01" /></>,
  bookmark: <><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18l-6-4-6 4V4Z" /></>,
  plus: <path d="M12 5v14m-7-7h14" />,
  minus: <path d="M5 12h14" />,
  box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 8 9 5 9-5m-18 0v9l9 5 9-5V8m-9 5v9" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5m-18 5 9 5 9-5" /></>,
  filter: <><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" /></>,
  external: <><path d="M14 3h7v7m-1-6-9 9" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  sliders: <><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M2 14h4m4-6h4m4 8h4" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M20 12a8 8 0 1 0 2.2 5.5" /><path d="M4 17v-5h5" /></>,
};

function Icon({ name, size = 16, className = '' }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name] ?? iconPaths.box}</svg>;
}

const categoryColors = {
  mining: '#e7a444', production: '#bd8df0', logistics: '#51c4cb', power: '#ffc233',
  defense: '#f07474', turret: '#fb806d', storage: '#92be70', liquid: '#58b7ec',
  units: '#5bc38b', logic: '#de78c9', payload: '#d3ac63', campaign: '#e4bd54',
  sandbox: '#adb8c5', surface: '#87919d', ore: '#ce9a5a', boulder: '#9299a5',
  item: '#d1ad72', unit: '#65b88e',
};

const stripGameMarkup = (text = '') => text.replace(/\[[^\]]+\]/g, '').replace(/\\n/g, ' ').trim();

function markFor(entry) {
  if (entry?.mark) return entry.mark;
  if (entry?.type === 'block') {
    const parts = String(entry.id ?? '').split('-').filter((part) => !['large', 'small', 'reinforced', 'armored'].includes(part));
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] ?? '◈').slice(0, 2)).toUpperCase();
  }
  return categoryById.get(entry?.category)?.icon ?? '◈';
}

function GameGlyph({ entry, size = 'small', className = '' }) {
  const category = entry?.category ?? entry?.type ?? 'block';
  const mark = markFor(entry);
  const sprite = sprites[`${entry?.type ?? 'block'}:${entry?.id}`];
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [sprite?.file]);
  return <span className={`game-glyph glyph-${size} cat-${category} ${className}`} style={{ '--glyph-color': categoryColors[category] ?? categoryColors.item }} aria-hidden="true">
    <span>{sprite && !failed && !sprite.invisible ? <img className="game-texture" src={sprite.file} alt="" loading="lazy" onError={() => setFailed(true)} /> : mark}</span>{entry?.size > 1 && size !== 'tiny' && <i>{entry.size}×</i>}
  </span>;
}

function CanvasTexture({ id, x, y, size, rotation, glyph }) {
  const sprite = sprites[`block:${id}`];
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);
  if (!sprite || failed) return <text x={x + size / 2} y={y + size / 2} textAnchor="middle" className="block-mark" style={{ fontSize: '.45px' }}>{glyph}</text>;
  const directional = blockFacts[id]?.rotate || /conveyor|duct|conduit/.test(id);
  return <image className="canvas-texture" href={sprite.file} x={x} y={y} width={size} height={size} preserveAspectRatio="xMidYMid meet" transform={directional ? `rotate(${-rotation * 90} ${x + size / 2} ${y + size / 2})` : undefined} onError={() => setFailed(true)} />;
}

function MechanicsReport({ mechanics }) {
  const name = id => gameCatalog.find(e => ['item', 'liquid'].includes(e.type) && e.id === id)?.name ?? id;
  const fmt = n => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return <section className="inspector-section mechanics-report">
    <div className="panel-section-heading"><span>МЕХАНИКИ / {GAME_VERSION}</span></div>
    <p className="microcopy">Базовая скорость · без ускорения.</p>
    {mechanics.requirements.map((r, i) => <div className="recipe-report" key={i}>
      <b>{buildableBlocks.find(b => b.id === r.tile.id)?.name ?? r.tile.id}</b>
      <p>Вход: {r.inputs.map(v => `${name(v.id)} ${fmt(v.rate)}/с`).join(' · ')}</p>
      <p>Выход: {r.output.map(v => `${name(v.id)} ${fmt(v.rate)}/с`).join(' · ')}</p>
      {Object.keys(r.liquids).length > 0 && <p>Жидкости: {Object.entries(r.liquids).map(([id, rate]) => `${name(id)} ${fmt(rate)}/с`).join(' · ')}</p>}
      {r.heat > 0 && <p>Тепло: {r.heat} ед.</p>}
    </div>)}
    <ul>{mechanics.warnings.map(w => <li key={w}>{w}</li>)}</ul>
  </section>;
}

function TinyTag({ children, tone = '' }) { return <span className={`tiny-tag ${tone}`}>{children}</span>; }

function Toggle({ checked, onChange, label, detail, disabled = false }) {
  return <button className={`toggle-row ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`} type="button" disabled={disabled} onClick={() => !disabled && onChange(!checked)} aria-pressed={checked} aria-disabled={disabled} title={detail}>
    <span className="toggle-copy"><b>{label}</b>{detail && <small className="visually-hidden">{detail}</small>}</span><span className="switch"><i /></span>
  </button>;
}

function Toast({ toast, onClose }) {
  if (!toast) return null;
  return <div className={`toast ${toast.type ?? 'success'}`} role="status">
    <span className="toast-icon"><Icon name={toast.type === 'error' ? 'info' : 'check'} size={15} /></span><span>{toast.message}</span>
    <button className="icon-button toast-close" onClick={onClose} type="button" aria-label="Закрыть"><Icon name="close" size={14} /></button>
  </div>;
}

function StatCard({ label, value, icon }) {
  return <div className="stat-card"><span className="stat-icon"><Icon name={icon} size={15} /></span><span className="stat-copy"><small>{label}</small><b>{value}</b></span></div>;
}

function Header({ view, setView, canUndo, canRedo, onUndo, onRedo, theme, setTheme, onImport, onExport, onCopy, onPaste, onSave, savedCount, catalogCount, onOpenUpdates, updateState, updateAttention }) {
  return <header className="toolbar">
    <button className="brand" type="button" onClick={() => setView('editor')} aria-label="На главную"><span className="brandmark"><img src="/logo.png" alt="" /></span><span className="brandtext"><b>BEE <em>SCHEM</em></b></span></button>
    <nav className="top-nav" aria-label="Разделы приложения">
      <button className={`nav-tab ${view === 'editor' ? 'active' : ''}`} type="button" onClick={() => setView('editor')}><Icon name="grid" size={15} /><span>Редактор</span></button>
      <button className={`nav-tab ${view === 'catalog' ? 'active' : ''}`} type="button" onClick={() => setView('catalog')}><Icon name="layers" size={15} /><span>Каталог</span><i>{catalogCount}</i></button>
    </nav>
    <div className="toolbar-rule" /><div className="toolbar-group history-group">
      <button className="tool-btn" type="button" title="Отменить · Ctrl+Z" disabled={!canUndo} onClick={onUndo}><Icon name="undo" /></button>
      <button className="tool-btn" type="button" title="Повторить · Ctrl+Shift+Z" disabled={!canRedo} onClick={onRedo}><Icon name="redo" /></button>
    </div>
    <div className="toolbar-spacer" />
    <button className={`tool-btn update-check-button ${updateAttention ? 'available' : ''} ${updateState?.checking ? 'checking' : ''}`} type="button" onClick={onOpenUpdates} title={updateAttention ? 'Доступно обновление приложения' : 'Проверить обновления'} aria-label="Проверить обновления">
      <Icon name="refresh" size={15} /><span className="button-label">Обновления</span>{updateAttention && <i className="update-badge-dot" />}
    </button>
    <div className="vanilla-badge"><span className="status-dot" /> STEAM <b>{GAME_VERSION}</b></div>
    <div className="toolbar-group file-group">
      <button className="tool-btn wide" type="button" title="Сохранить в браузере" onClick={onSave}><Icon name="bookmark" /><span className="button-label">Сохранить</span>{savedCount > 0 && <i className="save-count">{savedCount}</i>}</button>
      <button className="tool-btn wide" type="button" title="Импортировать .msch" onClick={onImport}><Icon name="upload" /><span className="button-label">Импорт</span></button>
      <button className="tool-btn wide" type="button" title="Вставить код схемы" onClick={onPaste}><Icon name="copy" /><span className="button-label">Вставить</span></button>
    </div>
    <div className="toolbar-group theme-group"><button className="tool-btn theme-toggle" type="button" title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} /></button></div>
    <button className="button button-primary export-button" type="button" onClick={onExport}><Icon name="download" size={15} /><span>Экспорт .msch</span></button>
  </header>;
}

function GeneratorSidebar({ settings, setSettings, onGenerate, dirty, paletteCategory, setPaletteCategory, paletteSearch, setPaletteSearch, onSelectBlock, selectedBlock, activeTool, setView }) {
  const minimalModule = (settings.minimal || (settings.campaignLink && settings.direction === 'production')) && settings.direction === 'production';
  const productOptions = getProductsForDirection(settings.direction, settings.planet, settings.stage);
  const product = productOptions.find((item) => item.id === settings.goal) ?? productOptions[0];
  const hasSupplySettings = ['production', 'defense', 'units', 'logistics'].includes(settings.direction);
  const isErekir = settings.planet === 'erekir';
  const isDroneMode = ['drones', 'hybrid'].includes(settings.supplyMode);
  const campaignDefenseImport = settings.campaignLink && settings.direction === 'defense' && !isErekir;
  const showTransportSettings = isErekir
    ? ['core', 'drones', 'hybrid'].includes(settings.supplyMode)
    : (settings.processorControl || isDroneMode);
  const erekirSupplyModes = {
    core: { label: 'Буфер', hint: `В Эрекире нельзя выгружать предметы напрямую из ядра: схема использует усиленный контейнер и канальный разгрузчик для @${getTransportItem(settings)}.` },
    local: { label: 'Локально', hint: 'Локальная подача от производственных блоков или отдельного склада.' },
    drones: { label: 'Грузовой дрон', hint: `Unit Cargo Loader создаёт Manifold автоматически. Подай @${getTransportItem(settings)} в загрузчик; точка выгрузки настроена на тот же предмет.` },
    hybrid: { label: 'Гибрид', hint: `Линия от складского буфера плюс Manifold. Наполни контейнер ресурсом @${getTransportItem(settings)} и подай его в загрузчик.` },
  };
  const transportOptions = visibleMaterials.filter((item) => item.planet === settings.planet || item.planet === 'both');
  const droneUnitOptions = settings.planet === 'erekir'
    ? [{ id: 'manifold', label: 'Manifold · грузовой дрон' }]
    : [{ id: 'mono', label: 'Mono · базовый' }, { id: 'poly', label: 'Poly · строитель' }, { id: 'mega', label: 'Mega · грузовой' }];
  const planetBlocks = useMemo(() => buildableBlocks.filter((block) => block.planet === 'both' || block.planet === settings.planet), [settings.planet]);
  const filteredPalette = useMemo(() => planetBlocks.filter((block) => {
    const matchesCategory = paletteCategory === 'all' || block.category === paletteCategory;
    const query = paletteSearch.trim().toLocaleLowerCase('ru');
    return matchesCategory && (!query || `${block.name} ${block.id}`.toLocaleLowerCase('ru').includes(query));
  }), [planetBlocks, paletteCategory, paletteSearch]);
  const paletteCategories = categories.filter((category) => planetBlocks.some((block) => block.category === category.id));
  const patch = (field, value) => setSettings((current) => ({ ...current, [field]: value }));
  const setDirection = (direction) => setSettings((current) => {
    const options = getProductsForDirection(direction, current.planet, current.stage);
    return options.length ? { ...current, direction, goal: options.some(option => option.id === current.goal) ? current.goal : options[0].id } : current;
  });
  const setPlanet = (planet) => setSettings((current) => {
    const fallbackItem = planet === 'erekir' ? 'beryllium' : 'copper';
    const currentItem = visibleMaterials.find((item) => item.id === current.transportItem && (item.planet === planet || item.planet === 'both'))?.id;
    const processorControl = planet === 'erekir' ? false : current.planet === 'erekir' ? true : current.processorControl;
    const productChoices = getProductsForDirection(current.direction, planet, current.stage);
    const goal = productChoices.some(option => option.id === current.goal) ? current.goal : productChoices[0]?.id ?? current.goal;
    return { ...current, planet, goal, processorControl, campaignLink: planet === 'serpulo' ? current.campaignLink : false, droneUnit: planet === 'erekir' ? 'manifold' : 'mono', transportItem: currentItem ?? fallbackItem };
  });
  const setSupplyMode = (supplyMode) => setSettings((current) => ({
    ...current,
    supplyMode,
    processorControl: current.planet === 'erekir' ? false : ['drones', 'hybrid'].includes(supplyMode) ? true : current.processorControl,
  }));
  const setCampaignLink = (enabled) => setSettings((current) => ({
    ...current,
    campaignLink: enabled && current.planet === 'serpulo' && ['production', 'defense'].includes(current.direction),
    ...(enabled && current.direction === 'production' ? { minimal: true } : {}),
    ...(enabled && current.direction === 'defense' ? { processorControl: false } : {}),
  }));

  return <aside className="left-sidebar panel-scroll">
    <div className="sidebar-title-row"><div><h1>Генератор</h1></div><span className="generator-spark"><Icon name="spark" size={18} /></span></div>
    <section className="setting-section"><div className="field-label"><span>НАПРАВЛЕНИЕ</span></div><div className="direction-grid">
      {Object.entries(directionMeta).map(([id, direction]) => { const available = getProductsForDirection(id, settings.planet, settings.stage).length > 0; return <button className={`direction-option ${settings.direction === id ? 'selected' : ''}`} type="button" key={id} disabled={!available} title={available ? direction.label : `В ${getPlanetLabel(settings.planet)} нет поддержанной схемы для этого направления`} onClick={() => setDirection(id)}><span className="direction-icon">{direction.icon}</span><span>{direction.short}</span></button>; })}
    </div></section>
    <section className="setting-section compact-section"><div className="field-label"><span>ЭТАП ИГРЫ</span></div><div className="stage-segment">
      {Object.entries(stageMeta).map(([id, stage]) => <button type="button" key={id} className={`stage-choice ${settings.stage === id ? `active ${stage.color}` : ''}`} onClick={() => patch('stage', id)}><i>{stage.number}</i><span>{stage.label}</span></button>)}
    </div></section>
    <section className="setting-section compact-section"><div className="field-label"><span>ПЛАНЕТА</span></div><div className="planet-switch">
      <button type="button" className={settings.planet === 'serpulo' ? 'selected' : ''} onClick={() => setPlanet('serpulo')}><span className="planet-orb serpulo" />Серпуло</button>
      <button type="button" className={settings.planet === 'erekir' ? 'selected' : ''} onClick={() => setPlanet('erekir')}><span className="planet-orb erekir" />Эрекир</button>
    </div></section>
    <section className="setting-section compact-section"><label className="field-label" htmlFor="goal-select"><span>ЦЕЛЬ</span></label><div className="select-wrap">
      <select id="goal-select" value={product?.id ?? ''} onChange={(event) => patch('goal', event.target.value)}>{productOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><Icon name="chevron" size={13} />
    </div></section>
    {['production', 'defense'].includes(settings.direction) && <section className="setting-section campaign-link-setting">
      <div className="field-label"><span>КАМПАНИЯ / ОБМЕН РЕСУРСАМИ</span><small>{GAME_VERSION}</small></div>
      <Toggle checked={Boolean(settings.campaignLink && !isErekir)} disabled={isErekir} onChange={setCampaignLink}
        label={settings.direction === 'production' ? 'Экспорт продукта с площадки' : 'Импорт боеприпасов на посадочную площадку'}
        detail={isErekir ? 'Посадочные площадки v8 доступны на Серпуло.' : settings.direction === 'production' ? 'Advanced Launch Pad подключится к продукту; в кампании выбери сектор-получатель.' : 'Landing Pad настроится на выбранный предмет и подаст его в оборону.'} />
      {isErekir && <p className="microcopy">В v160.2 посадочная/пусковая цепочка для этого шаблона доступна на Серпуло.</p>}
    </section>}
    {hasSupplySettings && !minimalModule && !campaignDefenseImport && <>
      <section className="setting-section supply-section"><div className="field-label"><span>СНАБЖЕНИЕ</span></div>
        <div className="supply-mode-grid" role="group" aria-label="Способ снабжения">
          {supplyModes.map((mode) => <button type="button" key={mode.id} title={isErekir ? erekirSupplyModes[mode.id]?.hint ?? mode.hint : mode.hint} className={`supply-mode-option ${settings.supplyMode === mode.id ? 'selected' : ''}`} onClick={() => setSupplyMode(mode.id)}><span>{mode.mark}</span><b>{isErekir ? erekirSupplyModes[mode.id]?.label ?? mode.label : mode.label}</b></button>)}
        </div>
      </section>
      {showTransportSettings && <section className="setting-section compact-section logic-settings-section">
        <label className="field-label" htmlFor="transport-item-select"><span>{isErekir ? (isDroneMode ? 'ФИЛЬТР ПРЕДМЕТА' : 'ПРЕДМЕТ ДЛЯ РАЗГРУЗКИ') : isDroneMode ? 'ГРУЗ ДЛЯ ДОСТАВКИ' : 'РЕСУРС ДЛЯ КОНТРОЛЯ'}</span></label>
        <div className="select-wrap"><select id="transport-item-select" value={getTransportItem(settings)} onChange={(event) => patch('transportItem', event.target.value)}>{transportOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · @{item.id}</option>)}</select><Icon name="chevron" size={13} /></div>
        {isErekir ? <p className="microcopy">{isDroneMode ? 'Manifold работает без MLOG; фильтр сохранится в .msch.' : 'Нужен буфер: ядро Эрекира нельзя разгрузить напрямую.'}</p> : isDroneMode ? <>
          <label className="field-label sub-field-label" htmlFor="drone-unit-select"><span>ТИП ЮНИТА</span></label>
          <div className="select-wrap"><select id="drone-unit-select" value={settings.droneUnit} onChange={(event) => patch('droneUnit', event.target.value)}>{droneUnitOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.label}</option>)}</select><Icon name="chevron" size={13} /></div>
          <div className="range-heading"><span>ГРУЗ ЗА РЕЙС</span><b>{settings.droneCapacity ?? 50}</b></div>
          <input className="range-input" style={{ '--range-progress': `${(((settings.droneCapacity ?? 50) - 10) / 140) * 100}%` }} type="range" min="10" max="150" step="10" value={settings.droneCapacity ?? 50} onChange={(event) => patch('droneCapacity', Number(event.target.value))} />
          <p className="microcopy">Для MLOG свяжи фабрику с процессором.</p>
        </> : <>
          <Toggle checked={settings.processorControl} onChange={(value) => patch('processorControl', value)} label="Контроль запасов MLOG" detail="Включать фабрику при достаточном запасе в ядре" />
          {settings.processorControl && <>
            <div className="range-heading"><span>ПОРОГ ЗАПАСА В ЯДРЕ</span><b>{settings.reserveThreshold ?? 40}</b></div>
            <input className="range-input" style={{ '--range-progress': `${(((settings.reserveThreshold ?? 40) - 20) / 280) * 100}%` }} type="range" min="20" max="300" step="10" value={settings.reserveThreshold ?? 40} onChange={(event) => patch('reserveThreshold', Number(event.target.value))} />
          </>}
        </>}
      </section>}
    </>}
    {campaignDefenseImport && <section className="setting-section compact-section logic-settings-section">
      <label className="field-label" htmlFor="landing-ammo-select"><span>БОЕПРИПАС ДЛЯ ИМПОРТА</span></label>
      <div className="select-wrap"><select id="landing-ammo-select" value={getTransportItem(settings)} onChange={(event) => patch('transportItem', event.target.value)}>{transportOptions.map((item) => <option key={item.id} value={item.id}>{item.name} · @{item.id}</option>)}</select><Icon name="chevron" size={13} /></div>
      <p className="microcopy">Фильтр Landing Pad сохранится в .msch. Выбери для сектора экспорт этого предмета и проверь, что тип турели принимает эти боеприпасы.</p>
    </section>}
    <section className="setting-section"><Toggle checked={minimalModule} disabled={Boolean(settings.campaignLink && settings.direction === 'production')} onChange={(value) => patch('minimal', value)} label="Минимальная схема" detail={settings.campaignLink && settings.direction === 'production' ? 'Экспортный модуль автоматически использует компактную компоновку.' : 'Одна фабрика с отдельными портами по рецепту.'} />{minimalModule && <p className="microcopy">Подключи предметные входы, жидкости, тепло и энергию снаружи. Для экспорта дополнительно нужны масло и питание.</p>}{minimalModule && <Toggle checked={settings.includePower} onChange={(value) => patch('includePower', value)} label="Узел внешнего питания" detail="Только соединение; энергию и топливо подай снаружи" />}</section>
    {!minimalModule && <><section className="setting-section compact-section"><div className="field-label"><span>РАЗМЕР СХЕМЫ</span><small>ДО 128 × 128</small></div><div className="size-options">
      {Object.entries(canvasPresets).map(([id, preset]) => <button type="button" key={id} className={`size-option ${settings.footprint === id ? 'selected' : ''}`} onClick={() => patch('footprint', id)}><span className={`size-preview ${id}`}><i /></span><span>{preset.label}</span><small>{preset.note}</small></button>)}
    </div></section>
    <section className="setting-section compact-section"><div className="field-label"><span>ПЛОТНОСТЬ</span><small>{settings.compactness}%</small></div>
      <input className="range-input" style={{ '--range-progress': `${((settings.compactness - 25) / 65) * 100}%` }} type="range" min="25" max="90" step="5" value={settings.compactness} onChange={(event) => patch('compactness', Number(event.target.value))} />
      <div className="range-captions"><span>Свободно</span><span>Компактно</span></div></section>
    <section className="setting-section option-toggles">
      <Toggle checked={settings.includePower} onChange={(value) => patch('includePower', value)} label="Подключить питание" detail="Силовые узлы и генераторы" />
      <Toggle checked={settings.includeDefense} onChange={(value) => patch('includeDefense', value)} label="Добавить защиту" detail="Турели у ключевых точек" />
      <Toggle checked={settings.includeStorage} onChange={(value) => patch('includeStorage', value)} label="Резервное хранилище" detail="Контейнер рядом с ядром" />
    </section>
    </>}
    <button className="button button-primary generate-button" type="button" onClick={onGenerate}><Icon name="spark" size={17} /><span>Сгенерировать схему</span><kbd>↵</kbd></button>
    {dirty && <div className="generator-hint dirty"><span className="hint-dot" />Параметры изменены</div>}
    <div className="sidebar-divider" />
    <div className="palette-heading"><div><div className="field-label"><span>ПАЛИТРА</span><small>{filteredPalette.length} / {planetBlocks.length}</small></div></div><button className="link-button" type="button" onClick={() => setView('catalog')}>Каталог <Icon name="external" size={12} /></button></div>
    <div className="palette-controls"><div className="search-field palette-search"><Icon name="search" size={14} /><input value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder="Найти блок..." aria-label="Найти блок" /></div>
      <div className="select-wrap palette-select-wrap"><select value={paletteCategory} onChange={(event) => setPaletteCategory(event.target.value)} aria-label="Категория блоков"><option value="all">Все категории</option>{paletteCategories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select><Icon name="chevron" size={12} /></div>
    </div>
    <div className="palette-list">
      {filteredPalette.slice(0, 72).map((block) => <button type="button" key={block.id} draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', block.id); event.dataTransfer.effectAllowed = 'copy'; }} className={`palette-item ${selectedBlock === block.id && activeTool === 'place' ? 'selected' : ''}`} onClick={() => onSelectBlock(block.id)} title={`${block.name} · ${block.id}`}>
        <GameGlyph entry={block} size="tiny" /><span className="palette-item-name">{block.name}</span>{block.size > 1 && <small>{block.size}×</small>}
      </button>)}
      {filteredPalette.length > 72 && <button className="palette-more" type="button" onClick={() => setView('catalog')}>Ещё {filteredPalette.length - 72} блока в каталоге <Icon name="chevron" size={13} /></button>}
      {!filteredPalette.length && <div className="empty-palette">Ничего не найдено. Попробуй другой запрос.</div>}
    </div>
  </aside>;
}

function BlockCanvas({ scheme, selectedKey, setSelectedKey, tool, selectedBlock, onPlace, onErase, onMove, onSelect, gridVisible, showNames, zoom, svgRef, onDropBlock }) {
  const width = scheme.width; const height = scheme.height;
  const viewportRef = useRef(null);
  const panRef = useRef(null);
  const blockDragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const spacePressedRef = useRef(false);
  const [spacePanReady, setSpacePanReady] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragPreview, setDragPreview] = useState(null);
  useEffect(() => {
    const isInteractive = (target) => target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName) || target.isContentEditable || Boolean(target.closest('[role="button"]')));
    const keyDown = (event) => { if (event.code === 'Space' && !isInteractive(event.target)) { event.preventDefault(); spacePressedRef.current = true; setSpacePanReady(true); } };
    const keyUp = (event) => { if (event.code === 'Space') { spacePressedRef.current = false; setSpacePanReady(false); } };
    const blur = () => { spacePressedRef.current = false; setSpacePanReady(false); };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); };
  }, []);
  const entryFor = (id) => buildableBlocks.find((block) => block.id === id) ?? gameBlocks.find((block) => block.id === id) ?? { id, type: 'block', category: 'sandbox', name: id };
  const color = (id) => categoryColors[entryFor(id).category] ?? '#adb7c3';
  const iconFor = (id) => markFor(entryFor(id));
  const nameFor = (id) => entryFor(id).name ?? id;
  const sizeFor = (id) => entryFor(id).size ?? 1;
  const makePoint = (event) => {
    const svg = svgRef.current;
    if (!svg?.getScreenCTM) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.floor(transformed.x), y: height - 1 - Math.floor(transformed.y) };
  };
  const handlePointer = (event) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    event.preventDefault?.();
    const point = makePoint(event); if (!point) return;
    const hit = tileAtCell(scheme.tiles, point.x, point.y);
    if (tool === 'erase') { if (hit) onErase(hit); else setSelectedKey(null); return; }
    if (tool === 'place') { if (selectedBlock) onPlace(point.x, point.y, selectedBlock); return; }
    if (hit) onSelect(hit); else setSelectedKey(null);
  };
  const startPan = (event) => {
    if (event.button !== 1 && !(event.button === 0 && spacePressedRef.current)) return;
    event.preventDefault();
    suppressClickRef.current = false;
    const viewport = viewportRef.current;
    if (!viewport) return;
    panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop, moved: false };
    setIsPanning(true);
    viewport.setPointerCapture?.(event.pointerId);
  };
  const startBlockDrag = (event, tile) => {
    if (event.button !== 0 || tool !== 'select' || spacePressedRef.current) return;
    event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false;
    const point = makePoint(event);
    if (!point) return;
    setSelectedKey(`${tile.x}:${tile.y}`);
    blockDragRef.current = { tile, startX: point.x, startY: point.y };
    svgRef.current?.setPointerCapture?.(event.pointerId);
  };
  const movePointer = (event) => {
    if (panRef.current) {
      const pan = panRef.current;
      const dx = event.clientX - pan.startX; const dy = event.clientY - pan.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
      const viewport = viewportRef.current;
      if (viewport) { viewport.scrollLeft = pan.scrollLeft - dx; viewport.scrollTop = pan.scrollTop - dy; }
      return;
    }
    if (!blockDragRef.current) return;
    const point = makePoint(event); if (!point) return;
    const drag = blockDragRef.current;
    const dx = point.x - drag.startX; const dy = point.y - drag.startY;
    if (dx || dy) setDragPreview({ key: `${drag.tile.x}:${drag.tile.y}`, dx, dy });
    else setDragPreview(null);
  };
  const finishPointer = (event) => {
    if (panRef.current) {
      if (panRef.current.moved) suppressClickRef.current = true;
      panRef.current = null; setIsPanning(false);
    }
    if (blockDragRef.current) {
      const drag = blockDragRef.current;
      const point = makePoint(event);
      const dx = point ? point.x - drag.startX : 0; const dy = point ? point.y - drag.startY : 0;
      blockDragRef.current = null; setDragPreview(null);
      if (dx || dy) { suppressClickRef.current = true; onMove?.(drag.tile, drag.tile.x + dx, drag.tile.y + dy); }
    }
  };
  const gridPath = useMemo(() => { let path = ''; for (let x = 0; x <= width; x += 1) path += `M${x} 0V${height} `; for (let y = 0; y <= height; y += 1) path += `M0 ${y}H${width} `; return path; }, [width, height]);
  const majorGridPath = useMemo(() => { let path = ''; for (let x = 0; x <= width; x += 4) path += `M${x} 0V${height} `; for (let y = 0; y <= height; y += 4) path += `M0 ${y}H${width} `; return path; }, [width, height]);

  return <div ref={viewportRef} className={`canvas-viewport ${spacePanReady ? 'pan-ready' : ''} ${isPanning ? 'panning' : ''}`} onPointerDown={startPan} onPointerMove={movePointer} onPointerUp={finishPointer} onPointerCancel={finishPointer} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); const point = makePoint(event); if (id && point) onDropBlock(point.x, point.y, id); }}>
    <div className="canvas-blueprint" /><div className="coordinate-label coord-nw">0,{height - 1} <span>GRID / TILE</span></div><div className="coordinate-label coord-ne">{width} × {height} <span>MSCH</span></div>
    <svg ref={svgRef} className={`schematic-svg ${gridVisible ? '' : 'no-grid'} ${tool === 'place' ? 'placing' : ''} ${tool === 'erase' ? 'erasing' : ''}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} role="img" aria-label={`Схема Mindustry ${width} на ${height}, ${scheme.tiles.length} построек`} onClick={handlePointer}>
      <defs><radialGradient id="canvas-vignette"><stop offset="0" stopColor="var(--canvas-vignette-center)" /><stop offset="1" stopColor="var(--canvas-vignette-edge)" /></radialGradient><filter id="selected-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="0.11" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter></defs>
      <rect width={width} height={height} className="canvas-base" rx="0.5" />
      {gridVisible && <><path d={gridPath} className="canvas-grid-minor" /><path d={majorGridPath} className="canvas-grid-major" /></>}
      <ellipse cx={width / 2} cy={height / 2} rx={width * .47} ry={height * .45} fill="url(#canvas-vignette)" pointerEvents="none" />
      <path d={`M ${width / 2 - .28} ${height / 2} h .56 M ${width / 2} ${height / 2 - .28} v .56`} className="canvas-center-mark" pointerEvents="none" />
      {scheme.tiles.map((tile) => {
        const key = `${tile.x}:${tile.y}`; const size = sizeFor(tile.id); const worldRect = blockRect(tile); const rect = { ...worldRect, startY: height - 1 - worldRect.endY, endY: height - 1 - worldRect.startY };
        const x = rect.startX + .08; const y = rect.startY + .08; const visualSize = Math.max(.78, size - .16);
        const selected = selectedKey === key; const tone = color(tile.id); const glyph = iconFor(tile.id); const label = nameFor(tile.id);
              return <g key={key} className={`canvas-block ${selected ? 'selected' : ''} ${size > 1 ? 'large-block' : ''}`} transform={dragPreview?.key === key ? `translate(${dragPreview.dx} ${-dragPreview.dy})` : undefined} onPointerDown={(event) => startBlockDrag(event, tile)} onClick={(event) => { event.stopPropagation(); handlePointer(event); }} onContextMenu={(event) => { event.preventDefault(); onErase(tile); }} style={{ '--block-color': tone }}>
          <title>{`${label} · ${tile.id} · ${size}×${size} · поворот ${tile.rotation ?? 0}`}</title>
          <rect x={x} y={y} width={visualSize} height={visualSize} rx=".08" className="block-shadow" />
          <CanvasTexture id={tile.id} x={rect.startX} y={rect.startY} size={size} rotation={tile.rotation ?? 0} glyph={glyph} />
          {(blockFacts[tile.id]?.rotate || /conveyor|duct|conduit/.test(tile.id)) && <path d={`M ${rect.startX + size - .08} ${rect.startY + size / 2} l -.24 -.12 v .24 z`} className="block-direction" transform={`rotate(${-tile.rotation * 90} ${rect.startX + size / 2} ${rect.startY + size / 2})`} />}
          {showNames && <text x={rect.startX + size / 2} y={rect.endY + .35} textAnchor="middle" className="block-label">{label.length > 17 ? `${label.slice(0, 15)}…` : label}</text>}
          {selected && <rect x={x - .07} y={y - .07} width={visualSize + .14} height={visualSize + .14} rx={size === 1 ? .18 : .29} className="block-selection" />}
        </g>;
      })}
    </svg>
    <div className="canvas-legend"><span className="legend-pulse" />{tool === 'place' && selectedBlock ? `Поставить: ${buildableBlocks.find((block) => block.id === selectedBlock)?.name ?? selectedBlock}` : tool === 'erase' ? 'Клик — удалить' : 'Клик — выбрать · правый клик — удалить'}<small>Space + перетаскивание или средняя кнопка — панорама · перетащи блок, чтобы переместить</small></div>
    <div className="canvas-coordinates">X {Math.floor(width / 2)} <i /> Y {Math.floor(height / 2)}</div>
  </div>;
}

function calculateAnalytics(scheme) {
  const counts = new Map();
  for (const tile of scheme.tiles) counts.set(tile.id, (counts.get(tile.id) ?? 0) + 1);
  const sortedBlocks = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const materialTotals = new Map();
  const mechanics = analyzeMechanics(scheme);
  for (const [id, amount] of mechanics.costs) materialTotals.set(id, amount);
  const resources = [...materialTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, amount]) => ({ ...itemById.get(id), id, amount }));
  const generators = scheme.tiles.filter((tile) => /generator|reactor|solar-panel|condenser|power-source/.test(tile.id)).length;
  return { mechanics, counts, sortedBlocks, resources, unique: counts.size, total: scheme.tiles.length, generators };
}

function Inspector({ scheme, analytics, selectedTile, onRotate, onRemove, onSave, savedSchemes, onLoadSaved, onDeleteSaved, onExport, onCopy, onCopyLogic, name, setName }) {
  const [tab, setTab] = useState('summary');
  useEffect(() => { setTab(selectedTile ? 'selection' : 'summary'); }, [selectedTile?.id, selectedTile?.x, selectedTile?.y]);
  const selectedBlock = selectedTile && (buildableBlocks.find((block) => block.id === selectedTile.id) ?? gameBlocks.find((block) => block.id === selectedTile.id));
  const direction = directionMeta[scheme.settings?.direction] ?? directionMeta.production;
  const stage = stageMeta[scheme.settings?.stage] ?? stageMeta.mid;
  const world = getPlanetLabel(scheme.settings?.planet ?? 'serpulo');
  const product = getProductsForDirection(scheme.settings?.direction, scheme.settings?.planet, scheme.settings?.stage).find((item) => item.id === scheme.settings?.goal);
  const logicSettings = scheme.settings ?? {};
  const showLogicProgram = needsLogicProgram(logicSettings);
  const logicProgram = showLogicProgram ? buildLogicProgram(logicSettings) : '';
  const showErekirSupplyGuide = logicSettings.planet === 'erekir' && ['core', 'drones', 'hybrid'].includes(logicSettings.supplyMode);
  const selectedCategory = categoryById.get(selectedBlock?.category);
  const categoryCount = (category) => scheme.tiles.filter((tile) => buildableBlocks.find((block) => block.id === tile.id)?.category === category).length;
  const assemblyCount = scheme.tiles.filter((tile) => /factory|fabricator|reconstructor|assembler/.test(tile.id)).length;
  const outputMetric = {
    mining: [categoryCount('mining'), 'буровых блоков'], production: [categoryCount('production'), 'переработчиков'],
    defense: [categoryCount('turret'), 'турелей'], power: [analytics.generators, 'источников энергии'],
    logistics: [categoryCount('logistics'), 'транспортных блоков'], units: [assemblyCount, 'узлов сборки'],
    logic: [categoryCount('logic'), 'логических блоков'], campaign: [categoryCount('campaign'), 'пусковых блоков'],
  }[scheme.settings?.direction] ?? [0, 'блоков'];

  return <aside className="right-sidebar panel-scroll">
    <div className="inspector-header"><h2>Схема</h2></div>
    <div className="inspector-tabs"><button type="button" className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>Сводка</button><button type="button" className={tab === 'selection' ? 'active' : ''} onClick={() => setTab('selection')}>Блок{selectedTile ? <i className="tab-dot" /> : ''}</button></div>
    {tab === 'selection' && selectedTile ? <div className="selection-details">
      <div className="selected-block-hero"><GameGlyph entry={selectedBlock ?? { category: 'sandbox' }} size="large" /><div><span className="field-label">ВЫБРАННЫЙ ОБЪЕКТ</span><h3>{selectedBlock?.name ?? selectedTile.id}</h3><code>{selectedTile.id}</code></div></div>
      <div className="selection-props"><div><small>КООРДИНАТЫ</small><b>{selectedTile.x}, {selectedTile.y}</b></div><div><small>РАЗМЕР</small><b>{selectedBlock?.size ?? 1} × {selectedBlock?.size ?? 1}</b></div><div><small>ПОВОРОТ</small><b>{(selectedTile.rotation ?? 0) * 90}°</b></div><div><small>ПЛАНЕТА</small><b>{selectedBlock?.planet === 'erekir' ? 'Эрекир' : selectedBlock?.planet === 'both' ? 'Обе' : 'Серпуло'}</b></div></div>
      <div className="block-detail-copy">{stripGameMarkup(selectedBlock?.description) || `${selectedCategory?.label ?? 'Блок'} из ванильного набора Mindustry. Внутриигровое имя: ${selectedTile.id}.`}</div>
      <div className="rotation-row"><span>Направление блока</span><button className="button button-outline" type="button" onClick={onRotate}><Icon name="rotate" size={14} /> Повернуть</button></div>
      <button className="button button-danger-soft full-width" type="button" onClick={() => onRemove(selectedTile)}><Icon name="trash" size={14} /> Удалить блок</button>
    </div> : <>
      <section className="scheme-identity-card"><div className="identity-top"><span className="tiny-tag gold">{stage.number} · {stage.label.toUpperCase()}</span></div>
        <input className="scheme-name-input" value={name} onChange={(event) => setName(event.target.value)} aria-label="Название схемы" />
        <div className="identity-meta"><span><i className="meta-world-dot" />{world}</span><span>{direction.short}</span></div>
      </section>
      <div className="stats-grid"><StatCard label="Постройки" value={analytics.total} icon="box" /><StatCard label="Типы" value={analytics.unique} icon="layers" /></div>
      <section className="inspector-section production-summary"><div className="panel-section-heading"><span>ЦЕЛЬ</span></div>
        <div className="production-row"><span className="production-icon" style={{ '--production-color': categoryColors[scheme.settings?.direction === 'power' ? 'power' : scheme.settings?.direction === 'defense' ? 'turret' : scheme.settings?.direction === 'mining' ? 'mining' : 'production'] }}>{direction.icon}</span><div className="production-text"><b>{product?.label ?? direction.goal}</b></div><div className="production-rate"><b>{outputMetric[0]}</b><small>{outputMetric[1]}</small></div></div>
        <div className="production-bar"><i style={{ width: `${Math.max(22, Math.min(100, analytics.total * 2.2))}%` }} /></div><div className="production-foot"><span>{scheme.width}×{scheme.height}</span></div>
      </section>
      <section className="inspector-section resource-section"><div className="panel-section-heading"><span>ОЦЕНКА МАТЕРИАЛОВ</span><button className="mini-icon-button" type="button" title="Оценка по размещённым блокам"><Icon name="info" size={13} /></button></div>
        <div className="resource-list">{analytics.resources.map((resource) => <div className="resource-row" key={resource.id}><GameGlyph entry={resource} size="tiny" /><span>{resource.name}</span><b>{resource.amount.toLocaleString('ru-RU')}</b><i className="resource-bar"><span style={{ width: `${Math.max(18, Math.min(100, resource.amount / (analytics.resources[0]?.amount || 1) * 100))}%` }} /></i></div>)}</div>
        <p className="microcopy">Топ-5 ресурсов{analytics.mechanics.unknownCosts > 0 && ` · нет данных: ${analytics.mechanics.unknownCosts}`}</p>
      </section>
      <MechanicsReport mechanics={analytics.mechanics} />
      {showErekirSupplyGuide && <section className="inspector-section logic-program-section cargo-route-guide">
        <div className="panel-section-heading"><span>ЭРЕКИР / ГРУЗОВОЙ МАРШРУТ</span><i className="logic-live-pill"><b /> MANIFOLD</i></div>
        {['core', 'hybrid'].includes(logicSettings.supplyMode) && <p className="logic-link-hint">Эрекир не позволяет выгружать ресурсы прямо из ядра. Наполни усиленный контейнер предметом <b>@{getTransportItem(logicSettings)}</b>; канальный разгрузчик в схеме забирает его из контейнера.</p>}
        {['drones', 'hybrid'].includes(logicSettings.supplyMode) && <p className="logic-link-hint">Unit Cargo Loader создаёт Manifold автоматически. Подай в загрузчик <b>@{getTransportItem(logicSettings)}</b>; точка выгрузки уже настроена на этот предмет. MLOG для Manifold не нужен.</p>}
        <div className="logic-export-note"><Icon name="info" size={13} /><span>Фильтр точки выгрузки сохраняется в .msch. Проверь подключение предметного конвейера к Unit Cargo Loader и наличие питания и азота для создания Manifold.</span></div>
      </section>}
      {showLogicProgram && <section className="inspector-section logic-program-section">
        <div className="panel-section-heading"><span>MLOG / ПРОЦЕССОР</span><i className="logic-live-pill"><b /> {logicSettings.supplyMode === 'drones' || logicSettings.supplyMode === 'hybrid' ? 'ДРОН' : 'КОНТРОЛЬ'}</i></div>
        <p className="logic-link-hint">{getLogicLinkInstructions(logicSettings)}</p>
        <textarea className="logic-program-code" readOnly value={logicProgram} spellCheck="false" aria-label="Программа Mindustry Logic" />
        <button className="button button-outline full-width copy-logic-button" type="button" onClick={onCopyLogic}><Icon name="copy" size={13} /> Скопировать MLOG</button>
        <div className="logic-export-note"><Icon name="info" size={13} /><span>Процессор появится в .msch, но код нужно вставить в игре вручную: бинарную конфигурацию MLOG браузерный экспорт не компилирует. {['core', 'hybrid'].includes(logicSettings.supplyMode) && <>Настрой разгрузчик на @<b>{getTransportItem(logicSettings)}</b>.</>}</span></div>
      </section>}
      <section className="inspector-section block-list-section"><div className="panel-section-heading"><span>СОСТАВ ПОСТРОЕК</span><span className="subtle-count">{analytics.unique} типов</span></div><div className="building-list">
        {analytics.sortedBlocks.slice(0, 6).map(([id, count]) => { const block = buildableBlocks.find((item) => item.id === id) ?? { id, name: id, category: 'sandbox' }; return <div className="building-row" key={id}><GameGlyph entry={block} size="tiny" /><span>{block.name}</span><b>×{count}</b></div>; })}
        {analytics.sortedBlocks.length === 0 && <span className="microcopy">На сетке пока нет блоков.</span>}
      </div></section>
      <section className="saved-schemes-section"><div className="panel-section-heading"><span>МОИ СХЕМЫ</span><button className="mini-icon-button" type="button" title="Сохранить текущую схему" onClick={onSave}><Icon name="plus" size={14} /></button></div>
        {savedSchemes.length === 0 ? <div className="saved-empty"><Icon name="bookmark" size={14} /><span>Нет сохранённых схем.</span></div> : savedSchemes.slice(0, 3).map((saved) => <div className="saved-scheme-row" key={saved.key}><button type="button" className="saved-load" onClick={() => onLoadSaved(saved)}><span className="saved-scheme-thumb"><Icon name="grid" size={13} /></span><span><b>{saved.name}</b><small>{saved.width}×{saved.height} · {saved.tiles.length} блоков</small></span></button><button className="icon-button saved-delete" type="button" title="Удалить из сохранённых" onClick={() => onDeleteSaved(saved.key)}><Icon name="close" size={13} /></button></div>)}
      </section>
      <div className="inspector-actions"><button className="button button-outline full-width" type="button" onClick={onCopy}><Icon name="copy" size={14} /> Копировать код</button><button className="button button-primary full-width" type="button" onClick={onExport}><Icon name="download" size={14} /> Скачать .msch</button></div>
    </>}
  </aside>;
}

function EditorPage({ settings, setSettings, setView, dirty, onGenerate, scheme, setScheme, name, setName, activeTool, setActiveTool, selectedBlock, setSelectedBlock, selectedTileKey, setSelectedTileKey, gridVisible, setGridVisible, showNames, setShowNames, zoom, setZoom, onSave, savedSchemes, onLoadSaved, onDeleteSaved, onExport, onCopy, onCopyLogic, onPaste, notify }) {
  const svgRef = useRef(null);
  const [paletteCategory, setPaletteCategory] = useState('all');
  const [paletteSearch, setPaletteSearch] = useState('');
  const analytics = useMemo(() => calculateAnalytics(scheme), [scheme]);
  const selectedTile = scheme.tiles.find((tile) => `${tile.x}:${tile.y}` === selectedTileKey) ?? null;
  const activeScheme = useMemo(() => ({ ...scheme, name: name.trim() || scheme.name, tags: { ...(scheme.tags ?? {}), name: name.trim() || scheme.name } }), [scheme, name]);
  const commitTiles = (tiles) => setScheme((current) => ({ ...current, tiles }));
  const placeBlock = (x, y, id) => {
    const block = buildableBlocks.find((entry) => entry.id === id);
    if (!block?.campaignBuildable || (block.planet !== 'both' && block.planet !== settings.planet)) {
      notify({ type: 'error', message: 'Эта постройка недоступна для кампании на выбранной планете.' });
      return;
    }
    const px = Math.max(0, Math.min(scheme.width - 1, x)); const py = Math.max(0, Math.min(scheme.height - 1, y));
    if (tileAtCell(scheme.tiles, px, py)) { notify({ type: 'error', message: 'Место занято. Выбери пустую клетку или сначала удали блок.' }); return; }
    if (!blockFits(scheme.tiles, id, px, py, scheme.width, scheme.height)) { notify({ type: 'error', message: 'Этот блок не помещается здесь или пересекается с другой постройкой.' }); return; }
    commitTiles([...scheme.tiles, { id, x: px, y: py, rotation: 0, config: null }]);
    setSelectedTileKey(`${px}:${py}`); setActiveTool('select'); setSelectedBlock(id);
  };
  const eraseTile = (tile) => { commitTiles(scheme.tiles.filter((item) => item !== tile)); setSelectedTileKey(null); };
  const moveBlock = (tile, x, y) => {
    const nextX = Math.max(0, Math.min(scheme.width - 1, x));
    const nextY = Math.max(0, Math.min(scheme.height - 1, y));
    if (!blockFits(scheme.tiles, tile.id, nextX, nextY, scheme.width, scheme.height, tile)) {
      notify({ type: 'error', message: 'Нельзя переместить блок: клетка занята или часть блока выйдет за край поля.' });
      return;
    }
    commitTiles(scheme.tiles.map((item) => item === tile ? { ...item, x: nextX, y: nextY } : item));
    setSelectedTileKey(`${nextX}:${nextY}`);
  };
  const rotateTile = () => { if (!selectedTile) return; commitTiles(scheme.tiles.map((tile) => tile === selectedTile ? { ...tile, rotation: ((tile.rotation ?? 0) + 1) % 4 } : tile)); };
  const moveZoom = (change) => setZoom((current) => Math.max(.7, Math.min(1.28, Math.round((current + change) * 100) / 100)));

  return <main className="workspace-grid">
    <GeneratorSidebar settings={settings} setSettings={setSettings} onGenerate={onGenerate} dirty={dirty} paletteCategory={paletteCategory} setPaletteCategory={setPaletteCategory} paletteSearch={paletteSearch} setPaletteSearch={setPaletteSearch} onSelectBlock={(id) => { setSelectedBlock(id); setActiveTool('place'); }} selectedBlock={selectedBlock} activeTool={activeTool} setView={setView} />
    <section className="editor-column">
      <div className="editor-heading">
        <div className="editor-title-line"><div className="editor-title-copy"><input value={name} onChange={(event) => setName(event.target.value)} aria-label="Название схемы" /></div><div className="editor-title-actions"><span className="tiny-tag muted">{getPlanetLabel(settings.planet)}</span><button className="icon-button" type="button" title="Вставить код схемы" onClick={onPaste}><Icon name="copy" size={15} /></button><button className="icon-button" type="button" title="Сохранить схему в браузере" onClick={onSave}><Icon name="bookmark" size={15} /></button></div></div>
      </div>
      <div className="editor-window"><div className="editor-toolbar"><div className="editor-tool-group">
        <button className={`tool-square ${activeTool === 'select' ? 'active' : ''}`} type="button" title="Выбор · V" onClick={() => setActiveTool('select')}><Icon name="cursor" size={15} /></button>
        <button className={`tool-square ${activeTool === 'place' ? 'active' : ''}`} type="button" title="Размещение блока" onClick={() => selectedBlock ? setActiveTool('place') : notify({ type: 'error', message: 'Сначала выбери блок в палитре слева.' })}><Icon name="plus" size={16} /></button>
        <button className={`tool-square ${activeTool === 'erase' ? 'active danger' : ''}`} type="button" title="Ластик · клик по блоку удаляет" onClick={() => setActiveTool(activeTool === 'erase' ? 'select' : 'erase')}><Icon name="eraser" size={15} /></button>
        <span className="tool-separator" /><button className="tool-square" type="button" title="Повернуть выбранный блок · R" disabled={!selectedTile} onClick={rotateTile}><Icon name="rotate" size={15} /></button>
        <button className={`tool-square ${gridVisible ? 'active-soft' : ''}`} type="button" title="Показать / скрыть сетку" onClick={() => setGridVisible(!gridVisible)}><Icon name="grid" size={15} /></button>
        <button className={`tool-square ${showNames ? 'active-soft' : ''}`} type="button" title="Подписи блоков" onClick={() => setShowNames(!showNames)}><Icon name="eye" size={15} /></button>
      </div><div className="editor-toolbar-right"><span className="canvas-size-label"><Icon name="box" size={13} />{scheme.width} × {scheme.height}</span><span className="tool-separator" />
        <button className="tool-square zoom-button" type="button" title="Уменьшить" onClick={() => moveZoom(-.1)}><Icon name="zoomOut" size={15} /></button><span className="zoom-level">{Math.round(zoom * 100)}%</span><button className="tool-square zoom-button" type="button" title="Увеличить" onClick={() => moveZoom(.1)}><Icon name="zoomIn" size={15} /></button><button className="tool-square zoom-button" type="button" title="Сбросить масштаб до 100%" onClick={() => setZoom(1)}><Icon name="refresh" size={14} /></button><span className="tool-separator" /><button className="tool-square" type="button" title="Экспортировать схему" onClick={onExport}><Icon name="download" size={15} /></button>
      </div></div>
      <div className="canvas-stage"><BlockCanvas scheme={scheme} selectedKey={selectedTileKey} setSelectedKey={setSelectedTileKey} tool={activeTool} selectedBlock={selectedBlock} onPlace={placeBlock} onErase={eraseTile} onMove={moveBlock} onSelect={(tile) => setSelectedTileKey(`${tile.x}:${tile.y}`)} gridVisible={gridVisible} showNames={showNames} zoom={zoom} svgRef={svgRef} onDropBlock={(x, y, id) => { setSelectedBlock(id); placeBlock(x, y, id); }} /></div>
      <div className="editor-statusbar"><div className="status-left"><span><b>{analytics.total}</b> блоков</span><i className="status-separator" /><span>{analytics.unique} типов</span></div><div className="status-right"><span><Icon name="cursor" size={12} /> {activeTool === 'place' ? 'РАЗМЕСТИТЬ' : activeTool === 'erase' ? 'УДАЛИТЬ' : 'ВЫБРАТЬ'}</span></div></div>
      </div>
    </section>
    <Inspector scheme={activeScheme} analytics={analytics} selectedTile={selectedTile} onRotate={rotateTile} onRemove={eraseTile} onSave={onSave} savedSchemes={savedSchemes} onLoadSaved={onLoadSaved} onDeleteSaved={onDeleteSaved} onExport={onExport} onCopy={onCopy} onCopyLogic={onCopyLogic} name={name} setName={setName} />
  </main>;
}

function CatalogPage({ onBack, onUseBlock, selectedObject, setSelectedObject, initialPlanet = 'serpulo' }) {
  const [catalogType, setCatalogType] = useState('buildings');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [planetFilter, setPlanetFilter] = useState(initialPlanet);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const belongsToPlanet = (entry) => planetFilter === 'all' || entry.planet === 'both' || entry.planet === planetFilter;
  const visibleCountByTab = {
    buildings: gameBlocks.filter((entry) => entry.campaignBuildable && belongsToPlanet(entry)).length,
    environment: gameBlocks.filter((entry) => !entry.campaignBuildable && belongsToPlanet(entry)).length,
    item: gameCatalog.filter((entry) => entry.type === 'item' && belongsToPlanet(entry)).length,
    liquid: gameCatalog.filter((entry) => entry.type === 'liquid' && belongsToPlanet(entry)).length,
    unit: gameCatalog.filter((entry) => entry.type === 'unit' && belongsToPlanet(entry)).length,
    all: gameCatalog.filter(belongsToPlanet).length,
  };
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    let rows = gameCatalog.filter((entry) => {
      const typeMatch = catalogType === 'buildings' ? entry.type === 'block' && entry.campaignBuildable : catalogType === 'environment' ? entry.type === 'block' && !entry.campaignBuildable : catalogType === 'all' ? true : entry.type === catalogType;
      const categoryMatch = catalogCategory === 'all' || entry.category === catalogCategory;
      const planetMatch = planetFilter === 'all' || entry.planet === planetFilter || entry.planet === 'both';
      const queryMatch = !needle || `${entry.name} ${entry.id} ${entry.description}`.toLocaleLowerCase('ru').includes(needle);
      return typeMatch && categoryMatch && planetMatch && queryMatch;
    });
    rows = [...rows].sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name, 'ru') : a.id.localeCompare(b.id));
    return rows;
  }, [catalogType, catalogCategory, planetFilter, query, sortBy]);
  const tabs = [
    { id: 'buildings', label: 'Постройки', count: visibleCountByTab.buildings }, { id: 'environment', label: 'Окружение / спецблоки', count: visibleCountByTab.environment },
    { id: 'item', label: 'Предметы', count: visibleCountByTab.item }, { id: 'liquid', label: 'Жидкости', count: visibleCountByTab.liquid },
    { id: 'unit', label: 'Юниты', count: visibleCountByTab.unit }, { id: 'all', label: 'Все объекты', count: visibleCountByTab.all },
  ];
  const typeRows = gameCatalog.filter((entry) => {
    const matchesTab = catalogType === 'buildings' ? entry.type === 'block' && entry.campaignBuildable : catalogType === 'environment' ? entry.type === 'block' && !entry.campaignBuildable : catalogType === 'all' ? true : entry.type === catalogType;
    return matchesTab && belongsToPlanet(entry);
  });
  const categoryOptions = [...new Set(typeRows.map((entry) => entry.category))].map((id) => categories.find((category) => category.id === id) ?? { id, label: typeLabels[id] ?? id });
  const selectedVisible = selectedObject && filtered.some((entry) => entry.id === selectedObject.id && entry.type === selectedObject.type);
  const active = selectedVisible ? selectedObject : filtered[0] ?? null;
  const activeCategory = categoryById.get(active?.category);
  const activeTypeLabel = active?.type === 'block' ? (active.campaignBuildable ? 'Постройка кампании' : active.buildable ? 'Редактор / песочница' : 'Объект окружения') : typeLabels[active?.type] ?? 'Игровой объект';

  return <main className="catalog-page">
    <div className="catalog-titlebar"><h1>Каталог</h1><button className="button button-outline" type="button" onClick={onBack}><Icon name="chevronLeft" size={15} /> Редактор</button></div>
    <div className="catalog-tabs">{tabs.map((tab) => <button type="button" key={tab.id} className={catalogType === tab.id ? 'active' : ''} onClick={() => { setCatalogType(tab.id); setCatalogCategory('all'); setSelectedObject(null); }}><span>{tab.label}</span><i>{tab.count}</i></button>)}</div>
    <div className="catalog-content-grid"><section className="catalog-main-panel">
      <div className="catalog-controls"><div className="search-field catalog-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название или внутренний ID..." aria-label="Поиск объектов" /><kbd>/</kbd></div>
        <div className="select-wrap catalog-filter"><Icon name="filter" size={13} /><select value={catalogCategory} onChange={(event) => setCatalogCategory(event.target.value)} aria-label="Категория"><option value="all">Все категории</option>{categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select><Icon name="chevron" size={12} /></div>
        <div className="select-wrap planet-filter"><select value={planetFilter} onChange={(event) => { setPlanetFilter(event.target.value); setCatalogCategory('all'); setSelectedObject(null); }} aria-label="Планета"><option value="all">Все планеты</option><option value="serpulo">Серпуло</option><option value="erekir">Эрекир</option></select><Icon name="chevron" size={12} /></div>
        <button className="sort-button" type="button" title="Сортировать по ID" onClick={() => setSortBy(sortBy === 'name' ? 'id' : 'name')}><Icon name="sliders" size={14} />{sortBy === 'name' ? 'А–Я' : 'ID'}</button>
      </div>
      <div className="catalog-results-head"><b>{filtered.length.toLocaleString('ru-RU')} объектов</b><span className="catalog-results-line" /></div>
      <div className="catalog-grid">{filtered.map((entry) => <button type="button" key={`${entry.type}:${entry.id}`} className={`catalog-card ${selectedObject?.id === entry.id && selectedObject?.type === entry.type ? 'active' : ''}`} onClick={() => setSelectedObject(entry)} title={`${entry.name} · ${entry.id}`}>
        <GameGlyph entry={entry} size="medium" /><span className="catalog-card-copy"><b>{entry.name}</b><code>{entry.id}</code><small>{entry.type === 'block' ? entry.campaignBuildable ? 'Постройка кампании' : entry.buildable ? 'Редактор / спецблок' : entry.category === 'ore' ? 'Руда' : 'Окружение' : typeLabels[entry.type]}</small></span><span className={`catalog-planet-dot ${entry.planet}`} title={getPlanetLabel(entry.planet)} />
      </button>)}
        {filtered.length === 0 && <div className="catalog-empty"><span className="empty-search-icon"><Icon name="search" size={22} /></span><b>Ничего не найдено</b><small>Измени запрос или сбрось фильтры.</small><button type="button" onClick={() => { setQuery(''); setCatalogCategory('all'); setPlanetFilter('all'); }}>Сбросить фильтры</button></div>}
      </div>
    </section>
    <aside className="catalog-detail-panel"><div className="catalog-detail-head"><span className="field-label">ОБЪЕКТ / ПРОСМОТР</span><span className="catalog-detail-counter">{active ? `${String(filtered.findIndex((entry) => entry.id === active.id && entry.type === active.type) + 1).padStart(2, '0')}` : '—'} <i>/ {String(filtered.length).padStart(2, '0')}</i></span></div>
      {active ? <><div className="catalog-detail-art"><div className="detail-art-grid" /><div className="detail-art-glow" /><GameGlyph entry={active} size="hero" /></div>
        <div className="catalog-detail-title"><TinyTag tone={active.campaignBuildable ? 'green' : active.buildable ? 'gold' : active.type === 'block' ? '' : 'blue'}>{activeTypeLabel}</TinyTag><h2>{active.name}</h2><code>{active.id}</code></div>
        <p className="catalog-description">{stripGameMarkup(active.description) || `${activeCategory?.label ?? typeLabels[active.type] ?? 'Объект'} из стандартного набора Mindustry ${GAME_VERSION}.`}</p>
        <div className="detail-meta-grid"><div><small>ТИП</small><b>{activeCategory?.label ?? typeLabels[active.type] ?? 'Объект'}</b></div><div><small>ПЛАНЕТА</small><b>{getPlanetLabel(active.planet)}</b></div>
          <div><small>ИГРОВОЙ ЭТАП</small><b>{active.type === 'block' ? getStageLabel(active.stage) : active.type === 'unit' ? 'Технологическая ветка' : 'Ресурс'}</b></div><div><small>РАЗМЕР</small><b>{active.type === 'block' ? `${active.size} × ${active.size} тайл.` : '—'}</b></div></div>
        {active.campaignBuildable ? <button className="button button-primary full-width place-catalog-button" type="button" onClick={() => onUseBlock(active)}><Icon name="plus" size={15} /> Выбрать для редактора</button> : <div className="nonbuildable-note"><Icon name="info" size={14} />{active.type === 'block' ? active.buildable ? 'Этот блок есть в игре, но доступен только в редакторе/песочнице; в обычные схемы не добавляется.' : 'Это элемент карты или служебный объект, его нельзя построить в кампании.' : ['hidden', 'debugOnly', 'sandboxOnly', 'editorOnly', 'worldProcessorOnly'].includes(active.visibility) ? 'Служебный, тестовый или редакторский объект из игры; в обычной кампании не строится.' : 'Ресурс или юнит. В схеме отображаются связанные с ним постройки.'}</div>}
      </> : <div className="catalog-select-empty"><GameGlyph entry={{ category: 'storage' }} size="large" /><b>Выбери объект</b></div>}
    </aside></div>
    <div className="catalog-attribution">Только содержимое Mindustry {GAME_VERSION} · источник — версия Steam/upstream.</div>
  </main>;
}

function BlueprintPreview({ scheme }) {
  const width = scheme.width;
  const height = scheme.height;
  const tileRows = [...scheme.tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  return <div className="blueprint-preview">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Предпросмотр ${scheme.width} на ${scheme.height}`}>
      <rect width={width} height={height} className="blueprint-preview-bg" />
      {Array.from({ length: width + 1 }, (_, x) => <path key={`x${x}`} d={`M${x} 0V${height}`} className="blueprint-preview-grid" />)}
      {Array.from({ length: height + 1 }, (_, y) => <path key={`y${y}`} d={`M0 ${y}H${width}`} className="blueprint-preview-grid" />)}
      {tileRows.map((tile, index) => {
        const entry = gameBlocks.find(block => block.id === tile.id);
        const size = entry?.size ?? 1;
        const rect = blockRect(tile);
        const top = height - 1 - rect.endY;
        const sprite = sprites[`block:${tile.id}`];
        const color = categoryColors[entry?.category] ?? '#b7c2cd';
        const directional = blockFacts[tile.id]?.rotate || /conveyor|duct|conduit/.test(tile.id);
        return <g key={`${tile.id}:${tile.x}:${tile.y}:${index}`}>
          <rect x={rect.startX + .06} y={top + .06} width={size - .12} height={size - .12} rx=".08" fill={color} fillOpacity=".2" stroke={color} strokeOpacity=".8" strokeWidth=".055" />
          {sprite && !sprite.invisible && <image href={sprite.file} x={rect.startX} y={top} width={size} height={size} preserveAspectRatio="xMidYMid meet" transform={directional ? `rotate(${-((tile.rotation ?? 0) * 90)} ${rect.startX + size / 2} ${top + size / 2})` : undefined} />}
        </g>;
      })}
    </svg>
  </div>;
}

function BlueprintPicker({ candidates, onClose, onSelect }) {
  if (!candidates) return null;
  return <div className="modal-backdrop blueprint-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="blueprint-modal" role="dialog" aria-modal="true" aria-labelledby="blueprint-picker-title">
      <div className="modal-heading blueprint-modal-heading">
        <div><span className="section-kicker"><span className="kicker-line" /> {GAME_VERSION} / AUTO LAYOUT</span><h2 id="blueprint-picker-title">Выбери чертёж</h2><p>Сравни три компоновки, затем вставь подходящую в редактор. После вставки её можно менять вручную.</p></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button>
      </div>
      <div className="blueprint-candidates">
        {candidates.map((candidate, index) => {
          const { scheme } = candidate;
          const mechanics = analyzeMechanics(scheme);
          const requirements = mechanics.requirements[0];
          const recipeInputs = requirements ? [
            ...requirements.inputs.map(input => `${gameCatalog.find(entry => entry.type === 'item' && entry.id === input.id)?.name ?? input.id} ${input.rate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}/с`),
            ...Object.entries(requirements.liquids ?? {}).map(([id, rate]) => `${gameCatalog.find(entry => entry.type === 'liquid' && entry.id === id)?.name ?? id} ${rate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} л/с`),
          ] : [];
          const recipeLine = requirements ? `${recipeInputs.join(' · ') || 'Без предметного сырья'} → ${requirements.output.map(output => `${gameCatalog.find(entry => entry.type === 'item' && entry.id === output.id)?.name ?? output.id} ${output.rate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}/с`).join(' · ')}` : `${scheme.tiles.length} блоков · компоновка для ${getPlanetLabel(scheme.settings?.planet)}`;
          return <article className="blueprint-candidate" key={`${candidate.label}-${index}`}>
            <div className="blueprint-candidate-top"><span className="blueprint-number">0{index + 1}</span><span className="tiny-tag muted">{scheme.width} × {scheme.height}</span></div>
            <BlueprintPreview scheme={scheme} />
            <div className="blueprint-candidate-copy"><h3>{candidate.label}</h3><p>{candidate.note}</p></div>
            <div className="blueprint-stats"><span><b>{scheme.tiles.length}</b> блоков</span><span><b>{mechanics.unknownCosts ? '—' : mechanics.costs.size}</b> ресурсов в смете</span></div>
            <p className="blueprint-recipe">{recipeLine}</p>
            <div className="blueprint-checks">{mechanics.warnings.slice(0, 2).map((warning, warningIndex) => <span key={warningIndex}><Icon name="info" size={12} />{warning}</span>)}</div>
            <button className="button button-primary full-width blueprint-insert-button" type="button" onClick={() => onSelect(candidate)}><Icon name="check" size={14} /> Вставить в редактор</button>
          </article>;
        })}
      </div>
      <div className="blueprint-modal-footer"><span>Схемы локальные. Перед игрой проверь карту, исследования, питание и доступность экспорта.</span><button className="button button-outline" type="button" onClick={onClose}>Отмена</button></div>
    </section>
  </div>;
}

function ImportPasteDialog({ value, setValue, onClose, onImport }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setError(''); try { onImport(decodeSchematic(value)); } catch (exception) { setError(exception.message || 'Не удалось прочитать код схемы.'); } finally { setBusy(false); } };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="paste-modal" role="dialog" aria-modal="true" aria-labelledby="paste-title">
    <div className="modal-heading"><div><span className="section-kicker"><span className="kicker-line" /> IMPORT / BASE64</span><h2 id="paste-title">Импорт схемы по коду</h2><p>Вставь строку Mindustry, начинающуюся с <code>bXNja</code>.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть"><Icon name="close" /></button></div>
    <textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder="bXNjaAF4n..." spellCheck="false" />
    {error && <div className="dialog-error"><Icon name="info" size={14} />{error}</div>}
    <div className="modal-footer"><span>Также можно импортировать файл .msch через кнопку «Импорт».</span><div><button type="button" className="button button-outline" onClick={onClose}>Отмена</button><button type="button" className="button button-primary" onClick={submit} disabled={!value.trim() || busy}><Icon name="upload" size={14} />{busy ? 'Читаю…' : 'Импортировать'}</button></div></div>
  </section></div>;
}

function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [scheme, setScheme] = useState(() => generateLayout(initialSettings));
  const [name, setName] = useState(() => generateLayout(initialSettings).name);
  const [history, setHistory] = useState(() => [generateLayout(initialSettings)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [view, setView] = useState('editor');
  const [theme, setTheme] = useState(() => window.localStorage.getItem('bee-schem-theme') ?? 'dark');
  const [activeTool, setActiveTool] = useState('select');
  const [selectedBlock, setSelectedBlock] = useState('conveyor');
  const [selectedTileKey, setSelectedTileKey] = useState(null);
  const [gridVisible, setGridVisible] = useState(true);
  const [showNames, setShowNames] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [savedSchemes, setSavedSchemes] = useState(() => { try { return JSON.parse(window.localStorage.getItem('bee-schem-saved') ?? '[]'); } catch { return []; } });
  const [toast, setToast] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [blueprintCandidates, setBlueprintCandidates] = useState(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateState, setUpdateState] = useState({ status: 'idle', available: false, checking: false });
  const [seenUpdate, setSeenUpdate] = useState(() => window.localStorage.getItem('bee-schem-update-seen') ?? '');
  const importRef = useRef(null); const toastTimer = useRef(null);
  const updateSeenRef = useRef(seenUpdate);
  const updateCheckRef = useRef({ inFlight: false, lastCheck: 0 });
  const notify = useCallback((messageOrOptions) => {
    const next = typeof messageOrOptions === 'string' ? { message: messageOrOptions, type: 'success' } : messageOrOptions;
    setToast(next); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);
  const checkUpdates = useCallback(async (force = true) => {
    const tracker = updateCheckRef.current;
    const now = Date.now();
    if (tracker.inFlight || (!force && now - tracker.lastCheck < 5 * 60 * 1000)) return;
    tracker.inFlight = true;
    setUpdateState((current) => ({ ...current, checking: true, error: '' }));
    try {
      const result = await checkForUpdates({ buildInfo: appBuildInfo });
      const next = { ...result, checking: false };
      setUpdateState(next);
      if (result.available && result.targetId && result.targetId !== updateSeenRef.current) {
        notify(result.status === 'deployed-update'
          ? `Обновление сайта · ${formatCommit(result.deployedCommit)}.`
          : `Доступен ZIP обновления · ${formatCommit(result.latestSha)}.`);
      }
    } catch (error) {
      setUpdateState({ status: 'unavailable', available: false, checking: false, error: error.message || 'Не удалось проверить обновления.' });
    } finally {
      tracker.inFlight = false;
      tracker.lastCheck = Date.now();
    }
  }, [notify]);
  useEffect(() => { updateSeenRef.current = seenUpdate; window.localStorage.setItem('bee-schem-update-seen', seenUpdate); }, [seenUpdate]);
  useEffect(() => {
    const initialCheck = window.setTimeout(() => checkUpdates(false), 1800);
    const interval = window.setInterval(() => checkUpdates(false), 30 * 60 * 1000);
    const onFocus = () => checkUpdates(false);
    window.addEventListener('focus', onFocus);
    return () => { window.clearTimeout(initialCheck); window.clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [checkUpdates]);
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem('bee-schem-theme', theme); }, [theme]);
  useEffect(() => { window.localStorage.setItem('bee-schem-saved', JSON.stringify(savedSchemes)); }, [savedSchemes]);
  useEffect(() => { if (scheme.name && scheme.name !== name) setName(scheme.name); }, [scheme.name]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const settingsDirty = useMemo(() => {
    const lastSettings = scheme.settings ?? {};
    return ['minimal', 'direction', 'stage', 'planet', 'goal', 'footprint', 'compactness', 'includePower', 'includeDefense', 'includeStorage', 'supplyMode', 'processorControl', 'droneUnit', 'transportItem', 'reserveThreshold', 'droneCapacity'].some((key) => {
      if (settings.minimal && settings.direction === 'production' && ['supplyMode', 'processorControl', 'footprint', 'compactness', 'includeDefense', 'includeStorage'].includes(key)) return false;
      return settings[key] !== lastSettings[key];
    });
  }, [settings, scheme.settings]);
  const commitScheme = (nextScheme, resetHistory = false) => {
    setScheme(nextScheme);
    if (resetHistory) { setHistory([nextScheme]); setHistoryIndex(0); }
    else { const nextHistory = [...history.slice(0, historyIndex + 1), nextScheme].slice(-60); setHistory(nextHistory); setHistoryIndex(nextHistory.length - 1); }
    setName(nextScheme.name || nextScheme.tags?.name || 'Новая схема'); setSelectedTileKey(null);
  };
  const generateNow = () => {
    try {
      setBlueprintCandidates(generateLayoutVariants(settings));
      setView('editor');
    } catch (error) {
      notify({ type: 'error', message: error.message || 'Не удалось создать варианты схемы.' });
    }
  };
  const acceptCandidate = (candidate) => {
    const next = candidate.scheme;
    commitScheme(next, true);
    if (next.settings) setSettings((current) => ({ ...current, ...next.settings }));
    setBlueprintCandidates(null);
    setView('editor');
    notify(`В редактор вставлен вариант «${candidate.label}» · ${next.tiles.length} блоков · ${next.width}×${next.height}`);
  };
  const undo = () => { if (historyIndex <= 0) return; const index = historyIndex - 1; setHistoryIndex(index); setScheme(history[index]); setSelectedTileKey(null); };
  const redo = () => { if (historyIndex >= history.length - 1) return; const index = historyIndex + 1; setHistoryIndex(index); setScheme(history[index]); setSelectedTileKey(null); };
  const setSchemeWithHistory = (updater) => {
    const next = typeof updater === 'function' ? updater(scheme) : updater;
    const currentName = name.trim() || next.name;
    commitScheme({ ...next, name: currentName, tags: { ...(next.tags ?? {}), name: currentName } }, false);
  };
  const activeScheme = useMemo(() => ({ ...scheme, name: name.trim() || scheme.name, tags: { ...(scheme.tags ?? {}), name: name.trim() || scheme.name } }), [scheme, name]);
  const saveCurrent = () => {
    const record = { ...activeScheme, key: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`, savedAt: new Date().toISOString() };
    setSavedSchemes((current) => [record, ...current.filter((item) => item.name !== record.name)].slice(0, 12)); notify(`«${record.name}» сохранена в этом браузере.`);
  };
  const loadSaved = (record) => { const next = { width: record.width, height: record.height, tiles: record.tiles, name: record.name, description: record.description, tags: record.tags, settings: record.settings }; commitScheme(next, true); if (record.settings) setSettings((current) => ({ ...current, ...record.settings })); setView('editor'); notify(`Открыта схема «${record.name}».`); };
  const deleteSaved = (key) => setSavedSchemes((current) => current.filter((item) => item.key !== key));
  const exportFile = () => { try { downloadSchematic(activeScheme); notify('Файл схемы .msch скачан.'); } catch (error) { notify({ type: 'error', message: error.message || 'Не удалось экспортировать схему.' }); } };
  const copyCode = async () => {
    try { const code = schematicToBase64(activeScheme); await navigator.clipboard.writeText(code); notify(`Код схемы скопирован · ${code.length.toLocaleString('ru-RU')} знаков`); }
    catch {
      try { const code = schematicToBase64(activeScheme); const textarea = document.createElement('textarea'); textarea.value = code; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove(); notify('Код схемы скопирован в буфер обмена.'); }
      catch (error) { notify({ type: 'error', message: error.message || 'Не удалось скопировать код.' }); }
    }
  };
  const copyLogic = async () => {
    const code = buildLogicProgram(activeScheme.settings ?? {});
    if (!code) return notify({ type: 'error', message: 'Для этой схемы MLOG-программа не задана.' });
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = code; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
      document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove();
    }
    notify(`Программа MLOG скопирована · ${code.split('\n').length} команд`);
  };
  const applyImport = (next) => { commitScheme(next, true); if (next.settings?.planet) setSettings((current) => ({ ...current, ...next.settings })); setSelectedBlock(null); setView('editor'); setPasteOpen(false); setPasteValue(''); notify(`Схема «${next.name}» импортирована · ${next.tiles.length} построек.`); };
  const importFile = async (event) => { const file = event.target.files?.[0]; if (!file) return; try { applyImport(await decodeSchematicFile(file)); } catch (error) { notify({ type: 'error', message: error.message || 'Не удалось прочитать файл схемы.' }); } event.target.value = ''; };

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      else if (event.key.toLowerCase() === 'r' && view === 'editor' && selectedTileKey) {
        event.preventDefault(); setSchemeWithHistory((current) => ({ ...current, tiles: current.tiles.map((tile) => `${tile.x}:${tile.y}` === selectedTileKey ? { ...tile, rotation: ((tile.rotation ?? 0) + 1) % 4 } : tile) }));
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedTileKey && view === 'editor') {
        event.preventDefault(); const selected = scheme.tiles.find((tile) => `${tile.x}:${tile.y}` === selectedTileKey); if (selected) setSchemeWithHistory((current) => ({ ...current, tiles: current.tiles.filter((tile) => tile !== selected) })); setSelectedTileKey(null);
      } else if (event.key === '+' || event.key === '=') setZoom((current) => Math.min(1.28, current + .1));
      else if (event.key === '-') setZoom((current) => Math.max(.7, current - .1));
      else if (event.key === 'Escape') { setSelectedTileKey(null); setActiveTool('select'); setPasteOpen(false); setBlueprintCandidates(null); }
      else if (event.key === '/' && view === 'catalog') { event.preventDefault(); document.querySelector('.catalog-search input')?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, [history, historyIndex, selectedTileKey, scheme, view, name]);
  const selectCatalogBlock = (block) => {
    const campaignBlock = buildableBlocks.find((entry) => entry.id === block.id);
    if (!campaignBlock?.campaignBuildable || (campaignBlock.planet !== 'both' && campaignBlock.planet !== settings.planet)) {
      notify({ type: 'error', message: `${block.name} не строится в кампании на планете ${getPlanetLabel(settings.planet)}.` });
      return;
    }
    setSelectedBlock(block.id); setActiveTool('place'); setView('editor'); notify(`${block.name} выбрана — кликни по свободной клетке сетки.`);
  };
  const displayCatalogCount = gameCatalog.length;
  const updateAttention = Boolean(updateState.available && updateState.targetId && updateState.targetId !== seenUpdate);
  const openUpdates = () => { setUpdateOpen(true); checkUpdates(false); };
  const closeUpdates = () => {
    setUpdateOpen(false);
    if (updateState.available && updateState.targetId) {
      updateSeenRef.current = updateState.targetId;
      setSeenUpdate(updateState.targetId);
    }
  };

  return <div className="app-shell">
    <Header view={view} setView={setView} canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1} onUndo={undo} onRedo={redo} theme={theme} setTheme={setTheme} onImport={() => importRef.current?.click()} onExport={exportFile} onCopy={copyCode} onPaste={() => setPasteOpen(true)} onSave={saveCurrent} savedCount={savedSchemes.length} catalogCount={displayCatalogCount} onOpenUpdates={openUpdates} updateState={updateState} updateAttention={updateAttention} />
    <input ref={importRef} type="file" accept=".msch,.txt,application/octet-stream,text/plain" className="visually-hidden" onChange={importFile} />
    {view === 'editor' ? <EditorPage settings={settings} setSettings={setSettings} setView={setView} dirty={settingsDirty} onGenerate={generateNow} scheme={scheme} setScheme={setSchemeWithHistory} name={name} setName={setName} activeTool={activeTool} setActiveTool={setActiveTool} selectedBlock={selectedBlock} setSelectedBlock={setSelectedBlock} selectedTileKey={selectedTileKey} setSelectedTileKey={setSelectedTileKey} gridVisible={gridVisible} setGridVisible={setGridVisible} showNames={showNames} setShowNames={setShowNames} zoom={zoom} setZoom={setZoom} onSave={saveCurrent} savedSchemes={savedSchemes} onLoadSaved={loadSaved} onDeleteSaved={deleteSaved} onExport={exportFile} onCopy={copyCode} onCopyLogic={copyLogic} onPaste={() => setPasteOpen(true)} notify={notify} /> : <CatalogPage initialPlanet={settings.planet} onBack={() => setView('editor')} onUseBlock={selectCatalogBlock} selectedObject={selectedObject} setSelectedObject={setSelectedObject} />}
    <Toast toast={toast} onClose={() => setToast(null)} />
    {pasteOpen && <ImportPasteDialog value={pasteValue} setValue={setPasteValue} onClose={() => setPasteOpen(false)} onImport={applyImport} />}
    {blueprintCandidates && <BlueprintPicker candidates={blueprintCandidates} onClose={() => setBlueprintCandidates(null)} onSelect={acceptCandidate} />}
    {updateOpen && <UpdateDialog state={updateState} onCheck={() => checkUpdates(true)} onReload={() => window.location.reload()} onClose={closeUpdates} repositoryUrl={UPDATE_REPOSITORY_URL} branch={UPDATE_BRANCH} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
