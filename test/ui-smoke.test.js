import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import React from 'react';
import { renderToString } from 'react-dom/server';

/**
 * Renders the real React components to HTML with real generated blueprints. There is no browser here, but this still
 * catches what breaks first when the generator and the interface drift apart: an undefined identifier, a missing
 * field on a scheme or a crash inside the flow report, the picker, the canvas or the inspector.
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const directions = ['mining', 'production', 'defense', 'power', 'logistics', 'units', 'logic', 'campaign'];

// `main.jsx` mounts itself at import time: swap that last line for exports.
const exposeComponents = {
  name: 'expose-components',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/main.jsx')) return null;
    const mount = code.indexOf("createRoot(document.getElementById('root'))");
    if (mount < 0) throw new Error('The mount line of src/main.jsx moved: update this test.');
    return { code: `${code.slice(0, mount)}\nexport { App, FlowReport, BlockCanvas, Inspector, BlueprintPicker, CatalogPage, calculateAnalytics };\n`, map: null };
  },
};

test('the interface renders every generated blueprint: picker, flow report, canvas and inspector', async () => {
  const storage = new Map();
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const server = await createServer({
    root, configFile: false, logLevel: 'error', appType: 'custom', plugins: [exposeComponents, react()],
    define: { __APP_BUILD_INFO__: JSON.stringify({ version: '0', commit: 'test', branch: 'test', builtAt: 'now', buildId: 'test' }) },
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  });
  const consoleErrors = [];
  const originalError = console.error;
  console.error = (...args) => consoleErrors.push(args.map(String).join(' ').slice(0, 300));
  try {
    const ui = await server.ssrLoadModule('/src/main.jsx');
    const generator = await server.ssrLoadModule('/src/generator.js');
    const flow = await server.ssrLoadModule('/src/flow.js');
    const catalog = await server.ssrLoadModule('/src/catalog.js');
    const h = React.createElement;

    const app = renderToString(h(ui.App));
    assert.ok(app.includes('ПРОВЕРКА СХЕМЫ'), 'the first screen shows the flow check of the starting blueprint');

    for (const planet of ['serpulo', 'erekir']) {
      for (const direction of directions) {
        const label = `${planet}/${direction}`;
        const goal = catalog.getProductsForDirection(direction, planet, 'late')[0]?.id ?? generator.initialSettings.goal;
        const candidates = generator.generateLayoutVariants({ ...generator.initialSettings, minimal: false, direction, planet, stage: 'late', goal });
        const picker = renderToString(h(ui.BlueprintPicker, { candidates, onClose() {}, onSelect() {} }));
        assert.equal((picker.match(/Вставить в редактор/g) ?? []).length, candidates.length, `${label}: one insert button per candidate`);

        const scheme = candidates[0].scheme;
        const result = flow.analyzeFlow(scheme);
        const report = renderToString(h(ui.FlowReport, { scheme, flow: result, onSelectIssue() {} }));
        assert.ok(report.includes('ПРОВЕРКА СХЕМЫ'), `${label}: flow report`);
        assert.ok(result.errors === 0 ? report.includes('ПОТОКИ СХОДЯТСЯ') || scheme.problems.length : report.includes('ОШИБОК'), `${label}: the verdict matches the analysis`);

        const canvas = renderToString(h(ui.BlockCanvas, {
          scheme, issues: result.issues, selectedKey: null, setSelectedKey() {}, tool: 'select', selectedBlock: null, onPlace() {}, onErase() {}, onMove() {}, onSelect() {},
          gridVisible: true, showNames: true, zoom: 1, svgRef: React.createRef(), onDropBlock() {},
        }));
        assert.equal((canvas.match(/class="canvas-block/g) ?? []).length, scheme.tiles.length, `${label}: every block is drawn`);

        const inspector = renderToString(h(ui.Inspector, {
          scheme, analytics: ui.calculateAnalytics(scheme), selectedTile: null, onRotate() {}, onRemove() {}, onSave() {}, savedSchemes: [], onLoadSaved() {}, onDeleteSaved() {},
          onExport() {}, onCopy() {}, onCopyLogic() {}, onSelectIssue() {}, name: scheme.name, setName() {},
        }));
        assert.ok(inspector.includes('СОСТАВ ПОСТРОЕК'), `${label}: inspector`);
      }
    }
    const catalogPage = renderToString(h(ui.CatalogPage, { onBack() {}, onUseBlock() {}, selectedObject: null, setSelectedObject() {}, initialPlanet: 'erekir' }));
    assert.ok(catalogPage.length > 1000, 'the catalog renders');

    const updateDialogMod = await server.ssrLoadModule('/src/update-dialog.jsx');
    const UpdateDialog = updateDialogMod.default;
    const availableHtml = renderToString(h(UpdateDialog, {
      state: {
        status: 'source-ahead',
        available: true,
        localBuild: { commit: '1111111111111111' },
        latestSha: '2222222222222222',
      },
      installState: {
        active: true,
        step: 'download',
        progress: 48,
        bytesLoaded: 740_000,
        bytesTotal: 1_540_000,
        speedBps: 620_000,
        stageStatus: { check: 'done', download: 'active', install: 'pending', reload: 'pending' },
        logs: [{ id: '1', time: '12:00:00', step: 'download', level: 'info', text: 'Скачивание пакета обновления…' }],
      },
      repositoryUrl: 'https://github.com/danilka-revin/esp32-----html',
      branch: 'main',
    }));
    assert.ok(availableHtml.includes('role="progressbar"'), 'update dialog renders interactive progressbar');
    assert.ok(availableHtml.includes('48%'), 'update dialog displays current download percentage');
    assert.ok(!availableHtml.includes('Скачать ZIP'), 'update dialog no longer asks user to download a ZIP archive manually');

    assert.deepEqual(consoleErrors, [], 'React reported no warnings or errors while rendering');
  } finally {
    console.error = originalError;
    await server.close();
  }
});
