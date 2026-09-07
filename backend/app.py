import os

from flask import Flask, jsonify, send_from_directory

from api import api
from auth import ensure_bootstrap_admin
from config import Config
from db import init_db


def create_app():
    app = Flask(__name__, static_folder=None)
    app.config.from_object(Config)

    init_db(app)
    with app.app_context():
        try:
            ensure_bootstrap_admin(app)
        except Exception as e:
            app.logger.error("Could not seed the coordinator account: %s", e)

    app.register_blueprint(api, url_prefix="/api")

    dist = app.config["FRONTEND_DIST"]

    @app.errorhandler(404)
    def not_found(e):
        # API 404s stay JSON; everything else falls through to the SPA.
        return jsonify({"error": "Not found."}), 404

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path):
        """Serve the built React app; unknown paths get index.html so the
        client-side router can handle /admin, /join/<token> and /me."""
        if path.startswith("api/"):
            return jsonify({"error": "Not found."}), 404
        full = os.path.join(dist, path)
        if path and os.path.isfile(full):
            return send_from_directory(dist, path)
        index = os.path.join(dist, "index.html")
        if os.path.isfile(index):
            return send_from_directory(dist, "index.html")
        return (
            "<h1>Engagement Desk</h1><p>The frontend has not been built yet. "
            "Run <code>npm ci &amp;&amp; npm run build</code> in <code>frontend/</code>.</p>",
            200,
        )

    @app.after_request
    def headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return resp

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
