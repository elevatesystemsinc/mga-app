"""Scoring-engine unit checks (golfcore.js in node). Run: python3 tests/test_formats.py"""
import subprocess,sys,os
r=subprocess.run(['node',os.path.join(os.path.dirname(os.path.abspath(__file__)),'test_formats.js')],capture_output=True,text=True)
print(r.stdout,r.stderr); sys.exit(r.returncode)
