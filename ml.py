"""
Machine-learning pipeline.

This module is a clean repackaging of the prediction logic from the
original Streamlit app.py — same model files, same encoder, same scaler,
same Boruta-selected features, same prediction shape.  Nothing about the
science changes in this rebuild; only the way it's wrapped does.

Three things are loaded once at import time and reused for every request:
    - svm_model.pkl       (the trained classifier)
    - scaler.pkl          (StandardScaler)
    - encoder.pkl         (OrdinalEncoder)
    - selected_features.pkl  (the Boruta-chosen subset of features)
    - augmented_data.csv  (used to derive the dropdown options for each
                           predictor, exactly as the Streamlit app did)
"""

import joblib
import numpy as np
import pandas as pd

from config import Config


# ---------------------------------------------------------------------------
# Module-level state — loaded once at import.
# ---------------------------------------------------------------------------
def _safe_load(path: str, name: str):
    """Same defensive loader the Streamlit app used."""
    try:
        return joblib.load(path)
    except Exception as exc:                 # noqa: BLE001 (we genuinely want all)
        print(f"[ml] WARNING: could not load {name} from {path}: {exc}")
        return None


model              = _safe_load(Config.MODEL_PATH,    "model")
scaler             = _safe_load(Config.SCALER_PATH,   "scaler")
encoder            = _safe_load(Config.ENCODER_PATH,  "encoder")
selected_features  = _safe_load(Config.FEATURES_PATH, "selected_features")

try:
    dataset = pd.read_csv(Config.DATASET_PATH)
except Exception as exc:                     # noqa: BLE001
    print(f"[ml] WARNING: could not load dataset: {exc}")
    dataset = pd.DataFrame()

# The encoder was fit on every dataset column except the target, which in
# this dataset is literally named "Decision".  Mirror the original app's
# logic exactly so the encoder receives the same column set it was fit on.
TARGET_COLUMN = "Decision"
if not dataset.empty:
    full_features = [c for c in dataset.columns if c != TARGET_COLUMN]
else:
    full_features = list(selected_features) if selected_features else []

# Default fill values for any feature not in the user's input — uses the
# most common value in the training data.
default_values = {}
if not dataset.empty:
    for col in full_features:
        if col in dataset.columns:
            try:
                default_values[col] = dataset[col].mode().iloc[0]
            except Exception:                # noqa: BLE001
                default_values[col] = ""


# ---------------------------------------------------------------------------
# Public helpers used by the Flask routes.
# ---------------------------------------------------------------------------
def is_ready() -> bool:
    """Has every artifact loaded successfully?"""
    return all(x is not None for x in (model, scaler, encoder, selected_features)) \
        and not dataset.empty


def predictor_options() -> dict:
    """
    For each Boruta-selected feature, return the sorted list of unique
    values present in the training dataset.  This is what the original
    app fed into st.selectbox().
    """
    out = {}
    if not is_ready():
        return out
    for feature in selected_features:
        if feature in dataset.columns:
            out[feature] = sorted(dataset[feature].dropna().unique().tolist())
        else:
            out[feature] = []
    return out


def feature_guide() -> list:
    """
    Returns [(feature_name, [possible values...])] for every feature in
    the full pipeline — used by the Feature Guide page.
    """
    out = []
    if dataset.empty:
        return out
    for col in full_features:
        if col in dataset.columns:
            try:
                vals = sorted(dataset[col].dropna().unique().tolist())
            except Exception:                # noqa: BLE001
                vals = []
        else:
            vals = []
        out.append((col, vals))
    return out


def predict(user_inputs: dict) -> dict:
    """
    Run the prediction pipeline.

    Args:
        user_inputs: {feature_name: chosen_value}, only the
                     Boruta-selected features need be present.

    Returns:
        {
            "prediction":            0 or 1,
            "label":                 "High Potential Area" / "Low Potential Area",
            "high_potential_pct":    float (0–100),
            "low_potential_pct":     float (0–100),
        }
    """
    if not is_ready():
        raise RuntimeError(
            "Model artifacts are not all loaded — check the artifacts/ folder."
        )

    # Build a complete row covering every feature the encoder was fit on,
    # filling any missing fields with the training-data mode.
    full_input = dict(default_values)
    full_input.update(user_inputs)
    for col in full_features:
        if col not in full_input:
            full_input[col] = default_values.get(col, "")

    # Order columns exactly as the encoder expects, then encode/scale/select.
    input_df    = pd.DataFrame([full_input])[full_features]
    encoded     = encoder.transform(input_df)
    encoded_df  = pd.DataFrame(encoded, columns=full_features)
    selected_df = encoded_df[selected_features]
    scaled      = scaler.transform(selected_df)

    pred  = int(model.predict(scaled)[0])
    probs = model.predict_proba(scaled)[0]   # [low_prob, high_prob]

    return {
        "prediction":         pred,
        "label":              "High Potential Area" if pred == 1 else "Low Potential Area",
        "high_potential_pct": float(probs[1] * 100.0),
        "low_potential_pct":  float(probs[0] * 100.0),
    }
