import { create } from "zustand";

type ShiftState = {
  terminalId: number;
  shiftId: number | null;
  isOpen: boolean;
  setShift: (shiftId: number | null) => void;
  setTerminalId: (terminalId: number) => void;
};

export const useShiftStore = create<ShiftState>((set) => ({
  terminalId: 1,
  shiftId: null,
  isOpen: false,
  setShift: (shiftId) =>
    set({ shiftId, isOpen: shiftId !== null }),
  setTerminalId: (terminalId) => set({ terminalId }),
}));
