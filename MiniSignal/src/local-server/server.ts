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
  new Map<string, WebSocket>();
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

      clients.set(
        message.userId,
        ws
      );

      identities.set(
        message.userId,
        message.publicKey
      );

      console.log(
        `${message.userId} online`
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

      const target =
        clients.get(
          message.target
        );

      if (target) {

        target.send(
          JSON.stringify({
            type:
              "x3dh-init",

            from:
              message.from,

            ephemeralPublic:
              message.ephemeralPublic,

            identityKey:
              message.identityKey
          })
        );
      }

      return;
    }

    // 消息转发
    if (message.type === "message") {
      

      const target =
        clients.get(message.target);

      if (target) {

        target.send(
          JSON.stringify({
            type: "message",
            from: message.from,
            payload: message.payload
          })
        );

        console.log(
          `${message.from} -> ${message.target}`
        );
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
  });
});