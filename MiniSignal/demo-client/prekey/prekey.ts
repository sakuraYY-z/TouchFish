import { PrivateKey } from "@signalapp/libsignal-client";
import fs from "fs";
import path from "path";

interface StoredOneTimePreKey {
  keyId: number;
  privateKey: string;
  publicKey: string;
}

interface StoredSignedPreKey {
  keyId: number;
  privateKey: string;
  publicKey: string;
}

export class PreKeyManager {
  private identityKey: PrivateKey;
  private currentSignedPreKeyId: number;
  private signedPreKeys: StoredSignedPreKey[];
  private oneTimePreKeys: StoredOneTimePreKey[];
  private storageDir: string;
  private storagePath: string;

  constructor(identityKey: PrivateKey) {
    this.identityKey = identityKey;
    this.oneTimePreKeys = [];
    this.storageDir = path.join(process.cwd(), "prekey-storage");
    this.storagePath = path.join(this.storageDir, "prekeys.json");

    const signedPreKey = PrivateKey.generate();

    this.currentSignedPreKeyId = 1;
    this.signedPreKeys = [
      {
        keyId: 1,
        privateKey: Buffer.from(signedPreKey.serialize()).toString("base64"),
        publicKey: Buffer.from(signedPreKey.getPublicKey().serialize()).toString("base64"),
      },
    ];

    for (let i = 1; i <= 5; i++) {
      const key = PrivateKey.generate();

      this.oneTimePreKeys.push({
        keyId: i,
        privateKey: Buffer.from(key.serialize()).toString("base64"),
        publicKey: Buffer.from(key.getPublicKey().serialize()).toString("base64"),
      });
    }
  }

  private getCurrentSignedPreKeyRecord() {
    const record = this.signedPreKeys.find(
      (item) => item.keyId === this.currentSignedPreKeyId
    );

    if (!record) {
      throw new Error(`missing current signedPreKey ${this.currentSignedPreKeyId}`);
    }

    return record;
  }

  getBundle() {
    const signedPreKeyRecord = this.getCurrentSignedPreKeyRecord();

    const signedPreKeySignature = this.identityKey.sign(
      Buffer.from(signedPreKeyRecord.publicKey, "utf8")
    );

    return {
      identityKey: Buffer.from(
        this.identityKey.getPublicKey().serialize()
      ).toString("base64"),

      signedPreKeyId: signedPreKeyRecord.keyId,

      signedPreKey: signedPreKeyRecord.publicKey,

      signedPreKeySignature: Buffer.from(signedPreKeySignature).toString("base64"),

      oneTimePreKeys: this.oneTimePreKeys.map((item) => ({
        keyId: item.keyId,
        publicKey: item.publicKey,
      })),
    };
  }

  getSignedPreKeyPrivate(keyId?: number | null) {
    const targetKeyId = keyId ?? this.currentSignedPreKeyId;

    const item = this.signedPreKeys.find((key) => key.keyId === targetKeyId);

    if (!item) {
      return null;
    }

    return PrivateKey.deserialize(Buffer.from(item.privateKey, "base64"));
  }

  getOneTimePreKeyPrivate(keyId: number | null | undefined) {
    if (keyId === null || keyId === undefined) {
      return null;
    }

    const item = this.oneTimePreKeys.find((key) => key.keyId === keyId);

    if (!item) {
      return null;
    }

    return PrivateKey.deserialize(Buffer.from(item.privateKey, "base64"));
  }

  consumeOneTimePreKey(keyId: number | null | undefined) {
    if (keyId === null || keyId === undefined) {
      return;
    }

    this.oneTimePreKeys = this.oneTimePreKeys.filter(
      (item) => item.keyId !== keyId
    );
  }

  ensureOneTimePreKeys(targetCount = 5) {
    let maxKeyId = 0;

    for (const item of this.oneTimePreKeys) {
      if (item.keyId > maxKeyId) {
        maxKeyId = item.keyId;
      }
    }

    while (this.oneTimePreKeys.length < targetCount) {
      maxKeyId += 1;

      const key = PrivateKey.generate();

      this.oneTimePreKeys.push({
        keyId: maxKeyId,
        privateKey: Buffer.from(key.serialize()).toString("base64"),
        publicKey: Buffer.from(key.getPublicKey().serialize()).toString("base64"),
      });

      console.log(`generated new oneTimePreKey: ${maxKeyId}`);
    }

    this.save();
  }

  private save() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    fs.writeFileSync(
      this.storagePath,
      JSON.stringify(
        {
          currentSignedPreKeyId: this.currentSignedPreKeyId,
          signedPreKeys: this.signedPreKeys,
          oneTimePreKeys: this.oneTimePreKeys,
        },
        null,
        2
      ),
      "utf8"
    );
  }

  rotateSignedPreKey() {
    let maxKeyId = 0;

    for (const item of this.signedPreKeys) {
      if (item.keyId > maxKeyId) {
        maxKeyId = item.keyId;
      }
    }

    const nextKeyId = maxKeyId + 1;
    const key = PrivateKey.generate();

    this.signedPreKeys.push({
      keyId: nextKeyId,
      privateKey: Buffer.from(key.serialize()).toString("base64"),
      publicKey: Buffer.from(key.getPublicKey().serialize()).toString("base64"),
    });

    this.currentSignedPreKeyId = nextKeyId;

    /**
     * 教学版：最多保留最近 3 个 signedPreKey 私钥。
     * 真实系统会根据时间和未完成会话做更复杂的保留策略。
     */
    this.signedPreKeys = this.signedPreKeys
      .sort((a, b) => b.keyId - a.keyId)
      .slice(0, 3)
      .sort((a, b) => a.keyId - b.keyId);

    this.save();

    console.log(`rotated signedPreKey to id=${nextKeyId}`);

    return nextKeyId;
  }
}