export function getUserMessage(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch'))
      return 'Network error — check your node connection.';
    if (msg.includes('timeout') || msg.includes('timed out'))
      return 'Request timed out. Is the node running?';
    if (msg.includes('not found') || msg.includes('404'))
      return 'Resource not found.';
    if (msg.includes('unauthorized') || msg.includes('401') || msg.includes('403'))
      return 'Permission denied. Check your RPC token settings.';
    if (msg.includes('insufficient') || msg.includes('balance'))
      return 'Insufficient funds.';
    if (msg.includes('wallet'))
      return 'Wallet error — ensure your wallet is unlocked.';
    if (msg.includes('node') || msg.includes('iriumd'))
      return 'Node error — try restarting iriumd.';
    return error.message;
  }
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred.';
}
