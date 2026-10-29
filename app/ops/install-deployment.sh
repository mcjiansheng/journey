#!/bin/bash
# Run once as an administrator; application deployments never update these files.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
if [[ $EUID != 0 || $# != 1 ]]; then
  echo 'Usage (root): install-deployment.sh /path/to/deploy-key.pub' >&2
  exit 2
fi
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
public_key=$(cat -- "$1")
if [[ ! $public_key =~ ^ssh-ed25519\ [A-Za-z0-9+/]+={0,3}(\ [a-zA-Z0-9@._-]+)?$ ]]; then
  echo 'Expected one Ed25519 public key' >&2
  exit 2
fi
for file in deploy-release.py deploy-ssh.sh backup.mjs journey-backup.service; do
  test -f "$source_dir/$file"
done
test -L /opt/journey/current
getent passwd journey >/dev/null
deploy_user=${DEPLOY_USER:-journey-deploy}
if [[ ! $deploy_user =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo 'Invalid deployment user' >&2
  exit 2
fi
deploy_home="/var/lib/${deploy_user}"
if ! id "$deploy_user" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$deploy_home" --shell /bin/bash "$deploy_user"
fi
install -d -o root -g root -m 0755 /usr/local/libexec/journey "$deploy_home" "$deploy_home/.ssh"
install -o root -g root -m 0755 "$source_dir/deploy-release.py" /usr/local/libexec/journey/deploy-release.py
install -o root -g root -m 0755 "$source_dir/deploy-ssh.sh" /usr/local/libexec/journey/deploy-ssh.sh
install -o root -g root -m 0644 "$source_dir/backup.mjs" /usr/local/libexec/journey/backup.mjs
install -o root -g root -m 0644 "$source_dir/journey-backup.service" /etc/systemd/system/journey-backup.service
printf 'restrict,command="/usr/local/libexec/journey/deploy-ssh.sh" %s\n' "$public_key" > "$deploy_home/.ssh/authorized_keys"
chown root:root "$deploy_home/.ssh/authorized_keys"
chmod 0644 "$deploy_home/.ssh/authorized_keys"
sudoers_file=$(mktemp)
trap 'rm -f "$sudoers_file"' EXIT
cat > "$sudoers_file" <<RULES
${deploy_user} ALL=(root) NOPASSWD: /usr/local/libexec/journey/deploy-release.py receive *, /usr/local/libexec/journey/deploy-release.py status *
RULES
visudo -cf "$sudoers_file"
install -o root -g root -m 0440 "$sudoers_file" /etc/sudoers.d/journey-deploy
systemctl daemon-reload
echo 'Journey deployment account and fixed administrator scripts installed.'
