import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

const ROUTES = [
  '/dashboard',
  '/wallet',
  '/settlement',
  '/marketplace',
  '/agreements',
  '/reputation',
  '/miner',
  '/settings',
];

export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+1-8: navigate
      if (ctrl && !e.shiftKey && !e.altKey) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 8) {
          e.preventDefault();
          navigate(ROUTES[n - 1]);
          return;
        }
      }

      // Ctrl+R: refresh event
      if (ctrl && !e.shiftKey && e.key === 'r') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('irium:refresh'));
        return;
      }

      // Ctrl+N: open receive
      if (ctrl && !e.shiftKey && e.key === 'n') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('irium:open-receive'));
        return;
      }

      // Ctrl+S: open send
      if (ctrl && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('irium:open-send'));
        return;
      }

      // Escape: close modal
      if (e.key === 'Escape') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('irium:close-modal'));
        return;
      }

      // Ctrl+Shift+D: dev toast
      if (ctrl && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        toast('Dev mode: shortcuts active', { icon: '⌨️' });
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);
}
