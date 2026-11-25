import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from base64 import b64decode
from pathlib import Path

endpoint = "http://127.0.0.1:4444"
archive = Path(sys.argv[1]).resolve()
application = Path(sys.argv[2]).resolve()
screens = Path(sys.argv[3])
screens.mkdir(parents=True, exist_ok=True)
config = Path(os.environ["XDG_CONFIG_HOME"]) / "ppm"
config.mkdir(parents=True, exist_ok=True)
(config / "config.json").write_text(json.dumps({"archivePath": str(archive)}))


def request(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(endpoint + path, data=body, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return json.load(response)["value"]
    except urllib.error.HTTPError as exc:
        raise RuntimeError(exc.read().decode()) from exc


def until(fn):
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(0.2)
    raise TimeoutError(fn)


driver = subprocess.Popen(["tauri-driver", "--native-driver", "/usr/bin/WebKitWebDriver"])
session = None
try:
    def ready():
        try:
            return request("GET", "/status")
        except (OSError, RuntimeError):
            return False

    until(ready)
    session_id = request("POST", "/session", {"capabilities": {"alwaysMatch": {
        "tauri:options": {"application": str(application)}}}})["sessionId"]
    session = "/session/" + session_id

    def script(js, *args):
        return request("POST", session + "/execute/sync", {"script": js, "args": list(args)})

    def click(label):
        els = until(lambda: request("POST", session + "/elements", {
            "using": "xpath", "value": "//button[normalize-space(.)='" + label + "' and not(@disabled)]"}))
        key = els[0]["element-6066-11e4-a52e-4f735466cecf"]
        request("POST", session + "/element/" + key + "/click", {})

    def check_buttons():
        missing = script("""
          return [...document.querySelectorAll('button')].filter(b => !b.textContent.trim()
            && !(b.getAttribute('aria-label')?.trim() && b.title.trim())).map(b => b.outerHTML)
        """)
        assert not missing, missing

    click("Åbn seneste arkiv")
    click("Fortsæt")
    until(lambda: script("return !!document.querySelector('.spending')"))
    check_buttons()
    (screens / "overblik.png").write_bytes(b64decode(request("GET", session + "/screenshot")))
    click("Madplan")
    until(lambda: script("return document.querySelector('main').innerText.includes('Kartoffelsuppe')"))
    check_buttons()
    (screens / "madplan.png").write_bytes(b64decode(request("GET", session + "/screenshot")))
    click("Uge")
    until(lambda: script("return document.querySelector('main').innerText.includes('Allergi') || document.querySelector('main').innerText.includes('Mælk')"))
    check_buttons()
    click("Indkøbsliste")
    click("Lav indkøbsliste for ugen")
    until(lambda: script("return document.querySelector('main').innerText.includes('kartofler')"))
    check_buttons()
    click("Opskrifter")
    click("Tilføj startkatalog")
    until(lambda: script("return document.querySelector('main').innerText.includes('Tomatsuppe')"))
    sections = script("return [...document.querySelectorAll('nav button:has(.module-icon)')].map(b => b.textContent.trim())")
    for label in sections:
        click(label)
        until(lambda: script("return document.querySelector('main h1')?.textContent.trim() === arguments[0]", label))
        check_buttons()
finally:
    try:
        if session:
            request("DELETE", session)
    finally:
        driver.terminate()
        driver.wait(timeout=10)
