// Tauri command wrapper — typed interface to Rust backend
import { invoke } from "@tauri-apps/api/tauri";
import type {
  NodeStatus,
  NodeStartResult,
  WalletBalance,
  AddressInfo,
  SendResult,
  Transaction,
  Offer,
  CreateOfferParams,
  CreateOfferResult,
  OfferTakeResult,
  FeedEntry,
  FeedSyncResult,
  Agreement,
  CreateAgreementParams,
  AgreementResult,
  ReleaseResult,
  Proof,
  ProofSubmitResult,
  Reputation,
  MinerStatus,
  OtcParams,
  FreelanceParams,
  MilestoneParams,
  DepositParams,
  PeerInfo,
  MempoolInfo,
} from "./types";

// ============================================================
// NODE
// ============================================================

export const node = {
  start: (dataDir?: string) =>
    invoke<NodeStartResult>("start_node", { dataDir }),

  stop: () => invoke<boolean>("stop_node"),

  status: () => invoke<NodeStatus>("get_node_status"),
};

// ============================================================
// WALLET
// ============================================================

export const wallet = {
  balance: () => invoke<WalletBalance>("wallet_get_balance"),

  newAddress: () => invoke<string>("wallet_new_address"),

  listAddresses: () => invoke<AddressInfo[]>("wallet_list_addresses"),

  send: (to: string, amountSats: number, feeSats?: number) =>
    invoke<SendResult>("wallet_send", { to, amountSats, feeSats }),

  transactions: (limit?: number) =>
    invoke<Transaction[]>("wallet_transactions", { limit }),

  setPath: (path: string) => invoke<boolean>("wallet_set_path", { path }),
};

// ============================================================
// OFFERS
// ============================================================

export const offers = {
  list: (params?: {
    source?: "local" | "remote" | "all";
    sort?: "newest" | "amount" | "score";
    limit?: number;
    minAmount?: number;
    maxAmount?: number;
    payment?: string;
  }) =>
    invoke<Offer[]>("offer_list", {
      source: params?.source,
      sort: params?.sort,
      limit: params?.limit,
      minAmount: params?.minAmount,
      maxAmount: params?.maxAmount,
      payment: params?.payment,
    }),

  show: (offerId: string) => invoke<Offer>("offer_show", { offerId }),

  create: (params: CreateOfferParams) =>
    invoke<CreateOfferResult>("offer_create", { params }),

  take: (offerId: string) =>
    invoke<OfferTakeResult>("offer_take", { offerId }),

  export: (offerId: string, outPath: string) =>
    invoke<boolean>("offer_export", { offerId, outPath }),

  import: (filePath: string) => invoke<boolean>("offer_import", { filePath }),
};

// ============================================================
// FEEDS
// ============================================================

export const feeds = {
  add: (url: string) => invoke<boolean>("feed_add", { url }),
  remove: (url: string) => invoke<boolean>("feed_remove", { url }),
  list: () => invoke<FeedEntry[]>("feed_list"),
  sync: () => invoke<FeedSyncResult>("feed_sync"),
  fetch: (url: string) => invoke<Offer[]>("feed_fetch", { url }),
  prune: () => invoke<boolean>("feed_prune"),
};

// ============================================================
// AGREEMENTS
// ============================================================

export const agreements = {
  list: () => invoke<Agreement[]>("agreement_list"),

  show: (agreementId: string) =>
    invoke<Agreement>("agreement_show", { agreementId }),

  create: (params: CreateAgreementParams) =>
    invoke<AgreementResult>("agreement_create", { params }),

  pack: (agreementId: string, outPath: string) =>
    invoke<boolean>("agreement_pack", { agreementId, outPath }),

  unpack: (filePath: string) =>
    invoke<Agreement>("agreement_unpack", { filePath }),

  release: (agreementId: string) =>
    invoke<ReleaseResult>("agreement_release", { agreementId }),

  refund: (agreementId: string) =>
    invoke<ReleaseResult>("agreement_refund", { agreementId }),
};

// ============================================================
// PROOFS
// ============================================================

export const proofs = {
  list: (agreementId?: string) =>
    invoke<Proof[]>("proof_list", { agreementId }),

  sign: (agreementId: string, proofData: string, outPath: string) =>
    invoke<boolean>("proof_sign", { agreementId, proofData, outPath }),

  submit: (agreementId: string, proofFile: string) =>
    invoke<ProofSubmitResult>("proof_submit", { agreementId, proofFile }),
};

// ============================================================
// REPUTATION
// ============================================================

export const reputation = {
  show: (pubkeyOrAddr: string) =>
    invoke<Reputation>("reputation_show", { pubkeyOrAddr }),
};

// ============================================================
// SETTLEMENT TEMPLATES
// ============================================================

export const settlement = {
  otc: (params: OtcParams) =>
    invoke<AgreementResult>("settlement_create_otc", { params }),

  freelance: (params: FreelanceParams) =>
    invoke<AgreementResult>("settlement_create_freelance", { params }),

  milestone: (params: MilestoneParams) =>
    invoke<AgreementResult>("settlement_create_milestone", { params }),

  deposit: (params: DepositParams) =>
    invoke<AgreementResult>("settlement_create_deposit", { params }),
};

// ============================================================
// MINER
// ============================================================

export const miner = {
  start: (address: string, threads?: number) =>
    invoke<boolean>("start_miner", { address, threads }),

  stop: () => invoke<boolean>("stop_miner"),

  status: () => invoke<MinerStatus>("get_miner_status"),
};

// ============================================================
// RPC DIRECT
// ============================================================

export const rpc = {
  peers: () => invoke<PeerInfo[]>("rpc_get_peers"),
  mempool: () => invoke<MempoolInfo>("rpc_get_mempool"),
  block: (heightOrHash: string) =>
    invoke<Record<string, unknown>>("rpc_get_block", { heightOrHash }),
  offersFeed: () => invoke<unknown>("rpc_get_offers_feed"),
  setUrl: (url: string) => invoke<boolean>("rpc_set_url", { url }),
};
