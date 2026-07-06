import assert from "assert";

import { CryptoManager } from "../demo-client/crypto/crypto";
import { RatchetManager } from "../demo-client/session/ratchet";
import { ReplayProtection } from "../demo-client/session/replayProtection";
import { SessionStore } from "../demo-client/session/sessionStore";
import {
  CipherMessage,
  consumeOneTimePreKey,
  countOneTimePreKeys,
  enqueueOfflineMessage,
  getPreKeyBundle,
  getRegisteredDevices,
  pullOfflineMessages,
  saveOrMergePreKeyBundle,
  saveRegisteredDevice,
} from "../local-server/db";

function testSQLiteStorage() {
  const suffix = Date.now();

  const userId = `test_user_${suffix}`;
  const deviceId = "desktop";

  saveRegisteredDevice({
    userId,
    deviceId,
    publicKey: "test-public-key",
    lastSeen: Date.now(),
  });

  const devices = getRegisteredDevices(userId);

  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].userId, userId);
  assert.strictEqual(devices[0].deviceId, deviceId);

  saveOrMergePreKeyBundle(userId, deviceId, {
    identityKey: "identity-key-test",
    signedPreKeyId: 1,
    signedPreKey: "signed-prekey-test",
    signedPreKeySignature: "signature-test",
    oneTimePreKeys: [
      {
        keyId: 1,
        publicKey: "one-time-prekey-1",
      },
      {
        keyId: 2,
        publicKey: "one-time-prekey-2",
      },
    ],
  });

  const bundle = getPreKeyBundle(userId, deviceId);

  assert.ok(bundle);
  assert.strictEqual(bundle?.identityKey, "identity-key-test");
  assert.strictEqual(bundle?.oneTimePreKeys.length, 2);

  const countBefore = countOneTimePreKeys(userId, deviceId);
  assert.strictEqual(countBefore, 2);

  const consumed = consumeOneTimePreKey(userId, deviceId);

  assert.ok(consumed);
  assert.strictEqual(consumed?.keyId, 1);

  const countAfter = countOneTimePreKeys(userId, deviceId);
  assert.strictEqual(countAfter, 1);

  const offlineMessage: CipherMessage = {
    type: "message",
    from: "alice",
    fromDeviceId: "desktop",
    target: userId,
    targetDeviceId: deviceId,
    messageNumber: 1,
    payload: {
      encrypted: "encrypted-test",
      iv: "iv-test",
      tag: "tag-test",
    },
    timestamp: Date.now(),
    ratchetPublicKey: "ratchet-public-key-test",
    previousSendCounter: 0,
  };

  enqueueOfflineMessage(offlineMessage);

  const pulled = pullOfflineMessages(userId, deviceId);

  assert.strictEqual(pulled.length, 1);
  assert.strictEqual(pulled[0].target, userId);
  assert.strictEqual(pulled[0].payload.encrypted, "encrypted-test");

  const pulledAgain = pullOfflineMessages(userId, deviceId);

  assert.strictEqual(pulledAgain.length, 0);

  console.log("✅ SQLite 服务端数据库存储测试通过");
}
function testCryptoEncryptDecrypt() {
  const secret = "test-shared-secret";
  const plaintext = "hello minisignal";
  const aad = Buffer.from("alice->bob");

  const encrypted = CryptoManager.encrypt(plaintext, secret, aad);
  const decrypted = CryptoManager.decrypt(
    encrypted.encrypted,
    encrypted.iv,
    encrypted.tag,
    secret,
    aad
  );

  assert.strictEqual(decrypted, plaintext);
  console.log("✅ CryptoManager encrypt/decrypt 测试通过");
}

function testCryptoTamperReject() {
  const secret = "test-shared-secret";
  const plaintext = "hello minisignal";
  const aad = Buffer.from("alice->bob");

  const encrypted = CryptoManager.encrypt(plaintext, secret, aad);

  assert.throws(() => {
    CryptoManager.decrypt(
      encrypted.encrypted,
      encrypted.iv,
      encrypted.tag,
      secret,
      Buffer.from("wrong-aad")
    );
  });

  console.log("✅ AES-GCM 篡改检测测试通过");
}

function testReplayProtection() {
  // 清空静态 Set，防止重复运行测试互相影响
  (ReplayProtection as any).processed.clear();

  const from = "alice/desktop";
  const number = 1;

  assert.strictEqual(ReplayProtection.seen(from, number), false);

  ReplayProtection.mark(from, number);

  assert.strictEqual(ReplayProtection.seen(from, number), true);

  console.log("✅ ReplayProtection 防重放测试通过");
}

function testRatchetManager() {
  const chainKey = Buffer.from("test-chain-key");

  const result1 = RatchetManager.kdfChain(chainKey);
  const result2 = RatchetManager.kdfChain(chainKey);

  assert.ok(Buffer.isBuffer(result1.nextChainKey));
  assert.ok(Buffer.isBuffer(result1.messageKey));

  // 同一个 chainKey 派生结果应该稳定一致
  assert.strictEqual(
    result1.nextChainKey.toString("base64"),
    result2.nextChainKey.toString("base64")
  );

  assert.strictEqual(
    result1.messageKey.toString("base64"),
    result2.messageKey.toString("base64")
  );

  // nextChainKey 和 messageKey 不应该相同
  assert.notStrictEqual(
    result1.nextChainKey.toString("base64"),
    result1.messageKey.toString("base64")
  );

  console.log("✅ Chain Ratchet KDF 测试通过");
}

function testSessionStore() {
  const state: any = {
    version: 3,
    localUserId: "test_alice",
    localDeviceId: "desktop",
    remoteUserId: "test_bob",
    remoteDeviceId: "phone",

    rootKey: "root-key-test",
    sendChainKey: "send-chain-key-test",
    recvChainKey: "recv-chain-key-test",

    sendCounter: 0,
    recvCounter: 0,

    localRatchetPrivateKey: "local-private-key-test",
    localRatchetPublicKey: "local-public-key-test",
    remoteRatchetPublicKey: null,

    previousSendCounter: 0,
    skippedMessageKeys: {},
    processedMessageIds: {}
  };

  SessionStore.save(state);

  const loaded = SessionStore.load(
    "test_alice",
    "desktop",
    "test_bob",
    "phone"
  );

  assert.ok(loaded);
  assert.strictEqual(loaded?.localUserId, "test_alice");
  assert.strictEqual(loaded?.remoteUserId, "test_bob");
  assert.strictEqual(loaded?.version, 3);

  SessionStore.delete(
    "test_alice",
    "desktop",
    "test_bob",
    "phone"
  );

  const deleted = SessionStore.load(
    "test_alice",
    "desktop",
    "test_bob",
    "phone"
  );

  assert.strictEqual(deleted, null);

  console.log("✅ SessionStore 保存/读取/删除测试通过");
}

function runAllTests() {
  console.log("开始运行 MiniSignal 单元测试...\n");

  testCryptoEncryptDecrypt();
  testCryptoTamperReject();
  testReplayProtection();
  testRatchetManager();
  testSessionStore();
  testSQLiteStorage();

  console.log("\n🎉 所有测试通过！");
}

runAllTests();