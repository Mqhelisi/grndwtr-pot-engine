/* ============================================================================
   GPS detection + map + save flow
   --------------------------------------------------------------------------
   Compare this to the Streamlit version: that needed four attempted bridges
   to get coordinates from the browser to Python, and the final one was still
   fragile. Here, the same job is roughly thirty lines of plain JavaScript:

       browser GPS → display coords → click "Save" → POST /api/locations

   No iframe permissions, no synthetic events, no DOM-injection tricks.
   ============================================================================ */

(() => {
  // Elements (the Predict template wires these IDs)
  const btnDetect  = document.getElementById("btn-detect");
  const btnSave    = document.getElementById("btn-save-location");
  const status     = document.getElementById("gps-status");
  const coordsBox  = document.getElementById("gps-coords");
  const saveForm   = document.getElementById("save-form");
  const labelInput = document.getElementById("save-label");
  const saveToast  = document.getElementById("save-toast");
  const mapEl      = document.getElementById("map");

  // Sanity check: the script lives in the page only on /predict, but
  // bail safely if any element is missing (template change-resistance).
  if (!btnDetect || !mapEl) return;

  // ------------------------------------------------------------------
  // Map (Leaflet) — initialised once, marker added/moved on each fix.
  // Default view is centred on Zimbabwe so the map isn't a featureless
  // ocean before the first GPS fix.
  // ------------------------------------------------------------------
  const map = L.map("map").setView([-19.0154, 29.1549], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  let marker = null;
  let lastFix = null;   // {latitude, longitude} of the most recent successful fix

  // Custom teal marker so it's visible against any map background
  const goldIcon = L.divIcon({
    className: "gold-marker",
    html: '<div style="width:20px;height:20px;border-radius:50%;background:#f5c77a;border:3px solid #1a1a1a;box-shadow:0 0 12px rgba(245,199,122,0.7);"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  // ------------------------------------------------------------------
  // Detect / Re-detect
  // ------------------------------------------------------------------
  btnDetect.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation not supported by this browser.", "error");
      return;
    }

    setStatus("Requesting location from the browser…", "");
    btnDetect.disabled = true;
    saveToast.textContent = "";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        lastFix = { latitude: lat, longitude: lon };

        // Visible coordinates display
        coordsBox.style.display = "block";
        coordsBox.textContent =
          `📌 Detected: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;

        // Map: drop / move the marker, recentre, zoom in
        if (marker) marker.setLatLng([lat, lon]);
        else        marker = L.marker([lat, lon], { icon: goldIcon }).addTo(map);
        map.setView([lat, lon], 13);

        // Show the save form (was hidden until we had coords)
        saveForm.style.display  = "block";
        labelInput.value        = "";
        btnSave.disabled        = false;

        // Cycle the button to "Re-detect" wording on subsequent uses
        btnDetect.textContent = "↻ Re-detect Location";
        btnDetect.disabled    = false;

        setStatus("Location acquired.", "ok");

        console.log("[GPS] Got fix:", lastFix);
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

  // ------------------------------------------------------------------
  // Save this location → POST /api/locations
  // ------------------------------------------------------------------
  btnSave.addEventListener("click", async () => {
    if (!lastFix) {
      setStatus("Detect a location first.", "error");
      return;
    }

    btnSave.disabled  = true;
    saveToast.textContent = "Saving…";
    saveToast.style.color = "var(--text-mute)";

    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latitude:  lastFix.latitude,
          longitude: lastFix.longitude,
          label:     labelInput.value || null,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      saveToast.textContent =
        `✓ Saved (record #${body.id})${body.label ? ` — “${body.label}”` : ""}`;
      saveToast.style.color = "var(--success)";
      labelInput.value = "";
    } catch (e) {
      saveToast.textContent = "Could not save: " + e.message;
      saveToast.style.color = "var(--danger)";
    } finally {
      btnSave.disabled = false;
    }
  });

  // ------------------------------------------------------------------
  // Helper
  // ------------------------------------------------------------------
  function setStatus(msg, kind) {
    status.textContent = msg;
    status.classList.remove("ok", "error");
    if (kind) status.classList.add(kind);
  }
})();
