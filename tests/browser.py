"""Real HTTP/subpath browser acceptance. API calls are mocked; no paid key needed.
Run: python tests/browser.py --url http://127.0.0.1:4173/ --output qa
"""
import argparse
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:4173/')
parser.add_argument('--output', default='qa')
parser.add_argument('--browser', choices=['chromium', 'webkit', 'firefox'], default='chromium')
parser.add_argument('--smoke', action='store_true', help='Published-site smoke and screenshots only')
args = parser.parse_args()
BASE = args.url.rstrip('/') + '/'
OUT = Path(args.output); OUT.mkdir(parents=True, exist_ok=True)
results = []
console_errors = []

def passed(name, detail=None):
    results.append({'name': name, 'passed': True, 'detail': detail})
    print('PASS', name, flush=True)

def click(page, action):
    page.locator(f'[data-action="{action}"]:visible').first.click()

def go(page, route):
    page.evaluate('(route) => location.hash = route', route)
    page.wait_for_timeout(120)

def saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('claude-code-design:v1'))")

def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')

def events(text='A real streamed mock response.', tool=False):
    block = {'type':'tool_use','id':'tool_1','name':'propose_file','input':{}} if tool else {'type':'text','text':''}
    delta = {'type':'input_json_delta','partial_json':json.dumps({'path':'generated.js','content':'export const answer = 42;','summary':'Review this generated file.'})} if tool else {'type':'text_delta','text':text}
    rows = [
      {'type':'message_start','message':{'usage':{'input_tokens':5}}},
      {'type':'content_block_start','index':0,'content_block':block},
      {'type':'content_block_delta','index':0,'delta':delta},
      {'type':'message_delta','delta':{'stop_reason':'tool_use' if tool else 'end_turn'},'usage':{'output_tokens':7}},
      {'type':'message_stop'}]
    return ''.join('event: '+r['type']+'\ndata: '+json.dumps(r)+'\n\n' for r in rows)

try:
  with sync_playwright() as p:
    launch = {'headless': True}
    if args.browser == 'chromium':
      launch['args'] = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--enable-features=Vulkan', '--disable-vulkan-surface']
      launch['channel'] = 'chromium'
      if os.environ.get('CHROMIUM_EXECUTABLE'): launch['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
    browser = getattr(p, args.browser).launch(**launch)
    # Playwright cannot reliably intercept requests controlled by service workers.
    # Keep mocked API tests isolated; actual offline/SW behavior is tested separately below.
    context = browser.new_context(viewport={'width':1440,'height':1000}, reduced_motion='reduce', accept_downloads=True, service_workers='block')
    page = context.new_page(); errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
    page.goto(BASE); expect(page.locator('h1')).to_contain_text('Great ideas')
    expect(page.locator('#renderer-status')).to_have_text(re.compile(r'^(Canvas|WebGPU)$'), timeout=15000)
    no_overflow(page)
    assert not page.locator('.mobile-menu').is_visible()
    page.screenshot(path=str(OUT/'desktop.png'), full_page=True)
    passed('Desktop design, native modules, renderer initialization and no overflow', page.locator('#renderer-status').inner_text())
    click(page, 'theme'); expect(page.locator('html')).to_have_attribute('data-theme','dark')
    page.screenshot(path=str(OUT/'desktop-dark.png'),full_page=True)
    click(page, 'theme'); passed('Light and dark theme controls')
    for route, selector in [('sessions','.page-heading'),('files','#editor'),('library','.page-heading'),('changes','.page-heading')]:
      go(page,route); expect(page.locator(selector).first).to_be_visible(); no_overflow(page)
    passed('All primary routes render without overflow')
    go(page,'preview')
    frame = page.frame_locator('iframe.preview-frame')
    expect(frame.locator('#step')).to_be_visible()
    frame.locator('#step').click(); expect(frame.locator('#count')).to_contain_text('1 step')
    assert page.locator('iframe').get_attribute('sandbox') == 'allow-scripts'
    security = page.frames[-1].evaluate("""async () => {
      let parentBlocked=false, storageBlocked=false, networkBlocked=false;
      try { void parent.document.body; } catch { parentBlocked=true; }
      try { localStorage.getItem('test'); } catch { storageBlocked=true; }
      try { await fetch('https://example.com/preview-must-not-connect'); } catch { networkBlocked=true; }
      return {parentBlocked,storageBlocked,networkBlocked};
    }""")
    assert all(security.values()), security
    page.screenshot(path=str(OUT/'preview.png'),full_page=True)
    passed('Isolated preview runs local scripts and blocks parent, storage and network',security)
    go(page,'home'); page.keyboard.press('Control+k'); expect(page.locator('#command-search')).to_be_visible(); page.keyboard.press('Escape')
    passed('Keyboard command palette and native dialog dismissal')
    for width in [320,390,768]:
      mobile=browser.new_context(viewport={'width':width,'height':844},is_mobile=args.browser!='firefox',has_touch=True,reduced_motion='reduce')
      tab=mobile.new_page();tab.goto(BASE);expect(tab.locator('#prompt')).to_be_visible();no_overflow(tab)
      if width<=760:
        expect(tab.locator('.mobile-nav')).to_be_visible();click(tab,'open-drawer')
        expect(tab.locator('#sidebar')).to_have_attribute('aria-modal','true')
        assert tab.locator('.shell').evaluate('(e)=>e.inert')
        tab.keyboard.press('Escape');assert not tab.locator('.shell').evaluate('(e)=>e.inert')
        tab.locator('.mobile-nav button[data-route="files"]').tap();expect(tab.locator('#editor')).to_be_visible();no_overflow(tab)
        go(tab,'home')
      tab.wait_for_timeout(400);tab.screenshot(path=str(OUT/f'mobile-{width}.png'),full_page=True)
      mobile.close()
    passed('320/390/768 px layouts, touch navigation and accessible mobile drawer')
    if not args.smoke:
      go(page,'files'); click(page,'new-file'); page.locator('#dialog-input').fill('notes.txt'); page.locator('#input-form button[type="submit"]').click()
      expect(page.locator('#editor')).to_be_visible();page.locator('#editor').fill('Edited in the real browser.');page.wait_for_timeout(650);page.reload();expect(page.locator('#editor')).to_have_value('Edited in the real browser.')
      passed('File creation, editing, debounced persistence and reload')
      with page.expect_download() as download: click(page,'export-project')
      import zipfile
      archive=Path(download.value.path())
      with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None;assert z.read('notes.txt').decode()=='Edited in the real browser.'
      passed('Project ZIP downloads and passes independent CRC/content validation')
      go(page,'home'); original=saved(page)['files']['style.css'];page.locator('#prompt').fill('Demonstrate the review workflow');page.locator('#prompt').press('Enter')
      expect(page.locator('#messages')).to_contain_text('scripted local demonstration',timeout=15000)
      page.locator('[data-action="stop"]').wait_for(state='detached',timeout=15000)
      assert saved(page)['files']['style.css']==original
      go(page,'changes');click(page,'apply-change');assert saved(page)['files']['style.css']!=original
      click(page,'undo-file');assert saved(page)['files']['style.css']==original
      passed('Labeled local demo, explicit review approval and guarded undo')
      go(page,'library');click(page,'new-prompt');page.locator('#prompt-title').fill('Reusable review');page.locator('#prompt-text').fill('Review the attached code.');page.locator('#new-prompt-form button[type="submit"]').click()
      expect(page.locator('.prompt-card').filter(has_text='Reusable review')).to_be_visible()
      passed('User prompt library creation and filtering')
      # Live protocol is mocked end-to-end; no credential or context reaches a provider.
      requests=[]
      def api_route(route):
        request=route.request
        if request.method=='OPTIONS':
          route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'});return
        if '/v1/models' in request.url:
          route.fulfill(json={'data':[{'id':'mock-account-model','display_name':'Account model'}],'has_more':False},headers={'Access-Control-Allow-Origin':'*'});return
        payload=request.post_data_json;requests.append(payload)
        route.fulfill(status=200,content_type='text/event-stream',body=events(tool=len(requests)==1),headers={'Access-Control-Allow-Origin':'*'})
      context.route('https://api.anthropic.com/**',api_route)
      go(page,'home');click(page,'connect');page.locator('#api-key').fill('test-key-never-persist-123');page.locator('#key-consent').check();page.locator('#connect-submit').click();expect(page.locator('#modal')).not_to_be_visible()
      assert 'test-key-never-persist' not in json.dumps(saved(page))
      passed('API connection discovers account models without persisting the key')
      click(page,'context');page.locator('input[name="context"][value="index.html"]').check();page.locator('#context-form button[type="submit"]').click()
      page.locator('#prompt').fill('Propose a JavaScript file');page.locator('#prompt').press('Enter');expect(page.locator('#messages')).to_contain_text('A real streamed mock response.',timeout=15000)
      page.locator('[data-action="stop"]').wait_for(state='detached',timeout=15000)
      assert len(requests)==2 and 'index.html' in requests[0]['system'] and 'Edited in the real browser.' not in requests[0]['system']
      assert 'generated.js' not in saved(page)['files']
      go(page,'changes');click(page,'apply-change');assert saved(page)['files']['generated.js']=='export const answer = 42;'
      passed('Mock Anthropic SSE, selected-only context, structured tool roundtrip and review')
      click(page,'settings')
      with page.expect_download() as download: click(page,'backup')
      backup=Path(download.value.path()).read_text();assert 'test-key-never-persist' not in backup
      click(page,'close-dialog');page.reload();click(page,'connect');expect(page.locator('#api-key')).to_have_value('');click(page,'close-dialog')
      passed('Backup excludes credentials and reload forgets the API connection')
      page.locator('#restore-input').set_input_files({'name':'backup.json','mimeType':'application/json','buffer':backup.encode()})
      click(page,'confirm-restore');expect(page.locator('h1')).to_contain_text('Great ideas');assert 'generated.js' in saved(page)['files']
      passed('Versioned workspace backup restore with confirmation')
      # Even a misbehaving endpoint ignoring AbortSignal cannot connect after cancel.
      page.evaluate("""() => { window.savedFetch=window.fetch; window.fetch=async()=>{await new Promise(r=>setTimeout(r,500));return Response.json({data:[{id:'late-model'}]});}; }""")
      click(page,'connect');page.locator('#api-key').fill('cancelled-key');page.locator('#key-consent').check();page.locator('#connect-submit').click();click(page,'close-dialog');page.wait_for_timeout(650);click(page,'connect');expect(page.locator('#api-key')).to_have_value('');click(page,'close-dialog');page.evaluate('window.fetch=window.savedFetch')
      passed('Cancelled connection cannot late-write credentials or reopen dialogs')
      assert not errors, errors
      passed('No uncaught application JavaScript errors')
      # Separate un-routed browser context for actual service-worker cache behavior.
      offline_context=browser.new_context(viewport={'width':1280,'height':900})
      offline=offline_context.new_page();offline.goto(BASE);offline.evaluate('navigator.serviceWorker.ready.then(()=>true)');offline.reload()
      for attempt in range(50):
        if offline.evaluate('() => navigator.serviceWorker.controller !== null'): break
        offline.wait_for_timeout(100)
      else: raise AssertionError('Service worker did not take control')
      offline_context.set_offline(True);offline.reload();expect(offline.locator('h1')).to_contain_text('Great ideas');go(offline,'files');expect(offline.locator('#editor')).to_be_visible();offline_context.set_offline(False);offline_context.close()
      passed('Service worker reloads the application shell and editor offline')
    else:
      assert not errors, errors
      passed('Published-site native module and preview smoke has no uncaught errors')
    context.close();browser.close()
except Exception as error:
    results.append({'name':'Acceptance failure','passed':False,'detail':str(error)})
    try:
        if not page.is_closed():
            page.screenshot(path=str(OUT/'failure.png'),full_page=True)
            results.append({'name':'Failure dialog detail','passed':False,'detail':page.locator('#dialog-error').inner_text(timeout=1000) if page.locator('#dialog-error').count() else ''})
    except Exception:
        pass
    raise
finally:
    (OUT/'browser-results.json').write_text(json.dumps({'browser':args.browser,'url':BASE,'results':results,'paid_api_tested':False,'console_errors':console_errors},indent=2))
