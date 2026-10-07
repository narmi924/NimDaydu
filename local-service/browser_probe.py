"""Development probe for an isolated agent-browser session; never prints tokens."""
import argparse
import asyncio
import json

import httpx
import websockets

from nimdaydu.config import ROOT


async def rpc(url, method, params=None):
    async with websockets.connect(url, max_size=5_000_000) as connection:
        await connection.send(json.dumps({'id': 1, 'method': method, 'params': params or {}}))
        while True:
            packet = json.loads(await connection.recv())
            if packet.get('id') == 1:
                if 'error' in packet:
                    raise RuntimeError(packet['error']['message'])
                return packet.get('result', {})


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['action', 'summary', 'flags'])
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    with httpx.Client() as client:
        browser = client.get(f'http://127.0.0.1:{args.port}/json/version').json()['webSocketDebuggerUrl']
        targets = client.get(f'http://127.0.0.1:{args.port}/json/list').json()
    extension_id = json.loads((ROOT / 'extension/identity.json').read_text())['extensionId']
    if args.operation == 'action':
        target_list = (await rpc(browser, 'Target.getTargets', {'filter': [{'type': 'tab'}]}))['targetInfos']
        sample = next(t for t in target_list if t['url'].startswith('http://127.0.0.1:8800'))
        sample_page = next(t for t in targets if t['url'].startswith('http://127.0.0.1:8800') and t['type'] == 'page')
        await rpc(browser, 'Target.activateTarget', {'targetId': sample_page['id']})
        await rpc(browser, 'Extensions.triggerAction', {'id': extension_id, 'targetId': sample['targetId']})
        print('Invoked the real extension action on the local sample tab.')
    elif args.operation == 'flags':
        result = await rpc(browser, 'Browser.getBrowserCommandLine')
        print('\n'.join(a for a in result['arguments'] if any(v in a for v in ['component', 'audio', 'extension', 'headless'])))
    else:
        panel = next(t for t in targets if t['url'].endswith('/sidepanel.html') and t['type'] == 'page')
        for target in targets:
            if '/sidepanel.html' in target['url'] or '/offscreen.html' in target['url']:
                print(target['type'], target['url'])
        result = await rpc(panel['webSocketDebuggerUrl'], 'Runtime.evaluate', {'expression': "chrome.runtime.sendMessage({target:'background',type:'source'})", 'awaitPromise': True, 'returnByValue': True})
        print(json.dumps(result.get('result', {}).get('value'), ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
