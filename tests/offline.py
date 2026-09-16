"""Verify offline caching against a stopped origin, not browser network emulation."""
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from playwright.sync_api import expect


def verify_offline(browser):
    root = Path(__file__).resolve().parent.parent
    if not (root / 'dist/index.html').is_file():
        raise RuntimeError('Run npm run build before the full browser suite.')
    with tempfile.TemporaryDirectory(prefix='code-design-offline-') as folder:
        shutil.copytree(root / 'dist', Path(folder) / 'ClaudeCodeDesign')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        url = f'http://127.0.0.1:{port}/ClaudeCodeDesign/'
        env = {**os.environ, 'PORT': str(port), 'SERVE_DIR': folder}
        with open(Path(folder) / 'server.log', 'w') as log:
            server = subprocess.Popen(['node', str(root / 'scripts/serve.mjs')], env=env, stdout=log, stderr=log)
            context = None
            try:
                for attempt in range(100):
                    try:
                        with urllib.request.urlopen(url, timeout=1) as response:
                            if response.status == 200:
                                break
                    except (urllib.error.URLError, ConnectionError):
                        if server.poll() is not None:
                            raise RuntimeError('Offline-test origin failed to start.')
                        time.sleep(.05)
                else:
                    raise RuntimeError('Offline-test origin did not become available.')
                context = browser.new_context(viewport={'width':1280, 'height':900}, reduced_motion='reduce')
                page = context.new_page()
                page.goto(url)
                page.evaluate('navigator.serviceWorker.ready.then(() => true)')
                page.reload()
                for attempt in range(50):
                    if page.evaluate('() => navigator.serviceWorker.controller !== null'):
                        break
                    page.wait_for_timeout(100)
                else:
                    raise AssertionError('The real service worker did not take control.')
                # Stop only the child origin created by this test. The requested
                # website and the main acceptance server are left untouched.
                server.terminate()
                server.wait(timeout=5)
                assert page.evaluate("fetch(new URL('uncached-network-probe', location.href)).then(() => false, () => true)"), 'Origin unexpectedly remained reachable.'
                page.reload(wait_until='domcontentloaded')
                expect(page.locator('h1')).to_contain_text('Great ideas')
                page.evaluate("location.hash = 'files'")
                expect(page.locator('#editor')).to_be_visible()
                page.locator('#editor').fill('<!-- Edited while the origin is stopped. -->')
                page.wait_for_timeout(650)
                page.reload(wait_until='domcontentloaded')
                expect(page.locator('#editor')).to_have_value('<!-- Edited while the origin is stopped. -->')
                return {'origin_stopped': True, 'uncached_request_failed': True, 'shell_reloaded': True, 'offline_edit_persisted': True}
            finally:
                if context:
                    context.close()
                if server.poll() is None:
                    server.terminate()
                    try:
                        server.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait(timeout=5)
