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
vi.mock("./repository", () => ({
  toolWorkspaceId: () => "timer-workspace",
  getToolRepository: () => ({
    owner: "owner",
    ready: true,
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
    ],
    subscribe: () => () => {},
    sync: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  }),
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
