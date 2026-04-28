"""
Database models.

Right now there's just one table: SavedLocation.  Each row is one GPS
fix the user chose to save, plus an optional human-readable label.

The model is intentionally database-agnostic — these column types map
cleanly to both SQLite and PostgreSQL (and MySQL, if it ever comes to
that), so nothing here needs to change when the underlying database
does.
"""

from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

# A single SQLAlchemy instance is created here and imported from elsewhere.
db = SQLAlchemy()


class SavedLocation(db.Model):
    """One saved GPS fix."""

    __tablename__ = "saved_locations"

    id        = db.Column(db.Integer, primary_key=True)
    latitude  = db.Column(db.Float,   nullable=False)
    longitude = db.Column(db.Float,   nullable=False)
    label     = db.Column(db.String(200), nullable=True)   # optional, user-typed
    created_at = db.Column(
        db.DateTime, default=datetime.utcnow, nullable=False, index=True,
    )

    def to_dict(self):
        """JSON-friendly representation for API responses."""
        return {
            "id":         self.id,
            "latitude":   self.latitude,
            "longitude":  self.longitude,
            "label":      self.label,
            "created_at": self.created_at.isoformat() + "Z",
        }

    def __repr__(self):
        return f"<SavedLocation #{self.id} ({self.latitude}, {self.longitude})>"
