"""Real WebSocket integration + loopback benchmark. No browser simulation claims."""
import asyncio,json,statistics,sys,time,platform
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from aiohttp import web,ClientSession
from server import make_app,rooms,now

async def until(ws, predicate, timeout=4):
    async def read():
        while True:
            data=await ws.receive_json()
            if predicate(data): return data
    return await asyncio.wait_for(read(),timeout)

async def main():
    runner=web.AppRunner(make_app());await runner.setup();site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
    port=site._server.sockets[0].getsockname()[1]
    checks=[];latencies=[]
    async with ClientSession() as session:
        async def join(code=None,token=None):
            ws=await session.ws_connect(f'http://127.0.0.1:{port}/ws')
            await ws.send_json({'type':'join' if code else 'create','code':code,'token':token,'name':'Test viewer'})
            welcome=await until(ws,lambda d:d['type']=='welcome')
            await until(ws,lambda d:d['type']=='state')
            return ws,welcome
        host,welcome=await join();code=welcome['code'];clients=[host];identities=[welcome]
        for _ in range(9):
            ws,w=await join(code);clients.append(ws);identities.append(w)
        checks.append('10 concurrent WebSocket clients joined one room')
        await host.send_json({'type':'load','url':'https://example.org/test.mp4','title':'Test'})
        await until(host,lambda d:d['type']=='state' and d['playback']['url'])
        await clients[1].send_json({'type':'play'})
        await until(clients[1],lambda d:d['type']=='error' and 'host' in d['message'])
        checks.append('Non-host playback rejected')
        for i in range(60):
            started=time.perf_counter()
            await host.send_json({'type':'seek','position':i+100})
            await asyncio.gather(*(until(c,lambda d,i=i:d['type']=='state' and d['playback']['position']==i+100) for c in clients))
            latencies.append((time.perf_counter()-started)*1000)
            await asyncio.sleep(.04)
        checks.append('60 seek controls reached all 10 clients')
        await host.send_json({'type':'play'})
        await until(host,lambda d:d['type']=='state' and d['playback']['playing'])
        await asyncio.sleep(.15)
        late,lateid=await join(code);await late.send_json({'type':'sync'})
        state=await until(late,lambda d:d['type']=='state')
        assert state['playback']['position']>159
        checks.append('Late join receives advanced authoritative timeline')
        await clients[2].close();resumed,resumeid=await join(code,identities[2]['token']);clients[2]=resumed
        assert resumeid['id']==identities[2]['id'];checks.append('Reconnect token restores member identity')
        await host.send_json({'type':'add','url':'https://example.org/a.mp4','title':'A','actionId':'one'})
        await host.send_json({'type':'add','url':'https://example.org/a.mp4','title':'A','actionId':'one'})
        await host.send_json({'type':'sync'})
        state=await until(host,lambda d:d['type']=='state' and len(d['playlist'])==1)
        await asyncio.sleep(.05)
        assert len(rooms[code]['playlist'])==1;checks.append('Duplicate action ID does not duplicate playlist entry')
        await asyncio.gather(*(c.send_json({'type':'chat','text':f'message {i}'}) for i,c in enumerate(clients)))
        await until(host,lambda d:d['type']=='state' and len(d['messages'])==10)
        checks.append('Concurrent chat actions preserved')
        await host.send_json({'type':'poll','question':'Next?','options':['A','B']})
        await until(host,lambda d:d['type']=='state' and d['poll'] is not None)
        await clients[1].send_json({'type':'vote','choice':0});await clients[1].send_json({'type':'vote','choice':1})
        state=await until(host,lambda d:d['type']=='state' and d['poll'] and d['poll']['votes'].get(identities[1]['id'])==1)
        assert len(state['poll']['votes'])==1;checks.append('Changing a vote replaces the prior vote')
        await host.send_json({'type':'transfer','id':identities[1]['id']})
        await until(host,lambda d:d['type']=='state' and d['host']==identities[1]['id'])
        checks.append('Explicit host transfer succeeds')
        await clients[1].close()
        rooms[code]['members'][identities[1]['id']]['left']=now()-16000
        await until(host,lambda d:d['type']=='state' and d['host']==welcome['id'])
        checks.append('Disconnected host replaced after grace period (clock advanced in test)')
        await host.send_str('{bad json')
        await until(host,lambda d:d['type']=='error')
        await host.send_json({'type':'ping','time':123})
        await until(host,lambda d:d['type']=='pong' and d['echo']==123)
        checks.append('Malformed input rejected without losing the socket')
        for c in clients+[late]: await c.close()
    await runner.cleanup()
    ordered=sorted(latencies);p95=ordered[int(len(ordered)*.95)-1]
    result={'environment':f'{platform.system()} / Python {platform.python_version()} / aiohttp / TCP loopback','clients':10,'samples':len(latencies),'metric':'host send to receipt by every one of 10 clients; same-process local TCP','median_ms':round(statistics.median(latencies),2),'p95_ms':round(p95,2),'max_ms':round(max(latencies),2),'checks':checks,'limitations':['Not a LAN or internet measurement','No browser decode/render included','Actual media drift requires multi-browser measurement','Server data is in memory and resets on restart']}
    print(json.dumps(result,indent=2));(Path(__file__).resolve().parents[1]/'docs/benchmark.json').write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':asyncio.run(main())
