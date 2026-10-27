#!/usr/bin/env bash
# Builds the deployable pages at the repo root from src/ (Render serves the repo root as-is).
# Every page gets the same build stamp; version.json makes open devices reload to the new build.
set -euo pipefail
cd "$(dirname "$0")"
BUILD=${BUILD:-$(date -u +%Y%m%d%H%M%S)}; export BUILD
MODULES="core ui logins portal treasury golfcore golf games calccore pdffonts calcutta checklist ckcore checkin surveys raffle payouts billcore poscore billing pos bookings settings rounds"
{ cat src/head.html; printf '<script>\n'; for m in $MODULES; do cat "src/$m.js"; done
  sed "s/__BUILD__/$BUILD/" src/autoupdate.js; printf 'boot();\n</script>\n</body>\n</html>\n'; } > index.html
python3 - <<'PY'
import os
B=os.environ['BUILD']; au=open('src/autoupdate.js').read().replace('__BUILD__',B).strip('\n')
for page,core,marker in [('cashier','calccore','/*CALCCORE*/'),('checkin','ckcore','/*CKCORE*/'),('score','golfcore','/*GOLFCORE*/'),('gamecast','golfcore','/*GOLFCORE*/'),('survey',None,None),('member','billcore','/*BILLCORE*/'),('pos','billcore','/*BILLCORE*/'),('expo',None,None)]:
    s=open(f'src/{page}_src.html').read()
    assert (not marker or marker in s) and '/*AUTOUPDATE*/' in s, f'{page}: markers missing'
    if marker: s=s.replace(marker,open(f'src/{core}.js').read().strip('\n'))
    if '/*PDFFONTS*/' in s: s=s.replace('/*PDFFONTS*/',open('src/pdffonts.js').read().strip('\n'))
    if '/*POSCORE*/' in s: s=s.replace('/*POSCORE*/',open('src/poscore.js').read().strip('\n'))
    open(f'{page}.html','w').write(s.replace('/*AUTOUPDATE*/',au))
PY
for f in index cashier checkin score gamecast survey member pos expo; do   # syntax-check every page's script
  python3 -c "import re; s=open('$f.html').read(); open('/tmp/_chk_$f.js','w').write('\n'.join(re.findall(r'<script>(.*?)</script>',s,flags=re.S)))"
  node --check "/tmp/_chk_$f.js"
done
printf '{"build":"%s"}' "$BUILD" > version.json
echo "BUILD_OK $BUILD"
