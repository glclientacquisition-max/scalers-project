# Anti-slop gate: any vertical strip with >48 consecutive uniform rows fails.
import sys
from PIL import Image
LIMIT=48
bad=0
for f in sys.argv[1:]:
    im=Image.open(f).convert("L"); W,H=im.size; px=im.load()
    x0=56 if W>=768 else 0
    pane=640 if W>=1440 else 560
    regions=[(x0,W)] + ([(x0,W-pane),(W-pane,W)] if W>=768 else [])
    worst=(0,None)
    for k,(a,b) in enumerate(regions):
        a+=4; b-=4
        run=0
        for y in range(H):
            row=[px[x,y] for x in range(a,b,2)]
            if max(row)-min(row)<=3: run+=1
            else: run=0
            if run>worst[0]: worst=(run,(k,y-run+1))
    ok=worst[0]<=LIMIT
    bad+= not ok
    print(("PASS" if ok else "FAIL"), f, "longest blank band", worst[0], "px", "strip/y", worst[1])
sys.exit(1 if bad else 0)
