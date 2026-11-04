# Sourced by the run scripts: `load_env <file>...` exports dotenv settings (see load-env.mjs).
# Relative paths are taken from the caller's current directory. The loader runs from / so Bun's own
# automatic .env loading can't pre-fill the environment; Node is used only if it has util.parseEnv
# (Node >= 20.12), otherwise Bun. Any loader failure stops the calling script.
load_env() {
  local loader runner exports f
  local files=()
  loader="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/load-env.mjs"
  for f in "$@"; do
    case "$f" in
      /*) files+=("$f") ;;
      *) files+=("$PWD/$f") ;;
    esac
  done
  if command -v node >/dev/null 2>&1 \
    && node -e 'process.exit(typeof require("node:util").parseEnv === "function" ? 0 : 1)' >/dev/null 2>&1; then
    runner=node
  elif command -v bun >/dev/null 2>&1; then
    runner=bun
  else
    echo "load_env: needs Node >= 20.12 or Bun to read .env files" >&2
    exit 1
  fi
  if ! exports="$(cd / && "$runner" "$loader" ${files[@]+"${files[@]}"})"; then
    echo "load_env: could not read settings from: $*" >&2
    exit 1
  fi
  eval "$exports"
}
