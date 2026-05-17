import WebSocket, {
  WebSocketServer
} from "ws";

const wss =
  new WebSocketServer({
    port: 8080
  });

console.log(
  "MiniSignal Server Running: ws://localhost:8080"
);

const clients =
  new Map<
    string,
    Map<string, WebSocket>
  >();

const identities =
  new Map<string, string>();

const preKeyBundles =
  new Map<string, any>();

wss.on("connection", (ws) => {

  console.log("client connected");

  ws.on("message", (data) => {

    const message =
      JSON.parse(data.toString());

    console.log(
      "RECV:",
      message
    );

    // 用户登录
    if (message.type === "login") {

      const userId = message.userId;
      const deviceId = message.deviceId || "default_device"; // 兼容未传deviceId的情况

      if (
        !clients.has(
          userId
        )
      ) {

        clients.set(
          userId,
          new Map()
        );
      }

      clients
        .get(userId)!
        .set(
          deviceId,
          ws
        );

      identities.set(
        message.userId,
        message.publicKey
      );

      console.log(
        `${message.userId} (${deviceId}) online`
      );

      return;
    }

    // 处理上传预密钥包请求
    if (message.type === "uploadPreKeyBundle") {

      preKeyBundles.set(
        message.userId,
        message.bundle
      );

      console.log(
        `${message.userId} uploaded bundle`
      );

      return;
    }

    // 处理获取公钥请求
    if (message.type === "getPublicKey") {

      const publicKey =
        identities.get(
          message.target
        );

      console.log(
        "GET PUBLIC KEY:",
        message.target,
        publicKey
      );

      ws.send(
        JSON.stringify({
          type: "publicKey",
          target: message.target,
          publicKey
        })
      );

      return;
    }

    // 处理获取预密钥包请求
    if (message.type === "getPreKeyBundle") {

      const bundle =
        preKeyBundles.get(
          message.target
        );

      ws.send(
        JSON.stringify({
          type: "preKeyBundle",
          target: message.target,
          bundle
        })
      );

      return;
    }

    // 处理 X3DH 初始化请求
    if (
      message.type ===
      "x3dh-init"
    ) {

      const targetDevices = clients.get(message.target);
      if (targetDevices) {
        const payload = JSON.stringify({
          type: "x3dh-init",
          from: message.from,
          ephemeralPublic: message.ephemeralPublic,
          identityKey: message.identityKey
        });
        
        // 广播给该用户的所有设备
        targetDevices.forEach((deviceWs) => {
          if (deviceWs.readyState === WebSocket.OPEN) {
            deviceWs.send(payload);
          }
        });
      }

      return;
    }

    // 消息转发
    if (message.type === "message") {
      
      const targetDevices = clients.get(message.target);
      if (targetDevices) {

        for (
          const ws of
          targetDevices.values()
        ) {

          ws.send(
            JSON.stringify({
              type: "message",

              from:
                message.from,

              payload:
                message.payload,

              messageNumber:
                message.messageNumber,

              dhPublicKey:
                message.dhPublicKey
            })
          );
        }
      }
      else {
        console.log(
          "target offline"
        );
      }
    }
  });

  ws.on("close", () => {
    console.log("client disconnected");
    // 可选：在此处清理 clients map 中断开的连接
    // 由于 ws 对象引用在 map 中，可以通过遍历查找并删除
    for (const [userId, devices] of clients.entries()) {
      for (const [deviceId, socket] of devices.entries()) {
        if (socket === ws) {
          devices.delete(deviceId);
          console.log(`Removed device ${deviceId} for user ${userId}`);
          if (devices.size === 0) {
            clients.delete(userId);
          }
          return; // 找到并删除后退出
        }
      }
    }
  });
});