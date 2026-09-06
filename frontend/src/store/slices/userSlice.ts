/** USER SLICE — source de vérité unique de la session et des préférences UI. */

import type { StateCreator } from "zustand";
import type { SafeUser } from "@/lib/auth";
import type { State } from "../AppStore";

export type { SafeUser };

export interface UserSlice {
  user: SafeUser | null;
  settings: {
    densityUnit: "metric" | "imperial";
    currency: "EUR" | "USD" | "GBP";
    carbonDisplay: boolean;
    autoSync: boolean;
    notifications: boolean;
    reduceMotion: boolean;
  };
  setUser: (user: SafeUser | null) => void;
  updateSettings: (patch: Partial<UserSlice["settings"]>) => void;
  logout: () => void;
}

export const createUserSlice: StateCreator<State, [], [], UserSlice> = (set) => ({
  user: null,
  settings: {
    densityUnit: "metric",
    currency: "EUR",
    carbonDisplay: true,
    autoSync: true,
    notifications: true,
    reduceMotion: false,
  },
  setUser: (user) => set({ user }),
  updateSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
  logout: () => set({ user: null }),
});
