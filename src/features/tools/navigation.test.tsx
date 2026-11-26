// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { it, expect, vi } from "vitest";
import ToolsWorkspace from "./ToolsWorkspace";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "ko" }, t: (key: string) => key }),
}));
vi.mock("../../locales/i18n", () => ({
  default: { language: "ko", t: (key: string) => key },
}));
vi.mock("../../services/supabaseClient", () => ({ supabase: {} }));
const repo = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    owner: "owner",
    ready: true,
    hydrated: true,
    offline: false,
    error: "",
    items: [
      {
        status: "synced",
        doc: {
          id: "timer-workspace",
          owner_id: "owner",
          tool_id: "timer",
          title: "Timer",
          data: { _workspace: true, clocks: [] },
          revision: 1,
        },
      },
    ] as unknown[],
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => listeners.forEach((listener) => listener()),
    localOnlyDocuments: () => ({ documents: [], drafts: [] }),
    sync: vi.fn(),
    update: vi.fn(),
    create: vi.fn(async () => ({})),
  };
});
vi.mock("./repository", () => ({
  toolWorkspaceId: () => "timer-workspace",
  getToolRepository: () => repo,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it("returns from a General tool to the selected General category", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <MemoryRouter initialEntries={["/app/tools"]}>
          <ToolsWorkspace ownerId="owner" />
        </MemoryRouter>
      )
    );
    const general = () =>
      [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(
        (node) => node.textContent === "일반"
      )!;
    await act(() => general().click());
    expect(general().getAttribute("aria-selected")).toBe("true");
    await act(async () => {
      host
        .querySelector<HTMLAnchorElement>('a[href="/app/tools/timer"]')!
        .click();
      await import("./TimeTools");
    });
    const back = host.querySelector<HTMLAnchorElement>('a[aria-label="뒤로"]')!;
    expect(back.getAttribute("href")).toBe("/app/tools?category=General");
    await act(() => back.click());
    expect(general().getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('a[href="/app/tools/timer"]')).not.toBeNull();
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
it("waits for the first pull before creating a fixed-id workspace", async () => {
  const cached = repo.items;
  repo.items = [];
  repo.hydrated = false;
  repo.create.mockClear();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() =>
      root.render(
        <MemoryRouter initialEntries={["/app/tools/timer"]}>
          <ToolsWorkspace ownerId="owner" />
        </MemoryRouter>
      )
    );
    // The account may already hold this workspace; an empty local one created
    // now would shadow it and surface as a conflict.
    expect(repo.create).not.toHaveBeenCalled();
    expect(host.textContent).toContain("도구 여는 중");
    repo.hydrated = true;
    await act(async () => repo.emit());
    expect(repo.create).toHaveBeenCalledWith(
      "timer",
      "타이머",
      { _workspace: true },
      { id: "timer-workspace" }
    );
  } finally {
    await act(() => root.unmount());
    host.remove();
    repo.items = cached;
    repo.hydrated = true;
  }
});
