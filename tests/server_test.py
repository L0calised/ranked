"""Local proxy integration checks; no upstream network access or CF account writes."""
import functools
import http.client
import io
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class QuietHandler(server.Handler):
    def log_message(self, *_args):
        pass


class ProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = server.http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(server.ROOT)))
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def setUp(self):
        server.CACHE.clear()

    def get(self, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=5)
        try:
            connection.request('GET', path)
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_static_site(self):
        status, body = self.get('/')
        self.assertEqual(status, 200)
        self.assertIn(b'Your Codeforces handle', body)

    def test_invalid_ids_do_not_fetch(self):
        with patch.object(server.urllib.request, 'urlopen') as fetch:
            for query in ['', '?contestId=0', '?contestId=-1', '?contestId=42&contestId=43', '?contestId=42&url=x']:
                self.assertEqual(self.get('/api/standings' + query)[0], 400)
            fetch.assert_not_called()

    def test_compact_results_are_cached_and_match_requested_contest(self):
        data = {'contest': {'id': 42, 'phase': 'FINISHED'}, 'problems': [{'index': 'A', 'name': 'Task'}],
                'rows': [{'party': {'participantType': 'CONTESTANT', 'members': [{'handle': 'Example'}]},
                          'rank': 1, 'points': 500, 'problemResults': []}]}
        def upstream(request, **_kwargs):
            self.assertEqual(request.full_url, 'https://codeforces.com/api/contest.standings?contestId=42')
            return io.BytesIO(json.dumps({'status': 'OK', 'result': data}).encode())
        with patch.object(server.urllib.request, 'urlopen', side_effect=upstream) as fetch:
            status, body = self.get('/api/standings?contestId=42')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['rows'][0]['handle'], 'Example')
            self.assertEqual(self.get('/api/standings?contestId=42')[0], 200)
            self.assertEqual(fetch.call_count, 1)
        data['contest']['id'] = 43
        server.CACHE.clear()
        with patch.object(server.urllib.request, 'urlopen', side_effect=upstream):
            self.assertEqual(self.get('/api/standings?contestId=42')[0], 502)
        self.assertFalse(server.CACHE)

    def test_upstream_failure_returns_json_error(self):
        with patch.object(server.urllib.request, 'urlopen', side_effect=TimeoutError('Timed out')):
            status, body = self.get('/api/standings?contestId=42')
        self.assertEqual(status, 502)
        self.assertEqual(json.loads(body)['error'], 'Timed out')
