import type { ClassificationNode } from "./types";

// Narchi Master Classification (NMC) — native, hierarchical construction
// classification system used to organise every building element.
export const NMC_TREE: ClassificationNode[] = [
  {
    code: "NMC-10",
    label: "Site & Context",
    group: "Site",
    level: 0,
    description: "Plot boundaries, ground conditions and external environment.",
    children: [
      {
        code: "NMC-10-10",
        label: "Earthworks",
        group: "Site",
        level: 1,
        description: "Excavation, fill and ground preparation.",
        children: [
          { code: "NMC-10-10-10", label: "Cut & Fill", group: "Site", level: 2, description: "Bulk excavation and engineered fill." },
          { code: "NMC-10-10-20", label: "Retaining Walls", group: "Site", level: 2, description: "Permanent ground retention." },
        ],
      },
      {
        code: "NMC-10-20",
        label: "Paving & Hardstand",
        group: "Site",
        level: 1,
        description: "External surfaces and access roads.",
        children: [
          { code: "NMC-10-20-10", label: "Vehicular Paving", group: "Site", level: 2, description: "Roads and loading areas." },
          { code: "NMC-10-20-20", label: "Pedestrian Paving", group: "Site", level: 2, description: "Footpaths and plazas." },
        ],
      },
    ],
  },
  {
    code: "NMC-20",
    label: "Substructure",
    group: "Substructure",
    level: 0,
    description: "Foundations and below-grade structure.",
    children: [
      {
        code: "NMC-20-10",
        label: "Foundations",
        group: "Substructure",
        level: 1,
        description: "Load transfer to the ground.",
        children: [
          { code: "NMC-20-10-10", label: "Raft Slab", group: "Substructure", level: 2, description: "Continuous foundation slab." },
          { code: "NMC-20-10-20", label: "Piled Foundation", group: "Substructure", level: 2, description: "Deep piles and caps." },
        ],
      },
      {
        code: "NMC-20-20",
        label: "Basement Walls",
        group: "Substructure",
        level: 1,
        description: "Waterproof below-grade enclosure.",
        children: [
          { code: "NMC-20-20-10", label: "Reinforced Concrete Wall", group: "Substructure", level: 2, description: "Tank retaining wall." },
        ],
      },
    ],
  },
  {
    code: "NMC-30",
    label: "Primary Structure",
    group: "Structure",
    level: 0,
    description: "Vertical and horizontal load-bearing frame.",
    children: [
      {
        code: "NMC-30-10",
        label: "Columns",
        group: "Structure",
        level: 1,
        description: "Vertical load-bearing members.",
        children: [
          { code: "NMC-30-10-10", label: "Reinforced Concrete Column", group: "Structure", level: 2, description: "Cast in-situ column." },
          { code: "NMC-30-10-20", label: "Structural Steel Column", group: "Structure", level: 2, description: "Hot-rolled steel section." },
        ],
      },
      {
        code: "NMC-30-20",
        label: "Beams",
        group: "Structure",
        level: 1,
        description: "Horizontal spanning members.",
        children: [
          { code: "NMC-30-20-10", label: "Steel Beam", group: "Structure", level: 2, description: "Floor and roof beams." },
          { code: "NMC-30-20-20", label: "Engineered Timber Beam", group: "Structure", level: 2, description: "Glulam primary beam." },
        ],
      },
      {
        code: "NMC-30-30",
        label: "Floor Structures",
        group: "Structure",
        level: 1,
        description: "Horizontal floor assemblies.",
        children: [
          { code: "NMC-30-30-10", label: "Flat Slab", group: "Structure", level: 2, description: "Reinforced concrete flat slab." },
          { code: "NMC-30-30-20", label: "Composite Slab", group: "Structure", level: 2, description: "Deck and topping." },
        ],
      },
    ],
  },
  {
    code: "NMC-40",
    label: "Envelope & Facade",
    group: "Envelope",
    level: 0,
    description: "External walls, glazing and weather sealing.",
    children: [
      {
        code: "NMC-40-10",
        label: "External Walls",
        group: "Envelope",
        level: 1,
        description: "Weather-facing wall assemblies.",
        children: [
          { code: "NMC-40-10-10", label: "Curtain Wall", group: "Envelope", level: 2, description: " Framed glazed wall." },
          { code: "NMC-40-10-20", label: "Brick Cavity Wall", group: "Envelope", level: 2, description: "Masonry rainscreen." },
        ],
      },
      {
        code: "NMC-40-20",
        label: "Openings",
        group: "Envelope",
        level: 1,
        description: "Doors, windows and glazing.",
        children: [
          { code: "NMC-40-20-10", label: "Window Assembly", group: "Envelope", level: 2, description: "Fenestration units." },
          { code: "NMC-40-20-20", label: "External Door", group: "Envelope", level: 2, description: "Entrance and access doors." },
        ],
      },
      {
        code: "NMC-40-30",
        label: "Roofing",
        group: "Envelope",
        level: 1,
        description: "Roof coverings and drainage.",
        children: [
          { code: "NMC-40-30-10", label: "Flat Roof", group: "Envelope", level: 2, description: "Membrane roof system." },
        ],
      },
    ],
  },
  {
    code: "NMC-50",
    label: "Interiors",
    group: "Interiors",
    level: 0,
    description: "Internal partitions, finishes and circulation.",
    children: [
      {
        code: "NMC-50-10",
        label: "Internal Partitions",
        group: "Interiors",
        level: 1,
        description: "Non-load-bearing dividers.",
        children: [
          { code: "NMC-50-10-10", label: "Plasterboard Partition", group: "Interiors", level: 2, description: "Stud and board wall." },
        ],
      },
      {
        code: "NMC-50-20",
        label: "Floor Finishes",
        group: "Interiors",
        level: 1,
        description: "Applied floor surfaces.",
        children: [
          { code: "NMC-50-20-10", label: "Resin Flooring", group: "Interiors", level: 2, description: "Seamless resin finish." },
          { code: "NMC-50-20-20", label: "Ceramic Tiling", group: "Interiors", level: 2, description: "Fired ceramic finish." },
        ],
      },
    ],
  },
  {
    code: "NMC-60",
    label: "Building Services",
    group: "Services",
    level: 0,
    description: "Mechanical, electrical and plumbing systems.",
    children: [
      {
        code: "NMC-60-10",
        label: "Mechanical",
        group: "Services",
        level: 1,
        description: "HVAC and air distribution.",
        children: [
          { code: "NMC-60-10-10", label: "Ductwork", group: "Services", level: 2, description: "Air distribution ducts." },
        ],
      },
      {
        code: "NMC-60-20",
        label: "Electrical & Power",
        group: "Services",
        level: 1,
        description: "Power distribution and renewables.",
        children: [
          { code: "NMC-60-20-10", label: "Photovoltaic Array", group: "Services", level: 2, description: "Rooftop generation." },
        ],
      },
      {
        code: "NMC-60-30",
        label: "Plumbing & Drainage",
        group: "Services",
        level: 1,
        description: "Water supply and waste.",
        children: [
          { code: "NMC-60-30-10", label: "Waste Pipework", group: "Services", level: 2, description: "Soil and waste drainage." },
        ],
      },
    ],
  },
];

export function flattenClassification(
  nodes: ClassificationNode[] = NMC_TREE
): ClassificationNode[] {
  const out: ClassificationNode[] = [];
  const walk = (list: ClassificationNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export const NMC_GROUPS = NMC_TREE.map((n) => ({
  code: n.code,
  label: n.label,
  group: n.group,
}));
