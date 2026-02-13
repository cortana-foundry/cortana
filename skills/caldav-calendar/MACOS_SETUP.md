# CalDAV Calendar skill — macOS setup notes

This skill is marked Linux/apt in its metadata, but it works fine on macOS by installing the required CLIs via pipx.

## Install dependencies (macOS)

```bash
brew install pipx
pipx ensurepath
# open a new terminal or ensure ~/.local/bin is on PATH
export PATH="$HOME/.local/bin:$PATH"

pipx install vdirsyncer
pipx install khal
```

Verify:
```bash
vdirsyncer --version
khal --version
```

## Config locations
- vdirsyncer: `~/.config/vdirsyncer/config`
- khal: `~/.config/khal/config`
- Local calendars (default): `~/.local/share/vdirsyncer/calendars/`

## First sync
```bash
vdirsyncer discover
vdirsyncer sync
khal list today 7d
```
