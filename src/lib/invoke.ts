import { invoke } from '@tauri-apps/api/tauri';

export async function safeInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw typeof e === 'string' ? e : String(e);
  }
}
