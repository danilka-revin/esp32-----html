#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Bee Schematic Lab — launcher with auto-update for Ubuntu / Linux
#
# При каждом запуске:
#   1. Проверяет наличие node / npm.
#   2. Обновляет код из origin/main (git fetch с таймаутом, без зависаний).
#   3. Ставит npm-зависимости (только если нужно).
#   4. Собирает production-версию (npm run build).
#   5. Поднимает preview-сервер на http://localhost:4173.
#   6. Открывает браузер.
#
# Логи пишутся в launcher.log. При ошибке окно не закрывается — предлагает
# нажать клавишу и посмотреть лог.
# -----------------------------------------------------------------------------

APP_NAME="Bee Schematic Lab"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_DIR/launcher.log"
PORT="${BEE_PORT:-4173}"
URL="http://localhost:${PORT}"

# Цвета
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    BOLD=$(tput bold); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1); RESET=$(tput sgr0)
else
    BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
ok()   { log "${GREEN}✓${RESET}  $*"; }
warn() { log "${YELLOW}⚠${RESET}  $*"; }
fail() { log "${RED}✗${RESET}  $*"; }

pause() {
    echo ""
    read -n 1 -s -r -p "Нажмите любую клавишу для закрытия..."
    echo ""
}

die() {
    fail "$1"
    log "Подробности смотрите в логе: $LOG_FILE"
    log "Последние строки лога:"
    tail -n 20 "$LOG_FILE" | sed 's/^/    /'
    pause
    exit 1
}

# -----------------------------------------------------------------------------
banner() {
    echo "${BOLD}${GREEN}🐝 $APP_NAME${RESET}"
    echo "  Папка:  $PROJECT_DIR"
    echo "  Лог:    $LOG_FILE"
    echo ""
}

clear_log() {
    # Сохраняем лог запуска (не очищаем полностью, добавляем разделитель)
    {
        echo ""
        echo "============================================================"
        echo "=== Запуск: $(date '+%Y-%m-%d %H:%M:%S') ==="
        echo "============================================================"
    } >> "$LOG_FILE"
}

check_runtime() {
    if ! command -v node >/dev/null 2>&1; then
        die "Node.js не найден. Установите его командой: bash scripts/install-shortcut.sh"
    fi
    if ! command -v npm >/dev/null 2>&1; then
        die "npm не найден. Запустите: bash scripts/install-shortcut.sh"
    fi
    ok "node $(node -v), npm $(npm -v)"
}

# -----------------------------------------------------------------------------
# Основной блок (обёрнут в функцию, чтобы можно было поймать ошибку)
# -----------------------------------------------------------------------------
run() {
    cd "$PROJECT_DIR"

    # --- 1. Auto-update: git fetch с таймаутом (см. scripts/git-update.sh) ---
    # Обновление ограничено по времени и никогда не ждёт ввода пользователя,
    # поэтому запуск не может «застрять» на шаге git pull.
    log "[1/4] Проверка обновлений..."
    if [ -f "$SCRIPT_DIR/git-update.sh" ]; then
        # shellcheck source=scripts/git-update.sh disable=SC1090,SC1091
        . "$SCRIPT_DIR/git-update.sh"
        bee_update_code log ok warn "$LOG_FILE"
        NEED_INSTALL="${BEE_FILES_UPDATED:-0}"
    else
        warn "Файл scripts/git-update.sh не найден — автообновление отключено."
        NEED_INSTALL=0
    fi

    # --- 2. npm install ---
    log "[2/4] Проверка зависимостей..."
    if [ ! -d node_modules ] || [ "${NEED_INSTALL:-0}" = "1" ] || \
       [ package.json -nt node_modules/.package-lock.json ] 2>/dev/null || \
       [ package-lock.json -nt node_modules/.package-lock.json ] 2>/dev/null; then
        log "  Устанавливаю/обновляю npm-зависимости..."
        if npm install --no-audit --no-fund >> "$LOG_FILE" 2>&1; then
            ok "Зависимости установлены"
        else
            die "npm install завершилась с ошибкой."
        fi
    else
        ok "Зависимости актуальны"
    fi

    # --- 3. Build ---
    log "[3/4] Сборка production-версии..."
    if npm run build >> "$LOG_FILE" 2>&1; then
        ok "Сборка готова (dist/)"
    else
        die "Сборка не удалась (npm run build)."
    fi

    # --- 4. Start server ---
    log "[4/4] Запуск сервера на $URL ..."

    if command -v fuser >/dev/null 2>&1; then
        fuser -k "${PORT}/tcp" >> "$LOG_FILE" 2>&1 || true
        sleep 1
    fi

    npm run preview -- --port "$PORT" --host 0.0.0.0 >> "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    log "  PID сервера: $SERVER_PID"

    for _ in $(seq 1 40); do
        if curl -sf "$URL" -o /dev/null 2>/dev/null; then
            break
        fi
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then
            die "Сервер упал сразу после запуска."
        fi
        sleep 0.5
    done

    if ! curl -sf "$URL" -o /dev/null 2>/dev/null; then
        die "Сервер не ответил на $URL за 20 секунд."
    fi

    ok "Сервер запущен: $URL"
    log "Открываю браузер..."
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$URL" >/dev/null 2>&1 &
    elif command -v gnome-open >/dev/null 2>&1; then
        gnome-open "$URL" >/dev/null 2>&1 &
    fi

    echo ""
    echo "${BOLD}$APP_NAME работает!${RESET}  Адрес: $URL"
    echo "Нажмите ${BOLD}Ctrl+C${RESET}, чтобы остановить сервер и закрыть окно."
    echo ""
}

cleanup() {
    echo ""
    log "Остановка сервера..."
    if [ -n "${SERVER_PID:-}" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    ok "Сервер остановлен. До встречи! 🐝"
    exit 0
}
trap cleanup INT TERM

# -----------------------------------------------------------------------------
banner
clear_log
check_runtime
run

wait "${SERVER_PID:-0}" 2>/dev/null || true
