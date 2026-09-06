import { describe, expect, it } from "vitest";
import { boxesFrameBBox, clashSectionPlanes, QC_XRAY_STORAGE_KEY, readQcXrayPreference, reconcileFocusBoxes, reconcileFocusPoint, sectionHalfExtent, writeQcXrayPreference } from "@/lib/qcFocus3d";

describe("qcFocus3d — réconciliation des repères du marqueur de clash", () => {
  it("conversion naïve quand aucune référence n'est disponible", () => {
    const res = reconcileFocusPoint({ center: [1, 2, 3], size: [4, 5, 6] }, null, null);
    expect(res).toEqual({
      // Convention web-ifc : (x, z, −y) — PAS un miroir (x, z, y).
      // Un point à y_ifc=2 retombe à z_three=−2 (côté opposé du plan).
      position: [1, 3, -2],
      size: [4, 6, 5],
      delta: [0, 0, 0],
      reconciled: false,
    });
  });

  it("deux frames identiques → correction nulle (delta ≈ 0)", () => {
    // Boîtes Z-up centrées sur l'origine ; scène = MONDE MIROIR des boîtes :
    // z_scene = −y_ifc → centre scène attendu (0, hauteur 10, 0).
    const boxes = [
      { center: { x: -5, y: -5, z: 0 }, size: { x: 5, y: 5, z: 5 } },
      { center: { x: 5, y: 5, z: 10 }, size: { x: 5, y: 5, z: 5 } },
    ];
    // cB = centre de la bbox boîtes [-10..10, -10..10, -5..15] = (0, 0, 5).
    // Monde miroir correspondant : centre scène [cB.x, cB.z, −cB.y] = (0, 5, 0).
    const scene = { min: [-10, 0, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    const res = reconcileFocusPoint({ center: [1, 2, 3], size: [1, 1, 1] }, boxes, scene);
    expect(res.delta).toEqual([0, 0, 0]);
    expect(res.position[0]).toBeCloseTo(1);
    expect(res.position[1]).toBeCloseTo(3); // hauteur = z_ifc
    expect(res.position[2]).toBeCloseTo(-2); // profondeur = −y_ifc (miroir)
  });

  it("MIROIR : un point hors axe (y_ifc ≠ 0) est placé du BON côté", () => {
    // Cauchemar utilisateur « places sans murs » : avec (x, z, y) ce point
    // tombait à +4 en profondeur ; la bonne convention le met à −4.
    const res = reconcileFocusPoint({ center: [0, 4, 1], size: [1, 1, 1] }, null, null);
    expect(res.position).toEqual([0, 1, -4]);
  });

  it("frames décalées (cas utilisateur : marqueur SOUS le bâtiment) → corrigé", () => {
    // Boîtes : barycentre des centres retiré (x+0, z=+10 — bâtiment « remonté »
    // dans la frame boîtes) ; scène : ancée étage (hauteur à 0)
    const boxes = [
      { center: { x: 0, y: 0, z: 10 }, size: { x: 10, y: 10, z: 5 } }, // bbox z: 5..15 → centre z 10
    ];
    const scene = { min: [-10, 0, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    // centre boîtes (0, 0, 10) ; centre scène (0, 5, 0)
    // delta three = (0-0, 5-10, 0-0) = (0, -5, 0)
    const res = reconcileFocusPoint({ center: [0, 0, 12], size: [1, 1, 1] }, boxes, scene);
    expect(res.reconciled).toBe(true);
    expect(res.position).toEqual([0, 12 - 5, 0]);
    expect(res.delta[1]).toBeCloseTo(-5);
  });

  it("garde-fou : delta absurde (> 2× diagonale) → conversion naïve", () => {
    const boxes = [{ center: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } }];
    const scene = { min: [0, 0, 0] as [number, number, number], max: [2, 2, 2] as [number, number, number] };
    // scène centre (1,1,1) vs boîtes centre (0,0,0) → delta 1,1,1... > 2×diag(≈3,46)? non → réconcilié
    const ok = reconcileFocusPoint({ center: [0, 0, 0], size: [1, 1, 1] }, boxes, scene);
    expect(ok.reconciled).toBe(true);
    const farScene = { min: [100, 100, 100] as [number, number, number], max: [102, 102, 102] as [number, number, number] };
    const ko = reconcileFocusPoint({ center: [0, 0, 0], size: [1, 1, 1] }, boxes, farScene);
    expect(ko.reconciled).toBe(false);
    expect(ko.delta).toEqual([0, 0, 0]);
  });

  it("boxesFrameBBox ignore les boîtes invalides", () => {
    expect(boxesFrameBBox([])).toBeNull();
    const bbox = boxesFrameBBox([
      { center: { x: 1, y: 1, z: 1 }, size: { x: 1, y: 1, z: 1 } },
      null as never,
    ]);
    expect(bbox?.min).toEqual([0, 0, 0]);
    expect(bbox?.max).toEqual([2, 2, 2]);
  });
});

describe("qcFocus3d — marquage chirurgical (bboxes individuelles)", () => {
  const boxes = [
    { center: { x: 0, y: 0, z: 5 }, size: { x: 10, y: 10, z: 5 } },
  ];
  const scene = { min: [-8, 0, -8] as [number, number, number], max: [12, 16, 12] as [number, number, number] };

  it("2 fautifs → 2 marqueurs corrigés + cible caméra d'union", () => {
    const res = reconcileFocusBoxes(
      {
        center: [0, 0, 10],
        size: [2, 2, 2],
        elements: [
          { center: [-2, 0, 8], size: [1, 1, 4] },   // mur
          { center: [2, 0, 12], size: [6, 6, 0.2] }, // dalle
        ],
      },
      boxes,
      scene,
    );
    expect(res.boxes).toHaveLength(2);
    // delta : scène centre (2, 8, 2) vs boîtes centre (0, 0, 5) → (2, 3, 2)
    expect(res.delta).toEqual([2, 3, 2]);
    // mur : naive (-2, 8, 0) + delta → (0, 11, 2)
    expect(res.boxes[0].position).toEqual([0, 11, 2]);
    expect(res.boxes[0].size).toEqual([1, 4, 1]); // Y-up : (x, z, y)
    // dalle : naive (2, 12, 0) + delta → (4, 15, 2)
    expect(res.boxes[1].position).toEqual([4, 15, 2]);
    // caméra sur l'union ; taille d'union convertie Y-up
    expect(res.cameraTarget).toEqual([2, 13, 2]);
    expect(res.cameraSize).toEqual([2, 2, 2]);
    expect(res.reconciled).toBe(true);
  });

  it("sans bboxes individuelles → repli cage d'union unique", () => {
    const res = reconcileFocusBoxes({ center: [1, 2, 3], size: [4, 5, 6] }, boxes, scene);
    expect(res.boxes).toHaveLength(1);
    // miroir (1, 3, −2) + delta (2, 3, 2) = (3, 6, 0)
    expect(res.boxes[0].position).toEqual([3, 6, 0]);
    expect(res.boxes[0].size).toEqual([4, 6, 5]);
  });

  it("sans référence de frame → conversion naïve par élément", () => {
    const res = reconcileFocusBoxes(
      { center: [0, 0, 0], size: [1, 1, 1], elements: [{ center: [7, 8, 9], size: [1, 2, 3] }] },
      null,
      null,
    );
    // miroir : (7, 9, −8) — la profondeur change de côté
    expect(res.boxes[0].position).toEqual([7, 9, -8]);
    expect(res.delta).toEqual([0, 0, 0]);
    expect(res.reconciled).toBe(false);
  });
});

describe("qcFocus3d — zone exacte (hotspot) + aperçu avant/après", () => {
  const boxes = [
    { center: { x: 0, y: 0, z: 5 }, size: { x: 10, y: 10, z: 5 } },
  ];
  const scene = { min: [-8, 0, -8] as [number, number, number], max: [12, 16, 12] as [number, number, number] };

  it("le hotspot est corrigé du MÊME delta que les fautifs", () => {
    const res = reconcileFocusBoxes(
      {
        center: [0, 0, 10],
        size: [2, 2, 2],
        elements: [{ center: [-2, 0, 8], size: [1, 1, 4] }],
        hotspot: { center: [-1.5, 0, 9], size: [0.2, 0.16, 0.3] }, // la bande exacte
      },
      boxes,
      scene,
    );
    // delta (2, 3, 2) comme pour les boxes — jamais un marqueur ailleurs.
    expect(res.hotspot).not.toBeNull();
    // naive(-1.5, 9, 0) + delta → (0.5, 12, 2)
    expect(res.hotspot!.position).toEqual([0.5, 12, 2]);
    expect(res.hotspot!.size).toEqual([0.2, 0.3, 0.16]); // Y-up : (x, z, y)
    expect(res.after).toBeNull();
  });

  it("l'aperçu Correction IA (from → to) est corrigé des deux côtés", () => {
    const res = reconcileFocusBoxes(
      {
        center: [0, 0, 10],
        size: [2, 2, 2],
        after: {
          from: { center: [0, 0, 8], size: [1, 1, 1] },
          to: { center: [0, 0.16, 8], size: [1, 1, 1] },
        },
      },
      boxes,
      scene,
    );
    expect(res.after).not.toBeNull();
    // from : miroir(0, 8, −0) + delta → (2, 11, 2)
    expect(res.after!.from.position).toEqual([2, 11, 2]);
    // to : +0,16 en y_ifc → −0,16 en z_scene (miroir !) → (2, 11, 1.84)
    expect(res.after!.to.position).toEqual([2, 11, 2 - 0.16]);
    expect(res.after!.to.size).toEqual([1, 1, 1]);
  });
});

describe("qcFocus3d — ancres EXACTES (fin du Δ empirique par bbox)", () => {
  it("Δ exact = ancre boîtes − shift scène, sans aucune bbox de référence", () => {
    // Takeoff : centerBoxesToOrigin a soustrait B = (10, 20, 3) (IFC Z-up).
    // Loader  : web-ifc a soustrait S = (5, 3.2, 8) (Y-up : x, z_hauteur, −y).
    // Δ exact = [Bx−Sx, Bz−Sy, −By−Sz] = [5, −0.2, −28] — MÊME sans bboxes.
    const anchors = { boxesAnchor: [10, 20, 3] as [number, number, number], sceneShift: [5, 3.2, 8] as [number, number, number] };
    const res = reconcileFocusBoxes(
      {
        center: [0, 0, 3],
        size: [2, 2, 2],
        elements: [{ center: [1, 2, 3], size: [1, 1, 1] }],
      },
      null, // <- volontairement AUCUNE boîte de référence
      null, // <- et AUCUNE bbox scène : les ancres suffisent
      anchors,
    );
    expect(res.reconciled).toBe(true);
    // Δ exact = [Bx−Sx, Bz−Sy, −By−Sz] (mêmes opérations → égalité exacte)
    expect(res.delta).toEqual([10 - 5, 3 - 3.2, -20 - 8]);
    // élément : miroir(1, 3, −2) + Δ → mêmes opérations
    expect(res.boxes[0].position).toEqual([1 + (10 - 5), 3 + (3 - 3.2), -2 + (-20 - 8)]);
  });

  it("les ancres priment sur l'empirique même avec des bboxes polluées", () => {
    // Une grille IFC géante (80 m) rend la bbox boîtes/scène incohérente :
    // l'empirique serait faux ; les ancres restent LA vérité.
    const boxes = [{ center: { x: 40, y: 40, z: 0 }, size: { x: 40, y: 40, z: 2 } }];
    const scene = { min: [-6, 0, -3] as [number, number, number], max: [6, 3.2, 3] as [number, number, number] };
    const anchors = { boxesAnchor: [100, 100, 0] as [number, number, number], sceneShift: [98, 0, 100] as [number, number, number] };
    const res = reconcileFocusBoxes(
      { center: [0, 0, 1], size: [4, 4, 3] },
      boxes,
      scene,
      anchors,
    );
    // Δ exact = [100−98, 0−0, −100−100] = [2, 0, −200] ; garde-fou ×4 :
    // diag scène = hypot(12, 3.2, 6) ≈ 13.5 → len(Δ) ≈ 200 > 54 → repli empirique.
    // (Ce garde-fou protège contre des ancres d'univers incompatibles.)
    expect(res.reconciled).toBe(false);

    // Mêmes ancres, scène assez grande pour admettre le shift → appliqué.
    const bigScene = { min: [-120, 0, -120] as [number, number, number], max: [120, 50, 120] as [number, number, number] };
    const res2 = reconcileFocusBoxes({ center: [0, 0, 1], size: [4, 4, 3] }, boxes, bigScene, anchors);
    expect(res2.delta).toEqual([2, 0, -200]);
    expect(res2.reconciled).toBe(true);
  });
});

describe("qcFocus3d — cube de section chirurgical", () => {
  it("le centre du hotspot est CONSERVÉ par les 6 plans", () => {
    const center: [number, number, number] = [3, 1.5, -2];
    const planes = clashSectionPlanes(center, [0.25, 0.25, 1.8]);
    for (const p of planes) {
      const dot = p.normal[0] * center[0] + p.normal[1] * center[1] + p.normal[2] * center[2] + p.constant;
      expect(dot).toBeGreaterThanOrEqual(0); // demi-espace conservé
    }
  });

  it("un point lointain est REJETÉ par au moins un plan (découpé)", () => {
    const center: [number, number, number] = [0, 0, 0];
    const planes = clashSectionPlanes(center, [0.3, 0.3, 0.3]);
    const far: [number, number, number] = [100, 0, 0];
    const kept = planes.every(
      (p) => p.normal[0] * far[0] + p.normal[1] * far[1] + p.normal[2] * far[2] + p.constant >= 0,
    );
    expect(kept).toBe(false); // le mur à 100 m est coupé — affichage net
  });

  it("demi-côté : 4× rayon hotspot, borné [1,2 m – 8 m]", () => {
    expect(sectionHalfExtent([0.2, 0.2, 0.2])).toBeCloseTo(1.2); // plancher
    expect(sectionHalfExtent([10, 10, 10])).toBeCloseTo(8);      // plafond
    expect(sectionHalfExtent([1.8, 0.25, 0.25])).toBeCloseTo(
      Math.min(Math.max((Math.hypot(1.8, 0.25, 0.25) / 2) * 4, 1.2), 8),
    );
  });
});

describe("préférence Solide ⇄ Röntgen (demande utilisateur 2026-08-06)", () => {
  it("SOLIDE est le défaut (aucune clé mémorisée, stockage lisible)", () => {
    localStorage.removeItem(QC_XRAY_STORAGE_KEY);
    expect(readQcXrayPreference()).toBe(false);
  });

  it("le choix Röntgen est mémorisé puis relu", () => {
    writeQcXrayPreference(true);
    expect(readQcXrayPreference()).toBe(true);
    writeQcXrayPreference(false);
    expect(readQcXrayPreference()).toBe(false);
  });

  it("stockage indisponible → SOLIDE, jamais d'exception", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("privacy mode");
      },
    });
    expect(readQcXrayPreference()).toBe(false);
    expect(() => writeQcXrayPreference(true)).not.toThrow();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: original,
    });
  });
});
