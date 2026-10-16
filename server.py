"""Local static server with the same read-only standings route used on Vercel.
Run: python3 server.py [port] (default 4173). No dependencies or credentials.
"""
import functools
import errno
import http.server
import json
from pathlib import Path
import sys
import threading
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
CACHE = {}
LOCK = threading.Lock()


def compact(data):
    rows = [r for r in data['rows'] if r.get('party', {}).get('participantType') == 'CONTESTANT'
            and not r['party'].get('ghost') and len(r['party'].get('members', [])) == 1]
    step = max(1, len(rows) // 200)
    fields = ['rank', 'points', 'penalty', 'successfulHackCount', 'unsuccessfulHackCount']
    return {
        'contest': {k: data['contest'].get(k) for k in ['id', 'name', 'type', 'phase', 'durationSeconds', 'startTimeSeconds', 'frozen']},
        'problems': [{k: p.get(k) for k in ['index', 'name', 'points']} for p in data['problems']],
        'rows': [dict(handle=r['party']['members'][0]['handle'], **{k: r.get(k, 0) for k in fields}) for r in rows],
        'samples': [dict(points=r['points'], penalty=r.get('penalty', 0), successfulHackCount=r.get('successfulHackCount', 0),
                         unsuccessfulHackCount=r.get('unsuccessfulHackCount', 0),
                         problemResults=[{k: p.get(k) for k in ['points', 'penalty', 'rejectedAttemptCount', 'type', 'bestSubmissionTimeSeconds']}
                                         for p in r['problemResults']]) for r in rows[::step][:250]],
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path != '/api/standings':
            return super().do_GET()
        params = urllib.parse.parse_qs(url.query)
        ids = params.get('contestId', [])
        if set(params) != {'contestId'} or len(ids) != 1 or not ids[0].isascii() or not ids[0].isdigit() or not 0 < int(ids[0]) < 10000000:
            return self.reply(400, {'error': 'Invalid contest ID.'})
        contest_id = int(ids[0])
        try:
            # Serialize cache misses; callers share finished standings for 24 hours.
            with LOCK:
                saved = CACHE.get(contest_id)
                if saved and time.time() - saved[0] < 86400:
                    result = saved[1]
                else:
                    request = urllib.request.Request(f'https://codeforces.com/api/contest.standings?contestId={contest_id}', headers={'User-Agent': 'Ranked-Practice/1.0'})
                    with urllib.request.urlopen(request, timeout=25) as response:
                        raw = response.read(50 * 1024 * 1024 + 1)
                    if len(raw) > 50 * 1024 * 1024:
                        raise ValueError('Standings response exceeds the supported size.')
                    payload = json.loads(raw)
                    if payload.get('status') != 'OK':
                        raise ValueError(payload.get('comment', 'Standings unavailable.'))
                    result = compact(payload['result'])
                    contest = result['contest']
                    if contest['id'] != contest_id or contest['phase'] != 'FINISHED' or contest.get('frozen'):
                        raise ValueError('Final public standings are required.')
                    if len(CACHE) >= 24:
                        CACHE.pop(next(iter(CACHE)))
                    CACHE[contest_id] = (time.time(), result)
            return self.reply(200, result)
        except Exception as error:
            return self.reply(502, {'error': str(error)})

    def reply(self, status, data):
        body = json.dumps(data, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    try:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
        if not 1 <= port <= 65535:
            raise ValueError()
    except ValueError:
        sys.exit('Use: python3 server.py [port from 1 to 65535]')
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=str(ROOT)))
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            sys.exit(f'Port {port} is already in use. Stop its existing server, or run: python3 server.py {port + 1 if port < 65535 else 4173}')
        raise
    print(f'Ranked: http://localhost:{port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
