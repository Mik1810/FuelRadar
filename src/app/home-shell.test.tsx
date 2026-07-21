import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FuelRadarShell,
  resolveShellViewState,
  ShellStatePanel,
} from "@/app/home-shell";

describe("mobile MVP shell", () => {
  test("maps connectivity, location and origin to every runtime shell state", () => {
    expect(
      resolveShellViewState({
        online: false,
        geolocation: "watching",
        hasOrigin: true,
      }),
    ).toBe("offline");
    expect(
      resolveShellViewState({
        online: true,
        geolocation: "requesting",
        hasOrigin: false,
      }),
    ).toBe("loading");
    expect(
      resolveShellViewState({
        online: true,
        geolocation: "permission-denied",
        hasOrigin: false,
      }),
    ).toBe("error");
    expect(
      resolveShellViewState({
        online: true,
        geolocation: "idle",
        hasOrigin: false,
      }),
    ).toBe("initial");
    expect(
      resolveShellViewState({
        online: true,
        geolocation: "watching",
        hasOrigin: true,
      }),
    ).toBe("ready");
    expect(
      resolveShellViewState({
        online: true,
        geolocation: "requesting",
        hasOrigin: true,
      }),
    ).toBe("ready");
    expect(
      resolveShellViewState({
        online: true,
        geolocation: "permission-denied",
        hasOrigin: true,
      }),
    ).toBe("ready");
  });

  test("keeps all representable state messages semantic", () => {
    const scenarios = [
      ["initial", "Da dove vuoi cercare?"],
      ["loading", "Cerco la tua posizione…"],
      ["ready", "Posizione pronta"],
      ["error", "Posizione non disponibile"],
      ["offline", "Sei offline"],
      ["empty", "Nessun distributore trovato"],
    ] as const;

    for (const [state, title] of scenarios) {
      const markup = renderToStaticMarkup(<ShellStatePanel state={state} />);
      expect(markup).toContain(title);
      expect(markup).toContain(state === "error" || state === "offline" ? 'role="alert"' : 'role="status"');
    }
  });

  test("server-renders the non-map shell and defers browser-only mapping", () => {
    const markup = renderToStaticMarkup(<FuelRadarShell />);
    expect(markup.match(/<main/g)).toHaveLength(1);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("Vai al contenuto");
    expect(markup).toContain("Trova carburante vicino a te");
    expect(markup).toContain('aria-label="Navigazione principale"');
    expect(markup).not.toContain("leaflet-container");
  });
});
