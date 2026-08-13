#!/usr/bin/env python3
"""Probe the Plex transcode-decision endpoint under several client profiles.

Every call uses hasMDE=1, which returns the verdict WITHOUT opening a session,
so this is safe to run repeatedly against a server we don't own. It never hits
/start.m3u8 or any endpoint that would actually begin a stream.

    python3 probe.py --search "Dune"      # find a rating key
    python3 probe.py 12345                # run the matrix on that item
    python3 probe.py 12345 --audio 98765  # force a specific audio stream

stdlib only, on purpose — this runs on the laptop, not the TV.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

PLEX_TV = "https://plex.tv"
PRODUCT = "Reflex"
VERSION = "0.0.1"
CONFIG = os.path.join(
    os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")),
    "reflex", "probe.json",
)

# Keep these in sync with PROFILE in js/plex.js when a row wins.
BASE_PROFILE = "+".join([
    "add-direct-play-profile(type=videoProfile&container=mkv&codec=h264,hevc&audioCodec=aac,ac3,eac3,mp3)",
    "add-direct-play-profile(type=videoProfile&container=mp4&codec=h264,hevc&audioCodec=aac,ac3,eac3,mp3)",
])
LIMITS = "+".join([
    "add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=51&isRequired=false)",
    "add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.bitDepth&value=10&isRequired=false)",
])
WIDE_PROFILE = BASE_PROFILE + "+" + "+".join([
    "add-direct-play-profile(type=videoProfile&container=mkv&codec=vp9&audioCodec=aac,ac3,eac3,opus)",
    "add-direct-play-profile(type=videoProfile&container=mpegts&codec=h264&audioCodec=aac,ac3,eac3,mp3)",
])

# name -> extra/overriding decision params
ROWS = [
    ("bare",                {"X-Plex-Client-Profile-Extra": None}),
    ("base profile, lan",   {"X-Plex-Client-Profile-Extra": BASE_PROFILE}),
    ("base profile, wan",   {"X-Plex-Client-Profile-Extra": BASE_PROFILE, "location": "wan"}),
    ("base + limits",       {"X-Plex-Client-Profile-Extra": BASE_PROFILE + "+" + LIMITS}),
    ("wide profile",        {"X-Plex-Client-Profile-Extra": WIDE_PROFILE + "+" + LIMITS}),
    ("protocol=*",          {"X-Plex-Client-Profile-Extra": BASE_PROFILE, "protocol": "*"}),
    ("no directStream",     {"X-Plex-Client-Profile-Extra": BASE_PROFILE, "directStream": 0}),
    ("as Plex Web",         {"X-Plex-Client-Profile-Extra": BASE_PROFILE, "_product": "Plex Web",
                             "_platform": "Chrome"}),
]


# ---------- plumbing ----------

def load_config():
    try:
        with open(CONFIG) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    with open(CONFIG, "w") as fh:
        json.dump(cfg, fh, indent=2)


def server_headers(cfg, product=PRODUCT, platform="webOS"):
    """Headers for the media server itself.

    A server you do NOT own rejects the plex.tv account token with 401 — it
    wants the per-server accessToken from /api/v2/resources.
    """
    h = headers(cfg, product, platform)
    if cfg.get("server_token"):
        h["X-Plex-Token"] = cfg["server_token"]
    return h


def headers(cfg, product=PRODUCT, platform="webOS"):
    h = {
        "Accept": "application/json",
        "X-Plex-Product": product,
        "X-Plex-Version": VERSION,
        "X-Plex-Client-Identifier": cfg["client_id"],
        "X-Plex-Platform": platform,
        "X-Plex-Platform-Version": "4.0",
        "X-Plex-Device": "LG OLED B8",
        "X-Plex-Device-Name": "Reflex probe",
        "X-Plex-Device-Screen-Resolution": "1920x1080,3840x2160",
    }
    if cfg.get("token"):
        h["X-Plex-Token"] = cfg["token"]
    return h


def get(url, hdrs, timeout=20):
    req = urllib.request.Request(url, headers=hdrs, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    return json.loads(body) if body else None


def post(url, hdrs, timeout=20):
    req = urllib.request.Request(url, headers=hdrs, method="POST", data=b"")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    return json.loads(body) if body else None


# ---------- auth + discovery ----------

def ensure_token(cfg):
    if cfg.get("token"):
        return cfg
    # No strong=true: plex.tv/link only accepts the plain 4-character code.
    pin = post(PLEX_TV + "/api/v2/pins", headers(cfg))
    print("Go to plex.tv/link and enter:  %s" % pin["code"])
    deadline = time.time() + 900
    while time.time() < deadline:
        time.sleep(3)
        state = get(PLEX_TV + "/api/v2/pins/%s" % pin["id"], headers(cfg))
        if state.get("authToken"):
            cfg["token"] = state["authToken"]
            save_config(cfg)
            print("Linked.")
            return cfg
        sys.stdout.write(".")
        sys.stdout.flush()
    sys.exit("pin expired")


def ensure_server(cfg, prefer=None):
    """Pick a server. The account has more than one, and a rating key only
    means something on the server it came from, so --server matters."""
    cached_ok = cfg.get("base") and cfg.get("server_token")
    if cached_ok and prefer and prefer.lower() not in (cfg.get("server_name") or "").lower():
        cached_ok = False
    if cached_ok:
        try:
            get(cfg["base"] + "/identity", server_headers(cfg), timeout=6)
            print("Server: %s  %s" % (cfg.get("server_name"), cfg["base"]))
            return cfg
        except Exception:
            cfg.pop("base", None)

    resources = get(PLEX_TV + "/api/v2/resources?includeHttps=1&includeRelay=0", headers(cfg))
    found = []
    for res in resources:
        if "server" not in (res.get("provides") or ""):
            continue
        for conn in res.get("connections") or []:
            if conn.get("relay"):
                continue
            try:
                get(conn["uri"] + "/identity", headers(cfg), timeout=6)
            except Exception:
                continue
            found.append((res.get("name"), conn["uri"], res.get("accessToken")))
            break

    if not found:
        sys.exit("no direct server connection answered")

    print("Servers: %s" % ", ".join(name for name, _, _ in found))
    chosen = found[0]
    if prefer:
        matches = [f for f in found if prefer.lower() in (f[0] or "").lower()]
        if not matches:
            sys.exit("no server matching %r (have: %s)"
                     % (prefer, ", ".join(n for n, _, _ in found)))
        chosen = matches[0]

    cfg["server_name"], cfg["base"] = chosen[0], chosen[1]
    cfg["server_token"] = chosen[2] or cfg.get("token")
    save_config(cfg)
    print("Using:   %s  %s" % (cfg["server_name"], cfg["base"]))
    return cfg


# ---------- probing ----------

def search(cfg, term):
    url = cfg["base"] + "/search?" + urllib.parse.urlencode({"query": term, "limit": 20})
    res = get(url, server_headers(cfg))
    for md in (res.get("MediaContainer") or {}).get("Metadata") or []:
        media = (md.get("Media") or [{}])[0]
        print("%-8s %-55s %s %sx%s" % (
            md.get("ratingKey"), (md.get("title") or "")[:55], md.get("year") or "",
            media.get("width"), media.get("height")))


def describe(cfg, rating_key):
    res = get(cfg["base"] + "/library/metadata/%s" % rating_key, server_headers(cfg))
    md = ((res.get("MediaContainer") or {}).get("Metadata") or [None])[0]
    if not md:
        sys.exit("no such item")
    media = (md.get("Media") or [{}])[0]
    part = (media.get("Part") or [{}])[0]
    print("\n%s (%s)" % (md.get("title"), md.get("year")))
    print("  %sx%s  %s  %s  %.1f Mbps  %s" % (
        media.get("width"), media.get("height"), media.get("videoCodec"),
        media.get("container"), (media.get("bitrate") or 0) / 1000.0,
        os.path.basename(part.get("file") or "")))
    print("  streams:")
    for st in part.get("Stream") or []:
        if st.get("streamType") == 2:
            print("    audio  id=%-8s %-8s %sch  %-10s %s" % (
                st.get("id"), st.get("codec"), st.get("channels"),
                st.get("profile") or "", st.get("language") or ""))
        elif st.get("streamType") == 1:
            print("    video  id=%-8s %-8s %s %s" % (
                st.get("id"), st.get("codec"), st.get("profile") or "",
                st.get("bitDepth") and "%sbit" % st["bitDepth"] or ""))
    return md, media, part


def decide(cfg, rating_key, row_params, audio_id=None):
    params = {
        "hasMDE": 1,
        "path": "/library/metadata/%s" % rating_key,
        "mediaIndex": 0,
        "partIndex": 0,
        "protocol": "http",
        "directPlay": 1,
        "directStream": 1,
        "directStreamAudio": 1,
        "fastSeek": 1,
        "subtitles": "none",
        "audioBoost": 100,
        "autoAdjustQuality": 0,
        "mediaBufferSize": 102400,
        "location": "lan",
        "session": "probe-%s" % rating_key,
        # The transcode endpoints want the token in the URL, not only the
        # header — without it they answer 400, not 401.
        "X-Plex-Token": cfg.get("server_token") or cfg.get("token"),
    }
    if audio_id:
        params["audioStreamID"] = audio_id

    product, platform = PRODUCT, "webOS"
    for key, value in row_params.items():
        if key == "_product":
            product = value
        elif key == "_platform":
            platform = value
        elif value is None:
            params.pop(key, None)
        else:
            params[key] = value

    url = cfg["base"] + "/video/:/transcode/universal/decision?" + urllib.parse.urlencode(params)
    try:
        res = get(url, server_headers(cfg, product, platform))
    except urllib.error.HTTPError as exc:
        # The status alone is unexplainable; the server says why in the body.
        try:
            body = exc.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        body = " ".join(body.split())[:160]
        return "HTTP %s" % exc.code, body
    mc = res.get("MediaContainer") or {}
    md = (mc.get("Metadata") or [None])[0]
    part = None
    if md:
        part = (((md.get("Media") or [{}])[0]).get("Part") or [None])[0]
    decision = (part or {}).get("decision") or "unknown"
    text = mc.get("transcodeDecisionText") or mc.get("generalDecisionText") or \
        mc.get("mdeDecisionText") or ""
    streams = []
    for st in (part or {}).get("Stream") or []:
        if st.get("decision") and st.get("streamType") in (1, 2):
            streams.append("%s:%s" % ("v" if st["streamType"] == 1 else "a", st["decision"]))
    return decision, (" ".join(streams) + ("  " + text if text else "")).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("rating_key", nargs="?", help="library item to probe")
    ap.add_argument("--search", help="find rating keys by title")
    ap.add_argument("--audio", help="force this audio stream id on every row")
    ap.add_argument("--server", help="which server, by name (there is more than one)")
    args = ap.parse_args()

    cfg = load_config()
    if "client_id" not in cfg:
        cfg["client_id"] = "reflex-probe-%d" % int(time.time())
        save_config(cfg)
    cfg = ensure_token(cfg)
    cfg = ensure_server(cfg, args.server)

    if args.search:
        search(cfg, args.search)
        return
    if not args.rating_key:
        ap.error("give a rating key, or --search")

    describe(cfg, args.rating_key)

    print("\n%-22s %-14s %s" % ("profile row", "decision", "streams / reason"))
    print("-" * 100)
    for name, row in ROWS:
        decision, detail = decide(cfg, args.rating_key, row, args.audio)
        mark = "OK " if decision == "directplay" else "   "
        print("%s%-19s %-14s %s" % (mark, name, decision, detail[:70]))
        time.sleep(0.3)          # be a polite guest on someone else's server


if __name__ == "__main__":
    main()
