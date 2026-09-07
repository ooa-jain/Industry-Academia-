"""MongoDB Atlas access layer."""
import hashlib
import secrets
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING, DESCENDING, MongoClient

_client = None
_db = None


def init_db(app):
    global _client, _db
    kwargs = {"appname": "iae-desk", "serverSelectionTimeoutMS": 8000}
    uri = app.config["MONGO_URI"]
    if "mongodb+srv" in uri or "ssl=true" in uri or "tls=true" in uri:
        try:
            import certifi
            kwargs["tlsCAFile"] = certifi.where()
        except ImportError:
            pass
    _client = MongoClient(uri, **kwargs)
    _db = _client[app.config["MONGO_DB"]]
    # Don't die at boot if Atlas is unreachable — the process stays up and
    # /api/health reports the real reason (usually an IP missing from the
    # Atlas Network Access allowlist).
    try:
        ensure_indexes()
    except Exception as e:
        app.logger.error("Mongo unreachable at startup: %s. "
                         "Check MONGO_URI and the Atlas IP allowlist.", e)
    return _db


def db():
    if _db is None:
        raise RuntimeError("init_db() has not been called")
    return _db


def ensure_indexes():
    d = _db
    d.admins.create_index([("email", ASCENDING)], unique=True)
    d.groups.create_index([("created_at", DESCENDING)])
    d.members.create_index([("group_id", ASCENDING), ("email", ASCENDING)], unique=True)
    d.members.create_index([("token_hash", ASCENDING)], unique=True, sparse=True)
    d.engagements.create_index([("group_id", ASCENDING), ("status", ASCENDING)])
    d.engagements.create_index([("group_id", ASCENDING), ("seq", ASCENDING)])
    d.tasks.create_index([("group_id", ASCENDING), ("assignee_id", ASCENDING)])
    d.tasks.create_index([("engagement_id", ASCENDING), ("order", ASCENDING)])
    d.tasks.create_index([("mentions", ASCENDING)])
    d.comments.create_index([("task_id", ASCENDING), ("created_at", ASCENDING)])
    d.activity.create_index([("group_id", ASCENDING), ("created_at", DESCENDING)])


# ------------------------------------------------------------------ helpers
def now():
    return datetime.now(timezone.utc)


def oid(value):
    """Coerce to ObjectId or return None (never raises)."""
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except (InvalidId, TypeError):
        return None


def jsonable(doc):
    """Recursively turn a Mongo document into JSON-safe primitives."""
    if doc is None:
        return None
    if isinstance(doc, list):
        return [jsonable(d) for d in doc]
    if isinstance(doc, ObjectId):
        return str(doc)
    if isinstance(doc, datetime):
        if doc.tzinfo is None:
            doc = doc.replace(tzinfo=timezone.utc)
        return doc.isoformat()
    if isinstance(doc, dict):
        out = {}
        for k, v in doc.items():
            out["id" if k == "_id" else k] = jsonable(v)
        return out
    return doc


def new_token():
    """Return (raw_token, sha256_hash, display_tail)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_token(raw), raw[-6:]


def hash_token(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def log(group_id, actor, text, ref=None):
    """Append one activity line. Best-effort; never raises into a request."""
    try:
        _db.activity.insert_one({
            "group_id": oid(group_id),
            "actor": actor,
            "text": text,
            "ref": ref or {},
            "created_at": now(),
        })
    except Exception:
        pass


def next_seq(group_id):
    last = _db.engagements.find_one(
        {"group_id": oid(group_id)}, sort=[("seq", DESCENDING)], projection={"seq": 1}
    )
    return (last or {}).get("seq", 0) + 1
