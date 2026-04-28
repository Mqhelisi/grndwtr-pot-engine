"""
Groundwater Potential Mapping System — Flask edition.

Architecture in plain English
-----------------------------
There are two kinds of routes in this file:

    Page routes (return rendered HTML)
        /                    Home
        /predict             Predict (GPS + predictor form)
        /model-info          Model Info
        /feature-guide       Feature Guide
        /about               About

    JSON API routes (return JSON, called from the browser via fetch)
        POST /api/predict             run the SVM and return the result
        POST /api/locations           save a GPS fix to the database
        GET  /api/locations           list saved GPS fixes (handy for inspection)

The split keeps the templates dumb (no JS-in-Python string-building) and
the data flow obvious — every piece of dynamic behaviour on the page is
a fetch() to a URL listed above.
"""

import logging
import os

from flask import (
    Flask, jsonify, render_template, request,
)

from config import Config
from models import db, SavedLocation
import ml


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------
def create_app() -> Flask:
    app = Flask(__name__, instance_relative_config=False)
    app.config.from_object(Config)

    # Make sure the instance folder exists (this is where SQLite lives).
    os.makedirs(os.path.join(Config.BASE_DIR if hasattr(Config, "BASE_DIR") else ".", "instance"),
                exist_ok=True)

    db.init_app(app)
    with app.app_context():
        db.create_all()        # Creates saved_locations table on first run

    # Friendlier startup logging
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    app.logger.info("ML pipeline ready: %s", ml.is_ready())

    register_routes(app)
    return app


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
def register_routes(app: Flask) -> None:

    # =====================================================================
    # PAGE ROUTES
    # =====================================================================
    @app.route("/")
    def home():
        return render_template("home.html", page="home")

    @app.route("/predict")
    def predict_page():
        return render_template(
            "predict.html",
            page="predict",
            ml_ready=ml.is_ready(),
            predictors=ml.predictor_options(),     # {feature: [options...]}
        )

    @app.route("/model-info")
    def model_info_page():
        return render_template(
            "model_info.html",
            page="model-info",
            selected_features=ml.selected_features or [],
        )

    @app.route("/feature-guide")
    def feature_guide_page():
        return render_template(
            "feature_guide.html",
            page="feature-guide",
            features=ml.feature_guide(),
        )

    @app.route("/about")
    def about_page():
        return render_template("about.html", page="about")

    # =====================================================================
    # JSON API ROUTES
    # =====================================================================

    @app.route("/api/predict", methods=["POST"])
    def api_predict():
        """Run the SVM on a single set of predictor values."""
        payload = request.get_json(silent=True) or {}
        try:
            result = ml.predict(payload)
            return jsonify(result), 200
        except Exception as exc:                 # noqa: BLE001
            app.logger.exception("Prediction failed")
            return jsonify({"error": str(exc)}), 400

    @app.route("/api/locations", methods=["POST"])
    def api_save_location():
        """
        Save a GPS fix to the database.
        Body: { "latitude": float, "longitude": float, "label": str|null }
        """
        payload = request.get_json(silent=True) or {}

        try:
            lat = float(payload["latitude"])
            lon = float(payload["longitude"])
        except (KeyError, TypeError, ValueError):
            return jsonify({
                "error": "latitude and longitude are required and must be numeric",
            }), 400

        # Sanity-check ranges to avoid junk data getting saved.
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            return jsonify({"error": "latitude/longitude out of range"}), 400

        label = payload.get("label")
        if label is not None:
            label = str(label).strip()
            if label == "":
                label = None
            elif len(label) > 200:
                label = label[:200]

        loc = SavedLocation(latitude=lat, longitude=lon, label=label)
        db.session.add(loc)
        db.session.commit()

        # Mirror the “print to console” the original Streamlit app exposed —
        # plus this is genuinely useful for the developer running the server.
        app.logger.info(
            "Saved location #%s — lat=%s, lon=%s, label=%r",
            loc.id, loc.latitude, loc.longitude, loc.label,
        )

        return jsonify(loc.to_dict()), 201

    @app.route("/api/locations", methods=["GET"])
    def api_list_locations():
        """Return saved locations, newest first.  Useful for inspection."""
        rows = (SavedLocation.query
                .order_by(SavedLocation.created_at.desc())
                .limit(500)
                .all())
        return jsonify([r.to_dict() for r in rows]), 200


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
app = create_app()

if __name__ == "__main__":
    # 0.0.0.0 so it's reachable from the host browser when the server runs
    # in a VM/container or when you want to test from your phone on the
    # same Wi-Fi network.
    app.run(host="0.0.0.0", port=5000, debug=True)
