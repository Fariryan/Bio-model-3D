export const morphologyProfiles = {
  "human-cortical-neuron": {
    family: "neuron",
    silhouette: "Large soma with tapering dendrites, a single long axon, and clustered presynaptic boutons.",
    realismNotes: [
      "Neuron geometry is polarized rather than spherical: one dominant axon, several thicker dendrites, and a soma that remains the main organelle reservoir.",
      "Golgi is condensed into a perinuclear ribbon and neurite shafts carry long tubular mitochondria rather than evenly scattered capsules.",
      "Branch tips and boutons are emphasized so the model reads as a signaling cell instead of a generic vesicle cloud.",
    ],
    morphologyTags: ["axon hillock", "dendritic arbor", "presynaptic boutons", "perinuclear Golgi"],
  },
  "mouse-hippocampal-neuron": {
    family: "neuron",
    silhouette: "Compact pyramidal soma with branching dendrites and a slender projection axis.",
    realismNotes: [
      "This model preserves neuronal polarity with a clearer branch hierarchy and tubular neuritic mitochondria.",
      "Dendrite-rich geometry is favored over isotropic swelling so the hippocampal morphology reads as circuit tissue.",
    ],
    morphologyTags: ["pyramidal arbor", "branch hierarchy", "neuritic mitochondria"],
  },
  "rat-astrocyte": {
    family: "glia",
    silhouette: "Star-like body with many soft branching processes radiating from a central soma.",
    realismNotes: [
      "Astrocytes are rendered as process-rich support cells rather than axon-bearing neurons.",
      "The surface is softer, with branchlets and a less dominant axial projection than neurons.",
    ],
    morphologyTags: ["stellate processes", "glial branchlets", "supportive arbor"],
  },
  "human-hepatocyte": {
    family: "hepatocyte",
    silhouette: "Polyhedral body with grooved surfaces, perinuclear Golgi ribbon, and canalicular furrows.",
    realismNotes: [
      "Hepatocytes are more polygonal and sheet-like than round immune cells, with canalicular invaginations rather than a uniformly wrinkled shell.",
      "The model includes surface grooves and microvillus-rich luminal channels inspired by bile canaliculi architecture.",
      "Reticulum abundance is visibly increased to distinguish detoxification-heavy parenchymal cells.",
    ],
    morphologyTags: ["polyhedral body", "bile canaliculi", "smooth ER bias", "peroxisome-rich cytoplasm"],
  },
  "pig-intestinal-stem-cell": {
    family: "epithelial",
    silhouette: "Compact epithelial precursor with apical-basal bias and microvillus-rich outer band.",
    realismNotes: [
      "The body is slightly columnar and polarized rather than isotropic.",
      "Surface texture is concentrated toward an apical pole to hint at epithelial specialization.",
    ],
    morphologyTags: ["apical-basal polarity", "apical texture", "crypt precursor"],
  },
  "canine-epithelial-cell": {
    family: "epithelial",
    silhouette: "Barrier-oriented epithelial cell with apical projections and lateral tension bands.",
    realismNotes: [
      "This model uses a flattened, polarized body with apical protrusions rather than a pure sphere.",
      "Surface detail concentrates at the exposed pole to better reflect epithelial barrier morphology.",
    ],
    morphologyTags: ["apical surface", "lateral bands", "barrier geometry"],
  },
  "human-t-cell": {
    family: "immune",
    silhouette: "Nearly spherical immune cell covered in irregular microvilli and an activation-facing synapse patch.",
    realismNotes: [
      "T cells keep a compact cell body but now carry dense, finger-like microvilli instead of a smooth membrane.",
      "The activation face is slightly flattened to suggest immunological synapse formation without losing overall motility.",
      "Surface receptor-rich protrusions are emphasized over internal bulk to distinguish them from parenchymal cells.",
    ],
    morphologyTags: ["microvilli coat", "synapse patch", "motile cortex"],
  },
  "bat-immune-cell": {
    family: "immune",
    silhouette: "Compact immune sphere with many short exploratory microvilli and a resilient cortical shell.",
    realismNotes: [
      "The membrane is microvillus-dense and slightly irregular rather than smooth or multilobed.",
      "Short protrusions reinforce immune scanning behavior.",
    ],
    morphologyTags: ["immune microvilli", "cortical shell", "scanning protrusions"],
  },
  "human-cardiomyocyte": {
    family: "muscle",
    silhouette: "Elongated contractile body with aligned filament bands and packed mitochondrial lanes.",
    realismNotes: [
      "Cardiomyocyte geometry is stretched and banded to hint at contractile order rather than round organelle symmetry.",
      "Mitochondria are arranged in linear lanes to reflect high energetic demand.",
    ],
    morphologyTags: ["contractile axis", "mitochondrial lanes", "sarcomeric bias"],
  },
  "human-melanocyte": {
    family: "melanocyte",
    silhouette: "Pigment cell with dendritic extensions and vesicle-biased distal transfer arms.",
    realismNotes: [
      "Melanocytes carry branching transfer arms rather than a smooth globular outline.",
      "Vesicle traffic is pulled toward distal processes to suggest pigment handoff.",
    ],
    morphologyTags: ["dendritic arms", "distal transfer", "vesicle flow"],
  },
  "frog-oocyte": {
    family: "oocyte",
    silhouette: "Large rounded developmental cell with layered cortex, storage-rich interior, and surface polarity cues.",
    realismNotes: [
      "The oocyte remains large and rounded, but is differentiated by a thick cortex and denser peripheral granules.",
      "Developmental polarity is introduced through asymmetry rather than neurites or microvilli.",
    ],
    morphologyTags: ["thick cortex", "storage granules", "developmental polarity"],
  },
  "zebrafish-embryonic-cell": {
    family: "embryonic",
    silhouette: "Soft division-ready blastomere with dynamic membrane blebs and signaling-rich cortex.",
    realismNotes: [
      "Embryonic geometry is smoother and more deformable than mature specialized cells.",
      "Surface blebs and cortex bias help distinguish it from quiescent spherical models.",
    ],
    morphologyTags: ["dynamic cortex", "division-ready", "morphogen-responsive shell"],
  },
};


morphologyProfiles["human-ms-degenerated-myelin-neuron"] = {
  family: "msNeuron",
  silhouette: "Large neural soma with dendritic arbor, one long axon, compact myelin internodes, exposed demyelinated axon, myelin debris, and neighboring glial/immune support cells.",
  realismNotes: [
    "The model is no longer a generic cell: it uses neuronal polarity with a soma, dendrites, axon hillock, long axon, terminal boutons, and spine-like dendritic protrusions.",
    "Myelin is represented as segmented internodes interrupted by nodes of Ranvier, with two damaged internodes showing broken wraps, exposed axon, and debris.",
    "CNS support context is included through an oligodendrocyte, reactive astrocyte, activated microglia, inflammatory plaque particles, and animated conduction pulses.",
    "Internal organelles are constrained to the soma and neurites so they do not float outside the cell boundary."
  ],
  morphologyTags: ["demyelinated axon", "nodes of Ranvier", "oligodendrocyte", "microglia", "action potential pulses", "MS lesion"]
};

export function getMorphologyProfile(modelId) {
  return morphologyProfiles[modelId] || {
    family: "generic",
    silhouette: "Generalized eukaryotic cell body with organelle-rich interior.",
    realismNotes: [
      "This profile falls back to a generalized eukaryotic morphology with differentiated internal organelles.",
    ],
    morphologyTags: ["generalized morphology"],
  };
}
