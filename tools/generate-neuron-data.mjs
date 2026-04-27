import fs from "node:fs";
import path from "node:path";

function createRng(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function round(value) {
  return Number(value.toFixed(3));
}

function point(x, y, z) {
  return [round(x), round(y), round(z)];
}

function curvePoints(start, controls, end, steps) {
  const p0 = start;
  const p1 = controls[0];
  const p2 = controls[1] || controls[0];
  const p3 = end;
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const oneMinus = 1 - t;
    const x =
      oneMinus ** 3 * p0[0] +
      3 * oneMinus ** 2 * t * p1[0] +
      3 * oneMinus * t ** 2 * p2[0] +
      t ** 3 * p3[0];
    const y =
      oneMinus ** 3 * p0[1] +
      3 * oneMinus ** 2 * t * p1[1] +
      3 * oneMinus * t ** 2 * p2[1] +
      t ** 3 * p3[1];
    const z =
      oneMinus ** 3 * p0[2] +
      3 * oneMinus ** 2 * t * p1[2] +
      3 * oneMinus * t ** 2 * p2[2] +
      t ** 3 * p3[2];
    points.push(point(x, y, z));
  }
  return points;
}

function branchFromAngles({
  id,
  kind,
  domain,
  start,
  yaw,
  pitch,
  length,
  bend,
  steps,
  radius,
  spineDensity = 0,
  boutonSpacing = 0,
}) {
  const dx = Math.cos(yaw) * Math.cos(pitch);
  const dy = Math.sin(pitch);
  const dz = Math.sin(yaw) * Math.cos(pitch);
  const mid1 = point(
    start[0] + dx * length * 0.32 + bend[0],
    start[1] + dy * length * 0.28 + bend[1],
    start[2] + dz * length * 0.3 + bend[2],
  );
  const mid2 = point(
    start[0] + dx * length * 0.64 + bend[3],
    start[1] + dy * length * 0.68 + bend[4],
    start[2] + dz * length * 0.62 + bend[5],
  );
  const end = point(
    start[0] + dx * length,
    start[1] + dy * length,
    start[2] + dz * length,
  );
  return {
    id,
    kind,
    domain,
    radius: round(radius),
    spineDensity: round(spineDensity),
    boutonSpacing: round(boutonSpacing),
    points: curvePoints(start, [mid1, mid2], end, steps),
  };
}

function endpoint(branch) {
  return branch.points[branch.points.length - 1];
}

function createChildBranches({
  rng,
  baseId,
  parent,
  kind,
  domain,
  count,
  length,
  yawSpread,
  pitchBase,
  radius,
  spineDensity,
}) {
  const tip = endpoint(parent);
  return Array.from({ length: count }, (_, index) => {
    const yaw = (rng() - 0.5) * yawSpread + (index - (count - 1) / 2) * 0.38;
    const pitch = pitchBase + (rng() - 0.5) * 0.42;
    const bend = [
      (rng() - 0.5) * 0.22,
      (rng() - 0.5) * 0.18,
      (rng() - 0.5) * 0.22,
      (rng() - 0.5) * 0.32,
      (rng() - 0.5) * 0.24,
      (rng() - 0.5) * 0.32,
    ];
    return branchFromAngles({
      id: `${baseId}-${index + 1}`,
      kind,
      domain,
      start: tip,
      yaw,
      pitch,
      length: length * (0.84 + rng() * 0.24),
      bend,
      steps: 12,
      radius: radius * (0.82 + rng() * 0.12),
      spineDensity,
    });
  });
}

function buildHumanCorticalNeuron() {
  const rng = createRng(104729);
  const soma = {
    center: point(-0.12, 0.08, 0.02),
    radii: point(1.1, 0.92, 1.02),
    orientation: point(0.12, 0.18, 0),
  };

  const apicalMain = branchFromAngles({
    id: "apical-main",
    kind: "apical",
    domain: "layer 2/3 to pial direction",
    start: point(-0.08, 0.88, 0),
    yaw: -0.05,
    pitch: 1.1,
    length: 5.6,
    bend: [0.22, 0.6, -0.12, -0.18, 1.2, 0.18],
    steps: 18,
    radius: 0.18,
    spineDensity: 0.74,
  });

  const apicalTuftParents = createChildBranches({
    rng,
    baseId: "apical-tuft",
    parent: apicalMain,
    kind: "apical",
    domain: "distal tuft",
    count: 4,
    length: 2.7,
    yawSpread: 1.3,
    pitchBase: 0.55,
    radius: 0.09,
    spineDensity: 0.92,
  });

  const apicalFine = apicalTuftParents.flatMap((branch, branchIndex) =>
    createChildBranches({
      rng,
      baseId: `apical-fine-${branchIndex + 1}`,
      parent: branch,
      kind: "apical",
      domain: "distal tuft branchlets",
      count: 3,
      length: 1.5,
      yawSpread: 1.5,
      pitchBase: 0.24,
      radius: 0.046,
      spineDensity: 1.1,
    }),
  );

  const basalRoots = [
    { id: "basal-1", yaw: Math.PI * 0.9, pitch: 0.12, length: 2.6 },
    { id: "basal-2", yaw: Math.PI * 1.15, pitch: -0.18, length: 2.4 },
    { id: "basal-3", yaw: Math.PI * 1.38, pitch: 0.04, length: 2.2 },
    { id: "basal-4", yaw: Math.PI * 1.65, pitch: -0.14, length: 2.45 },
    { id: "basal-5", yaw: Math.PI * 1.92, pitch: 0.08, length: 2.25 },
  ].map((seed, index) =>
    branchFromAngles({
      id: seed.id,
      kind: "basal",
      domain: "basal arbor",
      start: point(-0.14, -0.48, 0),
      yaw: seed.yaw,
      pitch: seed.pitch,
      length: seed.length,
      bend: [
        (rng() - 0.5) * 0.3,
        (rng() - 0.5) * 0.18,
        (rng() - 0.5) * 0.3,
        (rng() - 0.5) * 0.36,
        (rng() - 0.5) * 0.24,
        (rng() - 0.5) * 0.36,
      ],
      steps: 14,
      radius: 0.11 - index * 0.005,
      spineDensity: 0.88,
    }),
  );

  const basalSecondary = basalRoots.flatMap((branch, branchIndex) =>
    createChildBranches({
      rng,
      baseId: `basal-secondary-${branchIndex + 1}`,
      parent: branch,
      kind: "basal",
      domain: "basal arbor branch",
      count: 3,
      length: 1.7,
      yawSpread: 1.2,
      pitchBase: (rng() - 0.5) * 0.35,
      radius: 0.06,
      spineDensity: 1.02,
    }),
  );

  const basalTertiary = basalSecondary.flatMap((branch, branchIndex) =>
    createChildBranches({
      rng,
      baseId: `basal-tertiary-${branchIndex + 1}`,
      parent: branch,
      kind: "basal",
      domain: "basal terminal branch",
      count: 2,
      length: 1.05,
      yawSpread: 1.55,
      pitchBase: (rng() - 0.5) * 0.42,
      radius: 0.034,
      spineDensity: 1.16,
    }),
  );

  const axonMain = branchFromAngles({
    id: "axon-main",
    kind: "axon",
    domain: "axon initial segment to projection",
    start: point(0.72, -0.22, 0.02),
    yaw: 0.08,
    pitch: 0.08,
    length: 11.2,
    bend: [0.45, -0.1, -0.08, 1.0, 0.3, 0.22],
    steps: 28,
    radius: 0.045,
    boutonSpacing: 0.86,
  });

  const axonCollaterals = Array.from({ length: 8 }, (_, index) => {
    const basePoint = axonMain.points[5 + index * 2];
    return branchFromAngles({
      id: `axon-collateral-${index + 1}`,
      kind: "axonCollateral",
      domain: "local collateral",
      start: basePoint,
      yaw: 0.35 + (rng() - 0.5) * 1.4,
      pitch: (rng() - 0.5) * 0.55,
      length: 1.3 + rng() * 1.1,
      bend: [
        (rng() - 0.5) * 0.22,
        (rng() - 0.5) * 0.18,
        (rng() - 0.5) * 0.22,
        (rng() - 0.5) * 0.28,
        (rng() - 0.5) * 0.2,
        (rng() - 0.5) * 0.28,
      ],
      steps: 10,
      radius: 0.022,
      boutonSpacing: 0.42,
    });
  });

  return {
    modelId: "human-cortical-neuron",
    brainMeta: {
      displayName: "Human cortical pyramidal neuron",
      cellClass: "Excitatory projection neuron",
      laminarContext: "Modeled as a layer 2/3 cortical pyramidal neuron with a dominant apical dendrite oriented toward the pia.",
      regionContext: "Cerebral cortex",
      compartmentFacts: [
        "One main apical dendrite rises from the apex of the soma and branches distally into a tuft.",
        "Multiple basal dendrites emerge from the base of the soma and spread laterally with dense spines.",
        "A thin axon emerges from the basal pole and gives off local collaterals before long-range projection.",
      ],
      speciesSpecificity: [
        "Human supragranular pyramidal neurons have substantially larger and more complex dendritic trees than mouse and macaque counterparts.",
        "Large basal and apical arbors increase compartmentalization and change signal attenuation across the tree.",
      ],
      realismTargets: [
        "Apical trunk thickness tapers with distance from the soma.",
        "Basal dendrites are shorter and more lateral than the apical axis.",
        "Presynaptic boutons cluster on distal axon collaterals rather than all over the membrane.",
      ],
      references: [
        "Human L2/L3 neurons show multiple basal dendrites plus one apical dendrite and greater dendritic extent than mouse or macaque.",
        "Pyramidal cells have a pyramid-shaped soma, apical dendrite, basal dendrites, and an axon arising from the base.",
      ],
    },
    soma,
    branches: [
      apicalMain,
      ...apicalTuftParents,
      ...apicalFine,
      ...basalRoots,
      ...basalSecondary,
      ...basalTertiary,
      axonMain,
      ...axonCollaterals,
    ],
  };
}

function buildMouseCA1Neuron() {
  const rng = createRng(130363);
  const soma = {
    center: point(0.02, 0.04, 0),
    radii: point(0.94, 0.86, 0.96),
    orientation: point(0.08, -0.05, 0),
  };

  const apicalMain = branchFromAngles({
    id: "ca1-apical-main",
    kind: "apical",
    domain: "stratum radiatum axis",
    start: point(0.04, 0.76, 0),
    yaw: -0.04,
    pitch: 1.18,
    length: 4.8,
    bend: [0.12, 0.45, 0.08, -0.12, 1.0, -0.08],
    steps: 16,
    radius: 0.16,
    spineDensity: 0.82,
  });

  const apicalOblique = Array.from({ length: 5 }, (_, index) => {
    const basePoint = apicalMain.points[4 + index * 2];
    return branchFromAngles({
      id: `ca1-oblique-${index + 1}`,
      kind: "apical",
      domain: "oblique apical dendrite",
      start: basePoint,
      yaw: (index - 2) * 0.42 + (rng() - 0.5) * 0.18,
      pitch: 0.38 + (rng() - 0.5) * 0.22,
      length: 1.2 + rng() * 0.9,
      bend: [
        (rng() - 0.5) * 0.16,
        (rng() - 0.5) * 0.14,
        (rng() - 0.5) * 0.16,
        (rng() - 0.5) * 0.18,
        (rng() - 0.5) * 0.16,
        (rng() - 0.5) * 0.18,
      ],
      steps: 10,
      radius: 0.065,
      spineDensity: 0.98,
    });
  });

  const tuftRoots = createChildBranches({
    rng,
    baseId: "ca1-tuft",
    parent: apicalMain,
    kind: "apical",
    domain: "stratum lacunosum-moleculare tuft",
    count: 5,
    length: 2.3,
    yawSpread: 1.65,
    pitchBase: 0.48,
    radius: 0.076,
    spineDensity: 1.08,
  });

  const tuftFine = tuftRoots.flatMap((branch, branchIndex) =>
    createChildBranches({
      rng,
      baseId: `ca1-tuft-fine-${branchIndex + 1}`,
      parent: branch,
      kind: "apical",
      domain: "distal tuft terminal",
      count: 2,
      length: 1.0,
      yawSpread: 1.8,
      pitchBase: 0.18,
      radius: 0.03,
      spineDensity: 1.16,
    }),
  );

  const basalRoots = [
    { id: "ca1-basal-1", yaw: Math.PI * 1.04, pitch: -0.12, length: 1.95 },
    { id: "ca1-basal-2", yaw: Math.PI * 1.28, pitch: 0.05, length: 2.15 },
    { id: "ca1-basal-3", yaw: Math.PI * 1.53, pitch: -0.18, length: 1.85 },
    { id: "ca1-basal-4", yaw: Math.PI * 1.78, pitch: 0.04, length: 1.92 },
  ].map((seed) =>
    branchFromAngles({
      id: seed.id,
      kind: "basal",
      domain: "stratum oriens basal arbor",
      start: point(0, -0.42, 0),
      yaw: seed.yaw,
      pitch: seed.pitch,
      length: seed.length,
      bend: [
        (rng() - 0.5) * 0.2,
        (rng() - 0.5) * 0.14,
        (rng() - 0.5) * 0.2,
        (rng() - 0.5) * 0.24,
        (rng() - 0.5) * 0.18,
        (rng() - 0.5) * 0.24,
      ],
      steps: 12,
      radius: 0.095,
      spineDensity: 0.94,
    }),
  );

  const basalSecondary = basalRoots.flatMap((branch, branchIndex) =>
    createChildBranches({
      rng,
      baseId: `ca1-basal-secondary-${branchIndex + 1}`,
      parent: branch,
      kind: "basal",
      domain: "oriens branch",
      count: 2,
      length: 1.05,
      yawSpread: 1.15,
      pitchBase: (rng() - 0.5) * 0.3,
      radius: 0.05,
      spineDensity: 1.02,
    }),
  );

  const axonMain = branchFromAngles({
    id: "ca1-axon-main",
    kind: "axon",
    domain: "alveus-favoring output axis",
    start: point(0.56, -0.2, 0),
    yaw: 0.15,
    pitch: -0.06,
    length: 8.6,
    bend: [0.24, -0.08, 0.06, 0.62, -0.12, 0.18],
    steps: 22,
    radius: 0.04,
    boutonSpacing: 0.74,
  });

  const axonCollaterals = Array.from({ length: 6 }, (_, index) => {
    const basePoint = axonMain.points[4 + index * 2];
    return branchFromAngles({
      id: `ca1-axon-collateral-${index + 1}`,
      kind: "axonCollateral",
      domain: "local recurrent collateral",
      start: basePoint,
      yaw: 0.45 + (rng() - 0.5) * 1.1,
      pitch: (rng() - 0.5) * 0.42,
      length: 1.1 + rng() * 0.8,
      bend: [
        (rng() - 0.5) * 0.16,
        (rng() - 0.5) * 0.14,
        (rng() - 0.5) * 0.16,
        (rng() - 0.5) * 0.18,
        (rng() - 0.5) * 0.16,
        (rng() - 0.5) * 0.18,
      ],
      steps: 9,
      radius: 0.019,
      boutonSpacing: 0.38,
    });
  });

  return {
    modelId: "mouse-hippocampal-neuron",
    brainMeta: {
      displayName: "Mouse hippocampal CA1 pyramidal neuron",
      cellClass: "Excitatory hippocampal pyramidal neuron",
      laminarContext: "Basal dendrites occupy stratum oriens, while the apical trunk enters stratum radiatum and arborizes distally into a tuft near stratum lacunosum-moleculare.",
      regionContext: "Hippocampal CA1",
      compartmentFacts: [
        "A single large apical dendrite leaves the soma and gives off oblique branches before the distal tuft.",
        "Basal dendrites are shorter than the apical axis and spread from the base of the soma into stratum oriens.",
        "Axon output leaves the basal pole and gives local collaterals before longer-range projection.",
      ],
      speciesSpecificity: [
        "Mouse CA1 pyramidal cells are smaller and less expansive than human pyramidal neurons.",
        "Distinct basal and apical domains are spatially separated in mouse CA1 anatomy.",
      ],
      realismTargets: [
        "Oblique dendrites arise from the apical shaft rather than only at the tuft tip.",
        "The distal tuft is narrower and more compact than cortical supragranular human pyramidal tufting.",
        "Basal arbor remains relatively shorter and denser.",
      ],
      references: [
        "CA1 pyramidal cells possess distinct apical and basal domains with different afferent input territories.",
        "Comparative studies show human and mouse CA1 pyramidal dendrites differ in size and arrangement.",
      ],
    },
    soma,
    branches: [
      apicalMain,
      ...apicalOblique,
      ...tuftRoots,
      ...tuftFine,
      ...basalRoots,
      ...basalSecondary,
      axonMain,
      ...axonCollaterals,
    ],
  };
}

function buildRatAstrocyte() {
  const rng = createRng(155921);
  const soma = {
    center: point(0, 0.02, 0),
    radii: point(0.78, 0.72, 0.8),
    orientation: point(0, 0, 0),
  };

  const primary = Array.from({ length: 18 }, (_, index) =>
    branchFromAngles({
      id: `astro-primary-${index + 1}`,
      kind: "glialPrimary",
      domain: "astrocyte territory process",
      start: point(0, 0.02, 0),
      yaw: (index / 18) * Math.PI * 2,
      pitch: (rng() - 0.5) * 0.72,
      length: 2.0 + rng() * 0.9,
      bend: [
        (rng() - 0.5) * 0.18,
        (rng() - 0.5) * 0.18,
        (rng() - 0.5) * 0.18,
        (rng() - 0.5) * 0.26,
        (rng() - 0.5) * 0.24,
        (rng() - 0.5) * 0.26,
      ],
      steps: 12,
      radius: 0.085,
      spineDensity: 0,
    }),
  );

  const secondary = primary.flatMap((branch, branchIndex) =>
    createChildBranches({
      rng,
      baseId: `astro-secondary-${branchIndex + 1}`,
      parent: branch,
      kind: "glialSecondary",
      domain: "fine astrocytic arbor",
      count: 3,
      length: 1.4,
      yawSpread: 2.2,
      pitchBase: (rng() - 0.5) * 0.5,
      radius: 0.036,
      spineDensity: 0,
    }),
  );

  const tertiary = secondary.flatMap((branch, branchIndex) =>
    createChildBranches({
      rng,
      baseId: `astro-tertiary-${branchIndex + 1}`,
      parent: branch,
      kind: "glialFine",
      domain: "perisynaptic fine process",
      count: 2,
      length: 0.9,
      yawSpread: 2.4,
      pitchBase: (rng() - 0.5) * 0.7,
      radius: 0.018,
      spineDensity: 0,
    }),
  );

  const endfeet = primary.slice(0, 6).map((branch, index) => ({
    id: `astro-endfoot-${index + 1}`,
    kind: "endfoot",
    domain: "vascular endfoot",
    radius: 0.11,
    spineDensity: 0,
    boutonSpacing: 0,
    points: curvePoints(
      endpoint(branch),
      [
        point(endpoint(branch)[0] * 1.05, endpoint(branch)[1] * 1.05 + 0.08, endpoint(branch)[2] * 1.05),
        point(endpoint(branch)[0] * 1.12, endpoint(branch)[1] * 1.1, endpoint(branch)[2] * 1.12),
      ],
      point(endpoint(branch)[0] * 1.18, endpoint(branch)[1] * 1.14, endpoint(branch)[2] * 1.18),
      6,
    ),
  }));

  return {
    modelId: "rat-astrocyte",
    brainMeta: {
      displayName: "Rat astrocyte",
      cellClass: "Astroglial support cell",
      laminarContext: "Territory-like glial arbor with many fine processes rather than a single polarized axon-dendrite axis.",
      regionContext: "Glial field / hippocampal-like support territory",
      compartmentFacts: [
        "Primary processes radiate from the soma and give rise to extensive fine branchlets.",
        "Fine processes form a territorial arbor that can envelop many synaptic sites.",
        "Selected peripheral branches terminate in broader endfoot-like specializations.",
      ],
      speciesSpecificity: [
        "Astrocytes occupy territories with limited overlap and extensive unresolved fine processes.",
        "Fine morphology is heterogeneous across brain layers and development.",
      ],
      realismTargets: [
        "No axon-like dominant projection is present.",
        "Branch caliber drops rapidly from thick primary stems to very fine process tips.",
        "Peripheral endfeet are broader than intermediate branchlets.",
      ],
      references: [
        "Astrocyte territories contain extensive fine processes that contact many thousands of synapses.",
        "Fine astrocyte morphology varies across hippocampal CA1 layers and developmental states.",
      ],
    },
    soma,
    branches: [
      ...primary,
      ...secondary,
      ...tertiary,
      ...endfeet,
    ],
  };
}

const neuralAtlas = {
  "human-cortical-neuron": buildHumanCorticalNeuron(),
  "mouse-hippocampal-neuron": buildMouseCA1Neuron(),
  "rat-astrocyte": buildRatAstrocyte(),
};

const lines = [];
lines.push("export const neuralMorphologyAtlas = " + JSON.stringify(neuralAtlas, null, 2) + ";\n");
lines.push(`
export function getNeuralMorphology(modelId) {
  return neuralMorphologyAtlas[modelId] || null;
}
`);

fs.writeFileSync(
  path.resolve("src/data/neuronMorphologies.js"),
  lines.join(""),
  "utf8",
);

console.log("Generated neuron morphology atlas");
