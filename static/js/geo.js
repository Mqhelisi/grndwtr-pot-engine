/* ============================================================================
   GPS detection + map + hydrogeology lookup.
   --------------------------------------------------------------------------
   Updates window.__surveyState. Also auto-fills the "Geological Features"
   predictor dropdown using the BGS-suggested model class (Granite or
   Limestone), so the surveyor can either accept the suggestion or
   override it via the toggle in the Hydrogeology card.

   The /api/hydrogeology response shape is now richer — see
   hydrogeology.lookup() in the Python module:
       {
         status: "ok"|"out_of_coverage"|"surface_water"|"not_configured",
         raw_glg, raw_hg_code, model_class, remap_confidence,
         remap_flag, remap_rationale, bgs_aquifer_type,
         bgs_baseline_yield, bgs_baseline_yield_lps,
         features: [...],   // raw shapefile attributes
         summary: "..."
       }
   ============================================================================ */

window.__surveyState = window.__surveyState || {
  gps:             null,
  hydro:           null,    // the FULL response object (for the saved record)
  predictors:      null,
  inferred:        {},
  inferred_count:  0,
  supplementary:   {},
  land_use:        {},
  geo_override:    null,
  prediction:      null,
};

window.__surveyEvents = window.__surveyEvents || new EventTarget();
function emitChange() { window.__surveyEvents.dispatchEvent(new Event("change")); }
window.__surveyEmit = emitChange;

(() => {
  const btnDetect = document.getElementById("btn-detect");
  const status    = document.getElementById("gps-status");
  const coordsBox = document.getElementById("gps-coords");
  const mapEl     = document.getElementById("map");
  const hydroCard = document.getElementById("hydro-card");
  const hydroBody = document.getElementById("hydro-body");
  const overrideRow = document.getElementById("hydro-override-row");

  if (!btnDetect || !mapEl) return;

  const map = L.map("map").setView([-19.0154, 29.1549], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  let marker = null;
  const goldIcon = L.divIcon({
    className: "gold-marker",
    html: '<div style="width:20px;height:20px;border-radius:50%;background:#f5c77a;border:3px solid #1a1a1a;box-shadow:0 0 12px rgba(245,199,122,0.7);"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  btnDetect.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation not supported by this browser.", "error");
      return;
    }
    setStatus("Requesting location from the browser…", "");
    btnDetect.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        window.__surveyState.gps = { latitude: lat, longitude: lon };
        window.__surveyState.hydro = null;
        emitChange();

        coordsBox.style.display = "block";
        coordsBox.textContent = `📌 Detected: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        if (marker) marker.setLatLng([lat, lon]);
        else        marker = L.marker([lat, lon], { icon: goldIcon }).addTo(map);
        map.setView([lat, lon], 13);

        btnDetect.textContent = "↻ Re-detect Location";
        btnDetect.disabled = false;
        setStatus("Location acquired.", "ok");

        loadHydrogeology(lat, lon);
      },
      (err) => {
        const messages = {
          1: "Permission denied — please allow location access in your browser and try again.",
          2: "Position unavailable — check your device or network.",
          3: "Timed out waiting for a fix — please try again.",
        };
        setStatus(messages[err.code] || ("Error: " + err.message), "error");
        btnDetect.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  async function loadHydrogeology(lat, lon) {
    if (!hydroCard || !hydroBody) return;
    hydroCard.style.display = "block";
    hydroBody.innerHTML = '<p class="muted">Looking up hydrogeological context…</p>';
    if (overrideRow) overrideRow.style.display = "none";

    try {
      const res = await fetch(
        `/api/hydrogeology?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
      );
      const data = await res.json();
      if (!res.ok) {
        renderHydroError(data.error || `Server returned ${res.status}`);
        window.__surveyState.hydro = null;
        emitChange();
        return;
      }

      // Persist the FULL response so save.js can snapshot it on the
      // saved survey record.
      window.__surveyState.hydro = data;
      emitChange();
      renderHydroResult(data);

      // Auto-fill the Geological Features predictor with the BGS-suggested
      // model class. The surveyor can override it via the toggle.
      autofillGeologyPredictor(data);
    } catch (e) {
      window.__surveyState.hydro = null;
      emitChange();
      renderHydroError(e.message);
    }
  }

  function renderHydroResult(data) {
    const appStatus = data.app_status || {};
    if (!appStatus.ready) {
      hydroBody.innerHTML = `
        <div class="alert info">
          Hydrogeology data is not configured on this server. Drop a
          shapefile bundle into <code>artifacts/hydrogeology/</code>
          and restart the app to enable this feature.
        </div>
      `;
      return;
    }

    if (data.status === "out_of_coverage") {
      hydroBody.innerHTML = `
        <div class="alert error">
          <strong>Out of coverage.</strong> ${escapeHtml(data.message || data.summary || "")}
        </div>
      `;
      return;
    }

    if (data.status === "surface_water") {
      hydroBody.innerHTML = `
        <div class="alert error">
          <strong>Surface water.</strong> ${escapeHtml(data.message || "")}
          <p class="muted" style="font-size: 0.9rem; margin-top: 0.4rem;">
            Move the GPS fix off the lake / reservoir and re-detect to continue.
          </p>
        </div>
      `;
      return;
    }

    // status === "ok"
    const flagPill = data.remap_flag
      ? `<span class="pill pill-bad" style="margin-left: 0.3rem;">${escapeHtml(data.remap_flag)}</span>`
      : "";

    hydroBody.innerHTML = `
      <table class="kv kv-tight">
        <tr><td>BGS geology</td>      <td>${escapeHtml(data.raw_glg || "—")}</td></tr>
        <tr><td>BGS aquifer type</td> <td>${escapeHtml(data.bgs_aquifer_type || "—")}</td></tr>
        <tr><td>BGS yield code</td>   <td>${escapeHtml(data.raw_hg_code || "—")}</td></tr>
        <tr><td>Baseline yield</td>   <td>${escapeHtml(data.bgs_baseline_yield || "—")} (${escapeHtml(data.bgs_baseline_yield_lps || "—")} L/s)</td></tr>
        <tr><td>Auto-suggested geology class</td>
            <td><strong>${escapeHtml(data.model_class || "—")}</strong>
                <span class="pill" style="margin-left: 0.4rem;">${escapeHtml(data.remap_confidence || "—")} confidence</span>
                ${flagPill}
            </td></tr>
        <tr><td>Remap rationale</td>  <td class="muted" style="font-size: 0.9rem;">${escapeHtml(data.remap_rationale || "—")}</td></tr>
      </table>
      <p class="muted" style="font-size: 0.85rem; margin-top: 0.6rem;">
        Source: BGS Africa Groundwater Atlas (1:5,000,000) · CC BY-SA 4.0
      </p>
    `;
    if (overrideRow) overrideRow.style.display = "block";
  }

  function autofillGeologyPredictor(data) {
    if (data.status !== "ok" || !data.model_class) return;
    document.querySelectorAll("[data-feature]").forEach((el) => {
      // Match "Geological Features", "Geological.Features", "geological_features", etc.
      const featName = el.dataset.feature.toLowerCase().replace(/[\s._]+/g, "");
      if (featName === "geologicalfeatures") {
        const target = String(data.model_class).toLowerCase();
        let matched = false;
        Array.from(el.options).forEach((opt) => {
          if (opt.value.toLowerCase() === target) {
            el.value = opt.value;
            matched = true;
          }
        });
        if (matched) {
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });
  }

  function renderHydroError(msg) {
    hydroBody.innerHTML = `
      <div class="alert error">Could not load hydrogeology: ${escapeHtml(msg)}</div>
    `;
  }

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.classList.remove("ok", "error");
    if (kind) status.classList.add(kind);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
})();
