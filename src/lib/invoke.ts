import { invoke } from '@tauri-apps/api/tauri';

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

function mockDelay(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 400));
}

export async function safeInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  mockFn: () => T,
): Promise<T> {
  if (isTauri) {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      throw typeof e === 'string' ? e : String(e);
    }
  }
  console.warn(`[irium mock] ${cmd}`, args);
  await mockDelay();
  return mockFn();
}
