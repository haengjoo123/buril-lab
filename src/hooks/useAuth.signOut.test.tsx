// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ error: null })),
  prepareToolSignOut: vi.fn(),
  closeToolRepository: vi.fn(async () => {}),
  cancelToolNotifications: vi.fn(async () => {}),
}));
vi.mock("../services/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "u1" } } },
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signOut: mocks.signOut,
    },
  },
}));
vi.mock("../locales/i18n", () => ({ default: { language: "ko" } }));
vi.mock("../features/tools/repository", () => ({
  prepareToolSignOut: mocks.prepareToolSignOut,
  closeToolRepository: mocks.closeToolRepository,
}));
vi.mock("../features/tools/notifications", () => ({
  cancelToolNotifications: mocks.cancelToolNotifications,
}));
import { useAuth } from "./useAuth";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let signOut: () => Promise<void>;
let unmount: () => Promise<void>;
function Probe({ onSignOut }: { onSignOut: (fn: () => Promise<void>) => void }) {
  const auth = useAuth();
  useEffect(() => onSignOut(auth.signOut), [onSignOut, auth.signOut]);
  return null;
}
const document1 = { id: "d1", title: "Mix" } as never;
beforeEach(async () => {
  Object.values(mocks).forEach((mock) => mock.mockClear());
  const host = document.createElement("div");
  const root = createRoot(host);
  // The second act lets the mocked session resolve so the hook knows the user.
  const keep = (fn: () => Promise<void>) => {
    signOut = fn;
  };
  await act(async () => root.render(<Probe onSignOut={keep} />));
  await act(async () => {});
  unmount = async () => act(() => root.unmount());
});
afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

it("signs out without asking when nothing exists only on this device", async () => {
  mocks.prepareToolSignOut.mockResolvedValue({
    documents: [],
    drafts: [],
    images: 0,
  });
  const confirm = vi.spyOn(window, "confirm");
  await act(() => signOut());
  expect(mocks.prepareToolSignOut).toHaveBeenCalledWith("u1");
  expect(confirm).not.toHaveBeenCalled();
  expect(mocks.closeToolRepository).toHaveBeenCalledWith("u1");
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
});

it("stays signed in and keeps the cache when the user declines to lose unsynced work", async () => {
  mocks.prepareToolSignOut.mockResolvedValue({
    documents: [document1],
    drafts: [],
    images: 2,
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(() => signOut());
  expect(confirm.mock.calls[0][0]).toContain("동기화되지 않은 작업 1개");
  expect(confirm.mock.calls[0][0]).toContain("이미지 2개");
  expect(mocks.closeToolRepository).not.toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it("clears the cache and signs out once the user accepts the loss", async () => {
  mocks.prepareToolSignOut.mockResolvedValue({
    documents: [],
    drafts: [document1],
    images: 0,
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await act(() => signOut());
  expect(mocks.closeToolRepository).toHaveBeenCalledWith("u1");
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
});

it("still signs out when the check itself fails", async () => {
  mocks.prepareToolSignOut.mockRejectedValue(new Error("IndexedDB closed"));
  await act(() => signOut());
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
});
