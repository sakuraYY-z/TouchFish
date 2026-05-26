import fs from "fs";
import path from "path";
import { PrivateKey } from "@signalapp/libsignal-client";

interface StoredOneTimePreKey {
  keyId: number;
  privateKey: string;
  publicKey: string;
}

export class PreKeyManager {
  private identityKey: PrivateKey;
  private signedPreKey: PrivateKey;
  private oneTimePreKeys: StoredOneTimePreKey[];

  constructor(identityKey: PrivateKey) {
    this.identityKey = identityKey;
    this.signedPreKey = PrivateKey.generate();
    this.oneTimePreKeys = [];

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

      signedPreKey: signedPreKeyPublicBase64,

      signedPreKeySignature: Buffer.from(signedPreKeySignature).toString("base64"),

      oneTimePreKeys: this.oneTimePreKeys.map((item) => ({
        keyId: item.keyId,
        publicKey: item.publicKey,
      })),
    };
  }

  getSignedPreKeyPrivate() {
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
}