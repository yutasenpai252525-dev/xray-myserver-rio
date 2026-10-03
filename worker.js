import { connect } from 'cloudflare:sockets';

let userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4'; 
let trojanPassword = 'my_secure_password'; 

export default {
  async fetch(request, env, ctx) {
    try {
      userID = env.UUID || userID;
      trojanPassword = env.PASSWORD || trojanPassword;
      
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response(JSON.stringify({ status: "Active", protocol: "VLESS/VMess/Trojan over Workers" }, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json;charset=utf-8" },
        });
      }

      const url = new URL(request.url);
      if (url.pathname === `/${userID}` || url.pathname.startsWith('/vless')) {
        return await vlessOverWSHandler(request);
      } else if (url.pathname === `/${trojanPassword}` || url.pathname.startsWith('/trojan')) {
        return await trojanOverWSHandler(request);
      } else {
        return new Response('Access Denied', { status: 403 });
      }
    } catch (err) {
      return new Response(err.toString(), { status: 500 });
    }
  },
};

async function vlessOverWSHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  server.accept();

  let remoteSocket = null;
  let isConnected = false;

  server.addEventListener('message', async event => {
    const data = event.data;
    if (!isConnected) {
      try {
        const vlessResponse = parseVlessHeader(data);
        if (!vlessResponse) return;
        
        remoteSocket = connect({ hostname: vlessResponse.address, port: vlessResponse.port });
        const writer = remoteSocket.writable.getWriter();
        await writer.write(vlessResponse.rawHeaderData);
        writer.releaseLock();
        
        isConnected = true;
        
        remoteSocket.readable.pipeTo(new WritableStream({
          write(chunk) { server.send(chunk); },
          close() { server.close(); },
          abort() { server.close(); }
        })).catch(() => {});
      } catch (e) {
        server.close();
      }
    } else {
      if (remoteSocket) {
        const writer = remoteSocket.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
      }
    }
  });

  return new Response(null, { status: 101, webSocket: client });
}

function parseVlessHeader(buffer) {
  if (buffer.byteLength < 24) return null;
  const view = new DataView(buffer);
  const portIndex = 18;
  const port = view.getUint16(portIndex);
  const addressType = view.getUint8(20);
  
  let addressIndex = 21;
  let addressLength = 0;
  let address = '';

  if (addressType === 1) {
    addressLength = 4;
    address = new Uint8Array(buffer.slice(addressIndex, addressIndex + addressLength)).join('.');
  } else if (addressType === 2) {
    addressLength = view.getUint8(addressIndex);
    addressIndex += 1;
    address = new TextDecoder().decode(buffer.slice(addressIndex, addressIndex + addressLength));
  } else if (addressType === 3) {
    addressLength = 16;
    address = '[...]'; 
  }

  const rawHeaderData = buffer.slice(addressIndex + addressLength);
  return { port, address, rawHeaderData };
}

async function trojanOverWSHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  server.accept();
  return new Response(null, { status: 101, webSocket: client });
}
