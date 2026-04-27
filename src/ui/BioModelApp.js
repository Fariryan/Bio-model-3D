import { cellCatalog, derivedFilterValues, heroStats, modeChips } from "../data/catalog.js";
import { atlasGlossary } from "../data/glossary.js";
import { atlasNarratives } from "../data/narratives.js";
import { atlasResearchNotes } from "../data/researchNotes.js";
import { atlasComparisons } from "../data/comparisons.js";
import { CellScene } from "../scene/CellScene.js";
import { formatNumber, formatPercent, sampleArray } from "../utils/format.js";

export class BioModelApp {
  constructor({ container }) {
    this.scene = new CellScene(container);
    this.models = cellCatalog;
    this.filteredModels = cellCatalog.slice();
    this.glossary = atlasGlossary;
    this.narratives = atlasNarratives;
    this.researchNotes = atlasResearchNotes;
    this.comparisons = atlasComparisons;
    this.activeModel = cellCatalog[0];
    this.stateValue = 25;
  }

  mount() {
    this.cacheElements();
    this.populateFilters();
    this.bindEvents();
    this.renderHeroStats();
    this.renderModeChips();
    this.renderGlossary();
    this.renderCatalog();
    this.selectModel(this.activeModel.id);
  }

  cacheElements() {
    this.elements = {
      catalogCount: document.getElementById("catalogCount"),
      catalogList: document.getElementById("catalogList"),
      speciesFilter: document.getElementById("speciesFilter"),
      tissueFilter: document.getElementById("tissueFilter"),
      complexityFilter: document.getElementById("complexityFilter"),
      searchInput: document.getElementById("searchInput"),
      heroStats: document.getElementById("heroStats"),
      modeChips: document.getElementById("modeChips"),
      legendGrid: document.getElementById("legendGrid"),
      inspectorTitle: document.getElementById("inspectorTitle"),
      sampleBadge: document.getElementById("sampleBadge"),
      summaryGrid: document.getElementById("summaryGrid"),
      sampleSummary: document.getElementById("sampleSummary"),
      organelleList: document.getElementById("organelleList"),
      markerList: document.getElementById("markerList"),
      narrativeTrack: document.getElementById("narrativeTrack"),
      glossaryCount: document.getElementById("glossaryCount"),
      glossaryList: document.getElementById("glossaryList"),
      notesCount: document.getElementById("notesCount"),
      notesList: document.getElementById("notesList"),
      comparisonCount: document.getElementById("comparisonCount"),
      comparisonList: document.getElementById("comparisonList"),
      stateSlider: document.getElementById("stateSlider"),
      focusButton: document.getElementById("focusButton"),
      autopilotButton: document.getElementById("autopilotButton"),
      shuffleNarrativeButton: document.getElementById("shuffleNarrativeButton"),
    };
  }

  bindEvents() {
    const refilter = () => this.applyFilters();

    this.elements.searchInput.addEventListener("input", refilter);
    this.elements.speciesFilter.addEventListener("change", refilter);
    this.elements.tissueFilter.addEventListener("change", refilter);
    this.elements.complexityFilter.addEventListener("change", refilter);

    this.elements.stateSlider.addEventListener("input", (event) => {
      this.stateValue = Number(event.target.value);
      this.scene.setStateTension(this.stateValue / 100);
      this.renderSummaryGrid();
    });

    this.elements.focusButton.addEventListener("click", () => {
      this.scene.focusOnNucleus();
    });

    this.elements.autopilotButton.addEventListener("click", () => {
      this.scene.controls.autoRotate = !this.scene.controls.autoRotate;
      this.elements.autopilotButton.textContent = this.scene.controls.autoRotate
        ? "Stop tour"
        : "Auto tour";
    });

    this.elements.shuffleNarrativeButton.addEventListener("click", () => {
      this.renderNarratives();
    });
  }

  populateFilters() {
    this.fillSelect(this.elements.speciesFilter, ["All", ...derivedFilterValues.species]);
    this.fillSelect(this.elements.tissueFilter, ["All", ...derivedFilterValues.tissues]);
    this.fillSelect(this.elements.complexityFilter, ["All", ...derivedFilterValues.complexity]);
  }

  fillSelect(element, values) {
    element.innerHTML = "";
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      element.appendChild(option);
    });
  }

  renderHeroStats() {
    this.elements.heroStats.innerHTML = "";
    heroStats.forEach((item) => {
      const stat = document.createElement("div");
      stat.className = "hero-stat";
      stat.innerHTML = `
        <span>${item.label}</span>
        <strong>${item.value}</strong>
        <p>${item.detail}</p>
      `;
      this.elements.heroStats.appendChild(stat);
    });
  }

  renderModeChips() {
    this.elements.modeChips.innerHTML = "";
    modeChips.forEach((chip) => {
      const item = document.createElement("div");
      item.className = "mode-chip";
      item.innerHTML = `<span>${chip.label}</span><strong>${chip.value}</strong>`;
      this.elements.modeChips.appendChild(item);
    });
  }

  renderGlossary() {
    this.elements.glossaryCount.textContent = `${formatNumber(this.glossary.length)} terms`;
    this.elements.glossaryList.innerHTML = "";
    this.glossary.slice(0, 42).forEach((entry) => {
      const article = document.createElement("article");
      article.className = "glossary-entry";
      article.innerHTML = `
        <h4>${entry.term}</h4>
        <p>${entry.definition}</p>
        <div class="glossary-meta">
          <span>${entry.category}</span>
          <span>${entry.relevance}</span>
        </div>
      `;
      this.elements.glossaryList.appendChild(article);
    });
  }

  applyFilters() {
    const query = this.elements.searchInput.value.trim().toLowerCase();
    const species = this.elements.speciesFilter.value;
    const tissue = this.elements.tissueFilter.value;
    const complexity = this.elements.complexityFilter.value;

    this.filteredModels = this.models.filter((model) => {
      const textMatch =
        query.length === 0 ||
        [model.name, model.species, model.tissue, model.summary, ...model.tags]
          .join(" ")
          .toLowerCase()
          .includes(query);

      const speciesMatch = species === "All" || model.species === species;
      const tissueMatch = tissue === "All" || model.tissue === tissue;
      const complexityMatch = complexity === "All" || model.complexity === complexity;

      return textMatch && speciesMatch && tissueMatch && complexityMatch;
    });

    if (!this.filteredModels.find((model) => model.id === this.activeModel.id)) {
      this.activeModel = this.filteredModels[0] || this.models[0];
    }

    this.renderCatalog();
    this.selectModel(this.activeModel.id);
  }

  renderCatalog() {
    this.elements.catalogList.innerHTML = "";
    this.elements.catalogCount.textContent = `${this.filteredModels.length} visible`;
    const template = document.getElementById("catalogItemTemplate");

    this.filteredModels.forEach((model) => {
      const fragment = template.content.cloneNode(true);
      const button = fragment.querySelector(".catalog-item");

      if (model.id === this.activeModel.id) {
        button.classList.add("active");
      }

      fragment.querySelector(".catalog-species").textContent = model.species;
      fragment.querySelector(".catalog-score").textContent = `${model.score}/100`;
      fragment.querySelector(".catalog-name").textContent = model.name;
      fragment.querySelector(".catalog-description").textContent = model.summary;

      const tagWrap = fragment.querySelector(".catalog-tags");
      model.tags.slice(0, 4).forEach((tag) => {
        const tagElement = document.createElement("span");
        tagElement.className = "tag";
        tagElement.textContent = tag;
        tagWrap.appendChild(tagElement);
      });

      button.addEventListener("click", () => {
        this.selectModel(model.id);
      });

      this.elements.catalogList.appendChild(fragment);
    });
  }

  selectModel(modelId) {
    const nextModel = this.models.find((model) => model.id === modelId) || this.models[0];
    this.activeModel = nextModel;
    this.scene.setModel(nextModel);
    this.scene.setStateTension(this.stateValue / 100);
    this.renderCatalog();
    this.renderInspector();
    this.renderLegends();
    this.renderNarratives();
    this.renderResearchNotes();
    this.renderComparisons();
  }

  renderInspector() {
    this.elements.inspectorTitle.textContent = this.activeModel.name;
    this.elements.sampleBadge.textContent = `${this.activeModel.sampleType} sample`;
    this.elements.sampleSummary.textContent = this.activeModel.summaryLong;

    this.renderSummaryGrid();

    this.elements.organelleList.innerHTML = "";
    this.activeModel.organelleHighlights.forEach((item) => {
      const row = document.createElement("article");
      row.className = "detail-card";
      row.innerHTML = `<h4>${item.name}</h4><p>${item.detail}</p>`;
      this.elements.organelleList.appendChild(row);
    });

    this.elements.markerList.innerHTML = "";
    this.activeModel.markers.forEach((item) => {
      const row = document.createElement("article");
      row.className = "detail-card";
      row.innerHTML = `
        <h4>${item.marker}</h4>
        <p>${item.significance}</p>
        <div class="detail-meta">
          <span>${item.pathway}</span>
          <span>${item.signal}</span>
        </div>
      `;
      this.elements.markerList.appendChild(row);
    });
  }

  renderSummaryGrid() {
    const activation = Math.round(this.stateValue);
    const density = Math.round(this.activeModel.components.ribosomes * (1 + activation / 180));
    const permeability = Math.min(99, Math.round(this.activeModel.metrics.permeability + activation * 0.18));

    const items = [
      { label: "Organelles", value: formatNumber(this.activeModel.metrics.organelles) },
      { label: "Ribosome density", value: formatNumber(density) },
      { label: "Membrane permeability", value: formatPercent(permeability) },
      { label: "Stress index", value: `${this.activeModel.metrics.stressBase + activation / 10}` },
      { label: "ATP reserve", value: `${this.activeModel.metrics.atpReserve - activation * 0.12} a.u.` },
      { label: "Cytoskeletal bias", value: this.activeModel.metrics.cytoskeletalBias },
    ];

    this.elements.summaryGrid.innerHTML = "";
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "summary-card";
      card.innerHTML = `<span>${item.label}</span><strong>${item.value}</strong>`;
      this.elements.summaryGrid.appendChild(card);
    });
  }

  renderLegends() {
    this.elements.legendGrid.innerHTML = "";
    this.activeModel.legend.forEach((item) => {
      const legend = document.createElement("div");
      legend.className = "legend-card";
      legend.innerHTML = `
        <span class="swatch" style="--swatch:${item.color}"></span>
        <div>
          <strong>${item.label}</strong>
          <p>${item.detail}</p>
        </div>
      `;
      this.elements.legendGrid.appendChild(legend);
    });
  }

  renderNarratives() {
    const relatedNarratives = this.narratives.filter((item) => {
      return item.tags.some((tag) => this.activeModel.tags.includes(tag));
    });

    this.elements.narrativeTrack.innerHTML = "";
    sampleArray(relatedNarratives, 4).forEach((item) => {
      const card = document.createElement("article");
      card.className = "narrative-card";
      card.innerHTML = `
        <div class="narrative-phase">${item.phase}</div>
        <h4>${item.title}</h4>
        <p>${item.description}</p>
        <div class="narrative-tags">${item.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
      `;
      this.elements.narrativeTrack.appendChild(card);
    });
  }

  renderResearchNotes() {
    const notes = this.researchNotes.filter((item) => item.modelId === this.activeModel.id).slice(0, 6);
    this.elements.notesCount.textContent = `${notes.length} active`;
    this.elements.notesList.innerHTML = "";

    notes.forEach((item) => {
      const card = document.createElement("article");
      card.className = "note-card";
      card.innerHTML = `
        <div class="note-head">
          <h4>${item.title}</h4>
          <span>${item.severity}</span>
        </div>
        <p>${item.detail}</p>
        <div class="note-tags">${item.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
      `;
      this.elements.notesList.appendChild(card);
    });
  }

  renderComparisons() {
    const matches = this.comparisons
      .filter((item) => item.sourceId === this.activeModel.id || item.targetId === this.activeModel.id)
      .slice(0, 4);

    this.elements.comparisonCount.textContent = `${matches.length} prompts`;
    this.elements.comparisonList.innerHTML = "";

    matches.forEach((item) => {
      const target =
        this.models.find((model) => model.id === item.targetId) ||
        this.models.find((model) => model.id === item.sourceId);
      const card = document.createElement("article");
      card.className = "comparison-card";
      card.innerHTML = `
        <div class="comparison-top">
          <h4>${item.focus}</h4>
          <span>${item.metricDelta}</span>
        </div>
        <p>${item.summary}</p>
        <button type="button" class="ghost-button small comparison-trigger">
          Load ${target?.species || "paired"} model
        </button>
      `;

      card.querySelector(".comparison-trigger").addEventListener("click", () => {
        const nextId = item.sourceId === this.activeModel.id ? item.targetId : item.sourceId;
        this.selectModel(nextId);
      });

      this.elements.comparisonList.appendChild(card);
    });
  }
}
