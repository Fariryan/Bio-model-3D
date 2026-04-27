import fs from "node:fs";
import path from "node:path";

const outputDir = path.resolve("src/data");

const modelTemplates = [
  {
    id: "human-cortical-neuron",
    name: "Human Cortical Projection Neuron",
    species: "Human",
    tissue: "Cerebral cortex",
    sampleType: "Human",
    complexity: "High",
    score: 98,
    summary: "Highly polarized neuronal architecture optimized for long-range signaling.",
    summaryLong:
      "This model emphasizes synaptic trafficking pressure, polarized membrane domains, and mitochondrial clustering patterns associated with human cortical projection neurons in active tissue samples.",
    tags: ["neuron", "synapse", "human", "electrical", "polarized", "axon"],
    palette: {
      membrane: "#67e8ff",
      membraneGlow: "#0b3040",
      nucleus: "#f3b6ff",
      mitochondria: "#ff8f6a",
      golgi: "#ffd676",
      reticulum: "#66f0bf",
      lysosome: "#ff6eac",
      vesicle: "#82e4ff",
      cytoskeleton: "#7d8fff",
      ribosome: "#f5f9ff",
    },
    geometry: { radius: 2.45, nucleusRadius: 0.92, wrinkleScale: 3.1, wrinkleAmp: 0.06 },
    components: { mitochondria: 18, reticulum: 9, vesicles: 22, lysosomes: 10, ribosomes: 380, filaments: 28 },
    metrics: { organelles: 468, permeability: 42, stressBase: 4.7, atpReserve: 91, cytoskeletalBias: "Axonal" },
  },
  {
    id: "human-hepatocyte",
    name: "Human Hepatocyte Detoxification Unit",
    species: "Human",
    tissue: "Liver",
    sampleType: "Human",
    complexity: "High",
    score: 95,
    summary: "Metabolically intense cell with expansive reticulum and trafficking burden.",
    summaryLong:
      "This configuration amplifies smooth and rough endoplasmic reticulum motifs, peroxisome-like vesicle traffic, and Golgi throughput characteristic of human hepatocytes processing mixed metabolic load.",
    tags: ["liver", "metabolism", "human", "detox", "secretory", "hepatocyte"],
    palette: {
      membrane: "#78f4d8",
      membraneGlow: "#0a3029",
      nucleus: "#ffbfe6",
      mitochondria: "#ff9770",
      golgi: "#ffe07e",
      reticulum: "#5af7bf",
      lysosome: "#ff6b8a",
      vesicle: "#9ae8ff",
      cytoskeleton: "#88a3ff",
      ribosome: "#fefefe",
    },
    geometry: { radius: 2.7, nucleusRadius: 0.98, wrinkleScale: 2.8, wrinkleAmp: 0.08 },
    components: { mitochondria: 24, reticulum: 11, vesicles: 28, lysosomes: 12, ribosomes: 440, filaments: 25 },
    metrics: { organelles: 539, permeability: 54, stressBase: 5.2, atpReserve: 96, cytoskeletalBias: "Canalicular" },
  },
  {
    id: "human-t-cell",
    name: "Human Activated Cytotoxic T Cell",
    species: "Human",
    tissue: "Immune system",
    sampleType: "Human",
    complexity: "Medium",
    score: 92,
    summary: "Compact immune effector cell primed for directional secretion and motility.",
    summaryLong:
      "The T cell model concentrates actin-rich cortical structure, lytic granule positioning, membrane ruffling, and rapid vesicle deployment associated with activated immune surveillance.",
    tags: ["immune", "human", "motility", "cytotoxic", "signaling", "lymphocyte"],
    palette: {
      membrane: "#6fddff",
      membraneGlow: "#143349",
      nucleus: "#cba8ff",
      mitochondria: "#ff8962",
      golgi: "#ffcb66",
      reticulum: "#5aeebb",
      lysosome: "#ff5b92",
      vesicle: "#8de2ff",
      cytoskeleton: "#6b8bff",
      ribosome: "#f7fbff",
    },
    geometry: { radius: 2.0, nucleusRadius: 0.95, wrinkleScale: 4.1, wrinkleAmp: 0.09 },
    components: { mitochondria: 10, reticulum: 7, vesicles: 18, lysosomes: 14, ribosomes: 240, filaments: 33 },
    metrics: { organelles: 321, permeability: 63, stressBase: 6.4, atpReserve: 78, cytoskeletalBias: "Cortical" },
  },
  {
    id: "human-cardiomyocyte",
    name: "Human Cardiomyocyte Contractile Unit",
    species: "Human",
    tissue: "Heart",
    sampleType: "Human",
    complexity: "High",
    score: 96,
    summary: "Energetically dense muscle cell organized around contractile force transmission.",
    summaryLong:
      "This atlas entry adapts cell-scale architecture into a compact volumetric model with high mitochondrial density, anisotropic filament emphasis, and calcium-handling vesicle motion.",
    tags: ["heart", "human", "contractile", "mitochondria", "excitation", "muscle"],
    palette: {
      membrane: "#67f0ff",
      membraneGlow: "#0f2f47",
      nucleus: "#ebb4ff",
      mitochondria: "#ff9c5f",
      golgi: "#ffd46a",
      reticulum: "#72f7d1",
      lysosome: "#ff7a8f",
      vesicle: "#8ae7ff",
      cytoskeleton: "#7194ff",
      ribosome: "#fbfdff",
    },
    geometry: { radius: 2.55, nucleusRadius: 0.78, wrinkleScale: 2.2, wrinkleAmp: 0.05 },
    components: { mitochondria: 30, reticulum: 8, vesicles: 20, lysosomes: 9, ribosomes: 410, filaments: 38 },
    metrics: { organelles: 515, permeability: 48, stressBase: 5.9, atpReserve: 99, cytoskeletalBias: "Sarcomeric" },
  },
  {
    id: "mouse-hippocampal-neuron",
    name: "Mouse Hippocampal CA1 Neuron",
    species: "Mouse",
    tissue: "Hippocampus",
    sampleType: "Animal",
    complexity: "High",
    score: 93,
    summary: "Plasticity-focused neuron with trafficking motifs tuned to memory circuitry.",
    summaryLong:
      "The mouse hippocampal model highlights receptor recycling, cytoskeletal remodeling, and compact mitochondrial lanes common to rodent pyramidal neurons used in learning studies.",
    tags: ["mouse", "neuron", "memory", "plasticity", "axon", "rodent"],
    palette: {
      membrane: "#6be2ff",
      membraneGlow: "#11303f",
      nucleus: "#dcb0ff",
      mitochondria: "#ffa06d",
      golgi: "#ffdd7b",
      reticulum: "#61f4c3",
      lysosome: "#ff6d96",
      vesicle: "#92edff",
      cytoskeleton: "#7791ff",
      ribosome: "#f8fbff",
    },
    geometry: { radius: 2.35, nucleusRadius: 0.88, wrinkleScale: 3.4, wrinkleAmp: 0.06 },
    components: { mitochondria: 16, reticulum: 8, vesicles: 24, lysosomes: 11, ribosomes: 360, filaments: 29 },
    metrics: { organelles: 448, permeability: 44, stressBase: 4.8, atpReserve: 88, cytoskeletalBias: "Dendritic" },
  },
  {
    id: "zebrafish-embryonic-cell",
    name: "Zebrafish Embryonic Organizer Cell",
    species: "Zebrafish",
    tissue: "Embryonic axis",
    sampleType: "Animal",
    complexity: "Medium",
    score: 90,
    summary: "Developmental signaling cell shaped by morphogen transport and rapid division.",
    summaryLong:
      "This embryonic cell model favors vesicle-rich signaling patterns, pliable membrane contour, and dense translational machinery suited to early developmental programs in zebrafish samples.",
    tags: ["zebrafish", "embryo", "development", "signaling", "animal", "division"],
    palette: {
      membrane: "#6ff6ff",
      membraneGlow: "#103645",
      nucleus: "#f0c2ff",
      mitochondria: "#ff976f",
      golgi: "#ffdb78",
      reticulum: "#67f2d1",
      lysosome: "#ff739c",
      vesicle: "#8befff",
      cytoskeleton: "#72a0ff",
      ribosome: "#fbfcff",
    },
    geometry: { radius: 2.15, nucleusRadius: 0.74, wrinkleScale: 4.6, wrinkleAmp: 0.1 },
    components: { mitochondria: 12, reticulum: 6, vesicles: 26, lysosomes: 8, ribosomes: 300, filaments: 21 },
    metrics: { organelles: 373, permeability: 59, stressBase: 5.1, atpReserve: 82, cytoskeletalBias: "Dynamic cortical" },
  },
  {
    id: "frog-oocyte",
    name: "Frog Oocyte Maturation Cell",
    species: "Frog",
    tissue: "Ovary",
    sampleType: "Animal",
    complexity: "High",
    score: 91,
    summary: "Large developmental cell balancing storage, translation, and polarity cues.",
    summaryLong:
      "The oocyte representation scales up vesicle stores, localized cytoplasmic territories, and maturation-linked signaling zones inspired by amphibian developmental biology samples.",
    tags: ["frog", "oocyte", "development", "storage", "animal", "polarity"],
    palette: {
      membrane: "#85f3ff",
      membraneGlow: "#11394a",
      nucleus: "#f0b6ff",
      mitochondria: "#ff9b73",
      golgi: "#ffd96d",
      reticulum: "#6af4c8",
      lysosome: "#ff76ab",
      vesicle: "#97ebff",
      cytoskeleton: "#85a0ff",
      ribosome: "#ffffff",
    },
    geometry: { radius: 2.95, nucleusRadius: 1.05, wrinkleScale: 2.1, wrinkleAmp: 0.04 },
    components: { mitochondria: 22, reticulum: 10, vesicles: 34, lysosomes: 10, ribosomes: 470, filaments: 27 },
    metrics: { organelles: 573, permeability: 47, stressBase: 4.9, atpReserve: 94, cytoskeletalBias: "Cortical polarity" },
  },
  {
    id: "canine-epithelial-cell",
    name: "Canine Airway Epithelial Cell",
    species: "Dog",
    tissue: "Airway",
    sampleType: "Animal",
    complexity: "Medium",
    score: 88,
    summary: "Barrier-forming epithelial sample with membrane turnover and secretory load.",
    summaryLong:
      "This airway epithelial model focuses on membrane permeability control, secretory vesicle release, and injury-response remodeling adapted to canine respiratory samples.",
    tags: ["dog", "epithelium", "airway", "barrier", "animal", "secretory"],
    palette: {
      membrane: "#76ebff",
      membraneGlow: "#0f3545",
      nucleus: "#efb9ff",
      mitochondria: "#ff9a66",
      golgi: "#ffdb72",
      reticulum: "#65efc2",
      lysosome: "#ff6c91",
      vesicle: "#9be6ff",
      cytoskeleton: "#7d99ff",
      ribosome: "#fdfdff",
    },
    geometry: { radius: 2.25, nucleusRadius: 0.8, wrinkleScale: 3.2, wrinkleAmp: 0.07 },
    components: { mitochondria: 14, reticulum: 7, vesicles: 24, lysosomes: 10, ribosomes: 320, filaments: 24 },
    metrics: { organelles: 399, permeability: 58, stressBase: 5.6, atpReserve: 80, cytoskeletalBias: "Barrier mesh" },
  },
  {
    id: "bat-immune-cell",
    name: "Bat Interferon-Primed Immune Cell",
    species: "Bat",
    tissue: "Immune system",
    sampleType: "Animal",
    complexity: "Medium",
    score: 89,
    summary: "Immune-surveillance cell tuned for antiviral readiness and signaling economy.",
    summaryLong:
      "Inspired by comparative immunology studies, this bat immune cell entry emphasizes interferon-associated vesicle signaling, compact organelle packing, and resilient membrane behavior.",
    tags: ["bat", "immune", "antiviral", "animal", "signaling", "interferon"],
    palette: {
      membrane: "#73e7ff",
      membraneGlow: "#0d2e43",
      nucleus: "#d8b4ff",
      mitochondria: "#ff9168",
      golgi: "#ffd870",
      reticulum: "#60f2bf",
      lysosome: "#ff6f9d",
      vesicle: "#89e6ff",
      cytoskeleton: "#6e90ff",
      ribosome: "#fafcff",
    },
    geometry: { radius: 2.08, nucleusRadius: 0.9, wrinkleScale: 4.0, wrinkleAmp: 0.08 },
    components: { mitochondria: 11, reticulum: 6, vesicles: 19, lysosomes: 13, ribosomes: 260, filaments: 26 },
    metrics: { organelles: 335, permeability: 61, stressBase: 6.0, atpReserve: 76, cytoskeletalBias: "Migration-ready" },
  },
  {
    id: "rat-astrocyte",
    name: "Rat Astrocyte Support Cell",
    species: "Rat",
    tissue: "Glia",
    sampleType: "Animal",
    complexity: "High",
    score: 90,
    summary: "Supportive neural cell with metabolic buffering and branching process bias.",
    summaryLong:
      "This astrocyte-inspired cell model underscores glycogen-associated reserve logic, neurotransmitter recycling, and branching cytoskeletal support seen in rodent glial preparations.",
    tags: ["rat", "glia", "astrocyte", "support", "animal", "metabolism"],
    palette: {
      membrane: "#6deeff",
      membraneGlow: "#123443",
      nucleus: "#e6b6ff",
      mitochondria: "#ff9d71",
      golgi: "#ffde80",
      reticulum: "#69f3cf",
      lysosome: "#ff7d97",
      vesicle: "#93e8ff",
      cytoskeleton: "#8097ff",
      ribosome: "#fbfeff",
    },
    geometry: { radius: 2.48, nucleusRadius: 0.86, wrinkleScale: 3.0, wrinkleAmp: 0.06 },
    components: { mitochondria: 19, reticulum: 9, vesicles: 21, lysosomes: 9, ribosomes: 350, filaments: 31 },
    metrics: { organelles: 439, permeability: 46, stressBase: 4.5, atpReserve: 87, cytoskeletalBias: "Branch-support" },
  },
  {
    id: "pig-intestinal-stem-cell",
    name: "Pig Intestinal Stem Cell",
    species: "Pig",
    tissue: "Intestinal crypt",
    sampleType: "Animal",
    complexity: "Medium",
    score: 87,
    summary: "Renewal-oriented epithelial precursor with proliferative signaling architecture.",
    summaryLong:
      "The stem-cell atlas entry highlights balanced organelle reserves, Wnt-sensitive membrane dynamics, and a flexible translational state seen in mammalian crypt biology.",
    tags: ["pig", "stem cell", "intestine", "renewal", "animal", "proliferation"],
    palette: {
      membrane: "#70eaff",
      membraneGlow: "#113243",
      nucleus: "#ebbaff",
      mitochondria: "#ff956d",
      golgi: "#ffd670",
      reticulum: "#67f0c6",
      lysosome: "#ff7193",
      vesicle: "#95ebff",
      cytoskeleton: "#7b98ff",
      ribosome: "#fcfdff",
    },
    geometry: { radius: 2.18, nucleusRadius: 0.84, wrinkleScale: 3.7, wrinkleAmp: 0.08 },
    components: { mitochondria: 13, reticulum: 7, vesicles: 22, lysosomes: 10, ribosomes: 310, filaments: 23 },
    metrics: { organelles: 385, permeability: 55, stressBase: 5.4, atpReserve: 81, cytoskeletalBias: "Mitotic transition" },
  },
  {
    id: "human-melanocyte",
    name: "Human Melanocyte Pigment Cell",
    species: "Human",
    tissue: "Skin",
    sampleType: "Human",
    complexity: "Medium",
    score: 90,
    summary: "Pigment-producing cell centered on vesicle maturation and transfer logistics.",
    summaryLong:
      "This model accentuates melanosome-like vesicle traffic, dendritic transfer geometry, and stress-responsive signaling modules relevant to epidermal biology.",
    tags: ["human", "skin", "pigment", "vesicle", "stress", "melanocyte"],
    palette: {
      membrane: "#78e9ff",
      membraneGlow: "#0f3343",
      nucleus: "#f2b6ff",
      mitochondria: "#ff8c63",
      golgi: "#ffd66d",
      reticulum: "#5ff1bb",
      lysosome: "#ff6888",
      vesicle: "#9ce9ff",
      cytoskeleton: "#7995ff",
      ribosome: "#fefeff",
    },
    geometry: { radius: 2.2, nucleusRadius: 0.82, wrinkleScale: 3.8, wrinkleAmp: 0.09 },
    components: { mitochondria: 14, reticulum: 8, vesicles: 30, lysosomes: 10, ribosomes: 330, filaments: 27 },
    metrics: { organelles: 419, permeability: 57, stressBase: 5.8, atpReserve: 79, cytoskeletalBias: "Dendritic handoff" },
  },
];

const organelleBlueprints = [
  {
    name: "Membrane topography",
    detail:
      "Microridges and tension bands are exaggerated to show how transport load and signaling alter surface behavior across the sample.",
  },
  {
    name: "Nuclear signaling hub",
    detail:
      "The nucleus and nucleolus are scaled to emphasize transcriptional commitment, chromatin access, and stress-linked rewiring pressure.",
  },
  {
    name: "Mitochondrial lanes",
    detail:
      "Energy organelles are distributed along a biased transport field to reveal species-specific ATP demand and spatial reserve patterns.",
  },
  {
    name: "Reticular processing mesh",
    detail:
      "Endoplasmic reticulum paths are modeled as thickened conduits to communicate translation, lipid handling, and stress folding dynamics.",
  },
  {
    name: "Golgi dispatch ribbon",
    detail:
      "A layered toroidal stack stands in for cargo sorting, maturation, and secretory prioritization at the center of the cell body.",
  },
  {
    name: "Cytoskeletal steering field",
    detail:
      "Filament bias indicates the dominant direction of mechanical load, intracellular trafficking, and polarity commitment in the sample.",
  },
];

const markerBlueprints = [
  ["MAP2", "Neural differentiation cue", "Structural polarity"],
  ["GFAP", "Glial support tone", "Intermediate filament"],
  ["CXCL10", "Inflammatory communication load", "Secreted signal"],
  ["ATP5F1", "Oxidative phosphorylation reserve", "Energy metabolism"],
  ["HSPA5", "Reticular folding pressure", "Proteostasis"],
  ["LC3B", "Autophagic routing activity", "Stress adaptation"],
  ["MKI67", "Cell-cycle entry probability", "Proliferation"],
  ["FOXO3", "Stress-response modulation", "Signal integration"],
  ["ACTB", "Cortical force maintenance", "Mechanical bias"],
  ["SLC2A1", "Nutrient uptake dependency", "Membrane transport"],
  ["STAT1", "Interferon response state", "Immune transcription"],
  ["TOMM20", "Mitochondrial trafficking visibility", "Energy distribution"],
];

const legendBlueprints = [
  ["Membrane", "Outer tension-responsive shell"],
  ["Nucleus", "Transcription and chromatin control"],
  ["Mitochondria", "Distributed ATP production cores"],
  ["Reticulum", "Translation and lipid processing mesh"],
  ["Golgi", "Sorting and secretion ribbon"],
  ["Lysosomes", "Recycling and degradation nodes"],
  ["Vesicles", "Cargo transfer packets"],
  ["Cytoskeleton", "Force and transport scaffold"],
];

const glossaryCategories = [
  "Architecture",
  "Signaling",
  "Metabolism",
  "Immunology",
  "Trafficking",
  "Mechanics",
  "Development",
  "Pathology",
];

const glossaryRelevance = [
  "Frequently surfaced in atlas overlays",
  "Used by the guided narrative engine",
  "Referenced in model-specific marker panels",
  "Linked to stress-state interpretation",
  "Helpful for compare-mode reading",
];

const narrativePhases = [
  "Baseline scanning",
  "Transport escalation",
  "Signal amplification",
  "Stress adaptation",
  "Recovery mapping",
  "Comparative inference",
];

const noteThemes = [
  "Spatial reserve logic",
  "Disease mimicry cue",
  "Sample preparation caution",
  "Therapeutic target idea",
  "Comparative biology contrast",
  "Visualization rationale",
];

const glossaryTerms = [
  "actin cortex", "adaptive stress", "anabolic reserve", "anaphase bias", "antigen loading",
  "apical polarity", "autophagic flux", "axon guidance", "barrier junction", "basal anchoring",
  "bioenergetic reserve", "cadherin field", "calcium pulse", "cargo budding", "cell fate gate",
  "cellular quiescence", "chemotactic front", "chromatin access", "ciliary bias", "clathrin coat",
  "collagen sensing", "contractile preload", "cortical tension", "cytokine burst", "cytoplasmic streaming",
  "dendritic transfer", "developmental axis", "diffusion barrier", "DNA repair pulse", "endocytic routing",
  "endosomal escape", "ER stress", "exocytosis burst", "focal adhesion", "folding capacity",
  "gene-expression burst", "glucose uptake", "Golgi ribbon", "granule release", "growth factor response",
  "heat-shock reserve", "immune priming", "interferon tone", "junction remodeling", "lamellipodial edge",
  "lipid handling", "lysosomal recycling", "matrix engagement", "mechanotransduction", "membrane roughening",
  "membrane ruffling", "metabolic buffering", "microdomain cluster", "microtubule lane", "mitotic spindle",
  "mitochondrial cristae", "morphogen gradient", "motility pulse", "mRNA localization", "myosin traction",
  "neurotransmitter recycling", "nuclear pore", "nucleolar stress", "organelle crowding", "oxidative burst",
  "paracrine loop", "perinuclear reserve", "permeability shift", "phagocytic cup", "polarity field",
  "post-translational load", "proteostasis", "pseudopod extension", "quorum sensing", "reactive oxygen",
  "receptor recycling", "repair scaffold", "ribosomal throughput", "sarcomeric order", "secretory load",
  "signal cascade", "spindle checkpoint", "stemness state", "surface receptor patch", "synaptic pool",
  "telomeric maintenance", "tension ridge", "transcription burst", "translation reserve", "transport vesicle",
  "turnover kinetics", "unfolded protein response", "vesicle docking", "viral sensing", "wound response"
];

function repeatCollection(base, count, mapper) {
  return Array.from({ length: count }, (_, index) => mapper(base[index % base.length], index));
}

function buildModel(template, index) {
  const organelleHighlights = repeatCollection(organelleBlueprints, 8, (item, itemIndex) => ({
    name: `${item.name} ${itemIndex + 1}`,
    detail: `${item.detail} ${template.name} emphasizes this axis through ${template.tags[itemIndex % template.tags.length]}-weighted morphology and a ${template.complexity.toLowerCase()}-complexity rendering preset.`,
  }));

  const markers = repeatCollection(markerBlueprints, 8, (item, itemIndex) => ({
    marker: `${item[0]}-${index + 1}-${itemIndex + 1}`,
    significance: `${item[1]} aligned with ${template.tissue.toLowerCase()} context and ${template.tags[(itemIndex + 2) % template.tags.length]} dynamics.`,
    pathway: `${item[2]} pathway`,
    signal: `${template.sampleType} sample reference`,
  }));

  const legend = legendBlueprints.map(([label, detail]) => ({
    label,
    detail: `${detail} in the ${template.name.toLowerCase()} view.`,
    color: template.palette[label.toLowerCase()] ||
      ({
        Membrane: template.palette.membrane,
        Nucleus: template.palette.nucleus,
        Mitochondria: template.palette.mitochondria,
        Reticulum: template.palette.reticulum,
        Golgi: template.palette.golgi,
        Lysosomes: template.palette.lysosome,
        Vesicles: template.palette.vesicle,
        Cytoskeleton: template.palette.cytoskeleton,
      }[label]),
  }));

  return {
    ...template,
    organelleHighlights,
    markers,
    legend,
  };
}

const catalog = modelTemplates.map(buildModel);

const heroStats = [
  { label: "Species span", value: "8 taxa", detail: "Human, rodent, amphibian, fish, bat, canine, porcine" },
  { label: "Cell systems", value: "12 models", detail: "Immune, neural, developmental, epithelial, contractile, pigment" },
  { label: "Atlas signals", value: "260+ cues", detail: "Markers, glossary nodes, narratives, and research-note fragments" },
];

const modeChips = [
  { label: "Render mode", value: "Biological cinematic" },
  { label: "Atlas bias", value: "Organelles + pathways" },
  { label: "Interaction", value: "Orbit / inspect / compare" },
];

const derivedFilterValues = {
  species: [...new Set(catalog.map((item) => item.species))].sort(),
  tissues: [...new Set(catalog.map((item) => item.tissue))].sort(),
  complexity: [...new Set(catalog.map((item) => item.complexity))].sort(),
};

const glossary = repeatCollection(glossaryTerms, 220, (term, index) => ({
  term: `${term} ${index + 1}`,
  category: glossaryCategories[index % glossaryCategories.length],
  relevance: glossaryRelevance[index % glossaryRelevance.length],
  definition:
    `Atlas term ${index + 1} explains how ${term} influences morphology, transport, signaling, or stress interpretation when switching among human and animal samples in the 3D viewer.`,
}));

const narrativeSeed = [
  "Transport corridors intensify around the nucleus as signaling demand rises.",
  "Membrane topology becomes more dramatic when the sample shifts toward an activated state.",
  "Mitochondria redistribute to support localized ATP demand and buffered signaling.",
  "Reticular paths thicken visually to communicate increased folding and secretory burden.",
  "Cytoskeletal alignment reveals the likely direction of force transmission or cargo delivery.",
];

const narratives = repeatCollection(narrativeSeed, 180, (description, index) => {
  const model = catalog[index % catalog.length];
  return {
    phase: narrativePhases[index % narrativePhases.length],
    title: `${model.name} story beat ${index + 1}`,
    description: `${description} In this atlas segment the ${model.species.toLowerCase()} ${model.tissue.toLowerCase()} sample is framed through ${model.tags[index % model.tags.length]} emphasis and ${model.complexity.toLowerCase()} structural density.`,
    tags: model.tags.slice(0, 4),
  };
});

const researchNotes = repeatCollection(catalog, 180, (model, index) => ({
  id: `note-${index + 1}`,
  modelId: model.id,
  title: `${noteThemes[index % noteThemes.length]} ${index + 1}`,
  detail:
    `This note pairs the ${model.name.toLowerCase()} with a ${noteThemes[index % noteThemes.length].toLowerCase()} so the interface can surface interpretation cues, compare ideas, and limitations that matter when moving from stylized structure to biological inference.`,
  tags: model.tags.slice(0, 3),
  severity: ["Low", "Moderate", "Elevated"][index % 3],
}));

const comparisons = Array.from({ length: 144 }, (_, index) => {
  const source = catalog[index % catalog.length];
  const target = catalog[(index + 3) % catalog.length];
  return {
    id: `comparison-${index + 1}`,
    title: `${source.species} to ${target.species} contrast ${index + 1}`,
    sourceId: source.id,
    targetId: target.id,
    focus: ["Membrane behavior", "Energy layout", "Trafficking load", "Signal posture"][index % 4],
    summary:
      `Compare ${source.name.toLowerCase()} against ${target.name.toLowerCase()} to inspect differences in ${source.tags[index % source.tags.length]}, ${target.tags[index % target.tags.length]}, and how those priorities shape visible organelle distribution.`,
    metricDelta: `${Math.abs(source.metrics.organelles - target.metrics.organelles)} organelle units`,
  };
});

function writeModule(fileName, exportName, value) {
  const contents = `export const ${exportName} = ${JSON.stringify(value, null, 2)};\n`;
  fs.writeFileSync(path.join(outputDir, fileName), contents, "utf8");
}

writeModule("catalog.js", "cellCatalog", catalog);
fs.appendFileSync(
  path.join(outputDir, "catalog.js"),
  `\nexport const heroStats = ${JSON.stringify(heroStats, null, 2)};\n` +
    `\nexport const modeChips = ${JSON.stringify(modeChips, null, 2)};\n` +
    `\nexport const derivedFilterValues = ${JSON.stringify(derivedFilterValues, null, 2)};\n`,
  "utf8",
);
writeModule("glossary.js", "atlasGlossary", glossary);
writeModule("narratives.js", "atlasNarratives", narratives);
writeModule("researchNotes.js", "atlasResearchNotes", researchNotes);
writeModule("comparisons.js", "atlasComparisons", comparisons);

console.log("Generated data modules in", outputDir);
