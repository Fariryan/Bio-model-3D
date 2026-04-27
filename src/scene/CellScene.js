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

  buildNeuronMorphology(model) {
    const membraneGroup = this.createGroup("membrane");
    const processGroup = this.createGroup("processes");
    const projectionGroup = this.createGroup("projections");

    const somaGeometry = new THREE.IcosahedronGeometry(1.45, 18);
    deformSphere(somaGeometry, 1.45, { scaleX: 3.6, scaleY: 2.8, scaleZ: 3.2, amplitude: 0.07 });
    somaGeometry.scale(1.12, 0.94, 1.02);
    const soma = new THREE.Mesh(
      somaGeometry,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.38,
        thickness: 0.45,
      }),
    );
    membraneGroup.add(soma);

    const dendriteCurves = [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.1, 0.5, 0.2),
        new THREE.Vector3(-2.4, 1.4, 0.6),
        new THREE.Vector3(-3.5, 2.1, 0.3),
        new THREE.Vector3(-4.3, 2.8, -0.4),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.7, -0.2, 0.8),
        new THREE.Vector3(-1.9, -0.7, 1.5),
        new THREE.Vector3(-3.1, -1.1, 1.9),
        new THREE.Vector3(-4.0, -1.8, 2.2),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.3, 0.9, -0.6),
        new THREE.Vector3(0.2, 2.0, -1.5),
        new THREE.Vector3(-0.6, 2.9, -2.0),
        new THREE.Vector3(-1.3, 3.8, -2.4),
      ]),
    ];

    addCurveTubes(
      processGroup,
      dendriteCurves,
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.22,
        opacity: 0.9,
      }),
      0.12,
      96,
      12,
    );

    dendriteCurves.forEach((curve, index) => {
      const branchPoints = curve.getPoints(3);
      const branch = new THREE.CatmullRomCurve3([
        branchPoints[2],
        branchPoints[2].clone().add(new THREE.Vector3(0.8, 0.6 - index * 0.2, 0.8 - index * 0.4)),
        branchPoints[2].clone().add(new THREE.Vector3(1.4, 1.0 - index * 0.2, 1.3 - index * 0.5)),
      ]);
      addCurveTubes(
        projectionGroup,
        [branch],
        createMaterial(model.palette.membrane, {
          emissive: new THREE.Color(model.palette.membraneGlow),
          transmission: 0.18,
          opacity: 0.82,
        }),
        0.06,
        56,
        10,
      );
    });

    const axonCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.15, -0.2, 0.1),
      new THREE.Vector3(2.4, -0.3, 0.1),
      new THREE.Vector3(4.8, 0.3, -0.3),
      new THREE.Vector3(7.4, 0.8, -0.2),
      new THREE.Vector3(10.0, 1.4, 0.4),
    ]);
    addCurveTubes(
      processGroup,
      [axonCurve],
      createMaterial(model.palette.membrane, {
        emissive: new THREE.Color(model.palette.membraneGlow),
        transmission: 0.18,
      }),
      0.07,
      144,
      12,
    );

    for (let index = 0; index < 7; index += 1) {
      const t = 0.22 + index * 0.1;
      const point = axonCurve.getPoint(Math.min(t, 0.95));
      const bouton = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 12, 12),
        createMaterial(model.palette.vesicle || COLOR_MAP.vesicle, {
          emissive: new THREE.Color("#18414d"),
          opacity: 0.88,
        }),
      );
      bouton.position.copy(point).add(new THREE.Vector3(0, Math.sin(index) * 0.18, Math.cos(index) * 0.12));
      projectionGroup.add(bouton);
      this.floaters.push({ mesh: bouton, axis: "y", speed: 0.35 + index * 0.05, range: 0.02 });
    }

    this.registerExplodable(membraneGroup, new THREE.Vector3(-1, 0.6, 0.2));
    this.registerExplodable(processGroup, new THREE.Vector3(1, 0.1, 0.1));
    this.registerExplodable(projectionGroup, new THREE.Vector3(-0.2, 1, 0.4));

    return {
      membraneGroup,
      processGroup,
      projectionGroup,
      somaCenter: new THREE.Vector3(-0.1, 0.1, 0),
      somaRadius: 1.45,
      outerRadius: 10.0,
      processCurves: [...dendriteCurves, axonCurve],
    };
  }

  buildGliaMorphology(model) {
    const generic = this.buildGenericMorphology(model);
    generic.membraneGroup.scale.set(1.04, 0.96, 1.04);
    const material = createMaterial(model.palette.membrane, {
      emissive: new THREE.Color(model.palette.membraneGlow),
      transmission: 0.28,
      opacity: 0.9,
    });
    const branches = [];
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(angle) * 0.8, (Math.random() - 0.5) * 0.6, Math.sin(angle) * 0.8),
        new THREE.Vector3(Math.cos(angle) * 1.7, (Math.random() - 0.5) * 1.2, Math.sin(angle) * 1.7),
        new THREE.Vector3(Math.cos(angle) * 2.6, (Math.random() - 0.5) * 1.8, Math.sin(angle) * 2.6),
      ]);
      branches.push(curve);
    }
    addCurveTubes(generic.processGroup, branches, material, 0.07, 64, 10);
    this.registerExplodable(generic.processGroup, new THREE.Vector3(0.4, 1, 0.3));
    return generic;
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
        new THREE.CapsuleGeometry(0.018, 0.09 + Math.random() * 0.08, 4, 8),
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
      const radius = 1.7 + Math.random() * 0.35;
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
        new THREE.Vector3(0.8 + Math.random() * 0.5, -0.2 + Math.random() * 0.8, -0.4 + Math.random() * 0.7),
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

    const curveCount = profile.family === "hepatocyte" ? 16 : profile.family === "neuron" ? 10 : 8;
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

    if (profile.family === "neuron" && morphology.processCurves) {
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

    if (profile.family === "neuron" || profile.family === "melanocyte") {
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
        const spread = profile.family === "hepatocyte" ? 1.6 : morphology.somaRadius * 0.78;
        mesh.position.copy(morphology.somaCenter).add(
          new THREE.Vector3(
            (Math.random() - 0.5) * spread * 1.7,
            (Math.random() - 0.5) * spread * 1.3,
            (Math.random() - 0.5) * spread * 1.5,
          ),
        );
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
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
      let spread = morphology.somaRadius * 1.2;
      if (profile.family === "melanocyte") {
        spread = 2.2;
      }
      mesh.position.copy(morphology.somaCenter).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * spread * 1.4,
          (Math.random() - 0.5) * spread * 1.2,
          (Math.random() - 0.5) * spread * 1.4,
        ),
      );
      vesicleGroup.add(mesh);
      this.floaters.push({ mesh, axis: "z", speed: 0.22 + Math.random() * 0.35, range: 0.015 });
    }

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

    for (let index = 0; index < model.components.lysosomes; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.08 + Math.random() * 0.03, 1),
        material,
      );
      mesh.position.copy(morphology.somaCenter).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * morphology.somaRadius * 1.5,
          (Math.random() - 0.5) * morphology.somaRadius * 1.4,
          (Math.random() - 0.5) * morphology.somaRadius * 1.5,
        ),
      );
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
      const filamentCount = model.components.filaments + (profile.family === "neuron" ? 10 : 0);
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
      const radius = 0.3 + Math.random() * morphology.somaRadius * 1.1;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const position = new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
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
    const isExtended = this.activeProfile && ["neuron", "muscle", "melanocyte"].includes(this.activeProfile.family);
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
    this.controls.dispose();
    this.renderer.dispose();
  }
}
