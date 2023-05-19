import { useSyncExternalStore } from "react";

import { decodeInvoice, unwrap } from "Util";
import LNDHubWallet from "./LNDHub";
import { NostrConnectWallet } from "./NostrWalletConnect";
import { setupWebLNWalletConfig, WebLNWallet } from "./WebLN";

export enum WalletKind {
  LNDHub = 1,
  LNC = 2,
  WebLN = 3,
  NWC = 4,
  Cashu = 5,
}

export enum WalletErrorCode {
  BadAuth = 1,
  NotEnoughBalance = 2,
  BadPartner = 3,
  InvalidInvoice = 4,
  RouteNotFound = 5,
  GeneralError = 6,
  NodeFailure = 7,
}

export class WalletError extends Error {
  code: WalletErrorCode;

  constructor(c: WalletErrorCode, msg: string) {
    super(msg);
    this.code = c;
  }
}

export const UnknownWalletError = {
  code: WalletErrorCode.GeneralError,
  message: "Unknown error",
} as WalletError;

export interface WalletInfo {
  fee: number;
  nodePubKey: string;
  alias: string;
  pendingChannels: number;
  activeChannels: number;
  peers: number;
  blockHeight: number;
  blockHash: string;
  synced: boolean;
  chains: string[];
  version: string;
}

export interface Login {
  service: string;
  save: () => Promise<void>;
  load: () => Promise<void>;
}

export interface InvoiceRequest {
  amount: Sats;
  memo?: string;
  expiry?: number;
}

export enum WalletInvoiceState {
  Pending = 0,
  Paid = 1,
  Expired = 2,
  Failed = 3,
}

export interface WalletInvoice {
  pr: string;
  paymentHash: string;
  memo: string;
  amount: MilliSats;
  fees: number;
  timestamp: number;
  preimage?: string;
  state: WalletInvoiceState;
}

export function prToWalletInvoice(pr: string) {
  const parsedInvoice = decodeInvoice(pr);
  if (parsedInvoice) {
    return {
      amount: parsedInvoice.amount ?? 0,
      memo: parsedInvoice.description,
      paymentHash: parsedInvoice.paymentHash ?? "",
      timestamp: parsedInvoice.timestamp ?? 0,
      state: parsedInvoice.expired ? WalletInvoiceState.Expired : WalletInvoiceState.Pending,
      pr,
    } as WalletInvoice;
  }
}

export type Sats = number;
export type MilliSats = number;

export interface LNWallet {
  isReady(): boolean;
  canAutoLogin(): boolean;
  getInfo: () => Promise<WalletInfo>;
  login: (password?: string) => Promise<boolean>;
  close: () => Promise<boolean>;
  getBalance: () => Promise<Sats>;
  createInvoice: (req: InvoiceRequest) => Promise<WalletInvoice>;
  payInvoice: (pr: string) => Promise<WalletInvoice>;
  getInvoices: () => Promise<WalletInvoice[]>;
}

export interface WalletConfig {
  id: string;
  kind: WalletKind;
  active: boolean;
  info: WalletInfo;
  data?: string;
}

export interface WalletStoreSnapshot {
  configs: Array<WalletConfig>;
  config?: WalletConfig;
  wallet?: LNWallet;
}

type WalletStateHook = (state: WalletStoreSnapshot) => void;

export class WalletStore {
  #configs: Array<WalletConfig>;
  #instance: Map<string, LNWallet>;

  #hooks: Array<WalletStateHook>;
  #snapshot: Readonly<WalletStoreSnapshot>;

  constructor() {
    this.#configs = [];
    this.#instance = new Map();
    this.#hooks = [];
    this.#snapshot = Object.freeze({
      configs: [],
    });
    this.load(false);
    setupWebLNWalletConfig(this);
    this.snapshotState();
  }

  hook(fn: WalletStateHook) {
    this.#hooks.push(fn);
    return () => {
      const idx = this.#hooks.findIndex(a => a === fn);
      this.#hooks = this.#hooks.splice(idx, 1);
    };
  }

  list() {
    return Object.freeze([...this.#configs]);
  }

  get() {
    const activeConfig = this.#configs.find(a => a.active);
    if (!activeConfig) {
      if (this.#configs.length === 0) {
        return undefined;
      }
      throw new Error("No active wallet config");
    }
    if (this.#instance.has(activeConfig.id)) {
      return unwrap(this.#instance.get(activeConfig.id));
    } else {
      const w = this.#activateWallet(activeConfig);
      if (w) {
        if ("then" in w) {
          w.then(wx => {
            this.#instance.set(activeConfig.id, wx);
            this.snapshotState();
          });
          return undefined;
        }
        return w;
      } else {
        throw new Error("Unable to activate wallet config");
      }
    }
  }

  add(cfg: WalletConfig) {
    this.#configs.push(cfg);
    this.save();
  }

  remove(id: string) {
    const idx = this.#configs.findIndex(a => a.id === id);
    if (idx === -1) {
      throw new Error("Wallet not found");
    }
    const [removed] = this.#configs.splice(idx, 1);
    if (removed.active && this.#configs.length > 0) {
      this.#configs[0].active = true;
    }
    this.save();
  }

  switch(id: string) {
    this.#configs.forEach(a => (a.active = a.id === id));
    this.save();
  }

  save() {
    const json = JSON.stringify(this.#configs);
    window.localStorage.setItem("wallet-config", json);
    this.snapshotState();
  }

  load(snapshot = true) {
    const cfg = window.localStorage.getItem("wallet-config");
    if (cfg) {
      this.#configs = JSON.parse(cfg);
    }
    if (snapshot) {
      this.snapshotState();
    }
  }

  free() {
    this.#instance.forEach(w => w.close());
  }

  getSnapshot() {
    return this.#snapshot;
  }

  snapshotState() {
    const newState = {
      configs: [...this.#configs],
      config: this.#configs.find(a => a.active),
      wallet: this.get(),
    } as WalletStoreSnapshot;
    this.#snapshot = Object.freeze(newState);
    for (const hook of this.#hooks) {
      console.debug(this.#snapshot);
      hook(this.#snapshot);
    }
  }

  #activateWallet(cfg: WalletConfig): LNWallet | Promise<LNWallet> | undefined {
    switch (cfg.kind) {
      case WalletKind.LNC: {
        return import("./LNCWallet").then(({ LNCWallet }) => LNCWallet.Empty());
      }
      case WalletKind.WebLN: {
        return new WebLNWallet();
      }
      case WalletKind.LNDHub: {
        return new LNDHubWallet(unwrap(cfg.data));
      }
      case WalletKind.NWC: {
        return new NostrConnectWallet(unwrap(cfg.data));
      }
      case WalletKind.Cashu: {
        return import("./Cashu").then(({ CashuWallet }) => new CashuWallet(unwrap(cfg.data)));
      }
    }
  }
}

export const Wallets = new WalletStore();
window.document.addEventListener("close", () => {
  Wallets.free();
});

export function useWallet() {
  return useSyncExternalStore<WalletStoreSnapshot>(
    h => Wallets.hook(h),
    () => Wallets.getSnapshot()
  );
}
