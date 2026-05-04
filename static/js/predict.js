/* ============================================================================
   Predictor form + supplementary observations + land use + prediction.
   --------------------------------------------------------------------------
   Mirrors all UI state into window.__surveyState. The save-survey panel
   reads it; this file calls /api/predict, renders the result, and writes
   the full server response back into state for save.js to persist.

   The endpoint now returns a richer object:
       { raw_model, geology, tcs, lups, modifier, bgs_check, flags,
         expert_review }
   We render summary metrics inline and a collapsible details block
   below.
   ============================================================================ */

(() => {
  const btn      = document.getElementById("btn-predict");
  const grid     = document.getElementById("predictor-grid");
  const result   = document.getElementById("result");
  const detail   = document.getElementById("result-detail");
  const errorBox = document.getElementById("predict-error");

  if (!btn || !grid) return;

  // -------- Predictor + inferred-flag sync --------------------------------
  function syncPredictors() {
    const current = {};
    const inferred = {};
    grid.querySelectorAll("[data-feature]").forEach((el) => {
      current[el.dataset.feature] = el.value;
    });
    grid.querySelectorAll("[data-inferred]").forEach((el) => {
      inferred[el.dataset.inferred] = !!el.checked;
    });
    window.__surveyState.predictors       = Object.keys(current).length ? current : null;
    window.__surveyState.inferred         = inferred;
    window.__surveyState.inferred_count   = Object.values(inferred).filter(Boolean).length;
    invalidatePrediction();
    window.__surveyEmit && window.__surveyEmit();
  }
  grid.querySelectorAll("[data-feature]").forEach((el) => {
    el.addEventListener("change", syncPredictors);
  });
  grid.querySelectorAll("[data-inferred]").forEach((el) => {
    el.addEventListener("change", syncPredictors);
  });
  syncPredictors();

  // -------- Supplementary observations ------------------------------------
  function syncSupplementary() {
    const supp = {};
    document.querySelectorAll("[data-supp]").forEach((el) => {
      supp[el.dataset.supp] = !!el.checked;
    });
    window.__surveyState.supplementary = supp;
    invalidatePrediction();
    window.__surveyEmit && window.__surveyEmit();
  }
  document.querySelectorAll("[data-supp]").forEach((el) => {
    el.addEventListener("change", syncSupplementary);
  });
  syncSupplementary();

  // -------- Land use + live LUPS preview ----------------------------------
  // LUPS weights MUST match server (confidence.LUPS_WEIGHTS). Kept here for
  // a live preview only — server is the source of truth.
  const LUPS_WEIGHTS = {
    active_mining_within_500m:         -3,
    artisanal_mining_or_wetland_drain: -2,
    urban_impervious_over_30pct:       -2,
    deforestation_or_eucalyptus:       -1,
    irrigated_ag_borehole_source:      -1,
    no_significant_pressure:            0,
    farm_dam_or_weir_within_300m:      +1,
  };

  function syncLandUse() {
    const lu = {};
    let total = 0;
    document.querySelectorAll("[data-lups]").forEach((el) => {
      const k = el.dataset.lups;
      lu[k] = !!el.checked;
      if (el.checked && (k in LUPS_WEIGHTS)) total += LUPS_WEIGHTS[k];
    });
    window.__surveyState.land_use = lu;
    const display = document.getElementById("lups-display");
    const level   = document.getElementById("lups-level");
    if (display) display.textContent = (total > 0 ? "+" : "") + total;
    if (level) {
      let lvl = "low";
      if (total < 0 && total >= -2) lvl = "moderate";
      else if (total < -2)          lvl = "severe";
      level.textContent = `(${lvl})`;
      level.style.color = (lvl === "severe") ? "var(--danger)"
                          : (lvl === "moderate") ? "var(--gold-bright)"
                          : "var(--text-mute)";
    }
    invalidatePrediction();
    window.__surveyEmit && window.__surveyEmit();
  }
  document.querySelectorAll("[data-lups]").forEach((el) => {
    el.addEventListener("change", syncLandUse);
  });
  syncLandUse();

  // -------- Geology override (in the Hydrogeology card) ------------------
  const overrideToggle = document.getElementById("geo-override-toggle");
  const overrideRow    = document.getElementById("geo-override-row");
  const overrideValue  = document.getElementById("geo-override-value");
  const overrideReason = document.getElementById("geo-override-reason");

  function syncGeoOverride() {
    if (!overrideToggle) return;
    const on = overrideToggle.checked;
    if (overrideRow) overrideRow.style.display = on ? "block" : "none";
    window.__surveyState.geo_override = on
      ? { value: overrideValue.value, reason: overrideReason.value || "" }
      : null;
    invalidatePrediction();
  }
  if (overrideToggle) {
    overrideToggle.addEventListener("change", syncGeoOverride);
    overrideValue && overrideValue.addEventListener("change", syncGeoOverride);
    overrideReason && overrideReason.addEventListener("input", syncGeoOverride);
    syncGeoOverride();
  }

  function invalidatePrediction() {
    if (window.__surveyState.prediction) {
      window.__surveyState.prediction = null;
      result.style.display = "none";
      if (detail) detail.style.display = "none";
    }
  }

  // -------- Run prediction -----------------------------------------------
  btn.addEventListener("click", async () => {
    errorBox.textContent = "";
    errorBox.style.display = "none";
    result.style.display = "none";
    if (detail) detail.style.display = "none";

    const s = window.__surveyState;
    if (!s.gps) {
      showError("Detect your location first (Step 1).");
      return;
    }
    if (!s.predictors || Object.keys(s.predictors).length === 0) {
      showError("Fill in the predictor inputs (Step 3).");
      return;
    }

    // Apply geology override locally so we send the surveyor's chosen
    // value into the model. The server still receives the GPS, runs its
    // OWN lookup for the audit trail / saved record, but the model input
    // we give it reflects the override.
    const predictorsToSend = { ...s.predictors };
    if (s.geo_override) {
      // Find the geology predictor by normalized name ("Geological Features",
      // "Geological.Features", etc all map to the same thing).
      Object.keys(predictorsToSend).forEach((k) => {
        if (k.toLowerCase().replace(/[\s._]+/g, "") === "geologicalfeatures") {
          predictorsToSend[k] = s.geo_override.value;
        }
      });
    }

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "Predicting…";

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat:            s.gps.latitude,
          lon:            s.gps.longitude,
          predictors:     predictorsToSend,
          inferred_count: s.inferred_count || 0,
          supplementary:  s.supplementary || {},
          land_use:       s.land_use || {},
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 422 && body.error === "surface_water") {
        showError("This GPS point falls inside a surface-water body (lake or reservoir). " +
                  "No groundwater prediction is generated for surface water.");
        return;
      }
      if (res.status === 422 && body.error === "out_of_coverage") {
        showError("This GPS point is outside the BGS Zimbabwe coverage. " +
                  "The current dataset covers Zimbabwe only.");
        return;
      }
      if (!res.ok) throw new Error(body.message || body.error || `Server returned ${res.status}`);

      // Stash the FULL server response — save.js sends this back on save.
      window.__surveyState.prediction = body;
      window.__surveyEmit && window.__surveyEmit();
      renderResult(body);
    } catch (e) {
      showError("Prediction failed: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  });

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.style.display = "block";
  }

  // -------- Render ---------------------------------------------------------
  function renderResult(r) {
    const raw = r.raw_model || {};
    const mod = r.modifier  || {};
    const tcs = r.tcs       || {};
    const lups = r.lups     || {};
    const bgs  = r.bgs_check || {};
    const review = r.expert_review || {};

    const finalLabel = mod.final_label || raw.label || "—";
    const isHigh = (mod.final_class_int === 1) ||
                   (mod.final_class_int === undefined && raw.prediction === 1);

    result.classList.remove("high", "low");
    result.classList.add(isHigh ? "high" : "low");

    const icon = isHigh ? "🌱" : "⚠️";
    const downgradedNote = mod.downgrade_applied
      ? `<p class="muted" style="margin: 0.4rem 0 0;"><strong>Downgraded</strong> from High to Low by Land Use Pressure modifier.</p>`
      : "";

    result.innerHTML = `
      <h3>${icon} ${escapeHtml(finalLabel)}</h3>
      ${downgradedNote}
      <div class="metrics">
        <div class="metric">
          <div class="label">High potential confidence</div>
          <div class="value">${(raw.high_potential_pct ?? 0).toFixed(2)}%</div>
        </div>
        <div class="metric">
          <div class="label">Low potential confidence</div>
          <div class="value">${(raw.low_potential_pct ?? 0).toFixed(2)}%</div>
        </div>
        <div class="metric">
          <div class="label">Total Confidence Score</div>
          <div class="value">${mod.tcs_adjusted ?? tcs.tcs ?? "—"}<span style="font-size: 1rem; color: var(--text-mute);">/10</span></div>
        </div>
        <div class="metric">
          <div class="label">Land Use Pressure</div>
          <div class="value">${(lups.score >= 0 ? "+" : "")}${lups.score ?? 0}<span style="font-size: 1rem; color: var(--text-mute);"> (${lups.level || "—"})</span></div>
        </div>
      </div>
    `;
    result.style.display = "block";

    // --- Detail block --------------------------------------------------
    detail.innerHTML = renderDetail(r);
    detail.style.display = "block";
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderDetail(r) {
    const mod    = r.modifier   || {};
    const tcs    = r.tcs        || {};
    const lups   = r.lups       || {};
    const bgs    = r.bgs_check  || {};
    const review = r.expert_review || {};
    const flags  = r.flags || [];
    const ex     = tcs.explanations || {};

    const tcsBars = [
      tcsRow("C1 — Data completeness",        tcs.c1, 3, ex.c1),
      tcsRow("C2 — Geology match quality",    tcs.c2, 3, ex.c2),
      tcsRow("C3 — Indicator convergence",    tcs.c3, 2, ex.c3),
      tcsRow("C4 — BGS baseline alignment",   tcs.c4, 2, ex.c4),
    ].join("");

    const flagPills = flags.length
      ? flags.map(f => `<span class="pill pill-bad" style="margin-right: 0.3rem;">${escapeHtml(f)}</span>`).join("")
      : `<span class="muted">No flags raised.</span>`;

    const reviewBox = review.needs_review
      ? `
        <div class="alert error" style="margin-top: 0.75rem;">
          <strong>⚠ Expert review required.</strong>
          <ul style="margin: 0.4rem 0 0 1.2rem;">
            ${(review.reasons || []).map(rsn => `<li>${escapeHtml(rsn)}</li>`).join("")}
          </ul>
        </div>
      `
      : `<p class="muted" style="margin-top: 0.5rem;">No expert review triggers raised.</p>`;

    return `
      <div class="card" style="margin-top: 1rem;">
        <h3>Confidence breakdown</h3>
        <div class="tcs-table">${tcsBars}</div>

        <h3 style="margin-top: 1rem;">BGS regional baseline cross-check</h3>
        <p>${escapeHtml(bgs.message || "—")}</p>
        <p class="muted" style="font-size: 0.9rem;">
          Status: <strong>${escapeHtml(bgs.status || "—")}</strong>
          · Model says: ${escapeHtml(bgs.model_binary || "—")}
          · BGS baseline: ${escapeHtml(bgs.bgs_binary || "—")}
        </p>

        <h3 style="margin-top: 1rem;">Modifier advisory</h3>
        <p>${escapeHtml(mod.advisory || "—")}</p>

        <h3 style="margin-top: 1rem;">Flags</h3>
        <div>${flagPills}</div>

        ${reviewBox}
      </div>
    `;
  }

  function tcsRow(label, score, max, explanation) {
    const pct = (max > 0) ? Math.round((score || 0) / max * 100) : 0;
    return `
      <div class="tcs-row">
        <div class="tcs-label">${escapeHtml(label)}</div>
        <div class="tcs-bar"><div class="tcs-bar-fill" style="width: ${pct}%;"></div></div>
        <div class="tcs-score">${score ?? 0}/${max}</div>
        <div class="tcs-explain muted">${escapeHtml(explanation || "")}</div>
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
