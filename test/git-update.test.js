import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD_SHA = '515befa4b89c3ea7c2de722230775b838b952678';
const NEW_SHA = '4e15110992c44118610090fbc56b8df466cd8402';

// Подставной git: умеет «зависать» на fetch и подменять локальную/удалённую версию.
// Собираем из массива строк, чтобы ${...} не превращалось в интерполяцию.
const FAKE_GIT = [
    '#!/usr/bin/env bash',
    'state="${BEE_FAKE_STATE:?}"',
    'mode="${BEE_FAKE_GIT_MODE:-current}"',
    'args=()',
    'while [ "$#" -gt 0 ]; do',
    '    case "$1" in',
    '        -c) shift 2 ;;',
    '        *) args+=("$1"); shift ;;',
    '    esac',
    'done',
    'case "${args[0]:-}" in',
    '    symbolic-ref) echo main ;;',
    '    rev-parse)',
    '        case "${args[1]:-}" in',
    '            --short) echo "${BEE_FAKE_OLD:0:7}" ;;',
    '            --abbrev-ref) echo origin/main ;;',
    '            origin/main) echo "${BEE_FAKE_NEW}" ;;',
    '            *) if [ -f "$state/merged" ]; then echo "${BEE_FAKE_NEW}"; else echo "${BEE_FAKE_OLD}"; fi ;;',
    '        esac ;;',
    '    fetch)',
    '        if [ "$mode" = hang ]; then exec sleep 60; fi',
    '        exit 0 ;;',
    '    merge)',
    '        if [ "$mode" = merge-fail ]; then',
    '            echo "error: Your local changes would be overwritten by merge." >&2',
    '            exit 1',
    '        fi',
    '        touch "$state/merged" ;;',
    '    *) exit 0 ;;',
    'esac',
    'exit 0',
    '',
].join('\n');

function makeSandbox() {
    const dir = mkdtempSync(path.join(tmpdir(), 'bee-git-update-'));
    const binDir = path.join(dir, 'bin');
    const stateDir = path.join(dir, 'state');
    mkdirSync(binDir);
    mkdirSync(stateDir);
    const gitPath = path.join(binDir, 'git');
    writeFileSync(gitPath, FAKE_GIT);
    chmodSync(gitPath, 0o755);
    return { dir, binDir, stateDir };
}

function runUpdate({ mode = 'current', oldSha = OLD_SHA, newSha = NEW_SHA, env = {}, callbacks = 'info ok warn' } = {}) {
    const sandbox = makeSandbox();
    const started = Date.now();
    const result = spawnSync('bash', ['-c', `
        set -uo pipefail
        info() { echo "==> $*"; }
        ok()   { echo "OK  $*"; }
        warn() { echo "!!  $*"; }
        # shellcheck disable=SC1090
        . ./scripts/git-update.sh
        bee_update_code ${callbacks} ""
        echo "BEE_FILES_UPDATED=$BEE_FILES_UPDATED"
    `], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
            ...process.env,
            PATH: `${sandbox.binDir}:${process.env.PATH}`,
            BEE_FAKE_STATE: sandbox.stateDir,
            BEE_FAKE_GIT_MODE: mode,
            BEE_FAKE_OLD: oldSha,
            BEE_FAKE_NEW: newSha,
            GIT_SSH_COMMAND: 'true',
            ...env,
        },
    });
    return { ...result, durationMs: Date.now() - started, sandbox };
}

test('зависший git fetch обрывается по таймауту и не блокирует запуск', () => {
    const run = runUpdate({ mode: 'hang', env: { BEE_GIT_TIMEOUT: '2', BEE_SKIP_DIAGNOSTICS: '1' } });

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /не ответил за 2 сек/);
    assert.match(run.stdout, /Продолжаю с текущей версией кода/);
    assert.match(run.stdout, /BEE_FILES_UPDATED=0/);
    assert.ok(run.durationMs < 20_000, `обновление заняло ${run.durationMs} мс вместо ~2 сек`);

    rmSync(run.sandbox.dir, { recursive: true, force: true });
});

test('несуществующие функции-колбэки не ломают обновление', () => {
    // Именно так ломался лаунчер: в нём нет функции info, есть log.
    const run = runUpdate({
        mode: 'hang',
        callbacks: 'no_such_info no_such_ok no_such_warn',
        env: { BEE_GIT_TIMEOUT: '2', BEE_SKIP_DIAGNOSTICS: '1' },
    });

    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stdout + run.stderr, /command not found/);
    assert.match(run.stdout, /не ответил за 2 сек/);

    rmSync(run.sandbox.dir, { recursive: true, force: true });
});

test('актуальная версия определяется без обновления', () => {
    const run = runUpdate({ mode: 'current', oldSha: OLD_SHA, newSha: OLD_SHA });

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Код актуален/);
    assert.match(run.stdout, /BEE_FILES_UPDATED=0/);

    rmSync(run.sandbox.dir, { recursive: true, force: true });
});

test('новая версия применяется fast-forward и выставляет флаг обновления', () => {
    const run = runUpdate({ mode: 'updated' });

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Доступна новая версия/);
    assert.match(run.stdout, /Код обновлён до/);
    assert.match(run.stdout, /BEE_FILES_UPDATED=1/);

    rmSync(run.sandbox.dir, { recursive: true, force: true });
});

test('расхождение истории не ломает запуск и подсказывает ручное обновление', () => {
    const run = runUpdate({ mode: 'merge-fail' });

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Автообновление не применилось/);
    assert.match(run.stdout, /git stash/);
    assert.match(run.stdout, /BEE_FILES_UPDATED=0/);

    rmSync(run.sandbox.dir, { recursive: true, force: true });
});

test('BEE_SKIP_UPDATE=1 полностью отключает автообновление', () => {
    const run = runUpdate({ mode: 'hang', env: { BEE_SKIP_UPDATE: '1', BEE_SKIP_DIAGNOSTICS: '1', BEE_GIT_TIMEOUT: '60' } });

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Автообновление отключено/);
    assert.ok(run.durationMs < 10_000, `пропуск обновления занял ${run.durationMs} мс`);

    rmSync(run.sandbox.dir, { recursive: true, force: true });
});

test('все shell-скрипты проходят проверку синтаксиса', () => {
    const scripts = ['launcher.sh', 'install-shortcut.sh', 'git-update.sh'];
    for (const script of scripts) {
        const file = path.join(projectRoot, 'scripts', script);
        const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
        assert.equal(result.status, 0, `${script}: ${result.stderr}`);
    }
});

// Убираем комментарии и содержимое строк, чтобы искать именно команды,
// а не упоминания «git fetch» в подсказках и сообщениях.
function stripCommentsAndStrings(source) {
    let out = '';
    let state = 'code';
    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        const previous = source[i - 1] ?? '\n';
        if (state === 'code') {
            if (char === '#' && /\s/.test(previous)) { state = 'comment'; out += char; continue; }
            if (char === "'") { state = 'single'; out += char; continue; }
            if (char === '"') { state = 'double'; out += char; continue; }
            out += char;
        } else if (state === 'comment') {
            if (char === '\n') { state = 'code'; out += char; } else { out += ' '; }
        } else if (state === 'single') {
            if (char === "'") { state = 'code'; out += char; } else { out += char === '\n' ? '\n' : ' '; }
        } else if (char === '"') {
            state = 'code'; out += char;
        } else if (char === '\\') {
            out += '  '; i += 1;
        } else {
            out += char === '\n' ? '\n' : ' ';
        }
    }
    return out;
}

const gitNetworkCalls = (source) => stripCommentsAndStrings(source).match(/\bgit\s+(fetch|pull)\b/g) ?? [];

test('сетевой git вызывается только через безопасную обёртку с таймаутом', () => {
    const read = (name) => readFileSync(path.join(projectRoot, 'scripts', name), 'utf8');

    for (const name of ['launcher.sh', 'install-shortcut.sh']) {
        assert.deepEqual(gitNetworkCalls(read(name)), [],
            `${name} должен обновляться через bee_update_code из scripts/git-update.sh`);
        assert.match(read(name), /git-update\.sh/, `${name} должен подключать scripts/git-update.sh`);
    }

    assert.deepEqual(gitNetworkCalls(read('bee-schematic-lab.desktop')), [],
        'ярлык не должен тянуть код голым git pull');
    assert.deepEqual(gitNetworkCalls(read('git-update.sh')), [],
        'в git-update.sh сетевые команды должны идти через bee_timed_git');

    const lib = read('git-update.sh');
    assert.match(lib, /timeout -k 5 "\$seconds" git/, 'bee_timed_git должен ограничивать git по времени');
    assert.match(lib, /GIT_TERMINAL_PROMPT=0/, 'git не должен спрашивать логин и пароль');
    assert.match(lib, /GIT_EDITOR=true/, 'git не должен открывать редактор');
});
