import readline from "readline";
import WebSocket from "ws";

import { CryptoManager } from "./crypto/crypto";
import { IdentityManager } from "./identity/identity";
import { SessionManager } from "./session/session";
import { PreKeyManager } from "./prekey/prekey";
import { X3DHManager } from "./session/x3dh";

const userId =
  process.argv[2];

const targetId =
  process.argv[3];

if (!userId || !targetId) {

  console.log(
    "usage: npx ts-node client.ts alice bob"
  );

  process.exit(0);
}

const identity =
  new IdentityManager(userId);

const preKeys =
  new PreKeyManager(
    identity.getPrivateKey()
  );

let rootKey = "";

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
      publicKey:
        identity.getPublicKeyBase64()
    })
  );

  ws.send(
    JSON.stringify({
      type:
        "uploadPreKeyBundle",

      userId,

      bundle:
        preKeys.getBundle()
    })
  );

  setInterval(() => {

    if (rootKey) {
      return;
    }

    ws.send(
      JSON.stringify({
        type:
          "getPreKeyBundle",

        target:
          targetId
      })
    );

  }, 2000);
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

    rootKey =
      result.rootKey;

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

        target:
          targetId,

        ephemeralPublic:
          result.ephemeralPublic,

        identityKey:
          identity
            .getPublicKeyBase64()
      })
    );

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

    rootKey =
      X3DHManager.responder(

        identity.getPrivateKey(),

        preKeys.getSignedPreKeyPrivate(),

        preKeys.getOneTimePreKeyPrivate(),

        remoteEphemeral,

        remoteIdentity
      );

    console.log(
      "X3DH responder session established"
    );

    return;
  }

  if (msg.type === "message") {

    const decrypted =
      CryptoManager.decrypt(
        msg.payload.encrypted,
        msg.payload.iv,
        msg.payload.tag,
        rootKey
      );

    console.log();
    console.log(
      `[${msg.from}] ${decrypted}`
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

  if (!rootKey) {

    console.log(
      "session not established"
    );

    rl.prompt();

    return;
  }

  const encrypted =
    CryptoManager.encrypt(
      line,
      rootKey
    );

  ws.send(
    JSON.stringify({
      type: "message",
      from: userId,
      target: targetId,
      payload: encrypted
    })
  );

  rl.prompt();
});
