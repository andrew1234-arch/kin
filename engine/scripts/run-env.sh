# Sourced by the run scripts: `load_env <file>...` exports dotenv settings (see load-env.mjs).
# Runs the loader with Node if present, else Bun, from / so Bun's own automatic .env loading can't
# pre-fill the environment. Any loader failure stops the calling script instead of continuing unconfigured.
load_env() {
  local loader runner exports
  loader="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/load-env.mjs"
  if command -v node >/dev/null 2>&1; then runner=node
  elif command -v bun >/dev/null 2>&1; then runner=bun
  else echo "load_env: neither node nor bun is installed" >&2; exit 1
  fi
  if ! exports="$(cd / && "$runner" "$loader" "$@")"; then
    echo "load_env: could not read settings from: $*" >&2
    exit 1
  fi
  eval "$exports"
}
