import { wallet, offers, agreements, reputation, node, rpc } from './tauri';

export type CommandResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'err'; message: string }
  | { kind: 'text'; text: string };

type Handler = {
  usage: string;
  description: string;
  minArgs: number;
  maxArgs: number;
  run: (args: string[]) => Promise<unknown>;
};

const WALLET_PREFIXES = ['wallet', 'irium-wallet'] as const;
const RPC_PREFIXES = ['rpc', 'iriumd'] as const;

const irmToSats = (amount: string): number => {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid IRM amount: ${amount}`);
  }
  return Math.round(parsed * 1e8);
};

const REGISTRY: Record<string, Handler> = {
  'wallet balance': {
    usage: 'wallet balance',
    description: 'Show confirmed and pending wallet balance.',
    minArgs: 0,
    maxArgs: 0,
    run: () => wallet.balance(),
  },
  'wallet list-addresses': {
    usage: 'wallet list-addresses',
    description: 'List every address derived from the active wallet.',
    minArgs: 0,
    maxArgs: 0,
    run: () => wallet.listAddresses(),
  },
  'wallet history': {
    usage: 'wallet history [limit]',
    description: 'Show recent transactions. Default limit 20, max 500.',
    minArgs: 0,
    maxArgs: 1,
    run: ([limitArg]) => {
      const limit = limitArg ? Math.max(1, Math.min(500, parseInt(limitArg, 10))) : 20;
      if (limitArg && !Number.isFinite(limit)) throw new Error(`invalid limit: ${limitArg}`);
      return wallet.transactions(limit);
    },
  },
  'wallet send': {
    usage: 'wallet send <from> <to> <amount_irm>',
    description: 'Send IRM from one of your addresses to another address.',
    minArgs: 3,
    maxArgs: 3,
    run: ([from, to, amount]) => wallet.send(from, to, irmToSats(amount)),
  },
  'wallet offer-list': {
    usage: 'wallet offer-list',
    description: 'List marketplace offers known to your node.',
    minArgs: 0,
    maxArgs: 0,
    run: () => offers.list(),
  },
  'wallet offer-show': {
    usage: 'wallet offer-show <offer_id>',
    description: 'Show full detail for a specific marketplace offer.',
    minArgs: 1,
    maxArgs: 1,
    run: ([id]) => offers.show(id),
  },
  'wallet agreement-list': {
    usage: 'wallet agreement-list',
    description: 'List settlement agreements your wallet knows about.',
    minArgs: 0,
    maxArgs: 0,
    run: () => agreements.list(),
  },
  'wallet reputation-show': {
    usage: 'wallet reputation-show <pubkey_or_address>',
    description: 'Show reputation ledger entries for an Irium address.',
    minArgs: 1,
    maxArgs: 1,
    run: ([who]) => reputation.show(who),
  },
  'rpc status': {
    usage: 'rpc status',
    description: 'Live node status: height, peers, sync, P2P info.',
    minArgs: 0,
    maxArgs: 0,
    run: () => node.status(),
  },
  'rpc network-hashrate': {
    usage: 'rpc network-hashrate',
    description: 'Estimated network hashrate from recent block intervals.',
    minArgs: 0,
    maxArgs: 0,
    run: () => rpc.networkHashrate(),
  },
  'rpc block-by-height': {
    usage: 'rpc block-by-height <height>',
    description: 'Fetch a block at the given height (also accepts a 64-hex block hash).',
    minArgs: 1,
    maxArgs: 1,
    run: ([heightOrHash]) => rpc.block(heightOrHash),
  },
};

const BUILTIN_HELP: { command: string; description: string }[] = [
  { command: 'help', description: 'Show this list of commands.' },
  { command: 'clear', description: 'Clear the terminal output.' },
  { command: 'history', description: 'List previously entered commands this session.' },
];

const normalizeKey = (tokens: string[]): { key: string; argsStart: number } | null => {
  if (tokens.length === 0) return null;
  const first = tokens[0].toLowerCase();
  if ((WALLET_PREFIXES as readonly string[]).includes(first)) {
    if (tokens.length < 2) return null;
    return { key: `wallet ${tokens[1]}`, argsStart: 2 };
  }
  if ((RPC_PREFIXES as readonly string[]).includes(first)) {
    if (tokens.length < 2) return null;
    return { key: `rpc ${tokens[1]}`, argsStart: 2 };
  }
  return null;
};

export function isBuiltin(input: string): 'help' | 'clear' | 'history' | null {
  const t = input.trim().toLowerCase();
  if (t === 'help') return 'help';
  if (t === 'clear') return 'clear';
  if (t === 'history') return 'history';
  return null;
}

export function buildHelpText(): string {
  const lines: string[] = [];
  lines.push('Allowed commands:');
  lines.push('');
  for (const [, h] of Object.entries(REGISTRY)) {
    lines.push(`  ${h.usage.padEnd(48)}  ${h.description}`);
  }
  lines.push('');
  lines.push('Built-in:');
  for (const b of BUILTIN_HELP) {
    lines.push(`  ${b.command.padEnd(48)}  ${b.description}`);
  }
  lines.push('');
  lines.push('Notes:');
  lines.push('  - "irium-wallet" is an accepted alias for "wallet".');
  lines.push('  - Amounts for "wallet send" are in IRM (decimal accepted).');
  lines.push('  - Anything not in this list is blocked. There is no shell access.');
  lines.push('  - Use up/down arrows to navigate previously entered commands.');
  return lines.join('\n');
}

export async function runCommand(input: string): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: 'text', text: '' };
  }
  const builtin = isBuiltin(trimmed);
  if (builtin === 'help') {
    return { kind: 'text', text: buildHelpText() };
  }
  if (builtin === 'clear' || builtin === 'history') {
    return { kind: 'text', text: '' };
  }

  const tokens = trimmed.split(/\s+/);
  const normalized = normalizeKey(tokens);
  if (!normalized) {
    return {
      kind: 'err',
      message: `unknown command: ${tokens[0]}. type 'help' to see allowed commands.`,
    };
  }

  const handler = REGISTRY[normalized.key];
  if (!handler) {
    return {
      kind: 'err',
      message: `command not in whitelist: ${normalized.key}. type 'help' to see allowed commands.`,
    };
  }

  const args = tokens.slice(normalized.argsStart);
  if (args.length < handler.minArgs || args.length > handler.maxArgs) {
    return {
      kind: 'err',
      message: `usage: ${handler.usage}`,
    };
  }

  try {
    const data = await handler.run(args);
    return { kind: 'ok', data };
  } catch (e) {
    return { kind: 'err', message: e instanceof Error ? e.message : String(e) };
  }
}
