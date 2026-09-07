from app import app  # noqa: F401

# gunicorn entrypoint:  gunicorn -w 3 -b 127.0.0.1:8130 wsgi:app
