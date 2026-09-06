import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";
import Legal from "@/pages/Legal";
import { useAppStore } from "@/store/AppStore";

async function mountAt(path: string) {
  useAppStore.setState({ route: { path, params: {}, query: {} } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Legal));
  });
  const text = host.textContent ?? "";
  act(() => root.unmount());
  host.remove();
  return text;
}

describe("Legal pages (§209)", () => {
  it("Impressum zeigt Entwurf und § 5 DDG", async () => {
    const text = await mountAt("/impressum");
    expect(text).toContain("§ 5 DDG");
    expect(text).toContain("[Name / Firma — Einstellungen]");
  });

  it("Datenschutz nennt DSGVO und Self-Host", async () => {
    const text = await mountAt("/datenschutz");
    expect(text).toContain("DSGVO");
    expect(text).toContain("Self-Host");
  });

  it("AGB verweist auf den Entwurfsordner, kein Fake-Preis", async () => {
    const text = await mountAt("/agb");
    expect(text).toContain("AGB_AVV_ENTWURF");
    expect(text).not.toContain("19 €/Monat Theater");
    expect(text).toContain("1.790");
  });
});
