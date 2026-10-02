#!/usr/bin/env bash
# =============================================================================
# Bee Schematic Lab — безопасное автообновление кода из Git.
#
# Подключается из launcher.sh и install-shortcut.sh:
#
#     # shellcheck disable=SC1090
#     . "$SCRIPT_DIR/git-update.sh"
#     bee_update_code info ok warn "$LOG_FILE"
#
# Главное правило: автообновление никогда не должно "зависать" и не должно
# мешать запуску приложения. Все сетевые команды git:
#   * ограничены по времени (timeout), поэтому брошенное соединение обрывается;
#   * выполняются неинтерактивно — git не просит логин, пароль или правку
#     коммита в редакторе (частые причины вечного ожидания в терминале);
#   * при неудаче печатают диагностику и понятную подсказку, после чего запуск
#     продолжается на текущей локальной версии.
#
# Настройки (переменные окружения):
#   BEE_GIT_TIMEOUT=45        — лимит на git fetch, секунд
#   BEE_MERGE_TIMEOUT=30      — лимит на применение обновления, секунд
#   BEE_GIT_DIAG_TIMEOUT=8    — лимит на проверку соединения, секунд
#   BEE_UPDATE_BRANCH=main    — какую ветку обновлять
#   BEE_SKIP_UPDATE=1         — полностью пропустить автообновление
#   BEE_SKIP_DIAGNOSTICS=1    — не проверять соединение при ошибке
#   BEE_PROJECT_DIR=<путь>    — папка проекта (иначе берётся текущая)
#
# После успешного применения обновления выставляется BEE_FILES_UPDATED=1 —
# по этому флагу вызывающий скрипт понимает, что нужно переустановить
# npm-зависимости и пересобрать проект.
# =============================================================================

BEE_GIT_TIMEOUT="${BEE_GIT_TIMEOUT:-45}"
BEE_MERGE_TIMEOUT="${BEE_MERGE_TIMEOUT:-30}"
BEE_GIT_DIAG_TIMEOUT="${BEE_GIT_DIAG_TIMEOUT:-8}"
BEE_UPDATE_BRANCH="${BEE_UPDATE_BRANCH:-main}"
BEE_FILES_UPDATED=0

# Есть ли на системе coreutils timeout (он же gtimeout).
bee_has_timeout() {
    command -v timeout >/dev/null 2>&1
}

# git в полностью неинтерактивном режиме.
# Вызывать только в условии (if / || / &&), иначе сработает set -e.
bee_git() {
    GIT_TERMINAL_PROMPT=0 \
    GIT_ASKPASS=true \
    SSH_ASKPASS=true \
    SSH_ASKPASS_REQUIRE=never \
    GCM_INTERACTIVE=never \
    GIT_EDITOR=true \
    GIT_MERGE_AUTOEDIT=no \
    GIT_PAGER=cat \
    GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3}" \
    git -c advice.detachedHead=false "$@"
}

# Сетевая команда git с ограничением времени.
# Если timeout недоступен, работает без него (но всё равно неинтерактивно).
# Вызывать только в условии (if / || / &&).
bee_timed_git() {
    local seconds="$1"
    shift
    if bee_has_timeout; then
        GIT_TERMINAL_PROMPT=0 \
        GIT_ASKPASS=true \
        SSH_ASKPASS=true \
        SSH_ASKPASS_REQUIRE=never \
        GCM_INTERACTIVE=never \
        GIT_EDITOR=true \
        GIT_MERGE_AUTOEDIT=no \
        GIT_PAGER=cat \
        GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3}" \
        timeout -k 5 "$seconds" git \
            -c advice.detachedHead=false \
            -c http.lowSpeedLimit=1000 \
            -c http.lowSpeedTime=15 \
            "$@"
    else
        bee_git "$@"
    fi
}

# Временный файл для вывода git.
bee_tmp_file() {
    local file
    file="$(mktemp 2>/dev/null || true)"
    if [ -z "$file" ]; then
        file="${TMPDIR:-/tmp}/bee-git-update.$$"
        : > "$file" 2>/dev/null || true
    fi
    printf '%s\n' "$file"
}

# Вызвать колбэк (info/ok/warn). Если функция не передана или не существует,
# строка просто печатается — библиотека не должна падать из-за опечатки.
bee_say() {
    local fn="${1:-}"
    shift || true
    if [ -n "$fn" ] && declare -F "$fn" >/dev/null 2>&1; then
        "$fn" "$*"
    else
        printf '%s\n' "$*"
    fi
    return 0
}

# Дописать содержимое файла в лог (если лог задан).
bee_append_log() {
    local file="$1"
    local log_file="${2:-}"
    if [ -n "$log_file" ] && [ -s "$file" ]; then
        cat "$file" >> "$log_file" 2>/dev/null || true
    fi
    return 0
}

# Показать последние строки вывода git через info-функцию.
bee_show_tail() {
    local file="$1"
    local info="${2:-}"
    local line
    if [ ! -s "$file" ]; then
        return 0
    fi
    while IFS= read -r line; do
        [ -n "$line" ] && bee_say "$info" "  git: $line"
    done < <(tail -n 3 "$file" 2>/dev/null || true)
    return 0
}

# Короткая диагностика: почему не удалось связаться с GitHub.
# Каждая строка выводится отдельно; вызывается через while read < <(...).
bee_git_diagnose() {
    if [ "${BEE_SKIP_DIAGNOSTICS:-0}" = "1" ]; then
        return 0
    fi

    local url proxy helper code
    url="$(bee_git remote get-url origin 2>/dev/null || true)"
    echo "origin: ${url:-не настроен}"

    proxy="$(bee_git config --get http.proxy 2>/dev/null || true)"
    echo "git http.proxy: ${proxy:-не задан}"
    proxy="$(bee_git config --get https.proxy 2>/dev/null || true)"
    echo "git https.proxy: ${proxy:-не задан}"

    helper="$(bee_git config --get-all credential.helper 2>/dev/null | tr '\n' ' ' || true)"
    echo "credential.helper: ${helper:-не задан}"

    if [ -n "${http_proxy:-}${https_proxy:-}${HTTP_PROXY:-}${HTTPS_PROXY:-}" ]; then
        echo "переменные окружения прокси: http_proxy/https_proxy заданы"
    else
        echo "переменные окружения прокси: не заданы"
    fi

    if command -v curl >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1; then
        code="$(timeout -k 2 "$BEE_GIT_DIAG_TIMEOUT" curl -sS -o /dev/null -m "$BEE_GIT_DIAG_TIMEOUT" \
            -w '%{http_code}' https://github.com 2>/dev/null || true)"
        case "$code" in
            2*|3*|4*) echo "проверка https://github.com: отвечает (HTTP $code)" ;;
            *) echo "проверка https://github.com: нет ответа за ${BEE_GIT_DIAG_TIMEOUT} сек" ;;
        esac
    fi
    return 0
}

# -----------------------------------------------------------------------------
# bee_update_code <info_fn> <ok_fn> <warn_fn> [log_file]
#
# Обновляет код до origin/<BEE_UPDATE_BRANCH>. Всегда возвращает 0 (кроме
# совсем уж невозможных ситуаций) — обновление не должно ломать запуск.
# -----------------------------------------------------------------------------
bee_update_code() {
    local info="${1:-}"
    local ok="${2:-}"
    local warn="${3:-}"
    local log_file="${4:-}"

    local branch upstream local_head remote_head rc tmp_file line

    BEE_FILES_UPDATED=0

    if [ -n "${BEE_PROJECT_DIR:-}" ]; then
        if ! cd "$BEE_PROJECT_DIR" 2>/dev/null; then
            bee_say "$warn" "Папка проекта не найдена: $BEE_PROJECT_DIR — обновление пропущено."
            return 0
        fi
    fi

    if ! command -v git >/dev/null 2>&1; then
        bee_say "$warn" "git не найден — автообновление пропущено, запускаю текущую версию."
        return 0
    fi

    if [ ! -d .git ]; then
        bee_say "$warn" "Это не git-репозиторий (нет папки .git) — автообновление пропущено."
        return 0
    fi

    if [ "${BEE_SKIP_UPDATE:-0}" = "1" ]; then
        bee_say "$info" "Автообновление отключено (BEE_SKIP_UPDATE=1)."
        return 0
    fi

    branch="$(bee_git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
    if [ -z "$branch" ]; then
        bee_say "$warn" "Git в состоянии detached HEAD — автообновление пропущено."
        bee_say "$info" "Вернуться в ветку: git switch $BEE_UPDATE_BRANCH"
        return 0
    fi

    bee_say "$info" "Текущая ветка: $branch"
    bee_say "$info" "Текущий коммит: $(bee_git rev-parse --short HEAD 2>/dev/null || echo '?')"

    # Не трогаем рабочие ветки (например, ветки Arena): обновляем только main
    # или ветку, которая отслеживает origin/main.
    upstream="$(bee_git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
    if [ "$branch" != "$BEE_UPDATE_BRANCH" ] && [ "$upstream" != "origin/$BEE_UPDATE_BRANCH" ]; then
        bee_say "$warn" "Ветка '$branch' не отслеживает origin/$BEE_UPDATE_BRANCH — автообновление пропущено."
        bee_say "$info" "Продолжаю с текущей версией кода."
        return 0
    fi

    # --- 1. git fetch с лимитом времени -------------------------------------
    bee_say "$info" "Связываюсь с GitHub (лимит ${BEE_GIT_TIMEOUT} сек)…"
    tmp_file="$(bee_tmp_file)"

    rc=0
    if bee_timed_git "$BEE_GIT_TIMEOUT" fetch --no-tags --quiet origin "$BEE_UPDATE_BRANCH" > "$tmp_file" 2>&1; then
        rc=0
    else
        rc=$?
    fi
    bee_append_log "$tmp_file" "$log_file"

    if [ "$rc" -ne 0 ]; then
        if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
            bee_say "$warn" "GitHub не ответил за ${BEE_GIT_TIMEOUT} сек — обновление пропущено."
        else
            bee_say "$warn" "Не удалось проверить обновления (git fetch, код $rc)."
        fi
        bee_show_tail "$tmp_file" "$info"
        rm -f "$tmp_file" 2>/dev/null || true

        bee_say "$info" "Диагностика соединения:"
        while IFS= read -r line; do
            bee_say "$info" "  $line"
        done < <(bee_git_diagnose)

        bee_say "$info" "Что делать:"
        bee_say "$info" "  • проверить интернет/VPN; при необходимости сбросить прокси:"
        bee_say "$info" "      git config --global --unset http.proxy"
        bee_say "$info" "  • запустить без автообновления: BEE_SKIP_UPDATE=1 bash scripts/launcher.sh"
        bee_say "$info" "  • увеличить лимит ожидания:      BEE_GIT_TIMEOUT=180 bash scripts/launcher.sh"
        bee_say "$ok" "Продолжаю с текущей версией кода."
        return 0
    fi
    rm -f "$tmp_file" 2>/dev/null || true

    # --- 2. Сравнение локальной и удалённой версии --------------------------
    local_head="$(bee_git rev-parse HEAD 2>/dev/null || echo unknown)"
    remote_head="$(bee_git rev-parse "origin/$BEE_UPDATE_BRANCH" 2>/dev/null || echo "$local_head")"

    if [ "$local_head" = "$remote_head" ]; then
        bee_say "$ok" "Код актуален ($(echo "$local_head" | cut -c1-8))"
        return 0
    fi

    bee_say "$info" "Доступна новая версия: $(echo "$local_head" | cut -c1-8) → $(echo "$remote_head" | cut -c1-8)"

    # --- 3. Применение обновления (fast-forward, без слияний и редактора) ---
    tmp_file="$(bee_tmp_file)"
    rc=0
    if bee_timed_git "$BEE_MERGE_TIMEOUT" merge --ff-only "origin/$BEE_UPDATE_BRANCH" >> "$tmp_file" 2>&1; then
        rc=0
    else
        rc=$?
    fi
    bee_append_log "$tmp_file" "$log_file"

    if [ "$rc" -eq 0 ]; then
        BEE_FILES_UPDATED=1
        bee_say "$ok" "Код обновлён до $(bee_git rev-parse --short HEAD 2>/dev/null || echo '?')"
    else
        bee_say "$warn" "Автообновление не применилось — запускаю текущую версию."
        bee_show_tail "$tmp_file" "$info"
        bee_say "$info" "Обычно причина — локальные правки или расхождение истории."
        bee_say "$info" "Обновить вручную:"
        bee_say "$info" "    cd $(pwd) && git stash && git pull --ff-only origin $BEE_UPDATE_BRANCH && git stash pop"
    fi
    rm -f "$tmp_file" 2>/dev/null || true

    return 0
}
