#!/usr/bin/env bash
# MKMA TV — turns a fresh Debian install into a kiosk that boots straight
# into the academy display. Safe to run again (e.g. to install an update).
#
# Usage (from the unpacked mkma-tv folder):   sudo bash setup/setup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Please run with sudo:  sudo bash setup/setup.sh"; exit 1; fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/mkma-tv
DATA=/var/lib/mkma-tv
KIOSK_USER=kiosk
HOSTNAME_WANTED="${MKMA_HOSTNAME:-academy-tv}"
PORT="${MKMA_PORT:-8080}"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

say "Installing packages (this takes a few minutes on the NUC)"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  nodejs cage chromium ffmpeg curl ca-certificates \
  avahi-daemon libnss-mdns unattended-upgrades \
  fonts-lato fonts-noto-core fonts-noto-color-emoji \
  mesa-va-drivers libgl1-mesa-dri
# Hardware video decoding for the NUC's Intel graphics (Bay Trail).
apt-get install -y --no-install-recommends i965-va-driver || echo "(i965 driver not available — videos will use software decoding)"
# Wi-Fi firmware for the NUC's Intel 7260 card (only matters if you use Wi-Fi).
apt-get install -y firmware-iwlwifi 2>/dev/null || true

NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
if [ "$NODE_MAJOR" -lt 18 ]; then echo "Node.js 18 or newer is needed (found $(node -v)). Use Debian 12 or 13."; exit 1; fi

say "Creating the kiosk user"
if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$KIOSK_USER"
fi
for g in video render input audio; do getent group "$g" >/dev/null && usermod -aG "$g" "$KIOSK_USER"; done

say "Installing the app to $APP"
mkdir -p "$APP" "$DATA/data" "$DATA/media"
if [ "$SRC" != "$APP" ]; then
  rm -rf "$APP/public"
  cp -r "$SRC/server.js" "$SRC/package.json" "$SRC/public" "$SRC/setup" "$APP/"
fi
chmod +x "$APP/setup/kiosk-session.sh"
chown -R "$KIOSK_USER:$KIOSK_USER" "$DATA"

say "Setting up the background service"
cat > /etc/systemd/system/mkma-tv.service <<EOF
[Unit]
Description=MKMA TV signage server
After=network.target

[Service]
User=$KIOSK_USER
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA/data
Environment=MEDIA_DIR=$DATA/media
WorkingDirectory=$APP
ExecStart=/usr/bin/node $APP/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

say "Making the NUC log in automatically and open the display"
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
cat > "/home/$KIOSK_USER/.bash_profile" <<EOF
# Start the TV display on the main screen only (not over SSH)
if [ "\$(tty)" = "/dev/tty1" ]; then
  exec $APP/setup/kiosk-session.sh
fi
EOF
chown "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/.bash_profile"
echo "PORT=$PORT" > "$APP/setup/kiosk.env"

say "Network name: $HOSTNAME_WANTED.local"
if [ "$(hostname)" != "$HOSTNAME_WANTED" ]; then
  hostnamectl set-hostname "$HOSTNAME_WANTED"
  sed -i "s/127\.0\.1\.1.*/127.0.1.1\t$HOSTNAME_WANTED/" /etc/hosts || true
  grep -q "127.0.1.1" /etc/hosts || echo -e "127.0.1.1\t$HOSTNAME_WANTED" >> /etc/hosts
fi
systemctl enable --now avahi-daemon

say "Automatic security updates + nightly restart at 04:30"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/systemd/system/mkma-reboot.service <<EOF
[Unit]
Description=Nightly restart of the MKMA TV kiosk
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl reboot
EOF
cat > /etc/systemd/system/mkma-reboot.timer <<EOF
[Unit]
Description=Restart the kiosk every night
[Timer]
OnCalendar=*-*-* 04:30
[Install]
WantedBy=timers.target
EOF

say "Quieter, faster boot"
if [ -f /etc/default/grub ]; then
  sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=1/' /etc/default/grub
  grep -q consoleblank=0 /etc/default/grub || sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 consoleblank=0"/' /etc/default/grub
  update-grub || true
fi

systemctl daemon-reload
systemctl enable mkma-tv.service mkma-reboot.timer
systemctl restart mkma-tv.service
systemctl start mkma-reboot.timer

IP="$(hostname -I | awk '{print $1}')"
say "Done!"
echo "  Admin page:  http://$HOSTNAME_WANTED.local:$PORT/admin"
echo "           or  http://$IP:$PORT/admin"
echo
echo "  Restart the NUC now to start the display:   sudo reboot"
