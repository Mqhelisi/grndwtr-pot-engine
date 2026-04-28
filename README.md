# Groundwater Potential Mapping System — Flask edition

A rebuild of the Streamlit prototype as a proper Flask application, with
SQLite-backed storage for saved GPS locations.

## What's in here

```
groundwater_flask/
├── app.py                  Flask app + page and API routes
├── config.py               Single place for configuration (DB URL, paths)
├── models.py               SQLAlchemy schema (SavedLocation table)
├── ml.py                   Model loading + prediction pipeline
├── requirements.txt
├── README.md               (this file)
├── ROADMAP_POSTGRES.md     How to switch SQLite → PostgreSQL later
│
├── artifacts/              Trained model + dataset (unchanged from original)
│   ├── svm_model.pkl
│   ├── scaler.pkl
│   ├── encoder.pkl
│   ├── selected_features.pkl
│   └── augmented_data.csv
│
├── instance/               SQLite database lives here (auto-created)
│   └── groundwater.db      (created on first run)
│
├── static/
│   ├── css/style.css       Dark + gold theme (preserved from the original)
│   └── js/
│       ├── geo.js          GPS detect + map + save flow
│       └── predict.js      Form submission for predictions
│
└── templates/              Jinja templates (one per page)
    ├── base.html
    ├── home.html
    ├── predict.html
    ├── model_info.html
    ├── feature_guide.html
    └── about.html
```

## Running it

```bash
python -m venv venv
source venv/bin/activate            # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000 in your browser. The SQLite database file is
created automatically the first time the app starts.

## How the GPS flow works

1. On the **Predict** page, click **📍 Detect My Location**.
2. The browser prompts for location access — allow it.
3. The detected coordinates appear, and a marker is dropped on the map.
4. Type an optional label (e.g. "Site A — Bulawayo north") and click
   **💾 Save this location**. The fix is written to SQLite via
   `POST /api/locations`.
5. To re-detect, click the same button again (it's relabelled
   **↻ Re-detect Location** after the first fix).

The Flask server logs every save, so the developer console shows lines like:

```
[INFO] Saved location #3 — lat=-20.1456, lon=28.5832, label='Site A'
```

## Inspecting saved locations

The database is a single file: `instance/groundwater.db`.

- Quickest: open it with the **DB Browser for SQLite** (free, all platforms).
- From the command line:
  ```bash
  sqlite3 instance/groundwater.db "SELECT * FROM saved_locations;"
  ```
- Via the API:
  ```bash
  curl http://localhost:5000/api/locations
  ```

## API surface

| Method | Path                | Body                                             | Returns                                      |
| ------ | ------------------- | ------------------------------------------------ | -------------------------------------------- |
| POST   | `/api/predict`      | `{ feature_name: value, … }`                     | `{ prediction, label, *_pct }`               |
| POST   | `/api/locations`    | `{ latitude, longitude, label? }`                | `{ id, latitude, longitude, label, created_at }` |
| GET    | `/api/locations`    | —                                                | `[ {…}, … ]` newest first, max 500           |

## Switching to PostgreSQL later

See **ROADMAP_POSTGRES.md** in this folder. It's a one-line code change
plus standing up a Postgres instance.
