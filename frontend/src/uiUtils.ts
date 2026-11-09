import { useState, useEffect, useCallback } from 'react';
import { ApiError } from './api';

export function displayError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return error.message;
    const summary = `${error.message}${error.code ? ` (${error.code})` : ''}`;
    const details = Object.entries(error.fields ?? {})
      .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`))
      .join('; ');
    return details ? `${summary}: ${details}` : summary;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

const EMPTY_DEPENDENCIES: unknown[] = [];

export function useLoad<T>(load: () => Promise<T>, dependencies: unknown[] = EMPTY_DEPENDENCIES): {
  data: T | null;
  error: string;
  loading: boolean;
  reload: (showLoading?: boolean) => Promise<void>;
  setData: (data: T) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      setData(await load());
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      if (showLoading) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export function useRefreshOnFocus(reload: (showLoading?: boolean) => Promise<void>): void {
  useEffect(() => {
    const refresh = () => {
      void reload(false);
    };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [reload]);
}
