import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clamp } from "../utils/format.js";
import { getMorphologyProfile } from "../data/morphologyProfiles.js";
import { getNeuralMorphology } from "../data/neuronMorphologies.js";

const COLOR_MAP = {
  membrane: "#6de9ff",
  nucleus: "#e7a3ff",
  mitochondria: "#ff9466",
  golgi: "#ffd56e",
  reticulum: "#6ef7bf",
  lysosome: "#ff6f9e",
  vesicle: "#9ce8ff",
  cytoskeleton: "#7ca7ff",
  ribosome: "#f6f8ff",
};

const MOUSE_ROTATE = 0;
const MOUSE_DOLLY = 1;
const MOUSE_PAN = 2;

function createMaterial(color, overrides = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.34,
    metalness: 0.03,
    transparent: true,
    opacity: 0.94,
    ...overrides,
  });
}

function deformSphere(geometry, radius, noise) {
  const position = geometry.attributes.position;
  const vector = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vector.fromBufferAttribute(position, index);
    const wrinkle =
      1 +
      Math.sin(vector.x * noise.scaleX) * noise.amplitude +
      Math.cos(vector.y * noise.scaleY) * noise.amplitude * 0.72 +
      Math.sin(vector.z * noise.scaleZ) * noise.amplitude * 0.58;
    vector.normalize().multiplyScalar(radius * wrinkle);
    position.setXYZ(index, vector.x, vector.y, vector.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function addCurveTubes(group, curves, material, radius, tubularSegments = 80, radialSegments = 10) {
  curves.forEach((curve) => {
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false),
      material,
    );
    group.add(mesh);
  });
}

function magnitudeFromArray(values) {
  return Math.max(...values.map((value) => Math.abs(value)));
}

export class CellScene {
  constructor(container, options = {}) {
    this.container = container;
    this.onSelectionChange = options.onSelectionChange || (() => {});
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2("#07101c", 0.022);
    this.camera = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / container.clientHeight,
      0.1,
      180,
    );
    this.defaultCamera = new THREE.Vector3(0, 1.2, 8.8);
    this.camera.position.copy(this.defaultCamera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 2.8;
    this.controls.maxDistance = 26;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: MOUSE_ROTATE,
      MIDDLE: MOUSE_DOLLY,
      RIGHT: MOUSE_PAN,
    };

    this.root = new THREE.Group();
    this.cellGroup = new THREE.Group();
    this.signalGroup = new THREE.Group();
    this.annotationGroup = new THREE.Group();
    this.root.add(this.cellGroup, this.signalGroup, this.annotationGroup);
    this.scene.add(this.root);

    this.floaters = [];
    this.motionPaths = [];
    this.explodable = [];
    this.componentGroups = {};
    this.activeModel = null;
    this.activeProfile = null;
    this.activeNeuralAtlas = null;
    this.currentOuterRadius = 8;
    this.stateTension = 0.25;
    this.explodeAmount = 0;
    this.showWireframe = false;
    this.showXRay = false;
    this.selection = null;
    this.highlightedMaterial = null;
    this.highlightedPreviousEmissive = null;

    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();

    this.setupEnvironment();
    this.setupLights();

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.animate = this.animate.bind(this);
    window.addEventListener("resize", this.handleResize);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.animate();
  }

  setupEnvironment() {
    const starGeometry = new THREE.BufferGeometry();
    const particleCount = 2200;
    const positions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      const radius = 15 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi);
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        size: 0.038,
        color: "#85c9ff",
        transparent: true,
        opacity: 0.72,
      }),
    );
    this.scene.add(this.stars);
  }

  setupLights() {
    const ambient = new THREE.AmbientLight("#b6dbff", 0.9);
    const key = new THREE.DirectionalLight("#ffffff", 2.1);
    key.position.set(6, 7, 8);
    const fill = new THREE.PointLight("#61dfff", 20, 24);
    fill.position.set(-6, 1, -4);
    const warm = new THREE.PointLight("#ff8c8f", 14, 24);
    warm.position.set(5, -2, 5);
    const bottom = new THREE.PointLight("#88a5ff", 10, 28);
    bottom.position.set(0, -6, 0);
    this.scene.add(ambient, key, fill, warm, bottom);
  }

  clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children.pop();
      child.traverse?.((node) => {
        if (node.geometry) {
          node.geometry.dispose();
        }
        if (node.material) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => material.dispose());
        }
      });
    }
  }

  clearModel() {
    this.clearGroup(this.cellGroup);
    this.clearGroup(this.signalGroup);
    this.clearGroup(this.annotationGroup);
    this.floaters = [];
    this.motionPaths = [];
    this.explodable = [];
    this.componentGroups = {};
    this.activeNeuralAtlas = null;
    this.clearSelection();
  }

  setModel(model) {
    this.activeModel = model;
    this.activeProfile = getMorphologyProfile(model.id);
    this.activeNeuralAtlas = getNeuralMorphology(model.id);
    this.clearModel();

    const morphology = this.buildMorphology(model, this.activeProfile, this.activeNeuralAtlas);
    const organelles = this.buildOrganelles(model, this.activeProfile, morphology);

    this.currentOuterRadius = morphology.outerRadius || model.geometry.radius;
    this.componentGroups = {
      membrane: morphology.membraneGroup,
      nucleus: organelles.nucleusGroup,
      golgi: organelles.golgiGroup,
      reticulum: organelles.reticulumGroup,
      mitochondria: organelles.mitoGroup,
      vesicles: organelles.vesicleGroup,
      lysosomes: organelles.lysosomeGroup,
      cytoskeleton: organelles.cytoskeletonGroup,
      ribosomes: organelles.ribosomeGroup,
      processes: morphology.processGroup,
      projections: morphology.projectionGroup,
      pathways: morphology.pathwayGroup,
    };

    Object.values(this.componentGroups).forEach((group) => {
      if (group) {
        this.cellGroup.add(group);
      }
    });

    this.applyRenderMode();
    this.applyExplode();
    this.resetView();
    this.onSelectionChange(null);
  }

  buildMorphology(model, profile, neuralAtlas) {
    const family = profile.family;
    if ((family === "neuron" || family === "glia") && neuralAtlas) {
      return this.buildAtlasNeuralMorphology(model, profile, neuralAtlas);
    }

    const generic = {
      hepatocyte: () => this.buildHepatocyteMorphology(model),
      immune: () => this.buildImmuneMorphology(model),
      epithelial: () => this.buildEpithelialMorphology(model),
      muscle: () => this.buildMuscleMorphology(model),
      melanocyte: () => this.buildMelanocyteMorphology(model),
      oocyte: () => this.buildOocyteMorphology(model),
      embryonic: () => this.buildEmbryonicMorphology(model),
      neuron: () => this.buildFallbackNeuronMorphology(model),
      glia: () => this.buildFallbackGliaMorphology(model),
      generic: () => this.buildGenericMorphology(model),
    };

    return (generic[family] || generic.generic)();
  }

  createGroup(name) {
    const group = new THREE.Group();
    group.name = name;
    return group;
  }

  toVector3(values) {
    return new THREE.Vector3(values[0], values[1], values[2]);
  }

  buildCurveFromPoints(points) {
    return new THREE.CatmullRomCurve3(points.map((item) => this.toVector3(item)));
  }

  registerExplodable(mesh, vector) {
    this.explodable.push({
      mesh,
      origin: mesh.position.clone(),
      direction: vector.clone().normalize(),
    });
  }

  sampleInsideEllipsoid(center, radii, margin = 0.14) {
    const local = new THREE.Vector3();
    do {
      local.set(
        (Math.random() * 2 - 1) * (radii.x - margin),
        (Math.random() * 2 - 1) * (radii.y - margin),
        (Math.random() * 2 - 1) * (radii.z - margin),
      );
    } while (
      (local.x * local.x) / ((radii.x - margin) * (radii.x - margin)) +
        (local.y * local.y) / ((radii.y - margin) * (radii.y - margin)) +
        (local.z * local.z) / ((radii.z - margin) * (radii.z - margin)) >
      1
    );
    return center.clone().add(local);
  }

  buildAnnotation({ category, title, description, tags }) {
    return { category, title, description, tags };
  }

  attachAnnotation(object, annotation) {
    object.userData.annotation = annotation;
    return object;
  }

  setObjectLayer(group, annotation, meshes = []) {
    this.attachAnnotation(group, annotation);
    meshes.forEach((mesh) => this.attachAnnotation(mesh, annotation));
  }

  createSpinesForBranch(group, branch, color) {
    if (!branch.spineDensity || branch.spineDensity <= 0) {
      return [];
    }
    const created = [];
    const step = Math.max(2, Math.round(8 / branch.spineDensity));
    for (let index = 1; index < branch.points.length - 1; index += step) {
      const current = this.toVector3(branch.points[index]);
      const previous = this.toVector3(branch.points[index - 1]);
      const next = this.toVector3(branch.points[Math.min(index + 1, branch.points.length - 1)]);
      const tangent = next.clone().sub(previous).normalize();
      const side = new THREE.Vector3(-tangent.z, tangent.x, tangent.y).normalize();
      const spine = new THREE.Mesh(
        new THREE.ConeGeometry(0.012, 0.075, 6),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.82,
        }),
      );
      spine.position.copy(current).add(side.multiplyScalar(0.06));
      spine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      group.add(spine);
      created.push(spine);
    }
    return created;
  }

  createBoutonsForBranch(group, branch, color) {
    if (!branch.boutonSpacing || branch.boutonSpacing <= 0) {
      return [];
    }
    const created = [];
    const step = Math.max(2, Math.round(5 / branch.boutonSpacing));
    for (let index = 2; index < branch.points.length - 2; index += step) {
      const current = this.toVector3(branch.points[index]);
      const bouton = new THREE.Mesh(
        new THREE.SphereGeometry(0.05 + branch.radius * 0.9, 10, 10),
        createMaterial(color, {
          emissive: new THREE.Color("#183f4d"),
          opacity: 0.86,
          transmission: 0.12,
        }),
      );
      bouton.position.copy(current);
      group.add(bouton);
      this.floaters.push({ mesh: bouton, axis: "y", speed: 0.18 + index * 0.01, range: 0.01 });
      created.push(bouton);
    }
    return created;
  }

  createSignalPulse(curve, color, speed, size, annotation) {
    const mesh = this.attachAnnotation(
      new THREE.Mesh(
        new THREE.SphereGeometry(size, 12, 12),
        createMaterial(color, {
          emissive: new THREE.Color(color).multiplyScalar(0.65),
          roughness: 0.08,
          transmission: 0.25,
          opacity: 0.92,
        }),
      ),
      annotation,
    );
    this.signalGroup.add(mesh);
    this.motionPaths.push({
      mesh,
      curve,
      speed,
      offset: Math.random(),
      mode: "loop",
    });
  }

  createNeuralSignals(model, neuralCurves, boutons) {
    const axons = neuralCurves.filter((item) => item.branch.kind === "axon");
    axons.forEach((item) => {
      for (let index = 0; index < 3; index += 1) {
        this.createSignalPulse(
          item.curve,
          "#7dd6ff",
          0.08 + index * 0.022,
          0.065,
          this.buildAnnotation({
            category: "Electrical signal",
            title: "Action potential propagation",
            description:
              "These pulses travel from the axon initial segment toward boutons, representing depolarization and saltatory-like forward conduction in the projection path.",
            tags: ["axon", "depolarization", "propagation"],
          }),
        );
      }
    });

    boutons.slice(0, 18).forEach((bouton, index) => {
      const vesicle = this.attachAnnotation(
        new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 8, 8),
          createMaterial(model.palette.vesicle || COLOR_MAP.vesicle, {
            emissive: new THREE.Color("#1b4554"),
            opacity: 0.9,
            transmission: 0.18,
          }),
        ),
        this.buildAnnotation({
          category: "Synaptic release",
          title: "Neurotransmitter vesicle packet",
          description:
            "These vesicle packets circulate around presynaptic boutons and represent transmitter loading, docking, and release near the active zone.",
          tags: ["synapse", "vesicle", "neurotransmitter"],
        }),
      );
      this.signalGroup.add(vesicle);
      this.motionPaths.push({
        mesh: vesicle,
        anchor: bouton.position.clone(),
        speed: 0.2 + index * 0.005,
        radius: 0.12 + (index % 3) * 0.03,
        offset: index / 18,
        mode: "orbit",
      });
    });
  }

  buildAtlasNeuralMorphology(model, profile, atlas) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");
    const pathwayGroup = this.createGroup("pathways");
    const boutonMeshes = [];

    const somaRadii = new THREE.Vector3(...atlas.soma.radii);
    const somaCenter = this.toVector3(atlas.soma.center);
    const somaGeometry = new THREE.SphereGeometry(1, 40, 40);
    somaGeometry.scale(somaRadii.x, somaRadii.y, somaRadii.z);
    const soma = new THREE.Mesh(
      somaGeometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.28,
        thickness: 0.22,
      }),
    );
    soma.position.copy(somaCenter);
    soma.rotation.set(...atlas.soma.orientation);
    membraneGroup.add(soma);
    this.setObjectLayer(
      membraneGroup,
      this.buildAnnotation({
        category: profile.family === "glia" ? "Glial soma" : "Neuronal soma",
        title: atlas.brainMeta.displayName,
        description: atlas.brainMeta.laminarContext,
        tags: [atlas.brainMeta.regionContext, atlas.brainMeta.cellClass],
      }),
      [soma],
    );

    const branchMaterial = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.12,
      opacity: 0.9,
    });
    const fineMaterial = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.05,
      opacity: 0.8,
    });

    const neuralCurves = [];
    atlas.branches.forEach((branch) => {
      const curve = this.buildCurveFromPoints(branch.points);
      neuralCurves.push({ curve, branch });
      const targetGroup =
        branch.kind === "axon" || branch.kind === "axonCollateral" || branch.kind === "endfoot"
          ? projectionGroup
          : processGroup;
      const radius = branch.radius;
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(24, branch.points.length * 6), radius, branch.kind === "glialFine" ? 6 : 10, false),
        (branch.kind === "axon" || branch.kind === "axonCollateral" || branch.kind === "glialFine")
          ? fineMaterial
          : branchMaterial,
      );

      const annotationByKind = {
        apical: this.buildAnnotation({
          category: "Dendrite",
          title: "Apical dendrite",
          description:
            "The apical tree carries excitatory inputs and extends away from the soma toward distal laminar targets.",
          tags: ["apical", "input integration", atlas.brainMeta.regionContext],
        }),
        basal: this.buildAnnotation({
          category: "Dendrite",
          title: "Basal dendrite",
          description:
            "Basal dendrites spread laterally from the soma and host dense dendritic spines for local excitatory integration.",
          tags: ["basal arbor", "spines", "synaptic input"],
        }),
        axon: this.buildAnnotation({
          category: "Axon",
          title: "Projection axon",
          description:
            "This axon arises from the soma base and carries action potentials toward distal targets and local boutons.",
          tags: ["axon", "action potential", "output"],
        }),
        axonCollateral: this.buildAnnotation({
          category: "Synaptic output",
          title: "Axon collateral",
          description:
            "Local collaterals branch from the axon and terminate in bouton-like swellings used for neurotransmitter release.",
          tags: ["collateral", "bouton", "neurotransmitter"],
        }),
        glialPrimary: this.buildAnnotation({
          category: "Astrocyte process",
          title: "Primary astrocytic process",
          description:
            "Primary processes radiate from the astrocyte soma and support the larger territorial arbor.",
          tags: ["glia", "territory", "support"],
        }),
        glialSecondary: this.buildAnnotation({
          category: "Astrocyte branchlet",
          title: "Fine astrocytic branch",
          description:
            "Fine branchlets reach into the neuropil and are used here to suggest perisynaptic coverage.",
          tags: ["branchlet", "perisynaptic", "astrocyte"],
        }),
        glialFine: this.buildAnnotation({
          category: "Astrocyte fine process",
          title: "Fine astrocytic process",
          description:
            "These finest branches represent the dense unresolved glial arbor that surrounds synapses and extracellular space.",
          tags: ["fine process", "glia", "coverage"],
        }),
        endfoot: this.buildAnnotation({
          category: "Astrocyte endfoot",
          title: "Vascular endfoot-like termination",
          description:
            "The broader terminal pad suggests astrocytic endfoot morphology associated with vascular and barrier interfaces.",
          tags: ["endfoot", "vascular", "astrocyte"],
        }),
      };

      this.attachAnnotation(mesh, annotationByKind[branch.kind] || annotationByKind.apical);
      targetGroup.add(mesh);

      const createdSpines = this.createSpinesForBranch(
        targetGroup,
        branch,
        model.palette.ribosome || COLOR_MAP.ribosome,
      );
      createdSpines.forEach((item) =>
        this.attachAnnotation(
          item,
          this.buildAnnotation({
            category: "Synaptic spine",
            title: "Dendritic spine field",
            description:
              "Spines are represented as dense protrusions on dendrites where excitatory postsynaptic signaling is concentrated.",
            tags: ["spine", "postsynaptic", "plasticity"],
          }),
        ),
      );

      const createdBoutons = this.createBoutonsForBranch(
        targetGroup,
        branch,
        model.palette.vesicle || COLOR_MAP.vesicle,
      );
      createdBoutons.forEach((item) =>
        this.attachAnnotation(
          item,
          this.buildAnnotation({
            category: "Synaptic bouton",
            title: "Presynaptic bouton",
            description:
              "Bouton swellings represent transmitter release sites where vesicle-rich terminals contact downstream cells.",
            tags: ["bouton", "release site", "synapse"],
          }),
        ),
      );
      boutonMeshes.push(...createdBoutons);

      if (branch.kind === "endfoot") {
        const endPoint = this.toVector3(branch.points[branch.points.length - 1]);
        const pad = new THREE.Mesh(
          new THREE.SphereGeometry(branch.radius * 1.8, 12, 12),
          createMaterial(model.palette.vesicle || COLOR_MAP.vesicle, {
            emissive: new THREE.Color("#173848"),
            opacity: 0.72,
            transmission: 0.18,
          }),
        );
        pad.position.copy(endPoint);
        this.attachAnnotation(
          pad,
          this.buildAnnotation({
            category: "Astrocyte endfoot",
            title: "Endfoot terminal pad",
            description:
              "Terminal pads suggest the broadened astrocytic surface used for vascular or barrier contact.",
            tags: ["endfoot", "vascular interface", "glia"],
          }),
        );
        projectionGroup.add(pad);
      }
    });

    this.createNeuralSignals(model, neuralCurves, boutonMeshes);
    this.setObjectLayer(
      pathwayGroup,
      this.buildAnnotation({
        category: "Pathway animation",
        title: "Activity overlays",
        description:
          "Animated pulses trace action potentials along axons and vesicle trafficking around boutons to illustrate electrical and chemical signaling.",
        tags: ["activity", "pathway", "animation"],
      }),
    );

    this.registerExplodable(membraneGroup, new THREE.Vector3(-0.4, 0.6, 0.2));
    this.registerExplodable(processGroup, new THREE.Vector3(0.6, 0.3, 0.1));
    this.registerExplodable(projectionGroup, new THREE.Vector3(-0.1, 1, 0.5));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      pathwayGroup,
      somaCenter,
      somaRadii,
      somaRadius: Math.max(somaRadii.x, somaRadii.y, somaRadii.z),
      outerRadius:
        Math.max(
          ...atlas.branches.flatMap((branch) =>
            branch.points.map(([x, y, z]) => Math.sqrt(x * x + y * y + z * z)),
          ),
        ) + 0.7,
      processCurves: neuralCurves.map((item) => item.curve),
      neuralCurves,
      axonCurves: neuralCurves
        .filter((item) => item.branch.kind === "axon" || item.branch.kind === "axonCollateral")
        .map((item) => item.curve),
      shell: soma,
    };
  }

  buildGenericMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");
    const pathwayGroup = this.createGroup("pathways");
    const radii = new THREE.Vector3(model.geometry.radius * 0.96, model.geometry.radius * 0.92, model.geometry.radius * 0.94);
    const shellGeometry = new THREE.SphereGeometry(1, 34, 34);
    shellGeometry.scale(radii.x, radii.y, radii.z);
    deformSphere(shellGeometry, model.geometry.radius, {
      scaleX: model.geometry.wrinkleScale,
      scaleY: model.geometry.wrinkleScale * 0.75,
      scaleZ: model.geometry.wrinkleScale * 1.1,
      amplitude: model.geometry.wrinkleAmp * 0.75,
    });
    const shell = new THREE.Mesh(
      shellGeometry,
      createMaterial(model.palette.membrane || COLOR_MAP.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow || "#0d3345"),
        transmission: 0.4,
        thickness: 0.48,
        clearcoat: 0.9,
      }),
    );
    membraneGroup.add(shell);
    this.setObjectLayer(
      membraneGroup,
      this.buildAnnotation({
        category: "Cell membrane",
        title: `${model.name} membrane`,
        description:
          "The membrane encloses the cytoplasm and its main organelles. Internal components are constrained to the interior volume in this view.",
        tags: ["membrane", model.species, model.tissue],
      }),
      [shell],
    );
    this.registerExplodable(membraneGroup, new THREE.Vector3(0, 1, 0.4));
    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      pathwayGroup,
      shell,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadii: radii,
      somaRadius: model.geometry.radius,
      outerRadius: model.geometry.radius + 0.4,
      processCurves: [],
      axonCurves: [],
    };
  }

  buildHepatocyteMorphology(model) {
    const base = this.buildGenericMorphology(model);
    base.somaRadii = new THREE.Vector3(2.2, 1.7, 1.95);
    base.somaRadius = 2.05;
    const geometry = new THREE.SphereGeometry(1, 28, 28);
    geometry.scale(base.somaRadii.x, base.somaRadii.y, base.somaRadii.z);
    deformSphere(geometry, 1.9, { scaleX: 2.8, scaleY: 2.2, scaleZ: 2.4, amplitude: 0.12 });
    base.membraneGroup.clear();
    const shell = new THREE.Mesh(
      geometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.22,
      }),
    );
    base.membraneGroup.add(shell);
    this.setObjectLayer(
      base.membraneGroup,
      this.buildAnnotation({
        category: "Hepatocyte shell",
        title: "Polyhedral hepatocyte body",
        description:
          "The body is flattened and polygonal rather than spherical, with canalicular grooves and a denser central cytoplasm.",
        tags: ["hepatocyte", "bile canaliculus", "parenchyma"],
      }),
      [shell],
    );
    for (let index = 0; index < 4; index += 1) {
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(0.95 + index * 0.07, 0.032, 10, 48, Math.PI * 0.95),
        new THREE.MeshBasicMaterial({
          color: model.palette.cytoskeleton,
          transparent: true,
          opacity: 0.42,
        }),
      );
      groove.rotation.set(0.25 + index * 0.18, 0.8 - index * 0.12, 0.3 + index * 0.08);
      groove.position.set(0.18 - index * 0.05, -0.1 + index * 0.08, -0.15 + index * 0.08);
      base.projectionGroup.add(groove);
    }
    base.outerRadius = 2.5;
    return base;
  }

  buildImmuneMorphology(model) {
    const base = this.buildGenericMorphology(model);
    base.somaRadii = new THREE.Vector3(1.65, 1.58, 1.62);
    base.somaRadius = 1.62;
    base.outerRadius = 1.95;
    const spikeMaterial = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.08,
      opacity: 0.8,
    });
    for (let index = 0; index < 80; index += 1) {
      const spike = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.03, 0.16 + Math.random() * 0.08, 6),
        spikeMaterial,
      );
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const normal = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );
      if (normal.x > 0.75) {
        continue;
      }
      spike.position.copy(normal.clone().multiply(new THREE.Vector3(base.somaRadii.x, base.somaRadii.y, base.somaRadii.z)));
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      this.attachAnnotation(
        spike,
        this.buildAnnotation({
          category: "Immune surface",
          title: "Microvillus scanning protrusion",
          description:
            "These surface protrusions suggest receptor-rich immune scanning and synapse formation behavior.",
          tags: ["microvillus", "immune", "surface receptor"],
        }),
      );
      base.processGroup.add(spike);
    }
    return base;
  }

  buildEpithelialMorphology(model) {
    const base = this.buildGenericMorphology(model);
    base.somaRadii = new THREE.Vector3(1.65, 2.0, 1.5);
    base.somaRadius = 1.85;
    base.outerRadius = 2.25;
    for (let index = 0; index < 52; index += 1) {
      const projection = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.014, 0.08 + Math.random() * 0.04, 4, 8),
        createMaterial(model.palette.vesicle, {
          emissive: new THREE.Color("#173848"),
          opacity: 0.78,
        }),
      );
      projection.position.set(
        (Math.random() - 0.5) * 1.5,
        base.somaRadii.y * 0.85 + Math.random() * 0.18,
        (Math.random() - 0.5) * 1.1,
      );
      projection.rotation.x = Math.PI / 2;
      base.processGroup.add(projection);
    }
    return base;
  }

  buildMuscleMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");
    const pathwayGroup = this.createGroup("pathways");
    const geometry = new THREE.CapsuleGeometry(1.0, 3.4, 14, 24);
    geometry.rotateZ(Math.PI / 2);
    const shell = new THREE.Mesh(
      geometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.18,
      }),
    );
    membraneGroup.add(shell);
    this.setObjectLayer(
      membraneGroup,
      this.buildAnnotation({
        category: "Contractile membrane",
        title: "Cardiomyocyte body",
        description:
          "The contractile cell is elongated and banded, with organized energetic lanes and aligned internal architecture.",
        tags: ["cardiomyocyte", "contractile", "sarcomeric"],
      }),
      [shell],
    );
    for (let index = 0; index < 18; index += 1) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.86, 0.018, 8, 42),
        new THREE.MeshBasicMaterial({
          color: model.palette.cytoskeleton,
          transparent: true,
          opacity: 0.38,
        }),
      );
      band.rotation.y = Math.PI / 2;
      band.position.x = -1.75 + index * 0.21;
      projectionGroup.add(band);
    }
    this.registerExplodable(membraneGroup, new THREE.Vector3(1, 0.2, 0));
    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      pathwayGroup,
      shell,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadii: new THREE.Vector3(2.7, 1.0, 1.0),
      somaRadius: 2.4,
      outerRadius: 2.8,
      processCurves: [],
      axonCurves: [],
    };
  }

  buildMelanocyteMorphology(model) {
    const base = this.buildGenericMorphology(model);
    const armMaterial = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.12,
      opacity: 0.84,
    });
    const arms = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.7, 0.4, 0),
        new THREE.Vector3(1.9, 0.8, 0.8),
        new THREE.Vector3(3.1, 1.4, 1.5),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.6, 0.2, 0.3),
        new THREE.Vector3(-1.7, 0.5, 1.4),
        new THREE.Vector3(-2.8, 1.0, 2.1),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.4, -0.4, -0.1),
        new THREE.Vector3(-1.2, -1.1, -1.0),
        new THREE.Vector3(-2.2, -1.7, -1.6),
      ]),
    ];
    addCurveTubes(base.processGroup, arms, armMaterial, 0.08, 72, 10);
    this.setObjectLayer(
      base.processGroup,
      this.buildAnnotation({
        category: "Dendritic process",
        title: "Melanocyte transfer arm",
        description:
          "Melanocyte dendritic processes extend outward to transfer pigment-containing packets toward neighboring cells.",
        tags: ["melanocyte", "dendrite", "pigment transfer"],
      }),
    );
    base.outerRadius = 3.2;
    return base;
  }

  buildOocyteMorphology(model) {
    const base = this.buildGenericMorphology(model);
    base.somaRadii = new THREE.Vector3(2.6, 2.45, 2.58);
    base.somaRadius = 2.55;
    base.outerRadius = 2.9;
    return base;
  }

  buildEmbryonicMorphology(model) {
    const base = this.buildGenericMorphology(model);
    for (let index = 0; index < 7; index += 1) {
      const bleb = new THREE.Mesh(
        new THREE.SphereGeometry(0.14 + Math.random() * 0.06, 14, 14),
        createMaterial(model.palette.membrane, {
          emissive: new THREE.Color(model.palette.membraneGlow),
          transmission: 0.18,
          opacity: 0.76,
        }),
      );
      const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      bleb.position.copy(direction.multiplyScalar(base.somaRadius * 0.92));
      base.processGroup.add(bleb);
      this.floaters.push({ mesh: bleb, axis: "x", speed: 0.16 + index * 0.05, range: 0.012 });
    }
    return base;
  }

  buildFallbackNeuronMorphology(model) {
    return this.buildMelanocyteMorphology(model);
  }

  buildFallbackGliaMorphology(model) {
    const base = this.buildGenericMorphology(model);
    const branches = Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      return new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(angle) * 0.5, (Math.random() - 0.5) * 0.3, Math.sin(angle) * 0.5),
        new THREE.Vector3(Math.cos(angle) * 1.4, (Math.random() - 0.5) * 0.8, Math.sin(angle) * 1.4),
        new THREE.Vector3(Math.cos(angle) * 2.3, (Math.random() - 0.5) * 1.2, Math.sin(angle) * 2.3),
      ]);
    });
    addCurveTubes(base.processGroup, branches, createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.1,
      opacity: 0.8,
    }), 0.05, 64, 8);
    base.outerRadius = 2.6;
    return base;
  }

  buildOrganelles(model, profile, morphology) {
    const nucleusGroup = this.createNucleus(model, morphology, profile);
    const golgiGroup = this.createGolgi(model, morphology, profile);
    const reticulumGroup = this.createReticulum(model, morphology, profile);
    const mitoGroup = this.createMitochondria(model, morphology, profile);
    const vesicleGroup = this.createVesicles(model, morphology, profile);
    const lysosomeGroup = this.createLysosomes(model, morphology, profile);
    const cytoskeletonGroup = this.createCytoskeleton(model, morphology, profile);
    const ribosomeGroup = this.createRibosomes(model, morphology, profile);
    return {
      nucleusGroup,
      golgiGroup,
      reticulumGroup,
      mitoGroup,
      vesicleGroup,
      lysosomeGroup,
      cytoskeletonGroup,
      ribosomeGroup,
    };
  }

  createNucleus(model, morphology, profile) {
    const nucleusGroup = this.createGroup("nucleus");
    const offsetMap = {
      neuron: new THREE.Vector3(-0.12, 0.08, 0),
      glia: new THREE.Vector3(-0.02, 0.05, 0),
      hepatocyte: new THREE.Vector3(0.12, 0.03, 0),
      immune: new THREE.Vector3(-0.05, 0.02, 0),
      muscle: new THREE.Vector3(-0.8, 0, 0),
      epithelial: new THREE.Vector3(0, -0.18, 0),
      generic: new THREE.Vector3(-0.05, 0.04, 0),
    };
    const radiusFactor = {
      neuron: 0.44,
      glia: 0.42,
      hepatocyte: 0.42,
      immune: 0.56,
      muscle: 0.3,
      epithelial: 0.38,
      generic: 0.42,
    };
    const radius = morphology.somaRadius * (radiusFactor[profile.family] || radiusFactor.generic);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 28, 28),
      createMaterial(model.palette.nucleus || COLOR_MAP.nucleus, {
        emissive: new THREE.Color("#2c163f"),
        roughness: 0.28,
        transmission: 0.18,
      }),
    );
    core.position.copy(morphology.somaCenter).add(offsetMap[profile.family] || offsetMap.generic);
    core.scale.set(1.0, 0.94, 1.04);
    const nucleolus = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.28, 18, 18),
      new THREE.MeshStandardMaterial({
        color: "#ffe8ff",
        emissive: "#8d3975",
      }),
    );
    nucleolus.position.copy(core.position).add(new THREE.Vector3(radius * 0.24, -radius * 0.12, radius * 0.16));
    nucleusGroup.add(core, nucleolus);
    this.setObjectLayer(
      nucleusGroup,
      this.buildAnnotation({
        category: "Organelle",
        title: "Nucleus",
        description:
          "The nucleus stays inside the soma and anchors gene-expression state, chromatin regulation, and stress-response programs.",
        tags: ["nucleus", "transcription", "chromatin"],
      }),
      [core, nucleolus],
    );
    this.floaters.push({ mesh: nucleusGroup, axis: "y", speed: 0.18, range: 0.012 });
    this.registerExplodable(nucleusGroup, new THREE.Vector3(0, 1, 0.1));
    return nucleusGroup;
  }

  createGolgi(model, morphology, profile) {
    const golgiGroup = this.createGroup("golgi");
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.golgi || COLOR_MAP.golgi,
      emissive: "#4f3208",
      roughness: 0.26,
    });
    const stackCount = profile.family === "hepatocyte" ? 8 : 6;
    const created = [];
    for (let index = 0; index < stackCount; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.42 - index * 0.032, 0.024, 12, 84, Math.PI * 1.22),
        material,
      );
      mesh.scale.set(1.05, 0.54, 1.0);
      mesh.position.copy(morphology.somaCenter).add(new THREE.Vector3(0.42, -0.18 + index * 0.055, -0.12 + index * 0.015));
      mesh.rotation.set(Math.PI / 2.38, 0.8, 0.12);
      golgiGroup.add(mesh);
      created.push(mesh);
    }
    this.setObjectLayer(
      golgiGroup,
      this.buildAnnotation({
        category: "Organelle",
        title: "Golgi cisternal stack",
        description:
          "The Golgi is modeled as flattened curved cisternae clustered perinuclearly rather than as a free-floating torus.",
        tags: ["Golgi", "cisternae", "cargo sorting"],
      }),
      created,
    );
    this.registerExplodable(golgiGroup, new THREE.Vector3(1, -0.2, 0.4));
    return golgiGroup;
  }

  createReticulum(model, morphology, profile) {
    const reticulumGroup = this.createGroup("reticulum");
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.reticulum || COLOR_MAP.reticulum,
      emissive: "#10362d",
      roughness: 0.48,
      transparent: true,
      opacity: 0.82,
    });
    const ringCount = profile.family === "hepatocyte" ? 14 : 8;
    const created = [];
    for (let index = 0; index < ringCount; index += 1) {
      const points = [];
      for (let step = 0; step < 11; step += 1) {
        const t = (step / 10) * Math.PI * 2;
        points.push(
          morphology.somaCenter.clone().add(
            new THREE.Vector3(
              Math.sin(t) * (morphology.somaRadii.x * (0.18 + index * 0.04)),
              Math.cos(t * 1.2) * (morphology.somaRadii.y * (0.08 + index * 0.02)),
              Math.cos(t) * (morphology.somaRadii.z * (0.18 + index * 0.04)),
            ),
          ),
        );
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 42, profile.family === "hepatocyte" ? 0.035 : 0.024, 8, false),
        material,
      );
      reticulumGroup.add(mesh);
      created.push(mesh);
    }
    if (morphology.processCurves.length > 0) {
      morphology.processCurves.slice(0, 5).forEach((curve) => {
        const samplePoints = curve.getPoints(8).slice(1, 6);
        const branchCurve = new THREE.CatmullRomCurve3(samplePoints);
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(branchCurve, 28, 0.014, 6, false),
          material,
        );
        reticulumGroup.add(mesh);
        created.push(mesh);
      });
    }
    this.setObjectLayer(
      reticulumGroup,
      this.buildAnnotation({
        category: "Organelle",
        title: "Endoplasmic reticulum",
        description:
          "Reticular membranes remain packed inside the soma or cell body and only extend into major processes for neural cells.",
        tags: ["ER", "translation", "protein folding"],
      }),
      created,
    );
    this.registerExplodable(reticulumGroup, new THREE.Vector3(-0.6, 0.1, 0.8));
    return reticulumGroup;
  }

  createMitochondria(model, morphology, profile) {
    const mitoGroup = this.createGroup("mitochondria");
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.mitochondria || COLOR_MAP.mitochondria,
      emissive: "#431509",
      roughness: 0.35,
    });
    const created = [];

    const addBodyMito = (count) => {
      for (let index = 0; index < count; index += 1) {
        const mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.06, 0.16 + Math.random() * 0.16, 8, 16),
          material,
        );
        mesh.position.copy(this.sampleInsideEllipsoid(morphology.somaCenter, morphology.somaRadii, 0.18));
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        mitoGroup.add(mesh);
        created.push(mesh);
      }
    };

    if (profile.family === "muscle") {
      for (let index = 0; index < 40; index += 1) {
        const mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.05, 0.3, 8, 16),
          material,
        );
        mesh.position.set(
          -1.85 + (index % 14) * 0.26,
          -0.58 + Math.floor(index / 14) * 0.54,
          (Math.random() - 0.5) * 0.62,
        );
        mesh.rotation.z = Math.PI / 2;
        mitoGroup.add(mesh);
        created.push(mesh);
      }
    } else {
      addBodyMito(Math.max(6, Math.round(model.components.mitochondria * 0.55)));
    }

    if (morphology.processCurves.length > 0) {
      morphology.processCurves.slice(0, 10).forEach((curve, curveIndex) => {
        const samples = curve.getPoints(10);
        samples.slice(2, 7).forEach((point, pointIndex) => {
          if ((pointIndex + curveIndex) % 2 !== 0) {
            return;
          }
          const mesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.035, 0.16 + Math.random() * 0.12, 8, 14),
            material,
          );
          mesh.position.copy(point);
          mesh.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
          mitoGroup.add(mesh);
          created.push(mesh);
        });
      });
    }

    this.setObjectLayer(
      mitoGroup,
      this.buildAnnotation({
        category: "Organelle",
        title: "Mitochondrial network",
        description:
          "Mitochondria are constrained to the soma and major processes, with elongated neural mitochondria following dendritic and axonal shafts.",
        tags: ["mitochondria", "ATP", "metabolism"],
      }),
      created,
    );
    this.registerExplodable(mitoGroup, new THREE.Vector3(-0.5, -0.3, 1));
    return mitoGroup;
  }

  createVesicles(model, morphology, profile) {
    const vesicleGroup = this.createGroup("vesicles");
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.vesicle || COLOR_MAP.vesicle,
      emissive: "#153947",
      transparent: true,
      opacity: 0.9,
    });
    const created = [];
    const count = profile.family === "neuron" ? Math.round(model.components.vesicles * 0.5) : model.components.vesicles;
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.04 + Math.random() * 0.03, 14, 14),
        material,
      );
      mesh.position.copy(this.sampleInsideEllipsoid(morphology.somaCenter, morphology.somaRadii, 0.16));
      vesicleGroup.add(mesh);
      created.push(mesh);
      this.floaters.push({ mesh, axis: "z", speed: 0.16 + Math.random() * 0.2, range: 0.01 });
    }
    this.setObjectLayer(
      vesicleGroup,
      this.buildAnnotation({
        category: "Organelle",
        title: "Transport vesicles",
        description:
          "Transport vesicles are kept within the cytoplasm, or concentrated near synapses in neurons, to reflect realistic trafficking compartments.",
        tags: ["vesicle", "trafficking", "secretion"],
      }),
      created,
    );
    this.registerExplodable(vesicleGroup, new THREE.Vector3(0.2, 0.8, 0.9));
    return vesicleGroup;
  }

  createLysosomes(model, morphology) {
    const lysosomeGroup = this.createGroup("lysosomes");
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.lysosome || COLOR_MAP.lysosome,
      emissive: "#4d1432",
      roughness: 0.25,
    });
    const created = [];
    for (let index = 0; index < model.components.lysosomes; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.07 + Math.random() * 0.02, 1),
        material,
      );
      mesh.position.copy(this.sampleInsideEllipsoid(morphology.somaCenter, morphology.somaRadii, 0.16));
      lysosomeGroup.add(mesh);
      created.push(mesh);
      this.floaters.push({ mesh, axis: "y", speed: 0.16 + Math.random() * 0.16, range: 0.01 });
    }
    this.setObjectLayer(
      lysosomeGroup,
      this.buildAnnotation({
        category: "Organelle",
        title: "Lysosomal compartment",
        description:
          "Lysosomes are clustered inside the soma or cell body where degradation and recycling are concentrated.",
        tags: ["lysosome", "recycling", "autophagy"],
      }),
      created,
    );
    this.registerExplodable(lysosomeGroup, new THREE.Vector3(-0.8, 0.4, -0.2));
    return lysosomeGroup;
  }

  createCytoskeleton(model, morphology, profile) {
    const cytoskeletonGroup = this.createGroup("cytoskeleton");
    const material = new THREE.MeshBasicMaterial({
      color: model.palette.cytoskeleton || COLOR_MAP.cytoskeleton,
      transparent: true,
      opacity: 0.42,
    });
    const created = [];

    if (profile.family === "muscle") {
      for (let index = 0; index < 20; index += 1) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-2.1 + index * 0.2, -0.7, -0.58),
          new THREE.Vector3(-2.0 + index * 0.2, 0, 0),
          new THREE.Vector3(-1.9 + index * 0.2, 0.7, 0.58),
        ]);
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.014, 6, false), material);
        cytoskeletonGroup.add(mesh);
        created.push(mesh);
      }
    } else {
      const filaments = Math.max(10, Math.min(model.components.filaments, 28));
      for (let index = 0; index < filaments; index += 1) {
        const start = this.sampleInsideEllipsoid(morphology.somaCenter, morphology.somaRadii, 0.22);
        const mid = this.sampleInsideEllipsoid(morphology.somaCenter, morphology.somaRadii, 0.22);
        const end = this.sampleInsideEllipsoid(morphology.somaCenter, morphology.somaRadii, 0.22);
        const curve = new THREE.CatmullRomCurve3([start, mid, end]);
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.012, 6, false), material);
        cytoskeletonGroup.add(mesh);
        created.push(mesh);
      }
      morphology.processCurves.slice(0, 6).forEach((curve) => {
        const sample = curve.getPoints(5);
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sample), 18, 0.008, 5, false),
          material,
        );
        cytoskeletonGroup.add(mesh);
        created.push(mesh);
      });
    }

    this.setObjectLayer(
      cytoskeletonGroup,
      this.buildAnnotation({
        category: "Structural scaffold",
        title: "Cytoskeletal framework",
        description:
          "The scaffold stays inside the cell body and along real processes, rather than floating free outside the membrane.",
        tags: ["cytoskeleton", "transport", "structure"],
      }),
      created,
    );
    this.registerExplodable(cytoskeletonGroup, new THREE.Vector3(0, -1, 0.4));
    return cytoskeletonGroup;
  }

  createRibosomes(model, morphology) {
    const ribosomeGroup = this.createGroup("ribosomes");
    const geometry = new THREE.SphereGeometry(0.016, 7, 7);
    const material = new THREE.MeshBasicMaterial({
      color: model.palette.ribosome || COLOR_MAP.ribosome,
      transparent: true,
      opacity: 0.84,
    });
    const instanced = new THREE.InstancedMesh(geometry, material, model.components.ribosomes);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let index = 0; index < model.components.ribosomes; index += 1) {
      const position = this.sampleInsideEllipsoid(morphology.somaCenter, morphology.somaRadii, 0.14);
      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(index, matrix);
    }
    ribosomeGroup.add(instanced);
    this.setObjectLayer(
      ribosomeGroup,
      this.buildAnnotation({
        category: "Translation machinery",
        title: "Ribosomal field",
        description:
          "Ribosomes are distributed through the cytoplasm and rough ER-rich zones but remain inside the cell body in this visualization.",
        tags: ["ribosome", "translation", "protein synthesis"],
      }),
      [instanced],
    );
    this.registerExplodable(ribosomeGroup, new THREE.Vector3(0.2, 0.2, -1));
    return ribosomeGroup;
  }

  setStateTension(nextValue) {
    this.stateTension = clamp(nextValue, 0, 1);
    const targetScale = 1 + this.stateTension * 0.08;
    this.root.scale.setScalar(targetScale);
    this.controls.autoRotate = this.stateTension > 0.2;
  }

  setExplodeAmount(nextValue) {
    this.explodeAmount = clamp(nextValue, 0, 1);
    this.applyExplode();
  }

  applyExplode() {
    const distance = this.explodeAmount * 1.5;
    this.explodable.forEach((item) => {
      item.mesh.position.copy(item.origin).add(item.direction.clone().multiplyScalar(distance));
    });
  }

  setWireframe(enabled) {
    this.showWireframe = Boolean(enabled);
    this.applyRenderMode();
  }

  setXRay(enabled) {
    this.showXRay = Boolean(enabled);
    this.applyRenderMode();
  }

  toggleComponent(name, enabled) {
    if (this.componentGroups[name]) {
      this.componentGroups[name].visible = enabled;
    }
  }

  applyRenderMode() {
    this.cellGroup.traverse((node) => {
      if (!node.material) {
        return;
      }
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (!("opacity" in material)) {
          return;
        }
        if (material.userData.baseOpacity == null) {
          material.userData.baseOpacity = material.opacity;
        }
        material.wireframe = this.showWireframe;
        if (this.showXRay) {
          material.transparent = true;
          material.opacity = Math.min(material.userData.baseOpacity, 0.26);
          material.depthWrite = false;
        } else {
          material.opacity = material.userData.baseOpacity;
          material.depthWrite = true;
        }
      });
    });
  }

  zoom(delta) {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const next = this.camera.position.clone().add(direction.multiplyScalar(delta));
    const targetDistance = next.distanceTo(this.controls.target);
    if (targetDistance >= this.controls.minDistance && targetDistance <= this.controls.maxDistance) {
      this.camera.position.copy(next);
    }
  }

  focusOnNucleus() {
    const nucleus = this.componentGroups.nucleus;
    if (!nucleus) {
      return;
    }
    this.controls.target.copy(nucleus.position);
  }

  resetView() {
    const isExtended = this.activeProfile && ["neuron", "glia", "muscle", "melanocyte"].includes(this.activeProfile.family);
    const extendedZ = Math.max(12.5, this.currentOuterRadius * 1.2);
    this.camera.position.copy(isExtended ? new THREE.Vector3(0.8, 1.4, extendedZ) : this.defaultCamera.clone());
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  handlePointerDown(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.cellGroup.children, true);
    const hit = intersections.find((item) => this.findAnnotatedObject(item.object));
    if (!hit) {
      this.clearSelection();
      return;
    }
    const annotated = this.findAnnotatedObject(hit.object);
    this.selectObject(annotated);
  }

  findAnnotatedObject(object) {
    let current = object;
    while (current) {
      if (current.userData && current.userData.annotation) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  selectObject(object) {
    this.clearSelection(false);
    this.selection = object;
    const material = object.material || object.children.find((child) => child.material)?.material;
    if (material && !Array.isArray(material) && material.emissive) {
      this.highlightedMaterial = material;
      this.highlightedPreviousEmissive = material.emissive.clone();
      material.emissive = material.emissive.clone().lerp(new THREE.Color("#ffffff"), 0.35);
    }
    this.onSelectionChange(object.userData.annotation);
  }

  clearSelection(emit = true) {
    if (this.highlightedMaterial && this.highlightedPreviousEmissive) {
      this.highlightedMaterial.emissive.copy(this.highlightedPreviousEmissive);
    }
    this.highlightedMaterial = null;
    this.highlightedPreviousEmissive = null;
    this.selection = null;
    if (emit) {
      this.onSelectionChange(null);
    }
  }

  animateSignals(elapsed) {
    this.motionPaths.forEach((path) => {
      if (path.mode === "orbit") {
        const angle = (elapsed * path.speed + path.offset * Math.PI * 2) % (Math.PI * 2);
        path.mesh.position.set(
          path.anchor.x + Math.cos(angle) * path.radius,
          path.anchor.y + Math.sin(angle * 1.3) * path.radius * 0.45,
          path.anchor.z + Math.sin(angle) * path.radius,
        );
        return;
      }
      const t = (elapsed * path.speed + path.offset) % 1;
      path.mesh.position.copy(path.curve.getPointAt(t));
    });
  }

  animate() {
    const elapsed = this.clock.getElapsedTime();
    this.floaters.forEach((floater, index) => {
      const phase = elapsed * floater.speed + index * 0.37;
      floater.mesh.position[floater.axis] += Math.sin(phase) * floater.range * 0.018;
      floater.mesh.rotation.x += 0.0008;
      floater.mesh.rotation.y += 0.001;
    });
    this.animateSignals(elapsed);
    this.root.rotation.y += 0.0009 + this.stateTension * 0.0008;
    this.root.rotation.z = Math.sin(elapsed * 0.12) * 0.04;
    this.stars.rotation.y -= 0.00025;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  }

  handleResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.handleResize);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
