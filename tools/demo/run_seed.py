"""Build the demo seed inside the hub (local mode). Bushwood by default; `--brand tools/demo/brands/<slug>.json` re-brands the same
data for another prospect (ordered literal replacements over the seed script — see brands/shadyvalley.json), `--out` names the file."""
import asyncio, sys, json, os, argparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','tests'))
from playwright.async_api import async_playwright
from _harness import local, page
HERE=os.path.dirname(os.path.abspath(__file__))
ap=argparse.ArgumentParser(); ap.add_argument('--brand'); ap.add_argument('--out'); ARGS=ap.parse_args()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(); pg=await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        await local(pg); await pg.goto(page('index.html')+'?org=club'); await pg.wait_for_function("()=>typeof normalize==='function'&&!!CLUB&&!!db")
        src=open(os.path.join(HERE,'seed_bushwood.js')).read()
        if ARGS.brand:
            brand=json.load(open(ARGS.brand))
            for a,b2 in brand['replace']:
                assert a in src, 'brand replacement not found in the seed: '+a
                src=src.replace(a,b2)
            left=[w for w in brand.get('must_not_remain',[]) if w in src]; assert not left, 'still in the seed after branding: '+', '.join(left)
        out=await pg.evaluate(src)
        json.dump(out, open(ARGS.out or os.path.join(HERE,'seed.json'),'w'))
        print(json.dumps(out['summary'], indent=1)); print('errors:', errs[:5])
        await b.close()
asyncio.run(main())
