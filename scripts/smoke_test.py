#!/usr/bin/env python3
"""Check that a refactor did not change what the app does.

Runs the same guest-mode session (scripts/smoke_test.js) in headless Chrome against two copies
of the app: a git ref (default HEAD) and the working tree. It then compares what each one
rendered and saved, step by step. Use it after any change that should not alter behaviour:

    python3 scripts/smoke_test.py              # HEAD against the working tree
    python3 scripts/smoke_test.py --base main  # another ref against the working tree

"SAME" on every step and no errors means the two behave alike for this session. A deliberate
change to the UI will show as DIFF; read the excerpt and judge. It covers guest mode on a
phone-sized window only: not Google sign-in, the guest merge, or the desktop layout.

Needs Google Chrome (set CHROME to its path if it is not in the usual macOS place) and a
network connection (supabase-js from the CDN, and the standard foods). Standard library only.
"""
import argparse, functools, html, http.server, json, os, re, shutil, subprocess, sys, tempfile, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
APP_FILES = ['index.html', 'styles.css', 'js', 'caltal-icon.png']


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass


def prepare(tmp, base):
    old, new = os.path.join(tmp, 'old'), os.path.join(tmp, 'new')
    os.makedirs(old); os.makedirs(new)
    archive = subprocess.run(['git', '-C', ROOT, 'archive', base], capture_output=True, check=True).stdout
    subprocess.run(['tar', '-x', '-C', old], input=archive, check=True)
    for name in APP_FILES:
        src = os.path.join(ROOT, name)
        if os.path.isdir(src): shutil.copytree(src, os.path.join(new, name))
        elif os.path.exists(src): shutil.copy(src, new)
    for d in (old, new):
        shutil.copy(os.path.join(ROOT, 'scripts', 'smoke_test.js'), os.path.join(d, '__smoke_test.js'))
        page = os.path.join(d, 'index.html')
        text = open(page, encoding='utf-8').read()
        i = text.rindex('</body>')
        open(page, 'w', encoding='utf-8').write(text[:i] + '<script src="__smoke_test.js"></script>\n' + text[i:])


def run(tmp, which, port):
    dom = subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-first-run',
                          f'--user-data-dir={os.path.join(tmp, "profile-" + which)}', '--window-size=420,900',
                          '--virtual-time-budget=60000', '--dump-dom', f'http://localhost:{port}/{which}/index.html'],
                         capture_output=True, text=True).stdout
    m = re.search(r'<pre id="__out">(.*?)</pre>', dom, re.S)
    if not m: sys.exit(f'{which}: the test did not finish (no output in the page). Is the network up?')
    return json.loads(html.unescape(m.group(1)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--base', default='HEAD', help='git ref to compare the working tree against (default HEAD)')
    ap.add_argument('--port', type=int, default=8765)
    args = ap.parse_args()
    if not os.path.exists(CHROME): sys.exit(f'Chrome not found at {CHROME}. Set CHROME to its path.')

    tmp = tempfile.mkdtemp(prefix='caltal-smoke-')
    try:
        prepare(tmp, args.base)
        handler = functools.partial(QuietHandler, directory=tmp)
        server = http.server.ThreadingHTTPServer(('localhost', args.port), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        old, new = run(tmp, 'old', args.port), run(tmp, 'new', args.port)
        server.shutdown()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    ok = True
    for which, res in ((args.base, old), ('working tree', new)):
        if res['errors']:
            ok = False
            print(f'ERRORS in {which}:', *res['errors'], sep='\n  ')
    for step in sorted(set(old['steps']) | set(new['steps']), key=lambda k: list(new['steps']).index(k) if k in new['steps'] else 99):
        a, b = json.dumps(old['steps'].get(step)), json.dumps(new['steps'].get(step))
        if a == b:
            print(f'SAME  {step}')
            continue
        ok = False
        i = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
        print(f'DIFF  {step}\n   {args.base}: …{a[max(0, i - 80):i + 120]}\n   working tree: …{b[max(0, i - 80):i + 120]}')
    print('\nNo differences.' if ok else '\nDifferences or errors found (see above).')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
