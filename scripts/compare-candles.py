# So sánh nến /api/candles với DNSE ở mọi khung. Chạy: python3 scripts/compare-candles.py [1 5 15 1H 1D 1W] (server ở cổng 8100)
import json, urllib.request, time, datetime, sys
def get(u): return json.load(urllib.request.urlopen(u, timeout=40))
f = lambda t: datetime.datetime.fromtimestamp(t + 7*3600, datetime.UTC).strftime('%d %H:%M')
now = int(time.time())
for sym, kind in [('FPT','stock'), ('HPG','stock'), ('VN30F1M','derivative'), ('VNINDEX','index')]:
    for res in sys.argv[1:] or ['1','5','15','1H','1D','1W']:
        span = 5 if res not in ('1D','1W') else 400
        c = get(f'http://localhost:8100/api/candles?symbol={sym}&resolution={res}&from={now-span*86400}&to={now}')
        d = get(f'https://services.entrade.com.vn/chart-api/v2/ohlcs/{kind}?symbol={sym}&resolution={res}&from={now-span*86400}&to={now}')
        dm = {t:(o,h,l,cl,v) for t,o,h,l,cl,v in zip(d['t'],d['o'],d['h'],d['l'],d['c'],d['v'])}
        diff = [b for b in c if b['time'] in dm and (abs(dm[b['time']][0]-b['open'])>1e-6 or abs(dm[b['time']][1]-b['high'])>1e-6 or abs(dm[b['time']][2]-b['low'])>1e-6 or abs(dm[b['time']][3]-b['close'])>1e-6 or dm[b['time']][4]!=b['volume'])]
        only = [b for b in c if b['time'] not in dm]
        last = c[-1]
        print(f'{sym:8} {res:3} nến web {len(c):4} · DNSE {len(d["t"]):4} · khác DNSE ở {len(diff)} nến · web có thêm {len(only)} nến · cuối web {f(last["time"])} C={last["close"]} V={last["volume"]} · cuối DNSE {f(d["t"][-1])}')
        for b in diff[-3:]: print('     khác:', f(b['time']), 'web', (b['open'],b['high'],b['low'],b['close'],b['volume']), 'DNSE', dm[b['time']])
