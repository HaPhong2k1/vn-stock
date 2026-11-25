# Kiểm tra độc lập bộ lọc: tự tính MA20/50/200, RSI, MACD, KL TB20 từ DNSE + giá realtime và so với /api/screener.
# Chạy: API=http://localhost:8080 python3 scripts/verify-screener.py
# Kiểm tra độc lập: tự tính chỉ báo từ DNSE + giá realtime rồi so với /api/screener
import json, sys, urllib.request, time, datetime, math, random
import os
API = os.environ.get('API', 'http://localhost:8080')
def get(u):
    return json.load(urllib.request.urlopen(u, timeout=30))
scr = get(API + '/api/screener'); rows = {r['s']: r for r in scr['rows']}
random.seed(1)
syms = ['BFC','FPT','HPG','SSI','VCB','VIC','SHI','REE','SAB','VNM','MWG','TCB','ACB','VPB','HDB','GVR','DGC','PNJ','MSN','VHM'] + random.sample(sorted(rows), 40)
now = int(time.time()); today = datetime.datetime.utcfromtimestamp(now + 7*3600).strftime('%Y-%m-%d')
def vnd(t): return datetime.datetime.utcfromtimestamp(t + 7*3600).strftime('%Y-%m-%d')
def sma(a, n): return sum(a[-n:]) / n if len(a) >= n else None
def ema_arr(a, n):
    if len(a) < n: return [None]*len(a)
    k = 2/(n+1); out=[None]*(n-1); prev=sum(a[:n])/n; out.append(prev)
    for v in a[n:]: prev = v*k + prev*(1-k); out.append(prev)
    return out
def rsi(a, n=14):
    if len(a) <= n: return None
    g=l=0
    for i in range(1,n+1):
        d=a[i]-a[i-1]; g+=max(d,0); l+=max(-d,0)
    g/=n; l/=n
    for i in range(n+1,len(a)):
        d=a[i]-a[i-1]; g=(g*(n-1)+max(d,0))/n; l=(l*(n-1)+max(-d,0))/n
    return 100 if l==0 else 100-100/(1+g/l)
mism = []; checked = 0
for s in syms:
    if s not in rows: continue
    m = rows[s]
    st = get(f'{API}/api/stock/{s}')
    j = get(f'https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?symbol={s}&resolution=1D&from={now-420*86400}&to={now}')
    idx = [i for i,t in enumerate(j['t']) if vnd(t) < today]
    C = [j['c'][i] for i in idx]; V = [j['v'][i] for i in idx]; H=[j['h'][i] for i in idx]
    if len(C) < 25 or not st.get('last'): continue
    live = C + [st['last']]; n = len(live)-1
    ma20 = sma(live,20); ma20p = sma(live[:-1],20); ma50 = sma(live,50); ma200 = sma(live,200)
    e = {'ma20': ma20, 'ma50': ma50, 'ma200': ma200, 'rsi14': rsi(live)}
    m1 = ema_arr(live,12); m2 = ema_arr(live,26)
    macd_line = [a-b if a is not None and b is not None else None for a,b in zip(m1,m2)]
    st0 = next(i for i,v in enumerate(macd_line) if v is not None)
    sig = [None]*st0 + ema_arr(macd_line[st0:], 9)
    hist = [a-b if a is not None and b is not None else None for a,b in zip(macd_line, sig)]
    avgv = sum(V[-20:])/len(V[-20:])
    exp = {
      'aboveMa20': live[-1] > ma20,
      'ma20CrossUp': live[-2] <= ma20p and live[-1] > ma20,
      'ma20CrossDown': live[-2] >= ma20p and live[-1] < ma20,
      'macdCrossUp': hist[-2] is not None and hist[-2] <= 0 and hist[-1] > 0,
      'avgVol20': avgv, 'volRatio': st['totVol']/avgv if avgv else None,
    }
    checked += 1
    for k,v in e.items():
        if v is None or m.get(k) is None:
            if (v is None) != (m.get(k) is None): mism.append((s,k,m.get(k),v))
            continue
        if abs(m[k]-v) > max(0.02, abs(v)*0.002): mism.append((s,k,m[k],round(v,3)))
    for k in ['aboveMa20','ma20CrossUp','ma20CrossDown','macdCrossUp']:
        if bool(m[k]) != exp[k]: mism.append((s,k,m[k],exp[k]))
    if abs(m['avgVol20'] - avgv) > 1: mism.append((s,'avgVol20',m['avgVol20'],round(avgv)))
    if exp['volRatio'] and abs(m['volRatio'] - exp['volRatio']) > 0.02: mism.append((s,'volRatio',m['volRatio'],round(exp['volRatio'],2)))
    if abs(m['price'] - st['last']) > 1e-6: mism.append((s,'price',m['price'],st['last']))
print('đã kiểm tra', checked, 'mã; sai lệch:', len(mism))
for x in mism[:40]: print('  ', x)
