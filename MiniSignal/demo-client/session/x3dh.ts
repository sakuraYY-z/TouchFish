import crypto from "crypto";

import {
  PrivateKey,
  PublicKey
} from "@signalapp/libsignal-client";

import {
  SessionManager
} from "./session";

export class X3DHManager {

  static deriveRootKey(
    parts: Buffer[]
  ) {

    const master =
      Buffer.concat(parts);

    return crypto.hkdfSync(
      "sha256",
      master,
      Buffer.alloc(32),
      Buffer.from(
        "MiniSignal"
      ),
      32
    );
  }

  static initiator(
    identityKey: PrivateKey,

    remoteIdentity: PublicKey,

    remoteSignedPreKey: PublicKey,

    remoteOneTimePreKey: PublicKey
  ) {

    // Alice Ephemeral
    const ephemeralKey =
      PrivateKey.generate();

    // DH1 = IKa × SPKb
    const dh1 =
      SessionManager
        .createSharedSecret(
          identityKey,
          remoteSignedPreKey
        );

    // DH2 = EKa × IKb
    const dh2 =
      SessionManager
        .createSharedSecret(
          ephemeralKey,
          remoteIdentity
        );

    // DH3 = EKa × SPKb
    const dh3 =
      SessionManager
        .createSharedSecret(
          ephemeralKey,
          remoteSignedPreKey
        );

    // DH4 = EKa × OPKb
    const dh4 =
      SessionManager
        .createSharedSecret(
          ephemeralKey,
          remoteOneTimePreKey
        );

    const rootKey =
      this.deriveRootKey([
        Buffer.from(dh1),
        Buffer.from(dh2),
        Buffer.from(dh3),
        Buffer.from(dh4)
      ]);

    // 修复: 确保 rootKey 被正确转换为 base64 字符串
    // 假设 rootKey 是 Uint8Array 或 Buffer
    const rootKeyBase64 = Buffer.from(rootKey).toString("base64");

    return {

      ephemeralPublic:
        Buffer
          .from(
            ephemeralKey
              .getPublicKey()
              .serialize()
          )
          .toString("base64"),

      rootKey:
        rootKeyBase64
    };
  }

  static responder(
    identityKey: PrivateKey,

    signedPreKey: PrivateKey,

    oneTimePreKey: PrivateKey,

    remoteEphemeral: PublicKey,

    remoteIdentity: PublicKey
  ) {

    // DH1 = SPKb × IKa
    const dh1 =
      SessionManager
        .createSharedSecret(
          signedPreKey,
          remoteIdentity
        );

    // DH2 = IKb × EKa
    const dh2 =
      SessionManager
        .createSharedSecret(
          identityKey,
          remoteEphemeral
        );

    // DH3 = SPKb × EKa
    const dh3 =
      SessionManager
        .createSharedSecret(
          signedPreKey,
          remoteEphemeral
        );

    // DH4 = OPKb × EKa
    const dh4 =
      SessionManager
        .createSharedSecret(
          oneTimePreKey,
          remoteEphemeral
        );

    const rootKey =
      this.deriveRootKey([
        Buffer.from(dh1),
        Buffer.from(dh2),
        Buffer.from(dh3),
        Buffer.from(dh4)
      ]);

    return Buffer.from(rootKey).toString("base64");
  }
}