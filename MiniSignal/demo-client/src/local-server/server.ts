import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const server = http.createServer();
const wss = new WebSocketServer({ server });

// 核心修改：clients 改成按 userId:deviceId 存
const clients = new Map<string, WebSocket>();
const preKeyBundles = new Map<string, any>();

function deviceKey(userId: string, deviceId: string) {
  return `${userId}:${deviceId}`;
}

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      // 登录时改成：
      if (message.type === "login") {
        clients.set(deviceKey(message.userId, message.deviceId), ws);
        console.log(`${message.userId}/${message.deviceId} online`);
        return;
      }

      // 上传 prekey：
      if (message.type === "uploadPreKeyBundle") {
        preKeyBundles.set(
          deviceKey(message.userId, message.deviceId),
          message.bundle
        );
        return;
      }

      // 获取 prekey：
      if (message.type === "getPreKeyBundle") {
        const bundle = preKeyBundles.get(
          deviceKey(message.target, message.targetDeviceId)
        );

        ws.send(JSON.stringify({
          type: "preKeyBundle",
          target: message.target,
          targetDeviceId: message.targetDeviceId,
          bundle
        }));

        return;
      }

      // 转发 x3dh-init：
      if (message.type === "x3dh-init") {
        const target = clients.get(
          deviceKey(message.target, message.targetDeviceId)
        );

        if (target) {
          target.send(JSON.stringify({
            type: "x3dh-init",
            from: message.from,
            fromDeviceId: message.fromDeviceId,
            ephemeralPublic: message.ephemeralPublic,
            identityKey: message.identityKey
          }));
        }

        return;
      }

      // 转发消息：
      if (message.type === "message") {
        const target = clients.get(
          deviceKey(message.target, message.targetDeviceId)
        );

        if (target) {
          target.send(JSON.stringify({
            type: "message",
            from: message.from,
            fromDeviceId: message.fromDeviceId,
            payload: message.payload,
            messageNumber: message.messageNumber,
            dhPublicKey: message.dhPublicKey
          }));
        } else {
          console.log("target device offline");
        }

        return;
      }
      
      // 其他消息类型处理...
      console.log('Received message:', message);

    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    // 可选：断开连接时从 map 中移除
    // 由于一个 ws 可能对应多个 key 或者需要遍历删除，这里简化处理，实际项目中可能需要更复杂的清理逻辑
    // 例如维护反向映射或者在 login 时记录当前 ws 对应的 key
    for (const [key, clientWs] of clients.entries()) {
        if (clientWs === ws) {
            clients.delete(key);
            console.log(`Removed client ${key} from map`);
            break; 
        }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Local signal server is listening on port ${PORT}`);
});