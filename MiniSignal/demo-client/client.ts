import readline from "readline";
import WebSocket from "ws";

import { CryptoManager } from "./crypto/crypto";
import { IdentityManager } from "./identity/identity";
import { PreKeyManager } from "./prekey/prekey";
import { DHRatchetManager } from "./session/dhRatchet";
import { RatchetManager } from "./session/ratchet";
import { ReplayProtection } from "./session/replayProtection";
import { SessionStore } from "./session/sessionStore";
import { SkippedKeyStore } from "./session/skippedKeys";
import { X3DHManager } from "./session/x3dh";

const userId =
  process.argv[2];

const deviceId =
  process.argv[3];

const targetId =
  process.argv[4];

const targetDeviceId =
  process.argv[5];

if (!userId || !deviceId || !targetId || !targetDeviceId) {

  console.log(
    "usage: npx ts-node client.ts alice desktop bob phone"
  );

  process.exit(0);
}

const identity =
  new IdentityManager(userId);

const preKeys =
  new PreKeyManager(
    identity.getPrivateKey()
  );

let chainKey: Buffer;

let sendCounter = 0;

let receiveCounter = 0;

// 新增: 用于存储待发送的消息
let pendingMessage: string | null = null;

const savedSession =
  SessionStore.load(
    userId,
    targetId
  );

if (savedSession) {

  if (
    savedSession.version !== 1
  ) {

    console.log(
      "session version mismatch"
    );

    process.exit(1);
  }

  chainKey =
    Buffer.from(
      savedSession.chainKey,
      "base64"
    );

  console.log(
    "session restored"
  );
}

let ratchetKey =
  require(
    "@signalapp/libsignal-client"
  ).PrivateKey.generate();

const ws =
  new WebSocket(
    "ws://localhost:8080"
  );

ws.on("open", () => {

  console.log(
    `${userId} connected`
  );

  ws.send(
    JSON.stringify({
      type: "login",
      userId,
      deviceId,
      publicKey:
        identity.getPublicKeyBase64()
    })
  );

  ws.send(
    JSON.stringify({
      type:
        "uploadPreKeyBundle",

      userId,

      deviceId,

      bundle:
        preKeys.getBundle()
    })
  );

});

ws.on("message", (data) => {

  const msg =
    JSON.parse(data.toString());

  if (
    msg.type ===
    "preKeyBundle"
  ) {

    if (!msg.bundle) {

      console.log(
        "bundle not available"
      );

        return;
    }

    const {
      PublicKey
    } = require(
      "@signalapp/libsignal-client"
    );

    const remoteIdentity =
      PublicKey.deserialize(
        Buffer.from(
          msg.bundle.identityKey,
          "base64"
        )
      );

    const remoteSignedPreKey =
      PublicKey.deserialize(
        Buffer.from(
          msg.bundle.signedPreKey,
          "base64"
        )
      );

    const remoteOneTimePreKey =
      PublicKey.deserialize(
        Buffer.from(
          msg.bundle.oneTimePreKey,
          "base64"
        )
      );

    const result =
      X3DHManager.initiator(

        identity.getPrivateKey(),

        remoteIdentity,

        remoteSignedPreKey,

        remoteOneTimePreKey
      );

    // 修复: Buffer.from 默认使用 utf8 编码，必须指定 base64 以正确解码密钥
    chainKey =
      Buffer.from(result.rootKey, 'base64');

    SessionStore.save(
      userId,
      targetId,
      {
        chainKey:
          chainKey.toString(
            "base64"
          )
      }
    );

    console.log(
      "X3DH initiator session established"
    );

    // 把 ephemeralPublic 发给对方
    ws.send(
      JSON.stringify({

        type:
          "x3dh-init",

        from:
          userId,

        fromDeviceId:
          deviceId,

        target:
          targetId,

        targetDeviceId,

        ephemeralPublic:
          result.ephemeralPublic,

        identityKey:
          identity
            .getPublicKeyBase64()
      })
    );

    // 新增: 如果有待发送的消息，立即发送
    if (pendingMessage) {
      console.log("Sending pending message...");
      
      // 复制 rl.on('line') 中的加密逻辑
      // 注意：这里需要生成一个新的 Ephemeral Key 用于第一条消息的 DH Ratchet
      // 原有的 ratchetKey 是在文件顶部生成的，可能需要重新生成或复用
      // 为了简化，我们复用现有的 ratchetKey 逻辑，但需要注意状态同步
      
      // 1. 执行 DH Ratchet Step (生成新的 DH 公钥和更新 Root Key/Chain Key)
      // 这里的逻辑与 rl.on('line') 一致
      const dhStep =
        DHRatchetManager
          .ratchetStep(

            ratchetKey,

            ratchetKey.getPublicKey(),

            chainKey
          );

      chainKey =
        Buffer.from(
          dhStep.nextRootKey
        );

      SessionStore.save(
        userId,
        targetId,
        {
          chainKey:
            chainKey.toString(
              "base64"
            )
        }
      );

      const ratchet =
        RatchetManager.kdfChain(
          chainKey
        );

      chainKey =
        ratchet.nextChainKey;

      SessionStore.save(
        userId,
        targetId,
        {
          chainKey:
            chainKey.toString(
              "base64"
            )
        }
      );

      const encrypted =
        CryptoManager.encrypt(
          pendingMessage,
          ratchet.messageKey
            .toString("base64")
        );

      ws.send(
        JSON.stringify({
          type: "message",
          from: userId,
          fromDeviceId: deviceId,
          target: targetId,
          targetDeviceId,
          messageNumber:
            sendCounter++,
          payload: encrypted,
          dhPublicKey:
            dhStep.publicKey
        })
      );

      pendingMessage = null;
      console.log("Pending message sent.");
    }

    return;
  }

  if (
    msg.type ===
    "x3dh-init"
  ) {

    const {
      PublicKey
    } = require(
      "@signalapp/libsignal-client"
    );

    const remoteEphemeral =
      PublicKey.deserialize(
        Buffer.from(
          msg.ephemeralPublic,
          "base64"
        )
      );

    const remoteIdentity =
      PublicKey.deserialize(
        Buffer.from(
          msg.identityKey,
          "base64"
        )
      );

    chainKey =
      Buffer.from(
        X3DHManager.responder(

          identity.getPrivateKey(),

          preKeys.getSignedPreKeyPrivate(),

          preKeys.getOneTimePreKeyPrivate(),

          remoteEphemeral,

          remoteIdentity
        ),
        "base64"
      );

    SessionStore.save(
      userId,
      targetId,
      {
        chainKey:
          chainKey.toString(
            "base64"
          )
      }
    );

    console.log(
      "X3DH responder session established"
    );

    return;
  }

  if (msg.type === "message") {

    if (
      ReplayProtection.seen(
        msg.from,
        msg.messageNumber
      )
    ) {

      console.log(
        "replay attack detected"
      );

      return;
    }

    const incoming =
      msg.messageNumber;

    // 检查是否是旧消息（跳过密钥）
    if (
      SkippedKeyStore.has(
        incoming
      )
    ) {

      const skippedKey =
        SkippedKeyStore.get(
          incoming
        );

      // 解析 payload 获取加密组件
      let payloadData: any = msg.payload;
      if (typeof msg.payload === 'string') {
        try {
          payloadData = JSON.parse(msg.payload);
        } catch (e) {
          console.error("Failed to parse payload as JSON for skipped key");
          return;
        }
      }
      
      // 确保字段存在 (注意发送端使用的是 encrypted)
      if (!payloadData.encrypted || !payloadData.iv || !payloadData.tag) {
         console.error("Missing fields in payload for skipped key decryption", payloadData);
         return;
      }

      try {
        const decrypted =
          CryptoManager.decrypt(
            payloadData.encrypted,
            payloadData.iv,
            payloadData.tag,
            skippedKey!
          );

        console.log(
          `\n${msg.from}:`,
          decrypted
        );
      } catch (err) {
        console.error("Failed to decrypt skipped message:", err);
        console.error("Skipped Key (base64):", skippedKey);
        console.error("Payload IV:", payloadData.iv);
        console.error("Payload Tag:", payloadData.tag);
        console.error("Payload Encrypted Length:", payloadData.encrypted?.length);
      }

      ReplayProtection.mark(
        msg.from,
        msg.messageNumber
      );

      return;
    }

    while (
      receiveCounter <
      incoming
    ) {

      const ratchet =
        RatchetManager
          .kdfChain(
            chainKey
          );

      chainKey =
        ratchet.nextChainKey;

      SkippedKeyStore.save(

        receiveCounter,

        ratchet.messageKey
          .toString("base64")
      );

      receiveCounter++;
    }

    if (msg.dhPublicKey) {

      const {
        PublicKey
      } = require(
        "@signalapp/libsignal-client"
      );

      const remoteRatchet =
        PublicKey.deserialize(
          Buffer.from(
            msg.dhPublicKey,
            "base64"
          )
        );

      const dhStep =
        DHRatchetManager
          .ratchetStep(

            ratchetKey,

            remoteRatchet,

            chainKey
          );

      chainKey =
        Buffer.from(
          dhStep.nextRootKey
        );

      SessionStore.save(
        userId,
        targetId,
        {
          chainKey:
            chainKey.toString(
              "base64"
            )
        }
      );
    }

    const ratchet =
      RatchetManager.kdfChain(
        chainKey
      );

    receiveCounter++;

    chainKey =
      ratchet.nextChainKey;

    SessionStore.save(
      userId,
      targetId,
      {
        chainKey:
          chainKey.toString(
            "base64"
          )
      }
    );

    // 解析 payload 获取加密组件
    let payloadData: any = msg.payload;
    if (typeof msg.payload === 'string') {
      try {
        payloadData = JSON.parse(msg.payload);
      } catch (e) {
        console.error("Failed to parse payload as JSON for current message");
        return;
      }
    }

    // 确保字段存在 (注意发送端使用的是 encrypted)
    if (!payloadData.encrypted || !payloadData.iv || !payloadData.tag) {
       console.error("Missing fields in payload for current message decryption", payloadData);
       return;
    }
    
    try {
      const decrypted =
        CryptoManager.decrypt(
          payloadData.encrypted,
          payloadData.iv,
          payloadData.tag,
          ratchet.messageKey.toString("base64")
        );

      console.log();
      console.log(
        `[${msg.from}] ${decrypted}`
      );
    } catch (err) {
      console.error("Failed to decrypt current message:", err);
      console.error("Current Key (base64):", ratchet.messageKey.toString("base64"));
      console.error("Payload IV:", payloadData.iv);
      console.error("Payload Tag:", payloadData.tag);
      console.error("Payload Encrypted Length:", payloadData.encrypted?.length);
    }

    ReplayProtection.mark(
      msg.from,
      msg.messageNumber
    );

    rl.prompt();
  }
});

const rl =
  readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

rl.setPrompt("> ");

rl.prompt();

rl.on("line", (line) => {

  // 修改: 如果会话未建立，存储消息并请求 PreKeyBundle
  if (!chainKey) {
    pendingMessage = line;
    
    ws.send(
      JSON.stringify({
        type: "getPreKeyBundle",
        target: targetId,
        targetDeviceId
      })
    );
    
    console.log("Creating session...");
    rl.prompt();
    return;
  }

  const dhStep =
    DHRatchetManager
      .ratchetStep(

        ratchetKey,

        ratchetKey.getPublicKey(),

        chainKey
      );

  chainKey =
    Buffer.from(
      dhStep.nextRootKey
    );

  SessionStore.save(
    userId,
    targetId,
    {
      chainKey:
        chainKey.toString(
          "base64"
        )
    }
  );

  const ratchet =
    RatchetManager.kdfChain(
      chainKey
    );

  chainKey =
    ratchet.nextChainKey;

  SessionStore.save(
    userId,
    targetId,
    {
      chainKey:
        chainKey.toString(
          "base64"
        )
    }
  );

  const encrypted =
    CryptoManager.encrypt(
      line,
      ratchet.messageKey
        .toString("base64")
    );

  ws.send(
    JSON.stringify({
      type: "message",
      from: userId,
      fromDeviceId: deviceId,
      target: targetId,
      targetDeviceId,
      messageNumber:
        sendCounter++,
      payload: encrypted,
      dhPublicKey:
        dhStep.publicKey
    })
  );

  rl.prompt();
});
