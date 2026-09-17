import { getSodium } from "./sodium";
import { kdfRootKey, kdfChainKey } from "./kdf";
import { bytesToBase64, base64ToBytes, concatBytes, bytesEqual } from "./bytes";
import type { KeyPair } from "./identity";

const MAX_SKIP = 1000;

export type WireMessage = {
  dh: string;
  pn: number;
  n: number;
  nonce: string;
  ciphertext: string;
};

type SkippedKey = { dh: string; n: number };

interface RatchetState {
  dhSelf: KeyPair;
  dhRemote: Uint8Array | null;
  rootKey: Uint8Array;
  chainKeySend: Uint8Array | null;
  chainKeyRecv: Uint8Array | null;
  nSend: number;
  nRecv: number;
  pn: number;
  skipped: Map<string, Uint8Array>; // key: `${dhBase64}:${n}`
  associatedData: Uint8Array;
}

function skippedKey(k: SkippedKey): string {
  return `${k.dh}:${k.n}`;
}

async function generateDhKeyPair(): Promise<KeyPair> {
  const sodium = await getSodium();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

async function dh(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_scalarmult(privateKey, publicKey);
}

async function aeadEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const sodium = await getSodium();
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    associatedData,
    null,
    nonce,
    key
  );
  return { nonce, ciphertext };
}

async function aeadDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  associatedData: Uint8Array
): Promise<Uint8Array> {
  const sodium = await getSodium();
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    associatedData,
    nonce,
    key
  );
}

export class RatchetSession {
  private state: RatchetState;

  private constructor(state: RatchetState) {
    this.state = state;
  }

  // The party that already knows the peer's DH public key at session start
  // (and therefore can send the first message).
  static async initAsInitiator(
    sharedSecret: Uint8Array,
    peerDhPublicKey: Uint8Array,
    associatedData: Uint8Array
  ): Promise<RatchetSession> {
    const dhSelf = await generateDhKeyPair();
    const dhOutput = await dh(dhSelf.privateKey, peerDhPublicKey);
    const { rootKey, chainKey } = await kdfRootKey(sharedSecret, dhOutput);
    return new RatchetSession({
      dhSelf,
      dhRemote: peerDhPublicKey,
      rootKey,
      chainKeySend: chainKey,
      chainKeyRecv: null,
      nSend: 0,
      nRecv: 0,
      pn: 0,
      skipped: new Map(),
      associatedData,
    });
  }

  // The party that waits for the initiator's first message before it can
  // derive a sending chain.
  static async initAsResponder(
    sharedSecret: Uint8Array,
    ownDhKeyPair: KeyPair,
    associatedData: Uint8Array
  ): Promise<RatchetSession> {
    return new RatchetSession({
      dhSelf: ownDhKeyPair,
      dhRemote: null,
      rootKey: sharedSecret,
      chainKeySend: null,
      chainKeyRecv: null,
      nSend: 0,
      nRecv: 0,
      pn: 0,
      skipped: new Map(),
      associatedData,
    });
  }

  async encrypt(plaintext: string): Promise<WireMessage> {
    if (!this.state.chainKeySend) {
      throw new Error("No sending chain established yet");
    }
    const { chainKey, messageKey } = await kdfChainKey(this.state.chainKeySend);
    this.state.chainKeySend = chainKey;

    const header = {
      dh: bytesToBase64(this.state.dhSelf.publicKey),
      pn: this.state.pn,
      n: this.state.nSend,
    };
    this.state.nSend += 1;

    const ad = concatBytes(this.state.associatedData, encodeHeader(header));
    const { nonce, ciphertext } = await aeadEncrypt(
      messageKey,
      new TextEncoder().encode(plaintext),
      ad
    );

    return {
      ...header,
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(ciphertext),
    };
  }

  async decrypt(msg: WireMessage): Promise<string> {
    const skipped = this.trySkippedMessageKeys(msg);
    if (skipped) return this.finishDecrypt(skipped, msg);

    const msgDh = base64ToBytes(msg.dh);
    if (!this.state.dhRemote || !bytesEqual(msgDh, this.state.dhRemote)) {
      if (this.state.chainKeyRecv) {
        await this.skipMessageKeys(msg.pn);
      }
      await this.dhRatchet(msgDh);
    }

    await this.skipMessageKeys(msg.n);

    if (!this.state.chainKeyRecv) {
      throw new Error("No receiving chain established");
    }
    const { chainKey, messageKey } = await kdfChainKey(this.state.chainKeyRecv);
    this.state.chainKeyRecv = chainKey;
    this.state.nRecv += 1;

    return this.finishDecrypt(messageKey, msg);
  }

  private async finishDecrypt(messageKey: Uint8Array, msg: WireMessage): Promise<string> {
    const ad = concatBytes(
      this.state.associatedData,
      encodeHeader({ dh: msg.dh, pn: msg.pn, n: msg.n })
    );
    const plaintext = await aeadDecrypt(
      messageKey,
      base64ToBytes(msg.nonce),
      base64ToBytes(msg.ciphertext),
      ad
    );
    return new TextDecoder().decode(plaintext);
  }

  private trySkippedMessageKeys(msg: WireMessage): Uint8Array | null {
    const key = skippedKey({ dh: msg.dh, n: msg.n });
    const messageKey = this.state.skipped.get(key);
    if (!messageKey) return null;
    this.state.skipped.delete(key);
    return messageKey;
  }

  private async skipMessageKeys(until: number): Promise<void> {
    if (!this.state.chainKeyRecv) return;
    if (this.state.nRecv + MAX_SKIP < until) {
      throw new Error("Too many skipped messages");
    }
    while (this.state.nRecv < until) {
      const { chainKey, messageKey } = await kdfChainKey(this.state.chainKeyRecv);
      this.state.chainKeyRecv = chainKey;
      const dhB64 = this.state.dhRemote ? bytesToBase64(this.state.dhRemote) : "";
      this.state.skipped.set(skippedKey({ dh: dhB64, n: this.state.nRecv }), messageKey);
      this.state.nRecv += 1;
    }
  }

  private async dhRatchet(newDhRemote: Uint8Array): Promise<void> {
    this.state.pn = this.state.nSend;
    this.state.nSend = 0;
    this.state.nRecv = 0;
    this.state.dhRemote = newDhRemote;

    const dhOutputRecv = await dh(this.state.dhSelf.privateKey, this.state.dhRemote);
    const recvKdf = await kdfRootKey(this.state.rootKey, dhOutputRecv);
    this.state.rootKey = recvKdf.rootKey;
    this.state.chainKeyRecv = recvKdf.chainKey;

    this.state.dhSelf = await generateDhKeyPair();
    const dhOutputSend = await dh(this.state.dhSelf.privateKey, this.state.dhRemote);
    const sendKdf = await kdfRootKey(this.state.rootKey, dhOutputSend);
    this.state.rootKey = sendKdf.rootKey;
    this.state.chainKeySend = sendKdf.chainKey;
  }

  toJSON(): string {
    return JSON.stringify({
      dhSelf: {
        publicKey: bytesToBase64(this.state.dhSelf.publicKey),
        privateKey: bytesToBase64(this.state.dhSelf.privateKey),
      },
      dhRemote: this.state.dhRemote ? bytesToBase64(this.state.dhRemote) : null,
      rootKey: bytesToBase64(this.state.rootKey),
      chainKeySend: this.state.chainKeySend ? bytesToBase64(this.state.chainKeySend) : null,
      chainKeyRecv: this.state.chainKeyRecv ? bytesToBase64(this.state.chainKeyRecv) : null,
      nSend: this.state.nSend,
      nRecv: this.state.nRecv,
      pn: this.state.pn,
      skipped: Array.from(this.state.skipped.entries()).map(([k, v]) => [k, bytesToBase64(v)]),
      associatedData: bytesToBase64(this.state.associatedData),
    });
  }

  static fromJSON(json: string): RatchetSession {
    const parsed = JSON.parse(json) as {
      dhSelf: { publicKey: string; privateKey: string };
      dhRemote: string | null;
      rootKey: string;
      chainKeySend: string | null;
      chainKeyRecv: string | null;
      nSend: number;
      nRecv: number;
      pn: number;
      skipped: [string, string][];
      associatedData: string;
    };
    return new RatchetSession({
      dhSelf: {
        publicKey: base64ToBytes(parsed.dhSelf.publicKey),
        privateKey: base64ToBytes(parsed.dhSelf.privateKey),
      },
      dhRemote: parsed.dhRemote ? base64ToBytes(parsed.dhRemote) : null,
      rootKey: base64ToBytes(parsed.rootKey),
      chainKeySend: parsed.chainKeySend ? base64ToBytes(parsed.chainKeySend) : null,
      chainKeyRecv: parsed.chainKeyRecv ? base64ToBytes(parsed.chainKeyRecv) : null,
      nSend: parsed.nSend,
      nRecv: parsed.nRecv,
      pn: parsed.pn,
      skipped: new Map(parsed.skipped.map(([k, v]) => [k, base64ToBytes(v)])),
      associatedData: base64ToBytes(parsed.associatedData),
    });
  }
}

function encodeHeader(header: { dh: string; pn: number; n: number }): Uint8Array {
  return new TextEncoder().encode(`${header.dh}:${header.pn}:${header.n}`);
}
