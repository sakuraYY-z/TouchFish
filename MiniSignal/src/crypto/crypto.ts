import crypto from "crypto";

export class CryptoManager {

  static deriveKey(rootKey: string) {

    return crypto
      .createHash("sha256")
      .update(rootKey)
      .digest();
  }

  static encrypt(
    plaintext: string,
    rootKey: string
  ) {

    const key =
      this.deriveKey(rootKey);

    const iv =
      crypto.randomBytes(12);

    const cipher =
      crypto.createCipheriv(
        "aes-256-gcm",
        key,
        iv
      );

    let encrypted =
      cipher.update(
        plaintext,
        "utf8",
        "base64"
      );

    encrypted += cipher.final("base64");

    const tag =
      cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString("base64"),
      tag: tag.toString("base64")
    };
  }

  static decrypt(
    encrypted: string,
    iv: string,
    tag: string,
    rootKey: string
  ) {

    const key =
      this.deriveKey(rootKey);

    const decipher =
      crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64")
      );

    decipher.setAuthTag(
      Buffer.from(tag, "base64")
    );

    let decrypted =
      decipher.update(
        encrypted,
        "base64",
        "utf8"
      );

    decrypted += decipher.final("utf8");

    return decrypted;
  }
}