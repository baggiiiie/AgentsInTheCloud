#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then set -- bun run apps/web/src/server/main.ts; fi

agents_in_the_cloud_uid=1000
agents_in_the_cloud_gid=1000

if ! getent group "$agents_in_the_cloud_gid" >/dev/null; then
  groupadd --gid "$agents_in_the_cloud_gid" agents-in-the-cloud
fi
if ! getent passwd "$agents_in_the_cloud_uid" >/dev/null; then
  useradd --uid "$agents_in_the_cloud_uid" --gid "$agents_in_the_cloud_gid" --create-home --shell /bin/bash agents-in-the-cloud
fi
agents_in_the_cloud_user="$(getent passwd "$agents_in_the_cloud_uid" | cut -d: -f1)"

for socket in /var/run/docker.sock /run/containerd/containerd.sock; do
  [ -S "$socket" ] || continue
  docker_gid="$(stat -c '%g' "$socket")"
  if ! getent group "$docker_gid" >/dev/null; then
    groupadd --gid "$docker_gid" docker-host
  fi
  docker_group="$(getent group "$docker_gid" | cut -d: -f1)"
  usermod -aG "$docker_group" "$agents_in_the_cloud_user"
done

agents_in_the_cloud_data_dir=/data/app
mkdir -p "$agents_in_the_cloud_data_dir/proxy"
# Ensure app state and shared cache can be managed by the app user.
chown "$agents_in_the_cloud_uid:$agents_in_the_cloud_gid" "$agents_in_the_cloud_data_dir" "$agents_in_the_cloud_data_dir/proxy" /data/erofs-cache

printf '%s ALL=(root) NOPASSWD: /usr/local/bin/agents-in-the-cloud-tailscale-serve-helper\n' "$agents_in_the_cloud_user" >/etc/sudoers.d/agents-in-the-cloud-tailscale-serve
chmod 440 /etc/sudoers.d/agents-in-the-cloud-tailscale-serve

HOME="$(getent passwd "$agents_in_the_cloud_uid" | cut -d: -f6)"
export HOME
exec gosu "$agents_in_the_cloud_user" "$@"
