import asyncio, sys, json, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','tests'))
from playwright.async_api import async_playwright
from _harness import local, page
HERE=os.path.dirname(os.path.abspath(__file__))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(); pg=await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        await local(pg); await pg.goto(page('index.html')+'?org=club'); await pg.wait_for_function("()=>typeof normalize==='function'&&!!CLUB&&!!db")
        src=open(os.path.join(HERE,'seed_bushwood.js')).read()
        out=await pg.evaluate(src)
        json.dump(out, open(os.path.join(HERE,'seed.json'),'w'))
        print(json.dumps(out['summary'], indent=1)); print('errors:', errs[:5])
        await b.close()
asyncio.run(main())
