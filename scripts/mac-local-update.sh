#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE=""
LOG_PATH="${LA_LOCAL_UPDATE_LOG:-/tmp/linguist-agent-local-update.log}"
STATUS_PATH="${LA_LOCAL_UPDATE_STATUS:-/tmp/linguist-agent-local-update.status}"

usage() {
  cat <<'USAGE'
Usage:
  scripts/mac-local-update.sh --check [--repo <path>]
  scripts/mac-local-update.sh --install [--repo <path>]

Checks the current git branch against its upstream, then optionally pulls and
installs only what changed: the signed Electron app for apps/desktop changes,
the managed runtime for runtime changes, or no rebuild for documentation-only
updates. Installation runs only after the explicit --install confirmation.
USAGE
}

parse_arguments() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check)
        [[ -z "$MODE" || "$MODE" == "check" ]] || { echo "Choose exactly one of --check or --install" >&2; exit 2; }
        MODE="check"
        shift
        ;;
      --install)
        [[ -z "$MODE" || "$MODE" == "install" ]] || { echo "Choose exactly one of --check or --install" >&2; exit 2; }
        MODE="install"
        shift
        ;;
      --repo)
        [[ $# -ge 2 ]] || { echo "--repo requires a path" >&2; exit 2; }
        REPO_ROOT="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 2
        ;;
    esac
  done
  REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
}

timestamp() {
  date "+%Y-%m-%d %H:%M:%S"
}

set_status() {
  local status="$1"
  local message="$2"
  {
    emit status "$status"
    emit message "$message"
    emit updated_at "$(timestamp)"
  } > "$STATUS_PATH"
}

emit() {
  local key="$1"
  local value="$2"
  printf '%s=%s\n' "$key" "$value"
}

managed_runtime_root() {
  printf '%s\n' "${LA_MANAGED_RUNTIME_ROOT:-$HOME/Library/Application Support/Linguist Agent/runtime}"
}

wait_runtime_health() {
  local port="${LA_SERVER_PORT:-8787}"
  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "Managed runtime did not become ready on :$port"
  return 1
}

sync_managed_runtime() {
  local root parent backups preserve migration_backups_preserve
  root="$(managed_runtime_root)"
  parent="$(dirname "$root")"
  backups="$parent/runtime-backups"
  preserve="$root/.la-data-preserve"
  migration_backups_preserve="$root/.la-migration-backups-preserve"

  echo "Syncing managed runtime: $root"
  mkdir -p "$root" "$backups"

  if [[ -f "$root/package.json" ]]; then
    echo "Stopping existing managed runtime"
    (cd "$root" && npm run server:install -- --stop || true)
    echo "Backing up previous managed runtime"
    COPYFILE_DISABLE=1 tar \
      --exclude './data' \
      --exclude './.la-runtime-data-backups' \
      --exclude './node_modules' \
      --exclude './.codegraph' \
      --exclude './tmp' \
      -czf "$backups/runtime-$(date +%Y%m%d%H%M%S).tar.gz" \
      -C "$root" . || echo "Managed runtime backup skipped; continuing with data-preserving sync"
  fi

  rm -rf "$preserve" "$migration_backups_preserve"
  if [[ -d "$root/data" ]]; then
    mv "$root/data" "$preserve"
  fi
  if [[ -d "$root/.la-runtime-data-backups" ]]; then
    mv "$root/.la-runtime-data-backups" "$migration_backups_preserve"
  fi
  find "$root" -mindepth 1 -maxdepth 1 \
    ! -name '.la-data-preserve' \
    ! -name '.la-migration-backups-preserve' \
    -exec rm -rf {} +
  rsync -a --delete \
    --exclude '.git' \
    --exclude '.agents' \
    --exclude '.pi/skills' \
    --exclude '.la-data-preserve' \
    --exclude '.la-migration-backups-preserve' \
    --exclude '.la-runtime-data-backups' \
    --exclude 'data' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.turbo' \
    --exclude '.cache' \
    --exclude '.codegraph' \
    --exclude 'tmp' \
    "$REPO_ROOT"/ "$root"/
  git -C "$REPO_ROOT" ls-files -z '.pi/skills/**' \
    | rsync -a --from0 --files-from=- "$REPO_ROOT"/ "$root"/
  if [[ -d "$preserve" ]]; then
    mv "$preserve" "$root/data"
  else
    mkdir -p "$root/data"
  fi
  if [[ -d "$migration_backups_preserve" ]]; then
    mv "$migration_backups_preserve" "$root/.la-runtime-data-backups"
  fi

  echo "Installing managed runtime dependencies"
  npm --prefix "$root" install
  echo "Installing and starting managed runtime LaunchAgent"
  if ! npm --prefix "$root" run server:install; then
    echo "server:install returned non-zero; checking managed runtime health"
    wait_runtime_health
  fi
  wait_runtime_health
}

require_repo() {
  if [[ ! -d "$REPO_ROOT/.git" || ! -f "$REPO_ROOT/package.json" ]]; then
    emit status "not_a_repo"
    emit repo "$REPO_ROOT"
    emit message "Not a Linguist Agent git checkout"
    exit 0
  fi
}

upstream_ref() {
  local upstream
  if upstream="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    printf '%s\n' "$upstream"
    return
  fi
  printf '%s\n' "${LA_LOCAL_UPDATE_REF:-origin/main}"
}

bundle_plist_value() {
  local app_dir="$1" key="$2"
  /usr/libexec/PlistBuddy -c "Print :$key" "$app_dir/Contents/Info.plist" 2>/dev/null
}

bundle_executable() {
  local executable
  executable="$(bundle_plist_value "$1" CFBundleExecutable)" || return 1
  [[ -n "$executable" && "$executable" != */* && "$executable" != "." && "$executable" != ".." ]] || return 1
  printf '%s\n' "$executable"
}

installed_app_version() {
  local install_app_dir="${1:-${LA_MAC_INSTALL_APP_DIR:-/Applications/LinguistAgent.app}}"
  bundle_plist_value "$install_app_dir" CFBundleShortVersionString || true
}

installed_app_build() {
  local install_app_dir="${1:-${LA_MAC_INSTALL_APP_DIR:-/Applications/LinguistAgent.app}}"
  bundle_plist_value "$install_app_dir" CFBundleVersion || true
}

app_reinstall_message() {
  local install_app_dir="${1:-${LA_MAC_INSTALL_APP_DIR:-/Applications/LinguistAgent.app}}"
  if ! validate_app_bundle "$install_app_dir" >/dev/null 2>&1; then
    printf 'Installed app is missing or incomplete\n'
    return 0
  fi
  if [[ -z "$(installed_app_version "$install_app_dir")" || -z "$(installed_app_build "$install_app_dir")" ]]; then
    printf 'Installed app metadata is incomplete\n'
    return 0
  fi
  return 1
}

update_kind() {
  local files="$1" app=0 runtime=0 unknown=0 path
  if [[ -z "$files" ]]; then
    printf 'none\n'
    return
  fi
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    case "$path" in
      apps/desktop/tests/*|apps/desktop/docs/*|apps/desktop/*.md|*.md) ;;
      apps/desktop/*) app=1 ;;
      packages/*|package.json|package-lock.json|.pi/*|scripts/*) runtime=1 ;;
      tests/*) ;;
      *) unknown=1 ;;
    esac
  done <<< "$files"
  if [[ "$unknown" == "1" || "$app" == "1" ]]; then
    printf 'app_runtime\n'
  elif [[ "$runtime" == "1" ]]; then
    printf 'runtime\n'
  else
    printf 'docs\n'
  fi
}

local_update_dirty_status() {
  local line path
  git -C "$REPO_ROOT" status --porcelain | while IFS= read -r line; do
    path="${line:3}"
    [[ "$path" == ".pi/settings.json" ]] && continue
    printf '%s\n' "$line"
  done
}

remove_path() {
  local path="$1"
  if [[ -e "$path" || -L "$path" ]]; then
    /bin/rm -rf "$path"
  fi
}

validate_app_bundle() {
  local app_dir="$1" executable
  [[ -f "$app_dir/Contents/Info.plist" ]] || { echo "Missing Info.plist in $app_dir" >&2; return 1; }
  /usr/bin/plutil -lint "$app_dir/Contents/Info.plist" >/dev/null
  executable="$(bundle_executable "$app_dir")" || { echo "Missing CFBundleExecutable in $app_dir" >&2; return 1; }
  [[ -x "$app_dir/Contents/MacOS/$executable" ]] || { echo "Missing executable $executable in $app_dir" >&2; return 1; }
  /usr/bin/codesign --verify --deep --strict "$app_dir" >/dev/null
}

replace_app_bundle() {
  local source="$1" dest="$2" backup code
  backup="${dest}.previous.$$"
  remove_path "$backup"
  if [[ -e "$dest" || -L "$dest" ]]; then
    /bin/mv "$dest" "$backup"
  fi
  if /bin/mv "$source" "$dest"; then
    if validate_app_bundle "$dest"; then
      remove_path "$backup" || true
      return 0
    else
      code=$?
    fi
  else
    code=$?
  fi
  remove_path "$dest" || true
  if [[ -e "$backup" || -L "$backup" ]]; then
    /bin/mv "$backup" "$dest"
  fi
  return "$code"
}

install_app_bundle() {
  local source="$1" dest="$2" dest_tmp code
  dest_tmp="${dest}.tmp.$$"
  remove_path "$dest_tmp"
  if /usr/bin/ditto "$source" "$dest_tmp"; then
    :
  else
    code=$?
    remove_path "$dest_tmp" || true
    return "$code"
  fi
  if validate_app_bundle "$dest_tmp"; then
    :
  else
    code=$?
    remove_path "$dest_tmp" || true
    return "$code"
  fi
  if replace_app_bundle "$dest_tmp" "$dest"; then
    :
  else
    code=$?
    remove_path "$dest_tmp" || true
    return "$code"
  fi
}

check_status() {
  require_repo

  local upstream dirty head remote base behind ahead status can_install message app_message app_needs_install changed kind
  upstream="$(upstream_ref)"
  git -C "$REPO_ROOT" fetch --quiet --prune

  dirty=0
  if [[ -n "$(local_update_dirty_status)" ]]; then
    dirty=1
  fi

  head="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  if ! remote="$(git -C "$REPO_ROOT" rev-parse "$upstream" 2>/dev/null)"; then
    emit status "missing_upstream"
    emit repo "$REPO_ROOT"
    emit upstream "$upstream"
    emit dirty "$dirty"
    emit can_install "0"
    emit message "Cannot resolve upstream ref $upstream"
    exit 0
  fi

  base="$(git -C "$REPO_ROOT" merge-base HEAD "$upstream")"
  behind="$(git -C "$REPO_ROOT" rev-list --count "HEAD..$upstream")"
  ahead="$(git -C "$REPO_ROOT" rev-list --count "$upstream..HEAD")"
  changed="$(git -C "$REPO_ROOT" diff --name-only HEAD "$upstream" 2>/dev/null || true)"
  kind="$(update_kind "$changed")"
  can_install=0
  app_needs_install=0
  if app_message="$(app_reinstall_message)"; then
    app_needs_install=1
  fi

  if [[ "$head" == "$remote" ]]; then
    if [[ "$app_needs_install" == "1" ]]; then
      status="update_available"
      message="$app_message"
      if [[ "$dirty" == "0" ]]; then
        can_install=1
      fi
    else
      status="up_to_date"
      message="Current branch is up to date"
    fi
  elif [[ "$head" == "$base" ]]; then
    status="update_available"
    message="$behind commit(s) available from $upstream"
    if [[ "$dirty" == "0" ]]; then
      can_install=1
    fi
  elif [[ "$remote" == "$base" ]]; then
    status="local_ahead"
    message="Local branch is ahead of $upstream"
  else
    status="diverged"
    message="Local branch diverged from $upstream"
  fi

  emit status "$status"
  emit repo "$REPO_ROOT"
  emit upstream "$upstream"
  emit behind "$behind"
  emit ahead "$ahead"
  emit dirty "$dirty"
  emit can_install "$can_install"
  emit current "$head"
  emit remote "$remote"
  emit update_kind "$kind"
  emit message "$message"
}

install_update() {
  require_repo

  : > "$LOG_PATH"
  set_status "running" "Starting local update"
  trap 'code=$?; if [[ "$code" -ne 0 ]]; then set_status "failed" "Local update failed with exit code $code"; fi' EXIT
  exec > >(tee -a "$LOG_PATH") 2>&1

  echo "[$(timestamp)] Starting Linguist Agent local update"
  echo "repo=$REPO_ROOT"

  if [[ -n "$(local_update_dirty_status)" ]]; then
    echo "Working tree has uncommitted changes. Commit, stash, or discard them before updating."
    exit 20
  fi

  local upstream head remote base app_dir app_executable install_app_dir app_message app_needs_install changed kind
  install_app_dir="${LA_MAC_INSTALL_APP_DIR:-/Applications/LinguistAgent.app}"
  app_needs_install=0
  if app_message="$(app_reinstall_message "$install_app_dir")"; then
    app_needs_install=1
  fi
  upstream="$(upstream_ref)"
  echo "Fetching $upstream"
  git -C "$REPO_ROOT" fetch --quiet --prune
  head="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  remote="$(git -C "$REPO_ROOT" rev-parse "$upstream")"
  base="$(git -C "$REPO_ROOT" merge-base HEAD "$upstream")"
  changed="$(git -C "$REPO_ROOT" diff --name-only HEAD "$upstream" 2>/dev/null || true)"
  kind="$(update_kind "$changed")"
  echo "update_kind=$kind"

  if [[ "$head" == "$remote" && "$app_needs_install" == "0" ]]; then
    echo "Already up to date."
    set_status "completed" "Already up to date"
    exit 0
  fi
  if [[ "$head" == "$remote" ]]; then
    echo "$app_message"
  fi
  if [[ "$head" != "$base" ]]; then
    echo "Branch is not a fast-forward update from $upstream. Resolve git state manually."
    exit 21
  fi

  echo "Pulling latest code"
  git -C "$REPO_ROOT" merge --ff-only "$upstream"

  if [[ "$kind" == "docs" && "$app_needs_install" == "0" ]]; then
    echo "Documentation-only update. Runtime and app are unchanged."
    set_status "completed" "Documentation-only update applied"
    exit 0
  fi

  echo "Installing source dependencies"
  npm --prefix "$REPO_ROOT" install

  if [[ "$kind" == "app_runtime" || "$app_needs_install" == "1" ]]; then
    echo "Installing Electron desktop dependencies"
    npm --prefix "$REPO_ROOT/apps/desktop" install
    echo "Building signed Electron app"
    npm --prefix "$REPO_ROOT/apps/desktop" run package

    app_dir="$REPO_ROOT/apps/desktop/out/LinguistAgent-darwin-arm64/LinguistAgent.app"
    npm --prefix "$REPO_ROOT/apps/desktop" run verify -- --app="$app_dir"
    app_executable="$(bundle_executable "$app_dir")"

    echo "Build finished. Installing Linguist Agent to $install_app_dir"
    set_status "installing_app" "Installing Linguist Agent"
    pkill -x "$app_executable" || true
    sleep 0.8
    mkdir -p "$(dirname "$install_app_dir")"
    install_app_bundle "$app_dir" "$install_app_dir"
  else
    echo "No mac app changes. Skipping app build."
  fi

  set_status "syncing_runtime" "Syncing managed runtime"
  sync_managed_runtime

  echo "Restarting Linguist Agent from $install_app_dir"
  set_status "restarting" "Restarting Linguist Agent"
  /usr/bin/open -n "$install_app_dir"
  echo "[$(timestamp)] Linguist Agent update finished"
  set_status "completed" "Linguist Agent updated and relaunched"
}

main() {
  parse_arguments "$@"
  if [[ -z "$MODE" ]]; then
    usage >&2
    exit 2
  fi
  case "$MODE" in
    check) check_status ;;
    install) install_update ;;
    *) echo "Unknown mode: $MODE" >&2; exit 2 ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
