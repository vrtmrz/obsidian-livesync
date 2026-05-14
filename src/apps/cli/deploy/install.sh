#!/usr/bin/env bash
# install.sh — install livesync-cli as a systemd service
#
# Usage:
#   install.sh [--user] [--system] [--vault <path>] [--interval <N>]
#
# Defaults: user install, prompts for vault path if not supplied.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
CLI_DIR="$REPO_ROOT/src/apps/cli"
SERVICE_TEMPLATE="$SCRIPT_DIR/livesync-cli.service"

# ── Argument parsing ────────────────────────────────────────────────────────
INSTALL_MODE="user"
VAULT_PATH=""
INTERVAL=""
FORCE=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --user)
            INSTALL_MODE="user"
            shift
            ;;
        --system)
            INSTALL_MODE="system"
            shift
            ;;
        --vault)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --vault requires a path argument" >&2
                exit 1
            fi
            VAULT_PATH="$2"
            shift 2
            ;;
        --interval)
            if [[ -z "${2:-}" ]]; then
                echo "Error: --interval requires a numeric argument" >&2
                exit 1
            fi
            INTERVAL="$2"
            if ! [[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]]; then
                echo "Error: --interval requires a positive integer, got '$INTERVAL'" >&2
                exit 1
            fi
            shift 2
            ;;
        --force|-f)
            FORCE=1
            shift
            ;;
        --help|-h)
            cat <<EOF
Usage: install.sh [--user|--system] [--vault <path>] [--interval <N>] [--force]

  --user       Install as a user systemd service (default, ~/.config/systemd/user/)
  --system     Install as a system systemd service (/etc/systemd/system/)
  --vault      Path to the vault directory (prompted if omitted)
  --interval   Poll CouchDB every N seconds instead of using the _changes feed
  --force      Overwrite existing service unit without prompting
EOF
            exit 0
            ;;
        *)
            echo "Error: Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# ── Vault path ──────────────────────────────────────────────────────────────
if [[ -z "$VAULT_PATH" ]]; then
    if [ ! -t 0 ]; then
        echo "Error: --vault is required in non-interactive mode" >&2
        exit 1
    fi
    printf 'Vault path: '
    read -r VAULT_PATH
fi

_orig_vault="$VAULT_PATH"
if ! VAULT_PATH="$(cd -- "$VAULT_PATH" 2>/dev/null && pwd)"; then
    echo "Error: vault directory does not exist: $_orig_vault" >&2
    exit 1
fi

echo "[INFO] Vault: $VAULT_PATH"
echo "[INFO] Install mode: $INSTALL_MODE"

# ── Build ────────────────────────────────────────────────────────────────────
echo "[INFO] Building CLI from $REPO_ROOT..."
(cd "$REPO_ROOT" && npm install --silent)
(cd "$CLI_DIR" && npm run build)

BUILT_CJS="$CLI_DIR/dist/index.cjs"
if [[ ! -f "$BUILT_CJS" ]]; then
    echo "Error: build output not found: $BUILT_CJS" >&2
    exit 1
fi

# ── Install binary ───────────────────────────────────────────────────────────
if [[ "$INSTALL_MODE" == "user" ]]; then
    BIN_DIR="$HOME/.local/bin"
    UNIT_DIR="$HOME/.config/systemd/user"
    SYSTEMCTL_FLAGS="--user"
else
    BIN_DIR="/usr/local/bin"
    UNIT_DIR="/etc/systemd/system"
    SYSTEMCTL_FLAGS=""
fi

mkdir -p "$BIN_DIR"

LIVESYNC_BIN="$BIN_DIR/livesync-cli"
LIVESYNC_JS="$BIN_DIR/livesync-cli.js"

# Copy the CJS bundle so the wrapper is self-contained and independent of the
# build directory location.
cp "$BUILT_CJS" "$LIVESYNC_JS"

# Write a bash wrapper that invokes node on the installed bundle.
cat > "$LIVESYNC_BIN" <<WRAPPER
#!/usr/bin/env bash
exec node "$LIVESYNC_JS" "\$@"
WRAPPER
chmod +x "$LIVESYNC_BIN"
echo "[INFO] Installed bundle:  $LIVESYNC_JS"
echo "[INFO] Installed binary: $LIVESYNC_BIN"

# ── Write systemd unit ───────────────────────────────────────────────────────
mkdir -p "$UNIT_DIR"
UNIT_PATH="$UNIT_DIR/livesync-cli.service"

EXEC_START="\"$LIVESYNC_BIN\" \"$VAULT_PATH\""
if [[ -n "$INTERVAL" ]]; then
    EXEC_START="\"$LIVESYNC_BIN\" \"$VAULT_PATH\" --interval $INTERVAL"
fi

# Check for existing service and offer to overwrite.
if [[ -f "$UNIT_PATH" ]] && [[ "$FORCE" -eq 0 ]]; then
    if [ ! -t 0 ]; then
        echo "Error: service unit already exists at $UNIT_PATH; use --force to overwrite" >&2
        exit 1
    fi
    printf 'Service unit already exists at %s. Overwrite? [y/N]: ' "$UNIT_PATH"
    read -r CONFIRM
    case "$CONFIRM" in
        [yY]|[yY][eE][sS]) : ;;
        *)
            echo "[INFO] Aborted. Existing unit left in place."
            exit 0
            ;;
    esac
fi

# In awk gsub(), '&' in the replacement means "matched text"; escape any literal '&'
# in path variables before passing them as awk replacement strings.
AWK_BIN="${LIVESYNC_BIN//&/\\&}"
AWK_VAULT="${VAULT_PATH//&/\\&}"
awk -v bin="$AWK_BIN" -v vault="$AWK_VAULT" -v exec_start="ExecStart=$EXEC_START" \
    '/^ExecStart=/ { print exec_start; next } {gsub("LIVESYNC_BIN", bin); gsub("LIVESYNC_VAULT_PATH", vault); print}' \
    "$SERVICE_TEMPLATE" > "$UNIT_PATH"

echo "[INFO] Installed unit: $UNIT_PATH"

# ── Enable service ───────────────────────────────────────────────────────────
if ! command -v systemctl >/dev/null 2>&1; then
    echo "[WARN] systemctl not found — skipping service activation"
    echo "[INFO] To enable manually, copy $UNIT_PATH to the correct systemd directory and run:"
    echo "         systemctl $SYSTEMCTL_FLAGS daemon-reload"
    echo "         systemctl $SYSTEMCTL_FLAGS enable --now livesync-cli"
    exit 0
fi

# shellcheck disable=SC2086
systemctl $SYSTEMCTL_FLAGS daemon-reload
# shellcheck disable=SC2086
systemctl $SYSTEMCTL_FLAGS enable --now livesync-cli

echo ""
echo "[Done] livesync-cli service installed and started."
echo ""
# shellcheck disable=SC2086
systemctl $SYSTEMCTL_FLAGS status livesync-cli --no-pager || true
