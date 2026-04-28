import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clamp } from "../utils/format.js";
import { getMorphologyProfile } from "../data/morphologyProfiles.js";

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
  myelin: "#e9f4ff",
  exposedAxon: "#ffb36e",
  node: "#fff7a8",
  microglia: "#9df7a5",
  astrocyte: "#8fd6ff",
  inflammatory: "#ff6a82",
  signal: "#fff36d",
};

const MOUSE_ROTATE = 0;
const MOUSE_DOLLY = 1;
const MOUSE_PAN = 2;

function createMaterial(color, overrides = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.35,
    metalness: 0.03,
    transparent: true,
    opacity: 0.96,
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
      Math.cos(vector.y * noise.scaleY) * noise.amplitude * 0.75 +
      Math.sin(vector.z * noise.scaleZ) * noise.amplitude * 0.55;
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

function seededRandom(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function pointInEllipsoid(center, rx, ry, rz, rand = Math.random, margin = 0.72) {
  const theta = rand() * Math.PI * 2;
  const phi = Math.acos(2 * rand() - 1);
  const radius = Math.cbrt(rand()) * margin;
  return center.clone().add(new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta) * rx * radius,
    Math.cos(phi) * ry * radius,
    Math.sin(phi) * Math.sin(theta) * rz * radius,
  ));
}

function safeInteriorRadii(morphology, profile) {
  if (profile.family === "muscle") return { x: 1.95, y: 0.62, z: 0.62 };
  if (profile.family === "hepatocyte") return { x: 1.55, y: 1.18, z: 1.38 };
  if (profile.family === "epithelial") return { x: 1.12, y: 1.25, z: 0.95 };
  if (profile.family === "immune") return { x: 1.05, y: 1.0, z: 1.05 };
  if (profile.family === "oocyte") return { x: 1.75, y: 1.75, z: 1.75 };
  if (profile.family === "neuron" || profile.family === "msNeuron") return { x: 1.0, y: 0.86, z: 0.92 };
  const r = Math.max(0.9, morphology.somaRadius * 0.72);
  return { x: r, y: r * 0.92, z: r };
}

function organellePoint(morphology, profile, seed, margin = 0.72) {
  const rand = seededRandom(seed);
  const radii = safeInteriorRadii(morphology, profile);
  return pointInEllipsoid(morphology.somaCenter, radii.x, radii.y, radii.z, rand, margin);
}

function orientAlongVector(mesh, vector) {
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize());
}

export class CellScene {
  constructor(container) {
    this.container = container;
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2("#07101c", 0.022);
    this.camera = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / container.clientHeight,
      0.1,
      150,
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
    this.controls.maxDistance = 24;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: MOUSE_ROTATE,
      MIDDLE: MOUSE_DOLLY,
      RIGHT: MOUSE_PAN,
    };

    this.root = new THREE.Group();
    this.cellGroup = new THREE.Group();
    this.annotationGroup = new THREE.Group();
    this.root.add(this.cellGroup, this.annotationGroup);
    this.scene.add(this.root);

    this.floaters = [];
    this.explodable = [];
    this.componentGroups = {};
    this.activeModel = null;
    this.activeProfile = null;
    this.stateTension = 0.25;
    this.explodeAmount = 0;
    this.showWireframe = false;
    this.showXRay = false;
    this.interactiveObjects = [];
    this.signalPulses = [];
    this.reactiveMeshes = [];
    this.selectionHalo = null;
    this.selectedInteractive = null;
    this.selectionCallback = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);

    this.setupEnvironment();
    this.setupLights();

    this.handleResize = this.handleResize.bind(this);
    this.animate = this.animate.bind(this);
    window.addEventListener("resize", this.handleResize);
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
          if (Array.isArray(node.material)) {
            node.material.forEach((item) => item.dispose());
          } else {
            node.material.dispose();
          }
        }
      });
    }
  }

  clearModel() {
    this.clearGroup(this.cellGroup);
    this.clearGroup(this.annotationGroup);
    this.floaters = [];
    this.explodable = [];
    this.componentGroups = {};
    this.interactiveObjects = [];
    this.signalPulses = [];
    this.reactiveMeshes = [];
    this.selectionHalo = null;
    this.selectedInteractive = null;
  }

  setSelectionCallback(callback) {
    this.selectionCallback = callback;
  }

  createComponentInfo(id, title, category, detail, markers = []) {
    return {
      id,
      title,
      category,
      detail,
      markers,
    };
  }

  registerInteractive(object, info) {
    object.userData.componentInfo = info;
    object.traverse?.((node) => {
      node.userData.componentInfo = info;
      if (node.isMesh || node.isLine || node.isPoints) {
        this.interactiveObjects.push(node);
      }
    });
    return object;
  }

  eventToPointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  findInteractiveTarget(event) {
    if (!this.interactiveObjects.length) return null;
    this.eventToPointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.interactiveObjects, true);
    if (!hits.length) return null;
    let target = hits[0].object;
    while (target && !target.userData.componentInfo) {
      target = target.parent;
    }
    return target;
  }

  handlePointerMove(event) {
    const target = this.findInteractiveTarget(event);
    this.renderer.domElement.style.cursor = target ? "pointer" : "grab";
  }

  handlePointerDown(event) {
    const target = this.findInteractiveTarget(event);
    if (!target) return;
    this.selectInteractive(target);
  }

  selectInteractive(target) {
    const info = target.userData.componentInfo;
    if (!info) return;
    this.selectedInteractive = target;
    this.drawSelectionHalo(target, info);
    if (this.selectionCallback) {
      this.selectionCallback(info);
    }
  }

  drawSelectionHalo(target, info) {
    if (this.selectionHalo) {
      this.annotationGroup.remove(this.selectionHalo);
      this.selectionHalo.traverse?.((node) => {
        node.geometry?.dispose?.();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose());
          else node.material.dispose();
        }
      });
    }

    const box = new THREE.Box3().setFromObject(target);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const radius = clamp(Math.max(size.x, size.y, size.z) * 0.62, 0.28, 1.75);
    const halo = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: info.category === "damage" ? COLOR_MAP.inflammatory : "#8ee7ff",
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.014, 8, 96), material);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.76, 0.009, 8, 96), material.clone());
    ringA.rotation.x = Math.PI / 2;
    ringB.rotation.y = Math.PI / 2;
    halo.add(ringA, ringB);
    halo.position.copy(center);
    halo.name = "selected-component-halo";
    this.selectionHalo = halo;
    this.annotationGroup.add(halo);
    this.controls.target.lerp(center, 0.35);
  }

  setModel(model) {
    this.activeModel = model;
    this.activeProfile = getMorphologyProfile(model.id);
    this.clearModel();

    const builders = this.getFamilyBuilder(this.activeProfile.family);
    const morphology = builders.createOutline.call(this, model, this.activeProfile);
    const organelles = builders.createOrganelles.call(this, model, this.activeProfile, morphology);

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
      myelin: morphology.myelinGroup,
      nodes: morphology.nodeGroup,
      glia: morphology.gliaGroup,
      immune: morphology.immuneGroup,
      signals: morphology.signalGroup,
      damage: morphology.damageGroup,
    };

    Object.values(this.componentGroups).forEach((group) => {
      if (group) {
        this.cellGroup.add(group);
      }
    });

    this.applyRenderMode();
    this.applyExplode();
    this.resetView();
  }

  getFamilyBuilder(family) {
    const mapping = {
      neuron: this.buildNeuronMorphology,
      msNeuron: this.buildMultipleSclerosisNeuronMorphology,
      glia: this.buildGliaMorphology,
      hepatocyte: this.buildHepatocyteMorphology,
      immune: this.buildImmuneMorphology,
      epithelial: this.buildEpithelialMorphology,
      muscle: this.buildMuscleMorphology,
      melanocyte: this.buildMelanocyteMorphology,
      oocyte: this.buildOocyteMorphology,
      embryonic: this.buildEmbryonicMorphology,
      generic: this.buildGenericMorphology,
    };

    const create = mapping[family] || mapping.generic;
    return {
      createOutline: create,
      createOrganelles: this.buildOrganelles,
    };
  }

  createGroup(name) {
    const group = new THREE.Group();
    group.name = name;
    return group;
  }

  registerExplodable(mesh, vector) {
    this.explodable.push({
      mesh,
      origin: mesh.position.clone(),
      direction: vector.clone().normalize(),
    });
  }

  buildGenericMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");
    const shellGeometry = new THREE.IcosahedronGeometry(model.geometry.radius, 24);
    deformSphere(shellGeometry, model.geometry.radius, {
      scaleX: model.geometry.wrinkleScale,
      scaleY: model.geometry.wrinkleScale * 0.75,
      scaleZ: model.geometry.wrinkleScale * 1.1,
      amplitude: model.geometry.wrinkleAmp,
    });

    const shell = new THREE.Mesh(
      shellGeometry,
      createMaterial(model.palette.membrane || COLOR_MAP.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow || "#0d3345"),
        transmission: 0.48,
        thickness: 0.85,
        opacity: 0.92,
        clearcoat: 1,
        clearcoatRoughness: 0.16,
      }),
    );
    membraneGroup.add(shell);
    this.registerExplodable(membraneGroup, new THREE.Vector3(0, 1, 0.4));
    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      shell,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadius: model.geometry.radius,
      outerRadius: model.geometry.radius,
    };
  }

  buildNeuronMorphology(model, profile) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");

    const isPyramidal = model.id === "human-cortical-neuron" || model.id === "mouse-hippocampal-neuron";
    const somaGeometry = new THREE.IcosahedronGeometry(1.18, 22);
    deformSphere(somaGeometry, 1.18, { scaleX: 3.8, scaleY: 4.2, scaleZ: 3.4, amplitude: 0.045 });
    somaGeometry.translate(0, -0.18, 0);
    const soma = new THREE.Mesh(
      somaGeometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.32,
        thickness: 0.34,
        opacity: 0.92,
      }),
    );
    soma.scale.set(isPyramidal ? 0.84 : 0.92, isPyramidal ? 1.06 : 0.96, isPyramidal ? 0.84 : 0.94);
    membraneGroup.add(soma);

    const apicalDendrite = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.95, 0),
      new THREE.Vector3(0.12, 2.2, 0.08),
      new THREE.Vector3(0.18, 3.8, 0.02),
      new THREE.Vector3(0.28, 5.2, -0.08),
      new THREE.Vector3(0.34, 6.4, -0.12),
    ]);

    const basalDendrites = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.38, -0.42, 0.18),
        new THREE.Vector3(-1.35, -0.7, 0.46),
        new THREE.Vector3(-2.35, -1.12, 0.92),
        new THREE.Vector3(-3.3, -1.58, 1.3),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.32, -0.38, 0.12),
        new THREE.Vector3(1.28, -0.72, 0.44),
        new THREE.Vector3(2.18, -1.18, 0.92),
        new THREE.Vector3(3.05, -1.7, 1.42),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.22, -0.54, -0.18),
        new THREE.Vector3(-1.1, -0.92, -0.58),
        new THREE.Vector3(-1.92, -1.38, -1.08),
        new THREE.Vector3(-2.82, -1.92, -1.58),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.2, -0.46, -0.12),
        new THREE.Vector3(0.98, -0.88, -0.62),
        new THREE.Vector3(1.82, -1.32, -1.18),
        new THREE.Vector3(2.74, -1.82, -1.74),
      ]),
    ];

    const tuftBranches = [];
    [0.36, 0.54, 0.72, 0.86].forEach((t, branchIndex) => {
      const basePoint = apicalDendrite.getPoint(t);
      const offset = branchIndex % 2 === 0 ? -1 : 1;
      tuftBranches.push(
        new THREE.CatmullRomCurve3([
          basePoint,
          basePoint.clone().add(new THREE.Vector3(0.65 * offset, 0.54, 0.24 * (branchIndex - 1.5))),
          basePoint.clone().add(new THREE.Vector3(1.32 * offset, 1.06, 0.56 * (branchIndex - 1.5))),
        ]),
      );
    });

    const dendriteMaterial = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.22,
      opacity: 0.9,
    });
    addCurveTubes(processGroup, [apicalDendrite], dendriteMaterial, 0.14, 120, 14);
    addCurveTubes(processGroup, basalDendrites, dendriteMaterial, 0.11, 88, 12);
    addCurveTubes(projectionGroup, tuftBranches, createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.18,
      opacity: 0.82,
    }), 0.06, 72, 10);

    const allDendrites = [apicalDendrite, ...basalDendrites, ...tuftBranches];
    allDendrites.forEach((curve, curveIndex) => {
      const start = curveIndex === 0 ? 4 : 2;
      curve.getPoints(curveIndex === 0 ? 22 : 14).slice(start, -2).forEach((point, spineIndex) => {
        if (spineIndex % 2 !== 0) return;
        const spine = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.012, curveIndex === 0 ? 0.08 : 0.06, 4, 8),
          createMaterial(model.palette.vesicle || COLOR_MAP.vesicle, {
            emissive: new THREE.Color("#173b4f"),
            transmission: 0.1,
            opacity: 0.74,
          }),
        );
        const theta = spineIndex * 1.47 + curveIndex * 0.9;
        const normal = new THREE.Vector3(Math.cos(theta), 0.25 + (curveIndex === 0 ? 0.15 : 0), Math.sin(theta)).normalize();
        spine.position.copy(point).add(normal.clone().multiplyScalar(curveIndex === 0 ? 0.12 : 0.09));
        orientAlongVector(spine, normal);
        projectionGroup.add(spine);
      });
    });

    const hillock = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 0.42, 10, 16),
      createMaterial(model.palette.cytoskeleton || COLOR_MAP.cytoskeleton, {
        emissive: new THREE.Color("#2a2f5e"),
        transmission: 0.12,
        opacity: 0.86,
      }),
    );
    hillock.rotation.z = -Math.PI / 2.6;
    hillock.position.set(0.34, -0.82, 0.02);
    projectionGroup.add(hillock);

    const axonCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.54, -0.95, 0.02),
      new THREE.Vector3(1.38, -1.84, 0.08),
      new THREE.Vector3(2.62, -2.64, -0.04),
      new THREE.Vector3(4.2, -3.06, -0.18),
      new THREE.Vector3(6.4, -3.4, 0.12),
      new THREE.Vector3(8.5, -3.92, 0.34),
    ]);
    addCurveTubes(
      processGroup,
      [axonCurve],
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.16,
        opacity: 0.9,
      }),
      0.055,
      168,
      10,
    );

    const collateralCurves = [0.36, 0.58, 0.76].map((t, index) => {
      const basePoint = axonCurve.getPoint(t);
      return new THREE.CatmullRomCurve3([
        basePoint,
        basePoint.clone().add(new THREE.Vector3(0.42, 0.34 + index * 0.08, index % 2 === 0 ? 0.46 : -0.46)),
        basePoint.clone().add(new THREE.Vector3(0.84, 0.58 + index * 0.1, index % 2 === 0 ? 0.92 : -0.92)),
      ]);
    });
    addCurveTubes(projectionGroup, collateralCurves, createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.12,
      opacity: 0.78,
    }), 0.03, 54, 8);

    const terminalBranches = [];
    const terminalBase = axonCurve.getPoint(0.98);
    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * Math.PI * 2;
      terminalBranches.push(new THREE.CatmullRomCurve3([
        terminalBase,
        terminalBase.clone().add(new THREE.Vector3(0.38, Math.cos(angle) * 0.36, Math.sin(angle) * 0.36)),
        terminalBase.clone().add(new THREE.Vector3(0.82, Math.cos(angle) * 0.58, Math.sin(angle) * 0.58)),
      ]));
    }
    addCurveTubes(projectionGroup, terminalBranches, createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.1,
      opacity: 0.76,
    }), 0.028, 42, 7);

    terminalBranches.forEach((curve, index) => {
      const bouton = new THREE.Mesh(
        new THREE.SphereGeometry(0.11 + (index % 2) * 0.02, 12, 12),
        createMaterial(model.palette.vesicle || COLOR_MAP.vesicle, {
          emissive: new THREE.Color("#133643"),
          opacity: 0.84,
        }),
      );
      bouton.position.copy(curve.getPoint(1));
      projectionGroup.add(bouton);
      this.floaters.push({ mesh: bouton, axis: "y", speed: 0.24 + index * 0.04, range: 0.015 });
    });

    this.registerExplodable(membraneGroup, new THREE.Vector3(-0.3, 0.9, 0.2));
    this.registerExplodable(processGroup, new THREE.Vector3(0.8, -0.15, 0.1));
    this.registerExplodable(projectionGroup, new THREE.Vector3(-0.1, 0.8, 0.35));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadius: 1.2,
      outerRadius: 8.8,
      processCurves: [...allDendrites, axonCurve, ...collateralCurves, ...terminalBranches],
    };
  }


  buildMultipleSclerosisNeuronMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");
    const myelinGroup = this.createGroup("myelin");
    const nodeGroup = this.createGroup("nodes");
    const gliaGroup = this.createGroup("glia");
    const immuneGroup = this.createGroup("immune");
    const signalGroup = this.createGroup("signals");
    const damageGroup = this.createGroup("damage");

    const somaInfo = this.createComponentInfo(
      "ms-soma",
      "Neuronal soma",
      "neuron",
      "Main neuronal cell body containing the nucleus, rough ER, Golgi traffic, mitochondria, and the metabolic machinery needed to maintain a long axon.",
      ["Nissl-rich soma", "integration center", "high ATP demand"],
    );
    const dendriteInfo = this.createComponentInfo(
      "ms-dendrites",
      "Dendrites and dendritic spines",
      "neuron",
      "Branching input arbor receives synaptic signals. Thin spine-like protrusions increase input surface area and show that this is a neuron, not a generic round cell.",
      ["synaptic input", "branch hierarchy", "plasticity sites"],
    );
    const axonInfo = this.createComponentInfo(
      "ms-axon",
      "Axon shaft",
      "neuron",
      "Long output cable carrying action potentials away from the soma. The exposed orange sections are where degenerated myelin leaves the axon less insulated.",
      ["saltatory conduction", "long-range output", "exposed membrane"],
    );
    const healthyMyelinInfo = this.createComponentInfo(
      "ms-healthy-myelin",
      "Healthy compact myelin",
      "myelin",
      "Layered insulating sheath wrapped around axon internodes. In a healthy region, impulses jump efficiently between nodes of Ranvier.",
      ["oligodendrocyte wrapping", "compact insulation", "fast conduction"],
    );
    const damagedMyelinInfo = this.createComponentInfo(
      "ms-damaged-myelin",
      "Degenerated myelin segment",
      "damage",
      "Broken, thinned, and displaced myelin around the axon. This lesion-like zone visualizes demyelination, debris, inflammatory proximity, and slower signal propagation.",
      ["demyelination", "conduction delay", "debris field"],
    );
    const nodeInfo = this.createComponentInfo(
      "ms-node-ranvier",
      "Node of Ranvier",
      "myelin",
      "Small exposed axonal gaps between myelin internodes. These nodes concentrate ion-channel activity and allow saltatory conduction in intact axons.",
      ["ion channels", "signal jump point", "myelin boundary"],
    );
    const oligodendrocyteInfo = this.createComponentInfo(
      "ms-oligodendrocyte",
      "Oligodendrocyte",
      "glia",
      "Myelin-forming CNS glial cell. Its processes extend toward internodes to represent how one oligodendrocyte can support multiple myelin wraps.",
      ["CNS myelination", "internode support", "repair target"],
    );
    const astrocyteInfo = this.createComponentInfo(
      "ms-astrocyte",
      "Reactive astrocyte",
      "glia",
      "Star-shaped support cell near the lesion field. It represents homeostatic buffering, inflammatory signaling, and glial scar-like boundary behavior.",
      ["GFAP-like morphology", "support network", "lesion boundary"],
    );
    const microgliaInfo = this.createComponentInfo(
      "ms-microglia",
      "Activated microglia",
      "immune",
      "Motile CNS immune cell with processes oriented toward myelin debris. It visualizes phagocytic surveillance and inflammatory activity near demyelinated axon segments.",
      ["phagocytosis", "neuroinflammation", "debris clearance"],
    );
    const impulseInfo = this.createComponentInfo(
      "ms-impulse",
      "Animated action potential pulse",
      "signal",
      "Moving blue-white pulses show neural signaling. Pulses travel rapidly across intact myelin and visibly stall or wobble near damaged internodes to show impaired conduction.",
      ["animated conduction", "saltatory jump", "lesion delay"],
    );
    const plaqueInfo = this.createComponentInfo(
      "ms-plaque",
      "Inflammatory lesion field",
      "damage",
      "Semi-transparent red cloud and particles mark the local inflammatory plaque around demyelinated internodes. It is a visual abstraction, not a diagnostic map.",
      ["local inflammation", "myelin debris", "repair pressure"],
    );

    const somaGeometry = new THREE.IcosahedronGeometry(1.28, 24);
    deformSphere(somaGeometry, 1.28, { scaleX: 4.2, scaleY: 3.4, scaleZ: 3.8, amplitude: 0.055 });
    somaGeometry.scale(1.08, 0.96, 1.02);
    const soma = new THREE.Mesh(
      somaGeometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.34,
        thickness: 0.42,
        opacity: 0.9,
      }),
    );
    soma.name = "MS neuron soma";
    membraneGroup.add(this.registerInteractive(soma, somaInfo));

    const hillock = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.64, 12, 22),
      createMaterial(model.palette.exposedAxon || COLOR_MAP.exposedAxon, {
        emissive: new THREE.Color("#4b2714"),
        opacity: 0.92,
      }),
    );
    hillock.position.set(1.1, -0.08, 0.05);
    hillock.rotation.z = Math.PI / 2;
    processGroup.add(this.registerInteractive(hillock, axonInfo));

    const dendriteMaterial = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.2,
      opacity: 0.86,
    });
    const spineMaterial = createMaterial(model.palette.vesicle || COLOR_MAP.vesicle, {
      emissive: new THREE.Color("#0d3642"),
      opacity: 0.72,
    });
    const dendriteCurves = [];
    const dendriteSeeds = [
      { angle: 2.75, lift: 0.55, reach: 3.8, z: 0.2 },
      { angle: 3.55, lift: -0.28, reach: 3.5, z: 0.65 },
      { angle: 4.15, lift: 0.82, reach: 4.2, z: -0.55 },
      { angle: 2.1, lift: -0.65, reach: 3.1, z: -0.35 },
      { angle: 1.55, lift: 1.05, reach: 3.4, z: 0.45 },
      { angle: 3.0, lift: 1.35, reach: 4.4, z: -1.05 },
      { angle: 3.9, lift: -1.15, reach: 3.9, z: 1.1 },
    ];

    dendriteSeeds.forEach((seed, index) => {
      const start = new THREE.Vector3(Math.cos(seed.angle) * 0.9, seed.lift * 0.34, Math.sin(seed.angle) * 0.9 + seed.z * 0.12);
      const curve = new THREE.CatmullRomCurve3([
        start,
        new THREE.Vector3(Math.cos(seed.angle) * 1.7, seed.lift, Math.sin(seed.angle) * 1.6 + seed.z),
        new THREE.Vector3(Math.cos(seed.angle) * 2.6, seed.lift * 1.18 + Math.sin(index) * 0.25, Math.sin(seed.angle) * 2.2 + seed.z * 1.18),
        new THREE.Vector3(Math.cos(seed.angle) * seed.reach, seed.lift * 1.35, Math.sin(seed.angle) * seed.reach + seed.z * 1.35),
      ]);
      dendriteCurves.push(curve);
      const branchGroup = this.createGroup(`dendrite-${index + 1}`);
      addCurveTubes(branchGroup, [curve], dendriteMaterial, 0.08 - Math.min(index, 4) * 0.005, 96, 12);

      curve.getPoints(18).slice(4, 16).forEach((point, spineIndex) => {
        if (spineIndex % 2 !== 0) return;
        const normal = new THREE.Vector3(
          Math.sin(spineIndex * 1.7 + index),
          0.34 + Math.cos(index) * 0.22,
          Math.cos(spineIndex * 1.1 - index),
        ).normalize();
        const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.1, 4, 8), spineMaterial);
        spine.position.copy(point).add(normal.clone().multiplyScalar(0.1));
        orientAlongVector(spine, normal);
        branchGroup.add(spine);
      });

      [0.56, 0.72].forEach((t, branchIndex) => {
        const base = curve.getPoint(t);
        const side = new THREE.Vector3(Math.cos(seed.angle + 0.75 + branchIndex), 0.35 - branchIndex * 0.2, Math.sin(seed.angle + 0.75 + branchIndex)).normalize();
        const branch = new THREE.CatmullRomCurve3([
          base,
          base.clone().add(side.clone().multiplyScalar(0.48)),
          base.clone().add(side.clone().multiplyScalar(0.98)).add(new THREE.Vector3(0, 0.18, 0)),
        ]);
        addCurveTubes(branchGroup, [branch], dendriteMaterial, 0.036, 50, 8);
      });
      processGroup.add(this.registerInteractive(branchGroup, dendriteInfo));
    });

    const axonCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.05, -0.08, 0.05),
      new THREE.Vector3(2.2, -0.16, -0.05),
      new THREE.Vector3(3.7, 0.12, -0.16),
      new THREE.Vector3(5.4, 0.38, 0.16),
      new THREE.Vector3(7.0, 0.24, -0.12),
      new THREE.Vector3(8.7, 0.72, 0.24),
      new THREE.Vector3(10.8, 1.0, 0.1),
    ]);
    const axonTube = new THREE.Mesh(
      new THREE.TubeGeometry(axonCurve, 220, 0.075, 14, false),
      createMaterial(model.palette.exposedAxon || COLOR_MAP.exposedAxon, {
        emissive: new THREE.Color("#4d2610"),
        opacity: 0.92,
      }),
    );
    axonTube.name = "MS axon shaft";
    processGroup.add(this.registerInteractive(axonTube, axonInfo));

    const healthyMyelinMaterial = new THREE.MeshPhysicalMaterial({
      color: model.palette.myelin || COLOR_MAP.myelin,
      emissive: "#182b46",
      roughness: 0.24,
      metalness: 0.02,
      transparent: true,
      opacity: 0.82,
      transmission: 0.28,
      clearcoat: 0.7,
    });
    healthyMyelinMaterial.userData.baseOpacity = 0.82;
    const damagedMyelinMaterial = new THREE.MeshPhysicalMaterial({
      color: model.palette.damagedMyelin || "#ffb56d",
      emissive: "#6a2412",
      roughness: 0.48,
      transparent: true,
      opacity: 0.72,
      transmission: 0.08,
    });
    damagedMyelinMaterial.userData.baseOpacity = 0.72;
    const nodeMaterial = new THREE.MeshBasicMaterial({ color: "#d6f6ff", transparent: true, opacity: 0.56 });

    const internodes = [
      { a: 0.16, b: 0.24, damaged: false },
      { a: 0.27, b: 0.35, damaged: false },
      { a: 0.38, b: 0.46, damaged: false },
      { a: 0.50, b: 0.58, damaged: true },
      { a: 0.61, b: 0.69, damaged: true },
      { a: 0.72, b: 0.80, damaged: false },
      { a: 0.83, b: 0.91, damaged: false },
    ];

    internodes.forEach((internode, index) => {
      const samples = [];
      for (let step = 0; step < 10; step += 1) {
        const t = internode.a + ((internode.b - internode.a) * step) / 9;
        samples.push(axonCurve.getPoint(t));
      }
      const segmentCurve = new THREE.CatmullRomCurve3(samples);
      if (!internode.damaged) {
        const segment = new THREE.Mesh(
          new THREE.TubeGeometry(segmentCurve, 58, 0.185, 22, false),
          healthyMyelinMaterial.clone(),
        );
        segment.name = `healthy myelin internode ${index + 1}`;
        myelinGroup.add(this.registerInteractive(segment, healthyMyelinInfo));

        const lamella = new THREE.Mesh(
          new THREE.TubeGeometry(segmentCurve, 58, 0.214, 22, false),
          new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.14, depthWrite: false }),
        );
        myelinGroup.add(lamella);
      } else {
        const partialA = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(samples.slice(0, 5)), 28, 0.17, 18, false),
          damagedMyelinMaterial.clone(),
        );
        const partialB = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(samples.slice(6)), 28, 0.13, 18, false),
          damagedMyelinMaterial.clone(),
        );
        partialA.name = `damaged myelin fragment ${index + 1}a`;
        partialB.name = `damaged myelin fragment ${index + 1}b`;
        myelinGroup.add(this.registerInteractive(partialA, damagedMyelinInfo));
        myelinGroup.add(this.registerInteractive(partialB, damagedMyelinInfo));

        for (let fragmentIndex = 0; fragmentIndex < 18; fragmentIndex += 1) {
          const t = internode.a + (internode.b - internode.a) * (fragmentIndex / 17);
          const center = axonCurve.getPoint(t);
          const tangent = axonCurve.getTangent(t).normalize();
          const radial = new THREE.Vector3(
            Math.sin(fragmentIndex * 1.7),
            Math.cos(fragmentIndex * 1.3),
            Math.sin(fragmentIndex * 0.9),
          ).cross(tangent).normalize();
          const fragment = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.025 + (fragmentIndex % 3) * 0.006, 0.16 + (fragmentIndex % 4) * 0.035, 6, 10),
            damagedMyelinMaterial.clone(),
          );
          fragment.position.copy(center).add(radial.clone().multiplyScalar(0.22 + (fragmentIndex % 5) * 0.035));
          orientAlongVector(fragment, tangent.clone().add(radial.clone().multiplyScalar(0.5)).normalize());
          fragment.name = "floating myelin debris";
          damageGroup.add(this.registerInteractive(fragment, damagedMyelinInfo));
          this.reactiveMeshes.push({ mesh: fragment, baseScale: fragment.scale.clone(), speed: 0.9 + fragmentIndex * 0.04, phase: fragmentIndex * 0.43, amplitude: 0.18 });
        }
      }

      [internode.a, internode.b].forEach((t) => {
        const center = axonCurve.getPoint(t);
        const tangent = axonCurve.getTangent(t).normalize();
        const node = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.04, 18, 1, true), nodeMaterial.clone());
        node.position.copy(center);
        node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        node.name = "node of Ranvier";
        nodeGroup.add(this.registerInteractive(node, nodeInfo));
        this.reactiveMeshes.push({ mesh: node, baseScale: node.scale.clone(), speed: 1.6, phase: t * 7, amplitude: 0.06 });
      });
    });

    for (let pulseIndex = 0; pulseIndex < 5; pulseIndex += 1) {
      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 18, 18),
        new THREE.MeshBasicMaterial({ color: model.palette.signal || "#c7f6ff", transparent: true, opacity: 0.9 }),
      );
      pulse.name = "animated action potential";
      signalGroup.add(this.registerInteractive(pulse, impulseInfo));
      this.signalPulses.push({ mesh: pulse, curve: axonCurve, phase: pulseIndex * 0.2, speed: 0.1 + pulseIndex * 0.01, damagedBand: [0.48, 0.7] });
    }

    const terminalPoint = axonCurve.getPoint(0.98);
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2;
      const bouton = new THREE.Mesh(
        new THREE.SphereGeometry(0.13 + (index % 3) * 0.018, 16, 16),
        createMaterial(model.palette.vesicle || COLOR_MAP.vesicle, { emissive: new THREE.Color("#0f3e49"), opacity: 0.86 }),
      );
      bouton.position.copy(terminalPoint).add(new THREE.Vector3(Math.cos(angle) * 0.36, Math.sin(index * 1.1) * 0.22, Math.sin(angle) * 0.36));
      projectionGroup.add(this.registerInteractive(bouton, this.createComponentInfo(
        "ms-synaptic-terminal",
        "Synaptic terminal bouton",
        "neuron",
        "Axon terminal bouton containing vesicle-like packets. It represents output communication to the next neural target.",
        ["neurotransmitter release", "terminal arbor", "vesicle pool"],
      )));
      this.floaters.push({ mesh: bouton, axis: "y", speed: 0.34 + index * 0.03, range: 0.02 });
    }

    this.createOligodendrocyte(gliaGroup, axonCurve, oligodendrocyteInfo);
    this.createAstrocyte(gliaGroup, astrocyteInfo);
    this.createActivatedMicroglia(immuneGroup, axonCurve, microgliaInfo);
    this.createInflammatoryPlaque(damageGroup, axonCurve, plaqueInfo);

    this.registerExplodable(membraneGroup, new THREE.Vector3(-0.7, 0.55, 0.25));
    this.registerExplodable(processGroup, new THREE.Vector3(0.65, 0.12, 0.05));
    this.registerExplodable(projectionGroup, new THREE.Vector3(1, 0.2, 0.3));
    this.registerExplodable(myelinGroup, new THREE.Vector3(0.6, -0.2, -0.25));
    this.registerExplodable(nodeGroup, new THREE.Vector3(0, 0.95, 0.1));
    this.registerExplodable(gliaGroup, new THREE.Vector3(-0.2, -0.8, 0.45));
    this.registerExplodable(immuneGroup, new THREE.Vector3(0.1, 0.65, 0.8));
    this.registerExplodable(signalGroup, new THREE.Vector3(0.35, 0.35, 0));
    this.registerExplodable(damageGroup, new THREE.Vector3(0.35, 0.45, 0.85));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      myelinGroup,
      nodeGroup,
      gliaGroup,
      immuneGroup,
      signalGroup,
      damageGroup,
      somaCenter: new THREE.Vector3(-0.08, 0.08, 0),
      somaRadius: 1.28,
      outerRadius: 11.2,
      processCurves: [...dendriteCurves, axonCurve],
      axonCurve,
    };
  }

  createOligodendrocyte(group, axonCurve, info) {
    const somaMaterial = createMaterial(COLOR_MAP.myelin, { emissive: new THREE.Color("#263d5b"), opacity: 0.82, transmission: 0.18 });
    const processMaterial = new THREE.MeshStandardMaterial({ color: "#cfeaff", emissive: "#1d3551", transparent: true, opacity: 0.78, roughness: 0.36 });
    const soma = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48, 12), somaMaterial);
    soma.scale.set(1.12, 0.88, 1.02);
    soma.position.set(4.45, -1.6, -1.35);
    soma.name = "oligodendrocyte soma";
    group.add(this.registerInteractive(soma, info));

    [0.28, 0.39, 0.75, 0.86].forEach((t, index) => {
      const target = axonCurve.getPoint(t);
      const curve = new THREE.CatmullRomCurve3([
        soma.position.clone(),
        soma.position.clone().lerp(target, 0.45).add(new THREE.Vector3(0.15 * index, 0.38, -0.18)),
        target,
      ]);
      const wrapProcess = this.createGroup(`oligodendrocyte-process-${index + 1}`);
      addCurveTubes(wrapProcess, [curve], processMaterial, 0.035, 52, 8);
      group.add(this.registerInteractive(wrapProcess, info));
    });
  }

  createAstrocyte(group, info) {
    const material = createMaterial(COLOR_MAP.astrocyte, { emissive: new THREE.Color("#17324a"), opacity: 0.72, transmission: 0.12 });
    const soma = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 10), material);
    soma.position.set(-1.95, -1.58, 1.9);
    soma.name = "reactive astrocyte soma";
    group.add(this.registerInteractive(soma, info));
    for (let index = 0; index < 14; index += 1) {
      const angle = (index / 14) * Math.PI * 2;
      const reach = 0.9 + (index % 4) * 0.18;
      const start = soma.position.clone();
      const end = start.clone().add(new THREE.Vector3(Math.cos(angle) * reach, Math.sin(index * 1.31) * 0.72, Math.sin(angle) * reach));
      const curve = new THREE.CatmullRomCurve3([
        start,
        start.clone().lerp(end, 0.52).add(new THREE.Vector3(0, Math.cos(index) * 0.2, 0)),
        end,
      ]);
      const process = this.createGroup(`astrocyte-process-${index + 1}`);
      addCurveTubes(process, [curve], material, 0.03, 36, 8);
      group.add(this.registerInteractive(process, info));
    }
  }

  createActivatedMicroglia(group, axonCurve, info) {
    const bodyMaterial = createMaterial(COLOR_MAP.microglia, { emissive: new THREE.Color("#163f1b"), opacity: 0.88, transmission: 0.08 });
    const processMaterial = new THREE.MeshStandardMaterial({ color: COLOR_MAP.microglia, emissive: "#123a16", transparent: true, opacity: 0.76 });
    const soma = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 8), bodyMaterial);
    soma.scale.set(1.35, 0.86, 1.0);
    soma.position.copy(axonCurve.getPoint(0.61)).add(new THREE.Vector3(0.25, 0.72, 1.05));
    soma.name = "activated microglia soma";
    group.add(this.registerInteractive(soma, info));
    for (let index = 0; index < 11; index += 1) {
      const angle = (index / 11) * Math.PI * 2;
      const target = axonCurve.getPoint(0.52 + (index % 4) * 0.055).add(new THREE.Vector3(Math.cos(angle) * 0.16, Math.sin(index) * 0.1, Math.sin(angle) * 0.16));
      const curve = new THREE.CatmullRomCurve3([
        soma.position.clone(),
        soma.position.clone().lerp(target, 0.5).add(new THREE.Vector3(Math.sin(angle) * 0.18, Math.cos(index) * 0.18, Math.cos(angle) * 0.18)),
        target,
      ]);
      const process = this.createGroup(`microglia-process-${index + 1}`);
      addCurveTubes(process, [curve], processMaterial, 0.024, 34, 7);
      group.add(this.registerInteractive(process, info));
    }
    this.reactiveMeshes.push({ mesh: soma, baseScale: soma.scale.clone(), speed: 1.1, phase: 0.2, amplitude: 0.12 });
  }

  createInflammatoryPlaque(group, axonCurve, info) {
    const cloudMaterial = new THREE.MeshBasicMaterial({ color: COLOR_MAP.inflammatory, transparent: true, opacity: 0.095, depthWrite: false });
    const center = axonCurve.getPoint(0.6);
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(1.12, 26, 26), cloudMaterial);
    cloud.scale.set(1.35, 0.82, 1.0);
    cloud.position.copy(center).add(new THREE.Vector3(0.2, 0.25, 0.32));
    cloud.name = "inflammatory lesion field";
    group.add(this.registerInteractive(cloud, info));

    const particleMaterial = new THREE.MeshBasicMaterial({ color: COLOR_MAP.inflammatory, transparent: true, opacity: 0.72 });
    for (let index = 0; index < 36; index += 1) {
      const particle = new THREE.Mesh(new THREE.SphereGeometry(0.025 + (index % 4) * 0.008, 8, 8), particleMaterial.clone());
      const angle = index * 2.399;
      const radius = 0.18 + (index % 9) * 0.095;
      particle.position.copy(center).add(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(index * 0.7) * 0.38, Math.sin(angle) * radius));
      group.add(this.registerInteractive(particle, info));
      this.reactiveMeshes.push({ mesh: particle, baseScale: particle.scale.clone(), speed: 0.65 + index * 0.015, phase: index * 0.27, amplitude: 0.35 });
    }
  }

  buildGliaMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");

    const somaGeometry = new THREE.IcosahedronGeometry(1.08, 18);
    deformSphere(somaGeometry, 1.08, { scaleX: 3.0, scaleY: 2.7, scaleZ: 3.0, amplitude: 0.05 });
    const soma = new THREE.Mesh(
      somaGeometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.3,
        thickness: 0.3,
        opacity: 0.9,
      }),
    );
    membraneGroup.add(soma);

    const primaryCurves = [];
    const secondaryCurves = [];
    for (let index = 0; index < 12; index += 1) {
      const theta = (index / 12) * Math.PI * 2;
      const y0 = (Math.sin(index * 1.7) * 0.35);
      const start = new THREE.Vector3(Math.cos(theta) * 0.66, y0, Math.sin(theta) * 0.66);
      const mid = new THREE.Vector3(Math.cos(theta) * 1.55, y0 * 0.8 + Math.cos(index) * 0.28, Math.sin(theta) * 1.55);
      const end = new THREE.Vector3(Math.cos(theta) * 2.65, y0 * 1.2 + Math.sin(index * 0.9) * 0.5, Math.sin(theta) * 2.65);
      const primary = new THREE.CatmullRomCurve3([start, mid, end]);
      primaryCurves.push(primary);

      const branchBase = primary.getPoint(0.62);
      secondaryCurves.push(new THREE.CatmullRomCurve3([
        branchBase,
        branchBase.clone().add(new THREE.Vector3(Math.cos(theta + 0.6) * 0.45, 0.2 + Math.sin(index) * 0.16, Math.sin(theta + 0.6) * 0.45)),
        branchBase.clone().add(new THREE.Vector3(Math.cos(theta + 0.95) * 0.92, 0.32 + Math.cos(index) * 0.22, Math.sin(theta + 0.95) * 0.92)),
      ]));
      secondaryCurves.push(new THREE.CatmullRomCurve3([
        branchBase,
        branchBase.clone().add(new THREE.Vector3(Math.cos(theta - 0.55) * 0.38, -0.14 + Math.cos(index) * 0.12, Math.sin(theta - 0.55) * 0.38)),
        branchBase.clone().add(new THREE.Vector3(Math.cos(theta - 0.9) * 0.84, -0.26 + Math.sin(index) * 0.2, Math.sin(theta - 0.9) * 0.84)),
      ]));
    }

    addCurveTubes(processGroup, primaryCurves, createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.18,
      opacity: 0.88,
    }), 0.075, 70, 10);
    addCurveTubes(projectionGroup, secondaryCurves, createMaterial(model.palette.vesicle || model.palette.membrane, {
      emissive: new THREE.Color("#153445"),
      transmission: 0.12,
      opacity: 0.72,
    }), 0.026, 44, 8);

    secondaryCurves.forEach((curve, index) => {
      const endFoot = new THREE.Mesh(
        new THREE.SphereGeometry(0.06 + (index % 3) * 0.012, 10, 10),
        createMaterial(model.palette.vesicle || model.palette.membrane, {
          emissive: new THREE.Color("#173746"),
          opacity: 0.66,
        }),
      );
      endFoot.position.copy(curve.getPoint(1));
      projectionGroup.add(endFoot);
    });

    this.registerExplodable(membraneGroup, new THREE.Vector3(0.1, 1, 0.2));
    this.registerExplodable(processGroup, new THREE.Vector3(-0.4, 0.8, 0.3));
    this.registerExplodable(projectionGroup, new THREE.Vector3(0.55, -0.2, 0.55));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadius: 1.08,
      outerRadius: 2.95,
      processCurves: [...primaryCurves, ...secondaryCurves],
      shell: soma,
    };
  }

  buildHepatocyteMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");

    const geometry = new THREE.IcosahedronGeometry(1.9, 18);
    deformSphere(geometry, 1.9, { scaleX: 2.5, scaleY: 2.7, scaleZ: 2.4, amplitude: 0.1 });
    geometry.scale(1.24, 1.0, 1.15);
    const shell = new THREE.Mesh(
      geometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.26,
        clearcoat: 0.8,
      }),
    );
    membraneGroup.add(shell);

    const grooveMaterial = new THREE.MeshStandardMaterial({
      color: model.palette.cytoskeleton,
      emissive: "#1d2848",
      transparent: true,
      opacity: 0.6,
    });

    for (let index = 0; index < 4; index += 1) {
      const groove = new THREE.Mesh(
        new THREE.TorusGeometry(1.05 + index * 0.08, 0.045, 10, 48, Math.PI * 0.95),
        grooveMaterial,
      );
      groove.rotation.set(0.2 + index * 0.28, 0.9 - index * 0.12, 0.4 + index * 0.1);
      groove.position.set(0.3 - index * 0.08, -0.15 + index * 0.12, -0.2 + index * 0.12);
      projectionGroup.add(groove);
    }

    for (let index = 0; index < 60; index += 1) {
      const spike = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.012, 0.045 + Math.random() * 0.03, 4, 8),
        createMaterial(model.palette.vesicle, {
          emissive: new THREE.Color("#183948"),
          opacity: 0.78,
        }),
      );
      const side = index % 2 === 0 ? -1 : 1;
      spike.position.set(
        side * (1.2 + Math.random() * 0.25),
        (Math.random() - 0.5) * 1.7,
        (Math.random() - 0.5) * 1.2,
      );
      spike.rotation.z = Math.PI / 2;
      spike.rotation.y = (Math.random() - 0.5) * 0.8;
      processGroup.add(spike);
    }

    this.registerExplodable(membraneGroup, new THREE.Vector3(0.6, 0.5, 0.2));
    this.registerExplodable(processGroup, new THREE.Vector3(-0.9, 0.2, 0.1));
    this.registerExplodable(projectionGroup, new THREE.Vector3(0, -1, 0.3));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadius: 1.9,
      outerRadius: 2.5,
      shell,
    };
  }

  buildImmuneMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");

    const bodyGeometry = new THREE.IcosahedronGeometry(1.68, 20);
    deformSphere(bodyGeometry, 1.68, { scaleX: 4.2, scaleY: 4.4, scaleZ: 4.1, amplitude: 0.05 });
    bodyGeometry.scale(1.02, 1.0, 1.02);
    const body = new THREE.Mesh(
      bodyGeometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.34,
        thickness: 0.35,
      }),
    );
    membraneGroup.add(body);

    const spikeMaterial = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.12,
      opacity: 0.84,
    });

    for (let index = 0; index < 140; index += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const normal = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      );
      if (normal.x > 0.78) {
        continue;
      }
      const spike = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.038, 0.22 + Math.random() * 0.22, 7),
        spikeMaterial,
      );
      spike.position.copy(normal.clone().multiplyScalar(1.7 + Math.random() * 0.1));
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      processGroup.add(spike);
    }

    const synapsePatch = new THREE.Mesh(
      new THREE.CircleGeometry(0.8, 48),
      new THREE.MeshBasicMaterial({
        color: model.palette.vesicle,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
      }),
    );
    synapsePatch.rotation.y = Math.PI / 2;
    synapsePatch.position.set(1.54, 0, 0);
    projectionGroup.add(synapsePatch);

    this.registerExplodable(membraneGroup, new THREE.Vector3(0.3, 1, 0.2));
    this.registerExplodable(processGroup, new THREE.Vector3(-0.6, 0.4, 0.1));
    this.registerExplodable(projectionGroup, new THREE.Vector3(1, 0, 0));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadius: 1.68,
      outerRadius: 1.95,
      shell: body,
    };
  }

  buildEpithelialMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");
    const geometry = new THREE.IcosahedronGeometry(1.78, 18);
    deformSphere(geometry, 1.78, { scaleX: 3.3, scaleY: 2.1, scaleZ: 2.8, amplitude: 0.05 });
    geometry.scale(1.05, 1.22, 0.96);
    const body = new THREE.Mesh(
      geometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.28,
      }),
    );
    membraneGroup.add(body);

    for (let index = 0; index < 80; index += 1) {
      const projection = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.016, 0.1 + Math.random() * 0.06, 4, 8),
        createMaterial(model.palette.vesicle, {
          emissive: new THREE.Color("#173848"),
          opacity: 0.82,
        }),
      );
      projection.position.set(
        (Math.random() - 0.5) * 1.6,
        1.2 + Math.random() * 0.18,
        (Math.random() - 0.5) * 1.2,
      );
      projection.rotation.x = Math.PI / 2;
      processGroup.add(projection);
    }

    this.registerExplodable(membraneGroup, new THREE.Vector3(0, 1, 0.2));
    this.registerExplodable(processGroup, new THREE.Vector3(0, 1, 0));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadius: 1.78,
      outerRadius: 2.1,
      shell: body,
    };
  }

  buildMuscleMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");
    const geometry = new THREE.CapsuleGeometry(1.1, 3.8, 12, 24);
    geometry.rotateZ(Math.PI / 2);
    const body = new THREE.Mesh(
      geometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.22,
      }),
    );
    membraneGroup.add(body);

    for (let index = 0; index < 18; index += 1) {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.02, 8, 42),
        new THREE.MeshBasicMaterial({
          color: model.palette.cytoskeleton,
          transparent: true,
          opacity: 0.44,
        }),
      );
      band.rotation.y = Math.PI / 2;
      band.position.x = -1.8 + index * 0.22;
      projectionGroup.add(band);
    }

    this.registerExplodable(membraneGroup, new THREE.Vector3(1, 0.2, 0));
    this.registerExplodable(projectionGroup, new THREE.Vector3(0, 1, 0));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      somaCenter: new THREE.Vector3(0, 0, 0),
      somaRadius: 2.4,
      outerRadius: 2.8,
      shell: body,
    };
  }

  buildMelanocyteMorphology(model) {
    const base = this.buildGenericMorphology(model);
    const armMaterial = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.18,
      opacity: 0.86,
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
    this.registerExplodable(base.processGroup, new THREE.Vector3(-0.6, 0.6, 0.2));
    return base;
  }

  buildOocyteMorphology(model) {
    const base = this.buildGenericMorphology(model);
    base.membraneGroup.scale.set(1.15, 1.15, 1.15);
    for (let index = 0; index < 110; index += 1) {
      const granule = new THREE.Mesh(
        new THREE.SphereGeometry(0.03 + Math.random() * 0.04, 10, 10),
        createMaterial(model.palette.vesicle, {
          emissive: new THREE.Color("#173849"),
          opacity: 0.85,
        }),
      );
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 1.2 + Math.random() * 0.42;
      granule.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
      base.processGroup.add(granule);
    }
    this.registerExplodable(base.processGroup, new THREE.Vector3(0.2, -1, 0.4));
    return base;
  }

  buildEmbryonicMorphology(model) {
    const base = this.buildGenericMorphology(model);
    for (let index = 0; index < 8; index += 1) {
      const bleb = new THREE.Mesh(
        new THREE.SphereGeometry(0.16 + Math.random() * 0.08, 14, 14),
        createMaterial(model.palette.membrane, {
          emissive: new THREE.Color(model.palette.membraneGlow),
          transmission: 0.25,
          opacity: 0.78,
        }),
      );
      bleb.position.set(
        (Math.random() - 0.5) * 2.6,
        (Math.random() - 0.5) * 2.3,
        (Math.random() - 0.5) * 2.6,
      );
      base.processGroup.add(bleb);
      this.floaters.push({ mesh: bleb, axis: "x", speed: 0.4 + index * 0.07, range: 0.018 });
    }
    this.registerExplodable(base.processGroup, new THREE.Vector3(0.5, 0.8, 0.2));
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

    this.registerInteractive(nucleusGroup, this.createComponentInfo(
      "organelle-nucleus",
      "Nucleus and nucleolus",
      "organelle",
      "Transcriptional control center containing chromatin, nuclear envelope pores, and the nucleolus. In the MS neuron scene this remains inside the soma.",
      ["chromatin", "nucleolus", "nuclear pores"],
    ));
    this.registerInteractive(golgiGroup, this.createComponentInfo(
      "organelle-golgi",
      "Golgi apparatus",
      "organelle",
      "Layered sorting and dispatch ribbon that processes membrane and secreted cargo before delivery to vesicles and neurites.",
      ["cargo sorting", "secretory traffic", "perinuclear ribbon"],
    ));
    this.registerInteractive(reticulumGroup, this.createComponentInfo(
      "organelle-reticulum",
      "Endoplasmic reticulum",
      "organelle",
      "Reticular processing network for protein folding, lipid handling, calcium buffering, and stress-linked signaling.",
      ["rough ER", "smooth ER", "proteostasis"],
    ));
    this.registerInteractive(mitoGroup, this.createComponentInfo(
      "organelle-mitochondria",
      "Mitochondria",
      "organelle",
      "ATP-producing organelles distributed inside the soma and along neurites to support membrane excitability, transport, and repair pressure.",
      ["ATP reserve", "axon energy", "oxidative phosphorylation"],
    ));
    this.registerInteractive(vesicleGroup, this.createComponentInfo(
      "organelle-vesicles",
      "Vesicles",
      "organelle",
      "Small trafficking packets for cargo movement, synaptic delivery, and local membrane remodeling.",
      ["cargo transport", "synaptic packets", "membrane traffic"],
    ));
    this.registerInteractive(lysosomeGroup, this.createComponentInfo(
      "organelle-lysosomes",
      "Lysosomes",
      "organelle",
      "Recycling and degradation nodes involved in turnover, autophagy, and debris-processing pressure.",
      ["autophagy", "degradation", "recycling"],
    ));
    this.registerInteractive(cytoskeletonGroup, this.createComponentInfo(
      "organelle-cytoskeleton",
      "Cytoskeleton",
      "organelle",
      "Filament scaffold that organizes shape, polarity, mechanical stress, and long-distance intracellular transport.",
      ["microtubules", "actin", "transport tracks"],
    ));
    this.registerInteractive(ribosomeGroup, this.createComponentInfo(
      "organelle-ribosomes",
      "Ribosomes",
      "organelle",
      "Protein synthesis particles distributed through the cytoplasm and reticular regions.",
      ["translation", "protein synthesis", "Nissl-like density"],
    ));

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
      neuron: new THREE.Vector3(-0.18, 0.12, 0),
      msNeuron: new THREE.Vector3(-0.16, 0.12, 0),
      glia: new THREE.Vector3(-0.05, 0.06, 0),
      hepatocyte: new THREE.Vector3(0.1, 0.06, 0),
      immune: new THREE.Vector3(-0.1, 0.02, 0),
      muscle: new THREE.Vector3(-0.8, 0, 0),
      melanocyte: new THREE.Vector3(-0.08, 0.08, 0),
      epithelial: new THREE.Vector3(0, -0.1, 0),
      oocyte: new THREE.Vector3(-0.25, 0.2, 0.15),
      embryonic: new THREE.Vector3(0, 0.05, 0),
      generic: new THREE.Vector3(-0.12, 0.08, 0),
    };

    const radiusFactor = {
      neuron: 0.48,
      msNeuron: 0.48,
      immune: 0.58,
      hepatocyte: 0.42,
      muscle: 0.34,
      glia: 0.46,
      epithelial: 0.4,
      melanocyte: 0.43,
      oocyte: 0.44,
      embryonic: 0.4,
      generic: 0.44,
    };

    const radius = morphology.somaRadius * (radiusFactor[profile.family] || 0.44);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 28, 28),
      createMaterial(model.palette.nucleus || COLOR_MAP.nucleus, {
        emissive: new THREE.Color("#2c163f"),
        roughness: 0.28,
        transmission: 0.22,
      }),
    );
    core.position.copy(morphology.somaCenter).add(offsetMap[profile.family] || offsetMap.generic);
    core.scale.set(1.0, 0.94, 1.04);
    nucleusGroup.add(core);

    const nucleolus = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.28, 18, 18),
      new THREE.MeshStandardMaterial({
        color: "#ffe8ff",
        emissive: "#8d3975",
      }),
    );
    nucleolus.position.copy(core.position).add(new THREE.Vector3(radius * 0.24, -radius * 0.12, radius * 0.16));
    nucleusGroup.add(nucleolus);

    const envelope = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.04, 32, 32),
      new THREE.MeshPhysicalMaterial({
        color: model.palette.nucleus || COLOR_MAP.nucleus,
        emissive: "#211337",
        transparent: true,
        opacity: 0.18,
        roughness: 0.18,
        clearcoat: 0.6,
        depthWrite: false,
      }),
    );
    envelope.position.copy(core.position);
    envelope.scale.copy(core.scale);
    nucleusGroup.add(envelope);

    for (let index = 0; index < 18; index += 1) {
      const theta = (index / 18) * Math.PI * 2;
      const y = Math.sin(index * 1.7) * radius * 0.55;
      const poreRadius = Math.sqrt(Math.max(radius * radius * 0.82 - y * y, radius * radius * 0.2));
      const normal = new THREE.Vector3(Math.cos(theta), y / radius, Math.sin(theta)).normalize();
      const pore = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.045, radius * 0.007, 6, 18),
        new THREE.MeshBasicMaterial({ color: "#fff0ff", transparent: true, opacity: 0.72 }),
      );
      pore.position.copy(core.position).add(new THREE.Vector3(Math.cos(theta) * poreRadius, y, Math.sin(theta) * poreRadius));
      pore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      nucleusGroup.add(pore);
    }

    this.floaters.push({ mesh: nucleusGroup, axis: "y", speed: 0.26, range: 0.018 });
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
    for (let index = 0; index < stackCount; index += 1) {
      const geo = new THREE.TorusGeometry(0.56 - index * 0.05, 0.028, 12, 84, Math.PI * 1.25);
      const mesh = new THREE.Mesh(geo, material);
      mesh.scale.set(1.1, 0.54, 1.0);
      mesh.position.copy(morphology.somaCenter).add(new THREE.Vector3(0.65, -0.3 + index * 0.07, -0.18 + index * 0.02));
      mesh.rotation.set(Math.PI / 2.45, 0.8, 0.12);
      golgiGroup.add(mesh);
    }

    for (let index = 0; index < 18; index += 1) {
      const bud = new THREE.Mesh(
        new THREE.SphereGeometry(0.04 + Math.random() * 0.02, 12, 12),
        new THREE.MeshStandardMaterial({
          color: model.palette.vesicle || COLOR_MAP.vesicle,
          emissive: "#153947",
          transparent: true,
          opacity: 0.85,
        }),
      );
      bud.position.copy(morphology.somaCenter).add(
        new THREE.Vector3(0.42 + Math.random() * 0.36, -0.12 + Math.random() * 0.42, -0.22 + Math.random() * 0.4),
      );
      golgiGroup.add(bud);
    }

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
      opacity: 0.86,
    });

    const curveCount = profile.family === "hepatocyte" ? 16 : (profile.family === "neuron" || profile.family === "msNeuron") ? 10 : 8;
    for (let index = 0; index < curveCount; index += 1) {
      const ring = [];
      for (let step = 0; step < 12; step += 1) {
        const t = step / 11;
        ring.push(
          morphology.somaCenter.clone().add(
            new THREE.Vector3(
              Math.sin((t + index * 0.09) * Math.PI * 2) * (0.55 + index * 0.03),
              (t - 0.5) * (0.65 + index * 0.02),
              Math.cos((t + index * 0.11) * Math.PI * 2) * (0.52 + index * 0.03),
            ),
          ),
        );
      }
      addCurveTubes(reticulumGroup, [new THREE.CatmullRomCurve3(ring)], material, 0.03 + (profile.family === "hepatocyte" ? 0.01 : 0), 48, 10);
    }

    if ((profile.family === "neuron" || profile.family === "msNeuron") && morphology.processCurves) {
      morphology.processCurves.slice(0, 2).forEach((curve) => {
        const samplePoints = curve.getPoints(12).slice(1, 9);
        const branchCurve = new THREE.CatmullRomCurve3(samplePoints.map((point, index) => point.clone().add(new THREE.Vector3(0, Math.sin(index) * 0.06, 0))));
        addCurveTubes(reticulumGroup, [branchCurve], material, 0.02, 52, 8);
      });
    }

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

    if (profile.family === "neuron" || profile.family === "msNeuron" || profile.family === "melanocyte") {
      const curves = morphology.processCurves || [];
      curves.forEach((curve, curveIndex) => {
        const samples = curve.getPoints(10);
        samples.slice(2, 8).forEach((point, pointIndex) => {
          if ((pointIndex + curveIndex) % 2 !== 0) {
            return;
          }
          const mesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.05, 0.28 + Math.random() * 0.22, 8, 16),
            material,
          );
          mesh.position.copy(point);
          mesh.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
          mitoGroup.add(mesh);
        });
      });
    }

    const count = profile.family === "muscle" ? 42 : model.components.mitochondria;
    for (let index = 0; index < count; index += 1) {
      const radius = profile.family === "muscle" ? 0.08 : 0.09 + Math.random() * 0.05;
      const length = profile.family === "muscle" ? 0.34 : 0.2 + Math.random() * 0.22;
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(radius, length, 8, 16),
        material,
      );

      if (profile.family === "muscle") {
        mesh.position.set(
          -1.9 + (index % 14) * 0.28,
          -0.65 + Math.floor(index / 14) * 0.62,
          (Math.random() - 0.5) * 0.8,
        );
        mesh.rotation.z = Math.PI / 2;
      } else {
        mesh.position.copy(organellePoint(morphology, profile, 1100 + index * 17, 0.82));
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      }

      for (let ridgeIndex = 0; ridgeIndex < 3; ridgeIndex += 1) {
        const crista = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 0.72, radius * 0.045, 6, 18),
          new THREE.MeshBasicMaterial({
            color: "#ffd0a8",
            transparent: true,
            opacity: 0.48,
          }),
        );
        crista.rotation.x = Math.PI / 2;
        crista.position.y = (-length * 0.34) + ridgeIndex * length * 0.34;
        mesh.add(crista);
      }
      mitoGroup.add(mesh);
      this.floaters.push({ mesh, axis: "x", speed: 0.12 + Math.random() * 0.2, range: 0.012 });
    }

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
    const count = model.components.vesicles + (profile.family === "melanocyte" ? 12 : 0);
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.045 + Math.random() * 0.05, 14, 14),
        material,
      );
      mesh.position.copy(organellePoint(morphology, profile, 2200 + index * 19, profile.family === "melanocyte" ? 0.9 : 0.78));
      vesicleGroup.add(mesh);
      this.floaters.push({ mesh, axis: "z", speed: 0.22 + Math.random() * 0.35, range: 0.015 });
    }

    this.registerExplodable(vesicleGroup, new THREE.Vector3(0.2, 0.8, 0.9));
    return vesicleGroup;
  }

  createLysosomes(model, morphology, profile) {
    const lysosomeGroup = this.createGroup("lysosomes");
    const material = new THREE.MeshStandardMaterial({
      color: model.palette.lysosome || COLOR_MAP.lysosome,
      emissive: "#4d1432",
      roughness: 0.25,
    });

    for (let index = 0; index < model.components.lysosomes; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.08 + Math.random() * 0.03, 1),
        material,
      );
      mesh.position.copy(organellePoint(morphology, profile, 3300 + index * 23, 0.74));
      lysosomeGroup.add(mesh);
      this.floaters.push({ mesh, axis: "y", speed: 0.18 + Math.random() * 0.22, range: 0.012 });
    }
    this.registerExplodable(lysosomeGroup, new THREE.Vector3(-0.8, 0.4, -0.2));
    return lysosomeGroup;
  }

  createCytoskeleton(model, morphology, profile) {
    const cytoskeletonGroup = this.createGroup("cytoskeleton");
    const material = new THREE.MeshBasicMaterial({
      color: model.palette.cytoskeleton || COLOR_MAP.cytoskeleton,
      transparent: true,
      opacity: 0.5,
    });

    if (profile.family === "muscle") {
      for (let index = 0; index < 22; index += 1) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-2.2 + index * 0.2, -0.8, -0.65),
          new THREE.Vector3(-2.0 + index * 0.2, 0, 0),
          new THREE.Vector3(-1.8 + index * 0.2, 0.8, 0.65),
        ]);
        addCurveTubes(cytoskeletonGroup, [curve], material, 0.016, 28, 6);
      }
    } else {
      const filamentCount = model.components.filaments + ((profile.family === "neuron" || profile.family === "msNeuron") ? 10 : 0);
      for (let index = 0; index < filamentCount; index += 1) {
        const curve = new THREE.CatmullRomCurve3(
          Array.from({ length: 5 }, (_, step) => {
            const t = step / 4;
            return morphology.somaCenter.clone().add(
              new THREE.Vector3(
                Math.sin((t + index * 0.17) * Math.PI * 2) * (0.5 + Math.random() * morphology.somaRadius),
                (t - 0.5) * morphology.somaRadius * 1.4 + (Math.random() - 0.5) * 0.18,
                Math.cos((t + index * 0.11) * Math.PI * 2) * (0.5 + Math.random() * morphology.somaRadius),
              ),
            );
          }),
        );
        addCurveTubes(cytoskeletonGroup, [curve], material, 0.013, 24, 6);
      }
    }

    this.registerExplodable(cytoskeletonGroup, new THREE.Vector3(0, -1, 0.4));
    return cytoskeletonGroup;
  }

  createRibosomes(model, morphology) {
    const ribosomeGroup = this.createGroup("ribosomes");
    const geometry = new THREE.SphereGeometry(0.018, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: model.palette.ribosome || COLOR_MAP.ribosome,
      transparent: true,
      opacity: 0.88,
    });
    const instanced = new THREE.InstancedMesh(geometry, material, model.components.ribosomes);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (let index = 0; index < model.components.ribosomes; index += 1) {
      const position = organellePoint(morphology, { family: "generic" }, 4400 + index * 13, 0.9);
      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(index, matrix);
    }

    ribosomeGroup.add(instanced);
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
    const distance = this.explodeAmount * 1.65;
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

  getAvailableComponents() {
    return Object.entries(this.componentGroups)
      .filter(([, group]) => {
        if (!group) return false;
        if (group.children.length > 0) return true;
        let hasRenderable = false;
        group.traverse((node) => {
          if (node !== group && node.isMesh) hasRenderable = true;
        });
        return hasRenderable;
      })
      .map(([key]) => key);
  }

  applyRenderMode() {
    this.cellGroup.traverse((node) => {
      if (!node.material) {
        return;
      }
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        material.wireframe = this.showWireframe;
        if ("opacity" in material) {
          if (this.showXRay) {
            material.transparent = true;
            material.opacity = Math.min(material.opacity ?? 1, 0.28);
            material.depthWrite = false;
          } else {
            material.depthWrite = true;
            if (material.type === "MeshBasicMaterial") {
              material.opacity = Math.max(material.opacity ?? 1, 0.44);
            } else {
              material.opacity = material.userData.baseOpacity || material.opacity || 0.95;
            }
          }
        }
        if (!material.userData.baseOpacity) {
          material.userData.baseOpacity = material.opacity;
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

  resetFocus() {
    this.controls.target.set(0, 0, 0);
  }

  resetView() {
    const isExtended = this.activeProfile && ["neuron", "msNeuron", "muscle", "melanocyte"].includes(this.activeProfile.family);
    this.camera.position.copy(
      isExtended ? new THREE.Vector3(0.8, 1.4, 12.5) : this.defaultCamera.clone(),
    );
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  animate() {
    const elapsed = this.clock.getElapsedTime();
    this.floaters.forEach((floater, index) => {
      const phase = elapsed * floater.speed + index * 0.37;
      floater.mesh.position[floater.axis] += Math.sin(phase) * floater.range * 0.018;
      floater.mesh.rotation.x += 0.0008;
      floater.mesh.rotation.y += 0.001;
    });
    this.signalPulses.forEach((pulse, index) => {
      let t = (elapsed * pulse.speed * (1.0 + this.stateTension * 1.7) + pulse.phase) % 1;
      if (t > pulse.damagedBand[0] && t < pulse.damagedBand[1]) {
        t -= Math.sin((t - pulse.damagedBand[0]) * Math.PI * 8) * 0.006;
        pulse.mesh.scale.setScalar(1.0 + Math.sin(elapsed * 9 + index) * 0.28);
      } else {
        pulse.mesh.scale.setScalar(0.82 + Math.sin(elapsed * 12 + index) * 0.08);
      }
      pulse.mesh.position.copy(pulse.curve.getPoint(clamp(t, 0, 1)));
    });
    this.reactiveMeshes.forEach((item) => {
      const wave = 1 + Math.sin(elapsed * item.speed + item.phase) * item.amplitude;
      item.mesh.scale.copy(item.baseScale).multiplyScalar(wave);
      item.mesh.rotation.y += 0.003 + item.amplitude * 0.002;
    });
    if (this.selectionHalo) {
      this.selectionHalo.rotation.y += 0.012;
      this.selectionHalo.rotation.z += 0.007;
    }
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
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
