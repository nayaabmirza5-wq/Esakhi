import { createContext, useContext } from 'react';
import type { User } from './types';

export type AuthContextValue = {
  user: User | null;
  ready: boolean;
  setSession: (user: User, token: string) => void;
  signOut: () => Promise<void>;
  reloadUser: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('Auth context is unavailable.');
  return context;
}
