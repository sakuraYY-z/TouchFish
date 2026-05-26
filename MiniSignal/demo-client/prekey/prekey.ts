import { PrivateKey } from "@signalapp/libsignal-client";
import fs from "fs";
import path from "path";

interface StoredOneTimePreKey {
  keyId: number;
  privateKey: string;
  publicKey: string;
}

export class PreKeyManager {
  private identityKey: PrivateKey;
  private signedPreKeyId: number;
  private signedPreKey: PrivateKey;
  private oneTimePreKeys: StoredOneTimePreKey[];
  private storageDir: string;
  private storagePath: string;

  constructor(identityKey: PrivateKey) {
    this.identityKey = identityKey;
    this.signedPreKeyId = 1;
    this.signedPreKey = PrivateKey.generate();
    this.oneTimePreKeys = [];
    this.storageDir = path.join(process.cwd(), "prekey-storage");
    this.storagePath = path.join(this.storageDir, "prekeys.json");

    for (let i = 1; i <= 5; i++) {
      const key = PrivateKey.generate();

      this.oneTimePreKeys.push({
        keyId: i,
        privateKey: Buffer.from(key.serialize()).toString("base64"),
        publicKey: Buffer.from(key.getPublicKey().serialize()).toString("base64"),
      });
    }
  }

  getBundle() {
    const signedPreKeyPublicBase64 = Buffer.from(
      this.signedPreKey.getPublicKey().serialize()
    ).toString("base64");

    const signedPreKeySignature = this.identityKey.sign(
      Buffer.from(signedPreKeyPublicBase64, "utf8")
    );

    return {
      identityKey: Buffer.from(
        this.identityKey.getPublicKey().serialize()
      ).toString("base64"),

      signedPreKeyId: this.signedPreKeyId,

      signedPreKey: signedPreKeyPublicBase64,

      signedPreKeySignature: Buffer.from(signedPreKeySignature).toString("base64"),

      oneTimePreKeys: this.oneTimePreKeys.map((item) => ({
        keyId: item.keyId,
        publicKey: item.publicKey,
      })),
    };
  }

  getSignedPreKeyPrivate(keyId?: number | null) {
    if (keyId !== undefined && keyId !== null && keyId !== this.signedPreKeyId) {
      return null;
    }

    return this.signedPreKey;
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
          signedPreKeyId: this.signedPreKeyId,
          signedPreKey: Buffer.from(this.signedPreKey.serialize()).toString("base64"),
          oneTimePreKeys: this.oneTimePreKeys,
        },
        null,
        2
      ),
      "utf8"
    );
  }
}