#!/bin/sh
# Install root:root 0755. authorized_keys forces this command; no shell passthrough.
set -eu
set -f
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
# Word splitting only: no eval, command substitution or user-controlled options.
command=${SSH_ORIGINAL_COMMAND-}
case "$command" in
  *[!a-zA-Z0-9._\ -]*) echo 'Invalid deployment command' >&2; exit 64 ;;
esac
set -- $command
case "${1-}:$#" in
  deploy:4)
    exec /usr/bin/sudo -n /usr/local/libexec/journey/deploy-release.py receive "$2" "$3" "$4"
    ;;
  status:2)
    exec /usr/bin/sudo -n /usr/local/libexec/journey/deploy-release.py status "$2"
    ;;
  *) echo 'Expected deploy ID SHA256 COMMIT or status ID' >&2; exit 64 ;;
esac
