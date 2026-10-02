#!/usr/bin/env bash
# =============================================================================
# Bee Schematic Lab — полная установка на Ubuntu / Debian / Linux Mint
#
# Скрипт делает всё для первого запуска:
#   1. Проверяет обязательные утилиты (git, node, npm, curl) и предлагает
#      установить их через apt, если чего-то не хватает.
#   2. Подтягивает последнюю версию кода (git pull origin main).
#   3. Ставит npm-зависимости (npm install).
#   4. Делает первичную production-сборку (npm run build).
#   5. Устанавливает ярлык в меню приложений (~/.local/share/applications)
#      и иконку в системную папку иконок.
#   6. Опционально запускает приложение сразу после установки.
#
# Использование:
#   bash scripts/install-shortcut.sh          # установка (по умолчанию)
#   bash scripts/install-shortcut.sh update   # обновить код, зависимости и пересобрать
#   bash scripts/install-shortcut.sh remove   # удалить ярлык
#
# Запуск без sudo: всё ставится в домашнюю папку пользователя.
# Для установки системных пакетов (git/nodejs) скрипт вызовет sudo сам.
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Определение путей
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_ID="bee-schematic-lab"
APP_NAME="Bee Schematic Lab"
DESKTOP_SRC="$SCRIPT_DIR/${APP_ID}.desktop"
DESKTOP_DST="$HOME/.local/share/applications/${APP_ID}.desktop"
ICON_SRC="$PROJECT_DIR/public/logo.png"
ICON_DST_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
ICON_DST="$ICON_DST_DIR/${APP_ID}.png"
LOG_FILE="$PROJECT_DIR/launcher.log"

REQUIRED_NODE_MAJOR=18   # vite 8 / react 19 нуждаются в актуальной Node.js

# Цвета (если терминал поддерживает)
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    BOLD=$(tput bold); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1); RESET=$(tput sgr0)
else
    BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

info()  { echo "${GREEN}==>${RESET} $*"; }
warn()  { echo "${YELLOW}⚠${RESET}  $*"; }
err()   { echo "${RED}✗${RESET}  $*" >&2; }
ok()    { echo "${GREEN}✓${RESET}  $*"; }
step()  { echo ""; echo "${BOLD}── $* ──${RESET}"; }

# -----------------------------------------------------------------------------
# 0. Проверка: мы точно в папке проекта?
# -----------------------------------------------------------------------------
if [ ! -f "$PROJECT_DIR/package.json" ]; then
    err "Не найден package.json в $PROJECT_DIR"
    err "Запускайте скрипт из корня репозитория: bash scripts/install-shortcut.sh"
    exit 1
fi

# -----------------------------------------------------------------------------
# 1. Проверка системных зависимостей
# -----------------------------------------------------------------------------
install_node_with_nvm() {
    local node_ok=0
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        local node_ver node_major
        node_ver=$(node -v | sed 's/^v//')
        node_major=$(echo "$node_ver" | cut -d. -f1)
        if [ "$node_major" -ge "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
            node_ok=1
            ok "node.js v$node_ver, npm v$(npm -v)"
        else
            warn "node.js v$node_ver слишком старый (нужна >= v$REQUIRED_NODE_MAJOR.x)"
        fi
    fi

    [ "$node_ok" = "1" ] && return 0

    info "Node.js не найден или устарел — скачиваю актуальную LTS-версию автоматически"
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    mkdir -p "$NVM_DIR"

    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
        info "Устанавливаю nvm в $NVM_DIR"
        if ! curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash; then
            err "Не удалось скачать nvm. Проверьте интернет-соединение."
            exit 1
        fi
    fi

    # nvm — shell-функция, поэтому после установки загружаем её в текущий процесс.
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    if ! nvm install --lts; then
        err "Не удалось скачать Node.js LTS через nvm."
        exit 1
    fi
    nvm alias default 'lts/*' >/dev/null 2>&1 || true
    nvm use --lts >/dev/null

    local installed_ver installed_major
    installed_ver=$(node -v | sed 's/^v//')
    installed_major=$(echo "$installed_ver" | cut -d. -f1)
    if [ "$installed_major" -lt "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
        err "Скачанная версия Node.js слишком старая: v$installed_ver"
        exit 1
    fi
    ok "Node.js v$installed_ver и npm v$(npm -v) готовы"
}

check_system_deps() {
    step "Проверка системных утилит"

    local missing=()
    local need_install=0

    for cmd in git curl bash; do
        if command -v "$cmd" >/dev/null 2>&1; then
            ok "$cmd найден: $(command -v "$cmd")"
        else
            warn "$cmd не найден"
            missing+=("$cmd")
        fi
    done

    # fuser — нужно для лаунчера (чтобы убивать старый сервер на порту)
    if ! command -v fuser >/dev/null 2>&1; then
        warn "fuser не найден (пакет psmisc)"
        missing+=("psmisc")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        echo ""
        # Отделим критические пакеты от опциональных
        local critical=()
        local optional=()
        for p in "${missing[@]}"; do
            case "$p" in
                psmisc) optional+=("$p") ;;
                *) critical+=("$p") ;;
            esac
        done

        if [ ${#critical[@]} -gt 0 ]; then
            warn "Нужно установить обязательные пакеты: ${critical[*]}"
            if command -v apt-get >/dev/null 2>&1; then
                echo "    Попробую установить через apt (потребуется sudo)..."
                sudo apt-get update -y
                if ! sudo apt-get install -y "${critical[@]}"; then
                    err "Не удалось установить обязательные пакеты."
                    err "Установите их вручную и запустите скрипт снова:"
                    err "  sudo apt-get install ${critical[*]}"
                    err "Если node.js старый — используйте nvm:"
                    err "  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
                    err "  nvm install 20 && nvm use 20"
                    exit 1
                fi
                ok "Обязательные пакеты установлены"
            else
                err "apt-get не найден — это не Ubuntu/Debian. Установите вручную: ${critical[*]}"
                exit 1
            fi
        fi

        if [ ${#optional[@]} -gt 0 ]; then
            warn "Опциональные пакеты (${optional[*]}) не найдены."
            warn "Без них лаунчер тоже работает (fuser используется для очистки порта)."
            if command -v apt-get >/dev/null 2>&1; then
                sudo apt-get install -y "${optional[@]}" 2>/dev/null || \
                    warn "Не удалось установить опциональные пакеты — продолжаю."
            fi
        fi
    else
        ok "Все системные зависимости присутствуют"
    fi

    # Node.js и npm устанавливаем через nvm в домашнюю папку пользователя.
    # Так не зависит от того, насколько свежая версия nodejs есть в apt.
    install_node_with_nvm
}

# -----------------------------------------------------------------------------
# 2. Обновление кода (git pull)
# -----------------------------------------------------------------------------
update_code() {
    step "Обновление кода (git pull)"
    cd "$PROJECT_DIR"

    if [ ! -d .git ]; then
        warn "Это не git-репозиторий, шаг pull пропущен"
        return 0
    fi

    info "Текущая ветка: $(git branch --show-current 2>/dev/null || echo '?')"
    info "Текущий коммит: $(git rev-parse --short HEAD 2>/dev/null || echo '?')"

    if ! git fetch origin main >> "$LOG_FILE" 2>&1; then
        warn "git fetch не удался (нет сети? Репозиторий недоступен?). Продолжаю с текущей версией."
        return 0
    fi

    LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "$LOCAL")

    if [ "$LOCAL" != "$REMOTE" ]; then
        info "Доступна новая версия ($(echo "$LOCAL" | cut -c1-8) → $(echo "$REMOTE" | cut -c1-8))"
        if git pull origin main >> "$LOG_FILE" 2>&1; then
            ok "Код обновлён до $(git rev-parse --short HEAD)"
        else
            warn "git pull не удался (возможно, есть локальные изменения)."
            warn "Попробуйте вручную: cd $PROJECT_DIR && git stash && git pull"
        fi
    else
        ok "Код актуален ($(git rev-parse --short HEAD))"
    fi
}

# -----------------------------------------------------------------------------
# 3. Установка npm-зависимостей
# -----------------------------------------------------------------------------
install_npm_deps() {
    step "Установка npm-зависимостей"
    cd "$PROJECT_DIR"

    if [ -d node_modules ] && [ package.json -ot node_modules/.package-lock.json ] 2>/dev/null \
       && [ package-lock.json -ot node_modules/.package-lock.json ] 2>/dev/null; then
        ok "Зависимости уже установлены и актуальны"
        return 0
    fi

    info "Запускаю npm install (может занять минуту)..."
    npm install --no-audit --no-fund 2>&1 | tee -a "$LOG_FILE" | tail -5
    ok "npm-зависимости установлены"
}

# -----------------------------------------------------------------------------
# 4. Production-сборка
# -----------------------------------------------------------------------------
build_project() {
    step "Production-сборка (npm run build)"
    cd "$PROJECT_DIR"
    npm run build 2>&1 | tee -a "$LOG_FILE" | tail -10
    ok "Сборка завершена (папка dist/)"
}

# -----------------------------------------------------------------------------
# 5. Установка ярлыка и иконки
# -----------------------------------------------------------------------------
install_shortcut() {
    step "Установка ярлыка в меню приложений"

    chmod +x "$SCRIPT_DIR/launcher.sh"

    mkdir -p "$ICON_DST_DIR"
    cp "$ICON_SRC" "$ICON_DST"
    ok "Иконка → $ICON_DST"

    mkdir -p "$(dirname "$DESKTOP_DST")"
    sed "s|%PROJECT_DIR%|$PROJECT_DIR|g" "$DESKTOP_SRC" > "$DESKTOP_DST"
    chmod +x "$DESKTOP_DST"
    ok "Ярлык  → $DESKTOP_DST"

    # Обновляем кэш рабочего стола и иконок
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
    fi
    ok "Кэш рабочего стола обновлён"
}

# -----------------------------------------------------------------------------
# 6. Удаление ярлыка
# -----------------------------------------------------------------------------
uninstall_shortcut() {
    step "Удаление ярлыка «$APP_NAME»"
    rm -f "$DESKTOP_DST"
    rm -f "$ICON_DST"
    ok "Удалено: $DESKTOP_DST"
    ok "Удалено: $ICON_DST"
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
    fi
    ok "Кэш рабочего стола обновлён"
    echo ""
    ok "Ярлык удалён. Код проекта и node_modules оставлены как есть."
    echo "   Чтобы удалить и их: rm -rf $PROJECT_DIR/node_modules $PROJECT_DIR/dist"
}

# -----------------------------------------------------------------------------
# 7. Первый запуск
# -----------------------------------------------------------------------------
offer_launch() {
    echo ""
    if [ -t 0 ]; then
        read -r -p "Запустить $APP_NAME прямо сейчас? [Y/n] " ans
        case "$ans" in
            [nN]|[nN][oO]|"нет"|"Нет"|"НЕТ")
                info "Хорошо. Запустите позже из меню приложений или командой:"
                echo "    bash $SCRIPT_DIR/launcher.sh"
                ;;
            *)
                info "Запускаю..."
                bash "$SCRIPT_DIR/launcher.sh"
                ;;
        esac
    else
        info "Нет интерактивного ввода — запустите вручную из меню или:"
        echo "    bash $SCRIPT_DIR/launcher.sh"
    fi
}

# -----------------------------------------------------------------------------
# Главное меню
# -----------------------------------------------------------------------------
banner() {
    echo "${BOLD}${GREEN}"
    echo "  ╔═══════════════════════════════════════════╗"
    echo "  ║     🐝  Bee Schematic Lab — установка     ║"
    echo "  ╚═══════════════════════════════════════════╝"
    echo "${RESET}"
}

main() {
    local action="${1:-install}"

    case "$action" in
        install|i|"")
            banner
            echo "Папка проекта: $PROJECT_DIR"
            echo "Лог:           $LOG_FILE"
            : > "$LOG_FILE"  # очищаем лог для новой установки
            check_system_deps
            update_code
            install_npm_deps
            build_project
            install_shortcut
            echo ""
            echo "${BOLD}${GREEN}═══════════════════════════════════════════════${RESET}"
            ok "${BOLD}Установка завершена!${RESET}"
            echo "  • Ярлык «$APP_NAME» доступен в меню приложений Ubuntu"
            echo "  • Или запустите вручную:  bash $SCRIPT_DIR/launcher.sh"
            echo "  • Режим разработки:       npm run dev"
            echo "  • Логи запуска:           $LOG_FILE"
            echo "${BOLD}${GREEN}═══════════════════════════════════════════════${RESET}"
            offer_launch
            ;;
        update|upgrade|up)
            banner
            echo "${BOLD}Режим: обновление${RESET}"
            : >> "$LOG_FILE"
            check_system_deps
            update_code
            install_npm_deps
            build_project
            echo ""
            ok "${BOLD}Обновление завершено!${RESET}"
            ;;
        remove|uninstall|rm|r|u)
            banner
            uninstall_shortcut
            ;;
        launcher|run|start)
            bash "$SCRIPT_DIR/launcher.sh"
            ;;
        *)
            echo "Использование: $0 [install|update|remove|launcher]"
            echo ""
            echo "  install   (по умолчанию) — полная установка: проверка системы,"
            echo "                            git pull, npm install, build, ярлык"
            echo "  update                  — подтянуть код, зависимости, пересобрать"
            echo "  remove                  — удалить ярлык из меню приложений"
            echo "  launcher                — сразу запустить лаунчер"
            exit 1
            ;;
    esac
}

main "$@"
