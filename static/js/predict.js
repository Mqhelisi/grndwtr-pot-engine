/* ============================================================================
   Predictor form submission
   --------------------------------------------------------------------------
   Collects the current value of every <select> in the predictor grid,
   POSTs them as JSON to /api/predict, and renders the result panel.
   No page reload — the prediction feels instant.
   ============================================================================ */

(() => {
  const btn       = document.getElementById("btn-predict");
  const grid      = document.getElementById("predictor-grid");
  const result    = document.getElementById("result");
  const errorBox  = document.getElementById("predict-error");

  if (!btn || !grid) return;   // Predict template not on this page

  btn.addEventListener("click", async () => {
    errorBox.textContent = "";
    errorBox.style.display = "none";
    result.style.display = "none";

    // Gather { feature: value } for every named control under the grid.
    const inputs = {};
    grid.querySelectorAll("[data-feature]").forEach((el) => {
      inputs[el.dataset.feature] = el.value;
    });

    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "Predicting…";

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputs),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      renderResult(body);
    } catch (e) {
      errorBox.textContent = "Prediction failed: " + e.message;
      errorBox.style.display = "block";
    } finally {
      btn.disabled    = false;
      btn.textContent = oldText;
    }
  });

  function renderResult(r) {
    result.classList.remove("high", "low");
    result.classList.add(r.prediction === 1 ? "high" : "low");

    const icon  = r.prediction === 1 ? "🌱" : "⚠️";
    const head  = r.prediction === 1 ? "High Potential Area" : "Low Potential Area";

    result.innerHTML = `
      <h3>${icon} ${head}</h3>
      <div class="metrics">
        <div class="metric">
          <div class="label">High Potential Confidence</div>
          <div class="value">${r.high_potential_pct.toFixed(2)}%</div>
        </div>
        <div class="metric">
          <div class="label">Low Potential Confidence</div>
          <div class="value">${r.low_potential_pct.toFixed(2)}%</div>
        </div>
      </div>
    `;
    result.style.display = "block";
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
})();
