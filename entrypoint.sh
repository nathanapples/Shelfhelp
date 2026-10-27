#!/bin/sh
# linuxserver-style startup: run as PUID/PGID, honour TZ and UMASK.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
CONFIG_DIR="${CONFIG_DIR:-/config}"

if [ -n "$TZ" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
    ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime
    echo "$TZ" > /etc/timezone
fi

[ -n "$UMASK" ] && umask "$UMASK"

mkdir -p "$CONFIG_DIR"

if [ "$(id -u)" = "0" ]; then
    echo "shelfhelp: running as uid=$PUID gid=$PGID, TZ=${TZ:-UTC}"
    chown -R "$PUID:$PGID" "$CONFIG_DIR" 2>/dev/null || true
    exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups --inh-caps=-all env HOME="$CONFIG_DIR" "$@"
fi

exec "$@"
