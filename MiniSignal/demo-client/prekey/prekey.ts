import {
  PrivateKey
} from "@signalapp/libsignal-client";

export class PreKeyManager {

  identityKey: PrivateKey;

  signedPreKey: PrivateKey;

  oneTimePreKey: PrivateKey;

  constructor(
    identityKey: PrivateKey
  ) {

    this.identityKey =
      identityKey;

    this.signedPreKey =
      PrivateKey.generate();

    this.oneTimePreKey =
      PrivateKey.generate();
  }

  getBundle() {
    const signedPreKeyPublicBase64 = Buffer.from(
      this.signedPreKey.getPublicKey().serialize()
    ).toString("base64");

    const signature = this.identityKey.sign(
      Buffer.from(signedPreKeyPublicBase64, "utf8")
    );

    return {
      identityKey: Buffer.from(
        this.identityKey.getPublicKey().serialize()
      ).toString("base64"),

      signedPreKey: signedPreKeyPublicBase64,

      signedPreKeySignature: Buffer.from(signature).toString("base64"),

      oneTimePreKey: Buffer.from(
        this.oneTimePreKey.getPublicKey().serialize()
      ).toString("base64"),
    };
  }

  getSignedPreKeyPrivate() {
    return this.signedPreKey;
  }

  getOneTimePreKeyPrivate() {
    return this.oneTimePreKey;
  }
}