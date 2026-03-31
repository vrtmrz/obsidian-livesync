#!/usr/bin/env bash
# test-helpers-docker.sh
#
# Docker-mode overrides for test-helpers.sh.
# Sourced automatically at the end of test-helpers.sh when
# LIVESYNC_TEST_DOCKER=1 is set, replacing run_cli (and related helpers)
# with a Docker-based implementation.
#
# The Docker container and the host share a common directory layout:
#   $WORK_DIR  (host)  <->  /workdir  (container)
#   $CLI_DIR   (host)  <->  /clidir   (container)
#
# Usage (run an existing test against the Docker image):
#   LIVESYNC_TEST_DOCKER=1 bash test/test-push-pull-linux.sh
#   LIVESYNC_TEST_DOCKER=1 bash test/test-mirror-linux.sh
#   LIVESYNC_TEST_DOCKER=1 bash test/test-sync-two-local-databases-linux.sh
#   LIVESYNC_TEST_DOCKER=1 bash test/test-setup-put-cat-linux.sh
#
# Optional environment variables:
#   DOCKER_IMAGE    Image name/tag to use (default: livesync-cli)
#   RUN_BUILD       Set to 1 to rebuild the Docker image before the test
#                   (default: 0 — assumes the image is already built)
#                   Build command: npm run build:docker (from src/apps/cli/)
#
# Notes:
#   - The container is started with --network host so that it can reach
#     CouchDB / P2P relay containers that are also using the host network.
#   - On macOS / Windows Docker Desktop --network host behaves differently
#     (it is not a true host-network bridge); tests that rely on localhost
#     connectivity to other containers may fail on those platforms.

# Ensure Docker-mode tests do not trigger host-side `npm run build` unless
# explicitly requested by the caller.
RUN_BUILD="${RUN_BUILD:-0}"

# Override the standard implementation.
# In Docker mode the CLI_CMD array is a no-op sentinel; run_cli is overridden
# directly.
cli_test_init_cli_cmd() {
    DOCKER_IMAGE="${DOCKER_IMAGE:-livesync-cli}"
    # CLI_CMD is unused in Docker mode; set a sentinel so existing code
    # that references it will not error.
    CLI_CMD=(__docker__)
}

# ─── display_test_info ────────────────────────────────────────────────────────
display_test_info() {
    local image="${DOCKER_IMAGE:-livesync-cli}"
    local image_id
    image_id="$(docker inspect --format='{{slice .Id 7 19}}' "$image" 2>/dev/null || echo "N/A")"
    echo "======================"
    echo "Script: ${BASH_SOURCE[1]:-$0}"
    echo "Date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Commit: $(git -C "${SCRIPT_DIR:-.}" rev-parse --short HEAD 2>/dev/null || echo "N/A")"
    echo "Mode:   Docker  image=${image}  id=${image_id}"
    echo "======================"
}

# ─── _docker_translate_arg ───────────────────────────────────────────────────
# Translate a single host filesystem path to its in-container equivalent.
# Paths under WORK_DIR  → /workdir/...
# Paths under CLI_DIR   → /clidir/...
# Everything else is returned unchanged (relative paths, URIs, plain names).
_docker_translate_arg() {
    local arg="$1"
    if [[ -n "${WORK_DIR:-}" && "$arg" == "$WORK_DIR"* ]]; then
        printf '%s' "/workdir${arg#$WORK_DIR}"
        return
    fi
    if [[ -n "${CLI_DIR:-}" && "$arg" == "$CLI_DIR"* ]]; then
        printf '%s' "/clidir${arg#$CLI_DIR}"
        return
    fi
    printf '%s' "$arg"
}

# ─── run_cli ─────────────────────────────────────────────────────────────────
# Drop-in replacement for run_cli that executes the CLI inside a Docker
# container, translating host paths to container paths automatically.
#
# Calling convention is identical to the native run_cli:
#   run_cli <vault-path> [options] <command> [command-args]
#   run_cli init-settings [options] <settings-file>
#
# The vault path (first positional argument for regular commands) is forwarded
# via the LIVESYNC_DB_PATH environment variable so that docker-entrypoint.sh
# can inject it before the remaining CLI arguments.
run_cli() {
    local args=("$@")

    # ── 1. Translate all host paths to container paths ────────────────────
    local translated=()
    for arg in "${args[@]}"; do
        translated+=("$(_docker_translate_arg "$arg")")
    done

    # ── 2. Split vault path from the rest of the arguments ───────────────
    local first="${translated[0]:-}"
    local env_args=()
    local cli_args=()

    # These tokens are commands or flags that appear before any vault path.
    case "$first" in
        "" | --help | -h \
        | init-settings \
        | -v | --verbose | -d | --debug | -f | --force | -s | --settings)
            # No leading vault path — pass all translated args as-is.
            cli_args=("${translated[@]}")
            ;;
        *)
            # First arg is the vault path; hand it to docker-entrypoint.sh
            # via LIVESYNC_DB_PATH so the entrypoint prepends it correctly.
            env_args+=(-e "LIVESYNC_DB_PATH=$first")
            cli_args=("${translated[@]:1}")
            ;;
    esac

    # ── 3. Inject verbose / debug flags ──────────────────────────────────
    if [[ "${VERBOSE_TEST_LOGGING:-0}" == "1" ]]; then
        cli_args=(-v "${cli_args[@]}")
    fi

    # ── 4. Volume mounts ──────────────────────────────────────────────────
    local vol_args=()
    if [[ -n "${WORK_DIR:-}" ]]; then
        vol_args+=(-v "${WORK_DIR}:/workdir")
    fi
    # Mount CLI_DIR (src/apps/cli) for two-vault tests that store vault data
    # under $CLI_DIR/.livesync/.
    if [[ -n "${CLI_DIR:-}" ]]; then
        vol_args+=(-v "${CLI_DIR}:/clidir")
    fi

    # ── 5. stdin forwarding ───────────────────────────────────────────────
    # Attach stdin only when it is a pipe (the 'put' command reads from stdin).
    # Without -i the pipe data would never reach the container process.
    local stdin_flags=()
    if [[ ! -t 0 ]]; then
        stdin_flags=(-i)
    fi

    docker run --rm \
        "${stdin_flags[@]}" \
        --network host \
        --user "$(id -u):$(id -g)" \
        "${vol_args[@]}" \
        "${env_args[@]}" \
        "${DOCKER_IMAGE:-livesync-cli}" \
        "${cli_args[@]}"
}
