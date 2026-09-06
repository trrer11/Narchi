import { describe, expect, it } from "vitest";
import { useAppStore } from "./AppStore";
import { indexedDbStateStorage } from "./indexedDbStorage";
import type { ModelTakeoff } from "@/lib/modelTakeoff";

const takeoff: ModelTakeoff = {
  format: "IFC",
  precision: "exact",
  precisionNote: "test",
  fileName: "test.ifc",
  fileSize: 42,
  projectName: "Test",
  author: "Test",
  organization: "NARCHI",
  schema: "IFC4",
  storeys: ["EG"],
  ngf: 100,
  volume: 300,
  elements: [],
  kgBuckets: [],
  boxes: [],
  ifcObjectUrl: "blob:must-not-survive-refresh",
  sourceFile: new File(["ISO-10303-21"], "test.ifc"),
  totals: { count: 0, cost: 0, carbonKg: 0, weightKg: 0, perM2: 0 },
  warnings: [],
};

describe("Zustand IndexedDB persistence", () => {
  it("persiste le takeoff mais exclut File et blob URL non sérialisables", async () => {
    useAppStore.getState().setTakeoff(takeoff);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const raw = await indexedDbStateStorage.getItem("narchi:app-state:v5");
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!) as {
      state: { takeoff: ModelTakeoff };
    };
    expect(persisted.state.takeoff.fileName).toBe("test.ifc");
    expect(persisted.state.takeoff.ifcObjectUrl).toBeUndefined();
    expect(persisted.state.takeoff.sourceFile).toBeUndefined();

    useAppStore.getState().setTakeoff(null);
  });
});
