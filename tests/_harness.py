"""Shared test setup: run the pages in local mode (no Supabase), serve SheetJS from tests/node_modules."""
import os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX=os.path.join(ROOT,'tests','node_modules','xlsx','dist','xlsx.full.min.js')
async def local(pg):
    await pg.route('**/config.js',lambda r:r.fulfill(body="window.MM_CONFIG={};",content_type='text/javascript'))
    await pg.route('**/supabase.min.js',lambda r:r.fulfill(body="",content_type='text/javascript'))
    await pg.route('**/fonts.googleapis.com/**',lambda r:r.fulfill(body='',content_type='text/css'))
    if os.path.exists(XLSX): await pg.route('**/xlsx.full.min.js',lambda r:r.fulfill(path=XLSX,content_type='text/javascript'))
def page(name): return 'file://'+os.path.join(ROOT,name)
