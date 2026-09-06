#!/usr/bin/env python3
"""KoSIT sidecar HTTP — official JAR only. No Peppol. Bind 0.0.0.0."""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CACHE = Path(os.environ.get("KOSIT_CACHE", "/work/cache"))
JAR = CACHE / "validator-1.6.2.jar"
SCENARIOS = CACHE / "cfg" / "scenarios.xml"
CFG = CACHE / "cfg"
MAX_XML = 2 * 1024 * 1024
PORT = int(os.environ.get("KOSIT_PORT", "18080"))


def parse_kosit_stdout(text: str, rc: int) -> dict:
    rejected_n = None
    m = re.search(r"Rejected:\s+(\d+)", text)
    if m:
        rejected_n = int(m.group(1))
    ok = rc == 0 and (
        "Validation successful!" in text or rejected_n == 0
    )
    if rejected_n is not None and rejected_n > 0:
        ok = False
    return {
        "ok": ok,
        "verdict": "ACCEPTABLE" if ok else "REJECTED",
        "rejected": rejected_n,
        "returncode": rc,
        "excerpt": text[-4000:],
    }


def ready() -> bool:
    return JAR.is_file() and SCENARIOS.is_file()


def run_validator(xml_bytes: bytes) -> dict:
    if not ready():
        return {
            "ok": False,
            "verdict": "UNAVAILABLE",
            "detail": "KoSIT JAR oder scenarios.xml fehlt (Download fehlgeschlagen).",
        }
    with tempfile.TemporaryDirectory(prefix="kosit-") as tmp:
        xml_path = Path(tmp) / "invoice.xml"
        reports = Path(tmp) / "reports"
        reports.mkdir()
        xml_path.write_bytes(xml_bytes)
        proc = subprocess.run(
            [
                "java",
                "-jar",
                str(JAR),
                "-s",
                str(SCENARIOS),
                "-r",
                str(CFG),
                "-o",
                str(reports),
                str(xml_path),
            ],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        text = (proc.stdout or "") + "\n" + (proc.stderr or "")
        return parse_kosit_stdout(text, proc.returncode)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("kosit " + (fmt % args) + "\n")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] in ("/health", "/"):
            self._json(
                200 if ready() else 503,
                {"ready": ready(), "jar": JAR.is_file(), "scenarios": SCENARIOS.is_file()},
            )
            return
        self._json(404, {"detail": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/validate":
            self._json(404, {"detail": "not found"})
            return
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > MAX_XML:
            self._json(413, {"detail": "XML fehlt oder groesser als 2 MiB"})
            return
        raw = self.rfile.read(length)
        if not raw.lstrip().startswith(b"<"):
            self._json(400, {"detail": "Body ist kein XML"})
            return
        try:
            result = run_validator(raw)
        except subprocess.TimeoutExpired:
            self._json(504, {"ok": False, "verdict": "TIMEOUT", "detail": "KoSIT > 90 s"})
            return
        self._json(200 if result.get("ok") else 422, result)


def main() -> None:
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"kosit sidecar 0.0.0.0:{PORT} ready={ready()}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
