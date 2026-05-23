import crypto from "crypto";

import {
  PrivateKey,
  PublicKey
} from "@signalapp/libsignal-client";

import {
  SessionManager
} from "./session";

export class X3DHManager {
  static deriveRootKey(parts: Buffer[]) {
    const master = Buffer.concat(parts);

    const rootKey = crypto.hkdfSync(
      "sha256",
      master,
      Buffer.alloc(32),
      Buffer.from("MiniSignal"),
      32
    );

    return Buffer.from(rootKey);
  }

  static initiator(
    identityKey: PrivateKey,
    remoteIdentity: PublicKey,
    remoteSignedPreKey: PublicKey,
    remoteOneTimePreKey: PublicKey | null
  ) {
    const ephemeralKey = PrivateKey.generate();

    const dh1 = SessionManager.createSharedSecret(
      identityKey,
      remoteSignedPreKey
    );

    const dh2 = SessionManager.createSharedSecret(
      ephemeralKey,
      remoteIdentity
    );

    const dh3 = SessionManager.createSharedSecret(
      ephemeralKey,
      remoteSignedPreKey
    );

    const dhParts: Buffer[] = [
      Buffer.from(dh1),
      Buffer.from(dh2),
      Buffer.from(dh3),
    ];

    if (remoteOneTimePreKey) {
      const dh4 = SessionManager.createSharedSecret(
        ephemeralKey,
        remoteOneTimePreKey
      );

      dhParts.push(Buffer.from(dh4));
    }

    const rootKey = this.deriveRootKey(dhParts);

    return {
      ephemeralPublic: Buffer
        .from(
          ephemeralKey
            .getPublicKey()
            .serialize()
        )
        .toString("base64"),

      rootKey: rootKey.toString("base64"),
    };
  }

  static responder(
    identityKey: PrivateKey,
    signedPreKey: PrivateKey,
    oneTimePreKey: PrivateKey | null,
    remoteEphemeral: PublicKey,
    remoteIdentity: PublicKey
  ) {
    const dh1 = SessionManager.createSharedSecret(
      signedPreKey,
      remoteIdentity
    );

    const dh2 = SessionManager.createSharedSecret(
      identityKey,
      remoteEphemeral
    );

    const dh3 = SessionManager.createSharedSecret(
      signedPreKey,
      remoteEphemeral
    );

    const dhParts: Buffer[] = [
      Buffer.from(dh1),
      Buffer.from(dh2),
      Buffer.from(dh3),
    ];

    if (oneTimePreKey) {
      const dh4 = SessionManager.createSharedSecret(
        oneTimePreKey,
        remoteEphemeral
      );

      dhParts.push(Buffer.from(dh4));
    }

    const rootKey = this.deriveRootKey(dhParts);

    return rootKey.toString("base64");
  }
}