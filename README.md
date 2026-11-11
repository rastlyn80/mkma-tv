# MKMA TV

A lightweight replacement for Xogo. The NUC boots straight into a full-screen display. You manage what's on it from any phone, iPad or laptop on the academy network.

- **TV display:** `http://academy-tv.local:8080/display` (opens automatically on the NUC)
- **Admin:** `http://academy-tv.local:8080/admin`

## What it does

- **Playlist.** Photos, videos and slides play in the order you set (drag ⠿ to reorder), then loop. Each item has an on/off switch.
- **Per-item timing.** Seconds on screen (0 = the default, or the full length for videos), days of the week, and optional from/until dates. One "Monday lessons" slide set to Mondays only covers every Monday.
- **Slide editor.** Five ready-made styles; blocks for heading, text, lessons table, picture/logo, line and space; optional background photo with darkening; a live preview that matches the TV exactly. Templates: *Today's lessons*, *Announcement*, *Welcome*, *Blank*.
- **Placeholders.** `{date}`, `{day}` and `{academy}` fill themselves in.
- **Live updates.** Saving in the admin updates the TV within a couple of seconds.
- **Light on the NUC.** Photos are resized on your phone/iPad before upload, and videos are checked on upload (H.264 MP4 recommended).
- **Opening hours.** Optionally black the screen out overnight (Settings).
- **Low maintenance.** Automatic security updates, a nightly restart at 04:30, and self-restart if anything crashes.

## Setting up the NUC

### Before you start

1. **Update the NUC's BIOS.** The DN2820FYK's original firmware is known to be fussy with Linux. Get the latest BIOS for "DN2820FYK" (Intel's old downloads are mirrored on ASUS's NUC support site), put it on a USB stick, and press **F7** at boot to flash it.
2. **Optional but worthwhile.** Upgrade to 4 GB of DDR3L RAM and/or a cheap 2.5" SATA SSD.
3. **Prefer an Ethernet cable** over Wi-Fi for the TV, if there's a socket nearby.

### 1. Install Debian (about 20 minutes)

1. Download the **Debian netinst** image (amd64) from debian.org and write it to a USB stick (balenaEtcher or Rufus).
2. Boot the NUC from the stick (**F10** at power-on for the boot menu).
3. Choose **Install** (the text installer is fine). Then:
   - **Hostname:** `academy-tv`
   - **Root password:** leave empty. Your own user then gets admin rights through `sudo`.
   - **Create a user for yourself**, e.g. `gabriele`.
   - **Partitioning:** guided, use entire disk.
   - **Software selection:** untick *Debian desktop environment* and *GNOME*. Tick **SSH server** and **standard system utilities**.
4. Remove the USB stick and reboot. Log in with your user.

With SSH installed, you can do everything from here on from your iPad with an SSH app (Termius, Blink…): `ssh gabriele@academy-tv.local`.

### 2. Copy this folder onto the NUC

**Option A: USB stick.** Copy the unzipped `mkma-tv` folder onto a stick, plug it into the NUC, then run:

```bash
sudo mount /dev/sdb1 /mnt          # if this fails, run: lsblk  to find the stick
cp -r /mnt/mkma-tv ~/
sudo umount /mnt
```

**Option B: GitHub.** If the folder is in a GitHub repo:

```bash
sudo apt install -y git
git clone https://github.com/<you>/mkma-tv.git ~/mkma-tv
```

### 3. Run the setup

```bash
cd ~/mkma-tv
sudo bash setup/setup.sh
sudo reboot
```

After the reboot, the TV shows the academy name and the admin address.

### 4. First use

Open `http://academy-tv.local:8080/admin` on your iPad and choose an admin password. Then add photos and create your first *Today's lessons* slide.

If `.local` names don't work on a device (some Android phones), use the IP address shown on the TV instead.

## Updating later

Copy the new version of the folder to the NUC the same way, then run `sudo bash setup/setup.sh` again. Your playlist, photos and password are kept in `/var/lib/mkma-tv` and are not touched by updates.

## Backups

Everything lives in `/var/lib/mkma-tv`. To back it up, from a laptop on the same network:

```bash
scp -r gabriele@academy-tv.local:/var/lib/mkma-tv ./mkma-tv-backup
```

## Videos

This NUC plays **H.264 MP4 at 720p** smoothly, and 1080p usually works. 4K and iPhone HEVC files won't play smoothly. Convert them first with HandBrake (free; "Fast 720p30" preset), or on an iPhone export at 720p/1080p with *Most Compatible* format.

Video sound is off by default. Switch it on per video in the editor.

## Troubleshooting

| Problem | Fix |
|---|---|
| Can't open the admin page | Make sure the device is on the same Wi-Fi/network as the NUC. Try the IP address shown on the TV. |
| TV shows a black screen | Check *Settings → Opening hours*. Otherwise SSH in and run `sudo systemctl restart getty@tty1` |
| See what the server is doing | `journalctl -u mkma-tv -f` |
| Forgot the admin password | `sudo rm /var/lib/mkma-tv/data/auth.json && sudo systemctl restart mkma-tv`, then set a new one in the admin page |
| Get to a normal terminal on the NUC | Press **Ctrl+Alt+F2** and log in with your own user (**Ctrl+Alt+F1** goes back to the display) |

## Security note

The admin page is password-protected and meant for the academy's own network. Don't open port 8080 to the internet on the router.

## Running it on any computer (for testing)

You need Node.js 18 or newer. There are no packages to install.

```bash
node server.js
# then open http://localhost:8080/admin and http://localhost:8080/display
```
