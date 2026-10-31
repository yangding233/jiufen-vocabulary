"""Build this private repository using an existing Git Credential Manager login.

Credentials remain in memory and are sent only to api.github.com. This helper
never creates tokens, changes repository visibility, or handles Apple secrets.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["info", "workflows", "dispatch", "runs", "jobs", "artifacts", "log", "download"])
    parser.add_argument("--repository", default="yangding233/jiufen-vocabulary")
    parser.add_argument("--id", type=int)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository):
        raise ValueError("Expected a GitHub owner/repository name")
    result = subprocess.run(
        ["git", "-c", "credential.interactive=false", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n", text=True,
        capture_output=True, timeout=30,
    )
    credentials = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if result.returncode or not credentials.get("password"):
        raise ValueError("GitHub login is unavailable in Git Credential Manager. Sign in with Git first.")
    opener = urllib.request.build_opener(NoRedirect)
    headers = {"Authorization": "Bearer " + credentials["password"], "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Jiufen-local-build"}
    base = "https://api.github.com/repos/" + args.repository

    def request(path="", data=None):
        body = json.dumps(data).encode("utf-8") if data is not None else None
        request_headers = dict(headers)
        if body is not None:
            request_headers["Content-Type"] = "application/json"
        return opener.open(urllib.request.Request(base + path, data=body, headers=request_headers), timeout=45)

    def api(path="", data=None):
        with request(path, data) as response:
            content = response.read()
            return json.loads(content) if content else {"accepted": True, "status": response.status}

    info = api()
    if not info.get("private"):
        raise ValueError("This helper requires the intended private repository. No build started.")
    if args.command == "info":
        output = {key: info.get(key) for key in ["full_name", "private", "default_branch", "size", "permissions"]}
    elif args.command == "workflows":
        output = [{key: item.get(key) for key in ["id", "name", "path", "state"]} for item in api("/actions/workflows")["workflows"]]
    elif args.command == "dispatch":
        output = api("/actions/workflows/build-ios.yml/dispatches", {"ref": "main"})
    elif args.command == "runs":
        output = [{key: item.get(key) for key in ["id", "run_number", "status", "conclusion", "head_sha", "html_url", "created_at"]} for item in api("/actions/workflows/build-ios.yml/runs?per_page=5")["workflow_runs"]]
    else:
        if args.id is None or args.id <= 0:
            raise ValueError("This command requires --id")
        if args.command == "jobs":
            output = [{key: item.get(key) for key in ["id", "name", "status", "conclusion", "steps"]} for item in api(f"/actions/runs/{args.id}/jobs")["jobs"]]
        elif args.command == "artifacts":
            output = [{key: item.get(key) for key in ["id", "name", "size_in_bytes", "expired", "digest"]} for item in api(f"/actions/runs/{args.id}/artifacts")["artifacts"]]
        else:
            if not args.output:
                raise ValueError("This command requires --output")
            endpoint = f"/actions/jobs/{args.id}/logs" if args.command == "log" else f"/actions/artifacts/{args.id}/zip"
            try:
                stream = request(endpoint)
            except urllib.error.HTTPError as error:
                if error.code not in (301, 302, 303, 307, 308):
                    raise
                location = error.headers.get("Location", "")
                target = urllib.parse.urlsplit(location)
                host = target.hostname or ""
                if target.scheme != "https" or target.username or target.password or not (
                    host.endswith(".githubusercontent.com") or host.endswith(".blob.core.windows.net")
                    or host.endswith(".github.com") or host.endswith(".actions.githubusercontent.com")
                ):
                    raise ValueError("Unexpected artifact download host; credentials were not forwarded")
                # A pre-signed storage URL must receive no GitHub authorization.
                stream = urllib.request.urlopen(location, timeout=60)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            with stream, args.output.open("xb") as destination:
                shutil.copyfileobj(stream, destination)
            output = {"saved": str(args.output), "bytes": args.output.stat().st_size}
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        try:
            message = json.loads(error.read()).get("message", "GitHub request failed")
        except Exception:
            message = "GitHub request failed"
        print(json.dumps({"error": message, "status": error.code}), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
